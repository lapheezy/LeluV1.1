/**
 * ==========================================================
 * LÉLU — THE NEURAL MAP INDEX (Mission 17.2)
 *
 * The one place every interface asks "what is this, what is it part
 * of, where did it come from, what can act on it?". It is an index
 * over the authorities (see NeuralMapTypes), rebuilt per authority:
 *
 *   - each authority owns one PARTITION; when that authority changes,
 *     only its partition is recomputed and swapped in. A moved object
 *     never rebuilds rooms, tools or interfaces;
 *   - it persists nothing of its own: a reload re-derives it from the
 *     authorities' own persisted state, so it cannot drift from them or
 *     duplicate them;
 *   - it writes nothing: operations go through the existing tools.
 *
 * Every update is timed (lastUpdate / updateStats) so the cost of
 * keeping the map live is a measurement, not a claim.
 * ==========================================================
 */

import {
  NEURAL_RELATION_TYPES,
  type NeuralAuthority,
  type NeuralEntity,
  type NeuralPartition,
  type NeuralRelation,
  type NeuralRelationType,
} from "./NeuralMapTypes";

export interface NeuralUpdate {
  authority: NeuralAuthority;
  ms: number;
  entities: number;
  relations: number;
  /** Entities added, removed or changed by this update. */
  changed: string[];
  version: number;
}

export interface NeuralQuery {
  text?: string;
  types?: NeuralEntity["type"][];
  authorities?: NeuralAuthority[];
  states?: NeuralEntity["state"][];
  limit?: number;
}

export interface Neighbor {
  relation: NeuralRelation;
  direction: "out" | "in";
  entity: NeuralEntity | undefined;
}

type Listener = (update: NeuralUpdate) => void;

const signature = (e: NeuralEntity) =>
  `${e.label}|${e.state}|${e.updatedAt}|${e.spatial?.position.join(",") ?? ""}|${e.spatial?.scale ?? ""}|${e.provenance.length}|${e.operations.join(",")}|${JSON.stringify(e.facts)}`;

export class NeuralMapIndex {
  private readonly partitions = new Map<NeuralAuthority, NeuralPartition>();
  /** id → (authority → entity): a record referenced by two authorities is one entity. */
  private readonly entities = new Map<string, Map<NeuralAuthority, NeuralEntity>>();
  private readonly out = new Map<string, Map<string, NeuralRelation>>();
  private readonly into = new Map<string, Map<string, NeuralRelation>>();
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private updates: NeuralUpdate[] = [];
  private noops = 0;

  /** Replace one authority's partition. Cost is proportional to that partition only. */
  setPartition(next: NeuralPartition): NeuralUpdate {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const before = this.partitions.get(next.authority);
    const changed = new Set<string>();
    const oldSig = new Map((before?.entities ?? []).map((e) => [e.id, signature(e)]));

    if (before) {
      for (const e of before.entities) {
        const slot = this.entities.get(e.id);
        slot?.delete(next.authority);
        if (slot && slot.size === 0) this.entities.delete(e.id);
      }
      for (const r of before.relations) this.unlink(r);
    }
    for (const e of next.entities) {
      let slot = this.entities.get(e.id);
      if (!slot) this.entities.set(e.id, (slot = new Map()));
      slot.set(next.authority, e);
      if (oldSig.get(e.id) !== signature(e)) changed.add(e.id);
      oldSig.delete(e.id);
    }
    for (const gone of oldSig.keys()) changed.add(gone);
    const beforeRel = new Set((before?.relations ?? []).map((r) => r.id));
    for (const r of next.relations) {
      this.link(r);
      if (!beforeRel.has(r.id)) {
        changed.add(r.from);
        changed.add(r.to);
      }
      beforeRel.delete(r.id);
    }
    for (const goneRel of beforeRel) {
      const [from, , to] = goneRel.split("|");
      changed.add(from);
      changed.add(to);
    }
    this.partitions.set(next.authority, next);
    if (before && changed.size === 0) {
      // The authority notified but nothing the map holds changed (a store
      // that re-emits on unrelated writes): swap silently — no new version,
      // no listener wake-up, no re-render anywhere.
      this.noops += 1;
      return { authority: next.authority, ms: 0, entities: next.entities.length, relations: next.relations.length, changed: [], version: this.version };
    }
    this.version += 1;
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const update: NeuralUpdate = {
      authority: next.authority,
      ms: Math.round((t1 - t0) * 1000) / 1000,
      entities: next.entities.length,
      relations: next.relations.length,
      changed: [...changed],
      version: this.version,
    };
    this.updates = [...this.updates.slice(-99), update];
    for (const l of this.listeners) {
      try {
        l(update);
      } catch {
        // one view must not break the others
      }
    }
    return update;
  }

  private link(r: NeuralRelation): void {
    if (!this.out.has(r.from)) this.out.set(r.from, new Map());
    if (!this.into.has(r.to)) this.into.set(r.to, new Map());
    this.out.get(r.from)!.set(r.id, r);
    this.into.get(r.to)!.set(r.id, r);
  }

  private unlink(r: NeuralRelation): void {
    this.out.get(r.from)?.delete(r.id);
    this.into.get(r.to)?.delete(r.id);
  }

  /* ----------------------------- reading ----------------------------- */

  get(id: string): NeuralEntity | undefined {
    const slot = this.entities.get(id);
    if (!slot) return undefined;
    // The authority that OWNS a thing wins over one that merely references it.
    for (const entity of slot.values()) if (entity.authority !== "referenced") return entity;
    return slot.values().next().value;
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  all(): NeuralEntity[] {
    return [...this.entities.keys()].map((id) => this.get(id)!).filter(Boolean);
  }

  relations(id: string, opts: { direction?: "out" | "in" | "both"; types?: NeuralRelationType[] } = {}): Neighbor[] {
    const dir = opts.direction ?? "both";
    const want = (r: NeuralRelation) => !opts.types || opts.types.includes(r.type);
    const result: Neighbor[] = [];
    if (dir !== "in") for (const r of this.out.get(id)?.values() ?? []) if (want(r)) result.push({ relation: r, direction: "out", entity: this.get(r.to) });
    if (dir !== "out") for (const r of this.into.get(id)?.values() ?? []) if (want(r)) result.push({ relation: r, direction: "in", entity: this.get(r.from) });
    return result;
  }

  /** Follow one relation type outward until it stops: e.g. the chain of copies an object came from. */
  chain(id: string, type: NeuralRelationType, max = 32): NeuralEntity[] {
    const path: NeuralEntity[] = [];
    let cursor = id;
    const seen = new Set([id]);
    for (let i = 0; i < max; i++) {
      const next = [...(this.out.get(cursor)?.values() ?? [])].find((r) => r.type === type);
      if (!next || seen.has(next.to)) break;
      seen.add(next.to);
      const entity = this.get(next.to);
      if (!entity) break;
      path.push(entity);
      cursor = next.to;
    }
    return path;
  }

  search(q: NeuralQuery = {}): NeuralEntity[] {
    const text = q.text?.trim().toLowerCase();
    const hits = this.all().filter(
      (e) =>
        (!q.types || q.types.includes(e.type)) &&
        (!q.authorities || q.authorities.includes(e.authority)) &&
        (!q.states || q.states.includes(e.state)) &&
        (!text || e.label.toLowerCase().includes(text) || e.id.toLowerCase().includes(text) || e.type.includes(text)),
    );
    return hits.slice(0, q.limit ?? 500);
  }

  /** Relations whose other end is not in the map. Should be empty once every authority is connected. */
  dangling(): NeuralRelation[] {
    const result: NeuralRelation[] = [];
    for (const p of this.partitions.values()) for (const r of p.relations) if (!this.entities.has(r.from) || !this.entities.has(r.to)) result.push(r);
    return result;
  }

  /** Two entities claiming the same identity within one authority would be a duplicate. */
  duplicates(): string[] {
    const dups: string[] = [];
    for (const p of this.partitions.values()) {
      const seen = new Set<string>();
      for (const e of p.entities) {
        if (seen.has(e.id)) dups.push(e.id);
        seen.add(e.id);
      }
    }
    return dups;
  }

  stats(): { version: number; entities: number; relations: number; byAuthority: Record<string, { entities: number; relations: number }>; byRelation: Record<string, number> } {
    const byAuthority: Record<string, { entities: number; relations: number }> = {};
    const byRelation: Record<string, number> = Object.fromEntries(NEURAL_RELATION_TYPES.map((t) => [t, 0]));
    let relations = 0;
    for (const [a, p] of this.partitions) {
      byAuthority[a] = { entities: p.entities.length, relations: p.relations.length };
      relations += p.relations.length;
      for (const r of p.relations) byRelation[r.type] += 1;
    }
    return { version: this.version, entities: this.entities.size, relations, byAuthority, byRelation };
  }

  authorities(): NeuralAuthority[] {
    return [...this.partitions.keys()];
  }

  updateStats(): NeuralUpdate[] {
    return [...this.updates];
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Authority notifications that changed nothing in the map (skipped). */
  noopCount(): number {
    return this.noops;
  }

  /** How many views are listening — so a test (and the verifier) can see subscriptions are released. */
  listenerCount(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.partitions.clear();
    this.entities.clear();
    this.out.clear();
    this.into.clear();
    this.version = 0;
    this.updates = [];
  }
}

let shared: NeuralMapIndex | null = null;

/** The ONE map every interface reads. */
export function neuralMap(): NeuralMapIndex {
  if (!shared) shared = new NeuralMapIndex();
  return shared;
}
