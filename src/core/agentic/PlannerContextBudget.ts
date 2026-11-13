/**
 * ==========================================================
 * LÉLU — PLANNER CONTEXT BUDGET
 *
 * MEASURED (2026-11-13): the planning prompt reached 91,427 characters
 * (~22.8k tokens) for a 52-character request, because it carried the full
 * JSON Schema of every capability. In the same session the deduplication fix
 * in AIService halved the *request* (186 KB → 95 KB), and the remaining bulk
 * was this catalogue. Every provider refused it: Groq 413 (8k TPM),
 * OpenRouter 402, GitHub Models answered `text/plain "OK"`.
 *
 * The catalogue is genuinely useful, so it is not deleted: it is ORDERED by
 * value per byte and cut at the end when the model cannot take it.
 *
 *   1. CAPABILITIES list (id + description) — how the planner knows what exists.
 *   2. LESSONS / CONTEXT / REQUEST — always kept, always at the end.
 *   3. TOOL PARAMETERS (JSON Schema) — the largest block, needed only to get
 *      arguments exactly right; dropped first when the budget is exceeded.
 *
 * A trimmed prompt is not a silent lie: it says the schema block was trimmed,
 * so the planner knows to use a tool with no arguments or an obviously-named one.
 * ==========================================================
 */

/** Characters, not tokens: ~4 chars ≈ 1 token for English, high for schemas. */
export const PLANNER_PROMPT_BUDGET_CHARS = 20_000;

const SCHEMA_HEADER = "TOOL PARAMETERS (JSON Schema):";

/**
 * Shrink a planner prompt to fit a character budget, dropping the JSON Schema
 * block before anything else. Text after the schema section is preserved, so
 * the REQUEST always survives.
 */
export function fitPlannerPrompt(prompt: string, budgetChars = PLANNER_PROMPT_BUDGET_CHARS): string {
  if (prompt.length <= budgetChars) return prompt;

  const start = prompt.indexOf(SCHEMA_HEADER);
  if (start < 0) {
    // No schema block to trade: keep the head and the request, cut the middle.
    const tail = prompt.slice(-Math.floor(budgetChars / 3));
    return `${prompt.slice(0, budgetChars - tail.length)}\n\n[trimmed to fit the model's context]\n${tail}`;
  }

  const afterHeader = prompt.indexOf("\n\n", start + SCHEMA_HEADER.length);
  const schemaEnd = afterHeader > 0 ? afterHeader : prompt.length;
  const before = prompt.slice(0, start);
  const after = prompt.slice(schemaEnd);

  const note =
    `${SCHEMA_HEADER}\n` +
    "(the detailed parameter list was trimmed to fit this model's context; " +
    "prefer tools whose arguments are obvious from their name, and use {} when none are needed)";

  const trimmed = `${before}${note}${after}`;
  if (trimmed.length <= budgetChars) return trimmed;

  // Still too big: keep the capability list's head plus the request.
  const requestAt = trimmed.lastIndexOf("REQUEST:");
  const request = requestAt >= 0 ? trimmed.slice(requestAt) : "";
  const room = Math.max(0, budgetChars - request.length - 200);
  return `${trimmed.slice(0, room)}\n\n[trimmed to fit the model's context]\n\n${request}`;
}
