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
 *
 * CODING TURNS (request.workload === "coding") run on the
 * dedicated coding model — FIREWORKS_CODING_MODEL, Kimi K3.1 Pro
 * by default (core/ProviderModels.ts) — with a longer time budget.
 * Every other turn uses FIREWORKS_MODEL, unchanged.
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import {
  extractOpenAIToolCalls,
  extractOpenAIText,
  describeEmptyChoice,
  openAIToolPayload,
  toOpenAIMessages,
  trailingUserTurn,
} from "./openaiTools";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { endpointUrl } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";
import { authHeaders, isBrokered, providerConfigured } from "../core/model/BrokerTransport";
import { resolveModel } from "../core/ProviderModels";

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
  private model = resolveModel("fireworks");
  private codingModel = resolveModel("fireworksCoding");
  private initialized = false;

  /**
   * 30s suits a chat turn. A coding turn on a large model, or any turn
   * replaying tool results, legitimately takes longer; cutting it off
   * loses the work and drops to the next provider having done none.
   */
  private timeoutFor(request: AIRequest): number {
    return request.workload === "coding" || request.tools?.length ? 180_000 : this.timeout;
  }

  /** Explicit model > coding model on coding turns > chat model. */
  private selectModel(request: AIRequest): string {
    const requested = request.model?.trim();
    if (requested) return requested;
    return request.workload === "coding" ? this.codingModel : this.model;
  }

  async initialize(): Promise<void> {
    this.apiKey =
      resolveFirst("FIREWORKS_API_KEY") ?? "";
    this.model =
      resolveModel("fireworks");
    this.codingModel =
      resolveModel("fireworksCoding");

    this.initialized = true;

    console.info("[FireworksProvider] Initialized", {
      hasKey: this.apiKey.length > 0,
      model: this.model,
      codingModel: this.codingModel,
    });
  }

  async isAvailable(): Promise<boolean> {
    return (
      this.initialized &&
      this.enabled &&
      this.requiresApiKey &&
      providerConfigured("fireworks", this.apiKey)
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
        : !isBrokered("fireworks") && !this.apiKey
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

    if (!isBrokered("fireworks") && !this.apiKey) {
      // Only a DIRECT send needs a key here; brokered requests carry
      // none by design, and refusing them would disable the provider
      // the broker can actually serve.
      throw new Error("Fireworks API key is missing.");
    }

    const messages = [
      { role: "system", content: LELU_SYSTEM_PROMPT },
      ...contextMessages(request),
      ...toOpenAIMessages(request.messages),
      ...trailingUserTurn(request, request.prompt),
    ];

    const payload = {
      model: this.selectModel(request),
      messages,
      ...openAIToolPayload(request),
      temperature: request.temperature ?? 0.7,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop?.length ? { stop: request.stop } : {}),
      // Real token streaming when the caller wants progressive output.
      // include_usage makes the final chunk carry real token counts.
      ...(request.onDelta ? { stream: true, stream_options: { include_usage: true } } : {}),
    };

    let response: Response;

    try {
      response = await fetch(
        endpointUrl("fireworks", "chat/completions"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: payload.stream ? "text/event-stream" : "application/json",
            // Brokered: no credential leaves the browser — the server attaches
            // its own. Direct (server/tests): the real header.
            ...authHeaders("fireworks", this.apiKey, (key) => ({ Authorization: `Bearer ${key}` })),
          },
          body: JSON.stringify(payload),
          signal: request.signal
            ? AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutFor(request))])
            : AbortSignal.timeout(this.timeoutFor(request)),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Fireworks network error: ${message}`);
    }

    if (payload.stream && response.ok && response.body) {
      return await this.generateStreamed(response, started, payload.model, request.onDelta!);
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
          model: payload.model,
        },
      );

      throw new Error(`Fireworks HTTP ${response.status}: ${apiMessage}`);
    }

    const content = extractOpenAIText(data?.choices?.[0]);
    const toolCalls = extractOpenAIToolCalls(data?.choices?.[0]);
    // A tool-call turn legitimately carries no text. Rejecting it as
    // "no usable content" would turn a valid tool request into a
    // provider failure and drop to the next provider for no reason.
    if ((typeof content !== "string" || !content.trim()) && toolCalls.length === 0) {
      throw new Error(describeEmptyChoice("Fireworks", data?.choices?.[0]));
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

  /**
   * Consume Fireworks' OpenAI-compatible SSE stream. Text deltas are
   * delivered ACCUMULATED via onDelta; tool-call deltas are assembled by
   * index and parsed through the same extractor as the non-streamed path,
   * so a streamed tool turn still executes its tools.
   */
  private async generateStreamed(
    response: Response,
    started: number,
    model: string,
    onDelta: (accumulated: string) => void,
  ): Promise<AIResponse> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: unknown;
    let finishReason: string | undefined;
    let chunks = 0;
    const calls: Array<{ id?: string; type: "function"; function: { name: string; arguments: string } }> = [];

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") return;
      let chunk: any;
      try {
        chunk = JSON.parse(dataStr);
      } catch {
        return; // keep-alive fragment
      }
      if (chunk?.error) {
        throw new Error(`Fireworks stream error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      }
      chunks += 1;
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta;
      if (typeof delta?.content === "string" && delta.content.length > 0) {
        content += delta.content;
        onDelta(content);
      }
      for (const part of delta?.tool_calls ?? []) {
        const index = typeof part.index === "number" ? part.index : calls.length;
        const slot = (calls[index] ??= { type: "function", function: { name: "", arguments: "" } });
        if (part.id) slot.id = part.id;
        if (part.function?.name) slot.function.name += part.function.name;
        if (part.function?.arguments) slot.function.arguments += part.function.arguments;
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
      throw new Error(message.startsWith("Fireworks") ? message : `Fireworks stream interrupted: ${message}`);
    }

    const assembled = { message: { content, tool_calls: calls.filter(Boolean) }, finish_reason: finishReason };
    const toolCalls = extractOpenAIToolCalls(assembled);
    if (!content.trim() && toolCalls.length === 0) {
      throw new Error(describeEmptyChoice("Fireworks", assembled));
    }

    return {
      text: content.trim(),
      provider: this.name,
      model,
      processingTime: Date.now() - started,
      ...(toolCalls.length ? { toolCalls } : {}),
      stopReason: finishReason,
      metadata: { usage, finishReason, streamed: true, chunks },
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.apiKey = "";
  }
}
