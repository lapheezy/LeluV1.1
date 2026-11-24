/**
 * ==========================================================
 * LÉLU — CAPABILITY PROFILES
 *
 * For each tool: what it executes, its inputs and outputs,
 * where it runs, whether it works offline, whether it needs a
 * network or credentials, its limits, license/attribution,
 * resource needs and fallbacks. Carried on the ToolDefinition
 * (`profile`) so agents discover tools from the registry they
 * already query, and listed by tools.catalog.
 *
 * "offline: true" is claimed only for tools whose execution
 * makes no network request at all (tested in
 * tests/creative-kit.test.ts with fetch disabled).
 * ==========================================================
 */

export interface CapabilityProfile {
  purpose: string;
  input: string;
  output: string;
  runtime: "browser" | "server" | "browser+server" | "browser (any)" | "local process";
  offline: boolean;
  network: "none" | "public data (no key)" | "existing server" | "existing keys (free tiers)";
  credentials: "none" | "existing configured keys only";
  limits: string;
  license: string;
  resources: string;
  fallbacks: string[];
}

export const CAPABILITY_PROFILES: Record<string, CapabilityProfile> = {
  "creative.art": {
    purpose: "procedural / generative artwork", input: "style, seed, palette, density, size", output: "SVG (editable), PNG, JSON program",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "≤ 4096×4096; ~6k primitives",
    license: "LÉLU code (no third-party art library)", resources: "CPU, < 1 s, < 1 MB", fallbacks: ["PNG via Canvas", "SVG only outside a browser"],
  },
  "creative.diagram": {
    purpose: "diagrams from text or structure", input: "Mermaid source or nodes/edges/groups", output: ".mmd source, SVG, PNG",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "40k characters of source",
    license: "Mermaid — MIT", resources: "Mermaid chunk loaded on first use", fallbacks: [".mmd source outside a browser"],
  },
  "creative.chart": {
    purpose: "interactive data visualization", input: "labels/series (or a data connector + columns)", output: "self-contained interactive HTML, SVG, PNG, CSV",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "5,000 points, 12 series",
    license: "LÉLU code", resources: "CPU, milliseconds", fallbacks: ["static SVG", "CSV table"],
  },
  "creative.build": {
    purpose: "construct an artifact from parameters", input: "builder (or a subject in words) + parameter overrides", output: "GLB, glTF, JSON; layered live view with steps and derivation",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "400 objects per scene; builders: gearbox, cabin, molecule",
    license: "three.js — MIT", resources: "CPU for construction (< 5 ms), GPU for the live view",
    fallbacks: ["WebGPU", "WebGL2", "export-only (no live view)"],
  },
  "creative.modify": {
    purpose: "change a construction as a new revision", input: "artifact + words or explicit parameters", output: "a new revision of the same artifact, with what changed",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "the builder's own parameter ranges",
    license: "three.js — MIT", resources: "CPU (< 5 ms per revision)", fallbacks: ["rebuild from the previous parameters if the builder cannot honour a change"],
  },
  "creative.inspect": {
    purpose: "explain one system of a construction", input: "a topic (layer or step) and optionally an artifact", output: "the layer note, its parts and their notes, the matching step",
    runtime: "browser+server", offline: true, network: "none", credentials: "none", limits: "only what the artifact itself records",
    license: "—", resources: "none", fallbacks: ["says which layers it does have instead of inventing one"],
  },
  "creative.domains": {
    purpose: "list what can be built", input: "none", output: "builder ids, domains, labels, keywords",
    runtime: "browser+server", offline: true, network: "none", credentials: "none", limits: "—",
    license: "—", resources: "none", fallbacks: [],
  },
  "creative.engine": {
    purpose: "an interactive four-stroke engine", input: "nothing (a fixed, complete engine program)", output: "GLB, glTF (embedded), JSON program; layered live view with the animated cycle",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "8 layers, 33 parts, 4 strokes, 720° of crankshaft",
    license: "three.js — MIT", resources: "GPU for the live view (one canvas); CPU for export (20–120 ms)",
    fallbacks: ["WebGPU", "WebGL2", "export-only (no live view)"],
  },
  "creative.scene3d": {
    purpose: "3D scenes and environments", input: "preset and/or objects, lights, camera, animation", output: "GLB, glTF (embedded), JSON program; live view",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "400 object groups, 4,000 instances",
    license: "three.js — MIT", resources: "CPU for export (20–500 ms); GPU for the live view", fallbacks: ["WebGPU", "WebGL2", "export-only (no live view)"],
  },
  "creative.film": {
    purpose: "short films", input: "scenes (visual, duration, titles, motion), transition, soundtrack", output: "WebM (VP9/VP8 + Opus), JSON program",
    runtime: "browser", offline: true, network: "none", credentials: "none", limits: "90 s, 24 scenes, ≤ 1080p",
    license: "Mediabunny — MPL-2.0 (unmodified dependency); Web platform APIs", resources: "device CPU/GPU encoder; faster than real time with WebCodecs",
    fallbacks: ["WebCodecs VP9", "WebCodecs VP8/AV1", "MediaRecorder (real time)", "JSON program only (no browser)"],
  },
  "creative.export": {
    purpose: "write and verify a file", input: "artifact + format", output: "file bytes, SHA-256, read-back checks",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "96 MB of exports kept in memory",
    license: "Excalidraw — MIT (drawings)", resources: "as the medium", fallbacks: ["File System Access save", "download link"],
  },
  "research.board": {
    purpose: "cited research document + mind map", input: "topic", output: "Studio document (overview, table, chart, preprints, sources) + Mermaid mind map",
    runtime: "browser+server", offline: false, network: "public data (no key)", credentials: "none", limits: "each source's published limits (data.sources)",
    license: "Wikipedia CC BY-SA; Crossref metadata; arXiv terms", resources: "3–4 HTTP requests, cached", fallbacks: ["builds from whichever sources answered"],
  },
  "data.query": {
    purpose: "structured public data", input: "connector id + parameters", output: "rows, columns, suggested chart, citation",
    runtime: "browser+server", offline: false, network: "public data (no key)", credentials: "none", limits: "per connector (rate-paced and cached client-side)",
    license: "per source (attribution included in every result)", resources: "1–2 HTTP requests", fallbacks: ["cache", "arXiv through this server's knowledge relay in the browser"],
  },
  "data.sources": {
    purpose: "list data connectors", input: "—", output: "profiles", runtime: "browser (any)", offline: true, network: "none", credentials: "none",
    limits: "—", license: "—", resources: "none", fallbacks: [],
  },
  "device.capabilities": {
    purpose: "measure what this device can execute", input: "—", output: "capability report + chosen paths", runtime: "browser", offline: true, network: "none",
    credentials: "none", limits: "—", license: "—", resources: "< 2 s probe", fallbacks: [],
  },
  "tools.catalog": {
    purpose: "discover tools by capability", input: "optional filter", output: "profiles", runtime: "browser (any)", offline: true, network: "none",
    credentials: "none", limits: "—", license: "—", resources: "none", fallbacks: [],
  },
  // Existing tools (profiles only — their executors are unchanged).
  "studio.create": {
    purpose: "documents, decks, workbooks, graphs, Excalidraw drawings, visuals", input: "artifact spec", output: "artifact; DOCX/PPTX/XLSX/PDF/… for documents",
    runtime: "browser (any)", offline: true, network: "none", credentials: "none", limits: "Studio limits (blocks, slides, rows, 5k drawing elements)",
    license: "docx, pptxgenjs, exceljs, pdf-lib, Excalidraw, React Flow — MIT/Apache", resources: "CPU", fallbacks: [],
  },
  "world.object": {
    purpose: "place a 3D object in her persistent world", input: "object spec", output: "world object (server-persisted)",
    runtime: "browser+server", offline: false, network: "existing server", credentials: "none", limits: "world limits", license: "three.js — MIT", resources: "server write", fallbacks: [],
  },
  "browser.read": {
    purpose: "read a web page", input: "URL", output: "title + text", runtime: "server", offline: false, network: "existing server", credentials: "existing configured keys only",
    limits: "direct read first; Firecrawl (existing 3 keys, free plan credits) only when the direct read is thin", license: "—", resources: "server request", fallbacks: ["direct fetch", "Firecrawl key 1 → 2 → 3"],
  },
  "research.web": {
    purpose: "prose research across knowledge providers", input: "query + focus", output: "digest with sources", runtime: "browser+server", offline: false,
    network: "public data (no key)", credentials: "existing configured keys only", limits: "per provider", license: "per source", resources: "several requests", fallbacks: ["provider chain"],
  },
};

export function profileFor(id: string): CapabilityProfile | undefined {
  return CAPABILITY_PROFILES[id];
}
