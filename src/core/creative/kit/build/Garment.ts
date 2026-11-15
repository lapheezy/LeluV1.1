/**
 * LÉLU — BUILD ENGINE: garments
 *
 * A garment is panels before it is a shape. This builder works the way the
 * thing is actually made: front and back panels measured from the chest and
 * the length, sleeves measured from the arm, a collar or hood at the neck
 * opening, seams where panels meet, and closures where the front closes.
 *
 * The fabric is not decoration. Weave, ends per cm and thread diameter come
 * from the same rubric the fabric builder uses, and the cover factor is the
 * same arithmetic — so a garment made "in twill" is the twill panel, cut into
 * panels. `garmentFromFabric` takes a woven sample's own parameters, which is
 * how a fabric sample becomes a garment's material.
 *
 * Honest classification: this is a PATTERN-BASED TEXTILE REPRESENTATION —
 * rectangular panels derived from body measurements, with seam allowance
 * shown as a derived figure. It is not a graded, manufacturing-ready pattern:
 * darts, ease, curves, grain lines and a cut list are not implemented.
 */

import { part, sceneOf, layersOf, num, text, validateParams, type BuildOutcome, type BuildPart, type ParamSpec } from "./BuildTypes";

const KINDS = ["shirt", "hoodie", "jacket", "pants", "skirt", "dress"] as const;
type Kind = (typeof KINDS)[number];
const WEAVES = ["plain", "twill", "satin", "knit"] as const;

const LAYERS = [
  { id: "panels", label: "Panels", color: "#b98cff", note: "Front and back — the two pieces almost every garment starts from." },
  { id: "sleeves", label: "Sleeves", color: "#67e8f9", note: "Cut from the arm measurement and set into the armhole." },
  { id: "neck", label: "Collar or hood", color: "#f0abfc", note: "What finishes the neck opening." },
  { id: "seams", label: "Seams", color: "#9fb4c8", note: "Where panels are joined; the allowance is inside them." },
  { id: "closures", label: "Closures", color: "#fbd38d", note: "Buttons, a zip pull or a drawcord — how the garment closes." },
  { id: "fabric", label: "Fabric", color: "#c4b5fd", note: "The woven sample this garment is cut from." },
];

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "kind", label: "Garment", kind: "choice", value: has("kind") ? String(input?.kind) : "shirt", choices: [...KINDS], affects: "Which panels exist and how they are assembled." },
    { key: "chest", label: "Chest", kind: "number", value: has("chest") ? Number(input?.chest) : 100, min: 60, max: 160, step: 1, unit: "cm", affects: "Panel width, sleeve opening and the armhole depth." },
    { key: "length", label: "Length", kind: "number", value: has("length") ? Number(input?.length) : 72, min: 30, max: 150, step: 1, unit: "cm", affects: "How far the front and back panels hang." },
    { key: "sleeve", label: "Sleeve", kind: "number", value: has("sleeve") ? Number(input?.sleeve) : 62, min: 0, max: 90, step: 1, unit: "cm", affects: "Sleeve length; 0 makes it sleeveless." },
    { key: "weave", label: "Weave", kind: "choice", value: has("weave") ? String(input?.weave) : "plain", choices: [...WEAVES], affects: "The fabric's interlacement, and therefore its cover factor and drape." },
    { key: "density", label: "Ends per cm", kind: "number", value: has("density") ? Number(input?.density) : 24, min: 8, max: 60, step: 1, unit: "/cm", affects: "Cover factor, with the thread diameter." },
    { key: "threadDiameter", label: "Thread diameter", kind: "number", value: has("threadDiameter") ? Number(input?.threadDiameter) : 0.0004, min: 0.0002, max: 0.0012, step: 0.00005, unit: "m", affects: "Cover factor: how much air is left between threads." },
  ];
}

/** The garment's fabric, in the fabric builder's own terms. */
export interface GarmentFabric {
  weave: string;
  endsPerCm: number;
  threadDiameter: number;
  /** 2 × ends per cm × thread diameter, capped at 1 — the same rule as the loom. */
  cover: number;
}

export function fabricOf(params: Record<string, number | string>): GarmentFabric {
  const weave = text(params, "weave", "plain");
  const endsPerCm = num(params, "density", 24);
  const threadDiameter = num(params, "threadDiameter", 0.0004);
  return { weave, endsPerCm, threadDiameter, cover: Math.min(1, endsPerCm * threadDiameter * 100 * 2) };
}

/**
 * Take the parameters of a built woven sample and use them as this garment's
 * fabric: one rubric, not a second opinion about what twill costs.
 */
export function garmentFromFabric(fabricParams: Record<string, number | string>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (typeof fabricParams.weave === "string") out.weave = fabricParams.weave;
  if (typeof fabricParams.density === "number") out.density = fabricParams.density;
  if (typeof fabricParams.threadDiameter === "number") out.threadDiameter = fabricParams.threadDiameter;
  return out;
}

export function buildGarment(input?: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs(input);
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };

  const kind = text(values, "kind", "shirt") as Kind;
  const chest = num(values, "chest", 100);
  const length = num(values, "length", 72);
  const sleeve = num(values, "sleeve", 62);
  const fabric = fabricOf(values);

  const allowance = 0.012; // 12 mm seam allowance, doubled at every seam
  const bodyWidth = chest / 100 / 2 + 0.02; // half chest + ease
  const armhole = Math.min(0.26, (chest / 100) * 0.18);
  const isLegwear = kind === "pants" || kind === "skirt";
  const hasSleeve = !isLegwear && sleeve > 0;
  const panelHeight = length / 100;
  const shell = fabric.weave === "knit" ? "#8b6bd6" : fabric.cover > 0.85 ? "#b98cff" : "#c4b5fd";
  const yarn = { metalness: 0.02, roughness: 0.85 };

  const parts: BuildPart[] = [];
  // Front and back, as flat panels — the two pieces everything else hangs from.
  for (const side of [-1, 1] as const) {
    parts.push(
      part({
        id: side > 0 ? "panel-front" : "panel-back",
        name: side > 0 ? "Front panel" : "Back panel",
        layer: "panels",
        shape: "box",
        size: { width: bodyWidth, height: panelHeight, depth: allowance },
        position: [0, panelHeight / 2, side * (allowance * 1.2)],
        color: shell,
        ...yarn,
        explode: [0, 0, side * 0.12],
        note: `${(bodyWidth * 100).toFixed(0)} cm wide × ${(panelHeight * 100).toFixed(0)} cm long, cut with a ${(allowance * 1000).toFixed(0)} mm seam allowance.`,
      }),
    );
  }

  // Sleeves: a tube per arm, set in at the armhole.
  if (hasSleeve) {
    for (const side of [-1, 1] as const) {
      const len = sleeve / 100;
      parts.push(
        part({
          id: `sleeve-${side > 0 ? "right" : "left"}`,
          name: `Sleeve (${side > 0 ? "right" : "left"})`,
          layer: "sleeves",
          shape: "cylinder",
          size: { radius: Math.max(0.05, armhole * 0.62), height: len },
          position: [side * (bodyWidth + 0.02 + len / 2), 0, 0],
          rotation: [0, 0, 90],
          color: shell,
          ...yarn,
          explode: [side * 0.16, 0, 0],
          note: `${(len * 100).toFixed(0)} cm from the armhole to the cuff.`,
        }),
      );
    }
  }

  // Neck: a collar for a shirt or jacket, a hood for a hoodie.
  if (!isLegwear) {
    const hooded = kind === "hoodie";
    parts.push(
      part({
        id: hooded ? "hood" : "collar",
        name: hooded ? "Hood" : "Collar",
        layer: "neck",
        shape: hooded ? "sphere" : "torus",
        size: hooded ? { radius: Math.min(0.2, bodyWidth * 0.55) } : { radius: Math.min(0.16, bodyWidth * 0.42), tube: 0.016 },
        position: [0, panelHeight + (hooded ? 0.08 : 0.01), hooded ? -0.02 : 0],
        color: hooded ? shell : "#f0abfc",
        ...yarn,
        explode: [0, 0.12, 0],
        note: hooded ? "Cut in two halves and joined over the crown." : `Finished with a ${kind === "jacket" ? "stand collar" : "neckband"}; the opening is ${(bodyWidth * 72).toFixed(0)} cm around.`,
      }),
    );
  }

  // Seams: side seams, and shoulder seams where there are sleeves.
  for (const side of [-1, 1] as const) {
    parts.push(
      part({
        id: `seam-side-${side > 0 ? "right" : "left"}`,
        name: `Side seam (${side > 0 ? "right" : "left"})`,
        layer: "seams",
        shape: "box",
        size: { width: allowance * 0.8, height: panelHeight, depth: allowance * 2.4 },
        position: [side * bodyWidth, panelHeight / 2, 0],
        color: "#9fb4c8",
        ...yarn,
        explode: [side * 0.08, 0, 0],
        note: "Holds the front and back together along the body.",
      }),
    );
  }
  if (hasSleeve) {
    for (const side of [-1, 1] as const) {
      parts.push(
        part({
          id: `seam-armhole-${side > 0 ? "right" : "left"}`,
          name: `Armhole seam (${side > 0 ? "right" : "left"})`,
          layer: "seams",
          shape: "torus",
          size: { radius: armhole * 0.62, tube: allowance * 0.5 },
          position: [side * bodyWidth * 0.92, panelHeight * 0.82, 0],
          rotation: [0, 0, 90],
          color: "#9fb4c8",
          ...yarn,
          explode: [side * 0.12, 0, 0],
          note: `Sets the sleeve into the body; the armhole is ${(armhole * 62).toFixed(0)} cm around.`,
        }),
      );
    }
  }

  // Closures: buttons down a shirt, a zip pull on a jacket, a drawcord in a hood.
  if (kind === "shirt" || kind === "jacket" || kind === "hoodie") {
    const count = kind === "jacket" ? 1 : 6;
    for (let i = 0; i < count; i += 1) {
      parts.push(
        part({
          id: `closure-${i + 1}`,
          name: kind === "jacket" ? "Zip pull" : `Button ${i + 1}`,
          layer: "closures",
          shape: kind === "jacket" ? "box" : "cylinder",
          size: kind === "jacket" ? { width: 0.016, height: 0.05, depth: 0.008 } : { radius: 0.008, height: 0.003 },
          position: [0, panelHeight * (0.18 + (0.64 * i) / Math.max(1, count - 1)), allowance * 2.4],
          color: "#fbd38d",
          metalness: 0.6,
          roughness: 0.3,
          explode: [0, 0, 0.1],
          note: kind === "jacket" ? "A full-length zip: one closure, opened from either end." : `Button ${i + 1} of ${count} down the front placket.`,
        }),
      );
    }
  }
  if (kind === "pants" || kind === "skirt") {
    const legs = kind === "pants" ? 2 : 1;
    for (let i = 0; i < legs; i += 1) {
      const side = i === 0 ? -1 : 1;
      parts.push(
        part({
          id: legs === 2 ? `leg-${side > 0 ? "right" : "left"}` : "skirt-body",
          name: legs === 2 ? `Leg (${side > 0 ? "right" : "left"})` : "Skirt body",
          layer: "panels",
          shape: "cylinder",
          size: { radius: bodyWidth / (legs === 2 ? 2.4 : 1.1), height: panelHeight },
          position: [legs === 2 ? side * bodyWidth * 0.22 : 0, panelHeight / 2, 0],
          color: shell,
          ...yarn,
          explode: [side * 0.12, 0, 0],
          note: legs === 2 ? "Cut as a tube and joined at the crotch seam." : "A single flared body, gathered or pleated at the waist.",
        }),
      );
    }
    parts.push(
      part({
        id: "waistband",
        name: "Waistband",
        layer: "closures",
        shape: "torus",
        size: { radius: bodyWidth / (kind === "pants" ? 1.2 : 1.1), tube: 0.016 },
        position: [0, panelHeight + 0.016, 0],
        rotation: [Math.PI / 2, 0, 0],
        color: "#fbd38d",
        ...yarn,
        explode: [0, 0.1, 0],
        note: "The closure for legwear: elastic or a button tab at the waist.",
      }),
    );
  }

  // The fabric itself, shown as a swatch inside the garment's neck opening.
  parts.push(
    part({
      id: "fabric-swatch",
      name: "Fabric",
      layer: "fabric",
      shape: "box",
      size: { width: Math.min(0.16, bodyWidth * 0.5), height: Math.min(0.16, bodyWidth * 0.5), depth: 0.001 },
      position: [0, panelHeight - 0.06, allowance * 2.6],
      color: fabric.weave === "satin" ? "#e9d5ff" : shell,
      metalness: fabric.weave === "satin" ? 0.35 : 0.02,
      roughness: fabric.weave === "satin" ? 0.25 : 0.85,
      explode: [0, 0, 0.14],
      note: `${fabric.weave} at ${fabric.endsPerCm} ends/cm, ${(fabric.cover * 100).toFixed(0)}% cover — the same figure the loom gives.`,
    }),
  );

  const layers = layersOf(LAYERS, parts);
  // Panel area, with the allowance added twice at every cut edge — the honest
  // way to say how much cloth this actually takes.
  const panelArea = 2 * (bodyWidth + allowance * 2) * (panelHeight + allowance * 2);
  const sleeveArea = hasSleeve ? 2 * Math.PI * Math.max(0.05, armhole * 0.62) * (sleeve / 100) : 0;
  const fabricUsed = panelArea + sleeveArea;

  return {
    ok: true,
    rejected: [],
    program: {
      kind: "build",
      builder: "garment",
      domain: "fashion",
      title: title ?? `${kind} — chest ${chest} cm, length ${length} cm`,
      params: values,
      paramSpecs: specs,
      parts,
      layers,
      steps: [
        { id: "panels", name: "1 · Panels", summary: `${(bodyWidth * 100).toFixed(0)} cm`, detail: `Front and back panels, each ${(bodyWidth * 100).toFixed(0)} cm wide and ${(panelHeight * 100).toFixed(0)} cm long, cut from the ${fabric.weave} cloth with a ${(allowance * 1000).toFixed(0)} mm allowance.`, focus: ["panel-front", "panel-back"] },
        { id: "sleeves", name: "2 · Sleeves", summary: hasSleeve ? `${sleeve} cm` : "sleeveless", detail: hasSleeve ? `Two sleeves ${sleeve} cm long, set into an armhole ${(armhole * 62).toFixed(0)} cm around.` : "No sleeves: the armhole is finished with a binding instead.", focus: hasSleeve ? ["sleeve-left", "sleeve-right"] : ["seam-side-left"] },
        { id: "neck", name: "3 · Neck", summary: kind === "hoodie" ? "hood" : "collar", detail: kind === "hoodie" ? "A two-piece hood joined over the crown." : "A neckband, one turn deep, stretched slightly so the opening lies flat.", focus: [kind === "hoodie" ? "hood" : "collar"] },
        { id: "seams", name: "4 · Seams", summary: `${parts.filter((p) => p.layer === "seams").length}`, detail: `Side seams and armholes: ${parts.filter((p) => p.layer === "seams").length} joined edges, each with the allowance pressed to one side.`, focus: ["seam-side-left", "seam-side-right"] },
        { id: "fabric", name: "5 · Fabric", summary: `${fabric.weave} ${(fabric.cover * 100).toFixed(0)}%`, detail: `The cloth is ${fabric.weave} at ${fabric.endsPerCm} ends/cm: ${fabricUsed.toFixed(2)} m² of fabric including allowances.`, focus: ["fabric-swatch"] },
      ],
      derived: [
        { label: "Garment", value: kind },
        { label: "Chest", value: `${chest} cm` },
        { label: "Length", value: `${length} cm` },
        { label: "Sleeve", value: hasSleeve ? `${sleeve} cm` : "none" },
        { label: "Fabric", value: `${fabric.weave}, ${(fabric.cover * 100).toFixed(0)}% cover` },
        { label: "Fabric used", value: `${fabricUsed.toFixed(2)} m²` },
        { label: "Panels", value: `${parts.filter((p) => p.layer === "panels").length}` },
      ],
      scene: sceneOf(parts, {
        camera: { position: [bodyWidth * 3.4, panelHeight * 1.5, bodyWidth * 4.2], target: [0, panelHeight * 0.5, 0], fov: 40 },
        seed: 5150,
        preset: "garment",
      }),
      notes: [
        "Pattern-based textile representation: rectangular panels derived from body measurements, with the seam allowance as a real dimension.",
        "Not a graded, manufacturing-ready pattern — darts, ease curves, grain lines and a cut list are not implemented, and nothing here is claimed to be production-ready.",
        `The fabric is the same rubric as the woven sample: ${fabric.weave}, ${fabric.endsPerCm} ends/cm, cover ${(fabric.cover * 100).toFixed(0)}%. Pass a fabric's own parameters with garmentFromFabric to cut the garment from that cloth.`,
      ],
      sources: [],
    },
  };
}

export const garmentBuilder = {
  id: "garment",
  domain: "fashion" as const,
  label: "Garment",
  blurb: "Shirts, hoodies, jackets, pants, skirts and dresses as measured panels.",
  keywords: ["garment", "shirt", "hoodie", "jacket", "coat", "pants", "trousers", "jeans", "skirt", "dress", "apparel", "clothing", "sleeve", "collar"],
  paramSpecs,
  build: (input?: Record<string, unknown>, title?: string) => buildGarment(input, title),
  describe: (request: string) => describeGarmentRequest(request),
};

export function describeGarmentRequest(request: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const kind = /\b(shirt|tee|t-shirt|hoodie|jacket|coat|pants|trousers|jeans|skirt|dress)\b/i.exec(request);
  if (kind) {
    const word = kind[1].toLowerCase();
    out.kind = word === "tee" || word === "t-shirt" ? "shirt" : word === "coat" ? "jacket" : word === "trousers" || word === "jeans" ? "pants" : word;
  }
  const chest = /\bchest\s*(\d{2,3})\b/i.exec(request);
  if (chest) out.chest = Number(chest[1]);
  const length = /\blength\s*(\d{2,3})\b/i.exec(request);
  if (length) out.length = Number(length[1]);
  const sleeve = /\bsleeve[s]?\s*(\d{2,3})\b/i.exec(request);
  if (sleeve) out.sleeve = Number(sleeve[1]);
  if (/\bsleeveless\b/i.test(request)) out.sleeve = 0;
  const weave = /\b(plain|twill|satin|knit|jersey)\b/i.exec(request);
  if (weave) out.weave = weave[1].toLowerCase() === "jersey" ? "knit" : weave[1].toLowerCase();
  return out;
}
