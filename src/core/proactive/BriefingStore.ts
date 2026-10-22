/**
 * ==========================================================
 * LÉLU — BRIEFINGS
 *
 * A briefing is something LÉLU has to tell you that is not a
 * reply to anything. It was being written as an ordinary
 * assistant ChatMessage, which made it indistinguishable from
 * a reply: permanent in the transcript, impossible to dismiss,
 * with no read state and no history of its own, and competing
 * for the same place on screen as the answer to the question
 * the user had just asked.
 *
 * It was also not cognitive. ProactiveBridge built one from a
 * string template on mount — because a React component had
 * mounted, not because anything had happened — and presented it
 * once per boot.
 *
 * So a briefing is its own entity with its own lifecycle, and
 * it is created from real transitions in the autonomous runtime.
 * It carries what it came from (objective, project,
 * conversation) so the user can go to the work rather than only
 * read about it.
 *
 * Conventions follow the other small stores (WorkQueue,
 * StudyObjectives, AgentObjectives): one KvStore key, a
 * subscription, a cap, and no second persistence path.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

const KEY = "lelu.briefings.v1";

/**
 * Kept so the panel has history rather than only the unread few.
 * Oldest are dropped first; the cap is per-device storage, not a
 * statement about what matters.
 */
const MAX_BRIEFINGS = 200;

export type BriefingPriority = "P0" | "P1" | "P2" | "P3";

/**
 * Why LÉLU is telling you this.
 *
 * Deliberately a small, closed set: a briefing with no category is a
 * briefing nobody can filter or reason about later.
 */
export type BriefingCategory =
  /** Autonomous work finished and produced something. */
  | "work-completed"
  /** Autonomous work stopped and will not continue without a decision. */
  | "work-stopped"
  /** Something was learned that changes what LÉLU will do next. */
  | "learning"
  /** A capability, provider or runtime changed state. */
  | "system";

export interface Briefing {
  id: string;
  title: string;
  /** One or two sentences. The panel is not a log viewer. */
  summary: string;
  category: BriefingCategory;
  priority: BriefingPriority;
  /** What produced it, in LÉLU's own words — never invented here. */
  reason?: string;
  relatedProjectId?: string;
  relatedObjectiveId?: string;
  /** Where to go to see the work itself, when there is somewhere. */
  conversationId?: string;
  createdAt: number;
  readAt?: number;
  dismissedAt?: number;
}

export type BriefingInput = Omit<Briefing, "id" | "createdAt" | "readAt" | "dismissedAt">;

type Listener = (briefings: Briefing[]) => void;

export default class BriefingStore {
  private static instance: BriefingStore | null = null;

  private readonly kv = KvStore.getInstance();
  private listeners = new Set<Listener>();

  private constructor() {}

  public static getInstance(): BriefingStore {
    if (!BriefingStore.instance) {
      BriefingStore.instance = new BriefingStore();
    }
    return BriefingStore.instance;
  }

  /* -------------------------------- reading ------------------------------- */

  /** Newest first. Dismissed briefings are history, not noise. */
  public list(): Briefing[] {
    const stored = this.kv.get<Briefing[]>(KEY);
    if (!Array.isArray(stored)) return [];
    return [...stored].sort((a, b) => b.createdAt - a.createdAt);
  }

  public get(id: string): Briefing | undefined {
    return this.list().find((briefing) => briefing.id === id);
  }

  /** What the user has not seen and has not put away. */
  public unread(): Briefing[] {
    return this.list().filter((briefing) => !briefing.readAt && !briefing.dismissedAt);
  }

  public unreadCount(): number {
    return this.unread().length;
  }

  /* -------------------------------- writing ------------------------------- */

  /**
   * Record a briefing.
   *
   * Returns the briefing, or the existing one when this is the same
   * briefing again: a runtime that completes the same objective twice
   * should not tell the user twice. Identity is the objective plus the
   * category, because the same objective finishing and the same
   * objective stopping are two different things to say.
   */
  public create(input: BriefingInput): Briefing {
    const existing = input.relatedObjectiveId
      ? this.list().find(
          (briefing) =>
            briefing.relatedObjectiveId === input.relatedObjectiveId &&
            briefing.category === input.category,
        )
      : undefined;
    if (existing) return existing;

    const briefing: Briefing = {
      ...input,
      summary: input.summary.trim(),
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    this.persist([briefing, ...this.list()].slice(0, MAX_BRIEFINGS));
    return briefing;
  }

  public markRead(id: string): Briefing | undefined {
    return this.patch(id, (briefing) =>
      briefing.readAt ? briefing : { ...briefing, readAt: Date.now() },
    );
  }

  public markAllRead(): void {
    const now = Date.now();
    const next = this.list().map((briefing) =>
      briefing.readAt ? briefing : { ...briefing, readAt: now },
    );
    this.persist(next);
  }

  /**
   * Put it away.
   *
   * Dismissing also marks it read: a briefing the user actively put
   * away has been seen, and leaving it unread would keep it in the
   * count.
   */
  public dismiss(id: string): Briefing | undefined {
    return this.patch(id, (briefing) => ({
      ...briefing,
      readAt: briefing.readAt ?? Date.now(),
      dismissedAt: briefing.dismissedAt ?? Date.now(),
    }));
  }

  /** Test seam, and the user's own "clear history". */
  public clear(): void {
    this.persist([]);
  }

  /* ------------------------------- events -------------------------------- */

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ------------------------------- internals ----------------------------- */

  private patch(id: string, change: (briefing: Briefing) => Briefing): Briefing | undefined {
    let updated: Briefing | undefined;
    const next = this.list().map((briefing) => {
      if (briefing.id !== id) return briefing;
      updated = change(briefing);
      return updated;
    });
    if (updated) this.persist(next);
    return updated;
  }

  private persist(briefings: Briefing[]): void {
    this.kv.set(KEY, briefings);
    const snapshot = this.list();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* a listener must never break the store */
      }
    }
  }
}
