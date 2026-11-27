/**
 * ==========================================================
 * LÉLU — what a turn reports when tools ran but the model did not finish
 *
 * Tools are deterministic: a sketch drawn, a world object placed, a page
 * fetched are done whether or not a language model is still available to
 * write about them. When the provider fails (capacity exhausted, rate
 * limit, outage) after tools ran, the reply is built here WITHOUT any
 * inference: each step that ran, whether it succeeded and what it
 * returned, then exactly what still needs reasoning. Nothing is re-run,
 * nothing is claimed complete that is not, and no other provider (which
 * might charge) is tried in its place.
 * ==========================================================
 */

export interface ToolRunRecord {
  tool: string;
  ok: boolean;
  /** First line of the tool's own result, trimmed — never model text. */
  summary?: string;
  /**
   * The tool's own result, capped — the evidence a later narration is written
   * from when the provider that asked for the work stops before answering.
   *
   * It is deliberately NOT part of the reply metadata (`publicToolRun`): a
   * result body belongs to the turn, not to the chat message that outlives it.
   */
  content?: string;
}

const MAX_SUMMARY = 160;

/** How much of one tool result is kept as evidence for a narration. */
export const MAX_TOOL_EVIDENCE = 4_000;

/** A tool result, capped, ready to be shown to a model that must narrate it. */
export function toolEvidence(content: string | undefined): string | undefined {
  if (!content) return undefined;
  return content.length > MAX_TOOL_EVIDENCE ? `${content.slice(0, MAX_TOOL_EVIDENCE - 1)}…` : content;
}

/** A record safe to attach to a reply's metadata (no result bodies). */
export function publicToolRun(record: ToolRunRecord): ToolRunRecord {
  const copy: ToolRunRecord = { tool: record.tool, ok: record.ok };
  if (record.summary) copy.summary = record.summary;
  return copy;
}

/** A one-line, secret-free digest of a tool result for the partial-work report. */
export function summarizeToolResult(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const line = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^[{[]$/.test(l));
  if (!line) return undefined;
  const cleaned = line
    // Never echo anything shaped like a credential.
    .replace(/\b(sk|gsk|fc|pk|key|tok)[-_][A-Za-z0-9_-]{12,}\b/gi, "[redacted]")
    .replace(/\s+/g, " ");
  return cleaned.length > MAX_SUMMARY ? `${cleaned.slice(0, MAX_SUMMARY - 1)}…` : cleaned;
}

/** The deterministic reply for "tools ran, then the provider failed". */
export function partialWorkReply(ran: ToolRunRecord[], providerName: string, reason: string): string {
  const succeeded = ran.filter((r) => r.ok).length;
  const failed = ran.length - succeeded;
  const steps = ran.map((r, i) => `${i + 1}. ${r.tool} — ${r.ok ? "done" : "failed"}${r.summary ? `: ${r.summary}` : ""}`);
  const status =
    failed === 0
      ? `All ${succeeded} step(s) that ran succeeded and are saved.`
      : `${succeeded} step(s) succeeded and are saved; ${failed} failed.`;
  return [
    `Partial result — the job is NOT complete. ${providerName} stopped before I could finish (${reason.slice(0, 200)}).`,
    "",
    "What actually ran:",
    ...steps,
    "",
    status,
    "Still needs reasoning: deciding any further steps and writing the final answer. " +
      "Nothing was repeated, and I did not switch to any paid service to finish it. " +
      "Ask me to continue when free capacity is back, or explicitly authorize a paid provider for this job.",
  ].join("\n");
}
