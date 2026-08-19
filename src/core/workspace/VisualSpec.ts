/**
 * ==========================================================
 * LÉLU
 * VISUAL SPEC
 *
 * Structured visual specifications, not HTML strings. The
 * visualization engine produces typed data (nodes/edges,
 * series, rows, timeline events, wireframe boxes) and the
 * workspace renderer draws them. Because the spec is data,
 * the agent can EDIT it (move a node, add an edge) and the
 * workspace simply re-renders — no string surgery.
 * ==========================================================
 */

export type VisualKind =
  | "diagram"
  | "chart"
  | "table"
  | "timeline"
  | "wireframe"
  | "file"
  | "browser"
  | "video"
  | "image"
  | "memory"
  | "cognition"
  | "providers"
  | "genesis"
  | "activity"
  | "design";

export interface GraphNode {
  id: string;
  label: string;
  kind?: string;
  /** Optional explicit position (0–100, percentage of canvas). */
  x?: number;
  y?: number;
  color?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface SeriesPoint {
  label: string;
  value: number;
  color?: string;
}

export interface TableColumn {
  key: string;
  label: string;
}

export type TableRow = Record<string, string>;

export interface TimelineEvent {
  time: string;
  label: string;
  detail?: string;
  status?: "ok" | "warn" | "error" | "running" | "idle";
}

export interface WireframeBox {
  id: string;
  label: string;
  type:
    | "nav"
    | "sidebar"
    | "header"
    | "panel"
    | "card"
    | "button"
    | "title"
    | "text"
    | "chart"
    | "input"
    | "row"
    | "column";
  /** Layout hints (0–100 percentages). Omitted values auto-layout. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * A visual specification. Every field is optional so one renderer
 * handles every kind; the `kind` selects which renderer draws it.
 */
export interface VisualSpec {
  kind: VisualKind;
  title: string;
  caption?: string;
  /** Provenance: "live" = computed from real app state, "derived" = static truth of the architecture. */
  source?: "live" | "derived";
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  series?: SeriesPoint[];
  columns?: TableColumn[];
  rows?: TableRow[];
  timeline?: TimelineEvent[];
  boxes?: WireframeBox[];
  /** File/code content. */
  text?: string;
  /** Browser URL. */
  url?: string;
  /** Free-form metadata the renderer may show (e.g. provider status). */
  meta?: Record<string, string>;
}
