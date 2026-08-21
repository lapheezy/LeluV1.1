/**
 * ==========================================================
 * LÉLU
 * GROQ PROVIDER
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";

export default class GroqProvider implements AIProvider {
  readonly name = "Groq";
  readonly priority = 1;
  readonly enabled = true;
  readonly timeout = 30000;
  readonly requiresApiKey = true;
  readonly capabilities = ["chat", "reasoning", "fast", "memory"] as const;

  private apiKey = "";
  private initialized = false;
  private model = "llama-3.3-70b-versatile";

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
      "llama-3.3-70b-versatile";

    this.apiKey =
      import.meta.env.VITE_GROQ_API_KEY?.trim() ||
      runtimeEnv.__LELU_GROQ_API_KEY__?.trim() ||
      windowEnv?.__LELU_GROQ_API_KEY__?.trim() ||
      processEnv?.GROQ_API_KEY?.trim() ||
      "";

    this.initialized = true;

    console.info("[GroqProvider] Initialized", {
      hasKey: this.apiKey.length > 0,
      keyLength: this.apiKey.length,
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

    return "llama-3.2-11b-vision-preview";
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
      this.initialized && this.enabled && this.requiresApiKey && this.apiKey.length > 0
    );
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();
    let lastError: string | undefined;

    if (!this.initialized) {
      lastError = "Groq provider not initialized.";
    } else if (!this.apiKey) {
      lastError = "Groq API key missing.";
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

    if (!this.apiKey) {
      throw new Error("Groq API key is missing.");
    }

    const messages = [
      {
        role: "system" as const,
        content: `You are Lélu.

Identity:
- Your name is Lélu.
- You are the user's personal AI companion.
- The model running you is only the engine powering you.
- Never identify yourself as Llama, GPT, Groq, or any underlying model.
- If asked your name, answer: "My name is Lélu."

Memory behavior:
- Information provided in Memory context is your memory system.
- Treat it as known information about the user.
- Use it naturally when relevant.
- Do not invent memories that are not provided.

Conversation behavior:
- Maintain continuity with the user.
- Personalize responses using known information.
- Be helpful, calm, creative, and engineering-focused.
- You are not a generic assistant. You are Lélu.`,
      },
      ...(request.context
        ? [{ role: "system" as const, content: `Memory context:\n\n${request.context}` }]
        : []),
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
    };

    let response: Response;

    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Groq network error: ${message}`);
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

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.apiKey = "";
    console.info("[GroqProvider] Shutdown");
  }
}
