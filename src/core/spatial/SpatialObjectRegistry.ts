/**
 * ==========================================================
 * LÉLU — SPATIAL OBJECT REGISTRY
 *
 * The authoritative store of spatial objects. Reads are open;
 * the ONE write path takes a SpatialWriteSeal, which only
 * SpatialSceneGraph can obtain after a verified commit. A plain
 * object shaped like a seal is refused at runtime.
 *
 * Identity is authored here, never by the caller: ids are
 * generated (`spatial-box-1`) and names are de-duplicated
 * (`Cube 1`, `Cube 2`), so two objects can never collide and a
 * later "move the cube" always resolves to exactly one record.
 * ==========================================================
 */

import {
  SPATIAL_PRIMITIVE_LABELS,
  type SpatialObject,
  type SpatialPrimitiveKind,
} from "./SpatialTypes";
import { isSpatialWriteSeal } from "./SpatialSeal";

/** Spoken primitive words → the kind they name. */
const PRIMITIVE_ALIASES: Record<string, SpatialPrimitiveKind> = {
  box: "box",
  boxes: "box",
  cube: "box",
  cubes: "box",
  sphere: "sphere",
  spheres: "sphere",
  orb: "sphere",
  orbs: "sphere",
  ball: "sphere",
  balls: "sphere",
  cylinder: "cylinder",
  cylinders: "cylinder",
  pillar: "cylinder",
  pillars: "cylinder",
  cone: "cone",
  cones: "cone",
  torus: "torus",
  ring: "torus",
  rings: "torus",
  donut: "torus",
  plane: "plane",
  planes: "plane",
  floor: "plane",
};

export default class SpatialObjectRegistry {
  private static instance: SpatialObjectRegistry | null = null;

  private readonly objects = new Map<string, SpatialObject>();
  private sequence = 0;

  public static getInstance(): SpatialObjectRegistry {
    if (!SpatialObjectRegistry.instance) {
      SpatialObjectRegistry.instance = new SpatialObjectRegistry();
    }
    return SpatialObjectRegistry.instance;
  }

  /** Every object, oldest first — the order objects were authored in. */
  public all(): SpatialObject[] {
    return [...this.objects.values()].sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt,
    );
  }

  public get(id: string): SpatialObject | undefined {
    return this.objects.get(id);
  }

  public count(): number {
    return this.objects.size;
  }

  public ids(): Set<string> {
    return new Set(this.objects.keys());
  }

  public findByName(name: string): SpatialObject | undefined {
    const key = name.trim().toLowerCase();
    return this.all().find((object) => object.name.toLowerCase() === key);
  }

  /**
   * Resolve a human reference to one object.
   *
   * Order is deliberate: exact id, exact name, then the most
   * recently authored object of that primitive kind, then a
   * unique partial name. Ambiguity resolves to the newest
   * match rather than throwing — and the caller is told which
   * object it got, by name and id.
   */
  public resolve(reference: string): SpatialObject | undefined {
    const trimmed = reference.trim();
    if (!trimmed) return undefined;

    const byId = this.objects.get(trimmed);
    if (byId) return byId;

    const key = trimmed.toLowerCase().replace(/^(the|my|a|an)\s+/, "");
    const all = this.all();

    const exact = all.find((object) => object.name.toLowerCase() === key);
    if (exact) return exact;

    const kind = PRIMITIVE_ALIASES[key];
    if (kind) {
      const matches = all.filter((object) => object.kind === kind);
      if (matches.length > 0) return matches[matches.length - 1];
    }

    const partial = all.filter((object) => object.name.toLowerCase().includes(key));
    if (partial.length === 1) return partial[0];
    return undefined;
  }

  /** Describe the current contents for a refusal message. */
  public describeContents(): string[] {
    return this.all().map((object) => `"${object.name}" (${object.kind})`);
  }

  public nextId(kind: SpatialPrimitiveKind): string {
    let candidate = "";
    do {
      this.sequence += 1;
      candidate = `spatial-${kind}-${this.sequence}`;
    } while (this.objects.has(candidate));
    return candidate;
  }

  public nextName(kind: SpatialPrimitiveKind): string {
    const base = SPATIAL_PRIMITIVE_LABELS[kind];
    let index = 1;
    while (this.findByName(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  /** De-duplicate a caller-supplied name against existing objects. */
  public uniqueName(name: string, kind: SpatialPrimitiveKind): string {
    const trimmed = name.trim().slice(0, 48);
    if (!trimmed) return this.nextName(kind);
    if (!this.findByName(trimmed)) return trimmed;
    let index = 2;
    while (this.findByName(`${trimmed} ${index}`)) index += 1;
    return `${trimmed} ${index}`;
  }

  /**
   * The ONLY write path. Refuses anything that is not a seal this
   * process actually issued, so a direct call cannot imitate a
   * verified commit.
   */
  public write(next: Map<string, SpatialObject>, seal: unknown): boolean {
    if (!isSpatialWriteSeal(seal)) return false;
    this.objects.clear();
    for (const [id, object] of next) {
      this.objects.set(id, object);
    }
    return true;
  }

  /** Test seam — restores a pristine registry. */
  public reset(): void {
    this.objects.clear();
    this.sequence = 0;
  }
}
