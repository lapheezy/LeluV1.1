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
import {
  extractOpenAIToolCalls,
  openAIToolPayload,
  toOpenAIMessages,
  trailingUserTurn,
} from "./openaiTools";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";

import type {
  AIRequest,
  AIResponse,
  AIProviderHealth,
} from "./AIProvider";
import { endpointUrl } from "../core/Endpoints";
import { resolveFirst, resolveViteOnly } from "../core/resolveEnv";

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

  readonly supportsTools = true;

  private apiKey = "";
  private model = "openai/gpt-4o";
  private initialized = false;

  async initialize(): Promise<void> {
    // Deliberately NOT falling back to bare process.env.GITHUB_TOKEN /
    // GITHUB_CODESPACE_TOKEN: those are ambient credentials that dev
    // containers, Codespaces and CI runners set for git/gh tooling —
    // not a user-supplied GitHub Models API key. Silently adopting them
    // here made this provider falsely report "available" (and would
    // spend a repo-scoped token against an unrelated inference API)
    // whenever LÉLU happened to run inside such an environment, with
    // no key ever actually configured for it. Only the two explicit,
    // documented configuration channels count (see ENV_VARS.md).
    // resolveViteOnly walks the same two documented channels and, unlike
    // the chain it replaces, does not throw when import.meta.env is
    // undefined — which it is in every non-Vite runtime.
    this.apiKey = resolveViteOnly("GITHUB_TOKEN") ?? "";
    this.model =
      resolveFirst("GITHUB_MODEL") ?? "openai/gpt-4o";

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
          LELU_SYSTEM_PROMPT,
      },

      ...contextMessages(request),

      ...toOpenAIMessages(request.messages),

      ...trailingUserTurn(
        request,
        request.prompt,
      ),
    ];

    const payload = {
      model: request.model?.trim() || this.model,
      messages,
      ...openAIToolPayload(request),
      temperature: request.temperature ?? 0.7,
      ...(request.maxTokens
        ? { max_tokens: request.maxTokens }
        : {}),
      ...(request.stop?.length
        ? { stop: request.stop }
        : {}),
    };

    const proxyEndpoint =
      resolveFirst("AI_PROXY_BASE_URL");

    const endpoint =
      proxyEndpoint ||
      endpointUrl("githubModels", "chat/completions");

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

    const toolCalls = extractOpenAIToolCalls(
      data?.choices?.[0],
    );

    // A tool-call turn legitimately carries no text. Rejecting it as
    // "no usable content" would turn a valid tool request into a
    // provider failure and drop to the next provider for no reason.
    if (
      (typeof content !== "string" ||
        !content.trim()) &&
      toolCalls.length === 0
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
      ...(toolCalls.length
        ? { toolCalls }
        : {}),
      stopReason:
        data?.choices?.[0]?.finish_reason,
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