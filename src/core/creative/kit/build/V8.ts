/**
 * LÉLU — BUILD ENGINE: a V8 engine
 *
 * The same primitives as every other builder, on a bigger assembly: the
 * crank radius follows from the stroke, the pistons sit on the crank pins at
 * the angle the V needs, and the displacement is computed from bore, stroke
 * and cylinder count. Nothing here is copied text: change the bore and the
 * pistons, heads and displacement all move.
 */

import { part, sceneOf, layersOf, num, validateParams, type BuildOutcome, type BuildPart, type ParamSpec } from "./BuildTypes";

const LAYERS = [
  { id: "block", label: "Block", color: "#8a8f98", note: "The crankcase and the two cylinder banks." },
  { id: "crank", label: "Crankshaft", color: "#b9c2cc", note: "One throw per cylinder, shared by both banks." },
  { id: "rods", label: "Con-rods", color: "#d8b26a", note: "Each rod joins one crank pin to one piston." },
  { id: "pistons", label: "Pistons", color: "#e6ddc9", note: "Four per bank, moving opposite their neighbours." },
  { id: "heads", label: "Heads", color: "#9aa3ad", note: "Cam covers on top of each bank." },
  { id: "ignition", label: "Ignition", color: "#f2a541", note: "One plug per cylinder, down the centre of each head." },
];

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "bore", label: "Bore", kind: "number", value: has("bore") ? Number(input?.bore) : 0.092, min: 0.06, max: 0.13, step: 0.001, unit: "m", affects: "Piston diameter, displacement and how wide the banks sit." },
    { key: "stroke", label: "Stroke", kind: "number", value: has("stroke") ? Number(input?.stroke) : 0.082, min: 0.05, max: 0.12, step: 0.001, unit: "m", affects: "Crank radius (half the stroke), piston travel and displacement." },
    { key: "vAngle", label: "V angle", kind: "number", value: has("vAngle") ? Number(input?.vAngle) : 90, min: 45, max: 120, step: 5, unit: "°", affects: "How far each bank is tilted from vertical." },
    { key: "cylindersPerBank", label: "Cylinders per bank", kind: "number", value: has("cylindersPerBank") ? Number(input?.cylindersPerBank) : 4, min: 2, max: 6, step: 1, affects: "Cylinder count, firing order and overall length." },
    { key: "rodLength", label: "Rod length", kind: "number", value: has("rodLength") ? Number(input?.rodLength) : 0.145, min: 0.10, max: 0.20, step: 0.005, unit: "m", affects: "How far the piston sits from the crank centre." },
  ];
}

export function buildV8(input?: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs(input);
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };

  const bore = num(values, "bore", 0.092);
  const stroke = num(values, "stroke", 0.082);
  const vAngle = num(values, "vAngle", 90);
  const perBank = Math.round(num(values, "cylindersPerBank", 4));
  const rodLength = num(values, "rodLength", 0.145);
  const crankRadius = stroke / 2;
  const spacing = bore * 1.35;
  const count = perBank * 2;
  const displacement = Math.PI * (bore / 2) ** 2 * stroke * count;
  const half = (vAngle / 2) * (Math.PI / 180);

  const parts: BuildPart[] = [];
  const blockLength = spacing * (perBank - 0.4);

  // Crankcase: one box, the datum everything else is placed from.
  parts.push(part({
    id: "block", name: "Crankcase", layer: "block", shape: "box",
    size: { width: bore * 1.9, height: crankRadius * 2.6, depth: blockLength },
    position: [0, -crankRadius * 0.9, 0], color: "#7d838c", metalness: 0.5, roughness: 0.55,
    explode: [0, -0.24, 0],
    note: "Carries the crankshaft and both cylinder banks.",
  }));

  parts.push(part({
    id: "crank", name: "Crankshaft", layer: "crank", shape: "cylinder",
    size: { radius: crankRadius * 0.34, height: blockLength + 0.05 },
    position: [0, 0, 0], rotation: [90, 0, 0], color: "#c3ccd6", metalness: 0.85, roughness: 0.25,
    spin: { axis: "z", speed: 0.6 },
    explode: [0, 0, 0.28],
    note: "Turns the reciprocating pistons into rotation.",
  }));

  for (let i = 0; i < perBank; i += 1) {
    const z = -blockLength / 2 + spacing * (i + 0.5);
    // Both banks are drawn from the same crank pins: one bank tilts one way,
    // the other mirrors it, which is all a V engine's geometry is.
    for (const side of [1, -1] as const) {
      const tag = `${side > 0 ? "r" : "l"}${i + 1}`;
      const n: [number, number, number] = [Math.sin(half) * side, Math.cos(half), 0];
      const pin: [number, number, number] = [n[0] * crankRadius, n[1] * crankRadius, z];
      const at = (distance: number): [number, number, number] => [pin[0] + n[0] * distance, pin[1] + n[1] * distance, z];
      const tilt = -side * (vAngle / 2);

      parts.push(part({
        id: `bank-${side > 0 ? "right" : "left"}`, name: `Cylinder bank (${side > 0 ? "right" : "left"})`, layer: "block", shape: "box",
        size: { width: bore * 1.5, height: rodLength * 0.95, depth: blockLength },
        position: at(rodLength * 0.55),
        rotation: [0, 0, tilt], color: "#8b9199", metalness: 0.45, roughness: 0.6,
        explode: [side * 0.22, 0.16, 0],
        note: `Tilted ${(vAngle / 2).toFixed(0)}° from vertical: half the V.`,
      }));

      parts.push(part({
        id: `rod-${tag}`, name: `Con-rod ${tag.toUpperCase()}`, layer: "rods", shape: "cylinder",
        size: { radius: bore * 0.09, height: rodLength },
        position: at(rodLength * 0.5),
        rotation: [0, 0, tilt], color: "#d8b26a", metalness: 0.7, roughness: 0.35,
        explode: [side * 0.3, 0.1, 0],
        note: "Joins its crank pin to its piston.",
      }));

      parts.push(part({
        id: `piston-${tag}`, name: `Piston ${tag.toUpperCase()}`, layer: "pistons", shape: "cylinder",
        size: { radius: bore / 2, height: stroke * 0.55 },
        position: at(rodLength + stroke * 0.28),
        rotation: [0, 0, tilt], color: "#e6ddc9", metalness: 0.4, roughness: 0.4,
        explode: [side * 0.38, 0.22, 0],
        note: `Bore ${(bore * 1000).toFixed(0)} mm; it travels the full ${(stroke * 1000).toFixed(0)} mm stroke.`,
      }));

      parts.push(part({
        id: `plug-${tag}`, name: `Spark plug ${tag.toUpperCase()}`, layer: "ignition", shape: "cylinder",
        size: { radius: bore * 0.06, height: bore * 0.22 },
        position: at(rodLength + stroke * 0.62),
        rotation: [0, 0, tilt], color: "#f2a541", metalness: 0.6, roughness: 0.3,
        emissive: "#ffb347", emissiveIntensity: 0.35,
        explode: [side * 0.44, 0.32, 0],
        note: `Lights the charge in cylinder ${tag.toUpperCase()}.`,
      }));
    }
  }

  for (const side of [1, -1] as const) {
    parts.push(part({
      id: `head-${side > 0 ? "right" : "left"}`, name: `Cam cover (${side > 0 ? "right" : "left"})`, layer: "heads", shape: "box",
      size: { width: bore * 1.35, height: crankRadius * 0.5, depth: blockLength },
      position: [Math.sin(half) * side * (crankRadius + rodLength + stroke * 0.5), Math.cos(half) * (crankRadius + rodLength + stroke * 0.5), 0],
      rotation: [0, 0, -side * (vAngle / 2)], color: "#9aa3ad", metalness: 0.55, roughness: 0.45,
      explode: [side * 0.3, 0.34, 0],
      note: "Closes the bank over its valves and plugs.",
    }));
  }

  const layers = layersOf(LAYERS, parts);

  return {
    ok: true,
    rejected: [],
    program: {
      kind: "build",
      builder: "v8",
      domain: "mechanical",
      title: title ?? `V${count} engine — ${(bore * 1000).toFixed(0)} × ${(stroke * 1000).toFixed(0)} mm`,
      params: values,
      paramSpecs: specs,
      parts,
      layers,
      steps: [
        { id: "block", name: "1 · Crankcase", summary: "The datum", detail: `The crankcase holds the crankshaft on its centre line; both banks are placed from it at ±${(vAngle / 2).toFixed(0)}°.`, focus: ["block", "crank"] },
        { id: "crank", name: "2 · Crank", summary: `${(crankRadius * 1000).toFixed(0)} mm radius`, detail: `Stroke ${(stroke * 1000).toFixed(0)} mm gives a crank radius of ${(crankRadius * 1000).toFixed(0)} mm — half the stroke, which is where every piston's travel comes from.`, focus: ["crank", "rod-r1"] },
        { id: "rods", name: "3 · Rods", summary: `${rodLength * 1000} mm`, detail: `Each con-rod joins one crank pin to one piston at the bank's angle, so the rod length sets how high the piston sits.`, focus: ["rod-r1", "rod-l1"] },
        { id: "pistons", name: "4 · Pistons", summary: `${count} of them`, detail: `${perBank} pistons per bank, ${(bore * 1000).toFixed(0)} mm bore, each moving the same stroke.`, focus: ["piston-r1", "piston-l1"] },
        { id: "ignition", name: "5 · Ignition", summary: "One plug per cylinder", detail: "Every cylinder has its own plug in the centre of its bank, above its piston.", focus: ["plug-r1", "plug-l1"] },
      ],
      derived: [
        { label: "Configuration", value: `V${count} (${vAngle}°)` },
        { label: "Bore × stroke", value: `${(bore * 1000).toFixed(0)} × ${(stroke * 1000).toFixed(0)} mm` },
        { label: "Displacement", value: `${(displacement * 1000).toFixed(2)} L` },
        { label: "Crank radius", value: `${(crankRadius * 1000).toFixed(1)} mm` },
        { label: "Bank length", value: `${(blockLength * 1000).toFixed(0)} mm` },
      ],
      scene: sceneOf(parts, {
        camera: { position: [blockLength * 1.15, rodLength * 1.6, blockLength * 1.5], target: [0, rodLength * 0.5, 0], fov: 38 },
        seed: 7007,
        preset: "v8",
      }),
      notes: [
        "Displacement is computed as π × (bore/2)² × stroke × cylinders; the crank radius is half the stroke, and both banks are placed at ±half the V angle.",
        "This is a schematic of a V engine's geometry — no valve train, no combustion, no thermal or structural model. It is not a validated design.",
      ],
      sources: [],
    },
  };
}

export const v8Builder = {
  id: "v8",
  domain: "mechanical" as const,
  label: "V engine",
  blurb: "A V engine: banks at an angle, pistons on a common crank, displacement from bore and stroke.",
  keywords: ["v8", "v6", "v12", "v engine", "engine block", "combustion engine", "pistons"],
  paramSpecs,
  build: (input?: Record<string, unknown>, title?: string) => buildV8(input, title),
  describe: (request: string) => describeV8Request(request),
};

export function describeV8Request(request: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cylinders = /\bv\s?(6|8|10|12)\b/i.exec(request);
  if (cylinders) out.cylindersPerBank = Number(cylinders[1]) / 2;
  const bore = /\b(\d{2,3}(?:\.\d+)?)\s*mm\s*(?:bore|×|x)/i.exec(request);
  if (bore) out.bore = Number(bore[1]) / 1000;
  const stroke = /\b(\d{2,3}(?:\.\d+)?)\s*mm\s*(?:stroke|travel)/i.exec(request);
  if (stroke) out.stroke = Number(stroke[1]) / 1000;
  const litres = /\b(\d(?:\.\d)?)\s*(?:l|litre|liter)s?\b/i.exec(request);
  if (litres && !bore) {
    // A displacement with no bore: keep the default bore ratio and solve the stroke.
    const target = Number(litres) / 1000;
    const perBank = typeof out.cylindersPerBank === "number" ? out.cylindersPerBank : 4;
    const boreM = 0.092;
    const strokeM = target / (Math.PI * (boreM / 2) ** 2 * perBank * 2);
    if (strokeM > 0.05 && strokeM < 0.12) out.stroke = Math.round(strokeM * 1000) / 1000;
  }
  const vAngle = /\b(\d{2,3})\s*(?:°|deg|degree)\b/i.exec(request);
  if (vAngle) out.vAngle = Number(vAngle[1]);
  return out;
}
