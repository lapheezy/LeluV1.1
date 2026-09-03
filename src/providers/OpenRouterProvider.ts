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

import type {
  AIRequest,
  AIResponse,
  AIProviderHealth,
} from "./AIProvider";
import { endpointUrl } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";

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
    this.apiKey =
      resolveFirst("OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY") ?? "";
    this.model =
      resolveFirst("OPENROUTER_MODEL") ?? "openrouter/free";

    this.initialized = true;

    console.info("[OpenRouterProvider] Initialized", {
      hasKey: this.apiKey.length > 0,
      model: this.model,
    });
  }

  async isAvailable(): Promise<boolean> {
    return (
      this.initialized &&
      this.enabled &&
      this.requiresApiKey &&
      this.apiKey.length > 0
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
        : !this.apiKey
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

    if (!this.apiKey) {
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
      response = await fetch(
        endpointUrl("openrouter", "chat/completions"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer":
              typeof window !== "undefined"
                ? window.location.origin
                : "https://freebuff.com",
            "X-Title": "Lélu",
          },
          body: JSON.stringify(payload),
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
