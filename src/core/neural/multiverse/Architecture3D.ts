/**
 * ==========================================================
 * LÉLU — V2 IN THREE DIMENSIONS: TEN ARCHITECTURE VIEWS
 *
 * Pure geometry for the 3D renderer (Architecture3DView). Every view
 * places the SAME V2 graph (real subsystems, real import edges); the
 * views differ in how they arrange it in space, how they draw wiring,
 * and which measured signal they emphasise:
 *
 *   size      lines of code (measured from source)
 *   wiring    static imports (inferred: what CAN call what)
 *   change    git commits per day (measured CHANGE activity)
 *   live      events on the one event bus since the app started
 *             (measured; mapped to subsystems by a stated table)
 *
 * Anatomical / glass-brain placements are a METAPHOR for orientation,
 * stated in the view: no biological claim is made.
 * ==========================================================
 */

import type { MvGraph, MvNode } from "./MultiverseTypes";

export type ArchViewId =
  | "anatomical-core"
  | "neural-sphere"
  | "exploded-layers"
  | "neural-universe"
  | "connectome-tractography"
  | "glass-brain"
  | "multiscale"
  | "circuit-board"
  | "temporal-activation"
  | "subsystem-constellation"
  /** Any aspect (V1, V2, V3): one sphere per group around a galactic ring. */
  | "galaxy-3d"
  /** Any aspect: a 3D force layout of every node and edge. */
  | "force-3d";

export type Vec3 = [number, number, number];

export interface ArchLayout {
  view: ArchViewId;
  /** Position of every node (function hubs and subsystems). */
  positions: Record<string, Vec3>;
  /** How wiring is drawn. */
  wiring: "straight" | "tract" | "trace" | "arc" | "none";
  /** Context geometry: shells, planes, a board, a time axis. */
  shells: Array<
    | { kind: "ellipsoid"; center: Vec3; radii: Vec3; opacity: number }
    | { kind: "plane"; y: number; size: number; label: string }
    | { kind: "board"; size: number }
    | { kind: "axis"; from: Vec3; to: Vec3; ticks: Array<{ at: Vec3; label: string }> }
  >;
  /** Per-subsystem bars (temporal activation): one per day, height = commits that day. */
  bars?: Array<{ node: string; at: Vec3; height: number; day: string }>;
  /** Particles per subsystem (multiscale): one per real source file. */
  particles?: Array<{ node: string; at: Vec3 }>;
  /** What this view's placement means, shown with it. */
  caption: string;
}

export const ARCH_VIEWS: Array<{ id: ArchViewId; label: string; blurb: string }> = [
  { id: "anatomical-core", label: "Anatomical Core", blurb: "Functions placed like regions of a brain (a metaphor for orientation), subsystems clustered in them." },
  { id: "neural-sphere", label: "Neural Sphere", blurb: "Every subsystem on one sphere, grouped by function; wiring through the interior." },
  { id: "exploded-layers", label: "Layered / Exploded", blurb: "One plane per function, stacked from perception to runtime and pulled apart." },
  { id: "neural-universe", label: "Neural Universe", blurb: "Each function a galaxy; subsystems orbit it at a distance set by their size." },
  { id: "connectome-tractography", label: "Connectome Tractography", blurb: "Import wiring bundled into curved tracts through function hubs; thickness = imports." },
  { id: "glass-brain", label: "Glass Brain", blurb: "A translucent shell; subsystems inside it, the most wired ones nearest the core." },
  { id: "multiscale", label: "Multiscale Architecture", blurb: "Function → subsystem → file: one particle per real source file." },
  { id: "circuit-board", label: "Cognitive Circuit Board", blurb: "Subsystems as chips sized by code, imports as right-angle traces." },
  { id: "temporal-activation", label: "Temporal Activation", blurb: "Days along the axis; bar height = commits that changed the subsystem that day." },
  { id: "subsystem-constellation", label: "Subsystem Constellation", blurb: "A 3D force layout of subsystems alone, pulled together by their imports." },
];

/** 3D views that work on ANY aspect's graph (V1 knowledge, V2 architecture, V3 society). */
export const GENERIC_3D_VIEWS: Array<{ id: ArchViewId; label: string; blurb: string }> = [
  { id: "galaxy-3d", label: "Galaxy 3D", blurb: "Each group a sphere of nodes, the groups on a galactic ring; relations as arcs." },
  { id: "force-3d", label: "Force 3D", blurb: "Every node and relation in a 3D force layout: connected things pull together." },
];

/** Pipeline order for stacked/ordered views (perception in, development/runtime out). */
export const FUNCTION_ORDER = [
  "perception",
  "memory",
  "cognition",
  "evaluation",
  "planning",
  "conversation",
  "tools",
  "provider-routing",
  "reflection",
  "feedback",
  "development",
  "embodiment",
  "runtime",
  "unclassified",
];

/**
 * Brain-region metaphor for the anatomical and glass views: a fixed,
 * stated mapping on a unit ellipsoid (x left→right, y down→up, z back→front).
 */
const REGION: Record<string, Vec3> = {
  perception: [0, 0.1, -0.85], // occipital (back)
  memory: [0.55, -0.35, 0], // temporal
  cognition: [0, 0.55, 0.55], // frontal
  evaluation: [-0.45, 0.45, 0.45],
  planning: [0.45, 0.45, 0.45],
  conversation: [-0.6, -0.15, 0.25], // language areas
  tools: [-0.55, 0.45, -0.25], // parietal
  "provider-routing": [0, -0.1, 0], // thalamic relay
  reflection: [0, 0.75, 0.05],
  feedback: [0, -0.55, -0.5], // cerebellar
  development: [0.55, 0.45, -0.25],
  embodiment: [0, 0.6, -0.4], // motor/sensory strip
  runtime: [0, -0.75, 0], // brainstem
  unclassified: [0, -0.9, -0.3],
};

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function fib(i: number, n: number, r: number, c: Vec3 = [0, 0, 0]): Vec3 {
  const y = 1 - ((i + 0.5) / Math.max(1, n)) * 2;
  const rad = Math.sqrt(1 - y * y);
  const th = i * GOLDEN;
  return [c[0] + Math.cos(th) * rad * r, c[1] + y * r, c[2] + Math.sin(th) * rad * r];
}

const subsystems = (g: MvGraph) => g.nodes.filter((n) => n.kind === "subsystem");
const byFunction = (g: MvGraph) => {
  const m = new Map<string, MvNode[]>();
  for (const n of subsystems(g)) m.set(n.group, [...(m.get(n.group) ?? []), n]);
  for (const list of m.values()) list.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.id.localeCompare(b.id));
  return m;
};
const orderIndex = (f: string) => {
  const i = FUNCTION_ORDER.indexOf(f);
  return i < 0 ? FUNCTION_ORDER.length : i;
};
const sizeOf = (n: MvNode) => Math.log10(1 + (n.weight ?? 0));

export function archLayout(view: ArchViewId, g: MvGraph, scale = 10): ArchLayout {
  const positions: Record<string, Vec3> = {};
  const groups = byFunction(g);
  const fns = [...groups.keys()].sort((a, b) => orderIndex(a) - orderIndex(b));
  const S = scale;

  const clusterAround = (center: Vec3, radius: number) => {
    for (const f of fns) {
      const c: Vec3 = [center[0] + (REGION[f] ?? REGION.unclassified)[0] * S, center[1] + (REGION[f] ?? REGION.unclassified)[1] * S * 0.8, center[2] + (REGION[f] ?? REGION.unclassified)[2] * S];
      positions[`function:${f}`] = c;
      const list = groups.get(f)!;
      list.forEach((n, i) => (positions[n.id] = fib(i, list.length, radius * (0.6 + Math.sqrt(list.length) * 0.18), c)));
    }
  };

  switch (view) {
    case "anatomical-core":
    case "connectome-tractography": {
      clusterAround([0, 0, 0], S * 0.16);
      return {
        view,
        positions,
        wiring: view === "connectome-tractography" ? "tract" : "straight",
        shells: [{ kind: "ellipsoid", center: [0, 0, 0], radii: [S * 1.05, S * 0.85, S * 1.15], opacity: view === "anatomical-core" ? 0.07 : 0.03 }],
        caption:
          view === "anatomical-core"
            ? "Placement is a brain-region metaphor for orientation (stated mapping), not a biological claim."
            : "Tracts are the real import edges, bundled through their functions' hubs; thickness = number of imports.",
      };
    }
    case "glass-brain": {
      // Most-wired nearest the core: radius falls with degree.
      const deg = new Map<string, number>();
      for (const e of g.edges) if (e.kind === "imports") for (const id of [e.from, e.to]) deg.set(id, (deg.get(id) ?? 0) + (e.weight ?? 1));
      const max = Math.max(1, ...deg.values());
      for (const f of fns) {
        const dir = REGION[f] ?? REGION.unclassified;
        positions[`function:${f}`] = [dir[0] * S * 0.95, dir[1] * S * 0.8, dir[2] * S * 1.05];
        groups.get(f)!.forEach((n, i) => {
          const t = 0.25 + 0.7 * (1 - (deg.get(n.id) ?? 0) / max);
          const j = (hash01(n.id) - 0.5) * 0.5;
          positions[n.id] = [(dir[0] + j) * S * t, (dir[1] + (i % 3) * 0.08) * S * t * 0.85, (dir[2] - j) * S * t];
        });
      }
      return { view, positions, wiring: "straight", shells: [{ kind: "ellipsoid", center: [0, 0, 0], radii: [S * 1.05, S * 0.85, S * 1.15], opacity: 0.12 }], caption: "Glass shell is a metaphor; distance from the core falls with measured import count." };
    }
    case "neural-sphere": {
      const all = fns.flatMap((f) => groups.get(f)!);
      all.forEach((n, i) => (positions[n.id] = fib(i, all.length, S)));
      for (const f of fns) {
        const list = groups.get(f)!;
        const c = list.reduce<Vec3>((a, n) => [a[0] + positions[n.id][0], a[1] + positions[n.id][1], a[2] + positions[n.id][2]], [0, 0, 0]);
        positions[`function:${f}`] = [(c[0] / list.length) * 1.25, (c[1] / list.length) * 1.25, (c[2] / list.length) * 1.25];
      }
      return { view, positions, wiring: "arc", shells: [], caption: "One sphere, grouped by function; wiring arcs through the interior." };
    }
    case "exploded-layers": {
      const shells: ArchLayout["shells"] = [];
      fns.forEach((f, li) => {
        const y = (fns.length / 2 - li) * S * 0.32;
        shells.push({ kind: "plane", y, size: S * 1.6, label: f });
        positions[`function:${f}`] = [-S * 0.95, y, 0];
        const list = groups.get(f)!;
        const k = Math.ceil(Math.sqrt(list.length));
        list.forEach((n, i) => (positions[n.id] = [((i % k) - (k - 1) / 2) * S * 0.28, y, (Math.floor(i / k) - (k - 1) / 2) * S * 0.28]));
      });
      return { view, positions, wiring: "straight", shells, caption: "Planes in pipeline order (perception at the top, runtime at the bottom); wiring crosses between layers." };
    }
    case "neural-universe": {
      fns.forEach((f, i) => {
        const c = fib(i, fns.length, S * 0.9);
        positions[`function:${f}`] = c;
        groups.get(f)!.forEach((n, j) => {
          const r = S * 0.08 + sizeOf(n) * S * 0.05;
          const a = j * GOLDEN * 2;
          positions[n.id] = [c[0] + Math.cos(a) * r, c[1] + Math.sin(j * 1.7) * r * 0.25, c[2] + Math.sin(a) * r];
        });
      });
      return { view, positions, wiring: "arc", shells: [], caption: "Galaxies are functions; orbit distance grows with measured code size." };
    }
    case "multiscale": {
      const particles: NonNullable<ArchLayout["particles"]> = [];
      fns.forEach((f, i) => {
        const a = (i / fns.length) * TAU;
        const c: Vec3 = [Math.cos(a) * S * 0.9, 0, Math.sin(a) * S * 0.9];
        positions[`function:${f}`] = c;
        const list = groups.get(f)!;
        list.forEach((n, j) => {
          const p = fib(j, list.length, S * 0.12 + list.length * S * 0.012, c);
          positions[n.id] = p;
          // One particle per real source file (facts.files), in a small shell around the subsystem.
          const files = Number(n.facts.files ?? 0);
          for (let k = 0; k < files; k++) particles.push({ node: n.id, at: fib(k, files, S * 0.025 + Math.sqrt(files) * S * 0.004, p) });
        });
      });
      return { view, positions, wiring: "straight", shells: [], particles, caption: "Three scales: function (ring), subsystem, and one particle for each real source file." };
    }
    case "circuit-board": {
      const all = fns.flatMap((f) => groups.get(f)!);
      const k = Math.ceil(Math.sqrt(all.length));
      const cell = (S * 1.8) / k;
      all.forEach((n, i) => (positions[n.id] = [((i % k) - (k - 1) / 2) * cell, 0, (Math.floor(i / k) - (k - 1) / 2) * cell]));
      fns.forEach((f, i) => (positions[`function:${f}`] = [-S * 1.15, 0, ((i - (fns.length - 1) / 2) * S * 1.8) / fns.length]));
      return { view, positions, wiring: "trace", shells: [{ kind: "board", size: S * 2.2 }], caption: "Chips are subsystems (height = code size); traces are imports routed at right angles." };
    }
    case "temporal-activation": {
      const days = Math.max(0, ...subsystems(g).map((n) => n.series?.length ?? 0));
      const from = String(g.meta?.historyFrom ?? "");
      const bars: NonNullable<ArchLayout["bars"]> = [];
      const all = fns.flatMap((f) => groups.get(f)!);
      const span = S * 2;
      const dx = days > 1 ? span / (days - 1) : 0;
      all.forEach((n, i) => {
        const z = ((i - (all.length - 1) / 2) * S * 2) / Math.max(1, all.length);
        positions[n.id] = [-span / 2 - S * 0.15, 0, z];
        const daily = n.series ?? [];
        daily.forEach((c, d) => {
          if (c > 0) bars.push({ node: n.id, at: [-span / 2 + d * dx, 0, z], height: c, day: dayLabel(from, d) });
        });
      });
      fns.forEach((f) => {
        const list = groups.get(f)!;
        positions[`function:${f}`] = [-span / 2 - S * 0.5, 0, list.reduce((s, n) => s + positions[n.id][2], 0) / list.length];
      });
      const ticks = days ? [0, Math.floor((days - 1) / 2), days - 1].map((d) => ({ at: [-span / 2 + d * dx, 0, S * 1.1] as Vec3, label: dayLabel(from, d) })) : [];
      return { view, positions, wiring: "none", shells: [{ kind: "axis", from: [-span / 2, 0, S * 1.1], to: [span / 2, 0, S * 1.1], ticks }], bars, caption: "Measured change activity from git (commits per day), not runtime processing." };
    }
    case "galaxy-3d": {
      const by = new Map<string, MvNode[]>();
      for (const n of g.nodes) by.set(n.group, [...(by.get(n.group) ?? []), n]);
      const groupsList = [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      groupsList.forEach(([, list], gi) => {
        const a = (gi / Math.max(1, groupsList.length)) * TAU;
        const c: Vec3 = [Math.cos(a) * S * 0.85, Math.sin(gi * 1.3) * S * 0.15, Math.sin(a) * S * 0.85];
        list.forEach((n, i) => (positions[n.id] = fib(i, list.length, S * 0.12 + Math.sqrt(list.length) * S * 0.05, c)));
      });
      return { view, positions, wiring: "arc", shells: [], caption: "Groups as spheres on a ring; positions are presentation, relations are the authority's." };
    }
    case "force-3d": {
      const nodes = g.nodes;
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      const p: Vec3[] = nodes.map((n) => [(hash01(n.id) - 0.5) * S * 2, (hash01(`${n.id}y`) - 0.5) * S * 2, (hash01(`${n.id}z`) - 0.5) * S * 2]);
      const links = g.edges.map((e) => [idx.get(e.from), idx.get(e.to)] as const).filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined);
      const k = S * 0.45;
      let temp = S * 0.3;
      const iters = nodes.length > 300 ? 60 : 120;
      for (let it = 0; it < iters; it++) {
        const d = p.map(() => [0, 0, 0]);
        for (let i = 0; i < p.length; i++)
          for (let j = i + 1; j < p.length; j++) {
            const v = [p[i][0] - p[j][0], p[i][1] - p[j][1], p[i][2] - p[j][2]];
            const dist = Math.max(0.01, Math.hypot(v[0], v[1], v[2]));
            const f = (k * k) / dist;
            for (let a = 0; a < 3; a++) {
              d[i][a] += (v[a] / dist) * f;
              d[j][a] -= (v[a] / dist) * f;
            }
          }
        for (const [a, b] of links) {
          const v = [p[a][0] - p[b][0], p[a][1] - p[b][1], p[a][2] - p[b][2]];
          const dist = Math.max(0.01, Math.hypot(v[0], v[1], v[2]));
          const f = (dist * dist) / k;
          for (let c = 0; c < 3; c++) {
            d[a][c] -= (v[c] / dist) * f;
            d[b][c] += (v[c] / dist) * f;
          }
        }
        for (let i = 0; i < p.length; i++) {
          const m = Math.max(0.01, Math.hypot(d[i][0], d[i][1], d[i][2]));
          for (let c = 0; c < 3; c++) p[i][c] += (d[i][c] / m) * Math.min(m, temp) - p[i][c] * 0.01;
        }
        temp *= 0.96;
      }
      const ext = Math.max(0.01, ...p.flat().map(Math.abs));
      nodes.forEach((n, i) => (positions[n.id] = [(p[i][0] / ext) * S, (p[i][1] / ext) * S, (p[i][2] / ext) * S]));
      return { view, positions, wiring: "straight", shells: [], caption: "A 3D force layout of every node and relation in this aspect." };
    }
    case "subsystem-constellation": {
      const nodes = subsystems(g);
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      const p: Vec3[] = nodes.map((n) => [(hash01(n.id) - 0.5) * S * 2, (hash01(`${n.id}y`) - 0.5) * S * 2, (hash01(`${n.id}z`) - 0.5) * S * 2]);
      const links = g.edges.filter((e) => e.kind === "imports").map((e) => [idx.get(e.from), idx.get(e.to), e.weight ?? 1] as const).filter((l): l is readonly [number, number, number] => l[0] !== undefined && l[1] !== undefined);
      const k = S * 0.5;
      let temp = S * 0.3;
      for (let it = 0; it < 150; it++) {
        const d = p.map(() => [0, 0, 0]);
        for (let i = 0; i < p.length; i++)
          for (let j = i + 1; j < p.length; j++) {
            const v = [p[i][0] - p[j][0], p[i][1] - p[j][1], p[i][2] - p[j][2]];
            const dist = Math.max(0.01, Math.hypot(v[0], v[1], v[2]));
            const f = (k * k) / dist;
            for (let a = 0; a < 3; a++) {
              d[i][a] += (v[a] / dist) * f;
              d[j][a] -= (v[a] / dist) * f;
            }
          }
        for (const [a, b, w] of links) {
          const v = [p[a][0] - p[b][0], p[a][1] - p[b][1], p[a][2] - p[b][2]];
          const dist = Math.max(0.01, Math.hypot(v[0], v[1], v[2]));
          const f = ((dist * dist) / k) * Math.min(3, 1 + Math.log2(w) * 0.3);
          for (let c = 0; c < 3; c++) {
            d[a][c] -= (v[c] / dist) * f;
            d[b][c] += (v[c] / dist) * f;
          }
        }
        for (let i = 0; i < p.length; i++) {
          const m = Math.max(0.01, Math.hypot(d[i][0], d[i][1], d[i][2]));
          for (let c = 0; c < 3; c++) p[i][c] += (d[i][c] / m) * Math.min(m, temp) - p[i][c] * 0.01;
        }
        temp *= 0.97;
      }
      const ext = Math.max(0.01, ...p.flat().map(Math.abs));
      nodes.forEach((n, i) => (positions[n.id] = [(p[i][0] / ext) * S, (p[i][1] / ext) * S, (p[i][2] / ext) * S]));
      // Hubs at their members' centroid, not part of the force.
      for (const f of fns) {
        const list = groups.get(f)!;
        positions[`function:${f}`] = [0, 1, 2].map((a) => list.reduce((s, n) => s + positions[n.id][a], 0) / list.length) as Vec3;
      }
      return { view, positions, wiring: "straight", shells: [], caption: "Subsystems pulled together by measured import counts; hubs sit at their members' centre." };
    }
  }
}

function dayLabel(from: string, d: number): string {
  const t = Date.parse(from);
  return Number.isFinite(t) ? new Date(t + d * 86_400_000).toISOString().slice(5, 10) : `day ${d + 1}`;
}

/* ---------------------------------------------------------- live activity */

/**
 * Which subsystem emits each event type on the one event bus. A stated
 * classification, shown in the view: the COUNTS are measured, this
 * mapping of a type to a directory is editorial.
 */
export const EVENT_SUBSYSTEM: Record<string, string> = {
  agent_started: "agents", agent_completed: "agents", agent_failed: "agents",
  approval_requested: "cognition", approval_resolved: "cognition",
  browser_navigation: "browser", browser_opened: "browser", browser_result: "browser",
  cognition: "cognition", cognitive_sync: "cognition",
  core_transform: "cosmos", spatial_event: "spatial",
  creative_artifact: "creative", studio_artifact: "studio", diagram_created: "visual", visual_created: "visual", visual_state_changed: "visual", ui_prototype_created: "ui",
  cross_chat_reference: "multichat",
  execution_evidence: "orchestrator", execution_phase: "orchestrator",
  file_changed: "workspace", file_opened: "workspace", workspace_focus: "workspace", workspace_minimize: "workspace", workspace_open: "workspace",
  memory_retrieval: "memory", memory_update: "memory",
  provider_selected: "router", provider_status: "router",
  task_started: "core-root", task_completed: "core-root", task_failed: "core-root", task_planning: "planning",
  tool_failed: "tools", tool_narration: "tools", tool_progress: "tools", tool_result: "tools", tool_selected: "tools", tool_started: "tools",
  user_steering: "conversation",
};

export interface LiveActivity {
  /** Events counted, per subsystem node id. */
  bySubsystem: Record<string, number>;
  total: number;
  /** Event types seen that the table does not map (shown, not dropped silently). */
  unmapped: Record<string, number>;
}

export function liveActivity(events: Array<{ type: string }>): LiveActivity {
  const bySubsystem: Record<string, number> = {};
  const unmapped: Record<string, number> = {};
  for (const e of events) {
    const sub = EVENT_SUBSYSTEM[e.type];
    if (sub) bySubsystem[`subsystem:${sub}`] = (bySubsystem[`subsystem:${sub}`] ?? 0) + 1;
    else unmapped[e.type] = (unmapped[e.type] ?? 0) + 1;
  }
  return { bySubsystem, total: events.length, unmapped };
}
