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
