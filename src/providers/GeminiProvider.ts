/**
 * ==========================================================
 * LÉLU
 * GEMINI PROVIDER (Google generative language API)
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { endpoint } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export default class GeminiProvider implements AIProvider {
  readonly name = "Gemini";
  readonly priority = 8;
  readonly enabled = true;
  readonly timeout = 30000;
  readonly requiresApiKey = true;
  readonly capabilities = ["chat", "reasoning", "vision", "memory"] as const;

  private apiKey = "";
  private initialized = false;
  private model = "gemini-2.0-flash";

  async initialize(): Promise<void> {
    this.model = resolveFirst("GEMINI_MODEL") ?? "gemini-2.0-flash";
    this.apiKey =
      resolveFirst("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY") ?? "";
    this.initialized = true;

    console.info("[GeminiProvider] Initialized", {
      hasKey: this.apiKey.length > 0,
      keyLength: this.apiKey.length,
      model: this.model,
    });
  }

  async isAvailable(): Promise<boolean> {
    return this.initialized && this.enabled && this.apiKey.length > 0;
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();
    let lastError: string | undefined;
    if (!this.initialized) lastError = "Gemini provider not initialized.";
    else if (!this.apiKey) lastError = "Gemini API key missing.";
    return { available, initialized: this.initialized, lastChecked: Date.now(), lastError };
  }

  canHandle(_input: string): boolean {
    return true;
  }

  /**
   * Gemini's schema differs from the OpenAI shape in four ways that are
   * each a hard error rather than a degraded answer:
   *
   *   • the assistant role is called "model", not "assistant";
   *   • turns are `contents[].parts[]`, not `messages[].content`;
   *   • the system prompt is `system_instruction`, a separate top-level
   *     field — system turns left in `contents` are rejected, so the
   *     LÉLU prompt and everything contextMessages() emits (memory,
   *     live-retrieval results) are hoisted, exactly as for Anthropic;
   *   • images are `inline_data` with bare base64, no data: prefix.
   */
  private buildRequest(request: AIRequest): {
    system_instruction: { parts: GeminiPart[] };
    contents: GeminiContent[];
  } {
    const history = [...contextMessages(request), ...(request.messages ?? [])];
    const systemParts = [LELU_SYSTEM_PROMPT];
    const contents: GeminiContent[] = [];

    for (const message of history) {
      if (message.role === "system") {
        if (message.content.trim()) systemParts.push(message.content);
        continue;
      }
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      });
    }

    const parts: GeminiPart[] = [];
    for (const media of request.media ?? []) {
      if (media.kind !== "image" || !media.dataUrl.startsWith("data:")) continue;
      const base64 = media.dataUrl.match(/;base64,(.+)$/)?.[1];
      if (!base64) continue;
      parts.push({
        inline_data: {
          mime_type: media.dataUrl.match(/data:([^;]+)/)?.[1] ?? "image/jpeg",
          data: base64,
        },
      });
    }
    parts.push({ text: request.prompt });
    contents.push({ role: "user", parts });

    // Same alternation rule as Anthropic: a leading model turn is dropped
    // and consecutive same-role turns are merged.
    while (contents.length > 0 && contents[0].role === "model") contents.shift();
    const merged: GeminiContent[] = [];
    for (const turn of contents) {
      const previous = merged[merged.length - 1];
      if (previous && previous.role === turn.role) {
        previous.parts = [...previous.parts, ...turn.parts];
        continue;
      }
      merged.push({ role: turn.role, parts: [...turn.parts] });
    }

    return {
      system_instruction: { parts: [{ text: systemParts.join("\n\n") }] },
      contents: merged,
    };
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    if (!this.initialized) throw new Error("Gemini provider is not initialized.");
    if (!this.apiKey) throw new Error("Gemini API key is missing.");

    const model = request.model?.trim() || this.model;
    const payload = {
      ...this.buildRequest(request),
      generationConfig: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
        ...(request.stop?.length ? { stopSequences: request.stop } : {}),
      },
    };

    // The key travels as a header rather than a query parameter so it does
    // not end up in proxy logs or a Referer.
    const url = `${endpoint("gemini")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      throw new Error(
        `Gemini network error: ${error instanceof Error ? error.message : String(error)}`,
      );
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
        ((data?.error as Record<string, unknown>)?.message as string) || raw || `HTTP ${response.status}`;
      throw new Error(`Gemini failed ${response.status}: ${apiMessage}`);
    }

    const candidates = data?.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      | undefined;
    const text = (candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) throw new Error("Gemini returned no usable content.");

    return {
      text,
      provider: this.name,
      model,
      processingTime: Date.now() - started,
      metadata: {
        usage: data?.usageMetadata,
        finishReason: candidates?.[0]?.finishReason,
      },
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.apiKey = "";
    console.info("[GeminiProvider] Shutdown");
  }
}
