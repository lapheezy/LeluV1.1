/**
 * ==========================================================
 * LÉLU — TOOL EXECUTION DEADLINE
 *
 * The tool loop re-arms its budget every time a tool reports progress, so a
 * tool that never settles had no deadline at all: nothing threw, nothing was
 * recorded, and the person watched a spinner forever. This puts a bound on a
 * single execution without changing what any tool does.
 *
 * A tool that runs past the deadline is NOT a success and NOT a throw from the
 * tool: it is a distinct outcome, and the dispatcher reports it as such.
 * ==========================================================
 */

/** Generous by default — research and studio builds are slow. */
const DEFAULT_TOOL_TIMEOUT_MS = 45_000;

export function toolTimeoutMs(): number {
  const raw = typeof process !== "undefined" ? process.env?.LELU_TOOL_TIMEOUT_MS : undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 50 ? parsed : DEFAULT_TOOL_TIMEOUT_MS;
}

/** A tool that ran past its deadline. Distinct from a tool that threw. */
export class ToolTimeoutError extends Error {
  constructor(tool: string, readonly limitMs: number) {
    super(`"${tool}" did not finish within ${Math.round(limitMs / 1000)}s`);
    this.name = "ToolTimeoutError";
  }
}

export async function withDeadline<T>(work: Promise<T>, limitMs: number, tool: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolTimeoutError(tool, limitMs)), limitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
