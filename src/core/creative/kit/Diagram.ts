/**
 * ==========================================================
 * LÉLU — CREATIVE KIT: DIAGRAMS (Mermaid)
 *
 * A diagram is Mermaid source text — flowcharts, sequence,
 * class, state, ER, journey, gantt, pie, mindmap, timeline,
 * quadrant, architecture-like flow. The text IS the editable
 * artifact; SVG/PNG are produced from it in the browser.
 *
 * Two ways in, neither needs a model:
 *   • source text (from a person, a model or a template),
 *   • structure: nodes + edges (+ optional groups) compiled to
 *     a flowchart here, deterministically.
 *
 * Mermaid (MIT) is already a dependency (chat renders ```mermaid
 * fences). It is loaded lazily, only when a diagram is drawn.
 * ==========================================================
 */

export const DIAGRAM_TYPES = [
  "flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram",
  "journey", "gantt", "pie", "mindmap", "timeline", "quadrantChart", "gitGraph", "xychart-beta", "block-beta", "sankey-beta",
] as const;

export interface DiagramProgram {
  source: string;
  /** The Mermaid diagram type the source declares. */
  diagramType: string;
}

export interface DiagramNode { id: string; label?: string; shape?: "box" | "round" | "stadium" | "db" | "circle" | "diamond" | "hex"; group?: string }
export interface DiagramEdge { from: string; to: string; label?: string; style?: "solid" | "dotted" | "thick" }
export interface DiagramStructure { direction?: "LR" | "TB" | "RL" | "BT"; nodes: DiagramNode[]; edges: DiagramEdge[]; groups?: Array<{ id: string; label?: string }> }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Mermaid ids must be simple tokens; labels carry the human text. */
export function safeId(raw: string): string {
  const id = raw.trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z]/.test(id) ? id.slice(0, 48) : `n_${id}`.slice(0, 48);
}
const label = (s: string) => s.replace(/["\n\r]/g, " ").replace(/[[\]{}()<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

const SHAPES: Record<NonNullable<DiagramNode["shape"]>, (t: string) => string> = {
  box: (t) => `["${t}"]`,
  round: (t) => `("${t}")`,
  stadium: (t) => `(["${t}"])`,
  db: (t) => `[("${t}")]`,
  circle: (t) => `(("${t}"))`,
  diamond: (t) => `{"${t}"}`,
  hex: (t) => `{{"${t}"}}`,
};

/** Compile nodes/edges/groups into flowchart source. Pure and deterministic. */
export function structureToMermaid(s: DiagramStructure): string {
  const dir = s.direction && ["LR", "TB", "RL", "BT"].includes(s.direction) ? s.direction : "LR";
  const lines = [`flowchart ${dir}`];
  const ids = new Map(s.nodes.map((n) => [n.id, safeId(n.id)]));
  const nodeLine = (n: DiagramNode) => `${ids.get(n.id)}${SHAPES[n.shape ?? "box"](label(n.label ?? n.id))}`;
  const grouped = new Map<string, DiagramNode[]>();
  for (const n of s.nodes) {
    if (n.group) grouped.set(n.group, [...(grouped.get(n.group) ?? []), n]);
    else lines.push(`  ${nodeLine(n)}`);
  }
  for (const [g, members] of grouped) {
    const meta = s.groups?.find((x) => x.id === g);
    lines.push(`  subgraph ${safeId(g)}["${label(meta?.label ?? g)}"]`);
    for (const n of members) lines.push(`    ${nodeLine(n)}`);
    lines.push("  end");
  }
  for (const e of s.edges) {
    const a = ids.get(e.from) ?? safeId(e.from);
    const b = ids.get(e.to) ?? safeId(e.to);
    const arrow = e.style === "dotted" ? "-.->" : e.style === "thick" ? "==>" : "-->";
    lines.push(e.label ? `  ${a} ${arrow}|"${label(e.label)}"| ${b}` : `  ${a} ${arrow} ${b}`);
  }
  return lines.join("\n");
}

/** The declared type of a source, or null. Skips front-matter, comments and %%{init}%% directives. */
export function diagramTypeOf(source: string): string | null {
  let body = source.replace(/^---[\s\S]*?---\s*/m, "");
  body = body.replace(/%%\{[\s\S]*?\}%%/g, "");
  const first = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("%%"));
  if (!first) return null;
  const word = first.split(/\s+/)[0];
  return (DIAGRAM_TYPES as readonly string[]).includes(word) ? word : null;
}

/**
 * Structural checks that need no DOM: a known type, balanced brackets and
 * quotes, a body after the header. The browser additionally runs
 * mermaid.parse before a diagram is reported as rendered.
 */
export function checkMermaid(source: string): string | null {
  const type = diagramTypeOf(source);
  if (!type) return `the first line must declare a diagram type (${DIAGRAM_TYPES.slice(0, 8).join(", ")}, …)`;
  const lines = source.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("%%"));
  if (lines.length < 2) return "the diagram has a type but no content";
  const pairs: Array<[string, string]> = [["[", "]"], ["(", ")"], ["{", "}"]];
  const outsideQuotes = source.replace(/"[^"\n]*"/g, "");
  if ((source.match(/"/g) ?? []).length % 2 !== 0) return "a quote is not closed";
  for (const [o, c] of pairs) {
    const open = outsideQuotes.split(o).length - 1;
    const close = outsideQuotes.split(c).length - 1;
    if (open !== close) return `unbalanced “${o}${c}”: ${open} opened, ${close} closed`;
  }
  return null;
}

/** Accept { source } or { nodes, edges } (or a bare string) and return a checked program or a reason. */
export function normalizeDiagram(input: unknown): DiagramProgram | string {
  let source = "";
  if (typeof input === "string") source = input;
  else if (isObj(input) && typeof input.source === "string") source = input.source;
  else if (isObj(input) && Array.isArray(input.nodes)) {
    const nodes = input.nodes.filter(isObj).map((n, i) => ({
      id: String(n.id ?? `n${i + 1}`), label: typeof n.label === "string" ? n.label : undefined,
      shape: typeof n.shape === "string" && n.shape in SHAPES ? (n.shape as DiagramNode["shape"]) : undefined,
      group: typeof n.group === "string" ? n.group : undefined,
    }));
    if (nodes.length === 0) return "a structured diagram needs at least one node";
    const known = new Set(nodes.map((n) => n.id));
    const edges = (Array.isArray(input.edges) ? input.edges : []).filter(isObj).map((e) => ({
      from: String(e.from ?? e.source ?? ""), to: String(e.to ?? e.target ?? ""),
      label: typeof e.label === "string" ? e.label : undefined,
      style: e.style === "dotted" || e.style === "thick" ? e.style : undefined,
    }) as DiagramEdge);
    const bad = edges.find((e) => !known.has(e.from) || !known.has(e.to));
    if (bad) return `edge ${bad.from} → ${bad.to} names a node that does not exist`;
    const groups = Array.isArray(input.groups) ? input.groups.filter(isObj).map((g) => ({ id: String(g.id), label: typeof g.label === "string" ? g.label : undefined })) : undefined;
    source = structureToMermaid({ direction: input.direction as DiagramStructure["direction"], nodes, edges, groups });
  } else return "a diagram needs Mermaid `source` text or `nodes` and `edges`";
  source = source.replace(/^\s*```(?:mermaid)?\s*/i, "").replace(/\s*```\s*$/, "").trim().slice(0, 40_000);
  const problem = checkMermaid(source);
  if (problem) return problem;
  return { source, diagramType: diagramTypeOf(source)! };
}

/* ------------------------------------------------------------------ *
 * Browser rendering (lazy)
 * ------------------------------------------------------------------ */

type MermaidApi = typeof import("mermaid").default;
let mermaidLoad: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidLoad) {
    mermaidLoad = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: { primaryColor: "#2a2152", primaryTextColor: "#f4f0ff", primaryBorderColor: "#b98cff", lineColor: "#d4a94e", fontFamily: "Inter, Helvetica, Arial, sans-serif", background: "#120e24" },
      });
      return mermaid;
    });
  }
  return mermaidLoad;
}

let renderCount = 0;

/** Parse with Mermaid itself and render to an SVG string. Browser only. */
export async function renderDiagramSvg(program: DiagramProgram): Promise<{ ok: true; svg: string } | { ok: false; reason: string }> {
  if (typeof document === "undefined") return { ok: false, reason: "Mermaid rendering needs a browser document" };
  try {
    const mermaid = await loadMermaid();
    await mermaid.parse(program.source);
    renderCount += 1;
    const { svg } = await mermaid.render(`lelu-diagram-${renderCount}`, program.source);
    return { ok: true, svg };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : String(error) };
  }
}
