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
  /** When each tool's constraint was lifted — so a merge from another device cannot resurrect it. */
  liftedConstraints: Array<{ tool: string; at: number }>;
}

export type LedgerSnapshot = LedgerState;

/** Each record keeps its most recent steps; the full history is not needed to act and would bloat sync. */
const TRAIL_CAP = 40;

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
      liftedConstraints: Array.isArray(stored?.liftedConstraints) ? stored.liftedConstraints : [],
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
      if (updated.trail.length > TRAIL_CAP) updated = { ...updated, trail: updated.trail.slice(-TRAIL_CAP) };
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
    this.state.liftedConstraints = [...this.state.liftedConstraints.filter((item) => item.tool !== tool), { tool, at: Date.now() }].slice(-100);
    this.persist();
  }

  /** The whole ledger, for cross-device sync through the existing persistence layer. */
  public snapshot(): LedgerSnapshot {
    return JSON.parse(JSON.stringify(this.state)) as LedgerSnapshot;
  }

  /**
   * Merge another device's ledger. Records: newer update wins. Constraints:
   * newer wins, and one lifted after it was learned stays lifted.
   * Strategies: newer verification wins.
   */
  public mergeRemote(remote: Partial<LedgerSnapshot>): void {
    const byId = new Map(this.state.curiosities.map((item) => [item.id, item]));
    let changed = false;
    for (const item of Array.isArray(remote.curiosities) ? remote.curiosities : []) {
      const local = byId.get(item.id);
      if (!local || item.updatedAt > local.updatedAt) {
        byId.set(item.id, item);
        changed = true;
      }
    }
    const lifted = new Map<string, number>();
    for (const item of [...this.state.liftedConstraints, ...(Array.isArray(remote.liftedConstraints) ? remote.liftedConstraints : [])]) {
      lifted.set(item.tool, Math.max(lifted.get(item.tool) ?? 0, item.at));
    }
    const constraints = new Map<string, ToolConstraint>();
    for (const rule of [...this.state.constraints, ...(Array.isArray(remote.constraints) ? remote.constraints : [])]) {
      const key = `${rule.tool}::${rule.scope}`;
      const existing = constraints.get(key);
      if ((lifted.get(rule.tool) ?? 0) >= rule.at) continue;
      if (!existing || rule.at > existing.at) constraints.set(key, rule);
    }
    const strategies = new Map<string, LearnedStrategy>();
    for (const item of [...this.state.strategies, ...(Array.isArray(remote.strategies) ? remote.strategies : [])]) {
      const key = `${item.forTool}::${item.alternative}`;
      const existing = strategies.get(key);
      if (!existing || item.verifiedAt > existing.verifiedAt) strategies.set(key, item);
    }
    const next: LedgerState = {
      curiosities: [...byId.values()],
      constraints: [...constraints.values()],
      strategies: [...strategies.values()].slice(-40),
      liftedConstraints: [...lifted.entries()].map(([tool, at]) => ({ tool, at })),
      lastCapabilityScanAt: Math.max(this.state.lastCapabilityScanAt, typeof remote.lastCapabilityScanAt === "number" ? remote.lastCapabilityScanAt : 0),
    };
    if (changed || JSON.stringify(next.constraints) !== JSON.stringify(this.state.constraints) || JSON.stringify(next.strategies) !== JSON.stringify(this.state.strategies)) {
      this.state = next;
      this.persist();
    }
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
