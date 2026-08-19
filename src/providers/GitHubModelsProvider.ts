/**
 * ==========================================================
 * LÉLU
 * GITHUB MODELS PROVIDER
 * ==========================================================
 *
 * Important:
 * - This provider never returns a fake success response.
 * - Authentication / HTTP / empty-response failures are thrown
 *   so ProviderResolver can continue to Groq or another provider.
 * - GitHub Models uses the official inference endpoint unless
 *   VITE_AI_PROXY_BASE_URL is explicitly configured.
 */

import type AIProvider from "./AIProvider";

import type {
  AIRequest,
  AIResponse,
  AIProviderHealth,
} from "./AIProvider";

export default class GitHubModelsProvider implements AIProvider {
  readonly name = "GitHub Models";
  readonly priority = 10;
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
  private model = "openai/gpt-4o";
  private initialized = false;

  async initialize(): Promise<void> {
    const runtimeEnv =
      globalThis as typeof globalThis & {
        __LELU_GITHUB_TOKEN__?: string;
        __LELU_GITHUB_MODEL__?: string;
      };

    const windowEnv =
      typeof window !== "undefined"
        ? (window as Window & {
            __LELU_GITHUB_TOKEN__?: string;
          })
        : undefined;

    const processEnv =
      typeof process !== "undefined"
        ? process.env
        : undefined;

    this.apiKey =
      import.meta.env.VITE_GITHUB_TOKEN?.trim() ||
      runtimeEnv.__LELU_GITHUB_TOKEN__?.trim() ||
      windowEnv?.__LELU_GITHUB_TOKEN__?.trim() ||
      processEnv?.GITHUB_TOKEN?.trim() ||
      processEnv?.GITHUB_CODESPACE_TOKEN?.trim() ||
      "";

    this.model =
      import.meta.env.VITE_GITHUB_MODEL?.trim() ||
      runtimeEnv.__LELU_GITHUB_MODEL__?.trim() ||
      "openai/gpt-4o";

    this.initialized = true;

    console.info("[GitHubModelsProvider] Initialized", {
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
        ? "GitHub Models provider not initialized."
        : !this.apiKey
          ? "GitHub Models token missing."
          : undefined,
    };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  async generate(
    request: AIRequest,
  ): Promise<AIResponse> {
    const started = Date.now();

    if (!this.initialized) {
      throw new Error(
        "GitHub Models provider is not initialized.",
      );
    }

    if (!this.apiKey) {
      throw new Error(
        "GitHub Models token missing.",
      );
    }

    const messages = [
      {
        role: "system",
        content:
          "You are Lélu. You are calm, creative, engineering-focused, and a personal AI companion. Keep responses helpful and concise.",
      },

      ...(request.context
        ? [
            {
              role: "system",
              content: `Memory context:\n${request.context}`,
            },
          ]
        : []),

      ...(request.messages ?? []),

      {
        role: "user",
        content: request.prompt,
      },
    ];

    const payload = {
      model: request.model?.trim() || this.model,
      messages,
      temperature: request.temperature ?? 0.7,
      ...(request.maxTokens
        ? { max_tokens: request.maxTokens }
        : {}),
      ...(request.stop?.length
        ? { stop: request.stop }
        : {}),
    };

    const proxyEndpoint =
      import.meta.env.VITE_AI_PROXY_BASE_URL?.trim();

    const endpoint =
      proxyEndpoint ||
      "https://models.github.ai/inference/chat/completions";

    console.info(
      "[GitHubModelsProvider] Sending request",
      {
        endpoint,
        model: this.model,
        hasMemory: Boolean(request.context),
        messages: messages.length,
      },
    );

    let response: Response;

    try {
      response = await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },

          body: JSON.stringify(payload),

          signal: AbortSignal.timeout(
            this.timeout,
          ),
        },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        "[GitHubModelsProvider] Network request failed",
        {
          endpoint,
          message,
        },
      );

      throw new Error(
        `GitHub Models network error: ${message}`,
      );
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
        "[GitHubModelsProvider] Request failed",
        {
          status: response.status,
          statusText: response.statusText,
          message: apiMessage,
          model: this.model,
        },
      );

      throw new Error(
        `GitHub Models HTTP ${response.status}: ${apiMessage}`,
      );
    }

    const content =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      "";

    if (
      typeof content !== "string" ||
      !content.trim()
    ) {
      console.error(
        "[GitHubModelsProvider] Empty model response",
        {
          model: this.model,
          response: data,
        },
      );

      throw new Error(
        "GitHub Models returned no usable content.",
      );
    }

    return {
      text: content.trim(),
      provider: this.name,
      model: payload.model,
      processingTime:
        Date.now() - started,
      metadata: {
        usage: data?.usage,
        finishReason:
          data?.choices?.[0]?.finish_reason,
      },
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.apiKey = "";

    console.info(
      "[GitHubModelsProvider] Shutdown",
    );
  }
}