/**
 * ==========================================================
 * LÉLU — CREATIVE KIT + PUBLIC DATA TOOLS
 *
 * The open-source / browser-native capabilities as tools in the
 * SAME ToolRegistry → ToolDispatcher → AutonomyGate path as every
 * other tool. Each one executes directly (no model call per
 * operation), creates a Creation Studio artifact the chat shows
 * as a card and a Cosmos window, and reports what really ran.
 *
 *   creative.art        procedural / generative artwork (SVG → PNG)
 *   creative.diagram    Mermaid diagrams from source or nodes/edges
 *   creative.chart      interactive visualization, optionally from a data connector
 *   creative.scene3d    three.js scene (presets or objects) → GLB/glTF
 *   creative.film       short film: Canvas + Web Audio + WebCodecs → WebM
 *   creative.export     write a visual or drawing as a file and read it back
 *   research.board      public sources → a cited document + mind map
 *   data.query          a public no-key data connector → rows + citation
 *   data.sources        the connectors, their limits, terms and status
 *   device.capabilities what this browser/device can execute
 *   tools.catalog       every tool's capability profile
 * ==========================================================
 */

import AgentEventBus from "../../agent/AgentEvents";
import ToolRegistry, { type ToolDefinition } from "../../tools/ToolRegistry";
import type { ToolExecutionResult } from "../../tools/ToolDispatcher";
import type RouterContext from "../../router/RouterContext";
import StudioStore, { type StudioArtifact } from "../../studio/StudioStore";
import type { DrawingSpec, VisualMedium, VisualSpec } from "../../studio/StudioTypes";
import { ownerForTask } from "../../multichat/TurnOwnership";
import { connectorProfiles, queryConnector, rowsToViz, type DataResult } from "../../data/PublicDataConnectors";
import { describeCapabilities, capabilities } from "./BrowserCapabilities";
import { exportDrawing, exportVisual, VISUAL_FORMATS, visualGist, type VisualFile, type VisualFormat } from "./VisualArtifacts";
import { GENERATIVE_STYLES, PALETTES } from "./GenerativeArt";
import { PRESETS, PRIMITIVES, COMPOUNDS } from "./Scene3D";
import { buildEngineProgram } from "./EngineAssembly";
import { CAPABILITY_PROFILES, profileFor, type CapabilityProfile } from "./CapabilityProfiles";

export const VISUAL_OPEN_EVENT = "lelu-studio-open";

interface KitExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, context: RouterContext | undefined) => Promise<ToolExecutionResult>;
}

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const s = (args: Record<string, unknown>, k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
const EXPORT = { type: "array", items: { type: "string" }, description: "formats to write now" };

function conversationOf(context: RouterContext | undefined): string | undefined {
  return context?.request?.conversationId ?? ownerForTask(String(context?.request?.timestamp ?? "")) ?? undefined;
}

function announce(context: RouterContext | undefined, a: StudioArtifact, action: "created" | "revised" | "exported", exports?: Array<{ format: string; filename: string; ok: boolean; size: number }>): void {
  AgentEventBus.getInstance().emit({
    type: "studio_artifact", taskId: String(context?.request?.timestamp ?? Date.now()), artifactId: a.id,
    rev: a.revisions[a.revisions.length - 1].rev, title: a.title, kind: a.kind, action, exports,
  });
}

function openWindow(id: string): boolean {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent(VISUAL_OPEN_EVENT, { detail: { ids: [id], layout: "single" } }));
  return true;
}

/* ------------------------------------------------------------------ *
 * Exported files (kept in memory so the window can offer Download)
 * ------------------------------------------------------------------ */

const FILES = new Map<string, VisualFile & { rev: number; sha256: string; at: number }>();
const FILE_BUDGET = 96 * 1024 * 1024;

export function visualFile(artifactId: string, rev: number, format: string) { return FILES.get(`${artifactId}@${rev}.${format}`); }
export function visualFilesOf(artifactId: string) { return [...FILES.entries()].filter(([k]) => k.startsWith(`${artifactId}@`)).map(([, v]) => v); }

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function keep(id: string, rev: number, file: VisualFile, hash: string): void {
  FILES.set(`${id}@${rev}.${file.format}`, { ...file, rev, sha256: hash, at: Date.now() });
  let total = [...FILES.values()].reduce((a, f) => a + f.bytes.byteLength, 0);
  for (const [k, f] of [...FILES.entries()].sort((a, b) => a[1].at - b[1].at)) {
    if (total <= FILE_BUDGET) break;
    FILES.delete(k);
    total -= f.bytes.byteLength;
  }
}

/** Export one artifact revision as a file, read it back, keep it. Never throws. */
export async function exportArtifactFile(a: StudioArtifact, format: VisualFormat, rev?: number): Promise<{ ok: boolean; line: string; record?: { format: string; filename: string; ok: boolean; size: number } }> {
  const store = StudioStore.getInstance();
  const revision = (rev ? store.revision(a, rev) : undefined) ?? store.latest(a);
  const spec = revision.spec;
  try {
    let file: VisualFile;
    if (spec.kind === "visual") file = await exportVisual(spec, format);
    else if (spec.kind === "drawing" && (format === "excalidraw" || format === "svg" || format === "png")) file = await exportDrawing(spec as DrawingSpec, format);
    else return { ok: false, line: `✗ ${format}: a ${spec.kind} is exported with studio.export` };
    const hash = await sha256(file.bytes);
    keep(a.id, revision.rev, file, hash);
    const facts = Object.entries(file.facts).map(([k, v]) => `${k} ${v}`).join(", ");
    const checks = file.checks.map((c) => `    ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`).join("\n");
    return {
      ok: file.ok,
      line: `${file.ok ? "✓" : "✗ FAILED verification —"} ${file.filename} (${(file.bytes.byteLength / 1024).toFixed(1)} KB, sha256 ${hash.slice(0, 12)}…)${facts ? ` [${facts}]` : ""}\n${checks}`,
      record: { format, filename: file.filename, ok: file.ok, size: file.bytes.byteLength },
    };
  } catch (error) {
    return { ok: false, line: `✗ ${format}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function createVisual(medium: VisualMedium, args: Record<string, unknown>, program: Record<string, unknown>, context: RouterContext | undefined, fallbackTitle: string, extra: Partial<VisualSpec> = {}): Promise<ToolExecutionResult> {
  const store = StudioStore.getInstance();
  const title = s(args, "title") || fallbackTitle;
  const created = store.create({ kind: "visual", title, medium, program, sources: extra.sources, notes: extra.notes, links: extra.links }, { by: "lelu", conversationId: conversationOf(context) });
  if (!created.ok) return { ok: false, content: `Nothing was created: ${created.reason}.` };
  const a = created.artifact;
  announce(context, a, "created");
  const wanted = (Array.isArray(args.export) ? args.export : []).map(String).filter((f): f is VisualFormat => (VISUAL_FORMATS[medium] as string[]).includes(f));
  const lines: string[] = [];
  const records: Array<{ format: string; filename: string; ok: boolean; size: number }> = [];
  let ok = true;
  for (const f of wanted) {
    const r = await exportArtifactFile(a, f);
    lines.push(r.line);
    if (r.record) records.push(r.record);
    if (!r.ok) ok = false;
  }
  if (records.length) announce(context, a, "exported", records);
  // The conversation is the output surface; a separate window opens only when
  // it is asked for (the same rule the Studio tools follow).
  const opened = args.open === true ? openWindow(a.id) : false;
  const spec = store.latest(a).spec as VisualSpec;
  return {
    ok,
    content: [
      `Created ${medium} visual “${a.title}” [${a.id}] — ${visualGist(spec)}.`,
      opened ? "It is open as a window and shown in the chat." : "Saved in the Creation Studio.",
      `Files it can be written as: ${VISUAL_FORMATS[medium].join(", ")} (creative.export).`,
      ...lines,
    ].join("\n"),
    data: { artifactId: a.id, medium, exports: records },
  };
}

/* ------------------------------------------------------------------ *
 * Executors
 * ------------------------------------------------------------------ */

export const CREATIVE_KIT_EXECUTORS: KitExecutor[] = [
  {
    id: "creative.art",
    parameters: OBJ({
      title: { type: "string" },
      style: { type: "string", enum: [...GENERATIVE_STYLES] },
      seed: { type: "number", description: "same seed = same artwork" },
      palette: { type: "string", enum: Object.keys(PALETTES) },
      colors: { type: "array", items: { type: "string" }, description: "#hex colours (override palette)" },
      density: { type: "number", description: "0.1–3" },
      width: { type: "number" }, height: { type: "number" },
      caption: { type: "string" },
      export: EXPORT,
    }, ["style"]),
    run: async (args, context) => createVisual("generative", args, { ...args, caption: s(args, "caption") || undefined }, context, `Generative ${s(args, "style") || "art"}`),
  },
  {
    id: "creative.diagram",
    parameters: OBJ({
      title: { type: "string" },
      source: { type: "string", description: "Mermaid source (flowchart, sequenceDiagram, classDiagram, erDiagram, mindmap, timeline, gantt, pie…)" },
      nodes: { type: "array", items: { type: "object" }, description: "or structure: [{id,label,shape?,group?}]" },
      edges: { type: "array", items: { type: "object" }, description: "[{from,to,label?,style?}]" },
      direction: { type: "string", enum: ["LR", "TB", "RL", "BT"] },
      export: EXPORT,
    }),
    run: async (args, context) => createVisual("diagram", args, args.source ? { source: args.source } : { nodes: args.nodes, edges: args.edges, groups: args.groups, direction: args.direction }, context, "Diagram"),
  },
  {
    id: "creative.chart",
    parameters: OBJ({
      title: { type: "string" },
      kind: { type: "string", enum: ["bar", "column", "line", "area", "scatter", "pie", "donut"] },
      labels: { type: "array", items: { type: "string" } },
      series: { type: "array", items: { type: "object" }, description: "[{name, values:number[]}]" },
      x: { type: "array", items: { type: "number" }, description: "scatter x values" },
      sources: { type: "array", items: { type: "object" }, description: "[{title,url}] — cite real sources only" },
      connector: { type: "string", description: "or chart live public data: a data.query connector id" },
      query: { type: "object", description: "the connector's parameters" },
      label: { type: "string" }, value: { type: "string" }, aggregate: { type: "string", enum: ["count", "sum", "mean"] },
      export: EXPORT,
    }),
    run: async (args, context) => {
      let program: Record<string, unknown> = args;
      let notes: string | undefined;
      if (s(args, "connector")) {
        const r = await queryConnector(s(args, "connector"), (args.query as Record<string, unknown>) ?? {});
        if (!r.ok) return { ok: false, content: `No chart: the data could not be retrieved — ${r.reason}.` };
        const viz = rowsToViz(r, { kind: s(args, "kind") || undefined, label: s(args, "label") || undefined, value: s(args, "value") || undefined, title: s(args, "title") || undefined, aggregate: (s(args, "aggregate") || undefined) as "count" | undefined, x: s(args, "xColumn") || undefined });
        if (typeof viz === "string") return { ok: false, content: `No chart: ${viz}.` };
        program = viz;
        notes = `${r.summary} Retrieved ${r.fetchedAt}${r.cached ? " (cache)" : ""}. ${r.citation.attribution}.`;
      }
      const sources = Array.isArray(program.sources) ? (program.sources as Array<{ title: string; url?: string; accessed?: string }>).map((x, i) => ({ id: `S${i + 1}`, ...x })) : undefined;
      return createVisual("chart", args, program, context, String(program.title ?? "Chart"), { sources, notes });
    },
  },
  {
    id: "creative.scene3d",
    parameters: OBJ({
      title: { type: "string" },
      preset: { type: "string", enum: Object.keys(PRESETS), description: "a complete environment to start from" },
      objects: { type: "array", items: { type: "object" }, description: `[{shape (${[...PRIMITIVES, ...COMPOUNDS].join("|")}), position:[x,y,z], rotation, scale, color, metalness, roughness, emissive, size:{…}, repeat:{count,pattern ring|grid|line|scatter|spiral,radius,spacing}, animate:{type spin|bob|orbit|pulse,speed}}]` },
      lights: { type: "array", items: { type: "object" } },
      camera: { type: "object" }, background: { type: "string" }, seed: { type: "number" },
      export: EXPORT,
    }),
    run: async (args, context) => createVisual("scene3d", args, args, context, s(args, "preset") ? `${s(args, "preset")} scene` : "3D scene"),
  },
  {
    id: "creative.engine",
    // The engine is a scene plus its layer/cycle data: GLB export and the live
    // view use the same program, so nothing is drawn twice.
    parameters: OBJ({
      title: { type: "string" },
      export: EXPORT,
      open: { type: "boolean", description: "also show it as a window (default false: the chat card is the surface)" },
    }),
    run: async (args, context) => {
      const engine = buildEngineProgram(s(args, "title") || undefined);
      // The stored program is a valid Scene3D program (objects, camera, lights)
      // with the engine data alongside it, so every existing exporter works.
      const program = { ...engine.scene, engine };
      return createVisual("scene3d", args, program, context, engine.title, {
        notes: engine.notes.join(" "),
      });
    },
  },
  {
    id: "creative.film",
    parameters: OBJ({
      title: { type: "string" },
      scenes: { type: "array", items: { type: "object" }, description: "[{duration, title?, subtitle?, visual:{type generative|chart|diagram|gradient, …program}, motion zoom-in|zoom-out|pan-left|pan-right|drift|still}]" },
      width: { type: "number" }, height: { type: "number" }, fps: { type: "number" },
      transition: { type: "string", enum: ["fade", "cut"] },
      soundtrack: { type: "string", enum: ["calm", "bright", "tense", "none"] },
      export: EXPORT,
    }, ["scenes"]),
    run: async (args, context) => createVisual("video", args, args, context, "Short film"),
  },
  {
    id: "creative.export",
    parameters: OBJ({ artifact: { type: "string", description: "artifact id or title" }, format: { type: "string", enum: ["svg", "png", "json", "mmd", "html", "csv", "glb", "gltf", "webm", "excalidraw"] } }, ["artifact", "format"]),
    run: async (args, context) => {
      const store = StudioStore.getInstance();
      const a = store.resolve(s(args, "artifact"), conversationOf(context));
      if (!a) return { ok: false, content: `No artifact matches “${s(args, "artifact")}”.` };
      const r = await exportArtifactFile(a, s(args, "format") as VisualFormat);
      if (r.record) announce(context, a, "exported", [r.record]);
      return { ok: r.ok, content: r.line, data: r.record };
    },
  },
  {
    id: "data.query",
    parameters: OBJ({
      connector: { type: "string", enum: connectorProfiles().map((p) => p.id) },
      query: { type: "object", description: "the connector's parameters (see data.sources)" },
      limit: { type: "number", description: "rows to show (default 15)" },
    }, ["connector"]),
    run: async (args) => {
      const r = await queryConnector(s(args, "connector"), (args.query as Record<string, unknown>) ?? {});
      if (!r.ok) return { ok: false, content: `${r.connector}: ${r.reason}.${r.retryable ? " (temporary — it may work later or from another network)" : ""}` };
      return { ok: true, content: formatRows(r, Number(args.limit) || 15), data: r };
    },
  },
  {
    id: "data.sources",
    parameters: OBJ({}),
    run: async () => ({
      ok: true,
      content: connectorProfiles().map((p) => `${p.id} — ${p.description}\n  params: ${Object.entries(p.params).map(([k, v]) => `${k} (${v})`).join("; ")}\n  no key · limits: ${p.limits} · terms: ${p.terms} · ${p.cors ? "CORS ok" : "no CORS (relay in browser)"} · verified ${p.verified.at}: ${p.verified.status}${p.verified.note ? ` (${p.verified.note})` : ""}`).join("\n"),
      data: connectorProfiles(),
    }),
  },
  {
    id: "research.board",
    parameters: OBJ({ topic: { type: "string" }, papers: { type: "number", description: "how many papers (default 8)" } }, ["topic"]),
    run: async (args, context) => researchBoard(s(args, "topic"), Number(args.papers) || 8, context),
  },
  {
    id: "device.capabilities",
    parameters: OBJ({}),
    run: async () => { const c = await capabilities(); return { ok: true, content: describeCapabilities(c), data: c }; },
  },
  {
    id: "tools.catalog",
    parameters: OBJ({ filter: { type: "string", description: "offline | no-network | browser | server | a word" } }),
    run: async (args) => {
      const f = s(args, "filter").toLowerCase();
      const rows = Object.entries(CAPABILITY_PROFILES).filter(([id, p]) => !f
        || (f === "offline" && p.offline) || (f === "no-network" && p.network === "none")
        || (f === "browser" && p.runtime.includes("browser")) || (f === "server" && p.runtime.includes("server"))
        || id.includes(f) || p.purpose.toLowerCase().includes(f));
      return { ok: true, content: rows.map(([id, p]) => formatProfile(id, p)).join("\n"), data: Object.fromEntries(rows) };
    },
  },
];

function formatRows(r: DataResult, limit: number): string {
  const cols = r.columns.filter((c) => c !== "url").slice(0, 6);
  const rows = r.rows.slice(0, limit).map((row) => `- ${cols.map((c) => `${c}: ${String(row[c] ?? "").slice(0, 90)}`).join(" | ")}${row.url ? ` <${row.url}>` : ""}`);
  return [`${r.summary}${r.cached ? " (from cache)" : ""}`, ...rows, r.rows.length > limit ? `… ${r.rows.length - limit} more rows` : "", `Source: ${r.citation.title} — ${r.citation.url} (retrieved ${r.citation.accessed.slice(0, 16).replace("T", " ")} UTC). ${r.citation.attribution}.`].filter(Boolean).join("\n");
}

export function formatProfile(id: string, p: CapabilityProfile): string {
  return `${id} — ${p.purpose}\n  in: ${p.input} → out: ${p.output}\n  runs: ${p.runtime} · offline: ${p.offline ? "yes" : "no"} · network: ${p.network} · credentials: ${p.credentials} · limits: ${p.limits}\n  license: ${p.license} · resources: ${p.resources}${p.fallbacks.length ? ` · fallbacks: ${p.fallbacks.join(" → ")}` : ""}`;
}

/* ------------------------------------------------------------------ *
 * Research board: public sources → a cited document + a mind map
 * ------------------------------------------------------------------ */

async function researchBoard(topic: string, papers: number, context: RouterContext | undefined): Promise<ToolExecutionResult> {
  if (!topic) return { ok: false, content: "A research board needs a topic." };
  const store = StudioStore.getInstance();
  const [search, crossref, arxiv] = await Promise.all([
    queryConnector("wikipedia.search", { query: topic, limit: 5 }),
    queryConnector("crossref.works", { query: topic, rows: Math.min(20, Math.max(3, papers)) }),
    queryConnector("arxiv.search", { query: topic, max: 5 }),
  ]);
  const summary = search.ok && search.rows[0] ? await queryConnector("wikipedia.summary", { title: String(search.rows[0].title) }) : null;
  const used = [summary, crossref, arxiv].filter((r): r is DataResult => !!r && r.ok);
  const failed = [search, summary, crossref, arxiv].filter((r) => r && !r.ok).map((r) => `${(r as { connector: string }).connector}: ${(r as { reason: string }).reason}`);
  if (used.length === 0) return { ok: false, content: `No public source answered for “${topic}”: ${failed.join("; ")}.` };
  const sources = used.map((r, i) => ({ id: `S${i + 1}`, title: r.citation.title, url: r.citation.url, accessed: r.citation.accessed.slice(0, 10), note: r.citation.attribution }));
  const cite = (r: DataResult | null) => (r && r.ok ? ` [S${used.indexOf(r) + 1}]` : "");
  const blocks: Array<Record<string, unknown>> = [{ type: "heading", level: 1, text: topic }];
  if (summary && summary.ok) {
    blocks.push({ type: "heading", level: 2, text: "Overview" }, { type: "quote", text: String(summary.rows[0].extract ?? summary.summary).slice(0, 1800), cite: `Wikipedia${cite(summary)}` });
  }
  if (crossref.ok && crossref.rows.length) {
    const top = [...crossref.rows].sort((a, b) => Number(b.citations) - Number(a.citations)).slice(0, papers);
    blocks.push({ type: "heading", level: 2, text: `Most-cited published work${cite(crossref)}` });
    blocks.push({ type: "table", columns: ["Title", "Authors", "Year", "Venue", "Citations", "DOI"], rows: top.map((w) => [String(w.title).slice(0, 140), String(w.authors).slice(0, 80), w.year ?? "", String(w.venue).slice(0, 60), Number(w.citations) || 0, String(w.doi)]) });
    const chartRows = top.filter((w) => Number(w.citations) > 0).slice(0, 8);
    if (chartRows.length >= 2) blocks.push({ type: "chart", chart: { kind: "bar", title: "Citations (Crossref)", labels: chartRows.map((w) => String(w.title).slice(0, 28)), series: [{ name: "citations", values: chartRows.map((w) => Number(w.citations)) }] }, caption: `Citation counts as reported by Crossref${cite(crossref)}` });
  }
  if (arxiv.ok && arxiv.rows.length) {
    blocks.push({ type: "heading", level: 2, text: `Recent preprints${cite(arxiv)}` });
    blocks.push({ type: "bullets", items: arxiv.rows.slice(0, 5).map((p) => `${p.title} — ${p.authors} (${p.published}) ${p.url}`) });
  }
  if (failed.length) blocks.push({ type: "paragraph", text: `Not available this time: ${failed.join("; ")}.` });
  const doc = store.create({ kind: "document", title: `Research board — ${topic}`, blocks, sources }, { by: "lelu", conversationId: conversationOf(context) });
  if (!doc.ok) return { ok: false, content: `The board could not be made: ${doc.reason}.` };
  announce(context, doc.artifact, "created");
  // A mind map of what was found (Mermaid), built from the rows — no model.
  const clean = (t: string) => t.replace(/[()[\]{}"`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const mm = ["mindmap", `  root((${clean(topic)}))`];
  if (summary && summary.ok) { mm.push("    Overview"); for (const sentence of String(summary.rows[0].extract ?? "").split(/(?<=\.)\s+/).slice(0, 3)) if (sentence.trim()) mm.push(`      ${clean(sentence)}`); }
  if (crossref.ok && crossref.rows.length) { mm.push("    Published work"); for (const w of crossref.rows.slice(0, 5)) mm.push(`      ${clean(String(w.title))}`); }
  if (arxiv.ok && arxiv.rows.length) { mm.push("    Preprints"); for (const p of arxiv.rows.slice(0, 4)) mm.push(`      ${clean(String(p.title))}`); }
  const map = store.create({ kind: "visual", title: `Map — ${topic}`, medium: "diagram", program: { source: mm.join("\n") }, sources }, { by: "lelu", conversationId: conversationOf(context) });
  if (map.ok) announce(context, map.artifact, "created");
  openWindow(doc.artifact.id);
  const lines = [
    `Research board “${topic}” [${doc.artifact.id}]${map.ok ? ` and mind map [${map.artifact.id}]` : ""} from ${used.length} public source${used.length > 1 ? "s" : ""}:`,
    ...(summary && summary.ok ? [`Overview: ${String(summary.rows[0].extract ?? "").slice(0, 400)}`] : []),
    ...(crossref.ok ? [`Most cited (Crossref): ${[...crossref.rows].sort((a, b) => Number(b.citations) - Number(a.citations)).slice(0, 3).map((w) => `“${String(w.title).slice(0, 80)}” (${w.year ?? "n.d."}, ${w.citations} citations, doi:${w.doi})`).join("; ")}`] : []),
    ...(arxiv.ok && arxiv.rows.length ? [`Preprints (arXiv): ${arxiv.rows.slice(0, 2).map((p) => `“${String(p.title).slice(0, 80)}” ${p.url}`).join("; ")}`] : []),
    "Sources:", ...sources.map((x) => `[${x.id}] ${x.title} — ${x.url} (retrieved ${x.accessed}; ${x.note})`),
    ...(failed.length ? [`Unavailable: ${failed.join("; ")}`] : []),
  ];
  return { ok: true, content: lines.join("\n"), data: { documentId: doc.artifact.id, mapId: map.ok ? map.artifact.id : null, sources } };
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

const def = (id: string, name: string, description: string, riskLevel: 0 | 1, permissions: ToolDefinition["permissions"]): ToolDefinition => ({
  id, name, description, category: id.startsWith("data.") || id === "research.board" ? "Research" : id.startsWith("creative.") ? "Creative Kit" : "System",
  permissions, riskLevel, available: true, executionRoute: "front-end:CreativeKitTools", verificationMethod: "the artifact or file is re-read", profile: profileFor(id),
});

export const CREATIVE_KIT_TOOLS: ToolDefinition[] = [
  def("creative.art", "Generative Art", "Make procedural/generative artwork on the device (flow fields, circle packing, ridgelines, constellations, Truchet, trees, mosaics, orbits) — an editable SVG, exportable as PNG. Use for 'generative art', 'procedural pattern', 'make me an abstract visual', moodboard textures. No image API.", 1, ["WRITE"]),
  def("creative.diagram", "Diagram (Mermaid)", "Draw a diagram from Mermaid source or from nodes/edges: architecture, flowchart, sequence, class, ER, state, mind map, timeline, gantt. Exports .mmd, SVG, PNG.", 1, ["WRITE"]),
  def("creative.chart", "Interactive Visualization", "Build a working interactive chart (hover tooltips, legend toggles, sortable table, cited sources) from given numbers or live public data via a data connector. Exports HTML, SVG, PNG, CSV.", 1, ["WRITE"]),
  def("creative.engine", "Engine Experience", "Build a complete four-stroke internal combustion engine as an interactive scene: every part, eight toggleable layers (block, piston & crank, valvetrain, fuel & ignition, intake/exhaust, cooling, lubrication, output), exploded view, labels and the animated cycle driven by real slider-crank kinematics — exported as GLB.", 1, ["WRITE"]),
  def("creative.scene3d", "3D Scene → GLB", "Construct a detailed 3D scene with three.js — presets (forest, city, desert, ocean, space, crystal-cave, runway) and/or objects (primitives, terrain, trees, rocks, buildings, crystals, garment forms), arrays, materials, lights, camera, animation — and export GLB/glTF.", 1, ["WRITE"]),
  def("creative.film", "Short Film → WebM", "Assemble a short film on the device: scenes of generative art, charts, diagrams or gradients with titles, camera moves, crossfades and a synthesised soundtrack, encoded to WebM with WebCodecs (MediaRecorder fallback). No video API.", 1, ["WRITE"]),
  def("creative.export", "Export a Visual or Drawing", "Write a visual (svg, png, json, mmd, html, csv, glb, gltf, webm) or an Excalidraw drawing (excalidraw, svg, png) as a file, re-open it and verify it.", 1, ["WRITE"]),
  def("research.board", "Research Board", "Research a subject from public sources (Wikipedia, Crossref, arXiv) and build a cited document with a table, chart and a mind map — every claim carries its source.", 1, ["READ", "EXTERNAL_ACTION"]),
  def("data.query", "Public Data Query", "Retrieve structured rows from a public no-key data source (Wikipedia, Wikidata SPARQL, Crossref, arXiv, OpenAlex, USGS earthquakes, NWS forecasts, Open-Meteo, Hacker News, GitHub releases, OpenStreetMap) with a citation.", 1, ["READ", "EXTERNAL_ACTION"]),
  def("data.sources", "Public Data Sources", "List the public data connectors with their parameters, limits, terms and last verification.", 0, ["READ"]),
  def("device.capabilities", "Device Capabilities", "What this browser/device can execute: WebGPU/WebGL2, OffscreenCanvas, Workers, WebCodecs, MediaRecorder, Web Audio, IndexedDB, File System Access, speech — and the path each creative tool will take.", 0, ["READ"]),
  def("tools.catalog", "Tool Capability Catalog", "Every tool's profile: what it executes, inputs/outputs, where it runs, whether it works offline or needs network/credentials, limits, license, resources and fallbacks.", 0, ["READ"]),
];

export function registerCreativeKitTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const d of CREATIVE_KIT_TOOLS) registry.register(d);
  // Existing tools get their profiles too, so the catalog is complete.
  for (const [id, profile] of Object.entries(CAPABILITY_PROFILES)) {
    const t = registry.get(id);
    if (t && !t.profile) registry.register({ ...t, profile });
  }
}
