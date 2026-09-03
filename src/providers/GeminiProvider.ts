/**
 * ==========================================================
 * LÉLU
 * GEMINI PROVIDER (Google generative language API)
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth, ToolCall } from "./AIProvider";
import { contextMessages } from "./contextMessages";
import { LELU_SYSTEM_PROMPT } from "./LeluSystemPrompt";
import { endpoint } from "../core/Endpoints";
import { resolveFirst } from "../core/resolveEnv";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  /** A tool the model asked to run. */
  functionCall?: { name: string; args?: Record<string, unknown> };
  /** The real outcome of running one, handed back to the model. */
  functionResponse?: { name: string; response: Record<string, unknown> };
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
  readonly capabilities = ["chat", "reasoning", "vision", "memory", "tools"] as const;
  readonly supportsTools = true;

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
      // A tool RESULT is a user turn carrying functionResponse — Gemini
      // has no "tool" role. It correlates by tool NAME rather than by
      // an id, which is why the name is carried on the message.
      if (message.role === "tool") {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: message.toolName ?? "",
                response: message.toolError
                  ? { error: message.content }
                  : { result: message.content },
              },
            },
          ],
        });
        continue;
      }

      // Replay the model turn that asked for tools with its
      // functionCall parts intact, or the exchange loses its pairing.
      if (message.role === "assistant" && message.toolCalls?.length) {
        const callParts: GeminiPart[] = [];
        if (message.content.trim()) callParts.push({ text: message.content });
        for (const call of message.toolCalls) {
          callParts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } });
        }
        contents.push({ role: "model", parts: callParts });
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
    // Mid-tool-loop the tail is a functionResponse turn; re-appending
    // the original prompt there would ask the question a second time.
    if (history[history.length - 1]?.role !== "tool") {
      parts.push({ text: request.prompt });
      contents.push({ role: "user", parts });
    }

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
      // Gemini nests declarations one level deeper than the others:
      // tools[].functionDeclarations[], not tools[] directly.
      ...(request.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                })),
              },
            ],
          }
        : {}),
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
      | Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
      | undefined;
    const responseParts = candidates?.[0]?.content?.parts ?? [];
    const text = responseParts
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    // Gemini issues no call id, so one is synthesised. It only has to
    // survive the round trip within this exchange; the functionResponse
    // that answers it correlates by name.
    const toolCalls: ToolCall[] = responseParts
      .filter((part) => part.functionCall?.name)
      .map((part, index) => ({
        id: `gemini-${Date.now()}-${index}`,
        name: part.functionCall!.name,
        arguments: part.functionCall!.args ?? {},
      }));

    // A tool-call turn legitimately carries no text.
    if (!text && toolCalls.length === 0) {
      throw new Error("Gemini returned no usable content.");
    }

    return {
      text,
      provider: this.name,
      model,
      processingTime: Date.now() - started,
      ...(toolCalls.length ? { toolCalls } : {}),
      stopReason: toolCalls.length ? "tool_use" : candidates?.[0]?.finishReason,
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
