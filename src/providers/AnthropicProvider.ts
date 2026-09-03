/**
 * ==========================================================
 * LÉLU
 * ANTHROPIC PROVIDER
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { endpointUrl } from "../core/Endpoints";

type MessageContent = string | Array<Record<string, unknown>>;

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
  readonly requiresApiKey = true;
  readonly capabilities = ["chat", "reasoning", "vision", "memory"] as const;

  private apiKey = "";
  private initialized = false;
  private model = "claude-sonnet-4-5";

  async initialize(): Promise<void> {
    const runtimeEnv = globalThis as typeof globalThis & {
      __LELU_ANTHROPIC_API_KEY__?: string;
      __LELU_ANTHROPIC_MODEL__?: string;
    };

    const windowEnv =
      typeof window !== "undefined"
        ? (window as Window & { __LELU_ANTHROPIC_API_KEY__?: string })
        : undefined;

    const processEnv =
      typeof process !== "undefined" ? process.env : undefined;

    this.model =
      import.meta.env.VITE_ANTHROPIC_MODEL?.trim() ||
      runtimeEnv.__LELU_ANTHROPIC_MODEL__?.trim() ||
      "claude-sonnet-4-5";

    this.apiKey =
      import.meta.env.VITE_ANTHROPIC_API_KEY?.trim() ||
      runtimeEnv.__LELU_ANTHROPIC_API_KEY__?.trim() ||
      windowEnv?.__LELU_ANTHROPIC_API_KEY__?.trim() ||
      processEnv?.ANTHROPIC_API_KEY?.trim() ||
      processEnv?.CLAUDE_API_KEY?.trim() ||
      "";

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
      turns.push({ role: message.role, content: message.content });
    }

    turns.push({ role: "user", content: this.buildUserContent(request) });

    // Drop any leading assistant turn, then collapse consecutive
    // same-role turns so the alternation the API requires holds.
    while (turns.length > 0 && turns[0].role === "assistant") turns.shift();

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
      max_tokens: request.maxTokens ?? 2048,
      system,
      messages,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stop?.length ? { stop_sequences: request.stop } : {}),
      ...(request.onDelta ? { stream: true } : {}),
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
        signal: AbortSignal.timeout(this.timeout),
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

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Anthropic returned no usable content.");
    }

    const processingTime = Date.now() - started;

    return {
      text: content.trim(),
      provider: this.name,
      model: payload.model,
      processingTime,
      metadata: {
        usage: data?.usage,
        finishReason: (data?.stop_reason as string) || undefined,
      },
    };
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
