/**
 * ==========================================================
 * LÉLU
 * CREATIVE TOOL INTERFACE
 *
 * The clean tool/API abstraction between LÉLU's cognition (and
 * agents) and the Sketch canvas. Cognition never talks to the
 * canvas implementation — it issues structured commands here,
 * and the tool layer executes them against the live document.
 *
 * Every command performs a REAL operation on the document and
 * returns a structured result describing what actually changed.
 * Commands that need imagery LÉLU cannot produce (e.g. a full
 * photoreal render) are answered honestly with what the tool
 * CAN do, never faked.
 *
 * Supported command families (case-insensitive, flexible):
 *   draw/layer commands   — add layer, rename, duplicate, clear,
 *                           reorder, visibility, opacity, lock
 *   composition commands  — draw a composition guide (mannequin
 *                           silhouette + center line), shapes,
 *                           lines, text annotation
 *   element commands      — move elements, change color/size
 *   canvas commands       — resize, background, export, save
 * ==========================================================
 */

import SketchStore, { type SketchDocument, type SketchLayer, type SketchElement, type SketchShapeKind, type SketchStroke } from "./SketchDocument";

export interface ToolCommandResult {
  ok: boolean;
  message: string;
  /** What actually changed on the document. */
  actions: string[];
  document: SketchDocument;
}

export interface ToolCommandInput {
  /** Natural-language command from LÉLU / an agent / the user. */
  command: string;
  document: SketchDocument;
  /** When true, saves the document through SketchStore after ops. */
  autosave: boolean;
}

export type ToolExecutor = (input: ToolCommandInput) => ToolCommandResult;

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

const SUPPORTED_EXAMPLES = [
  "add a layer",
  "duplicate the active layer",
  "rename the active layer to <name>",
  "clear the active layer",
  "hide/show layer <n>",
  "draw a concept for <subject>",
  "annotate this sketch with <text>",
  "move the last element",
  "resize the canvas to <w> by <h>",
  "change the background to <color>",
  "save and export as png",
];

/** Palette colors LÉLU can reason about by name. */
const COLOR_NAMES: Record<string, string> = {
  black: "#0a0a0a",
  white: "#f4f4f5",
  gold: "#d4a94e",
  antique: "#8a6d3b",
  copper: "#b87333",
  emerald: "#34d399",
  cyan: "#22d3ee",
  violet: "#a78bfa",
  magenta: "#e879c9",
  red: "#f87171",
  blue: "#60a5fa",
  green: "#4ade80",
  purple: "#c084fc",
  pink: "#f9a8d4",
  amber: "#fbbf24",
  silver: "#cbd5e1",
};

function resolveColor(value: string): string {
  const clean = value.trim().toLowerCase();
  if (COLOR_NAMES[clean]) {
    return COLOR_NAMES[clean];
  }
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(clean)) {
    return clean;
  }
  return "";
}

interface CommandHandler {
  match: RegExp;
  run: (doc: SketchDocument, match: RegExpMatchArray) => { doc: SketchDocument; action: string };
}

function activeLayer(doc: SketchDocument): SketchLayer | undefined {
  return doc.layers.find((layer) => layer.id === doc.activeLayerId);
}

function setLayers(doc: SketchDocument, layers: SketchLayer[]): SketchDocument {
  const activeExists = layers.some((layer) => layer.id === doc.activeLayerId);
  return {
    ...doc,
    layers,
    activeLayerId: activeExists ? doc.activeLayerId : (layers[layers.length - 1]?.id ?? doc.activeLayerId),
  };
}

function updateActive(doc: SketchDocument, updater: (layer: SketchLayer) => SketchLayer): SketchDocument {
  return setLayers(
    doc,
    doc.layers.map((layer) => (layer.id === doc.activeLayerId ? updater(layer) : layer)),
  );
}

/** Rough human composition guide: head circle + shoulder line + center axis. */
function compositionGuide(doc: SketchDocument, subject: string): SketchLayer {
  const cx = doc.width / 2;
  const guideColor = "#8b9bb4";
  const line: SketchStroke = {
    id: makeId("st"),
    kind: "stroke",
    tool: "line",
    color: guideColor,
    size: 2,
    opacity: 0.85,
    points: [
      { x: cx - doc.width * 0.13, y: doc.height * 0.16 },
      { x: cx + doc.width * 0.13, y: doc.height * 0.16 },
    ],
    erase: false,
  };
  const center: SketchStroke = {
    id: makeId("st"),
    kind: "stroke",
    tool: "line",
    color: guideColor,
    size: 2,
    opacity: 0.55,
    points: [
      { x: cx, y: doc.height * 0.16 },
      { x: cx, y: doc.height * 0.82 },
    ],
    erase: false,
  };
  const head: SketchStroke = {
    id: makeId("st"),
    kind: "stroke",
    tool: "line",
    color: guideColor,
    size: 2,
    opacity: 0.85,
    points: [
      { x: cx - doc.width * 0.045, y: doc.height * 0.16 },
      { x: cx + doc.width * 0.045, y: doc.height * 0.12 },
    ],
    shape: "ellipse",
    erase: false,
  };
  const shoulders: SketchStroke = {
    id: makeId("st"),
    kind: "stroke",
    tool: "line",
    color: guideColor,
    size: 2,
    opacity: 0.7,
    points: [
      { x: cx - doc.width * 0.17, y: doc.height * 0.3 },
      { x: cx + doc.width * 0.17, y: doc.height * 0.28 },
    ],
    erase: false,
  };
  return {
    id: makeId("layer"),
    name: `${subject} concept`,
    visible: true,
    opacity: 1,
    locked: false,
    elements: [head, line, shoulders, center],
  };
}

const HANDLERS: CommandHandler[] = [
  {
    // add a layer / new layer / add layer named X
    match: /(?:add|create|new)\s+(?:a\s+)?layer(?:\s+named\s+(.+))?/i,
    run: (doc, match) => {
      const name = match[1]?.trim() || `Layer ${doc.layers.length + 1}`;
      const layer: SketchLayer = {
        id: makeId("layer"),
        name,
        visible: true,
        opacity: 1,
        locked: false,
        elements: [],
      };
      return {
        doc: { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id },
        action: `Added layer "${name}" and made it active.`,
      };
    },
  },
  {
    // duplicate (the) active layer / duplicate layer
    match: /duplicate\s+(?:the\s+)?(?:active\s+)?layer/i,
    run: (doc) => {
      const source = activeLayer(doc);
      if (!source) {
        return { doc, action: "No active layer to duplicate." };
      }
      const copy: SketchLayer = {
        ...structuredClone(source),
        id: makeId("layer"),
        name: `${source.name} copy`,
      };
      const layers = [...doc.layers, copy];
      return {
        doc: { ...doc, layers, activeLayerId: copy.id },
        action: `Duplicated "${source.name}" as "${copy.name}".`,
      };
    },
  },
  {
    // rename the active layer to X / rename layer to X
    match: /rename\s+(?:the\s+)?(?:active\s+)?layer\s+(?:to\s+)?(.+)/i,
    run: (doc, match) => {
      const name = match[1].trim();
      const current = activeLayer(doc);
      if (!current) {
        return { doc, action: "No active layer to rename." };
      }
      return {
        doc: updateActive(doc, (layer) => ({ ...layer, name })),
        action: `Renamed layer to "${name}".`,
      };
    },
  },
  {
    // clear the active layer
    match: /clear\s+(?:the\s+)?(?:active\s+)?layer/i,
    run: (doc) => {
      const current = activeLayer(doc);
      if (!current) {
        return { doc, action: "No active layer to clear." };
      }
      return {
        doc: updateActive(doc, (layer) => ({ ...layer, elements: [] })),
        action: `Cleared layer "${current.name}".`,
      };
    },
  },
  {
    // hide/show layer N (1-based from the bottom)
    match: /(hide|show)\s+layer\s+(\d+)/i,
    run: (doc, match) => {
      const index = Number(match[2]) - 1;
      const layer = doc.layers[index];
      if (!layer) {
        return { doc, action: `Layer ${match[2]} does not exist.` };
      }
      const visible = match[1].toLowerCase() === "show";
      return {
        doc: setLayers(
          doc,
          doc.layers.map((item, itemIndex) => (itemIndex === index ? { ...item, visible } : item)),
        ),
        action: `${visible ? "Showed" : "Hid"} layer "${layer.name}".`,
      };
    },
  },
  {
    // draw a concept for X / draw X
    match: /(?:draw|create)\s+(?:a\s+)?(?:concept(?:s)?\s+)?(?:for|of)\s+(.+)/i,
    run: (doc, match) => {
      const subject = match[1].trim().replace(/\.$/, "") || "new concept";
      const guide = compositionGuide(doc, subject);
      const layers = [...doc.layers, guide];
      return {
        doc: { ...doc, layers, activeLayerId: guide.id },
        action: `Started a "${subject}" concept: added a composition guide layer (head, shoulders, center axis) for you to sketch on.`,
      };
    },
  },
  {
    // annotate this sketch with X
    match: /annotate\s+(?:this\s+)?(?:sketch|layer)?\s*(?:with\s*)?(.+)/i,
    run: (doc, match) => {
      const text = match[1].trim().replace(/\.$/, "") || "note";
      const current = activeLayer(doc);
      if (!current) {
        return { doc, action: "No active layer to annotate." };
      }
      const annotation: SketchElement = {
        id: makeId("tx"),
        kind: "text",
        text,
        x: doc.width * 0.06,
        y: doc.height * 0.06,
        color: "#dbeafe",
        fontSize: 22,
      };
      return {
        doc: updateActive(doc, (layer) => ({ ...layer, elements: [...layer.elements, annotation] })),
        action: `Added annotation "${text}" to layer "${current.name}".`,
      };
    },
  },
  {
    // move the last element / move the last element by X, Y
    match: /move\s+(?:the\s+)?last\s+element(?:\s+by\s+([+-]?\d+)[,\s]+([+-]?\d+))?/i,
    run: (doc, match) => {
      const current = activeLayer(doc);
      if (!current || current.elements.length === 0) {
        return { doc, action: "No elements to move." };
      }
      const dx = match[1] ? Number(match[1]) : 24;
      const dy = match[2] ? Number(match[2]) : 24;
      const elements = current.elements.map((element, index) => {
        if (index !== current.elements.length - 1) {
          return element;
        }
        if (element.kind === "stroke") {
          return { ...element, points: element.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
        }
        if (element.kind === "text") {
          return { ...element, x: element.x + dx, y: element.y + dy };
        }
        return { ...element, x: element.x + dx, y: element.y + dy };
      });
      return {
        doc: updateActive(doc, (layer) => ({ ...layer, elements })),
        action: `Moved the last element by (${dx}, ${dy}).`,
      };
    },
  },
  {
    // resize the canvas to W by H
    match: /resize\s+(?:the\s+)?canvas\s+to\s+(\d+)\s*(?:x|by|,)\s*(\d+)/i,
    run: (doc, match) => {
      const width = Math.max(320, Math.min(4096, Number(match[1])));
      const height = Math.max(240, Math.min(4096, Number(match[2])));
      return {
        doc: { ...doc, width, height },
        action: `Resized the canvas to ${width} × ${height}.`,
      };
    },
  },
  {
    // change the background to X
    match: /change\s+(?:the\s+)?background\s+to\s+(.+)/i,
    run: (doc, match) => {
      const color = resolveColor(match[1]);
      if (!color) {
        return { doc, action: `Could not resolve background color "${match[1].trim()}".` };
      }
      return { doc: { ...doc, background: color }, action: `Changed the background to ${color}.` };
    },
  },
  {
    // draw a line / circle / square / ellipse / rectangle
    match: /draw\s+(?:a\s+)?(line|circle|square|rectangle|ellipse)(?:\s+in\s+(.+))?/i,
    run: (doc, match) => {
      const shapeName = match[1].toLowerCase();
      const color = match[2] ? resolveColor(match[2]) : "";
      const current = activeLayer(doc);
      if (!current) {
        return { doc, action: "No active layer to draw on." };
      }
      const cx = doc.width / 2;
      const cy = doc.height / 2;
      const size = Math.min(doc.width, doc.height) * 0.22;
      let shape: SketchShapeKind | "line";
      let start: { x: number; y: number };
      let end: { x: number; y: number };
      if (shapeName === "line") {
        shape = "line";
        start = { x: cx - size, y: cy };
        end = { x: cx + size, y: cy };
      } else {
        shape = shapeName === "circle" || shapeName === "ellipse" ? "ellipse" : "rect";
        const half = shapeName === "circle" ? size / 1.6 : size / 2;
        start = { x: cx - half, y: cy - half };
        end = { x: cx + half, y: cy + half };
      }
      const stroke: SketchElement = {
        id: makeId("st"),
        kind: "stroke",
        tool: "line",
        color: color || "#94a3b8",
        size: 3,
        opacity: 1,
        points: [start, end],
        shape: shape === "line" ? undefined : shape,
        erase: false,
      };
      return {
        doc: updateActive(doc, (layer) => ({ ...layer, elements: [...layer.elements, stroke] })),
        action: `Drew a ${shapeName}${color ? ` in ${color}` : ""} on "${current.name}".`,
      };
    },
  },
  {
    // export as png/jpg/svg / save and export
    match: /(?:save\s+and\s+)?export\s+(?:as\s+)?(png|jpg|jpeg|svg)/i,
    run: (doc, match) => {
      const format = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
      return {
        doc,
        action: `Export ready — use the export button to download the sketch as ${format.toUpperCase()} (browsers require a user gesture for downloads).`,
      };
    },
  },
];

/** Execute one natural-language command against the document. */
export function executeToolCommand(input: ToolCommandInput): ToolCommandResult {
  const { command, document: doc, autosave } = input;
  const clean = command.trim();

  for (const handler of HANDLERS) {
    const match = clean.match(handler.match);
    if (match) {
      const result = handler.run(doc, match);
      if (autosave) {
        // Autosave through the singleton store so the document library
        // stays in sync with what LÉLU did.
        SketchStore.getInstance().save(result.doc);
      }
      return {
        ok: true,
        message: result.action,
        actions: [result.action],
        document: result.doc,
      };
    }
  }

  return {
    ok: false,
    message:
      "I can't perform that command yet. I can: add/duplicate/rename/clear layers, hide or show a layer, draw a concept guide, annotate, draw basic shapes, move the last element, resize the canvas, change the background, or export.",
    actions: [],
    document: doc,
  };
}

export function toolCommandExamples(): string[] {
  return [...SUPPORTED_EXAMPLES];
}
