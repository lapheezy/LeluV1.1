/**
 * ==========================================================
 * LÉLU — DAILY SELF-DISCOVERY SCHEDULER
 *
 * A real process, not a timer in a tab.
 *
 *   npx tsx scripts/lab-scheduler.ts                  # every 24h
 *   npx tsx scripts/lab-scheduler.ts --once           # one cycle, exit
 *   npx tsx scripts/lab-scheduler.ts --interval-ms 600000
 *
 * It runs the SAME engine the interface uses
 * (plugins/labEngine.ts), so there is exactly one discovery
 * implementation and the two can never disagree.
 *
 * What a cycle does, in order:
 *   1. git fetch + connectivity probe against the real remote
 *   2. inspect the tree and record findings
 *   3. reconcile earlier discoveries against this inspection
 *   4. append to the journal and write a heartbeat with the next run
 *
 * What it never does: push, merge, deploy, or touch the canonical
 * branch. It is read-and-record only. Experiments stay an
 * explicitly authorized action.
 *
 * Failure behaviour is deliberate: a failed cycle is recorded with its
 * error and the next attempt backs off (1×, 2×, 4× the interval, capped
 * at 6×). A scheduler that silently stops is worse than one that is
 * visibly broken.
 * ==========================================================
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLabEngine, LAB_STATE_DIR } from "../plugins/labEngine.ts";

export const HEARTBEAT_FILE = path.join(LAB_STATE_DIR, "scheduler.json");
export const SCHEDULER_LOG = path.join(LAB_STATE_DIR, "scheduler.log");
export const LOCK_FILE = path.join(LAB_STATE_DIR, "scheduler.lock");
export const CYCLE_LOCK_FILE = path.join(LAB_STATE_DIR, "cycle.lock");
export const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_BACKOFF_FACTOR = 6;
/** A cycle that has not finished in this long is not running, it is broken. */
export const CYCLE_LOCK_STALE_MS = 15 * 60 * 1000;

function alive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* single-instance lock                                                */
/* ------------------------------------------------------------------ */

export interface LockRecord {
  pid: number;
  at: number;
}

/**
 * Take the scheduler lock, or refuse.
 *
 * `wx` is the atomic part: the file is created only if it does not exist, so
 * two processes starting in the same instant cannot both believe they own the
 * laboratory. A lock whose pid is gone is stale and is taken over — otherwise
 * a crash would require a human to delete a file before discovery resumes.
 */
export function acquireLock(root: string, file = LOCK_FILE, now = Date.now()): { ok: boolean; held?: LockRecord; reason?: string } {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const existing = (() => {
    try {
      return JSON.parse(readFileSync(absolute, "utf8")) as LockRecord;
    } catch {
      return null;
    }
  })();
  if (existing && alive(existing.pid)) {
    return { ok: false, held: existing, reason: `already held by pid ${existing.pid}` };
  }
  try {
    writeFileSync(absolute, `${JSON.stringify({ pid: process.pid, at: now }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { ok: true, held: { pid: process.pid, at: now } };
  } catch {
    // Lost the race, or left behind by a dead process: inspect and decide.
    try {
      const current = JSON.parse(readFileSync(absolute, "utf8")) as LockRecord;
      if (alive(current.pid)) return { ok: false, held: current, reason: `already held by pid ${current.pid}` };
      writeFileSync(absolute, `${JSON.stringify({ pid: process.pid, at: now }, null, 2)}\n`, "utf8");
      return { ok: true, held: { pid: process.pid, at: now } };
    } catch {
      return { ok: false, reason: "could not read or write the lock file" };
    }
  }
}

export function releaseLock(root: string, file = LOCK_FILE, pid = process.pid): void {
  const absolute = path.join(root, file);
  try {
    const current = JSON.parse(readFileSync(absolute, "utf8")) as LockRecord;
    // Only the owner removes it: a replacement must not delete its successor's lock.
    if (current.pid === pid) rmSync(absolute, { force: true });
  } catch {
    /* nothing to release */
  }
}

/**
 * Run a cycle only if no other cycle is running.
 *
 * The daemon's own cycle and a `run-once` pressed in the interface must never
 * interleave: two inspections at once would write discoveries twice and give
 * the journal two contradictory "latest" entries.
 */
export async function withCycleLock<T>(
  root: string,
  work: () => Promise<T>,
  now = Date.now(),
  staleMs = CYCLE_LOCK_STALE_MS,
): Promise<{ ran: boolean; value?: T; reason?: string }> {
  const absolute = path.join(root, CYCLE_LOCK_FILE);
  const existing = (() => {
    try {
      return JSON.parse(readFileSync(absolute, "utf8")) as LockRecord;
    } catch {
      return null;
    }
  })();
  if (existing) {
    const expired = now - existing.at > staleMs;
    if (!expired && alive(existing.pid)) {
      return { ran: false, reason: `a cycle is already running (pid ${existing.pid}, started ${Math.round((now - existing.at) / 1000)}s ago)` };
    }
  }
  const taken = acquireLock(root, CYCLE_LOCK_FILE, now);
  if (!taken.ok) return { ran: false, reason: taken.reason };
  try {
    return { ran: true, value: await work() };
  } finally {
    releaseLock(root, CYCLE_LOCK_FILE);
  }
}

/**
 * Is the heartbeat believable?
 *
 * A file that says `running: true` is a claim; the process table is the
 * evidence. A dead pid, or a last cycle older than two intervals plus slack,
 * makes the scheduler stale — and a stale scheduler must be visible, not
 * silently assumed to be working.
 */
export function heartbeatStale(heartbeat: Heartbeat, now = Date.now()): { stale: boolean; reason?: string } {
  if (!heartbeat.running) return { stale: false };
  if (!alive(heartbeat.pid)) return { stale: true, reason: `pid ${heartbeat.pid ?? "?"} is not running` };
  if (heartbeat.lastCycleAt) {
    const limit = Math.max(heartbeat.intervalMs * 2, heartbeat.intervalMs + 10 * 60 * 1000);
    if (now - heartbeat.lastCycleAt > limit) {
      return { stale: true, reason: `no cycle since ${new Date(heartbeat.lastCycleAt).toISOString()}` };
    }
  }
  return { stale: false };
}

export interface Heartbeat {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  intervalMs: number;
  nextAt: number | null;
  cycles: number;
  ok: boolean | null;
  lastCycleAt: number | null;
  lastDiscoveryId: string | null;
  lastFindings: number | null;
  lastError: string | null;
  logFile: string;
  mode: "daemon" | "manual";
  /** Consecutive failures; resets to 0 on a good cycle. */
  failures?: number;
}

export function emptyHeartbeat(intervalMs = DEFAULT_INTERVAL_MS): Heartbeat {
  return {
    running: false,
    pid: null,
    startedAt: null,
    intervalMs,
    nextAt: null,
    cycles: 0,
    ok: null,
    lastCycleAt: null,
    lastDiscoveryId: null,
    lastFindings: null,
    lastError: null,
    logFile: SCHEDULER_LOG,
    mode: "manual",
    failures: 0,
  };
}

export function readHeartbeat(root: string): Heartbeat {
  const file = path.join(root, HEARTBEAT_FILE);
  if (!existsSync(file)) return emptyHeartbeat();
  try {
    return { ...emptyHeartbeat(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Heartbeat>) };
  } catch {
    return emptyHeartbeat();
  }
}

export function writeHeartbeat(root: string, patch: Partial<Heartbeat>): Heartbeat {
  const next = { ...readHeartbeat(root), ...patch };
  mkdirSync(path.join(root, LAB_STATE_DIR), { recursive: true });
  writeFileSync(path.join(root, HEARTBEAT_FILE), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** Exponential backoff, capped, so a broken remote does not spin. */
export function backoffMs(intervalMs: number, failures: number): number {
  const factor = Math.min(MAX_BACKOFF_FACTOR, Math.max(1, 2 ** Math.max(0, failures - 1)));
  return intervalMs * factor;
}

export interface CycleResult {
  ok: boolean;
  at: number;
  durationMs: number;
  discoveryId: string | null;
  findings: number;
  priority: number | null;
  reconciled: string[];
  error?: string;
}

/**
 * One full discovery cycle.
 *
 * Exported so a test runs the identical code path the daemon runs — a test
 * against a copy of the cycle would prove nothing about the scheduler.
 */
export async function runCycle(root: string, options: { log?: (line: string) => void } = {}): Promise<CycleResult> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const started = Date.now();
  const engine = createLabEngine(root);
  try {
    const synced = await engine.sync();
    log(
      `[lab-scheduler] sync ok=${synced.sync.ok} commit=${synced.sync.commit.slice(0, 7)} remoteHeads=${synced.sync.remoteHeads.length}${
        synced.sync.error ? ` error=${synced.sync.error}` : ""
      }`,
    );

    const before = engine.discoveries();
    const openHigh = before
      .filter((discovery) => discovery.status !== "resolved")
      .flatMap((discovery) => discovery.findings.filter((finding) => finding.severity === "high"))
      .map((finding) => finding.id);

    const discovery = await engine.inspect();
    const currentIds = new Set(discovery.findings.map((finding) => finding.id));
    const nowReconciled = [...new Set(openHigh)].filter((id) => !currentIds.has(id));

    // Reconciliation is recorded, never assumed: the inspection that found a
    // defect is the instrument that must stop finding it.
    if (nowReconciled.length > 0) {
      const history = engine.discoveries();
      writeFileSync(
        path.join(root, LAB_STATE_DIR, "discoveries.json"),
        `${JSON.stringify(
          history.map((entry) => {
            const gone = entry.findings.filter(
              (finding) => finding.severity === "high" && nowReconciled.includes(finding.id) && entry.status !== "resolved",
            );
            if (gone.length === 0) return entry;
            return {
              ...entry,
              status: "resolved" as const,
              resolvedBy: `Cycle ${discovery.id} no longer reports: ${gone.map((finding) => finding.id).join(", ")}`,
            };
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    engine.appendJournal({
      at: Date.now(),
      kind: "scheduler-cycle",
      discoveryId: discovery.id,
      findings: discovery.findings.length,
      priority: discovery.priority.score,
      status: discovery.status,
      reconciled: nowReconciled,
      durationMs: Date.now() - started,
    });

    const heartbeat = readHeartbeat(root);
    writeHeartbeat(root, {
      cycles: heartbeat.cycles + 1,
      ok: true,
      lastCycleAt: Date.now(),
      lastDiscoveryId: discovery.id,
      lastFindings: discovery.findings.length,
      lastError: null,
      failures: 0,
      nextAt: Date.now() + heartbeat.intervalMs,
      mode: "daemon",
    });
    log(
      `[lab-scheduler] discovery ${discovery.id} findings=${discovery.findings.length} priority=${discovery.priority.score} status=${discovery.status} reconciled=${nowReconciled.length} ${Date.now() - started}ms`,
    );

    return {
      ok: true,
      at: Date.now(),
      durationMs: Date.now() - started,
      discoveryId: discovery.id,
      findings: discovery.findings.length,
      priority: discovery.priority.score,
      reconciled: nowReconciled,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const heartbeat = readHeartbeat(root);
    const failures = (heartbeat.failures ?? 0) + 1;
    const delay = backoffMs(heartbeat.intervalMs, failures);
    writeHeartbeat(root, {
      ok: false,
      lastCycleAt: Date.now(),
      lastError: message.slice(0, 600),
      failures,
      nextAt: Date.now() + delay,
      mode: "daemon",
    });
    engine.appendJournal({ at: Date.now(), kind: "scheduler-failure", error: message.slice(0, 600), failures });
    log(`[lab-scheduler] cycle failed (attempt ${failures}): ${message}`);
    return {
      ok: false,
      at: Date.now(),
      durationMs: Date.now() - started,
      discoveryId: null,
      findings: 0,
      priority: null,
      reconciled: [],
      error: message,
    };
  }
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const once = process.argv.includes("--once");
  const maxCycles = Number(argValue("--max-cycles") ?? 0) || 0;
  const intervalMs = Math.max(1_000, Number(argValue("--interval-ms") ?? DEFAULT_INTERVAL_MS) || DEFAULT_INTERVAL_MS);

  /*
   * One instance. A second start must refuse, not race: two daemons would
   * double every discovery in the journal and fight over the same heartbeat.
   */
  const lock = acquireLock(root);
  if (!lock.ok) {
    process.stderr.write(`[lab-scheduler] refusing to start — ${lock.reason}\n`);
    process.exit(3);
  }

  const existing = readHeartbeat(root);
  const previousPid = existing.pid;
  const recovered = previousPid !== null && previousPid !== process.pid && !alive(previousPid);
  writeHeartbeat(root, {
    running: true,
    pid: process.pid,
    startedAt: Date.now(),
    intervalMs,
    mode: "daemon",
    nextAt: Date.now() + (once ? 0 : intervalMs),
    logFile: SCHEDULER_LOG,
    ...(recovered
      ? { lastError: `previous instance pid ${previousPid} ended without a clean shutdown; recovered at ${new Date().toISOString()}` }
      : {}),
  });
  if (recovered) {
    // Recorded, not hidden: a crash is part of the laboratory's history.
    createLabEngine(root).appendJournal({
      at: Date.now(),
      kind: "scheduler-recovered",
      previousPid,
      cyclesBefore: existing.cycles,
    });
    process.stdout.write(`[lab-scheduler] recovered from pid ${previousPid} that did not shut down cleanly\n`);
  }

  const shutdown = (signal: string) => {
    writeHeartbeat(root, { running: false, pid: null, nextAt: null });
    releaseLock(root);
    releaseLock(root, CYCLE_LOCK_FILE);
    process.stdout.write(`[lab-scheduler] ${signal} — heartbeat closed, lock released\n`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("exit", () => releaseLock(root));

  let cycles = 0;
  for (;;) {
    const guarded = await withCycleLock(root, () => runCycle(root));
    cycles += 1;
    if (!guarded.ran) {
      process.stdout.write(`[lab-scheduler] skipping this cycle — ${guarded.reason}\n`);
    } else {
      const result = guarded.value!;
      const heartbeat = readHeartbeat(root);
      const delay = result.ok ? heartbeat.intervalMs : backoffMs(heartbeat.intervalMs, heartbeat.failures ?? 1);
      writeHeartbeat(root, { nextAt: Date.now() + delay });
      if (once) {
        writeHeartbeat(root, { running: false, pid: null });
        releaseLock(root);
        process.exit(result.ok ? 0 : 1);
      }
      if (maxCycles > 0 && cycles >= maxCycles) {
        writeHeartbeat(root, { running: false, pid: null, nextAt: null });
        releaseLock(root);
        process.stdout.write(`[lab-scheduler] completed ${cycles} cycle(s) — exiting as asked\n`);
        process.exit(0);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (once || (maxCycles > 0 && cycles >= maxCycles)) {
      writeHeartbeat(root, { running: false, pid: null, nextAt: null });
      releaseLock(root);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, intervalMs)));
  }
}

const invokedDirectly = /lab-scheduler\.(ts|mjs|js)$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  void main();
}
