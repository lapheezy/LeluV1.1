/**
 * ==========================================================
 * LÉLU
 * ANTHROPIC PROVIDER
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth, ToolCall } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { endpointUrl } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";
import { authHeaders, isBrokered, providerConfigured } from "../core/model/BrokerTransport";
import { resolveModel } from "../core/ProviderModels";

type MessageContent = string | Array<Record<string, unknown>>;

/**
 * Models that still accept `temperature` / `top_p` / `top_k`.
 *
 * Claude Opus 4.7 and everything after it reject sampling parameters with
 * a 400. LÉLU's structured-output callers (ProjectInterpreter,
 * SelfStudyEngine) send `temperature: 0`, so forwarding it unconditionally
 * turned every one of their calls on a current model into a provider
 * failure and a silent drop to the next provider in the chain.
 */
const SAMPLING_MODELS = /^claude-(?:3[-.]|(?:opus|sonnet|haiku)-4(?:-[0-6])?(?:-\d{8})?$)/;

export function acceptsSamplingParams(model: string): boolean {
  return SAMPLING_MODELS.test(model);
}

/**
 * Models that take the server-side refusal fallback (`fallbacks: "default"`).
 * On a safety decline the API re-runs the request on a fallback model inside
 * the same call, so the user gets an answer from Claude rather than a refusal
 * that the provider chain would otherwise route to a different vendor.
 */
const SERVER_FALLBACK_MODELS = /^claude-(?:opus-5(?:-5)?|fable-5-1|sonnet-5-5)$/;
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function supportsServerFallback(model: string): boolean {
  return SERVER_FALLBACK_MODELS.test(model);
}

/**
 * Statuses worth one more try against the SAME provider before the chain
 * moves on: rate limit, overload (529) and transient upstream failures.
 * Anything else — auth, a malformed request, a missing model — fails the
 * same way on every attempt, so retrying only delays the fallback.
 */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8_000;

/** Delay before retry `attempt` (1-based), honouring retry-after when sent. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(500 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What LÉLU says when Claude (and its server-side fallback) declines. */
const REFUSAL_TEXT =
  "I can't help with that one. If I've misread what you're after, tell me more and I'll try again.";

/**
 * The blocks of a turn that may be sent back on the next request.
 *
 * After a server-side fallback switches models mid-output, the declined
 * model's thinking and tool_use blocks before the (last) `fallback` marker
 * must not be echoed; its text blocks and everything after the marker are
 * the continuation and echo normally.
 */
export function replayableBlocks(
  blocks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const boundary = blocks.map((block) => block.type).lastIndexOf("fallback");
  if (boundary < 0) return blocks;
  return blocks.filter((block, index) => index > boundary || block.type === "text");
}

/** Does this content carry a tool_result block? */
function hasToolResult(content: MessageContent): boolean {
  return (
    Array.isArray(content) &&
    content.some((block) => (block as Record<string, unknown>)?.type === "tool_result")
  );
}

/** Normalize a content value to the block-array form. */
function toBlocks(content: MessageContent): Array<Record<string, unknown>> {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/**
 * Join two same-role turns. Plain text stays plain text so the common
 * path never inflates into blocks; anything carrying an image becomes a
 * block array, which is the only form that can hold both.
 */
function mergeContent(a: MessageContent, b: MessageContent): MessageContent {
  if (typeof a === "string" && typeof b === "string") return `${a}\n\n${b}`;
  return [...toBlocks(a), ...toBlocks(b)];
}

export default class AnthropicProvider implements AIProvider {
  readonly name = "Anthropic";
  readonly priority = 7;
  readonly enabled = true;
  readonly timeout = 30000;

  /**
   * How long THIS request may take.
   *
   * 30s is right for a chat turn but wrong for an engineering one: a
   * tool-carrying conversation replays file contents and command output
   * on every round, so the payload grows and the model has more to read.
   * A real run reading two source files aborted at 37.9s mid-loop — the
   * turn was lost and the fallback chain answered without tools, having
   * done no work.
   *
   * The tool-carrying case gets a longer budget; ordinary chat is
   * unchanged, so a hung request still fails fast on the common path.
   */
  private timeoutFor(request: AIRequest): number {
    return request.tools?.length ? 180_000 : this.timeout;
  }
  readonly requiresApiKey = true;
  readonly capabilities = ["chat", "reasoning", "vision", "memory", "tools"] as const;
  readonly supportsTools = true;

  private apiKey = "";
  private initialized = false;
  private model = resolveModel("anthropic");
  private serverFallback = true;

  async initialize(): Promise<void> {
    this.model =
      resolveModel("anthropic");
    this.apiKey =
      resolveFirst("ANTHROPIC_API_KEY", "LELU_ANTHROPIC_API_KEY", "CLAUDE_API_KEY") ?? "";
    // On by default; ANTHROPIC_REFUSAL_FALLBACK=off sends plain requests.
    this.serverFallback =
      (resolveFirst("ANTHROPIC_REFUSAL_FALLBACK") ?? "").toLowerCase() !== "off";

    this.initialized = true;

    console.info("[AnthropicProvider] Initialized", {
      hasKey: this.apiKey.length > 0,
      model: this.model,
    });
  }

  private selectModel(request: AIRequest): string {
    const requested = request.model?.trim() || this.model;
    return requested;
  }

  private buildUserContent(
    request: AIRequest,
  ): string | Array<Record<string, unknown>> {
    if (!request.media?.length) {
      return request.prompt;
    }

    const parts: Array<Record<string, unknown>> = [];
    for (const media of request.media) {
      if (media.kind === "image" && media.dataUrl.startsWith("data:")) {
        const base64Match = media.dataUrl.match(/;base64,(.+)$/);
        if (base64Match) {
          const mediaType = media.dataUrl.match(/data:([^;]+)/)?.[1] || "image/jpeg";
          parts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Match[1],
            },
          });
        }
      }
    }
    parts.push({ type: "text", text: request.prompt });
    return parts;
  }

  /**
   * Translate LÉLU's OpenAI-shaped conversation into the Messages API
   * shape. Three differences are load-bearing, and getting any of them
   * wrong is a 400 rather than a degraded answer:
   *
   *   • `system` is a TOP-LEVEL parameter. A system entry left inside
   *     `messages` is rejected outright — so the shared LÉLU prompt and
   *     every system message contextMessages() produces (memory context,
   *     live-retrieval results) are hoisted and joined here. Dropping
   *     them instead would silently strip Lélu's identity and her fresh
   *     retrieval results from the request.
   *   • Roles must ALTERNATE, so consecutive same-role turns are merged.
   *   • The conversation must OPEN with a user turn; a leading assistant
   *     turn (a greeting replayed from history) is dropped.
   */
  private buildConversation(request: AIRequest): {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>;
  } {
    const history = [...contextMessages(request), ...(request.messages ?? [])];

    // The Messages API rejects tool_use / tool_result blocks in a request
    // that defines no tools. The router's tool loop withholds tools on its
    // closing round to force a final answer — over a history that is full
    // of tool exchanges — so that round was a guaranteed 400 and the
    // finished work fell through to another provider. With no tools on
    // the table the exchange is replayed as plain text instead: the model
    // still sees every call and every result.
    const toolsOffered = (request.tools?.length ?? 0) > 0;

    const systemParts = [LELU_SYSTEM_PROMPT];
    const turns: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [];

    for (const message of history) {
      if (message.role === "system") {
        if (message.content.trim()) systemParts.push(message.content);
        continue;
      }

      // A tool RESULT is a user turn carrying a tool_result block —
      // that is the Messages API's shape, not a role of its own.
      if (message.role === "tool") {
        if (!toolsOffered) {
          const label = message.toolName ? `Result of ${message.toolName}` : "Tool result";
          turns.push({
            role: "user",
            content: `[${label}${message.toolError ? " — FAILED" : ""}]\n${message.content}`,
          });
          continue;
        }
        turns.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId ?? "",
              content: message.content,
              // A failure is flagged, never silently passed as output.
              ...(message.toolError ? { is_error: true } : {}),
            },
          ],
        });
        continue;
      }

      // An assistant turn that ASKED for tools must be replayed with its
      // tool_use blocks intact. Replaying only its text breaks the
      // tool_use/tool_result pairing the API requires, and the next call
      // is rejected rather than continuing the exchange.
      if (message.role === "assistant" && message.toolCalls?.length) {
        if (!toolsOffered) {
          const calls = message.toolCalls
            .map((call) => `[Called ${call.name} ${JSON.stringify(call.arguments ?? {})}]`)
            .join("\n");
          turns.push({
            role: "assistant",
            content: message.content.trim() ? `${message.content}\n${calls}` : calls,
          });
          continue;
        }

        // Our own earlier turn, handed back exactly as the API returned
        // it. Current models put thinking blocks before tool_use; rebuilt
        // from text + toolCalls they would be lost, and the model would
        // continue the loop without the reasoning that chose the call.
        if (message.providerBlocks?.provider === "anthropic" && message.providerBlocks.blocks.length) {
          turns.push({ role: "assistant", content: message.providerBlocks.blocks });
          continue;
        }

        const blocks: Array<Record<string, unknown>> = [];
        if (message.content.trim()) {
          blocks.push({ type: "text", text: message.content });
        }
        for (const call of message.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          });
        }
        turns.push({ role: "assistant", content: blocks });
        continue;
      }

      turns.push({ role: message.role, content: message.content });
    }

    // The live prompt is appended only when it is not already the tail
    // of the conversation. Mid-tool-loop the last turn is a tool_result
    // and re-appending the original prompt would ask the question twice.
    const tail = history[history.length - 1];
    if (!(tail?.role === "tool")) {
      turns.push({ role: "user", content: this.buildUserContent(request) });
    }

    // Drop any leading assistant turn, then collapse consecutive
    // same-role turns so the alternation the API requires holds.
    //
    // Dropping a leading assistant turn can ORPHAN tool results: if that
    // turn carried the tool_use blocks, the tool_result turns after it
    // no longer have anything to correspond to, and the API rejects the
    // whole request ("each tool_result block must have a corresponding
    // tool_use block in the previous message"). So any tool_result turn
    // left leading is dropped with it — an unpaired result is invalid,
    // and sending it fails the call rather than degrading it.
    while (turns.length > 0 && turns[0].role === "assistant") turns.shift();
    while (turns.length > 0 && hasToolResult(turns[0].content)) turns.shift();

    const merged: typeof turns = [];
    for (const turn of turns) {
      const previous = merged[merged.length - 1];
      if (previous && previous.role === turn.role) {
        previous.content = mergeContent(previous.content, turn.content);
        continue;
      }
      merged.push({ ...turn });
    }

    return { system: systemParts.join("\n\n"), messages: merged };
  }

  async isAvailable(): Promise<boolean> {
    return (
      this.initialized && this.enabled && providerConfigured("anthropic", this.apiKey)
    );
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();
    let lastError: string | undefined;

    if (!this.initialized) {
      lastError = "Anthropic provider not initialized.";
    } else if (!isBrokered("anthropic") && !this.apiKey) {
      lastError = "Anthropic API key missing.";
    }

    return {
      available,
      initialized: this.initialized,
      lastChecked: Date.now(),
      lastError,
    };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();

    if (!this.initialized) {
      throw new Error("Anthropic provider is not initialized.");
    }

    if (!isBrokered("anthropic") && !this.apiKey) {
      // Only a DIRECT send needs a key here; brokered requests carry
      // none by design, and refusing them would disable the provider
      // the broker can actually serve.
      throw new Error("Anthropic API key is missing.");
    }

    const { system, messages } = this.buildConversation(request);

    const model = this.selectModel(request);
    const useServerFallback = this.serverFallback && supportsServerFallback(model);

    const payload = {
      model,
      // Required by the Messages API — unlike the OpenAI-compatible
      // providers, omitting it is a 400 rather than an unbounded reply.
      // A tool call must be able to CARRY A WHOLE FILE.
      //
      // 2048 is ample for a chat reply but far too small for an
      // engineering turn: a project.write whose argument is a 200-line
      // source file exceeds it, the tool_use JSON is truncated mid-
      // block, and the arguments arrive incomplete. Measured: the write
      // then landed as an empty file. Tool-carrying requests get room;
      // ordinary chat keeps the smaller, cheaper ceiling.
      max_tokens: request.maxTokens ?? (request.tools?.length ? 16_384 : 2048),
      // The system block is marked cacheable rather than re-billed on
      // every turn. It is the most repeated content LÉLU sends: the
      // identity prompt alone is ~430 tokens, and contextMessages()
      // hoists memory and live-retrieval results into the same block,
      // which is exactly when it gets large. Below Anthropic's minimum
      // cacheable length this is simply ignored, so it costs nothing
      // when the block is short and saves most of the input cost when
      // it is not. The block must be the array form to carry
      // cache_control at all.
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages,
      // Native tool calling. The router supplies only tools that are
      // registered, executable and permitted right now, so anything the
      // model calls from this list can actually run.
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
      ...(request.temperature !== undefined && acceptsSamplingParams(model)
        ? { temperature: request.temperature }
        : {}),
      ...(useServerFallback ? { fallbacks: "default" } : {}),
      ...(request.stop?.length ? { stop_sequences: request.stop } : {}),
      // Streaming is suppressed while tools are on the table: a
      // tool_use block arrives as fragmented input_json_delta chunks,
      // and a half-parsed argument object is worse than a slightly
      // later answer. The final generation of the loop, which carries
      // no tools, streams normally.
      ...(request.onDelta && !request.tools?.length ? { stream: true } : {}),
    };

    const response = await this.send(payload, useServerFallback, this.timeoutFor(request));

    if (payload.stream) {
      return await this.generateStreamed(response, started, payload.model, request.onDelta!);
    }

    const raw = await response.text();
    let data: Record<string, unknown> | null = null;

    if (raw.trim()) {
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const apiMessage =
        (data?.error as Record<string, unknown>)?.message ||
        data?.message ||
        raw ||
        `HTTP ${response.status}`;
      throw new Error(`Anthropic failed ${response.status}: ${String(apiMessage)}`);
    }

    const stopReason = (data?.stop_reason as string) || undefined;
    const content = this.extractContent(data);
    let toolCalls = this.extractToolCalls(data);
    let blocks = Array.isArray(data?.content)
      ? (data!.content as Array<Record<string, unknown>>)
      : [];

    // A DECLINE IS AN ANSWER, not a provider failure. Thrown, it would send
    // the same request down the chain to another vendor — routing around
    // the decline instead of respecting it. The server-side fallback has
    // already had its chance by the time a refusal reaches here.
    if (stopReason === "refusal") {
      const details = data?.stop_details as Record<string, unknown> | null | undefined;
      return {
        text: content.trim() || REFUSAL_TEXT,
        provider: this.name,
        model: String(data?.model ?? payload.model),
        processingTime: Date.now() - started,
        stopReason,
        metadata: {
          usage: data?.usage,
          finishReason: stopReason,
          refusal: { category: details?.category ?? null },
        },
      };
    }

    // CUT OFF MID-CALL. When max_tokens lands inside a tool_use block the
    // last call's arguments are incomplete — measured, a project.write
    // then landed as an empty file. Never hand a truncated call to the
    // executor: drop it, and keep any complete calls before it.
    let truncatedCall: string | undefined;
    if (stopReason === "max_tokens" && toolCalls.length > 0) {
      truncatedCall = toolCalls[toolCalls.length - 1].name;
      toolCalls = toolCalls.slice(0, -1);
      const lastToolUse = blocks.map((block) => block.type).lastIndexOf("tool_use");
      blocks = blocks.filter((_, index) => index !== lastToolUse);
      console.warn(
        `[AnthropicProvider] max_tokens cut off a ${truncatedCall} call; it was not executed.`,
      );
    }

    // A tool-call turn legitimately carries little or no text, so the
    // empty-content guard must not reject it — that would turn a valid
    // tool request into a provider failure and drop LÉLU to the next
    // provider in the chain for no reason.
    if ((typeof content !== "string" || !content.trim()) && toolCalls.length === 0) {
      throw new Error(
        truncatedCall
          ? `Anthropic ran out of output tokens while writing a ${truncatedCall} call.`
          : "Anthropic returned no usable content.",
      );
    }

    const processingTime = Date.now() - started;

    return {
      text: content.trim(),
      provider: this.name,
      // The model that actually answered: a server-side fallback can
      // serve the turn from a different model than the one requested.
      model: String(data?.model ?? payload.model),
      processingTime,
      ...(toolCalls.length
        ? { toolCalls, providerBlocks: { provider: "anthropic", blocks: replayableBlocks(blocks) } }
        : {}),
      stopReason,
      metadata: {
        usage: data?.usage,
        finishReason: stopReason,
        ...(truncatedCall ? { truncatedToolCall: truncatedCall } : {}),
      },
    };
  }

  /**
   * POST one Messages request, retrying what is worth retrying.
   *
   * 429 and 529 (overloaded) are routine at peak and usually clear within
   * seconds; without a retry, one of them dropped LÉLU straight off her
   * primary provider for the whole turn. Each attempt gets its own timeout.
   * A response is returned as soon as it is not retryable — including the
   * last failed attempt, so the caller reports the real upstream error.
   */
  private async send(
    payload: Record<string, unknown>,
    useServerFallback: boolean,
    timeoutMs: number,
  ): Promise<Response> {
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Brokered: no credential leaves the browser — the server attaches
        // its own. Direct (server/tests): the real header.
        ...authHeaders("anthropic", this.apiKey, (key) => ({ "x-api-key": key })),
        "anthropic-version": "2023-06-01",
        ...(useServerFallback ? { "anthropic-beta": SERVER_FALLBACK_BETA } : {}),
        // Only consulted on a DIRECT browser call (no broker). A brokered
        // request goes same-origin and the broker drops this header.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(payload),
    };

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(endpointUrl("anthropic", "messages"), {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        // A timeout already spent the whole budget; retrying doubles the
        // wait before the chain can move on.
        if (timedOut || attempt >= MAX_RETRIES) {
          throw new Error(`Anthropic network error: ${message}`);
        }
        await sleep(retryDelayMs(attempt + 1, null));
        continue;
      }

      if (!RETRYABLE_STATUS.has(response.status) || attempt >= MAX_RETRIES) {
        return response;
      }
      // Drain the failed body so the connection can be reused.
      await response.text().catch(() => "");
      await sleep(retryDelayMs(attempt + 1, response.headers.get("retry-after")));
    }
  }

  /** Lift tool_use content blocks into the provider-neutral shape. */
  private extractToolCalls(data: Record<string, unknown> | null): ToolCall[] {
    const content = data?.content;
    if (!Array.isArray(content)) return [];
    const calls: ToolCall[] = [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block?.type !== "tool_use") continue;
      calls.push({
        id: String(block.id ?? ""),
        name: String(block.name ?? ""),
        arguments: (block.input as Record<string, unknown>) ?? {},
      });
    }
    return calls;
  }

  /**
   * Every text block, in order. A reply can be split across several
   * (around a tool call, or at citation boundaries); taking only the
   * first silently truncated those answers.
   */
  private extractContent(data: Record<string, unknown> | null): string {
    if (!data?.content) return "";
    const content = data.content as Array<{ type: string; text?: string }>;
    if (!Array.isArray(content)) return "";
    return content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  /**
   * Consume an Anthropic SSE stream, invoking onDelta with the
   * ACCUMULATED text after every chunk. Throws on transport/API errors so
   * the provider fallback chain still engages normally.
   */
  private async generateStreamed(
    response: Response,
    started: number,
    model: string,
    onDelta: (accumulated: string) => void,
  ): Promise<AIResponse> {
    if (!response.ok || !response.body) {
      const raw = response.body ? await response.text() : "";
      let apiMessage = `HTTP ${response.status}`;
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        apiMessage =
          ((data?.error as Record<string, unknown>)?.message as string) ||
          (data?.message as string) || raw || apiMessage;
      } catch {
        /* keep default message */
      }
      throw new Error(`Anthropic failed ${response.status}: ${apiMessage}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: unknown;
    let finishReason: string | undefined;

    let servedBy = model;
    let streamError: string | undefined;

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr) return;
      let chunk: {
        type: string;
        delta?: { type?: string; text?: string; stop_reason?: string };
        message?: { model?: string; usage?: Record<string, unknown> };
        usage?: Record<string, unknown>;
        error?: { type?: string; message?: string };
      };
      try {
        chunk = JSON.parse(dataStr);
      } catch {
        // Ignore malformed keep-alive fragments.
        return;
      }

      if (chunk.type === "message_start") {
        if (chunk.message?.usage) usage = { ...chunk.message.usage };
        // After a pre-output fallback this names the model that served it.
        if (chunk.message?.model) servedBy = chunk.message.model;
      }

      // stop_reason arrives on the DELTA of message_delta, with the final
      // output-token count on its own `usage`. Reading `message` here (as
      // this did) meant finishReason was never set on a streamed turn.
      if (chunk.type === "message_delta") {
        if (chunk.delta?.stop_reason) finishReason = chunk.delta.stop_reason;
        if (chunk.usage) usage = { ...(usage as Record<string, unknown> | undefined), ...chunk.usage };
      }

      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        const delta = chunk.delta.text;
        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          onDelta(content);
        }
      }

      // An overload or API error can arrive AFTER a 200 and some text.
      // Ignoring it returned the partial reply as if it were complete.
      if (chunk.type === "error") {
        streamError = `${chunk.error?.type ?? "error"}: ${chunk.error?.message ?? "stream error"}`;
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
        if (streamError) break;
      }
      if (!streamError && buffer.trim()) processLine(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Anthropic stream interrupted: ${message}`);
    } finally {
      reader.releaseLock();
    }

    if (streamError) {
      throw new Error(`Anthropic stream failed: ${streamError}`);
    }

    // A decline after partial output: the partial is not an answer and is
    // discarded (and replaced on screen); a decline is never re-asked of
    // another provider.
    if (finishReason === "refusal") {
      onDelta(REFUSAL_TEXT);
      return {
        text: REFUSAL_TEXT,
        provider: this.name,
        model: servedBy,
        processingTime: Date.now() - started,
        stopReason: finishReason,
        metadata: { usage, finishReason, streamed: true },
      };
    }

    if (!content.trim()) {
      throw new Error("Anthropic returned no usable content.");
    }

    return {
      text: content.trim(),
      provider: this.name,
      model: servedBy,
      processingTime: Date.now() - started,
      stopReason: finishReason,
      metadata: {
        usage,
        finishReason,
        streamed: true,
      },
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.apiKey = "";
    console.info("[AnthropicProvider] Shutdown");
  }
}
