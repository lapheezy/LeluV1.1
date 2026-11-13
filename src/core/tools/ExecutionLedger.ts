/**
 * ==========================================================
 * LÉLU — EXECUTION LEDGER (interrupted-write policy)
 *
 * A reload during a tool call leaves the call's OUTCOME UNKNOWN: the page is
 * gone, so nothing can say whether the write landed. Measured on 2026-11-13:
 * reloading mid-`research.web` left one execution at `started` with no
 * terminal record, and the reloaded turn then ran the SAME tool again under a
 * new id. For a read that is wasteful; for a write it applies the change
 * twice.
 *
 * The policy this implements, and its limits:
 *
 *   · ONLY side-effecting tools are tracked (WRITE / EXECUTE / DESTRUCTIVE /
 *     EXTERNAL_ACTION permission, or risk level ≥ 2). Reads are never held.
 *   · An attempt is recorded BEFORE the tool runs and marked complete after.
 *   · A new attempt with the SAME tool, arguments and request, while an earlier
 *     one is still un-finished, is REFUSED: the outcome is unknown, so repeating
 *     it could double-apply. The refusal says exactly that.
 *   · A later attempt after a COMPLETED one is allowed. The user asking again
 *     is a new instruction, not a retry, and blocking that would be worse.
 *
 * It is a ledger of recent attempts, not a transaction log: entries expire,
 * and the cap keeps it bounded.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import ToolRegistry from "./ToolRegistry";

const KEY = "lelu.executions.inflight.v1";
/** An interrupted attempt older than this is no longer treated as live. */
const WINDOW_MS = 15 * 60_000;
const MAX_ENTRIES = 60;

export interface LedgerEntry {
  key: string;
  tool: string;
  taskId: string;
  startedAt: number;
  status: "started" | "completed";
}

export interface BeginResult {
  /** False when the caller may proceed (and must call finish()). */
  blocked: boolean;
  key: string;
  reason?: string;
}

function hash(text: string): string {
  let out = 0;
  for (let index = 0; index < text.length; index += 1) {
    out = (out * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(out).toString(36);
}

/** Stable for the same tool + arguments + request, across a reload. */
export function attemptKey(tool: string, args: unknown, signature: string): string {
  let serialised = "";
  try {
    serialised = JSON.stringify(args ?? {});
  } catch {
    serialised = String(args);
  }
  return `${tool}:${hash(serialised)}:${hash(signature)}`;
}

/** Does running this twice change the world twice? */
export function isSideEffecting(toolId: string): boolean {
  try {
    const definition = ToolRegistry.getInstance().get(toolId);
    if (!definition) return false;
    if ((definition.riskLevel ?? 0) >= 2) return true;
    return definition.permissions.some((permission) =>
      ["WRITE", "EXECUTE", "DESTRUCTIVE", "EXTERNAL_ACTION"].includes(permission),
    );
  } catch {
    // Unknown metadata must not be treated as harmless: assume it writes.
    return true;
  }
}

export default class ExecutionLedger {
  private static instance: ExecutionLedger | null = null;

  static getInstance(): ExecutionLedger {
    if (!ExecutionLedger.instance) ExecutionLedger.instance = new ExecutionLedger();
    return ExecutionLedger.instance;
  }

  static resetForTests(): void {
    ExecutionLedger.instance = null;
  }

  private read(): LedgerEntry[] {
    try {
      const stored = KvStore.getInstance().get<LedgerEntry[]>(KEY);
      const now = Date.now();
      return Array.isArray(stored)
        ? stored.filter((entry) => entry && typeof entry.startedAt === "number" && now - entry.startedAt < WINDOW_MS)
        : [];
    } catch {
      return [];
    }
  }

  private write(entries: LedgerEntry[]): void {
    try {
      KvStore.getInstance().set(KEY, entries.slice(-MAX_ENTRIES));
    } catch {
      /* the ledger is best-effort; it must never break a call */
    }
  }

  /**
   * Record the intent to run. `signature` identifies the request that asked
   * for it (the prompt), so an unrelated later request is not blocked.
   */
  begin(tool: string, args: unknown, signature: string, taskId: string): BeginResult {
    const key = attemptKey(tool, args, signature);
    const entries = this.read();
    const previous = entries.find((entry) => entry.key === key && entry.status === "started");
    if (previous) {
      return {
        blocked: true,
        key,
        reason:
          `"${tool}" is not being run again: an identical call from this same request started ` +
          `${Math.max(1, Math.round((Date.now() - previous.startedAt) / 1000))}s ago and never reported ` +
          `whether it finished. Its outcome is unknown, and repeating it could apply the change twice. ` +
          `Check the result directly, or say so explicitly to run it again.`,
      };
    }
    entries.push({ key, tool, taskId, startedAt: Date.now(), status: "started" });
    this.write(entries);
    return { blocked: false, key };
  }

  /** The tool reported an outcome (success or an honest failure). */
  finish(key: string): void {
    const entries = this.read();
    const entry = entries.find((candidate) => candidate.key === key);
    if (!entry) return;
    entry.status = "completed";
    this.write(entries);
  }
}
