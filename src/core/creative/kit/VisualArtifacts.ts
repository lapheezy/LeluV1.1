/**
 * ==========================================================
 * LÉLU — VISUAL ARTIFACTS (Creation Studio kind "visual")
 *
 * One place that knows, for each medium, how a program is
 * checked, previewed, described and exported. The Studio store
 * keeps the program (small, revisable); files are produced here
 * on demand and READ BACK before they are reported as written:
 *
 *   generative  svg · png · json
 *   diagram     mmd · svg · png
 *   chart       html · svg · png · csv · json
 *   scene3d     glb · gltf · json
 *   video       webm · json
 *   (drawing)   excalidraw · svg · png   — the existing Excalidraw kind
 *
 * Formats that need a browser (png, webm, diagram svg, drawing
 * svg/png) say so instead of pretending when run elsewhere.
 * ==========================================================
 */

import type { DrawingSpec, VisualMedium, VisualSpec } from "../../studio/StudioTypes";
import { normalizeGenerative, PALETTES, renderGenerative, type GenerativeProgram } from "./GenerativeArt";
import { normalizeDiagram, renderDiagramSvg, type DiagramProgram } from "./Diagram";
import { normalizeViz, vizHtml, vizSvg, type VizProgram } from "./InteractiveViz";
import { exportScene, inspectGlb, normalizeScene, type Scene3DProgram } from "./Scene3D";
import { filmDuration, inspectWebm, normalizeVideo, renderFilm, type VideoProgram } from "./VideoComposer";

export const VISUAL_MEDIA: VisualMedium[] = ["generative", "diagram", "chart", "scene3d", "video"];
export type VisualFormat = "svg" | "png" | "json" | "mmd" | "html" | "csv" | "glb" | "gltf" | "webm" | "excalidraw";

export const VISUAL_FORMATS: Record<VisualMedium | "drawing", VisualFormat[]> = {
  generative: ["svg", "png", "json"],
  diagram: ["mmd", "svg", "png"],
  chart: ["html", "svg", "png", "csv", "json"],
  scene3d: ["glb", "gltf", "json"],
  video: ["webm", "json"],
  drawing: ["excalidraw", "svg", "png"],
};

export const VISUAL_MIME: Record<VisualFormat, string> = {
  svg: "image/svg+xml", png: "image/png", json: "application/json", mmd: "text/vnd.mermaid", html: "text/html", csv: "text/csv",
  glb: "model/gltf-binary", gltf: "model/gltf+json", webm: "video/webm", excalidraw: "application/vnd.excalidraw+json",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function normalizeProgram(medium: VisualMedium, program: unknown): Record<string, unknown> | string {
  const r = medium === "generative" ? normalizeGenerative(program)
    : medium === "diagram" ? normalizeDiagram(program)
      : medium === "chart" ? normalizeViz(program)
        : medium === "scene3d" ? normalizeScene(program)
          : normalizeVideo(program);
  return typeof r === "string" ? r : (r as unknown as Record<string, unknown>);
}

export function normalizeVisualSpec(input: Record<string, unknown>, title: string, author?: string): { ok: true; spec: VisualSpec } | { ok: false; reason: string } {
  const medium = String(input.medium ?? "") as VisualMedium;
  if (!VISUAL_MEDIA.includes(medium)) return { ok: false, reason: `a visual needs medium: ${VISUAL_MEDIA.join(", ")}` };
  const program = normalizeProgram(medium, isObj(input.program) ? input.program : input.program ?? {});
  if (typeof program === "string") return { ok: false, reason: `${medium}: ${program}` };
  const sources = Array.isArray(input.sources) ? input.sources.filter(isObj).map((s, i) => ({ id: String(s.id ?? `S${i + 1}`), title: String(s.title ?? ""), url: typeof s.url === "string" ? s.url : undefined, accessed: typeof s.accessed === "string" ? s.accessed : undefined })).filter((s) => s.title) : undefined;
  const links = Array.isArray(input.links) ? input.links.filter((l): l is string => typeof l === "string").slice(0, 20) : undefined;
  return { ok: true, spec: { kind: "visual", title, author, medium, program, notes: typeof input.notes === "string" ? input.notes.slice(0, 2000) : undefined, sources: sources?.length ? sources : undefined, links: links?.length ? links : undefined } };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A static, script-free preview (Studio iframes are sandboxed with no scripts). */
export function visualPreviewHtml(spec: VisualSpec): string {
  const shell = (body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>body{margin:0;font:14px system-ui;color:#2a2440;background:#fff}svg{display:block;width:100%;height:auto}.pad{padding:16px}pre{white-space:pre-wrap;background:#f6f3ff;padding:12px;border-radius:8px}</style></head><body>${body}</body></html>`;
  const p = spec.program as unknown;
  if (spec.medium === "generative") {
    // The artwork fills the frame on its own background (no white band below a wide piece on a tall phone window).
    const g = p as GenerativeProgram;
    const bg = g.background ?? PALETTES[g.palette]?.background ?? "#0b0816";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>html,body{margin:0;height:100%;background:${bg}}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%;width:auto;height:auto}</style></head><body>${renderGenerative(g).svg}</body></html>`;
  }
  if (spec.medium === "chart") return shell(`<div class="pad"><h1 style="font-size:17px">${esc(spec.title)}</h1>${vizSvg(p as VizProgram, { background: "#ffffff" })}</div>`);
  if (spec.medium === "diagram") return shell(`<div class="pad"><h1 style="font-size:17px">${esc(spec.title)}</h1><pre>${esc((p as DiagramProgram).source)}</pre></div>`);
  return shell(`<div class="pad"><h1 style="font-size:17px">${esc(spec.title)}</h1><p>${esc(visualGist(spec))}</p></div>`);
}

export function visualGist(spec: VisualSpec): string {
  const p = spec.program as unknown;
  switch (spec.medium) {
    case "generative": { const g = p as GenerativeProgram; return `${g.style} artwork · seed ${g.seed} · ${g.width}×${g.height} · ${g.palette}`; }
    case "diagram": { const d = p as DiagramProgram; return `${d.diagramType} diagram · ${d.source.split("\n").length} lines`; }
    case "chart": { const c = p as VizProgram; return `${c.kind} chart · ${c.series.length} series · ${(c.kind === "scatter" ? c.x?.length : c.labels.length) ?? 0} points${c.sources.length ? ` · ${c.sources.length} source${c.sources.length > 1 ? "s" : ""}` : ""}`; }
    case "scene3d": { const s = p as Scene3DProgram; return `3D scene${s.preset ? ` (${s.preset})` : ""} · ${s.objects.length} object groups · ${s.lights.length} lights · ${s.objects.filter((o) => o.animate).length} animated`; }
    case "video": { const v = p as VideoProgram; return `film · ${filmDuration(v).toFixed(1)} s · ${v.scenes.length} scenes · ${v.width}×${v.height} @ ${v.fps} fps · soundtrack ${v.soundtrack.mood}`; }
  }
}

/** Text a model (or a person reading the transcript) can reason over. */
export function describeVisual(spec: VisualSpec, max = 4000): string {
  const p = spec.program as unknown;
  const lines = [`visual (${spec.medium}) “${spec.title}” — ${visualGist(spec)}`];
  if (spec.medium === "diagram") lines.push((p as DiagramProgram).source);
  if (spec.medium === "chart") { const c = p as VizProgram; lines.push(`labels: ${c.labels.slice(0, 40).join(", ")}`); for (const s of c.series) lines.push(`${s.name}: ${s.values.slice(0, 40).join(", ")}`); }
  if (spec.medium === "scene3d") for (const o of (p as Scene3DProgram).objects) lines.push(`object [${o.id}] ${o.shape} at ${o.position.join(",")} ${o.color}${o.repeat ? ` ×${o.repeat.count} ${o.repeat.pattern}` : ""}${o.animate ? ` animate ${o.animate.type}` : ""}`);
  if (spec.medium === "video") (p as VideoProgram).scenes.forEach((s, i) => lines.push(`scene ${i + 1}: ${s.duration}s ${s.visual.type}${s.title ? ` “${s.title}”` : ""} ${s.motion}`));
  if (spec.sources?.length) lines.push(`sources: ${spec.sources.map((s) => `${s.title}${s.url ? ` ${s.url}` : ""}`).join("; ")}`);
  const text = lines.join("\n");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/* ------------------------------------------------------------------ *
 * Export with read-back
 * ------------------------------------------------------------------ */

export interface VisualFile {
  ok: boolean;
  format: VisualFormat;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  /** Execution facts (render path, timings, sizes). */
  facts: Record<string, string | number | boolean>;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const inBrowser = () => typeof document !== "undefined";

export function visualFileName(title: string, format: VisualFormat): string {
  const base = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "lelu-visual";
  return `${base}.${format}`;
}

/** Rasterise an SVG through Canvas. Browser only. */
export async function svgToPng(svg: string, scale = 1): Promise<Uint8Array> {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg) ?? /width="([\d.]+)(?:px)?"[^>]*height="([\d.]+)/.exec(svg);
  const w = Math.round((m ? Number(m[1]) : 1024) * scale), h = Math.round((m ? Number(m[2]) : 768) * scale);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("the canvas produced no PNG");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pngCheck(bytes: Uint8Array): { name: string; ok: boolean; detail?: string } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
  const w = sig ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(16) : 0, h = sig ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(20) : 0;
  return { name: "PNG signature and size", ok: sig && w > 0 && h > 0, detail: sig ? `${w}×${h}` : "not a PNG" };
}
function svgCheck(text: string, needle?: string): { name: string; ok: boolean; detail?: string } {
  const ok = /^<svg[\s>]/.test(text.trim()) && text.trim().endsWith("</svg>") && (!needle || text.includes(needle));
  return { name: "SVG document", ok, detail: ok ? `${(text.length / 1024).toFixed(1)} KB` : "not a complete SVG" };
}

async function diagramSvg(p: DiagramProgram): Promise<string> {
  if (!inBrowser()) throw new Error("diagram SVG is drawn by Mermaid in the browser; here only the .mmd source can be written");
  const r = await renderDiagramSvg(p);
  if (!r.ok) throw new Error(`Mermaid could not draw it: ${r.reason}`);
  return r.svg;
}

export async function exportVisual(spec: VisualSpec, format: VisualFormat): Promise<VisualFile> {
  const allowed = VISUAL_FORMATS[spec.medium];
  if (!allowed.includes(format)) throw new Error(`a ${spec.medium} visual is written as ${allowed.join(", ")}, not ${format}`);
  const filename = visualFileName(spec.title, format);
  const out = (bytes: Uint8Array, checks: VisualFile["checks"], facts: VisualFile["facts"] = {}): VisualFile => ({ ok: checks.every((c) => c.ok), format, filename, mime: VISUAL_MIME[format], bytes, checks: [{ name: "file is not empty", ok: bytes.byteLength > 0, detail: `${bytes.byteLength} bytes` }, ...checks], facts });
  const p = spec.program as unknown;
  const started = Date.now();

  if (format === "json") {
    const bytes = enc(JSON.stringify({ lelu: "visual", version: 1, title: spec.title, medium: spec.medium, program: spec.program, sources: spec.sources ?? [] }, null, 2));
    const back = JSON.parse(dec(bytes)) as { medium: string; program: unknown };
    const again = normalizeProgram(spec.medium, back.program);
    return out(bytes, [{ name: "re-opened program is valid", ok: typeof again !== "string", detail: typeof again === "string" ? again : spec.medium }]);
  }
  if (spec.medium === "generative") {
    const svg = renderGenerative(p as GenerativeProgram).svg;
    if (format === "svg") return out(enc(svg), [svgCheck(dec(enc(svg)), "data-lelu-generative")], { renderMs: Date.now() - started });
    if (!inBrowser()) throw new Error("PNG is rasterised with Canvas in the browser; SVG and JSON can be written here");
    const png = await svgToPng(svg);
    return out(png, [pngCheck(png)], { renderMs: Date.now() - started });
  }
  if (spec.medium === "diagram") {
    const d = p as DiagramProgram;
    if (format === "mmd") { const bytes = enc(d.source); return out(bytes, [{ name: "Mermaid source re-reads as the same diagram type", ok: typeof normalizeDiagram(dec(bytes)) !== "string", detail: d.diagramType }]); }
    const svg = await diagramSvg(d);
    if (format === "svg") return out(enc(svg), [svgCheck(svg)], { renderMs: Date.now() - started });
    const png = await svgToPng(svg, 2);
    return out(png, [pngCheck(png)], { renderMs: Date.now() - started });
  }
  if (spec.medium === "chart") {
    const c = p as VizProgram;
    if (format === "html") {
      const html = vizHtml(c);
      const marks = (html.match(/class="mark"/g) ?? []).length;
      const expected = c.series.reduce((a, s) => a + s.values.length, 0);
      return out(enc(html), [{ name: "every value is an interactive mark", ok: marks === expected, detail: `${marks}/${expected}` }, { name: "sources are cited", ok: c.sources.every((s) => html.includes(esc(s.title))), detail: `${c.sources.length}` }]);
    }
    if (format === "csv") {
      const keys = c.kind === "scatter" ? (c.x ?? []).map(String) : c.labels;
      const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const rows = [[c.kind === "scatter" ? c.xLabel ?? "x" : "label", ...c.series.map((s) => s.name)].map(q).join(","), ...keys.map((k, i) => [q(k), ...c.series.map((s) => (s.values[i] ?? "").toString())].join(","))];
      const bytes = enc(rows.join("\n"));
      return out(bytes, [{ name: "row count", ok: dec(bytes).split("\n").length === keys.length + 1, detail: `${keys.length} rows` }]);
    }
    const svg = vizSvg(c, { background: "#ffffff" });
    if (format === "svg") return out(enc(svg), [svgCheck(svg)]);
    if (!inBrowser()) throw new Error("PNG is rasterised with Canvas in the browser; HTML, SVG, CSV and JSON can be written here");
    const png = await svgToPng(svg, 2);
    return out(png, [pngCheck(png)]);
  }
  if (spec.medium === "scene3d") {
    const { bytes, stats } = await exportScene(p as Scene3DProgram, format === "gltf" ? "gltf" : "glb");
    if (format === "glb") {
      const r = inspectGlb(bytes);
      return out(bytes, [{ name: "GLB header, version and length", ok: r.ok && r.version === 2, detail: r.reason ?? `glTF ${r.version}` }, { name: "meshes and nodes present", ok: (r.meshes ?? 0) > 0 && (r.nodes ?? 0) > 0, detail: `${r.nodes} nodes, ${r.meshes} meshes, ${r.animations} animations` }], { ...stats, exportMs: Date.now() - started });
    }
    const json = JSON.parse(dec(bytes)) as { asset?: { version?: string }; meshes?: unknown[] };
    return out(bytes, [{ name: "glTF 2.0 JSON with meshes", ok: json.asset?.version === "2.0" && (json.meshes?.length ?? 0) > 0, detail: `${json.meshes?.length ?? 0} meshes (buffers embedded)` }], { ...stats, exportMs: Date.now() - started });
  }
  // video
  if (!inBrowser()) throw new Error("films are encoded on the device with WebCodecs or MediaRecorder; open LÉLU in a browser to render the WebM (the JSON program can be written here)");
  const film = await renderFilm(p as VideoProgram);
  const r = inspectWebm(film.bytes);
  return out(film.bytes, [{ name: "WebM container", ok: r.ok, detail: r.reason ?? r.docType }, { name: "video track", ok: r.video === true }, { name: "audio track (when a soundtrack was asked for)", ok: (p as VideoProgram).soundtrack.mood === "none" || !film.audio || r.audio === true, detail: film.audio ? "opus" : "none" }],
    { path: film.path, codec: film.codec, size: `${film.width}x${film.height}`, sizing: film.sizing, seconds: Number(film.seconds.toFixed(2)), frames: film.frames, encodeMs: film.encodeMs, realtimeFactor: Number(((film.seconds * 1000) / Math.max(1, film.encodeMs)).toFixed(2)) });
}

/** The existing Excalidraw drawings, exported without a model: .excalidraw is the editable file. */
export async function exportDrawing(spec: DrawingSpec, format: "excalidraw" | "svg" | "png"): Promise<VisualFile> {
  const filename = visualFileName(spec.title, format);
  const out = (bytes: Uint8Array, checks: VisualFile["checks"]): VisualFile => ({ ok: checks.every((c) => c.ok), format, filename, mime: VISUAL_MIME[format], bytes, checks, facts: { elements: spec.scene.elements.length } });
  // Drawings made by a tool are Excalidraw "skeleton" elements (no seed);
  // the editor converts them on open. A file must hold full elements, so
  // convert here too when Excalidraw can load (the browser).
  const skeleton = (spec.scene.elements as Array<Record<string, unknown>>).some((e) => typeof e.seed !== "number");
  let elements: unknown[] = spec.scene.elements;
  if (skeleton && inBrowser()) elements = (await import("@excalidraw/excalidraw")).convertToExcalidrawElements(spec.scene.elements as never) as unknown[];
  if (format === "excalidraw") {
    const file = { type: "excalidraw", version: 2, source: "https://lelu.app", elements, appState: { viewBackgroundColor: "#ffffff", ...(spec.scene.appState ?? {}) }, files: spec.scene.files ?? {} };
    const bytes = enc(JSON.stringify(file));
    const back = JSON.parse(dec(bytes)) as { type: string; elements: unknown[] };
    return out(bytes, [{ name: "re-opens as an Excalidraw scene", ok: back.type === "excalidraw" && back.elements.length >= spec.scene.elements.length, detail: `${back.elements.length} editable elements${skeleton && !inBrowser() ? " (skeleton form; Excalidraw completes them on open)" : ""}` }]);
  }
  if (!inBrowser()) throw new Error("drawing SVG/PNG are produced by Excalidraw in the browser; the editable .excalidraw file can be written here");
  const ex = await import("@excalidraw/excalidraw");
  const appState = { exportBackground: true, viewBackgroundColor: "#ffffff", ...(spec.scene.appState ?? {}) };
  const full = elements as Parameters<typeof ex.exportToSvg>[0]["elements"];
  if (format === "svg") {
    const node = await ex.exportToSvg({ elements: full, appState, files: (spec.scene.files ?? {}) as never });
    const svg = node.outerHTML;
    return out(enc(svg), [svgCheck(svg)]);
  }
  const blob = await ex.exportToBlob({ elements: full, appState, files: (spec.scene.files ?? {}) as never, mimeType: "image/png" });
  const png = new Uint8Array(await blob.arrayBuffer());
  return out(png, [pngCheck(png)]);
}

/** Save bytes as a file: File System Access where the browser has it, a download link otherwise. */
export async function saveFile(bytes: Uint8Array, filename: string, mime: string): Promise<"saved" | "downloaded" | "cancelled"> {
  const w = globalThis as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: filename });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
