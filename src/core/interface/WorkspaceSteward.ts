/**
 * ==========================================================
 * LÉLU — WORKSPACE STEWARD (deterministic, no model)
 *
 * The one place that decides how ALL open windows share the
 * screen. Before this, each window decided its own geometry
 * alone (GenesisModuleHost), so nothing ever noticed twenty
 * chats cascading over each other, an app window opening
 * invisibly under the Chat Universe, or a Projects panel
 * clipped by a 62%-height phone card.
 *
 * It is a POLICY over the existing solver, not a new engine:
 * tiling, focus, cascade and overlap resolution are
 * SpatialModel.planWindows / checkLayout (the same solver
 * LÉLU's interface.* tools preview). What this adds:
 *
 *   - content awareness: each window has a kind with a
 *     minimum readable width, raised by measured overflow
 *     (a panel whose content is wider than its window);
 *   - capacity: windows that cannot fit readably are folded
 *     into a tab strip (still mounted, still running), never
 *     squashed below their content's width;
 *   - phones (portrait, or a phone on its side): one window
 *     is the screen, full-bleed; the rest are tabs;
 *   - honouring the person: hand-placed geometry is kept
 *     while it is valid (on screen, no collisions, wide
 *     enough) and only re-solved when it is not.
 *
 * Pure: same input → same plan. Runs on every window change
 * in the browser at zero cost — there is no model in here.
 * ==========================================================
 */

import { GAP, MIN_HEIGHT, checkLayout, planWindows, type Rect, type Viewport, type WindowDescriptor, type WindowLayout } from "./SpatialModel";

export type StewardMode = "auto" | "tile" | "split" | "focus" | "stack" | "fullscreen";
export const STEWARD_MODES: StewardMode[] = ["auto", "tile", "split", "focus", "stack", "fullscreen"];

export type ContentKind = "chat" | "browser" | "studio" | "projects" | "document" | "spatial" | "panel";

/** Smallest width at which each kind of content is readable without clipping. */
export const KIND_MIN_WIDTH: Record<ContentKind, number> = {
  chat: 360,
  browser: 680,
  studio: 760,
  projects: 560,
  document: 520,
  spatial: 600,
  panel: 400,
};

/** What a window of this kind would like when it has the room. */
export const KIND_PREFERRED: Record<ContentKind, { width: number; height: number }> = {
  chat: { width: 720, height: 820 },
  browser: { width: 1180, height: 820 },
  studio: { width: 1240, height: 840 },
  projects: { width: 960, height: 760 },
  document: { width: 900, height: 820 },
  spatial: { width: 1100, height: 760 },
  panel: { width: 760, height: 680 },
};

const STUDIO_IDS = /^(eng-studio|voice-studio|visualstudio|creation|render|sketch|studio|video|lab|engineering)/;
const SPATIAL_IDS = /^(earth|genesisv2|avatar|cosmos|world)/;

export function kindOf(moduleId: string): ContentKind {
  if (moduleId.startsWith("chat:") || moduleId === "chat") return "chat";
  if (moduleId === "browser" || moduleId.startsWith("browser:")) return "browser";
  if (moduleId.startsWith("artifact:") || moduleId.startsWith("atelier:") || moduleId === "files" || moduleId === "history") return "document";
  if (moduleId === "projects" || moduleId === "workspaces" || moduleId === "agents") return "projects";
  if (STUDIO_IDS.test(moduleId)) return "studio";
  if (SPATIAL_IDS.test(moduleId)) return "spatial";
  return "panel";
}

export interface StewardWindow {
  id: string;
  label: string;
  /** Higher = more recently raised (top of the stack). */
  order: number;
  presentation: "inline" | "expanded";
  rect?: Rect | null;
  /** The person placed it by hand. */
  manual?: boolean;
  pinned?: boolean;
  /** Measured: the content needed at least this much width last time it rendered. */
  neededWidth?: number;
}

export interface StewardInput {
  viewport: { width: number; height: number };
  windows: StewardWindow[];
  mode: StewardMode;
  /** The window a "focus"/"split" should centre on; defaults to the top one. */
  focusId?: string | null;
  /** Chrome the workspace must not cover (Universe header, dock rail…). */
  insets?: Partial<Viewport["insets"]>;
}

export interface StewardPlacement {
  id: string;
  rect: Rect;
  /** Stacking rank, 0 = bottom. */
  rank: number;
  /** A phone sheet: full-bleed, no rounded card. */
  sheet: boolean;
}

export type StewardLayout = "sheet" | "free" | "single" | "split" | "focus" | "tile" | "stack" | "fullscreen";

export interface StewardPlan {
  compact: boolean;
  layout: StewardLayout;
  placements: Record<string, StewardPlacement>;
  /** Open and running, folded into the tab strip because they don't fit readably. */
  tabs: string[];
  reasons: string[];
  /** What was wrong with the arrangement the windows were in before this plan. */
  before: { overlaps: number; offscreen: number; narrow: string[] };
}

/** A phone, or a phone on its side: one window is the whole screen. */
export function isCompact(viewport: { width: number; height: number }): boolean {
  return viewport.width < 720 || viewport.height < 500;
}

export function minWidthOf(w: StewardWindow): number {
  return Math.max(KIND_MIN_WIDTH[kindOf(w.id)], Math.min(w.neededWidth ?? 0, 1600));
}

function area(viewport: { width: number; height: number }, insets: Partial<Viewport["insets"]> = {}): Rect {
  const top = insets.top ?? 64;
  const left = insets.left ?? 16;
  const right = insets.right ?? 16;
  const bottom = insets.bottom ?? 16;
  return { x: left, y: top, width: Math.max(1, viewport.width - left - right), height: Math.max(1, viewport.height - top - bottom) };
}

function toViewport(viewport: { width: number; height: number }, a: Rect): Viewport {
  return {
    width: viewport.width,
    height: viewport.height,
    mobile: false,
    insets: { top: a.y, left: a.x, right: viewport.width - a.x - a.width, bottom: viewport.height - a.y - a.height },
  };
}

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

/** How many windows fit side by side (and two rows deep) at their readable widths. */
function capacity(ordered: StewardWindow[], a: Rect): number {
  const rows = a.height >= MIN_HEIGHT * 2 + GAP + 180 ? 2 : 1;
  let fit = 0;
  // Greedy: columns of the widest-needed windows first, `rows` per column.
  const widths = ordered.map(minWidthOf);
  let used = 0;
  for (let i = 0; i < widths.length; i += rows) {
    const col = Math.max(...widths.slice(i, i + rows));
    if (used + col + (used ? GAP : 0) > a.width) break;
    used += col + (used ? GAP : 0);
    fit = Math.min(widths.length, i + rows);
  }
  return Math.max(1, fit);
}

function centred(w: StewardWindow, a: Rect): Rect {
  const pref = KIND_PREFERRED[kindOf(w.id)];
  const width = Math.min(a.width, Math.max(minWidthOf(w), pref.width));
  const height = Math.min(a.height, pref.height);
  return { x: a.x + (a.width - width) / 2, y: a.y + Math.max(0, (a.height - height) / 3), width, height };
}

/** Weighted columns, each at least its window's readable width. */
function weightedColumns(ws: StewardWindow[], a: Rect): Rect[] {
  const mins = ws.map(minWidthOf);
  const total = mins.reduce((s, m) => s + m, 0);
  const usable = a.width - GAP * (ws.length - 1);
  let x = a.x;
  return ws.map((_, i) => {
    const width = (usable * mins[i]) / total;
    const r = { x, y: a.y, width, height: a.height };
    x += width + GAP;
    return r;
  });
}

function descriptors(ws: StewardWindow[], a: Rect): WindowDescriptor[] {
  return ws.map((w, i) => ({
    id: w.id,
    kind: kindOf(w.id) === "chat" ? "chat" : "module",
    label: w.label,
    presentation: "inline",
    rect: w.rect ?? centred(w, a),
    zIndex: 40 + (ws.length - i),
    rotation: 0,
  }));
}

function solved(ws: StewardWindow[], a: Rect, viewport: { width: number; height: number }, strategy: "grid" | "focus" | "cascade" | "fit", primary?: string): Record<string, Rect> {
  const plan = planWindows(descriptors(ws, a), [{ op: "arrange", strategy, ids: ws.map((w) => w.id), primary }], toViewport(viewport, a));
  return Object.fromEntries(ws.map((w) => [w.id, layoutRect(plan.layout[w.id])]));
}

const layoutRect = (l: WindowLayout): Rect => ({ x: l.x, y: l.y, width: l.width, height: l.height });

/** Is the arrangement the person left still valid for this content on this screen? */
function freeArrangementHolds(ws: StewardWindow[], a: Rect, viewport: { width: number; height: number }): { ok: boolean; overlaps: number; offscreen: number; narrow: string[] } {
  const layout: Record<string, WindowLayout> = {};
  for (const w of ws) {
    if (!w.rect) return { ok: false, overlaps: 0, offscreen: 0, narrow: [] };
    layout[w.id] = { presentation: "inline", ...w.rect, zIndex: 0, rotation: 0 };
  }
  const check = checkLayout(layout, toViewport(viewport, a));
  const narrow = ws.filter((w) => (w.rect?.width ?? 0) + 1 < minWidthOf(w) && a.width >= minWidthOf(w)).map((w) => w.id);
  return { ok: !check.overlaps.length && !check.offscreen.length && !narrow.length, overlaps: check.overlaps.length, offscreen: check.offscreen.length, narrow };
}

export function planWorkspace(input: StewardInput): StewardPlan {
  const { viewport, mode } = input;
  const ordered = [...input.windows].sort((x, y) => y.order - x.order); // top first
  const reasons: string[] = [];
  const placements: Record<string, StewardPlacement> = {};
  const rankOf = (id: string) => ordered.length - 1 - ordered.findIndex((w) => w.id === id);
  const put = (id: string, rect: Rect, sheet = false) => (placements[id] = { id, rect: round(rect), rank: rankOf(id), sheet });
  const a = area(viewport, input.insets);
  const health = freeArrangementHolds(ordered, a, viewport);
  const before = { overlaps: health.overlaps, offscreen: health.offscreen, narrow: health.narrow };

  if (!ordered.length) return { compact: isCompact(viewport), layout: "free", placements, tabs: [], reasons: ["no windows open"], before };

  const focus = ordered.find((w) => w.id === input.focusId) ?? ordered[0];

  /* ---------------- phones: one window is the screen ---------------- */
  if (isCompact(viewport)) {
    const landscapeSplit = mode === "split" && viewport.width >= 640 && ordered.length >= 2;
    if (landscapeSplit) {
      const pair = [focus, ordered.find((w) => w.id !== focus.id)!];
      const full = area(viewport, { top: input.insets?.top ?? 0, left: 0, right: 0, bottom: 0 });
      const [l, r] = [
        { ...full, width: (full.width - 6) / 2 },
        { ...full, x: full.x + (full.width + 6) / 2, width: (full.width - 6) / 2 },
      ];
      put(pair[0].id, l, true);
      put(pair[1].id, r, true);
      reasons.push(`phone on its side: ${pair[0].label} and ${pair[1].label} side by side`);
      const tabs = ordered.filter((w) => !placements[w.id]).map((w) => w.id);
      if (tabs.length) reasons.push(`${tabs.length} more window(s) wait as tabs`);
      return { compact: true, layout: "split", placements, tabs, reasons, before };
    }
    const top = input.insets?.top ?? 0;
    put(focus.id, { x: 0, y: top, width: viewport.width, height: viewport.height - top }, true);
    const tabs = ordered.filter((w) => w.id !== focus.id).map((w) => w.id);
    reasons.push(
      tabs.length
        ? `phone: ${focus.label} fills the screen; ${tabs.length} other window(s) are tabs, still running`
        : `phone: ${focus.label} fills the screen`,
    );
    return { compact: true, layout: "sheet", placements, tabs, reasons, before };
  }

  /* ---------------- desktop / tablet ---------------- */
  if (mode === "fullscreen") {
    put(focus.id, a);
    const tabs = ordered.filter((w) => w.id !== focus.id).map((w) => w.id);
    reasons.push(`${focus.label} takes the whole workspace${tabs.length ? `; ${tabs.length} other(s) are tabs` : ""}`);
    return { compact: false, layout: "fullscreen", placements, tabs, reasons, before };
  }

  // Focus first, then by recency.
  const queue = [focus, ...ordered.filter((w) => w.id !== focus.id)];
  const cap = Math.min(mode === "tile" ? 6 : mode === "split" ? 2 : mode === "stack" ? 8 : 4, capacity(queue, a));
  const shown = queue.slice(0, Math.max(1, cap));
  const tabs = queue.slice(shown.length).map((w) => w.id);
  if (tabs.length) reasons.push(`${tabs.length} window(s) would be squashed below their readable width, so they wait as tabs (still running)`);

  let layout: StewardLayout;
  if (mode === "auto") {
    const keep = freeArrangementHolds(shown, a, viewport);
    if (keep.ok && shown.every((w) => w.manual || w.pinned)) {
      shown.forEach((w) => put(w.id, w.rect!));
      reasons.push("your arrangement fits — kept as you left it");
      return { compact: false, layout: "free", placements, tabs, reasons, before };
    }
    if (keep.overlaps) reasons.push(`${keep.overlaps} overlap(s) resolved`);
    if (keep.offscreen) reasons.push(`${keep.offscreen} window(s) brought back on screen`);
    if (keep.narrow.length) reasons.push(`${keep.narrow.join(", ")} widened so the content isn't clipped`);
  }

  const n = shown.length;
  const effective: StewardMode = mode === "auto" ? (n === 1 ? "focus" : n === 2 ? "split" : n === 3 ? "focus" : "tile") : mode;

  if (n === 1) {
    layout = "single";
    put(shown[0].id, mode === "focus" || mode === "auto" ? centred(shown[0], a) : a);
    reasons.push(`${shown[0].label} centred at a readable size`);
  } else if (effective === "split") {
    layout = "split";
    const cols = weightedColumns(shown.slice(0, Math.min(n, 3)), a);
    shown.slice(0, cols.length).forEach((w, i) => put(w.id, cols[i]));
    reasons.push(`side by side: ${shown.slice(0, cols.length).map((w) => w.label).join(" | ")}`);
  } else if (effective === "focus") {
    layout = "focus";
    const rects = solved(shown, a, viewport, "focus", focus.id);
    // The focus column must be wide enough for its content; if not, give it the room.
    const main = rects[focus.id];
    if (main && main.width < minWidthOf(focus) && a.width - minWidthOf(focus) - GAP >= 320) {
      const side = { x: a.x + minWidthOf(focus) + GAP, y: a.y, width: a.width - minWidthOf(focus) - GAP, height: a.height };
      rects[focus.id] = { ...a, width: minWidthOf(focus) };
      const rest = shown.filter((w) => w.id !== focus.id);
      const h = (side.height - GAP * (rest.length - 1)) / rest.length;
      rest.forEach((w, i) => (rects[w.id] = { x: side.x, y: side.y + i * (h + GAP), width: side.width, height: h }));
    }
    shown.forEach((w) => put(w.id, rects[w.id]));
    reasons.push(`${focus.label} is the focus; ${n - 1} beside it`);
  } else if (effective === "stack") {
    layout = "stack";
    const rects = solved(shown, a, viewport, "cascade");
    shown.forEach((w) => put(w.id, rects[w.id]));
    reasons.push(`${n} windows stacked, titles visible`);
  } else {
    layout = "tile";
    const rects = solved(shown, a, viewport, "grid");
    shown.forEach((w) => put(w.id, rects[w.id]));
    reasons.push(`${n} windows tiled without overlap`);
  }

  return { compact: false, layout, placements, tabs, reasons, before };
}

/* ------------------------------------------------------------------ *
 * NATURAL LANGUAGE → WORKSPACE COMMAND (deterministic)
 *
 * "tile my windows", "put the browser beside the chat", "make this
 * cinematic", "turn this into a research board". Recognised locally so
 * a layout request never costs a model call.
 * ------------------------------------------------------------------ */

export type StageMode =
  | "conversation" | "cinematic" | "board" | "gallery" | "present" | "spatial"
  | "research" | "document" | "diagram" | "data" | "code" | "film" | "voice" | "studio";
export const STAGE_MODES: StageMode[] = [
  "conversation", "cinematic", "board", "gallery", "present", "spatial",
  "research", "document", "diagram", "data", "code", "film", "voice", "studio",
];

export type TransformTarget = "document" | "deck" | "diagram" | "chart" | "workbook" | "film";
export const TRANSFORM_TARGETS: TransformTarget[] = ["document", "deck", "diagram", "chart", "workbook", "film"];

export interface WorkspaceCommand {
  mode?: StewardMode;
  stage?: StageMode;
  /** Make a real artifact from the conversation (Studio), then show it. */
  transform?: TransformTarget;
  /** Module ids to open/raise as part of the command, in focus order. */
  open?: string[];
  summary: string;
}

const MODULE_WORDS: Array<[RegExp, string]> = [
  [/\bbrowser|browsing|web ?page|website\b/, "browser"],
  [/\bprojects?\b/, "projects"],
  [/\bengineering( studio)?\b/, "eng-studio"],
  [/\bvoice studio\b/, "voice-studio"],
  [/\b(visual studio|studio)\b/, "visualstudio"],
  [/\bsecurity( center)?\b/, "security-center"],
  [/\binfrastructure|infra\b/, "infra-monitor"],
  [/\bsettings\b/, "settings"],
  [/\bmemory\b/, "memory"],
  [/\bagents?\b/, "agents"],
  [/\bearth\b/, "earth"],
];

/** Only short, imperative layout requests qualify — a question about layouts still goes to LÉLU's reasoning. */
export function parseWorkspaceCommand(raw: string): WorkspaceCommand | null {
  const text = raw.toLowerCase().replace(/[“”"'’]/g, "").trim();
  if (!text || text.length > 160 || /\?\s*$/.test(text)) return null;
  if (/^(why|how|what|can you explain|explain|tell me)\b/.test(text)) return null;
  const verb = /\b(make|turn|switch|change|put|move|show|open|tile|split|organi[sz]e|tidy|arrange|clean ?up|stack|focus|maximi[sz]e|full ?screen|expand|go|present|fix|lay ?out|rearrange|sort out|chart|plot|draw|visuali[sz]e|write|build|create|render|export|save|convert|bring up|take me)\b/;
  if (!verb.test(text)) return null;

  const opens = MODULE_WORDS.filter(([re]) => re.test(text)).map(([, id]) => id);
  const mentionsChat = /\b(chat|conversation)\b/.test(text);

  // Make real work from the conversation: a versioned Studio artifact.
  const making = /\b(turn|convert|make|export|save|write|build|create|render|chart|plot|draw|visuali[sz]e)\b/.test(text) && /\b(this|it|the conversation|the chat|these|that)\b/.test(text);
  if (making) {
    if (/\b(slide ?deck|deck|pptx|power ?point)\b/.test(text)) return { transform: "deck", stage: "present", summary: "Built a slide deck from the conversation" };
    if (/\b(document|report|word doc|docx|pdf|write-?up|brief)\b/.test(text)) return { transform: "document", stage: "document", summary: "Wrote a document from the conversation" };
    if (/\b(spreadsheet|workbook|xlsx|excel)\b/.test(text)) return { transform: "workbook", stage: "data", summary: "Collected the conversation's tables into a workbook" };
    if (/\b(chart|plot|graph the|visuali[sz]e)\b/.test(text)) return { transform: "chart", stage: "data", summary: "Charted the conversation's data" };
    if (/\b(diagram|flow ?chart|mermaid|system map)\b/.test(text)) return { transform: "diagram", stage: "diagram", summary: "Drew a diagram of the conversation" };
    if (/\b(film|video|movie|animation)\b/.test(text) && !/\bfilm ?mode\b/.test(text)) return { transform: "film", stage: "film", summary: "Storyboarded a film from the conversation" };
  }
  // Open an environment by name.
  const envWord = /\b(research|document|diagram|data|code|film|voice|workbench|3d|gallery|board|presentation)\b/.exec(text);
  if (envWord && /\b(open|show|switch to|go to|take me to|bring up)\b/.test(text) && /\b(workspace|environment|view|mode|studio|tab|space)\b/.test(text)) {
    const map: Record<string, StageMode> = { research: "research", document: "document", diagram: "diagram", data: "data", code: "code", film: "film", voice: "voice", workbench: "studio", "3d": "spatial", gallery: "gallery", board: "board", presentation: "present" };
    return { stage: map[envWord[1]], summary: `Opened the ${envWord[1]} workspace` };
  }

  // Stage transformations of the conversation itself.
  if (/\bcinematic|immersive|movie|film ?mode\b/.test(text)) return { stage: "cinematic", summary: "Made the conversation cinematic" };
  if (/\b(diagram|flow ?chart)\b/.test(text)) return { stage: "diagram", summary: "Opened the diagram workspace" };
  if (/\b(research|visual|knowledge|idea|mind) ?(board|map|graph|canvas)\b|\bboard\b|\bknowledge graph\b|\bcanvas\b/.test(text))
    return { stage: "board", summary: "Turned the conversation into a research board" };
  if (/\b(gallery|images|pictures|photos|media)\b/.test(text) && !opens.length) {
    return /\bbeside|next to|alongside\b/.test(text)
      ? { stage: "gallery", mode: "split", summary: "Put the images beside the chat" }
      : { stage: "gallery", summary: "Opened the conversation's media gallery" };
  }
  if (/\bpresent(ation)?|slides?|keynote\b/.test(text)) return { stage: "present", summary: "Turned the conversation into a full-screen presentation" };
  if (/\b3d|three.?d|spatial|space\b/.test(text)) return { stage: "spatial", summary: "Expanded the conversation into a 3D environment" };
  if (/\b(normal|plain|regular|back to (the )?chat|classic)\b/.test(text) && mentionsChat) return { stage: "conversation", summary: "Back to the plain conversation" };

  // Window organisation.
  if (/\b(beside|next to|alongside|side by side|split)\b/.test(text))
    return { mode: "split", open: opens, summary: opens.length ? `Put ${opens.join(" and ")} beside the chat` : "Split the workspace side by side" };
  if (/\b(full ?screen|maximi[sz]e|expand)\b/.test(text)) return { mode: "fullscreen", open: opens, summary: `Gave ${opens[0] ?? "the top window"} the whole workspace` };
  if (/\bfocus\b/.test(text)) return { mode: "focus", open: opens, summary: `Focused ${opens[0] ?? "the top window"}` };
  if (/\bstack|cascade\b/.test(text)) return { mode: "stack", open: opens, summary: "Stacked the windows" };
  if (/\btile|grid\b/.test(text)) return { mode: "tile", open: opens, summary: "Tiled the windows" };
  if (/\b(organi[sz]e|tidy|arrange|rearrange|clean ?up|sort out|fix)\b.*\b(windows?|workspace|layout|screen|desktop|mess|everything|this)\b|\bchange the (entire |whole )?layout\b/.test(text))
    return { mode: "auto", open: opens, summary: "Organised the workspace" };
  if (opens.length && /\b(open|show)\b/.test(text) && /\b(and|with|plus)\b/.test(text) && mentionsChat)
    return { mode: "split", open: opens, summary: `Opened ${opens.join(" and ")} beside the chat` };
  return null;
}
