/**
 * LÉLU — BUILD ENGINE: a woven panel
 *
 * Warp and weft threads interlaced by a real weave rule: plain over-under
 * every thread, twill stepped one thread per row, satin floating over four.
 * The thread count, the picks and the cover factor follow from the density
 * and the thread diameter, so the sample is a calculation as well as a fabric.
 */

import { part, sceneOf, layersOf, num, text, validateParams, type BuildOutcome, type BuildPart, type ParamSpec } from "./BuildTypes";

const LAYERS = [
  { id: "warp", label: "Warp", color: "#b98cff", note: "The lengthwise threads, held under tension on the loom." },
  { id: "weft", label: "Weft", color: "#67e8f9", note: "The crosswise threads, passed over and under the warp." },
  { id: "selvedge", label: "Selvedge", color: "#9fb4c8", note: "The finished edges where the weft turns back." },
];

const WEAVES = ["plain", "twill", "satin"] as const;
type Weave = (typeof WEAVES)[number];

/** Does the warp show at this intersection? This is the whole weave. */
export function warpOnTop(weave: Weave, x: number, y: number): boolean {
  if (weave === "plain") return (x + y) % 2 === 0;
  if (weave === "twill") return ((x + y) % 4) < 2;
  // satin: one thread in five, stepping, so the floats are long
  return (x * 2 + y * 3) % 5 === 0;
}

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "weave", label: "Weave", kind: "choice", value: has("weave") ? String(input?.weave) : "plain", choices: [...WEAVES], affects: "How the threads interlace, and therefore the drape and the sheen." },
    { key: "threads", label: "Threads across", kind: "number", value: has("threads") ? Number(input?.threads) : 10, min: 4, max: 22, step: 1, affects: "Warp count and the width of the panel." },
    { key: "rows", label: "Picks down", kind: "number", value: has("rows") ? Number(input?.rows) : 10, min: 4, max: 22, step: 1, affects: "Weft count and the height of the panel." },
    { key: "density", label: "Ends per cm", kind: "number", value: has("density") ? Number(input?.density) : 24, min: 8, max: 60, step: 1, unit: "/cm", affects: "Cover factor: denser cloth has less air between threads." },
    { key: "threadDiameter", label: "Thread diameter", kind: "number", value: has("threadDiameter") ? Number(input?.threadDiameter) : 0.0004, min: 0.0002, max: 0.0012, step: 0.00005, unit: "m", affects: "Cover factor and how thick the interlacing looks." },
  ];
}

export function buildFabric(input?: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs(input);
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };

  const weave = text(values, "weave", "plain") as Weave;
  const threads = Math.round(num(values, "threads", 10));
  const rows = Math.round(num(values, "rows", 10));
  const density = num(values, "density", 24);
  const diameter = num(values, "threadDiameter", 0.0004);
  const pitch = 0.02 / threads;
  const width = pitch * threads;
  const height = (pitch * rows) / 1;
  const cover = Math.min(1, density * (diameter * 100) * 2);

  const parts: BuildPart[] = [];
  const top = 0.004;

  for (let x = 0; x < threads; x += 1) {
    parts.push(part({
      id: `warp-${x + 1}`, name: `Warp ${x + 1}`, layer: "warp", shape: "cylinder",
      size: { radius: diameter * 22, height },
      position: [-width / 2 + pitch * (x + 0.5), 0, 0], color: "#b98cff", metalness: 0.2, roughness: 0.55,
      explode: [0, top, 0],
      note: `Under tension; it holds the cloth's length.`,
    }));
  }

  for (let y = 0; y < rows; y += 1) {
    parts.push(part({
      id: `weft-${y + 1}`, name: `Weft ${y + 1}`, layer: "weft", shape: "cylinder",
      size: { radius: diameter * 22, height: width },
      position: [0, 0, -height / 2 + (height / rows) * (y + 0.5)],
      rotation: [0, 0, 90],
      // A thread that floats over the top sits higher; one that passes under
      // sits lower. That vertical difference IS the weave.
      color: "#67e8f9", metalness: 0.2, roughness: 0.55,
      explode: [0, -top, 0],
      note: `Pick ${y + 1} of ${rows}.`,
    }));
  }

  // Per-intersection nodes make the weave legible in 3D: over is raised, under
  // is lowered, following warpOnTop().
  for (let x = 0; x < threads; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      const over = warpOnTop(weave, x, y);
      parts.push(part({
        id: `cross-${x + 1}-${y + 1}`, name: `Crossing ${x + 1}.${y + 1}`, layer: over ? "warp" : "weft", shape: "sphere",
        size: { radius: diameter * 26 },
        position: [-width / 2 + pitch * (x + 0.5), over ? diameter * 26 : -diameter * 26, -height / 2 + (height / rows) * (y + 0.5)],
        color: over ? "#c9a6ff" : "#8be9ff", metalness: 0.25, roughness: 0.5,
        explode: [0, over ? top * 1.6 : -top * 1.6, 0],
        note: over ? "Warp over weft here." : "Weft over warp here.",
      }));
    }
  }

  for (const side of [-1, 1] as const) {
    parts.push(part({
      id: `selvedge-${side > 0 ? "right" : "left"}`, name: `Selvedge (${side > 0 ? "right" : "left"})`, layer: "selvedge", shape: "box",
      size: { width: pitch * 0.4, height: diameter * 60, depth: height },
      position: [side * (width / 2 + pitch * 0.2), 0, 0], color: "#9fb4c8", metalness: 0.25, roughness: 0.6,
      explode: [side * 0.03, 0, 0],
      note: "Where the weft turns back: a finished edge that will not unravel.",
    }));
  }

  const layers = layersOf(LAYERS, parts);
  const densityNote = cover > 0.9 ? "a dense, low-air cloth" : cover > 0.6 ? "a balanced cloth" : "an open, airy cloth";

  return {
    ok: true,
    rejected: [],
    program: {
      kind: "build",
      builder: "fabric",
      domain: "textiles",
      title: title ?? `${weave} weave — ${threads} × ${rows} threads`,
      params: values,
      paramSpecs: specs,
      parts,
      layers,
      steps: [
        { id: "warp", name: "1 · Warp", summary: `${threads} threads`, detail: `${threads} lengthwise threads at ${density} ends per cm — the cloth's grain.`, focus: [`warp-1`, `warp-${threads}`] },
        { id: "weft", name: "2 · Weft", summary: `${rows} picks`, detail: `${rows} crosswise picks are laid over and under the warp, one row at a time.`, focus: [`weft-1`, `weft-${rows}`] },
        { id: "interlace", name: "3 · Interlace", summary: weave, detail: weave === "plain" ? "Plain weave: every thread passes over one and under the next, giving the firmest, least lustrous cloth." : weave === "twill" ? "Twill: the crossing steps one thread per row, making the diagonal rib that drapes well." : "Satin: long floats over four threads, which is why it is smooth and shiny — and why it snags.", focus: [`cross-1-1`, `cross-2-1`] },
        { id: "cover", name: "4 · Cover", summary: `${(cover * 100).toFixed(0)}%`, detail: `Cover factor ≈ 2 × density × diameter = ${(cover * 100).toFixed(0)}%: ${densityNote}.`, focus: [`selvedge-left`, `selvedge-right`] },
      ],
      derived: [
        { label: "Weave", value: weave },
        { label: "Thread count", value: `${threads} × ${rows}` },
        { label: "Panel", value: `${(width * 100).toFixed(1)} × ${(height * 100).toFixed(1)} cm` },
        { label: "Cover factor", value: `${(cover * 100).toFixed(0)}%` },
        { label: "Intersections", value: `${threads * rows}` },
      ],
      scene: sceneOf(parts, {
        camera: { position: [width * 1.5, height * 1.9, height * 2.2], target: [0, 0, 0], fov: 40 },
        seed: 8081,
        preset: "fabric",
      }),
      notes: [
        "The weave rule is explicit (plain, twill, satin) and every crossing follows it; cover factor is 2 × ends per cm × thread diameter, a standard approximation.",
        "A structural study of the interlacement: it does not model fibre, twist, yarn hairiness or drape.",
      ],
      sources: [],
    },
  };
}

export const fabricBuilder = {
  id: "fabric",
  domain: "textiles" as const,
  label: "Woven fabric",
  blurb: "A woven panel: plain, twill or satin interlacement with a real cover factor.",
  keywords: ["fabric", "textile", "weave", "woven", "cloth", "plain weave", "twill", "satin", "garment panel"],
  paramSpecs,
  build: (input?: Record<string, unknown>, title?: string) => buildFabric(input, title),
  describe: (request: string) => describeFabricRequest(request),
};

export function describeFabricRequest(request: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const weave = /\b(plain|twill|satin)\b/i.exec(request);
  if (weave) out.weave = weave[1].toLowerCase();
  const threads = /\b(\d{1,2})\s*(?:threads|ends)\b/i.exec(request);
  if (threads) out.threads = Number(threads[1]);
  const rows = /\b(\d{1,2})\s*(?:picks|rows)\b/i.exec(request);
  if (rows) out.rows = Number(rows[1]);
  const density = /\b(\d{1,2})\s*(?:ends|threads)\s*(?:per|\/)\s*cm\b/i.exec(request);
  if (density) out.density = Number(density[1]);
  return out;
}
