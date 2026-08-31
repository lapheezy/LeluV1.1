/**
 * ==========================================================
 * LÉLU
 * GROQ PROVIDER
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { providerFetch, relayAvailable } from "./aiRelay";

export default class GroqProvider implements AIProvider {
  readonly name = "Groq";
  readonly priority = 1;
  readonly enabled = true;
  readonly timeout = 30000;
  readonly requiresApiKey = true;
  readonly capabilities = ["chat", "reasoning", "fast", "memory"] as const;

  private apiKey = "";
  private initialized = false;
  /** True when the SERVER holds the credential (see providers/aiRelay.ts). */
  private relay = false;
  // Current production chat model on Groq (llama-3.3-70b was retired).
  private model = "openai/gpt-oss-120b";

  async initialize(): Promise<void> {
    const runtimeEnv = globalThis as typeof globalThis & {
      __LELU_GROQ_API_KEY__?: string;
      __LELU_GROQ_MODEL__?: string;
    };

    const windowEnv =
      typeof window !== "undefined"
        ? (window as Window & { __LELU_GROQ_API_KEY__?: string })
        : undefined;

    const processEnv =
      typeof process !== "undefined" ? process.env : undefined;

    this.model =
      import.meta.env.VITE_GROQ_MODEL?.trim() ||
      runtimeEnv.__LELU_GROQ_MODEL__?.trim() ||
      "openai/gpt-oss-120b";

    // NOT read from import.meta.env: Vite inlines VITE_* values into the
    // client bundle, which is how provider keys ended up shipped to the
    // browser. A key held HERE only comes from a runtime that injected
    // one deliberately (verification scripts, a native shell); otherwise
    // the request is relayed and the SERVER attaches the credential.
    this.apiKey =
      runtimeEnv.__LELU_GROQ_API_KEY__?.trim() ||
      windowEnv?.__LELU_GROQ_API_KEY__?.trim() ||
      processEnv?.GROQ_API_KEY?.trim() ||
      "";

    // No local key is the NORMAL production case now: the credential
    // belongs on the server so it never enters the client bundle.
    this.relay = this.apiKey ? false : await relayAvailable("groq");

    this.initialized = true;

    console.info("[GroqProvider] Initialized", {
      // Never the key or its length — only whether one is reachable.
      credential: this.apiKey ? "local" : this.relay ? "server-relay" : "none",
      model: this.model,
    });
  }

  private selectModel(request: AIRequest): string {
    const requested = request.model?.trim() || this.model;

    if (!request.media?.length) {
      return requested;
    }

    const lower = requested.toLowerCase();
    if (lower.includes("vision") || lower.includes("llava")) {
      return requested;
    }

    // No dedicated vision model is guaranteed on every Groq account;
    // send the requested model and let the API report honestly.
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
        parts.push({
          type: "image_url",
          image_url: { url: media.dataUrl },
        });
      }
    }
    parts.push({ type: "text", text: request.prompt });
    return parts;
  }

  async isAvailable(): Promise<boolean> {
    return (
      this.initialized && this.enabled && (this.apiKey.length > 0 || this.relay)
    );
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();
    let lastError: string | undefined;

    if (!this.initialized) {
      lastError = "Groq provider not initialized.";
    } else if (!this.apiKey && !this.relay) {
      lastError = "No Groq credential — set GROQ_API_KEY on the server.";
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
      throw new Error("Groq provider is not initialized.");
    }

    if (!this.apiKey && !this.relay) {
      throw new Error("Groq has no credential — set GROQ_API_KEY on the server.");
    }

    const messages = [
      {
        role: "system" as const,
        content: LELU_SYSTEM_PROMPT,
      },
      ...contextMessages(request),
      ...(request.messages ?? []),
      {
        role: "user" as const,
        content: this.buildUserContent(request),
      },
    ];

    const payload = {
      model: this.selectModel(request),
      messages,
      temperature: request.temperature ?? 0.7,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop?.length ? { stop: request.stop } : {}),
      // True token streaming whenever the caller wants progressive
      // output — no artificial pacing, raw provider chunks.
      ...(request.onDelta ? { stream: true } : {}),
    };

    let response: Response;

    try {
      // Same upstream call as before. When no key is held locally the
      // request goes same-origin to /api/ai/relay and the SERVER
      // attaches the credential — status and body come back verbatim,
      // so the parsing and fallback behaviour below is unchanged.
      response = await providerFetch("groq", "https://api.groq.com/openai/v1/chat/completions", {
        apiKey: this.apiKey,
        body: payload,
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Groq network error: ${message}`);
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
      throw new Error(`Groq failed ${response.status}: ${String(apiMessage)}`);
    }

    const choices = data?.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined;
    const content = choices?.[0]?.message?.content ?? "";

    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Groq returned no usable content.");
    }

    const processingTime = Date.now() - started;

    return {
      text: content.trim(),
      provider: this.name,
      model: payload.model,
      processingTime,
      metadata: {
        usage: data?.usage,
        finishReason: choices?.[0]?.finish_reason,
      },
    };
  }

  /**
   * Consume an OpenAI-compatible SSE stream, invoking onDelta with the
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
      // Surface the API error through the normal error path so the next
      // provider in the fallback chain takes over.
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
      throw new Error(`Groq failed ${response.status}: ${apiMessage}`);
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
      if (!dataStr || dataStr === "[DONE]") return;
      try {
        const chunk = JSON.parse(dataStr) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          usage?: unknown;
        };
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          onDelta(content);
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
      throw new Error(`Groq stream interrupted: ${message}`);
    }

    if (!content.trim()) {
      throw new Error("Groq returned no usable content.");
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
    console.info("[GroqProvider] Shutdown");
  }
}
