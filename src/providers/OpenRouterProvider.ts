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
import {
  extractOpenAIToolCalls,
  extractOpenAIText,
  describeEmptyChoice,
  openAIToolPayload,
  toOpenAIMessages,
  trailingUserTurn,
  readOpenAIStream,
} from "./openaiTools";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";

import type {
  AIRequest,
  AIResponse,
  AIProviderHealth,
} from "./AIProvider";
import { endpointUrl } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";

/** Free, image-capable on OpenRouter at the time of writing (see selectModel). */
export const DEFAULT_VISION_MODEL = "google/gemma-4-31b-it:free";

/**
 * What an auto route resolves to when nothing concrete is configured.
 *
 * Verified live through the broker against this credential: 200, and a real
 * `tool_calls` array in the body (not just prose about tools).
 */
export const DEFAULT_COMPAT_MODEL = "openai/gpt-4o-mini";

/** Model ids that delegate the choice to OpenRouter's own pricing rules. */
const AUTO_ROUTES = new Set(["openrouter/auto", "openrouter/free", "auto", "free"]);
import { authHeaders, isBrokered, providerConfigured } from "../core/model/BrokerTransport";
import { resolveModel } from "../core/ProviderModels";

import ProviderKeyRing from "../core/model/ProviderKeyRing";

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

  readonly supportsTools = true;

  private apiKey = "";
  private model = resolveModel("openrouter");
  private initialized = false;

  /** The configured model when it names one, else the verified default. */
  private concreteModel(): string {
    return AUTO_ROUTES.has(this.model.toLowerCase()) ? DEFAULT_COMPAT_MODEL : this.model;
  }

  /**
   * Pick a model for this request. With visual media attached a
   * vision-capable model is required — the configured model wins if
   * it already supports vision, otherwise a known free vision model
   * is used. Text-only requests keep the configured model exactly
   * as before.
   */
  /**
   * Route aliases that choose by PRICE rather than by capability.
   *
   * `openrouter/auto` and `openrouter/free` do not name a model; they ask
   * OpenRouter to pick one, and on an account without credit the pick is the
   * free tier — which refuses the whole turn with "free-models-per-day …
   * credits to unlock 1000 free model requests per day", measured live while
   * this same credential answered 200 with real tool_calls on
   * openai/gpt-4o-mini. A request that names no capability cannot be sized or
   * verified, so an alias is resolved to a concrete configured model here.
   */
  private selectModel(request: AIRequest): string {
    const requested = request.model?.trim() || this.model;
    if (!request.media?.length) {
      return AUTO_ROUTES.has(requested.toLowerCase()) ? this.concreteModel() : requested;
    }
    const lower = requested.toLowerCase();
    if (lower.includes("vision") || lower.includes("llava")) {
      return requested;
    }
    // Configurable, because free vision models come and go: the previous
    // hard-coded "meta-llama/llama-3.2-11b-vision-instruct:free" was retired
    // (OpenRouter 404, observed 2026-11-07) and every image turn routed here
    // failed. The default is one OpenRouter listed as free + image-capable.
    return resolveFirst("OPENROUTER_VISION_MODEL")?.trim() || DEFAULT_VISION_MODEL;
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
      resolveModel("openrouter");

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
      providerConfigured("openrouter", this.apiKey)
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
        : !isBrokered("openrouter") && !this.apiKey
          ? "OpenRouter API key missing."
          : undefined,
    };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  /**
   * Send one payload, rotating across the configured OpenRouter accounts.
   *
   * Each account has its own free-model allowance, so a 401/403/429 that one
   * account reports may be nothing to the next. The request itself does not
   * change: model routing and preferences are preserved exactly. When every
   * configured slot is cooling, the last response is returned and the caller
   * reports it — the account-level cooldown stays the registry's job.
   */
  private async post(payload: unknown, request: AIRequest, deadline: AbortSignal): Promise<Response> {
    const broker = isBrokered("openrouter");
    const ring = ProviderKeyRing.for("openrouter");
    const slots = broker ? 1 : Math.max(1, Math.min(ring.size(), 4));
    let last: Response | null = null;
    let lastError: unknown;

    for (let attempt = 0; attempt < slots; attempt += 1) {
      const credential = broker ? null : ring.next();
      const key = credential?.key ?? this.apiKey;
      if (!key && !broker) break;
      try {
        const response = await fetch(endpointUrl("openrouter", "chat/completions"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            // Brokered: no credential leaves the browser — the server attaches
            // its own. Direct (server/tests): the real header.
            ...authHeaders("openrouter", key, (value) => ({ Authorization: `Bearer ${value}` })),
            "HTTP-Referer":
              typeof window !== "undefined"
                ? window.location.origin
                : "https://freebuff.com",
            "X-Title": "Lélu",
          },
          body: JSON.stringify(payload),
          signal: request.signal ? AbortSignal.any([request.signal, deadline]) : deadline,
        });
        if (response.ok) {
          if (credential) ring.markSuccess(credential.label);
          return response;
        }
        const reason = await response.clone().text().catch(() => "");
        const retryable = response.status === 401 || response.status === 403 || response.status === 429;
        if (credential) {
          ring.markFailure(credential.label, reason || `HTTP ${response.status}`);
        }
        if (retryable && ring.readyCount() > 0) {
          last = response;
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (credential) {
          ring.markFailure(credential.label, error instanceof Error ? error.message : String(error));
        }
      }
    }

    if (last) return last;
    throw lastError ?? new Error("OpenRouter: no usable credential.");
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();

    if (!this.initialized) {
      throw new Error("OpenRouter provider is not initialized.");
    }

    if (!isBrokered("openrouter") && !this.apiKey) {
      // Only a DIRECT send needs a key here; brokered requests carry
      // none by design, and refusing them would disable the provider
      // the broker can actually serve.
      throw new Error("OpenRouter API key is missing.");
    }

    const messages = [
      {
        role: "system",
        content:
          LELU_SYSTEM_PROMPT,
      },
      ...contextMessages(request),
      ...toOpenAIMessages(request.messages),
      ...trailingUserTurn(request, this.buildUserContent(request)),
    ];

    const payload = {
      model: this.selectModel(request),
      messages,
      ...openAIToolPayload(request),
      temperature: request.temperature ?? 0.7,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop?.length ? { stop: request.stop } : {}),
      // Stream whenever the turn wants progressive text — tool calls
      // included (readOpenAIStream assembles them).
      ...(request.onDelta ? { stream: true } : {}),
    };

    let response: Response;
    // The provider's own cap must never be SHORTER than the budget the
    // resolver gives this attempt: measured in the Mission 10.3 20-turn run,
    // a 30 s cap under a 45 s rung budget cut every long answer off as
    // "BodyStreamBuffer was aborted" — and that reached the person as
    // "all providers unreachable". The resolver's rung signal still bounds it.
    const timeoutMs = Math.max(this.timeout, Number(resolveFirst("LELU_PROVIDER_RUNG_BUDGET_MS")) || 0);
    const deadline = AbortSignal.timeout(timeoutMs);
    const timedOut = () => deadline.aborted && !request.signal?.aborted;

    try {
      response = await this.post(payload, request, deadline);
    } catch (error) {
      if (timedOut()) throw new Error(`OpenRouter timed out after ${Math.round(timeoutMs / 1000)}s.`);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenRouter network error: ${message}`);
    }

    if (payload.stream) {
      let streamed: Awaited<ReturnType<typeof readOpenAIStream>>;
      try {
        streamed = await readOpenAIStream(response, "OpenRouter", request.onDelta!);
      } catch (error) {
        // Name a timeout as a timeout, not as the stream's internal abort.
        if (timedOut()) throw new Error(`OpenRouter timed out after ${Math.round(timeoutMs / 1000)}s while answering.`);
        throw error;
      }
      if (!streamed.text.trim() && streamed.toolCalls.length === 0) {
        throw new Error("OpenRouter returned no usable content.");
      }
      return {
        text: streamed.text.trim(),
        provider: this.name,
        model: payload.model,
        processingTime: Date.now() - started,
        ...(streamed.toolCalls.length ? { toolCalls: streamed.toolCalls } : {}),
        stopReason: streamed.finishReason,
        metadata: { usage: streamed.usage, finishReason: streamed.finishReason, streamed: true },
      };
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

    const content = extractOpenAIText(data?.choices?.[0]);
    const toolCalls = extractOpenAIToolCalls(data?.choices?.[0]);
    // A tool-call turn legitimately carries no text. Rejecting it as
    // "no usable content" would turn a valid tool request into a
    // provider failure and drop to the next provider for no reason.
    if ((typeof content !== "string" || !content.trim()) && toolCalls.length === 0) {
      throw new Error(describeEmptyChoice("OpenRouter", data?.choices?.[0]));
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
