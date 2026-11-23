/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — COMPONENT GRAPH
 *
 * A character is not a bag of meshes. It is an articulated tree with worn
 * layers: the pelvis carries the torso, the torso carries the neck and the
 * arms, the neck carries the head, and clothing is worn *over* several of
 * them at once.
 *
 * The graph below encodes that structure once, so the engine can answer the
 * only question that makes incremental reconstruction worth anything:
 * after this change, which parts are actually stale? Changing a hairstyle
 * must return {hair}. Changing a sleeve must return {clothing}, not {face}.
 * Changing a proportion must return everything that is attached below it.
 *
 * Propagation is deliberately DOWNWARD only. A head that grows does not
 * force a new torso: the neck stretches. That is the difference between a
 * dependency graph and a "rebuild everything" pipeline.
 * ==========================================================
 */

import type { SparseVoxels } from "../nre/types.ts";
import { buildSparseVoxels, voxelCount } from "../nre/voxels.ts";
import type { AnalysisLattice } from "./lattice.ts";
import { cellToImage } from "./lattice.ts";
import type { BBox2D, ComponentId } from "./types.ts";
import { COMPONENT_IDS, COMPONENT_LABELS, bboxIsEmpty } from "./types.ts";

export interface ComponentNode {
  id: ComponentId;
  label: string;
  /** Structural parent in the articulation tree (null for the root). */
  parent: ComponentId | null;
  /** Parts whose geometry must be regenerated when this one changes. */
  dependents: ComponentId[];
  articulated: boolean;
  deformable: boolean;
  /** Relative cost of regenerating this part, used by the scheduler. */
  costUnits: number;
  /** Whether the part is separated as a solid or laid over other parts. */
  role: "structural" | "overlay";
  note: string;
}

/**
 * The graph. `dependents` is derived from `parent` in `buildComponentGraph`
 * below, so the two can never disagree.
 */
const NODES: Record<ComponentId, Omit<ComponentNode, "dependents">> = {
  pelvis: {
    id: "pelvis",
    label: COMPONENT_LABELS.pelvis,
    parent: null,
    articulated: false,
    deformable: false,
    costUnits: 3,
    role: "structural",
    note: "root of the articulation tree; body proportions are anchored here",
  },
  torso: {
    id: "torso",
    label: COMPONENT_LABELS.torso,
    parent: "pelvis",
    articulated: true,
    deformable: true,
    costUnits: 5,
    role: "structural",
    note: "spine and ribcage; carries the shoulders and the neck",
  },
  neck: {
    id: "neck",
    label: COMPONENT_LABELS.neck,
    parent: "torso",
    articulated: true,
    deformable: false,
    costUnits: 1,
    role: "structural",
    note: "short connector; a head-scale change stretches it rather than rebuilding the torso",
  },
  head: {
    id: "head",
    label: COMPONENT_LABELS.head,
    parent: "neck",
    articulated: true,
    deformable: false,
    costUnits: 4,
    role: "structural",
    note: "skull and jaw; the anchor for hair and face overlays",
  },
  hair: {
    id: "hair",
    label: COMPONENT_LABELS.hair,
    parent: "head",
    articulated: false,
    deformable: true,
    costUnits: 2,
    role: "overlay",
    note: "worn on the skull; a hairstyle change must never invalidate the body",
  },
  face: {
    id: "face",
    label: COMPONENT_LABELS.face,
    parent: "head",
    articulated: false,
    deformable: true,
    costUnits: 2,
    role: "overlay",
    note: "frontal head region; expression changes are deformations of this overlay only",
  },
  arms: {
    id: "arms",
    label: COMPONENT_LABELS.arms,
    parent: "torso",
    articulated: true,
    deformable: false,
    costUnits: 4,
    role: "structural",
    note: "shoulder to wrist; the most expensive part to infer from a silhouette",
  },
  hands: {
    id: "hands",
    label: COMPONENT_LABELS.hands,
    parent: "arms",
    articulated: true,
    deformable: true,
    costUnits: 2,
    role: "overlay",
    note: "not separable from the arm in a single silhouette; refined only with a hand view",
  },
  legs: {
    id: "legs",
    label: COMPONENT_LABELS.legs,
    parent: "pelvis",
    articulated: true,
    deformable: false,
    costUnits: 5,
    role: "structural",
    note: "hip to ankle; two limbs sharing one node, split at reconstruction time",
  },
  feet: {
    id: "feet",
    label: COMPONENT_LABELS.feet,
    parent: "legs",
    articulated: true,
    deformable: false,
    costUnits: 1,
    role: "structural",
    note: "contact with the ground; the only part whose height is pinned by the scene",
  },
  clothing: {
    id: "clothing",
    label: COMPONENT_LABELS.clothing,
    parent: "torso",
    articulated: false,
    deformable: true,
    costUnits: 6,
    role: "overlay",
    note: "a garment shell worn over torso, arms, pelvis and legs; follows all four",
  },
  accessories: {
    id: "accessories",
    label: COMPONENT_LABELS.accessories,
    parent: "torso",
    articulated: false,
    deformable: false,
    costUnits: 1,
    role: "overlay",
    note: "belts, jewellery, held objects; independent of every body part unless attached to one",
  },
};

export function buildComponentGraph(): Record<ComponentId, ComponentNode> {
  const graph = {} as Record<ComponentId, ComponentNode>;
  for (const id of COMPONENT_IDS) {
    graph[id] = { ...NODES[id], dependents: [] };
  }
  for (const id of COMPONENT_IDS) {
    const parent = graph[id].parent;
    if (parent) graph[parent].dependents.push(id);
  }
  return graph;
}

export const COMPONENT_GRAPH: Record<ComponentId, ComponentNode> = buildComponentGraph();

/** Edges with their meaning, for the documentation graph. */
export interface DependencyEdge {
  from: ComponentId;
  to: ComponentId;
  kind: "parent-of" | "worn-over";
  note: string;
}

export function dependencyEdges(): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const id of COMPONENT_IDS) {
    const node = COMPONENT_GRAPH[id];
    if (node.parent) {
      edges.push({
        from: node.parent,
        to: id,
        kind: node.role === "overlay" ? "worn-over" : "parent-of",
        note: node.role === "overlay" ? `${node.label} is worn over ${COMPONENT_LABELS[node.parent]}` : `${node.label} is carried by ${COMPONENT_LABELS[node.parent]}`,
      });
    }
  }
  // Clothing is worn over four parts, which a single parent cannot express.
  for (const part of ["arms", "pelvis", "legs"] as ComponentId[]) {
    edges.push({ from: part, to: "clothing", kind: "worn-over", note: `a garment follows ${COMPONENT_LABELS[part].toLowerCase()}` });
  }
  return edges;
}

/**
 * Which components must be regenerated after a change.
 *
 * `structural` propagation follows the articulation tree downward. A
 * "style" change (hairstyle, garment cut, accessory) never propagates: it
 * touches only the node named.
 */
export interface DirtyOptions {
  /** A proportion/bone-length change: propagate down the tree. */
  structural?: boolean;
}

export function dirtySet(changed: ReadonlyArray<ComponentId>, options: DirtyOptions = {}): ComponentId[] {
  const out = new Set<ComponentId>();
  const visit = (id: ComponentId) => {
    if (out.has(id)) return;
    out.add(id);
    if (!options.structural) return;
    for (const dependent of COMPONENT_GRAPH[id].dependents) visit(dependent);
  };
  for (const id of changed) visit(id);
  return COMPONENT_IDS.filter((id) => out.has(id));
}

/** Inverse of `dirtySet`: what stays valid and can be reused as-is. */
export function reusableSet(changed: ReadonlyArray<ComponentId>, options: DirtyOptions = {}): ComponentId[] {
  const dirty = new Set(dirtySet(changed, options));
  return COMPONENT_IDS.filter((id) => !dirty.has(id));
}

/* ------------------------------------------------------------- partitioning */

/**
 * Parts that a silhouette can actually be cut into. The overlays are
 * excluded because they overlap the structural parts by definition, and a
 * partition that put the face in both "head" and "face" would double-count
 * its volume.
 */
export const STRUCTURAL_COMPONENTS: readonly ComponentId[] = ["head", "neck", "torso", "arms", "pelvis", "legs", "feet"];
export const OVERLAY_COMPONENTS: readonly ComponentId[] = ["hair", "face", "hands", "clothing", "accessories"];

export interface ComponentSplit {
  parts: Partial<Record<ComponentId, SparseVoxels>>;
  /** Cells no structural region contained. */
  unassignedCells: number;
  /** Cells claimed by more than one region (resolved to the smallest). */
  contestedCells: number;
  counts: Record<ComponentId, number>;
  notes: string[];
}

/**
 * Cut a voxel set into structural parts using the regions the image
 * analysis measured. A cell belongs to the smallest region that contains
 * it, which is what makes the torso win over a garment region that also
 * covers it.
 */
export function splitByComponent(voxels: SparseVoxels, lattice: AnalysisLattice, regions: Record<ComponentId, BBox2D>): ComponentSplit {
  const parts: Partial<Record<ComponentId, Array<[number, number, number]>>> = {};
  const cellsFor = (id: ComponentId): Array<[number, number, number]> => {
    const existing = parts[id];
    if (existing) return existing;
    const created: Array<[number, number, number]> = [];
    parts[id] = created;
    return created;
  };

  const candidates = STRUCTURAL_COMPONENTS.filter((id) => !bboxIsEmpty(regions[id])).map((id) => {
    const box = regions[id];
    return { id, box, area: (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1) };
  });
  candidates.sort((a, b) => a.area - b.area);

  let unassigned = 0;
  let contested = 0;
  const counts = {} as Record<ComponentId, number>;
  for (const id of COMPONENT_IDS) counts[id] = 0;

  const n = voxelCount(voxels);
  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3];
    const j = voxels.coords[v * 3 + 1];
    const k = voxels.coords[v * 3 + 2];
    const [x, y] = cellToImage(lattice, i, j);
    const matches = candidates.filter((c) => x >= c.box.minX && x <= c.box.maxX && y >= c.box.minY && y <= c.box.maxY);
    if (matches.length === 0) {
      unassigned++;
      continue;
    }
    if (matches.length > 1) contested++;
    const owner = matches[0].id;
    cellsFor(owner).push([i, j, k]);
    counts[owner]++;
  }

  const out: Partial<Record<ComponentId, SparseVoxels>> = {};
  for (const id of STRUCTURAL_COMPONENTS) {
    const cells = parts[id];
    if (!cells) continue;
    out[id] = buildSparseVoxels(voxels.grid, cells, { occupancy: "sparse-volume" });
  }

  const notes = [
    `${n - unassigned} of ${n} cells were assigned to a structural part; ${unassigned} fell outside every measured region`,
    contested > 0 ? `${contested} cells fell inside overlapping regions and were given to the smallest region` : "no cell was contested by two regions",
    `overlays (${OVERLAY_COMPONENTS.join(", ")}) are not part of the partition: they overlap the parts by construction`,
  ];

  return { parts: out, unassignedCells: unassigned, contestedCells: contested, counts, notes };
}

/** Merge parts back into one voxel set (inverse of a split, exactly). */
export function mergeComponents(parts: Array<SparseVoxels | undefined>, grid: SparseVoxels["grid"]): SparseVoxels {
  const cells: Array<[number, number, number]> = [];
  const seen = new Set<number>();
  const [nx, ny, nz] = grid.resolution;
  for (const part of parts) {
    if (!part) continue;
    const n = voxelCount(part);
    for (let v = 0; v < n; v++) {
      const i = part.coords[v * 3];
      const j = part.coords[v * 3 + 1];
      const k = part.coords[v * 3 + 2];
      const key = (i * ny + j) * nz + k;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push([i, j, k]);
    }
  }
  void nx;
  return buildSparseVoxels(grid, cells, { occupancy: "sparse-volume" });
}

/* ------------------------------------------------------------------ digests */

/**
 * Synchronous content digest of a voxel part. Two parts with the same
 * digest hold the same cells; that is how "this component was reused
 * without regeneration" is proved rather than asserted.
 */
export function voxelDigest(voxels: SparseVoxels | undefined): string {
  if (!voxels) return "absent";
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const n = voxelCount(voxels);
  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3];
    const j = voxels.coords[v * 3 + 1];
    const k = voxels.coords[v * 3 + 2];
    h1 = Math.imul(h1 ^ i, 0x01000193);
    h1 = Math.imul(h1 ^ j, 0x01000193);
    h1 = Math.imul(h1 ^ k, 0x01000193);
    h2 = (h2 + i * 31 + j * 131 + k * 1031) | 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/* -------------------------------------------------------------- anatomy */

export interface AnatomyIssue {
  severity: "error" | "warning";
  components: ComponentId[];
  detail: string;
}

/**
 * Anatomical relationship checks on the measured parts.
 *
 * These are not style opinions: they are the geometric relations the graph
 * claims ("the head is above the neck", "the feet are lowest"). If a
 * reconstruction violates them, the dependency graph is describing a body
 * that is not there.
 */
export function checkAnatomy(parts: Partial<Record<ComponentId, SparseVoxels>>, grid: SparseVoxels["grid"]): AnatomyIssue[] {
  const issues: AnatomyIssue[] = [];
  const centreY = (part: SparseVoxels | undefined): number | null => {
    if (!part) return null;
    const n = voxelCount(part);
    if (n === 0) return null;
    let sum = 0;
    for (let v = 0; v < n; v++) sum += part.coords[v * 3 + 1];
    return grid.origin[1] + (sum / n + 0.5) * grid.cellSize;
  };

  const order: Array<[ComponentId, ComponentId]> = [
    ["head", "neck"],
    ["neck", "torso"],
    ["torso", "pelvis"],
    ["pelvis", "legs"],
    ["legs", "feet"],
  ];
  for (const [above, below] of order) {
    const a = centreY(parts[above]);
    const b = centreY(parts[below]);
    if (a === null || b === null) continue;
    if (a <= b) {
      issues.push({
        severity: "error",
        components: [above, below],
        detail: `${above} centre (${a.toFixed(3)} m) is not above ${below} centre (${b.toFixed(3)} m)`,
      });
    }
  }

  const torso = parts.torso;
  const arms = parts.arms;
  if (torso && arms) {
    const centreX = (part: SparseVoxels): number => {
      const n = voxelCount(part);
      let sum = 0;
      for (let v = 0; v < n; v++) sum += part.coords[v * 3];
      return grid.origin[0] + (sum / Math.max(1, n) + 0.5) * grid.cellSize;
    };
    if (Math.abs(centreX(arms) - centreX(torso)) < grid.cellSize) {
      // Both arms share one node, so a centred mean is expected; the check is
      // that the arms extend wider than the torso, not that their mean differs.
      const span = (part: SparseVoxels): number => {
        let min = Infinity;
        let max = -Infinity;
        for (let v = 0; v < voxelCount(part); v++) {
          min = Math.min(min, part.coords[v * 3]);
          max = Math.max(max, part.coords[v * 3]);
        }
        return max - min;
      };
      if (span(arms) <= span(torso)) {
        issues.push({ severity: "warning", components: ["arms", "torso"], detail: "arms do not extend wider than the torso; the arm split may have captured the torso instead" });
      }
    }
  }

  return issues;
}
