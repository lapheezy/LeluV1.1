/**
 * ==========================================================
 * LÉLU — FINAL-ROUND TOOL HISTORY
 *
 * When the tool loop ends, the next request withholds tools so the model
 * answers from what it already has. Some OpenAI-compatible providers
 * (measured on Groq `openai/gpt-oss-20b`) then reject the request:
 *
 *   400 tool_use_failed — "Tool choice is none, but model called a tool"
 *
 * The history still contained an assistant turn with `tool_calls` and
 * `role:"tool"` results, so the model imitated that shape even though no
 * tool was offered and no tool could be called. The final round must not
 * speak the tool protocol at all.
 *
 * This keeps every result verbatim as an ordinary user message. The evidence
 * is not weakened: tool name, success flag and the complete result text all
 * survive. Only the protocol envelope is removed, because there is no tool
 * channel left to carry it.
 * ==========================================================
 */

import type { AIMessage } from "../../providers/AIProvider";

/** Collapse tool calls/results into plain text for a no-tool final round. */
export function flattenToolHistory(messages: AIMessage[]): AIMessage[] {
  const flattened: AIMessage[] = [];
  let pending: Array<{ id: string; name: string }> = [];
  let results: Array<{ name: string; content: string; error: boolean }> = [];

  const flush = () => {
    if (pending.length === 0 && results.length === 0) return;
    const blocks = results.map((result) => {
      const call = pending.find((entry) => entry.name === result.name);
      return [
        `Tool: ${result.name}${call ? ` (call ${call.id})` : ""} — ${result.error ? "FAILED" : "ok"}`,
        result.content,
      ].join("\n");
    });
    if (blocks.length === 0) {
      blocks.push(
        pending.map((call) => `Tool: ${call.name} (call ${call.id}) — no result was recorded`).join("\n"),
      );
    }
    flattened.push({
      role: "user",
      content:
        "[Executed tool results from this turn. These tools already ran; do not call them again. " +
        "No tools are available in this final round, so do not emit a tool call. " +
        "Answer the request in text from these results and say plainly what could not be verified.]\n\n" +
        blocks.join("\n\n"),
    });
    pending = [];
    results = [];
  };

  for (const message of messages) {
    if (message.role === "assistant" && message.toolCalls?.length) {
      // Any prose the model wrote alongside the calls stays as prose.
      if (typeof message.content === "string" && message.content.trim()) {
        flush();
        flattened.push({ role: "assistant", content: message.content });
      }
      pending.push(...message.toolCalls.map((call) => ({ id: call.id, name: call.name })));
      continue;
    }
    if (message.role === "tool") {
      results.push({
        name: message.toolName ?? "unknown",
        content: typeof message.content === "string" ? message.content : String(message.content ?? ""),
        error: message.toolError === true,
      });
      continue;
    }
    flush();
    flattened.push(message);
  }
  flush();
  return flattened;
}
