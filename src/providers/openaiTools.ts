/**
 * ==========================================================
 * LÉLU
 * OPENAI-SHAPED TOOL CALLING
 *
 * Groq, OpenRouter, Cerebras, Mistral, Fireworks and GitHub Models
 * all speak the OpenAI chat-completions dialect, so the tool
 * translation is written once here instead of six times.
 *
 * Three things differ from the Anthropic shape and each is load-
 * bearing:
 *   • tools are wrapped in {type:"function", function:{...}} and the
 *     schema key is `parameters`, not `input_schema`
 *   • a tool RESULT is its own role ("tool"), not a user turn
 *   • the assistant turn that requested tools carries `tool_calls`,
 *     and its arguments are a JSON STRING rather than an object
 * ==========================================================
 */

import type { AIMessage, AIRequest, ToolCall } from "./AIProvider";

/** One message in the OpenAI wire shape. */
type WireMessage = Record<string, unknown>;

/**
 * Translate LÉLU's conversation into the OpenAI wire shape, carrying
 * tool turns through intact.
 *
 * Messages without tool content pass through unchanged, so a provider
 * that never sees a tool behaves exactly as it did before.
 */
export function toOpenAIMessages(messages: AIMessage[] | undefined): WireMessage[] {
  const wire: WireMessage[] = [];

  for (const message of messages ?? []) {
    if (message.role === "tool") {
      wire.push({
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: message.content,
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      wire.push({
        role: "assistant",
        // The API requires the key to be present; null is the correct
        // value for a turn that is purely a tool request.
        content: message.content.trim() ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            // Arguments travel as a JSON string in this dialect.
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      });
      continue;
    }

    wire.push({ role: message.role, content: message.content });
  }

  return wire;
}

/** The `tools` fragment of the request payload, or nothing. */
export function openAIToolPayload(request: AIRequest): Record<string, unknown> {
  if (!request.tools?.length) return {};
  return {
    tools: request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
    tool_choice: "auto",
  };
}

interface WireChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string;
}

/**
 * Lift tool_calls out of a completion choice.
 *
 * Malformed argument JSON yields an EMPTY argument object rather than
 * throwing: the dispatcher then reports the missing argument back to
 * the model as a real failure, which it can correct on the next turn.
 * Throwing here would instead drop the whole provider to the fallback
 * chain over one bad character.
 */
export function extractOpenAIToolCalls(choice: WireChoice | undefined): ToolCall[] {
  const raw = choice?.message?.tool_calls;
  if (!Array.isArray(raw)) return [];

  return raw.map((call) => {
    let args: Record<string, unknown> = {};
    const text = call.function?.arguments;
    if (typeof text === "string" && text.trim()) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // Leave args empty — reported to the model as a failure.
      }
    }
    return {
      id: String(call.id ?? ""),
      name: String(call.function?.name ?? ""),
      arguments: args,
    };
  });
}


/**
 * The trailing live-prompt turn — or nothing.
 *
 * Mid-tool-loop the conversation already ends with a tool result, and
 * appending the original prompt again there asks the user's question a
 * second time after the answer has been fetched. The model then tends
 * to re-run the same tool. Outside the loop this is unchanged: the
 * prompt turn is appended exactly as before.
 */
export function trailingUserTurn(
  request: AIRequest,
  content: unknown,
): WireMessage[] {
  const history = request.messages ?? [];
  if (history[history.length - 1]?.role === "tool") return [];
  return [{ role: "user", content }];
}


/**
 * The visible answer from an OpenAI-shaped choice.
 *
 * `message.content` is the obvious place and usually the right one. It
 * is not the only one: a REASONING model streams its thinking into
 * `reasoning` (Groq) or `reasoning_content` (several OpenAI-compatible
 * APIs) and only then writes the answer. Ask such a model for one word
 * with a small token budget and it spends the whole budget thinking —
 * `content` comes back empty with finish_reason "length", and a client
 * that reads only `content` concludes the provider is broken.
 *
 * That was not hypothetical: it took a working Groq key, marked the
 * provider failed on its first call, cooled it down, and dropped
 * cognition to the offline path with every provider gone. Reading the
 * reasoning field is what makes a reasoning model usable at all.
 */
export function extractOpenAIText(choice: unknown): string {
  const message = (choice as { message?: Record<string, unknown> } | undefined)?.message;
  if (!message) return "";
  for (const field of ["content", "reasoning_content", "reasoning"]) {
    const value = message[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Why a choice carried no text — in terms a caller can act on.
 *
 * A truncated answer and an empty one are different failures: the first
 * says "raise max_tokens", the second says "this provider is not
 * answering". Collapsing them into one message sends whoever is
 * debugging to the wrong place.
 */
export function describeEmptyChoice(provider: string, choice: unknown): string {
  const reason = (choice as { finish_reason?: string } | undefined)?.finish_reason;
  if (reason === "length") {
    return `${provider} hit the token limit before producing an answer (finish_reason=length). ` +
      `Raise max_tokens — a reasoning model can spend the whole budget thinking.`;
  }
  return `${provider} returned no usable content${reason ? ` (finish_reason=${reason})` : ""}.`;
}

/* ------------------------------------------------------------------ *
 * STREAMING, WITH TOOLS
 *
 * One reader for every OpenAI-compatible provider. Text deltas are
 * passed on as they arrive (accumulated, the shape onDelta expects);
 * tool-call deltas are assembled by index — the id and name arrive
 * once, the arguments in fragments — and returned whole at the end.
 *
 * Groq's own reader kept only `delta.content`, so with tools offered a
 * reply that called a tool streamed nothing, arrived "empty", and was
 * treated as a provider failure.
 * ------------------------------------------------------------------ */

export interface StreamedReply {
  text: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: unknown;
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** Parse the argument JSON of a streamed tool call; malformed → {} (reported to the model). */
function parseStreamedArgs(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Read an OpenAI-compatible SSE reply. Throws, with the API's own
 * message, on a non-2xx response or a broken stream — so the provider
 * fallback chain still engages exactly as for a non-streamed call.
 */
export async function readOpenAIStream(
  response: Response,
  provider: string,
  onDelta: (accumulated: string) => void,
): Promise<StreamedReply> {
  if (!response.ok || !response.body) {
    const raw = response.body ? await response.text() : "";
    let apiMessage = `HTTP ${response.status}`;
    try {
      const data = JSON.parse(raw) as { error?: { message?: string }; message?: string };
      apiMessage = data?.error?.message || data?.message || raw || apiMessage;
    } catch {
      if (raw) apiMessage = raw.slice(0, 300);
    }
    throw new Error(`${provider} HTTP ${response.status}: ${apiMessage}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | undefined;
  let usage: unknown;
  const calls = new Map<number, { id: string; name: string; args: string }>();

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: {
      choices?: Array<{ delta?: { content?: string | null; tool_calls?: ToolCallDelta[] }; finish_reason?: string | null }>;
      usage?: unknown;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return; // keep-alive fragments
    }
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    if (typeof delta?.content === "string" && delta.content.length > 0) {
      text += delta.content;
      onDelta(text);
    }
    for (const part of delta?.tool_calls ?? []) {
      const index = typeof part.index === "number" ? part.index : calls.size;
      const current = calls.get(index) ?? { id: "", name: "", args: "" };
      if (part.id) current.id = part.id;
      if (part.function?.name) current.name += part.function.name;
      if (part.function?.arguments) current.args += part.function.arguments;
      calls.set(index, current);
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
    if (error instanceof Error && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${provider} stream interrupted: ${message}`);
  }

  const toolCalls: ToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, call]) => call.name)
    .map(([index, call]) => ({ id: call.id || `call_${index}`, name: call.name, arguments: parseStreamedArgs(call.args) }));

  return { text, toolCalls, finishReason, usage };
}
