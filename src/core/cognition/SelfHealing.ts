/**
 * ==========================================================
 * LÉLU SELF-HEALING — Verification, Checkpoints, Rollback
 *
 * Before risky modifications: CREATE CHECKPOINT
 * After modification: VERIFY
 * If verification fails: ROLL BACK
 * Maintain known-good state.
 *
 * LÉLU never destroys her functioning environment because
 * an attempted change failed.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import LeluRuntime from "../runtime/LeluRuntime";

export interface Checkpoint {
  id: string;
  label: string;
  data: Record<string, unknown>;
  timestamp: number;
  parent?: string;
}

export interface VerificationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
  timestamp: number;
}

const CHECKPOINTS_KEY = "lelu.selfhealing.checkpoints.v1";
const MAX_CHECKPOINTS = 30;

type SelfHealingListener = (event: { type: string; message: string; checkpointId?: string }) => void;

export default class SelfHealing {
  private static instance: SelfHealing | null = null;
  private checkpoints: Checkpoint[] = [];
  private listeners = new Set<SelfHealingListener>();

  private constructor() {
    this.checkpoints = this.load();
  }

  static getInstance(): SelfHealing {
    if (!SelfHealing.instance) {
      SelfHealing.instance = new SelfHealing();
    }
    return SelfHealing.instance;
  }

  // ---------- CHECKPOINTS ----------

  /** Create a checkpoint before a risky operation. */
  createCheckpoint(label: string, data: Record<string, unknown> = {}): Checkpoint {
    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(),
      label,
      data,
      timestamp: Date.now(),
      parent: this.checkpoints[0]?.id,
    };

    this.checkpoints.unshift(checkpoint);
    if (this.checkpoints.length > MAX_CHECKPOINTS) {
      this.checkpoints = this.checkpoints.slice(0, MAX_CHECKPOINTS);
    }
    this.persist();

    LeluRuntime.getInstance().recordActivity(`Checkpoint created: ${label}`);
    this.emit({ type: "checkpoint_created", message: `Checkpoint: ${label}`, checkpointId: checkpoint.id });
    return checkpoint;
  }

  /** Get a checkpoint by ID. */
  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.find((c) => c.id === id);
  }

  /** Get the most recent checkpoint. */
  latestCheckpoint(): Checkpoint | null {
    return this.checkpoints[0] ?? null;
  }

  /** List all checkpoints. */
  listCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  // ---------- VERIFICATION ----------

  /** Run a set of verification checks after an operation. */
  async verify(checks: Array<() => Promise<{ passed: boolean; message: string } | boolean>>): Promise<VerificationResult> {
    const results: VerificationResult["checks"] = [];

    for (let i = 0; i < checks.length; i++) {
      try {
        const result = await checks[i]();
        const passed = typeof result === "boolean" ? result : result.passed;
        const message = typeof result === "boolean"
          ? (passed ? "Check passed" : "Check failed")
          : result.message;
        results.push({ name: `Check ${i + 1}`, passed, message });
      } catch (error) {
        results.push({
          name: `Check ${i + 1}`,
          passed: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const verification: VerificationResult = {
      passed: results.every((r) => r.passed),
      checks: results,
      timestamp: Date.now(),
    };

    if (verification.passed) {
      LeluRuntime.getInstance().recordActivity("Verification passed");
      this.emit({ type: "verification_passed", message: "All checks passed" });
    } else {
      const failed = results.filter((r) => !r.passed);
      LeluRuntime.getInstance().recordActivity(`Verification failed: ${failed.map((r) => r.message).join("; ")}`);
      this.emit({ type: "verification_failed", message: `Failed: ${failed.map((r) => r.message).join("; ")}` });
    }

    return verification;
  }

  // ---------- ROLLBACK ----------

  /** Roll back to a specific checkpoint. */
  rollback(checkpointId: string): Record<string, unknown> | null {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (!checkpoint) {
      this.emit({ type: "rollback_failed", message: "Checkpoint not found" });
      return null;
    }

    LeluRuntime.getInstance().recordActivity(`Rollback to: ${checkpoint.label}`);
    this.emit({ type: "rollback", message: `Rolled back to: ${checkpoint.label}`, checkpointId });
    return checkpoint.data;
  }

  /** Roll back to the latest checkpoint. */
  rollbackLatest(): Record<string, unknown> | null {
    const latest = this.latestCheckpoint();
    if (!latest) {
      this.emit({ type: "rollback_failed", message: "No checkpoints available" });
      return null;
    }
    return this.rollback(latest.id);
  }

  // ---------- SAFE OPERATION PATTERN ----------

  /**
   * Execute a safe operation: checkpoint → action → verify → rollback if failed.
   */
  async safeOperation<T>(
    label: string,
    action: () => Promise<T>,
    verifyFn: (result: T) => Promise<boolean>,
    checkpointData: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; result?: T; error?: string }> {
    // 1. Create checkpoint
    const checkpoint = this.createCheckpoint(label, checkpointData);

    try {
      // 2. Execute action
      const result = await action();

      // 3. Verify
      const passed = await verifyFn(result);

      if (passed) {
        this.emit({ type: "operation_succeeded", message: `Operation succeeded: ${label}` });
        return { ok: true, result };
      }

      // 4. Verification failed → rollback
      this.emit({ type: "verification_failed", message: `Verification failed for: ${label}, rolling back` });
      this.rollback(checkpoint.id);
      return { ok: false, error: "Verification failed" };
    } catch (error) {
      // 5. Action failed → rollback
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "operation_failed", message: `Operation failed: ${label} — ${message}, rolling back` });
      this.rollback(checkpoint.id);
      return { ok: false, error: message };
    }
  }

  // ---------- CLEANUP ----------

  /** Remove old checkpoints (keep the most recent N). */
  cleanup(maxCount = 20): void {
    if (this.checkpoints.length > maxCount) {
      this.checkpoints = this.checkpoints.slice(0, maxCount);
      this.persist();
    }
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: SelfHealingListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: { type: string; message: string; checkpointId?: string }): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* swallow */ }
    }
  }

  // ---------- PERSISTENCE ----------

  private load(): Checkpoint[] {
    try { return KvStore.getInstance().get<Checkpoint[]>(CHECKPOINTS_KEY) ?? []; } catch { return []; }
  }

  private persist(): void {
    try { KvStore.getInstance().set(CHECKPOINTS_KEY, this.checkpoints); } catch { /* best-effort */ }
  }
}
