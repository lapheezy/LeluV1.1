/**
 * ==========================================================
 * LÉLU — TOOL STATS
 *
 * What each tool has actually done: runs, successes, failures,
 * the last error, how long it takes. Recorded at the one place
 * every tool call passes through (dispatchToolCall), so the
 * numbers cover chat turns, workflows, tasks and agents alike.
 *
 * Reflection reads this to find tools that keep failing; the
 * capability catalog reads it so a planner can prefer tools
 * that work. Persisted through KvStore, bounded per tool.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface ToolStat {
  tool: string;
  runs: number;
  succeeded: number;
  failed: number;
  /** Refused before running (unknown tool, not permitted, not approved). */
  refused: number;
  lastRunAt?: number;
  lastError?: string;
  lastErrorAt?: number;
  /** Mean duration of runs that executed, in ms. */
  meanMs: number;
  /** The most recent failure messages, newest first (max 5). */
  recentErrors: Array<{ at: number; error: string }>;
}

const KEY = "lelu.toolstats.v1";

export type ToolOutcome = "succeeded" | "failed" | "refused";

export default class ToolStats {
  private static instance: ToolStats | null = null;
  private stats = new Map<string, ToolStat>();

  private constructor() {
    const stored = KvStore.getInstance().get<ToolStat[]>(KEY) ?? [];
    for (const stat of stored) this.stats.set(stat.tool, stat);
  }

  public static getInstance(): ToolStats {
    if (!ToolStats.instance) ToolStats.instance = new ToolStats();
    return ToolStats.instance;
  }

  public record(tool: string, outcome: ToolOutcome, durationMs: number, error?: string): void {
    const stat =
      this.stats.get(tool) ??
      { tool, runs: 0, succeeded: 0, failed: 0, refused: 0, meanMs: 0, recentErrors: [] };
    const now = Date.now();
    if (outcome === "refused") {
      stat.refused += 1;
    } else {
      stat.runs += 1;
      stat.meanMs = Math.round((stat.meanMs * (stat.runs - 1) + durationMs) / stat.runs);
      if (outcome === "succeeded") stat.succeeded += 1;
      else stat.failed += 1;
    }
    stat.lastRunAt = now;
    if (outcome !== "succeeded" && error) {
      const trimmed = error.slice(0, 300);
      stat.lastError = trimmed;
      stat.lastErrorAt = now;
      stat.recentErrors = [{ at: now, error: trimmed }, ...stat.recentErrors].slice(0, 5);
    }
    this.stats.set(tool, stat);
    try {
      KvStore.getInstance().set(KEY, [...this.stats.values()]);
    } catch {
      /* best-effort */
    }
  }

  public get(tool: string): ToolStat | undefined {
    return this.stats.get(tool);
  }

  public all(): ToolStat[] {
    return [...this.stats.values()];
  }

  /** Failures (and refusals) recorded since `since`, per tool. */
  public failuresSince(since: number): Array<{ tool: string; errors: string[] }> {
    const out: Array<{ tool: string; errors: string[] }> = [];
    for (const stat of this.stats.values()) {
      const errors = stat.recentErrors.filter((entry) => entry.at >= since).map((entry) => entry.error);
      if (errors.length) out.push({ tool: stat.tool, errors });
    }
    return out;
  }

  /** Forget everything (tests). */
  public reset(): void {
    this.stats.clear();
    try {
      KvStore.getInstance().remove(KEY);
    } catch {
      /* best-effort */
    }
  }
}
