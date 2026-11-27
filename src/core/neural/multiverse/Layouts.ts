/**
 * ==========================================================
 * LÉLU — NEURAL MAP MULTIVERSE: THE SHARED LAYOUT LIBRARY
 *
 * Twelve layouts every aspect (V1, V2, V3) uses. Each is PURE and
 * DETERMINISTIC: the same graph gives the same picture on every device
 * and every reload, so a saved view reopens exactly as it was saved.
 * Positions are in a `size`×`size` box; `z` is depth for the layouts
 * that have one (projected by the renderer).
 *
 * A layout never changes the graph: it only places what the aspect
 * derived. Hierarchy is drawn only from real edges (core-orbit and
 * dimensional-layers use BFS depth over the graph's own edges).
 * ==========================================================
 */

import type { MvGraph, MvNode } from "./MultiverseTypes";

export type LayoutId =
  | "core-orbit"
  | "galactic-spiral"
  | "nested-universes"
  | "force-directed"
  | "dimensional-layers"
  | "radial-constellation"
  | "infinite-canvas"
  | "temporal-river"
  | "matrix-grid"
  | "topographic-field"
  | "chord-ring"
  | "holographic-spatial";

export interface Placed {
  x: number;
  y: number;
  z: number;
}

export type Guide =
  | { kind: "ring"; cx: number; cy: number; r: number; label?: string }
  | { kind: "box"; x: number; y: number; w: number; h: number; label?: string }
  | { kind: "hline"; y: number; label?: string }
  | { kind: "vline"; x: number; label?: string };

export interface LayoutResult {
  layout: LayoutId;
  positions: Record<string, Placed>;
  guides: Guide[];
  /** How the renderer draws edges in this layout. */
  edges: "straight" | "curve" | "chord";
}

export const LAYOUTS: Array<{ id: LayoutId; label: string; blurb: string }> = [
  { id: "core-orbit", label: "Core Orbit", blurb: "The most connected node at the centre; rings by distance along real edges." },
  { id: "galactic-spiral", label: "Galactic Spiral", blurb: "One spiral arm per group, heaviest nodes nearest the core." },
  { id: "nested-universes", label: "Nested Universes", blurb: "Each group its own universe, nodes inside it." },
  { id: "force-directed", label: "Force-Directed Universe", blurb: "Connected nodes pull together; all nodes repel." },
  { id: "dimensional-layers", label: "Dimensional Layers", blurb: "One layer per group, stacked." },
  { id: "radial-constellation", label: "Radial Constellation", blurb: "Groups as sectors; connected nodes nearer the centre." },
  { id: "infinite-canvas", label: "Infinite Canvas", blurb: "Cards in columns by group, like a research board." },
  { id: "temporal-river", label: "Temporal River", blurb: "Left to right by real time; one lane per group." },
  { id: "matrix-grid", label: "Matrix / Grid", blurb: "A sorted grid, group by group." },
  { id: "topographic-field", label: "Topographic Field", blurb: "Connection count as elevation: peaks at the centre." },
  { id: "chord-ring", label: "Chord / Relationship Ring", blurb: "Everything on one ring; relations as chords." },
  { id: "holographic-spatial", label: "Holographic Spatial", blurb: "A 3D sphere per group, projected and depth-shaded." },
];

const TAU = Math.PI * 2;

/** Groups in a stable order (largest first, then name) with their nodes sorted. */
export function groupsOf(graph: MvGraph): Array<{ id: string; nodes: MvNode[] }> {
  const by = new Map<string, MvNode[]>();
  for (const n of graph.nodes) by.set(n.group, [...(by.get(n.group) ?? []), n]);
  return [...by.entries()]
    .map(([id, nodes]) => ({ id, nodes: nodes.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.label.localeCompare(b.label)) }))
    .sort((a, b) => b.nodes.length - a.nodes.length || a.id.localeCompare(b.id));
}

export function degrees(graph: MvGraph): Map<string, number> {
  const d = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    if (d.has(e.from)) d.set(e.from, d.get(e.from)! + 1);
    if (d.has(e.to)) d.set(e.to, d.get(e.to)! + 1);
  }
  return d;
}

/** Undirected BFS depth from `root` over the graph's real edges; unreachable → Infinity. */
export function depthsFrom(graph: MvGraph, root: string): Map<string, number> {
  const adj = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  }
  const depth = new Map<string, number>(graph.nodes.map((n) => [n.id, Infinity]));
  if (!adj.has(root)) return depth;
  depth.set(root, 0);
  const queue = [root];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (depth.get(next) === Infinity) {
        depth.set(next, depth.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  return depth;
}

/** A stable [0,1) number per string, for deterministic jitter and seeds. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function hub(graph: MvGraph, deg: Map<string, number>): string | undefined {
  return [...graph.nodes].sort((a, b) => deg.get(b.id)! - deg.get(a.id)! || a.id.localeCompare(b.id))[0]?.id;
}

export function layout(id: LayoutId, graph: MvGraph, size = 1000): LayoutResult {
  const c = size / 2;
  const positions: Record<string, Placed> = {};
  const guides: Guide[] = [];
  const groups = groupsOf(graph);
  const deg = degrees(graph);
  const put = (n: MvNode, x: number, y: number, z = 0) => {
    positions[n.id] = { x, y, z };
  };

  switch (id) {
    case "core-orbit": {
      const root = hub(graph, deg);
      const depth = root ? depthsFrom(graph, root) : new Map<string, number>();
      const rings = new Map<number, MvNode[]>();
      for (const n of graph.nodes) {
        const d = depth.get(n.id) ?? Infinity;
        // Rings 1–4 by real distance; anything unreachable gets its own outer ring.
        const ring = Number.isFinite(d) ? Math.min(d, 4) : 5;
        rings.set(ring, [...(rings.get(ring) ?? []), n]);
      }
      const maxRing = Math.max(1, ...rings.keys());
      for (const [ring, nodes] of rings) {
        const r = ring === 0 ? 0 : (ring / maxRing) * (c - 40);
        if (ring > 0) guides.push({ kind: "ring", cx: c, cy: c, r, label: ring === 5 ? "unconnected" : `${ring} step${ring > 1 ? "s" : ""}` });
        nodes.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
        nodes.forEach((n, i) => {
          const a = (i / nodes.length) * TAU + ring * 0.37;
          put(n, c + r * Math.cos(a), c + r * Math.sin(a));
        });
      }
      return { layout: id, positions, guides, edges: "straight" };
    }
    case "galactic-spiral": {
      const arms = Math.max(1, groups.length);
      groups.forEach((g, gi) => {
        g.nodes.forEach((n, i) => {
          const t = (i + 1) / (g.nodes.length + 1);
          const r = 30 + t * (c - 60);
          const a = (gi / arms) * TAU + t * 2.6;
          put(n, c + r * Math.cos(a), c + r * Math.sin(a), -t * 60);
        });
      });
      return { layout: id, positions, guides, edges: "curve" };
    }
    case "nested-universes": {
      const k = Math.ceil(Math.sqrt(groups.length || 1));
      const cell = size / k;
      groups.forEach((g, gi) => {
        const cx = (gi % k) * cell + cell / 2;
        const cy = Math.floor(gi / k) * cell + cell / 2;
        const R = cell / 2 - 14;
        guides.push({ kind: "ring", cx, cy, r: R, label: g.id });
        g.nodes.forEach((n, i) => {
          // Sunflower packing inside the universe: even, deterministic.
          const r = R * 0.85 * Math.sqrt((i + 0.5) / g.nodes.length);
          const a = i * 2.39996;
          put(n, cx + r * Math.cos(a), cy + r * Math.sin(a));
        });
      });
      return { layout: id, positions, guides, edges: "straight" };
    }
    case "force-directed": {
      // Fruchterman–Reingold with a seeded start and a fixed iteration
      // budget, so it is deterministic and bounded on a phone.
      const nodes = graph.nodes;
      const n = nodes.length;
      if (n === 0) return { layout: id, positions, guides, edges: "straight" };
      const k = Math.sqrt((size * size) / n) * 0.6;
      const p = nodes.map((node) => ({ x: c + (hash01(node.id) - 0.5) * size * 0.8, y: c + (hash01(`${node.id}~`) - 0.5) * size * 0.8 }));
      const index = new Map(nodes.map((node, i) => [node.id, i]));
      const links = graph.edges.map((e) => [index.get(e.from), index.get(e.to)]).filter((l): l is [number, number] => l[0] !== undefined && l[1] !== undefined);
      const iterations = n > 400 ? 60 : 120;
      let temp = size / 10;
      for (let it = 0; it < iterations; it++) {
        const dx = new Float64Array(n);
        const dy = new Float64Array(n);
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            const vx = p[i].x - p[j].x;
            const vy = p[i].y - p[j].y;
            const d = Math.max(0.01, Math.hypot(vx, vy));
            const f = (k * k) / d;
            dx[i] += (vx / d) * f;
            dy[i] += (vy / d) * f;
            dx[j] -= (vx / d) * f;
            dy[j] -= (vy / d) * f;
          }
        for (const [a, b] of links) {
          const vx = p[a].x - p[b].x;
          const vy = p[a].y - p[b].y;
          const d = Math.max(0.01, Math.hypot(vx, vy));
          const f = (d * d) / k;
          dx[a] -= (vx / d) * f;
          dy[a] -= (vy / d) * f;
          dx[b] += (vx / d) * f;
          dy[b] += (vy / d) * f;
        }
        for (let i = 0; i < n; i++) {
          const d = Math.max(0.01, Math.hypot(dx[i], dy[i]));
          p[i].x += (dx[i] / d) * Math.min(d, temp);
          p[i].y += (dy[i] / d) * Math.min(d, temp);
          // Gentle gravity keeps disconnected parts on screen.
          p[i].x += (c - p[i].x) * 0.01;
          p[i].y += (c - p[i].y) * 0.01;
        }
        temp *= 0.96;
      }
      // Fit into the box.
      const xs = p.map((q) => q.x);
      const ys = p.map((q) => q.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const s = (size - 80) / Math.max(1, maxX - minX, maxY - minY);
      nodes.forEach((node, i) => put(node, 40 + (p[i].x - minX) * s, 40 + (p[i].y - minY) * s));
      return { layout: id, positions, guides, edges: "straight" };
    }
    case "dimensional-layers": {
      const h = size / Math.max(1, groups.length);
      groups.forEach((g, gi) => {
        const y = gi * h + h / 2;
        guides.push({ kind: "hline", y: gi * h + h, label: g.id });
        g.nodes.forEach((n, i) => {
          const x = 40 + ((i + 0.5) / g.nodes.length) * (size - 80);
          put(n, x, y + (i % 2 ? h * 0.18 : -h * 0.18), -gi * 40);
        });
      });
      return { layout: id, positions, guides, edges: "curve" };
    }
    case "radial-constellation": {
      const maxDeg = Math.max(1, ...deg.values());
      const total = graph.nodes.length || 1;
      let start = 0;
      for (const g of groups) {
        const span = (g.nodes.length / total) * TAU;
        g.nodes.forEach((n, i) => {
          const a = start + ((i + 0.5) / g.nodes.length) * span;
          const r = 60 + (1 - deg.get(n.id)! / maxDeg) * (c - 100);
          put(n, c + r * Math.cos(a), c + r * Math.sin(a));
        });
        start += span;
      }
      guides.push({ kind: "ring", cx: c, cy: c, r: c - 40, label: "fewest connections" });
      return { layout: id, positions, guides, edges: "curve" };
    }
    case "infinite-canvas": {
      // Wider than tall on purpose: the renderer lets the user pan.
      const colW = 180;
      groups.forEach((g, gi) => {
        guides.push({ kind: "box", x: 20 + gi * colW, y: 20, w: colW - 20, h: 40 + g.nodes.length * 44, label: g.id });
        g.nodes.forEach((n, i) => put(n, 20 + gi * colW + (colW - 20) / 2, 80 + i * 44));
      });
      return { layout: id, positions, guides, edges: "curve" };
    }
    case "temporal-river": {
      const timed = graph.nodes.filter((n) => typeof n.time === "number");
      const min = Math.min(...timed.map((n) => n.time!));
      const max = Math.max(...timed.map((n) => n.time!));
      const lane = size / Math.max(1, groups.length);
      groups.forEach((g, gi) => {
        guides.push({ kind: "hline", y: gi * lane + lane, label: g.id });
        g.nodes.forEach((n, i) => {
          // Untimed nodes are not given a fake date: they sit at the source, x = 20.
          const x = typeof n.time === "number" && max > min ? 60 + ((n.time - min) / (max - min)) * (size - 100) : 20;
          put(n, x, gi * lane + lane / 2 + ((i % 3) - 1) * lane * 0.22);
        });
      });
      return { layout: id, positions, guides, edges: "curve" };
    }
    case "matrix-grid": {
      const ordered = groups.flatMap((g) => g.nodes);
      const k = Math.ceil(Math.sqrt(ordered.length || 1));
      const cell = (size - 40) / k;
      ordered.forEach((n, i) => put(n, 20 + (i % k) * cell + cell / 2, 20 + Math.floor(i / k) * cell + cell / 2));
      return { layout: id, positions, guides, edges: "straight" };
    }
    case "topographic-field": {
      const maxDeg = Math.max(1, ...deg.values());
      for (let r = 1; r <= 5; r++) guides.push({ kind: "ring", cx: c, cy: c, r: (r / 5) * (c - 30), label: r === 1 ? "most connected" : undefined });
      groups.forEach((g, gi) => {
        const base = (gi / Math.max(1, groups.length)) * TAU;
        g.nodes.forEach((n, i) => {
          const elevation = deg.get(n.id)! / maxDeg;
          const r = (1 - elevation) * (c - 40) + 20;
          const a = base + (i / g.nodes.length) * (TAU / Math.max(1, groups.length)) * 0.9;
          put(n, c + r * Math.cos(a), c + r * Math.sin(a), elevation * 100);
        });
      });
      return { layout: id, positions, guides, edges: "curve" };
    }
    case "chord-ring": {
      const ordered = groups.flatMap((g) => g.nodes);
      const r = c - 60;
      guides.push({ kind: "ring", cx: c, cy: c, r });
      ordered.forEach((n, i) => {
        const a = (i / (ordered.length || 1)) * TAU - Math.PI / 2;
        put(n, c + r * Math.cos(a), c + r * Math.sin(a));
      });
      return { layout: id, positions, guides, edges: "chord" };
    }
    case "holographic-spatial": {
      // A Fibonacci sphere per group, groups on a ring; isometric projection.
      const ring = c * 0.55;
      groups.forEach((g, gi) => {
        const ga = (gi / Math.max(1, groups.length)) * TAU;
        const gx = Math.cos(ga) * ring;
        const gz = Math.sin(ga) * ring;
        const R = Math.min(140, 30 + Math.sqrt(g.nodes.length) * 14);
        g.nodes.forEach((n, i) => {
          const t = (i + 0.5) / g.nodes.length;
          const phi = Math.acos(1 - 2 * t);
          const th = i * 2.39996;
          const x3 = gx + R * Math.sin(phi) * Math.cos(th);
          const y3 = R * Math.cos(phi);
          const z3 = gz + R * Math.sin(phi) * Math.sin(th);
          // Tilted orthographic projection: depth z kept for shading/sorting.
          put(n, c + x3, c + y3 * 0.8 + z3 * 0.35, z3);
        });
      });
      return { layout: id, positions, guides, edges: "straight" };
    }
  }
}
