/**
 * ==========================================================
 * LÉLU — CHAT UNIVERSE ENVIRONMENTS (registry + recommender)
 *
 * A conversation can be staged as one of these environments. Each has a
 * purpose, the kinds of work it hosts, how the window should be laid out
 * for it, and an honest statement of where its work runs. The recommender
 * picks one from what was asked and what was made — rules, not inference,
 * so "LÉLU opened the research workspace" never costs a model call.
 * ==========================================================
 */

import type { StageMode, StewardMode } from "./WorkspaceSteward";

export type Runs = "local" | "public-data" | "provider" | "server";

export interface EnvironmentDef {
  id: StageMode;
  label: string;
  glyph: string;
  purpose: string;
  /** Studio artifact kinds / visual media it shows. */
  hosts: string[];
  /** How the steward should lay the window out when it opens. */
  layout: StewardMode;
  runs: Runs[];
  family: "talk" | "find" | "make" | "show";
}

export const ENVIRONMENTS: EnvironmentDef[] = [
  { id: "conversation", label: "Chat", glyph: "◍", purpose: "The conversation itself.", hosts: [], layout: "auto", runs: ["provider"], family: "talk" },
  { id: "thread", label: "Thread", glyph: "💧", purpose: "The conversation with its live objects (Neural Maps, videos, pages, research, images, 3D) in a liquid layout: raindrop, workspace, ribbon, live or split.", hosts: ["graph", "media"], layout: "fullscreen", runs: ["provider", "local"], family: "talk" },
  { id: "research", label: "Research", glyph: "⌕", purpose: "Find: public sources, papers, data and your own conversation history, with citations; turn findings into boards and documents.", hosts: ["document", "graph"], layout: "auto", runs: ["public-data", "local"], family: "find" },
  { id: "board", label: "Board", glyph: "⌘", purpose: "Research board / knowledge map built from the conversation and its sources; editable.", hosts: ["graph"], layout: "auto", runs: ["local"], family: "find" },
  { id: "document", label: "Document", glyph: "▤", purpose: "Long-form reading and a real document (DOCX/PDF/MD/HTML) from the conversation.", hosts: ["document"], layout: "focus", runs: ["local"], family: "make" },
  { id: "diagram", label: "Diagram", glyph: "⟜", purpose: "Mermaid diagrams and flowcharts: generate, edit the source, version, export SVG/PNG/MMD.", hosts: ["visual:diagram", "graph", "drawing"], layout: "focus", runs: ["local"], family: "make" },
  { id: "data", label: "Data", glyph: "▥", purpose: "Tables from the conversation and live public data, as interactive charts and workbooks.", hosts: ["visual:chart", "workbook"], layout: "focus", runs: ["public-data", "local"], family: "make" },
  { id: "code", label: "Code", glyph: "{}", purpose: "Code from the conversation: read, edit, run HTML/JS prototypes in a sandbox, download.", hosts: [], layout: "focus", runs: ["local"], family: "make" },
  { id: "gallery", label: "Gallery", glyph: "▣", purpose: "Images and visual works beside the chat; generate and restyle compositions.", hosts: ["visual:generative", "drawing"], layout: "auto", runs: ["local"], family: "show" },
  { id: "spatial", label: "3D", glyph: "⬡", purpose: "3D scenes and models: build, inspect, change, export GLB/glTF/STL/OBJ and reopen.", hosts: ["visual:scene3d"], layout: "fullscreen", runs: ["local"], family: "make" },
  { id: "film", label: "Film", glyph: "▶︎", purpose: "Films from the conversation: storyboard, render WebM on this device, play, export.", hosts: ["visual:video"], layout: "focus", runs: ["local"], family: "make" },
  { id: "voice", label: "Voice", glyph: "◖", purpose: "Listen to the conversation and talk to LÉLU.", hosts: [], layout: "auto", runs: ["local", "server"], family: "talk" },
  { id: "present", label: "Present", glyph: "▶", purpose: "Full-screen slides from the conversation; export a PPTX deck.", hosts: ["deck"], layout: "fullscreen", runs: ["local"], family: "show" },
  { id: "cinematic", label: "Cinematic", glyph: "✦", purpose: "Immersive reading with the conversation's media.", hosts: [], layout: "fullscreen", runs: ["local"], family: "show" },
  { id: "studio", label: "Workbench", glyph: "◫", purpose: "Multi-panel: the chat, the browser and the conversation's works side by side, arranged by LÉLU.", hosts: ["*"], layout: "tile", runs: ["local"], family: "make" },
];

export const environmentOf = (id: StageMode): EnvironmentDef => ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];

/** What a request asks for, by family of work. Ordered: the first match wins. */
const REQUEST_RULES: Array<[RegExp, StageMode]> = [
  [/\b(research|look up|find (me )?(papers|sources|studies|articles)|literature|cite|citations|sources on|what does the research)\b/i, "research"],
  [/\b(3d|three.?d|scene|model|glb|gltf|stl|\.obj|sculpt|mesh|engine)\b/i, "spatial"],
  [/\b(diagram|flowchart|flow chart|architecture|sequence diagram|mind ?map|mermaid|system map)\b/i, "diagram"],
  [/\b(chart|graph (of|the)|plot|dataset|data on|statistics|analy[sz]e (the )?data|earthquakes|forecast|table of)\b/i, "data"],
  [/\b(film|video|movie|animation|animate|storyboard)\b/i, "film"],
  [/\b(presentation|slides|slide deck|pitch deck|keynote)\b/i, "present"],
  [/\b(document|report|essay|brief|write[- ]?up|article|paper on)\b/i, "document"],
  [/\b(code|function|script|component|html|css|javascript|typescript|python|prototype|website|web page|app)\b/i, "code"],
  [/\b(art|artwork|image|picture|illustration|composition|moodboard|mood board|collection|fashion|sketch|drawing)\b/i, "gallery"],
  [/\b(read (it )?aloud|speak|say it|voice|listen)\b/i, "voice"],
];

/** What was made decides too: the work should be on screen. */
const ARTIFACT_STAGE: Array<[string, StageMode]> = [
  ["visual:scene3d", "spatial"], ["visual:video", "film"], ["visual:chart", "data"], ["visual:diagram", "diagram"],
  ["visual:generative", "gallery"], ["drawing", "gallery"], ["deck", "present"], ["workbook", "data"], ["graph", "board"], ["document", "document"],
];

export interface Recommendation {
  stage: StageMode;
  reason: string;
}

/**
 * Pick the environment for a turn. `made` are the artifact keys the turn
 * produced ("visual:scene3d", "document", …). Returns null when plain chat
 * is right — a greeting is not a workspace.
 */
export function recommendEnvironment(request: string, made: string[] = []): Recommendation | null {
  for (const [key, stage] of ARTIFACT_STAGE) {
    if (made.includes(key)) return { stage, reason: `the reply made a ${key.replace("visual:", "")}` };
  }
  const text = request.trim();
  if (text.length < 8 || /\?$/.test(text) && text.split(/\s+/).length < 6) return null;
  for (const [re, stage] of REQUEST_RULES) {
    if (re.test(text)) return { stage, reason: `the request is ${environmentOf(stage).label.toLowerCase()} work` };
  }
  return null;
}

export function artifactKey(a: { kind: string; medium?: string }): string {
  return a.kind === "visual" && a.medium ? `visual:${a.medium}` : a.kind;
}
