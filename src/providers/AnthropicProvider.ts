/**
 * ==========================================================
 * LÉLU
 * ANTHROPIC (CLAUDE) PROVIDER
 *
 * Claude speaks a different shape from every other provider in
 * this chain. The rest are OpenAI-compatible: one `messages`
 * array carrying `system`, `user` and `assistant` roles, posted
 * to `/chat/completions`. The Messages API instead takes:
 *
 *   - `system` as a TOP-LEVEL field (there is no system role in
 *     the messages array — sending one is a 400),
 *   - `x-api-key` + `anthropic-version` headers rather than a
 *     bearer token,
 *   - `max_tokens` as a REQUIRED field,
 *   - a `content` array of typed blocks in the response, not
 *     `choices[0].message.content`.
 *
 * So this file is a translation layer, not a copy of GroqProvider
 * with a different URL. Everything else — priority, failover,
 * memory/context injection, streaming into the UI — is the
 * existing machinery, unchanged.
 *
 * WHY RAW HTTP AND NOT @anthropic-ai/sdk
 * --------------------------------------
 * The official SDK opens its own connection to api.anthropic.com
 * with a key it holds. In a browser that means either shipping the
 * key in the bundle (the exact leak `plugins/aiProxyApi.ts` exists
 * to close) or `dangerouslyAllowBrowser` — both unacceptable here.
 * Every other provider already reaches its upstream through
 * `providerFetch`, so the credential stays on the server and the
 * request goes same-origin. This provider does the same, which is
 * why it speaks the wire format directly.
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { providerFetch, relayAvailable } from "./aiRelay";

/** Pinned per Anthropic's versioning contract — required on every request. */
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

export default class AnthropicProvider implements AIProvider {
  readonly name = "Anthropic";
  readonly priority = 1;
  readonly enabled = true;
  readonly timeout = 120000;
  readonly requiresApiKey = true;
  readonly capabilities = ["chat", "reasoning", "memory", "vision", "code"] as const;

  private apiKey = "";
  /** True when the SERVER holds the credential (see providers/aiRelay.ts). */
  private relay = false;
  private initialized = false;
  private model = "claude-opus-5";

  async initialize(): Promise<void> {
    const runtimeEnv = globalThis as typeof globalThis & {
      __LELU_ANTHROPIC_API_KEY__?: string;
      __LELU_ANTHROPIC_MODEL__?: string;
    };

    const windowEnv =
      typeof window !== "undefined"
        ? (window as Window & { __LELU_ANTHROPIC_API_KEY__?: string })
        : undefined;

    this.model =
      import.meta.env.VITE_ANTHROPIC_MODEL?.trim() ||
      runtimeEnv.__LELU_ANTHROPIC_MODEL__?.trim() ||
      "claude-opus-5";

    // NOT read from import.meta.env: Vite inlines VITE_* values into the
    // client bundle. A key held HERE only comes from a runtime that
    // injected one deliberately (verification scripts, a native shell);
    // otherwise the request is relayed and the SERVER attaches it.
    //
    // Deliberately NOT falling back to a bare `API_KEY`: that name is
    // generic, and in a Claude Code environment it holds the AGENT's own
    // Anthropic credential. Silently adopting it would spend someone
    // else's quota and make this provider report itself configured when
    // nothing was ever set for LÉLU — the same trap GitHubModelsProvider
    // documents avoiding with an ambient GITHUB_TOKEN.
    this.apiKey =
      runtimeEnv.__LELU_ANTHROPIC_API_KEY__?.trim() ||
      windowEnv?.__LELU_ANTHROPIC_API_KEY__?.trim() ||
      "";

    this.relay = this.apiKey ? false : await relayAvailable("anthropic");

    this.initialized = true;

    console.info("[AnthropicProvider] Initialized", {
      // Never the key or its length — only whether one is reachable.
      credential: this.apiKey ? "local" : this.relay ? "server-relay" : "none",
      model: this.model,
    });
  }

  async isAvailable(): Promise<boolean> {
    return this.initialized && this.enabled && (this.apiKey.length > 0 || this.relay);
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();

    return {
      available,
      initialized: this.initialized,
      lastChecked: Date.now(),
      lastError: !this.initialized
        ? "Anthropic provider not initialized."
        : !this.apiKey && !this.relay
          ? "No Anthropic credential — set ANTHROPIC_API_KEY on the server."
          : undefined,
    };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  /**
   * Split LÉLU's single OpenAI-style message array into the two things
   * the Messages API wants: one top-level system string, and a
   * user/assistant-only conversation.
   *
   * Anthropic requires the first message to be `user`. LÉLU's history can
   * legitimately begin with an assistant turn (a proactive greeting), so
   * a leading assistant message is dropped rather than sent — sending it
   * is a 400 and would take the provider out of the chain entirely.
   */
  private buildPayload(request: AIRequest): Record<string, unknown> {
    const systemParts: string[] = [LELU_SYSTEM_PROMPT];
    const conversation: Array<{ role: "user" | "assistant"; content: unknown }> = [];

    for (const message of contextMessages(request)) {
      systemParts.push(message.content);
    }

    for (const message of request.messages ?? []) {
      if (message.role === "system") {
        systemParts.push(message.content);
        continue;
      }
      conversation.push({ role: message.role, content: message.content });
    }

    // The latest prompt, with any attached images as typed blocks.
    const images = (request.media ?? []).filter(
      (media) => media.kind === "image" && media.dataUrl.startsWith("data:"),
    );
    if (images.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      for (const image of images) {
        // "data:image/png;base64,AAAA" → media_type + raw base64
        const match = image.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) continue;
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        });
      }
      blocks.push({ type: "text", text: request.prompt });
      conversation.push({ role: "user", content: blocks });
    } else {
      conversation.push({ role: "user", content: request.prompt });
    }

    while (conversation.length > 0 && conversation[0].role !== "user") {
      conversation.shift();
    }

    return {
      model: request.model?.trim() || this.model,
      system: systemParts.filter((part) => part.trim().length > 0).join("\n\n"),
      messages: conversation,
      // Required by the Messages API. Streaming turns lift the cap because
      // the HTTP-timeout concern that motivates a lower non-streaming
      // default does not apply once bytes are flowing.
      max_tokens: request.maxTokens ?? (request.onDelta ? 64000 : 16000),
      ...(request.stop?.length ? { stop_sequences: request.stop } : {}),
      ...(request.onDelta ? { stream: true } : {}),
    };
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();

    if (!this.initialized) {
      throw new Error("Anthropic provider is not initialized.");
    }

    if (!this.apiKey && !this.relay) {
      throw new Error("Anthropic has no credential — set ANTHROPIC_API_KEY on the server.");
    }

    const payload = this.buildPayload(request);

    let response: Response;

    try {
      // Same upstream call as every other provider: with no local key the
      // request goes same-origin to /api/ai/relay and the SERVER attaches
      // the credential. Anthropic authenticates with `x-api-key`, not a
      // bearer token, which the relay's per-provider auth builder handles.
      response = await providerFetch("anthropic", "https://api.anthropic.com/v1/messages", {
        apiKey: this.apiKey,
        headers: { "anthropic-version": ANTHROPIC_VERSION },
        body: payload,
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Anthropic network error: ${message}`);
    }

    if (payload.stream) {
      return await this.generateStreamed(
        response,
        started,
        String(payload.model),
        request.onDelta!,
      );
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

    // A refusal is HTTP 200 with no usable text. Throwing keeps it honest
    // and lets the next provider in the chain answer, rather than handing
    // the user an empty bubble.
    if (data?.stop_reason === "refusal") {
      const details = data?.stop_details as { category?: string } | undefined;
      throw new Error(
        `Anthropic declined this request${details?.category ? ` (${details.category})` : ""}.`,
      );
    }

    const blocks = (data?.content as AnthropicContentBlock[] | undefined) ?? [];
    const content = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    if (!content) {
      throw new Error("Anthropic returned no usable content.");
    }

    return {
      text: content,
      provider: this.name,
      model: String(data?.model ?? payload.model),
      processingTime: Date.now() - started,
      metadata: {
        usage: data?.usage,
        finishReason: data?.stop_reason,
      },
    };
  }

  /**
   * Consume Anthropic's SSE stream. The event shape differs from the
   * OpenAI-compatible providers: text arrives as `content_block_delta`
   * events carrying `delta.text`, and an error can appear mid-stream as
   * an `error` event after a 200, so that case is surfaced as a real
   * failure rather than a truncated answer.
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
          (data?.message as string) ||
          raw ||
          apiMessage;
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
    let stopReason: string | undefined;
    let streamError: string | null = null;

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr) return;
      try {
        const event = JSON.parse(dataStr) as {
          type?: string;
          delta?: { type?: string; text?: string; stop_reason?: string };
          usage?: unknown;
          message?: { usage?: unknown };
          error?: { message?: string };
        };
        if (event.type === "error") {
          streamError = event.error?.message ?? "Anthropic stream error.";
          return;
        }
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          const text = event.delta.text;
          if (typeof text === "string" && text.length > 0) {
            content += text;
            onDelta(content);
          }
          return;
        }
        if (event.type === "message_delta") {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          if (event.usage) usage = event.usage;
          return;
        }
        if (event.type === "message_start" && event.message?.usage) {
          usage = event.message.usage;
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

    if (streamError) {
      throw new Error(`Anthropic stream failed: ${streamError}`);
    }

    if (stopReason === "refusal") {
      throw new Error("Anthropic declined this request.");
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
        finishReason: stopReason,
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
