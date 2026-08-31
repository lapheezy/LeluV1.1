/**
 * ==========================================================
 * LÉLU
 * OPENROUTER PROVIDER
 * ==========================================================
 *
 * OpenRouter is the secondary conversational provider. It uses
 * the documented OpenAI-compatible chat-completions endpoint and
 * remains registered even when its credential is not configured.
 */

import type AIProvider from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { providerFetch, relayAvailable } from "./aiRelay";

import type {
  AIRequest,
  AIResponse,
  AIProviderHealth,
} from "./AIProvider";

export default class OpenRouterProvider implements AIProvider {
  readonly name = "OpenRouter";
  readonly priority = 2;
  readonly enabled = true;
  readonly timeout = 30000;
  readonly requiresApiKey = true;

  readonly capabilities = [
    "chat",
    "reasoning",
    "multi-model",
    "memory",
  ] as const;

  private apiKey = "";
  /** True when the SERVER holds the credential (see providers/aiRelay.ts). */
  private relay = false;
  private model = "openrouter/free";
  private initialized = false;

  /**
   * Pick a model for this request. With visual media attached a
   * vision-capable model is required — the configured model wins if
   * it already supports vision, otherwise a known free vision model
   * is used. Text-only requests keep the configured model exactly
   * as before.
   */
  private selectModel(request: AIRequest): string {
    const requested = request.model?.trim() || this.model;
    if (!request.media?.length) {
      return requested;
    }
    const lower = requested.toLowerCase();
    if (lower.includes("vision") || lower.includes("llava")) {
      return requested;
    }
    return "meta-llama/llama-3.2-11b-vision-instruct:free";
  }

  /**
   * Build the final user message content. Media turns it into an
   * OpenAI-style parts array (image_url + text); no media keeps the
   * plain string so every existing path is unchanged.
   */
  private buildUserContent(request: AIRequest): string | Array<Record<string, unknown>> {
    if (!request.media?.length) {
      return request.prompt;
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const media of request.media) {
      if (media.kind === "image" && media.dataUrl.startsWith("data:")) {
        parts.push({
          type: "image_url",
          image_url: { url: media.dataUrl },
        });
      }
    }
    parts.push({ type: "text", text: request.prompt });
    return parts;
  }

  async initialize(): Promise<void> {
    const runtimeEnv = globalThis as typeof globalThis & {
      __LELU_OPENROUTER_API_KEY__?: string;
      __LELU_OPENROUTER_MODEL__?: string;
    };

    const windowEnv =
      typeof window !== "undefined"
        ? (window as Window & {
            __LELU_OPENROUTER_API_KEY__?: string;
            __LELU_OPENROUTER_MODEL__?: string;
          })
        : undefined;

    const processEnv =
      typeof process !== "undefined"
        ? process.env
        : undefined;

    // NOT read from import.meta.env: Vite inlines VITE_* values into the
    // client bundle, which is how provider keys ended up shipped to the
    // browser. A key held HERE only comes from a runtime that injected
    // one deliberately (verification scripts, a native shell); otherwise
    // the request is relayed and the SERVER attaches the credential.
    this.apiKey =
      runtimeEnv.__LELU_OPENROUTER_API_KEY__?.trim() ||
      windowEnv?.__LELU_OPENROUTER_API_KEY__?.trim() ||
      processEnv?.OPENROUTER_API_KEY?.trim() ||
      "";

    this.model =
      import.meta.env.VITE_OPENROUTER_MODEL?.trim() ||
      runtimeEnv.__LELU_OPENROUTER_MODEL__?.trim() ||
      windowEnv?.__LELU_OPENROUTER_MODEL__?.trim() ||
      "openrouter/free";

    // No local key is the NORMAL production case now: the credential
    // belongs on the server so it never enters the client bundle.
    this.relay = this.apiKey ? false : await relayAvailable("openrouter");

    this.initialized = true;

    console.info("[OpenRouterProvider] Initialized", {
      // Never the key or its length — only whether one is reachable.
      credential: this.apiKey ? "local" : this.relay ? "server-relay" : "none",
      model: this.model,
    });
  }

  async isAvailable(): Promise<boolean> {
    return (
      this.initialized &&
      this.enabled &&
      (this.apiKey.length > 0 || this.relay)
    );
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();

    return {
      available,
      initialized: this.initialized,
      lastChecked: Date.now(),
      lastError: !this.initialized
        ? "OpenRouter provider not initialized."
        : !this.apiKey && !this.relay
          ? "OpenRouter API key missing."
          : undefined,
    };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();

    if (!this.initialized) {
      throw new Error("OpenRouter provider is not initialized.");
    }

    if (!this.apiKey && !this.relay) {
      throw new Error("OpenRouter API key is missing.");
    }

    const messages = [
      {
        role: "system",
        content:
          LELU_SYSTEM_PROMPT,
      },
      ...contextMessages(request),
      ...(request.messages ?? []),
      {
        role: "user",
        content: this.buildUserContent(request),
      },
    ];

    const payload = {
      model: this.selectModel(request),
      messages,
      temperature: request.temperature ?? 0.7,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop?.length ? { stop: request.stop } : {}),
    };

    let response: Response;

    try {
      // Same upstream call as before. When no key is held locally the
      // request goes same-origin to /api/ai/relay and the SERVER attaches
      // the credential — status and body come back verbatim, so the
      // parsing and fallback behaviour below is unchanged. HTTP-Referer
      // and X-Title are not secrets, so they ride along and the relay
      // forwards them (they are on its header allowlist).
      response = await providerFetch(
        "openrouter",
        "https://openrouter.ai/api/v1/chat/completions",
        {
          apiKey: this.apiKey,
          headers: {
            // `typeof window !== "undefined"` alone was not enough: any
            // runtime with a PARTIAL window (web worker, SSR/server
            // entry, embedded webview, test harness) has `window` but
            // no `window.location`, so reading `.origin` threw a
            // TypeError on every request. ProviderResolver caught it as
            // a provider failure, which silently and permanently took
            // the #2 priority provider out of the fallback chain in
            // those runtimes. Optional chaining keeps the real origin
            // in a real browser and falls back everywhere else.
            "HTTP-Referer":
              (typeof window !== "undefined" ? window.location?.origin : undefined) ??
              "https://freebuff.com",
            "X-Title": "Lélu",
          },
          body: payload,
          signal: AbortSignal.timeout(this.timeout),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenRouter network error: ${message}`);
    }

    const raw = await response.text();
    let data: any = null;

    if (raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const apiMessage =
        data?.error?.message ||
        data?.message ||
        raw ||
        `HTTP ${response.status}`;
      throw new Error(`OpenRouter HTTP ${response.status}: ${apiMessage}`);
    }

    const content = data?.choices?.[0]?.message?.content ?? "";

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OpenRouter returned no usable content.");
    }

    return {
      text: content.trim(),
      provider: this.name,
      model: payload.model,
      processingTime: Date.now() - started,
      metadata: {
        usage: data?.usage,
        finishReason: data?.choices?.[0]?.finish_reason,
      },
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.apiKey = "";
  }
}
