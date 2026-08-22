/**
 * ==========================================================
 * LÉLU
 * PERSONALITY GUARD — protected identity & personality core
 *
 * LÉLU's identity, personality and self-model are protected
 * assets. This guard layers versioning, provenance and rollback
 * over the EXISTING identity stores (SelfModel + AvatarStore)
 * without replacing them:
 *
 *   change → snapshot previous state (closure) → commit
 *          → record (source, trigger, reason, confidence,
 *            authorization, persistence decision)
 *   rollback(id) → restore the exact previous state
 *
 * External systems never call this directly; identity changes
 * still go through the existing controlled interfaces, which now
 * snapshot through the guard so every meaningful change is
 * traceable and reversible.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type PersonalitySource = "user" | "cognition" | "self-loop" | "executive" | "external";

export interface PersonalityChange {
  id: string;
  source: PersonalitySource;
  target: string;
  trigger: string;
  reason: string;
  confidence: number;
  authorized: boolean;
  persist: boolean;
  timestamp: number;
  /** Short, non-sensitive description of what changed. */
  summary: string;
}

const KEY = "personality.guard.v1";
const MAX_HISTORY = 60;

export default class PersonalityGuard {
  private static instance: PersonalityGuard | null = null;

  private readonly kv = KvStore.getInstance();
  /** Live restore closures — previous state is held in memory, never in KV. */
  private readonly restoreHandlers = new Map<string, () => void>();

  public static getInstance(): PersonalityGuard {
    if (!PersonalityGuard.instance) {
      PersonalityGuard.instance = new PersonalityGuard();
    }
    return PersonalityGuard.instance;
  }

  /**
   * Record a change and register a restore closure. Returns the change id
   * (call `rollback(id)` to restore the previous state for this session).
   */
  public record(change: {
    source: PersonalitySource;
    target: string;
    trigger?: string;
    reason?: string;
    confidence?: number;
    authorized?: boolean;
    persist?: boolean;
    summary: string;
    restore: () => void;
  }): string {
    const id = crypto.randomUUID();
    const full: PersonalityChange = {
      id,
      source: change.source,
      target: change.target,
      trigger: change.trigger ?? "identity-update",
      reason: change.reason ?? "",
      confidence: change.confidence ?? 0.9,
      authorized: change.authorized ?? true,
      persist: change.persist ?? true,
      summary: change.summary,
      timestamp: Date.now(),
    };

    if (full.persist) {
      this.restoreHandlers.set(id, change.restore);
      // Bound in-memory restore closures — oldest sessions expire first.
      if (this.restoreHandlers.size > MAX_HISTORY) {
        const oldest = this.restoreHandlers.keys().next().value;
        if (oldest) {
          this.restoreHandlers.delete(oldest);
        }
      }
    }

    // Store audit metadata only — never the previous snapshot (it can be
    // large and may hold private content). Rollback works while the session
    // is live; the history list is traceable metadata.
    const history = this.kv.get<PersonalityChange[]>(KEY) ?? [];
    history.push(full);
    this.kv.set(KEY, history.slice(-MAX_HISTORY));

    return id;
  }

  /** Audit trail (metadata only, newest first). */
  public history(): PersonalityChange[] {
    return (this.kv.get<PersonalityChange[]>(KEY) ?? []).slice().reverse();
  }

  /** Restore the previous state for a live change (session-scoped). */
  public rollback(id: string): boolean {
    const restore = this.restoreHandlers.get(id);
    if (!restore) {
      return false;
    }
    try {
      const history = this.kv.get<PersonalityChange[]>(KEY) ?? [];
      const record = history.find((item) => item.id === id);
      if (record) {
        this.appendMetadata({
          ...record,
          id: crypto.randomUUID(),
          summary: `Rolled back: ${record.summary}`,
          timestamp: Date.now(),
          authorized: true,
        });
      }
      restore();
      this.restoreHandlers.delete(id);
      return true;
    } catch (error) {
      console.error("[Lélu PersonalityGuard] rollback failed", error);
      return false;
    }
  }

  /** Reset the entire audit trail (used by an authorized identity reset). */
  public clearHistory(): void {
    this.kv.remove(KEY);
  }

  private appendMetadata(change: PersonalityChange): void {
    const history = this.kv.get<PersonalityChange[]>(KEY) ?? [];
    history.push(change);
    this.kv.set(KEY, history.slice(-MAX_HISTORY));
  }
}
