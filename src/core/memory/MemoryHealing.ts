/**
 * ==========================================================
 * LÉLU
 * BOOT-TIME MEMORY HEALING (M22.6, WP01)
 *
 * M22.5 could remove provable historical residue, but only
 * when a person opened the Memory panel and pressed a button.
 * Forgetting is a data-integrity operation, not a UI event, so
 * the same remediation now runs by itself once storage is up.
 *
 * Ordering, deliberately:
 *
 *   1. The deletion ledger is localStorage-backed and readable
 *      the moment the window exists, so it is available BEFORE
 *      any recall can happen. Nothing has to be "initialised".
 *   2. This scheduler starts only after Bootstrap's runtime step
 *      (stores, IndexedDB, providers) has finished.
 *   3. It never runs on the startup critical path: the first
 *      batch is scheduled for an idle moment, so the scene and
 *      the composer are never waiting on a scan.
 *   4. Each batch is detected first (dry run) and only then
 *      applied, and only for text a tombstone proves.
 *   5. Progress lives in the migration's own durable cursor, so
 *      a closed tab resumes where it stopped; the cursor is
 *      validated on read, so a corrupted one restarts cleanly
 *      instead of stalling forever.
 *   6. A lease in storage stops two tabs (or a second StrictMode
 *      mount) from healing at once.
 *
 * While a migration is running, recall is already protected:
 * DeletionGuard filters reads independently of whether the
 * stored copy has been cleaned yet.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import ResidueMigration, { type ResidueReport } from "./ResidueMigration";
import DeletionLedger from "./DeletionLedger";

export const HEALING_STATUS_KEY = "memory.healing.v1";
export const HEALING_LOCK_KEY = "memory.healing.lock.v1";

/** Projects per batch. Small enough that one batch never blocks a frame. */
export const HEALING_BATCH = 25;
/** A lease older than this is considered abandoned by a closed tab. */
const LEASE_MS = 60_000;
/** Safety valve: a runaway migration stops after this many batches per boot. */
const MAX_BATCHES = 400;

export type HealingState =
  | "idle"
  | "scheduled"
  | "running"
  | "complete"
  | "failed"
  | "skipped";

export interface HealingStatus {
  at: number;
  state: HealingState;
  /** Batches executed this boot. */
  batches: number;
  scannedProjects: number;
  /** Fields removed because a tombstone proved they quoted a deletion. */
  cleanedFields: number;
  /** Ambiguous legacy checkpoints left for the user. */
  quarantined: number;
  tombstones: number;
  durationMs: number;
  /** True when this run continued an interrupted one. */
  resumed: boolean;
  /** True when a stored cursor was unusable and scanning restarted. */
  recoveredCursor: boolean;
  /** Why the run stopped early, when it did. */
  reason?: string;
}

export default class MemoryHealing {
  private static instance: MemoryHealing | null = null;

  private readonly kv = KvStore.getInstance();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private scheduled = false;
  /** Set once per page load; a healer that finished must not re-run on remount. */
  private booted = false;

  public static getInstance(): MemoryHealing {
    if (!MemoryHealing.instance) MemoryHealing.instance = new MemoryHealing();
    return MemoryHealing.instance;
  }

  public status(): HealingStatus | null {
    return this.kv.get<HealingStatus>(HEALING_STATUS_KEY) ?? null;
  }

  /**
   * Ask for healing. Returns immediately; `status()` says what happened.
   *
   * Idempotent per page load and safe under React StrictMode double-mount or a
   * second caller in the same tick.
   */
  public schedule(options: { delayMs?: number } = {}): HealingStatus {
    if (this.booted || this.scheduled || this.running) {
      return this.status() ?? this.idleStatus("scheduled");
    }
    this.booted = true;
    this.scheduled = true;

    const pending: HealingStatus = {
      at: Date.now(),
      state: "scheduled",
      batches: 0,
      scannedProjects: 0,
      cleanedFields: 0,
      quarantined: 0,
      tombstones: DeletionLedger.getInstance().entries().length,
      durationMs: 0,
      resumed: false,
      recoveredCursor: false,
    };
    this.kv.set(HEALING_STATUS_KEY, pending);

    const delay = options.delayMs ?? 0;
    const idle = (globalThis as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (delay === 0 && typeof idle === "function") {
      idle(() => void this.heal(), { timeout: 3_000 });
    } else {
      this.timer = setTimeout(() => void this.heal(), delay === 0 ? 1_500 : delay);
    }
    return pending;
  }

  /**
   * Run the healing batches now. Called by `schedule()` and available to the
   * verification scripts; never awaited by the UI.
   */
  public async heal(): Promise<HealingStatus> {
    if (this.running) return this.status() ?? this.idleStatus("running");
    if (!this.acquireLease()) {
      const skipped = { ...this.idleStatus("skipped"), reason: "another healer holds the lease" };
      this.kv.set(HEALING_STATUS_KEY, skipped);
      this.scheduled = false;
      return skipped;
    }

    this.running = true;
    this.scheduled = false;
    const startedAt = Date.now();
    const migration = ResidueMigration.getInstance();
    const tombstones = DeletionLedger.getInstance().entries().length;

    let batches = 0;
    let cleanedFields = 0;
    let scannedProjects = 0;
    let quarantined = 0;
    let resumed = false;
    let recoveredCursor = false;
    let reason: string | undefined;

    try {
      for (let index = 0; index < MAX_BATCHES; index += 1) {
        // 1. Look without touching.
        const plan: ResidueReport = migration.run({ dryRun: true, limit: HEALING_BATCH });
        resumed = resumed || plan.resumed;
        recoveredCursor = recoveredCursor || plan.recoveredCursor;
        quarantined = plan.quarantined.length;
        scannedProjects += plan.scannedProjects;

        if (plan.findings.length === 0) {
          // Nothing provable in this window. An interrupted run with a stored
          // cursor must still advance past it, or a scan that finds nothing
          // would loop on the same batch forever.
          if (plan.remainingProjects === 0) break;
          if (!plan.cursor && !plan.resumed) break;
          const advanced = migration.advanceCursor({ limit: HEALING_BATCH });
          batches += 1;
          if (!advanced) break;
          continue;
        }

        // 2. Then remove exactly what was proven, in the same window.
        const applied = migration.run({ dryRun: false, limit: HEALING_BATCH });
        batches += 1;
        cleanedFields += applied.cleanedFields;
        if (applied.remainingProjects === 0) break;
      }

      if (batches >= MAX_BATCHES) reason = "batch limit reached";
    } catch (error) {
      const failed: HealingStatus = {
        at: Date.now(),
        state: "failed",
        batches,
        scannedProjects,
        cleanedFields,
        quarantined,
        tombstones,
        durationMs: Math.round(Date.now() - startedAt),
        resumed,
        recoveredCursor,
        reason: error instanceof Error ? error.message : String(error),
      };
      this.kv.set(HEALING_STATUS_KEY, failed);
      this.running = false;
      this.releaseLease();
      return failed;
    }

    const done: HealingStatus = {
      at: Date.now(),
      state: "complete",
      batches,
      scannedProjects,
      cleanedFields,
      quarantined,
      tombstones,
      durationMs: Math.round(Date.now() - startedAt),
      resumed,
      recoveredCursor,
      ...(reason ? { reason } : {}),
    };
    this.kv.set(HEALING_STATUS_KEY, done);
    this.running = false;
    this.releaseLease();
    return done;
  }

  /** The last run, or a zeroed record when healing has not happened yet. */
  private idleStatus(state: HealingState): HealingStatus {
    return {
      at: Date.now(),
      state,
      batches: 0,
      scannedProjects: 0,
      cleanedFields: 0,
      quarantined: 0,
      tombstones: DeletionLedger.getInstance().entries().length,
      durationMs: 0,
      resumed: false,
      recoveredCursor: false,
    };
  }

  /**
   * Cross-tab lease. Not a mutex — storage has none — but two tabs healing the
   * same projects concurrently would double-count removals, and the migration
   * is idempotent only when runs are serialised. A stale lease is taken over.
   */
  private acquireLease(): boolean {
    const now = Date.now();
    const held = this.kv.get<{ owner: string; at: number }>(HEALING_LOCK_KEY);
    if (held && typeof held.at === "number" && now - held.at < LEASE_MS) {
      return false;
    }
    return this.kv.set(HEALING_LOCK_KEY, { owner: crypto.randomUUID(), at: now });
  }

  private releaseLease(): void {
    this.kv.remove(HEALING_LOCK_KEY);
  }

  /** Cancel a scheduled (not yet started) run — used on runtime shutdown. */
  public cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.scheduled = false;
    this.releaseLease();
  }

  /** Test seam. */
  public static reset(): void {
    MemoryHealing.instance = null;
  }
}
