/**
 * ==========================================================
 * LÉLU — THE NEURAL MAP IN EACH COMPOSITION (Infinite Cosmos)
 *
 * The neighbourhood graph's GEOMETRY per composition — where the focused
 * entity sits, where each related entity sits and how a link is drawn.
 * Pure: the same relations (the real index, NeuralMap) laid out as a
 * ring (glass), a directory tree (console), a modular grid, editorial
 * columns, a block matrix, a hanging scroll, a radar or a living cluster.
 * Every node stays a real node: clicking it follows the relation.
 * ==========================================================
 */

import type { CompositionSpec } from "../../../../core/interface/CosmosLanguages";

export type NeuralLayoutKind = CompositionSpec["neural"]["layout"];
export type NeuralLinkKind = CompositionSpec["neural"]["link"];

export interface Point {
  x: number;
  y: number;
}

export interface NeuralGeometry {
  focus: Point;
  nodes: Point[];
  /** Where each node's label goes, relative to the node: below, right or left. */
  label: "below" | "right" | "left";
  /** Decorations the layout draws behind the graph (radar rings, grid lines). */
  guides: Array<{ kind: "ring"; r: number } | { kind: "hline"; y: number } | { kind: "vline"; x: number }>;
}

/**
 * Positions for `count` related entities around a focus, in a `size`×`size`
 * view box. `directions` (in/out per node) lets some layouts separate
 * incoming from outgoing relations, as editorial columns and radar rings do.
 */
export function neuralGeometry(kind: NeuralLayoutKind, count: number, size = 520, directions: Array<"in" | "out"> = []): NeuralGeometry {
  const c = size / 2;
  const n = Math.max(1, count);
  switch (kind) {
    case "list": {
      // A directory tree: the focus is the root, each relation a line below it.
      const step = Math.min(18, (size - 60) / n);
      return {
        focus: { x: 40, y: 28 },
        nodes: Array.from({ length: count }, (_, i) => ({ x: 92, y: 60 + i * step })),
        label: "right",
        guides: [{ kind: "vline", x: 40 }],
      };
    }
    case "grid": {
      const cols = 4;
      const cell = (size - 40) / cols;
      return {
        focus: { x: 20 + cell / 2, y: 40 },
        nodes: Array.from({ length: count }, (_, i) => ({ x: 20 + (i % cols) * cell + cell / 2, y: 130 + Math.floor(i / cols) * 58 })),
        label: "below",
        guides: [{ kind: "hline", y: 96 }, ...Array.from({ length: cols - 1 }, (_, i) => ({ kind: "vline" as const, x: 20 + (i + 1) * cell }))],
      };
    }
    case "columns": {
      // Editorial: incoming on the left column, outgoing on the right, the focus as the headline.
      let li = 0;
      let ri = 0;
      const nodes = Array.from({ length: count }, (_, i) => {
        const left = directions[i] === "in";
        const row = left ? li++ : ri++;
        return { x: left ? 70 : size - 70, y: 110 + row * 26 };
      });
      return { focus: { x: c, y: 46 }, nodes, label: "below", guides: [{ kind: "hline", y: 82 }, { kind: "vline", x: c }] };
    }
    case "matrix": {
      const cols = 5;
      const cell = (size - 60) / cols;
      const nodes: Point[] = [];
      // A ring of blocks on a square grid around a central block.
      const slots: Point[] = [];
      for (let r = 0; r < cols; r++) for (let q = 0; q < cols; q++) if (!(r === 2 && q === 2)) slots.push({ x: 30 + q * cell + cell / 2, y: 30 + r * cell + cell / 2 });
      for (let i = 0; i < count; i++) nodes.push(slots[i % slots.length]);
      return { focus: { x: c, y: c }, nodes, label: "below", guides: [] };
    }
    case "vertical": {
      // A hanging scroll: the focus top-right, relations in columns read right to left.
      const per = 7;
      return {
        focus: { x: size - 50, y: 50 },
        nodes: Array.from({ length: count }, (_, i) => ({ x: size - 120 - Math.floor(i / per) * 92, y: 70 + (i % per) * 60 })),
        label: "left",
        guides: [],
      };
    }
    case "radar": {
      // Outgoing on the inner ring, incoming on the outer: two orbits of a scope.
      const ins = directions.filter((d) => d === "in").length || 1;
      const outs = directions.filter((d) => d !== "in").length || 1;
      let ii = 0;
      let oi = 0;
      const nodes = Array.from({ length: count }, (_, i) => {
        const incoming = directions[i] === "in";
        const k = incoming ? ii++ : oi++;
        const a = (k / (incoming ? ins : outs)) * Math.PI * 2 - Math.PI / 2 + (incoming ? Math.PI / ins : 0);
        const r = incoming ? 210 : 130;
        return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
      });
      return { focus: { x: c, y: c }, nodes, label: "below", guides: [{ kind: "ring", r: 70 }, { kind: "ring", r: 130 }, { kind: "ring", r: 210 }, { kind: "hline", y: c }, { kind: "vline", x: c }] };
    }
    case "cluster": {
      // Phyllotaxis: the way seeds pack in a flower head.
      const golden = Math.PI * (3 - Math.sqrt(5));
      return {
        focus: { x: c, y: c },
        nodes: Array.from({ length: count }, (_, i) => {
          const r = 70 + 34 * Math.sqrt(i + 1);
          const a = i * golden;
          return { x: c + Math.cos(a) * Math.min(r, c - 30), y: c + Math.sin(a) * Math.min(r, c - 30) };
        }),
        label: "below",
        guides: [],
      };
    }
    default: {
      const r = 190;
      return {
        focus: { x: c, y: c },
        nodes: Array.from({ length: count }, (_, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
        }),
        label: "below",
        guides: [],
      };
    }
  }
}

/** The SVG path of a link from the focus to a node, in the composition's line language. */
export function neuralLinkPath(kind: NeuralLinkKind, from: Point, to: Point): string {
  const f = (v: number) => Math.round(v * 10) / 10;
  switch (kind) {
    case "orthogonal": {
      const midY = f(to.y);
      return `M${f(from.x)},${f(from.y)} V${midY} H${f(to.x)}`;
    }
    case "wire": {
      const midX = f((from.x + to.x) / 2);
      return `M${f(from.x)},${f(from.y)} H${midX} V${f(to.y)} H${f(to.x)}`;
    }
    case "curve":
    case "brush": {
      const mx = (from.x + to.x) / 2 + (to.y - from.y) * 0.25;
      const my = (from.y + to.y) / 2 - (to.x - from.x) * 0.25;
      return `M${f(from.x)},${f(from.y)} Q${f(mx)},${f(my)} ${f(to.x)},${f(to.y)}`;
    }
    default:
      return `M${f(from.x)},${f(from.y)} L${f(to.x)},${f(to.y)}`;
  }
}
