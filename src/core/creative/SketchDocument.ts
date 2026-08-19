/**
 * ==========================================================
 * LÉLU
 * SKETCH DOCUMENT — offline canvas document model
 *
 * A real, self-contained vector sketch document: layers of
 * strokes, shapes, text and imported images. Zero network —
 * the whole thing persists through the shared KvStore and
 * renders to PNG/JPG/SVG through plain Canvas/SVG APIs.
 *
 * The UI renders this model; agents and LÉLU drive it through
 * CreativeToolInterface — cognition is never coupled to the
 * canvas implementation.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type SketchStrokeTool = "pencil" | "pen" | "brush" | "eraser" | "line";
export type SketchShapeKind = "rect" | "ellipse";

export interface SketchPoint {
  x: number;
  y: number;
}

export interface SketchStroke {
  id: string;
  kind: "stroke";
  tool: SketchStrokeTool;
  color: string;
  size: number;
  opacity: number;
  /** Freehand tools: one point per sample. Shape tools: [start, end]. */
  points: SketchPoint[];
  shape?: SketchShapeKind;
  /** True when the stroke was drawn with the eraser tool. */
  erase: boolean;
  /** Filled shape (fill tool / bucket). */
  fill?: boolean;
}

export interface SketchTextElement {
  id: string;
  kind: "text";
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

export interface SketchImageElement {
  id: string;
  kind: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
}

export type SketchElement = SketchStroke | SketchTextElement | SketchImageElement;

export interface SketchLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  elements: SketchElement[];
}

export interface SketchDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: SketchLayer[];
  activeLayerId: string;
  createdAt: number;
  updatedAt: number;
}

export type SketchExportFormat = "png" | "jpg" | "svg";

type Listener = (documents: SketchDocument[]) => void;

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function emptyDocument(name: string, width = 1200, height = 900): SketchDocument {
  const now = Date.now();
  const layer: SketchLayer = {
    id: makeId("layer"),
    name: "Layer 1",
    visible: true,
    opacity: 1,
    locked: false,
    elements: [],
  };
  return {
    id: makeId("sketch"),
    name,
    width,
    height,
    background: "#0b1020",
    layers: [layer],
    activeLayerId: layer.id,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Renders the document to a canvas using the real element model.
 * Returns null when the browser cannot create the canvas.
 */
export function renderDocumentToCanvas(doc: SketchDocument): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);

  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) {
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    for (const element of layer.elements) {
      drawElement(ctx, element);
    }
    ctx.restore();
  }

  return canvas;
}

function drawElement(ctx: CanvasRenderingContext2D, element: SketchElement): void {
  if (element.kind === "stroke") {
    if (element.erase) {
      // Eraser strokes punch through using destination-out so they
      // remove content below on this layer.
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
    }
    ctx.strokeStyle = element.color;
    ctx.lineWidth = element.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha *= element.opacity;

    if (element.shape === "rect") {
      const [start, end] = element.points;
      if (element.fill) {
        ctx.fillStyle = element.color;
        ctx.fillRect(
          Math.min(start.x, end.x),
          Math.min(start.y, end.y),
          Math.abs(end.x - start.x),
          Math.abs(end.y - start.y),
        );
      } else {
        ctx.strokeRect(
          Math.min(start.x, end.x),
          Math.min(start.y, end.y),
          Math.abs(end.x - start.x),
          Math.abs(end.y - start.y),
        );
      }
    } else if (element.shape === "ellipse") {
      const [start, end] = element.points;
      ctx.beginPath();
      ctx.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        Math.abs(end.x - start.x) / 2,
        Math.abs(end.y - start.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      if (element.fill) {
        ctx.fillStyle = element.color;
        ctx.fill();
      } else {
        ctx.stroke();
      }
    } else {
      if (element.points.length === 1) {
        ctx.beginPath();
        ctx.arc(element.points[0].x, element.points[0].y, element.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = element.color;
        ctx.fill();
      } else if (element.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(element.points[0].x, element.points[0].y);
        for (const point of element.points.slice(1)) {
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
    }
    if (element.erase) {
      ctx.restore();
    }
    return;
  }

  if (element.kind === "text") {
    ctx.save();
    ctx.fillStyle = element.color;
    ctx.font = `${element.fontSize}px "Inter", system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(element.text, element.x, element.y);
    ctx.restore();
    return;
  }

  // image — decoded through a module cache so redraws never flicker.
  let image = imageCache.get(element.dataUrl);
  if (!image) {
    image = new Image();
    imageCache.set(element.dataUrl, image);
    image.src = element.dataUrl;
  }
  if (image.complete) {
    ctx.drawImage(image, element.x, element.y, element.width, element.height);
  }
}

const imageCache = new Map<string, HTMLImageElement>();

/**
 * Preload every embedded image in a document so the next render pass
 * draws them synchronously. Returns a promise resolving when all are
 * decoded (or failed).
 */
export function preloadSketchImages(doc: SketchDocument): Promise<void> {
  const urls = new Set<string>();
  for (const layer of doc.layers) {
    for (const element of layer.elements) {
      if (element.kind === "image") {
        urls.add(element.dataUrl);
      }
    }
  }
  const pending: Promise<void>[] = [];
  for (const url of urls) {
    const cached = imageCache.get(url);
    if (cached?.complete) {
      continue;
    }
    pending.push(
      new Promise((resolve) => {
        const image = new Image();
        imageCache.set(url, image);
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = url;
      }),
    );
  }
  return Promise.all(pending).then(() => undefined);
}

/** Export the document to a data URL (png/jpg) or an SVG string. */
export function exportDocument(doc: SketchDocument, format: SketchExportFormat): string {
  if (format === "svg") {
    return documentToSvg(doc);
  }
  const canvas = renderDocumentToCanvas(doc);
  if (!canvas) {
    return "";
  }
  return format === "jpg" ? canvas.toDataURL("image/jpeg", 0.92) : canvas.toDataURL("image/png");
}

function documentToSvg(doc: SketchDocument): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`,
    `<rect width="${doc.width}" height="${doc.height}" fill="${doc.background}"/>`,
  ];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) {
      continue;
    }
    parts.push(`<g opacity="${layer.opacity}">`);
    for (const element of layer.elements) {
      if (element.kind === "stroke") {
        if (element.shape === "rect") {
          const [s, e] = element.points;
          parts.push(
            `<rect x="${Math.min(s.x, e.x)}" y="${Math.min(s.y, e.y)}" width="${Math.abs(e.x - s.x)}" height="${Math.abs(e.y - s.y)}" fill="${element.fill ? element.color : "none"}" stroke="${element.fill ? "none" : element.color}" stroke-width="${element.size}" opacity="${element.opacity}"/>`,
          );
        } else if (element.shape === "ellipse") {
          const [s, e] = element.points;
          parts.push(
            `<ellipse cx="${(s.x + e.x) / 2}" cy="${(s.y + e.y) / 2}" rx="${Math.abs(e.x - s.x) / 2}" ry="${Math.abs(e.y - s.y) / 2}" fill="${element.fill ? element.color : "none"}" stroke="${element.fill ? "none" : element.color}" stroke-width="${element.size}" opacity="${element.opacity}"/>`,
          );
        } else {
          const points = element.points.map((p) => `${p.x},${p.y}`).join(" ");
          parts.push(
            `<polyline points="${points}" fill="none" stroke="${element.color}" stroke-width="${element.size}" stroke-linecap="round" stroke-linejoin="round" opacity="${element.opacity}"/>`,
          );
        }
      } else if (element.kind === "text") {
        parts.push(
          `<text x="${element.x}" y="${element.y + element.fontSize}" fill="${element.color}" font-size="${element.fontSize}" font-family="Inter, system-ui, sans-serif">${escapeXml(element.text)}</text>`,
        );
      } else {
        parts.push(
          `<image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${element.dataUrl}" preserveAspectRatio="xMidYMid slice"/>`,
        );
      }
    }
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ==========================================================
 * SKETCH STORE — persistent document library
 * ========================================================== */

export default class SketchStore {
  private static instance: SketchStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly listeners = new Set<Listener>();

  private constructor() {}

  public static getInstance(): SketchStore {
    if (!SketchStore.instance) {
      SketchStore.instance = new SketchStore();
    }
    return SketchStore.instance;
  }

  private static readonly KEY = "sketches.v1";

  public list(): SketchDocument[] {
    const docs = this.kv.get<SketchDocument[]>(SketchStore.KEY) ?? [];
    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.list());
      } catch (error) {
        console.error("[Lélu SketchStore] listener threw (contained)", error);
      }
    }
  }

  public get(id: string): SketchDocument | undefined {
    return this.list().find((doc) => doc.id === id);
  }

  public save(doc: SketchDocument): void {
    const updated: SketchDocument = { ...doc, updatedAt: Date.now() };
    const existing = this.list().filter((item) => item.id !== doc.id);
    this.kv.set(SketchStore.KEY, [updated, ...existing]);
    this.notify();
  }

  public create(name: string, width?: number, height?: number): SketchDocument {
    const doc = emptyDocument(name, width, height);
    this.kv.set(SketchStore.KEY, [doc, ...this.list()]);
    this.notify();
    return doc;
  }

  public remove(id: string): void {
    this.kv.set(SketchStore.KEY, this.list().filter((doc) => doc.id !== id));
    this.notify();
  }
}
