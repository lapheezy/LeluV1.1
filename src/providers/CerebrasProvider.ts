/**
 * ==========================================================
 * LÉLU
 * CEREBRAS PROVIDER
 * ==========================================================
 *
 * OpenAI-compatible chat provider, registered in the same
 * priority fallback chain as Groq/OpenRouter (ProviderResolver
 * tries providers in priority order and falls through on
 * failure). The key is read from the exact same sources every
 * other provider reads: VITE_* env, the __LELU_*__ runtime
 * globals the platform's Keys UI injects, or process.env.
 * Never returns fake success — throws on failure so the next
 * provider in the chain is tried.
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { providerFetch, relayAvailable } from "./aiRelay";

export default class CerebrasProvider implements AIProvider {
  readonly name = "Cerebras";
  readonly priority = 3;
  readonly enabled = true;
  readonly timeout = 30000;
  readonly requiresApiKey = true;

  readonly capabilities = [
    "chat",
    "reasoning",
    "fast",
    "memory",
  ] as const;

  private apiKey = "";
  /** True when the SERVER holds the credential (see providers/aiRelay.ts). */
  private relay = false;
  private model = "llama-3.3-70b";
  private initialized = false;

  async initialize(): Promise<void> {
    const runtimeEnv =
      globalThis as typeof globalThis & {
        __LELU_CEREBRAS_API_KEY__?: string;
        __LELU_CEREBRAS_MODEL__?: string;
      };

    const windowEnv =
      typeof window !== "undefined"
        ? (window as Window & { __LELU_CEREBRAS_API_KEY__?: string })
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
      runtimeEnv.__LELU_CEREBRAS_API_KEY__?.trim() ||
      windowEnv?.__LELU_CEREBRAS_API_KEY__?.trim() ||
      processEnv?.CEREBRAS_API_KEY?.trim() ||
      "";

    this.model =
      import.meta.env.VITE_CEREBRAS_MODEL?.trim() ||
      runtimeEnv.__LELU_CEREBRAS_MODEL__?.trim() ||
      "llama-3.3-70b";

    // No local key is the NORMAL production case now: the credential
    // belongs on the server so it never enters the client bundle.
    this.relay = this.apiKey ? false : await relayAvailable("cerebras");

    this.initialized = true;

    console.info("[CerebrasProvider] Initialized", {
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
        ? "Cerebras provider not initialized."
        : !this.apiKey && !this.relay
          ? "Cerebras API key missing."
          : undefined,
    };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();

    if (!this.initialized) {
      throw new Error("Cerebras provider is not initialized.");
    }

    if (!this.apiKey && !this.relay) {
      throw new Error("Cerebras API key is missing.");
    }

    const messages = [
      { role: "system", content: LELU_SYSTEM_PROMPT },
      ...contextMessages(request),
      ...(request.messages ?? []),
      { role: "user", content: request.prompt },
    ];

    const payload = {
      model: request.model?.trim() || this.model,
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
      // parsing and fallback behaviour below is unchanged.
      response = await providerFetch(
        "cerebras",
        "https://api.cerebras.ai/v1/chat/completions",
        {
          apiKey: this.apiKey,
          body: payload,
          signal: AbortSignal.timeout(this.timeout),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cerebras network error: ${message}`);
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
        "[CerebrasProvider] API request failed",
        {
          status: response.status,
          message: apiMessage,
          model: this.model,
        },
      );

      throw new Error(`Cerebras HTTP ${response.status}: ${apiMessage}`);
    }

    const content = data?.choices?.[0]?.message?.content ?? "";

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Cerebras returned no usable content.");
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
