/**
 * ==========================================================
 * LÉLU — CURIOSITY LEDGER
 *
 * The lifecycle record of each curiosity: what was wondered,
 * what was tried, what was found, what it changed. It is NOT a
 * knowledge store — learnings go through AIService.consolidate
 * into the Brain, and a record only points at them. Same
 * KvStore persistence as StudyObjectives and ProactiveCore,
 * with an in-memory copy so it also works where KvStore is a
 * no-op (Node).
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import {
  compareCuriosities,
  NEAR_DUPLICATE,
  similarity,
  type Curiosity,
  type CuriosityCategory,
  type CuriosityStatus,
  type LearnedStrategy,
  type ToolConstraint,
} from "./Curiosity";

const KEY = "curiosity.v1";
const ACTIVE_CAP = 40;
const HISTORY_CAP = 200;

const TERMINAL: ReadonlySet<CuriosityStatus> = new Set<CuriosityStatus>(["resolved", "dismissed", "expired"]);
const OPEN: ReadonlySet<CuriosityStatus> = new Set<CuriosityStatus>([
  "identified",
  "queued",
  "retrieving",
  "asking",
  "investigating",
  "verifying",
  "learned",
  "applied",
  "blocked",
  "revisiting",
]);

interface LedgerState {
  curiosities: Curiosity[];
  constraints: ToolConstraint[];
  lastCapabilityScanAt: number;
  /** Alternatives that were verified to work when a preferred capability could not be used. */
  strategies: LearnedStrategy[];
}

export function isTerminal(status: CuriosityStatus): boolean {
  return TERMINAL.has(status);
}

export default class CuriosityLedger {
  private static instance: CuriosityLedger | null = null;
  private state: LedgerState;
  private readonly listeners = new Set<() => void>();

  private constructor() {
    const stored = KvStore.getInstance().get<LedgerState>(KEY);
    this.state = {
      curiosities: Array.isArray(stored?.curiosities) ? stored.curiosities : [],
      constraints: Array.isArray(stored?.constraints) ? stored.constraints : [],
      lastCapabilityScanAt: typeof stored?.lastCapabilityScanAt === "number" ? stored.lastCapabilityScanAt : 0,
      strategies: Array.isArray(stored?.strategies) ? stored.strategies : [],
    };
  }

  public static getInstance(): CuriosityLedger {
    if (!CuriosityLedger.instance) CuriosityLedger.instance = new CuriosityLedger();
    return CuriosityLedger.instance;
  }

  /** Test seam. */
  public static reset(): void {
    KvStore.getInstance().remove(KEY);
    CuriosityLedger.instance = null;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    const open = this.state.curiosities.filter((item) => !TERMINAL.has(item.status));
    const closed = this.state.curiosities
      .filter((item) => TERMINAL.has(item.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, HISTORY_CAP);
    this.state.curiosities = [...open, ...closed];
    try {
      KvStore.getInstance().set(KEY, this.state);
    } catch {
      // best-effort, like every other KvStore owner
    }
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a broken listener never stops cognition */
      }
    }
  }

  public list(): Curiosity[] {
    return [...this.state.curiosities].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public get(id: string): Curiosity | undefined {
    return this.state.curiosities.find((item) => item.id === id);
  }

  public byKey(key: string): Curiosity | undefined {
    return this.state.curiosities.find((item) => item.key === key);
  }

  /** An open curiosity asking substantially the same thing, if one exists. */
  public findSimilar(category: CuriosityCategory, question: string): Curiosity | undefined {
    return this.state.curiosities.find(
      (item) => item.category === category && !TERMINAL.has(item.status) && similarity(item.question, question) >= NEAR_DUPLICATE,
    );
  }

  /** Open curiosities, in pursuit order. */
  public active(): Curiosity[] {
    return this.state.curiosities.filter((item) => OPEN.has(item.status)).sort(compareCuriosities);
  }

  /** Queued and not expired — what a tick may pick up. */
  public pursuable(now: number): Curiosity[] {
    return this.active().filter((item) => item.status === "queued" && item.expiresAt > now);
  }

  public insert(curiosity: Curiosity): void {
    this.state.curiosities = [curiosity, ...this.state.curiosities];
    this.enforceActiveCap(curiosity.updatedAt);
    this.persist();
  }

  public update(id: string, patch: Partial<Curiosity>): Curiosity | undefined {
    let updated: Curiosity | undefined;
    this.state.curiosities = this.state.curiosities.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...patch, updatedAt: Math.max(Date.now(), item.updatedAt) };
      return updated;
    });
    if (updated) this.persist();
    return updated;
  }

  /** Expire stale open curiosities. History is kept; only the active queue shrinks. */
  public expire(now: number): Curiosity[] {
    const expired: Curiosity[] = [];
    this.state.curiosities = this.state.curiosities.map((item) => {
      if (TERMINAL.has(item.status) || item.status === "asking" || item.status === "revisiting" || item.expiresAt > now) return item;
      const next: Curiosity = {
        ...item,
        status: "expired",
        updatedAt: now,
        trail: [...item.trail, { at: now, step: "expired", detail: "Its time window passed before it was resolved." }],
      };
      expired.push(next);
      return next;
    });
    if (expired.length > 0) this.persist();
    return expired;
  }

  /** A bounded queue: past the cap the lowest-ranked dormant/queued item is displaced, not deleted. */
  private enforceActiveCap(now: number): void {
    const open = this.state.curiosities.filter((item) => OPEN.has(item.status)).sort(compareCuriosities);
    if (open.length <= ACTIVE_CAP) return;
    const displaceable = open.filter((item) => item.status === "identified" || item.status === "queued").reverse();
    const toDisplace = new Set(displaceable.slice(0, open.length - ACTIVE_CAP).map((item) => item.id));
    this.state.curiosities = this.state.curiosities.map((item) =>
      toDisplace.has(item.id)
        ? {
            ...item,
            status: "expired",
            updatedAt: now,
            trail: [...item.trail, { at: now, step: "expired", detail: "Displaced by higher-priority curiosities (queue is bounded)." }],
          }
        : item,
    );
  }

  public constraints(): ToolConstraint[] {
    return [...this.state.constraints];
  }

  public addConstraint(rule: ToolConstraint): void {
    this.state.constraints = [
      ...this.state.constraints.filter((item) => !(item.tool === rule.tool && item.scope === rule.scope)),
      rule,
    ];
    this.persist();
  }

  public removeConstraint(tool: string): void {
    this.state.constraints = this.state.constraints.filter((item) => item.tool !== tool);
    this.persist();
  }

  public strategies(): LearnedStrategy[] {
    return [...this.state.strategies];
  }

  /** One current strategy per (preferred, alternative); a re-learned one replaces it. */
  public addStrategy(strategy: LearnedStrategy): void {
    this.state.strategies = [
      ...this.state.strategies.filter((item) => !(item.forTool === strategy.forTool && item.alternative === strategy.alternative)),
      strategy,
    ].slice(-40);
    this.persist();
  }

  public lastCapabilityScanAt(): number {
    return this.state.lastCapabilityScanAt;
  }

  public markCapabilityScan(at: number): void {
    this.state.lastCapabilityScanAt = at;
    this.persist();
  }

  public counts(): Record<CuriosityStatus, number> {
    const counts = {} as Record<CuriosityStatus, number>;
    for (const item of this.state.curiosities) counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }
}
