/**
 * ==========================================================
 * LÉLU
 * FIREWORKS PROVIDER
 * ==========================================================
 *
 * OpenAI-compatible chat provider, registered in the same
 * priority fallback chain as Groq/OpenRouter/Cerebras/Mistral
 * (ProviderResolver tries providers in priority order and
 * falls through on failure). The key is read from the same
 * sources every other provider reads: VITE_* env, the
 * __LELU_*__ runtime globals the platform's Keys UI injects,
 * or process.env. Never returns fake success — throws on
 * failure so the next provider in the chain is tried.
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import {
  extractOpenAIToolCalls,
  openAIToolPayload,
  toOpenAIMessages,
  trailingUserTurn,
} from "./openaiTools";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { endpointUrl } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";

export default class FireworksProvider implements AIProvider {
  readonly name = "Fireworks";
  readonly priority = 5;
  readonly enabled = true;
  readonly timeout = 30000;
  readonly requiresApiKey = true;

  readonly capabilities = [
    "chat",
    "reasoning",
    "fast",
    "memory",
  ] as const;

  readonly supportsTools = true;

  private apiKey = "";
  private model = "accounts/fireworks/models/llama-v3p1-70b-instruct";
  private initialized = false;

  async initialize(): Promise<void> {
    this.apiKey =
      resolveFirst("FIREWORKS_API_KEY") ?? "";
    this.model =
      resolveFirst("FIREWORKS_MODEL") ?? "accounts/fireworks/models/llama-v3p1-70b-instruct";

    this.initialized = true;

    console.info("[FireworksProvider] Initialized", {
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
        ? "Fireworks provider not initialized."
        : !this.apiKey
          ? "Fireworks API key missing."
          : undefined,
    };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();

    if (!this.initialized) {
      throw new Error("Fireworks provider is not initialized.");
    }

    if (!this.apiKey) {
      throw new Error("Fireworks API key is missing.");
    }

    const messages = [
      { role: "system", content: LELU_SYSTEM_PROMPT },
      ...contextMessages(request),
      ...toOpenAIMessages(request.messages),
      ...trailingUserTurn(request, request.prompt),
    ];

    const payload = {
      model: request.model?.trim() || this.model,
      messages,
      ...openAIToolPayload(request),
      temperature: request.temperature ?? 0.7,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop?.length ? { stop: request.stop } : {}),
    };

    let response: Response;

    try {
      response = await fetch(
        endpointUrl("fireworks", "chat/completions"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Fireworks network error: ${message}`);
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

      console.error(
        "[FireworksProvider] API request failed",
        {
          status: response.status,
          message: apiMessage,
          model: this.model,
        },
      );

      throw new Error(`Fireworks HTTP ${response.status}: ${apiMessage}`);
    }

    const content = data?.choices?.[0]?.message?.content ?? "";
    const toolCalls = extractOpenAIToolCalls(data?.choices?.[0]);
    // A tool-call turn legitimately carries no text. Rejecting it as
    // "no usable content" would turn a valid tool request into a
    // provider failure and drop to the next provider for no reason.
    if ((typeof content !== "string" || !content.trim()) && toolCalls.length === 0) {
      throw new Error("Fireworks returned no usable content.");
    }

    return {
      text: content.trim(),
      provider: this.name,
      model: payload.model,
      processingTime: Date.now() - started,
      ...(toolCalls.length ? { toolCalls } : {}),
      stopReason: data?.choices?.[0]?.finish_reason as string | undefined,
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
