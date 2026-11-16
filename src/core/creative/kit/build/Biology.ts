/**
 * LÉLU — BUILD ENGINE: a cell
 *
 * A eukaryotic cell laid out from its own numbers: the radius sets the
 * membrane, the surface area, the volume and the surface-to-volume ratio,
 * and the organelle counts are placed on rings inside it so nothing overlaps
 * the nucleus. The geometry is a teaching model, not a micrograph.
 */

import { part, ringPoint, sceneOf, layersOf, num, validateParams, type BuildOutcome, type BuildPart, type ParamSpec } from "./BuildTypes";

const LAYERS = [
  { id: "membrane", label: "Membrane", color: "#7ee2b8", note: "The boundary; its area limits what can cross." },
  { id: "cytoplasm", label: "Cytoplasm", color: "#3f7f6a", note: "Where the organelles sit." },
  { id: "nucleus", label: "Nucleus", color: "#b98cff", note: "Holds the DNA; the nucleolus makes ribosomes." },
  { id: "organelles", label: "Organelles", color: "#f2a541", note: "Mitochondria: the energy converters." },
  { id: "reticulum", label: "Reticulum & Golgi", color: "#9fb4c8", note: "Folding, packaging and shipping." },
  { id: "ribosomes", label: "Ribosomes", color: "#ffe08a", note: "Where proteins are assembled." },
];

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "radius", label: "Cell radius", kind: "number", value: has("radius") ? Number(input?.radius) : 0.03, min: 0.008, max: 0.08, step: 0.001, unit: "m", affects: "Surface area, volume, surface-to-volume ratio and every organelle's scale." },
    { key: "mitochondria", label: "Mitochondria", kind: "number", value: has("mitochondria") ? Number(input?.mitochondria) : 6, min: 0, max: 16, step: 1, affects: "How many energy converters the model shows." },
    { key: "ribosomes", label: "Ribosomes", kind: "number", value: has("ribosomes") ? Number(input?.ribosomes) : 24, min: 0, max: 60, step: 1, affects: "Density of the dots on the reticulum." },
    { key: "nucleusFraction", label: "Nucleus size", kind: "number", value: has("nucleusFraction") ? Number(input?.nucleusFraction) : 0.32, min: 0.15, max: 0.5, step: 0.01, affects: "Nucleus radius as a fraction of the cell radius." },
  ];
}

export function buildCell(input?: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs(input);
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };

  const radius = num(values, "radius", 0.03);
  const mitochondria = Math.round(num(values, "mitochondria", 6));
  const ribosomes = Math.round(num(values, "ribosomes", 24));
  const nucleusRadius = radius * num(values, "nucleusFraction", 0.32);
  const surfaceArea = 4 * Math.PI * radius * radius;
  const volume = (4 / 3) * Math.PI * radius ** 3;
  const ratio = surfaceArea / volume;

  const parts: BuildPart[] = [
    part({
      id: "membrane", name: "Cell membrane", layer: "membrane", shape: "sphere",
      size: { radius },
      position: [0, 0, 0], color: "#7ee2b8", metalness: 0.1, roughness: 0.65, opacity: 0.32,
      explode: [0, 0, 0],
      note: `Surface area ${(surfaceArea * 1e6).toFixed(2)} mm² at radius ${(radius * 1000).toFixed(0)} mm.`,
    }),
    part({
      id: "cytoplasm", name: "Cytoplasm", layer: "cytoplasm", shape: "sphere",
      size: { radius: radius * 0.96 },
      position: [0, 0, 0], color: "#2f5f52", metalness: 0.05, roughness: 0.9, opacity: 0.28,
      explode: [0, 0, 0],
      note: `Volume ${(volume * 1e9).toFixed(1)} mm³ (modelled as a sphere).`,
    }),
    part({
      id: "nucleus", name: "Nucleus", layer: "nucleus", shape: "sphere",
      size: { radius: nucleusRadius },
      position: [0, radius * 0.08, 0], color: "#b98cff", metalness: 0.15, roughness: 0.5, opacity: 0.85,
      explode: [0, radius * 0.45, 0],
      note: `Radius ${(nucleusRadius * 1000).toFixed(1)} mm — ${(num(values, "nucleusFraction", 0.32) * 100).toFixed(0)}% of the cell.`,
    }),
    part({
      id: "nucleolus", name: "Nucleolus", layer: "nucleus", shape: "sphere",
      size: { radius: nucleusRadius * 0.38 },
      position: [nucleusRadius * 0.28, radius * 0.08 + nucleusRadius * 0.2, nucleusRadius * 0.1], color: "#d9c2ff", metalness: 0.15, roughness: 0.45,
      explode: [nucleusRadius * 0.5, radius * 0.62, 0],
      note: "Assembles ribosomal subunits.",
    }),
    part({
      id: "golgi", name: "Golgi stack", layer: "reticulum", shape: "box",
      size: { width: nucleusRadius * 1.1, height: nucleusRadius * 0.18, depth: nucleusRadius * 0.6 },
      position: ringPoint(radius * 0.52, 20, -radius * 0.1), rotation: [0, 20, 8], color: "#9fb4c8", metalness: 0.2, roughness: 0.5,
      explode: [radius * 0.4, 0, -radius * 0.2],
      note: "Stacks, modifies and ships proteins.",
    }),
    part({
      id: "reticulum", name: "Rough ER", layer: "reticulum", shape: "torus",
      size: { radius: radius * 0.28, tube: radius * 0.035 },
      position: ringPoint(radius * 0.45, 200, radius * 0.06), rotation: [78, 0, 24], color: "#8ba9c4", metalness: 0.2, roughness: 0.55,
      explode: [-radius * 0.35, 0, radius * 0.2],
      note: "Folds proteins; the ribosomes sit on it.",
    }),
  ];

  for (let i = 0; i < mitochondria; i += 1) {
    const angle = (360 / Math.max(1, mitochondria)) * i + 15;
    const position = ringPoint(radius * 0.6, angle, Math.sin((angle * Math.PI) / 180) * radius * 0.25);
    parts.push(part({
      id: `mitochondrion-${i + 1}`, name: `Mitochondrion ${i + 1}`, layer: "organelles", shape: "cylinder",
      size: { radius: radius * 0.07, height: radius * 0.26 },
      position, rotation: [0, angle, 70], color: "#f2a541", metalness: 0.15, roughness: 0.6,
      explode: [position[0] * 0.6, radius * 0.3, position[2] * 0.6],
      note: "Converts chemical energy; its folds increase the inner surface.",
    }));
  }

  for (let i = 0; i < ribosomes; i += 1) {
    const angle = (360 / Math.max(1, ribosomes)) * i;
    const y = Math.cos((angle * Math.PI) / 180) * radius * 0.3;
    parts.push(part({
      id: `ribosome-${i + 1}`, name: `Ribosome ${i + 1}`, layer: "ribosomes", shape: "sphere",
      size: { radius: radius * 0.012 },
      position: [Math.cos((angle * Math.PI) / 180) * radius * 0.62, y, Math.sin((angle * Math.PI) / 180) * radius * 0.32],
      color: "#ffe08a", metalness: 0.1, roughness: 0.5,
      explode: [0, radius * 0.7, 0],
      note: "Assembles a protein from an mRNA message.",
    }));
  }

  const layers = layersOf(LAYERS, parts);

  return {
    ok: true,
    rejected: [],
    program: {
      kind: "build",
      builder: "cell",
      domain: "biology",
      title: title ?? `Eukaryotic cell — ${(radius * 1000).toFixed(0)} mm radius`,
      params: values,
      paramSpecs: specs,
      parts,
      layers,
      steps: [
        { id: "membrane", name: "1 · Membrane", summary: `${(surfaceArea * 1e6).toFixed(1)} mm²`, detail: `A sphere of radius ${(radius * 1000).toFixed(0)} mm has a surface area of 4πr² = ${(surfaceArea * 1e6).toFixed(2)} mm².`, focus: ["membrane"] },
        { id: "volume", name: "2 · Volume", summary: `${(volume * 1e9).toFixed(1)} mm³`, detail: `V = 4/3 πr³ = ${(volume * 1e9).toFixed(2)} mm³, giving a surface-to-volume ratio of ${ratio.toFixed(0)} per metre — smaller cells exchange faster.`, focus: ["cytoplasm"] },
        { id: "nucleus", name: "3 · Nucleus", summary: `${(nucleusRadius * 1000).toFixed(1)} mm`, detail: `The nucleus is ${(num(values, "nucleusFraction", 0.32) * 100).toFixed(0)}% of the cell radius, with its nucleolus inside.`, focus: ["nucleus", "nucleolus"] },
        { id: "organelles", name: "4 · Organelles", summary: `${mitochondria} mitochondria`, detail: "Each mitochondrion sits in the cytoplasm off the nuclear axis, so it does not intersect the nucleus.", focus: ["mitochondrion-1"] },
        { id: "reticulum", name: "5 · Reticulum", summary: `${ribosomes} ribosomes`, detail: "The rough ER and the Golgi are placed around the nucleus; ribosomes dot the ER surface.", focus: ["reticulum", "golgi", "ribosome-1"] },
      ],
      derived: [
        { label: "Surface area", value: `${(surfaceArea * 1e6).toFixed(2)} mm²` },
        { label: "Volume", value: `${(volume * 1e9).toFixed(1)} mm³` },
        { label: "Surface : volume", value: `${ratio.toFixed(0)} m⁻¹` },
        { label: "Nucleus", value: `${(nucleusRadius * 1000).toFixed(1)} mm radius` },
        { label: "Organelles", value: `${mitochondria} mitochondria · ${ribosomes} ribosomes` },
      ],
      scene: sceneOf(parts, {
        camera: { position: [radius * 2.2, radius * 1.6, radius * 2.6], target: [0, 0, 0], fov: 40 },
        seed: 3301,
        preset: "cell",
      }),
      notes: [
        "Areas and volumes are sphere formulae on the radius given. Organelle counts are what the model draws — they are not measurements from a real cell.",
        "A teaching model: proportions and placements are schematic, and the membrane is drawn translucent so the inside can be seen.",
      ],
      sources: [],
    },
  };
}

export const cellBuilder = {
  id: "cell",
  domain: "biology" as const,
  label: "Cell",
  blurb: "A eukaryotic cell: membrane, nucleus, mitochondria, reticulum — with real areas and volumes.",
  keywords: ["cell", "cellular", "organelle", "biology", "nucleus", "mitochondria", "eukaryotic"],
  paramSpecs,
  build: (input?: Record<string, unknown>, title?: string) => buildCell(input, title),
  describe: (request: string) => describeCellRequest(request),
};

export function describeCellRequest(request: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const radius = /\b(\d+(?:\.\d+)?)\s*(?:mm|millimetre|millimeter)\s*(?:radius)?\b/i.exec(request);
  if (radius) out.radius = Math.min(0.08, Math.max(0.008, Number(radius[1]) / 1000));
  const mito = /\b(\d{1,2})\s*mitochondri/i.exec(request);
  if (mito) out.mitochondria = Number(mito[1]);
  const ribo = /\b(\d{1,2})\s*ribosom/i.exec(request);
  if (ribo) out.ribosomes = Number(ribo[1]);
  return out;
}
