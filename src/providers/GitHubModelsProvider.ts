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
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { providerFetch, relayAvailable } from "./aiRelay";

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
  /** True when the SERVER holds the credential (see providers/aiRelay.ts). */
  private relay = false;
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

    // Deliberately NOT falling back to bare process.env.GITHUB_TOKEN /
    // GITHUB_CODESPACE_TOKEN: those are ambient credentials that dev
    // containers, Codespaces and CI runners set for git/gh tooling —
    // not a user-supplied GitHub Models API key. Silently adopting them
    // here made this provider falsely report "available" (and would
    // spend a repo-scoped token against an unrelated inference API)
    // whenever LÉLU happened to run inside such an environment, with
    // no key ever actually configured for it. Only the two explicit,
    // documented configuration channels count (see ENV_VARS.md).
    // NOT read from import.meta.env: Vite inlines VITE_* values into the
    // client bundle, which is how provider keys ended up shipped to the
    // browser. A key held HERE only comes from a runtime that injected
    // one deliberately (verification scripts, a native shell); otherwise
    // the request is relayed and the SERVER attaches the credential.
    this.apiKey =
      runtimeEnv.__LELU_GITHUB_TOKEN__?.trim() ||
      windowEnv?.__LELU_GITHUB_TOKEN__?.trim() ||
      "";

    this.model =
      import.meta.env.VITE_GITHUB_MODEL?.trim() ||
      runtimeEnv.__LELU_GITHUB_MODEL__?.trim() ||
      "openai/gpt-4o";

    // No local key is the NORMAL production case now: the credential
    // belongs on the server so it never enters the client bundle.
    this.relay = this.apiKey ? false : await relayAvailable("githubmodels");

    this.initialized = true;

    console.info("[GitHubModelsProvider] Initialized", {
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
        ? "GitHub Models provider not initialized."
        : !this.apiKey && !this.relay
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

    if (!this.apiKey && !this.relay) {
      throw new Error(
        "GitHub Models token missing.",
      );
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
      // Same upstream call as before. When no key is held locally the
      // request goes same-origin to /api/ai/relay and the SERVER attaches
      // the credential — status and body come back verbatim, so the
      // parsing and fallback behaviour below is unchanged.
      //
      // An explicit VITE_AI_PROXY_BASE_URL is honoured as-is: that
      // deployment already has its own credential-bearing proxy in
      // front, so relaying it again would be wrong. Passing the key
      // through keeps that path byte-for-byte what it was.
      response = proxyEndpoint
        ? await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(this.timeout),
          })
        : await providerFetch("githubmodels", endpoint, {
            apiKey: this.apiKey,
            body: payload,
            signal: AbortSignal.timeout(this.timeout),
          });
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