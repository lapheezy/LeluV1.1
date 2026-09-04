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

type MessageContent = string | Array<Record<string, unknown>>;

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
  private model = "claude-sonnet-4-5";

  async initialize(): Promise<void> {
    this.model =
      resolveFirst("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5";
    this.apiKey =
      resolveFirst("ANTHROPIC_API_KEY", "CLAUDE_API_KEY") ?? "";

    this.initialized = true;

    console.info("[AnthropicProvider] Initialized", {
      hasKey: this.apiKey.length > 0,
      keyLength: this.apiKey.length,
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
      this.initialized && this.enabled && this.requiresApiKey && this.apiKey.length > 0
    );
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();
    let lastError: string | undefined;

    if (!this.initialized) {
      lastError = "Anthropic provider not initialized.";
    } else if (!this.apiKey) {
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

    if (!this.apiKey) {
      throw new Error("Anthropic API key is missing.");
    }

    const { system, messages } = this.buildConversation(request);

    const payload = {
      model: this.selectModel(request),
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
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stop?.length ? { stop_sequences: request.stop } : {}),
      // Streaming is suppressed while tools are on the table: a
      // tool_use block arrives as fragmented input_json_delta chunks,
      // and a half-parsed argument object is worse than a slightly
      // later answer. The final generation of the loop, which carries
      // no tools, streams normally.
      ...(request.onDelta && !request.tools?.length ? { stream: true } : {}),
    };

    let response: Response;

    try {
      response = await fetch(endpointUrl("anthropic", "messages"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          // Without this the Messages API refuses the CORS preflight and
          // the call never leaves the browser. LÉLU is a client-side SPA
          // that already calls Groq/OpenRouter directly with the key in
          // the bundle, so this provider is exactly as exposed as those —
          // no more, no less. Route through /api/ai if that changes.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutFor(request)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Anthropic network error: ${message}`);
    }

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

    const content = this.extractContent(data);
    const toolCalls = this.extractToolCalls(data);

    // A tool-call turn legitimately carries little or no text, so the
    // empty-content guard must not reject it — that would turn a valid
    // tool request into a provider failure and drop LÉLU to the next
    // provider in the chain for no reason.
    if ((typeof content !== "string" || !content.trim()) && toolCalls.length === 0) {
      throw new Error("Anthropic returned no usable content.");
    }

    const processingTime = Date.now() - started;

    return {
      text: content.trim(),
      provider: this.name,
      model: payload.model,
      processingTime,
      ...(toolCalls.length ? { toolCalls } : {}),
      stopReason: (data?.stop_reason as string) || undefined,
      metadata: {
        usage: data?.usage,
        finishReason: (data?.stop_reason as string) || undefined,
      },
    };
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

  private extractContent(data: Record<string, unknown> | null): string {
    if (!data?.content) return "";
    const content = data.content as Array<{ type: string; text?: string }>;
    if (!Array.isArray(content)) return "";
    const textBlock = content.find((block) => block.type === "text");
    return textBlock?.text ?? "";
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

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr) return;
      try {
        const chunk = JSON.parse(dataStr) as {
          type: string;
          delta?: { type: string; text?: string };
          message?: { stop_reason?: string; usage?: unknown };
        };

        if (chunk.type === "message_start" && chunk.message?.usage) {
          usage = chunk.message.usage;
        }

        if (chunk.type === "message_delta" && chunk.message?.stop_reason) {
          finishReason = chunk.message.stop_reason;
        }

        if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
          const delta = chunk.delta.text;
          if (typeof delta === "string" && delta.length > 0) {
            content += delta;
            onDelta(content);
          }
        }
      } catch {
        // Ignore malformed keep-alive fragments.
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
      }
      if (buffer.trim()) processLine(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Anthropic stream interrupted: ${message}`);
    }

    if (!content.trim()) {
      throw new Error("Anthropic returned no usable content.");
    }

    return {
      text: content.trim(),
      provider: this.name,
      model,
      processingTime: Date.now() - started,
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
