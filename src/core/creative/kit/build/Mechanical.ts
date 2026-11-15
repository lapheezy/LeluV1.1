/**
 * LÉLU — BUILD ENGINE: mechanical assemblies (gear train)
 *
 * A parametric gearbox: the teeth counts, the module and the input speed are
 * the inputs, and everything else — pitch radii, the centre distances, the
 * housing length, the bearing seats, the output speed — is derived from them.
 * Change one number and the assembly stays consistent, which is what makes
 * the modification path meaningful rather than cosmetic.
 *
 * The gears are drawn at their real tooth count with a real pitch radius;
 * they are a schematic of a gear train, not a cutting drawing.
 */

import {
  part,
  ringPoint,
  sceneOf,
  layersOf,
  num,
  validateParams,
  type BuildOutcome,
  type BuildPart,
  type BuildProgram,
  type ParamSpec,
} from "./BuildTypes";

const LAYERS = [
  { id: "housing", label: "Housing", color: "#7d8794", note: "Carries the bearings and keeps the gears in mesh." },
  { id: "shafts", label: "Shafts", color: "#a9b3bf", note: "The input, the idler and the output shaft the gears turn on." },
  { id: "gears", label: "Gears", color: "#d4a94e", note: "Teeth count sets the ratio; module sets the tooth size." },
  { id: "bearings", label: "Bearings", color: "#9fb4c8", note: "Each shaft sits in two bearings." },
  { id: "lubrication", label: "Lubrication", color: "#f2a541", note: "Oil reaches every mesh and bearing." },
];

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "teethIn", label: "Driver teeth", kind: "number", value: has("teethIn") ? Number(input?.teethIn) : 14, min: 8, max: 40, step: 1, affects: "Pitch radius, ratio and the distance to the next shaft." },
    { key: "teethOut", label: "Output teeth", kind: "number", value: has("teethOut") ? Number(input?.teethOut) : 28, min: 8, max: 60, step: 1, affects: "Output speed, output gear radius and the housing length." },
    { key: "teethIdler", label: "Idler teeth", kind: "number", value: has("teethIdler") ? Number(input?.teethIdler) : 20, min: 0, max: 40, step: 1, affects: "With 0 there is no idler (two gears); otherwise it sets both centre distances and reverses the output direction." },
    { key: "module", label: "Module", kind: "number", value: has("module") ? Number(input?.module) : 0.006, min: 0.003, max: 0.012, step: 0.0005, unit: "m/tooth", affects: "Tooth size and every pitch radius: radius = module × teeth / 2." },
    { key: "faceWidth", label: "Face width", kind: "number", value: has("faceWidth") ? Number(input?.faceWidth) : 0.016, min: 0.008, max: 0.032, step: 0.001, unit: "m", affects: "How wide the gears and the housing are." },
    { key: "inputRpm", label: "Input speed", kind: "number", value: has("inputRpm") ? Number(input?.inputRpm) : 1500, min: 300, max: 9000, step: 50, unit: "rpm", affects: "Output speed, and how fast the animation turns." },
  ];
}

const pitchRadius = (moduleM: number, teeth: number) => (moduleM * teeth) / 2;

function gearTeeth(
  prefix: string,
  center: [number, number],
  radius: number,
  count: number,
  moduleM: number,
  faceWidth: number,
  layer: string,
  color: string,
  spinSpeed: number,
): BuildPart[] {
  if (count <= 0) return [];
  const [cx, cz] = center;
  const parts: BuildPart[] = [];
  const toothDepth = moduleM * 1.5;
  for (let i = 0; i < count; i += 1) {
    const angle = (360 / count) * i;
    const [x, y, z] = ringPoint(radius + toothDepth * 0.35, angle, 0);
    parts.push(
      part({
        id: `${prefix}-tooth-${i + 1}`,
        name: `Tooth ${i + 1}`,
        layer,
        shape: "box",
        size: { width: moduleM * 1.5, height: faceWidth, depth: toothDepth },
        position: [cx + x, y, cz + z],
        rotation: [0, -angle, 0],
        color,
        metalness: 0.55,
        roughness: 0.35,
        label: [cx + x * 1.4, y + faceWidth * 0.6, cz + z * 1.4],
        explode: [x * 3, 0, z * 3],
        note: "One tooth: teeth count is the ratio.",
        spin: { axis: "y", speed: spinSpeed },
      }),
    );
  }
  return parts;
}

export function buildGearbox(input: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs();
  const { values, rejected } = validateParams(specs, input);
  // Nothing is built from a refusal: a caller that asked for a 900-tooth gear
  // is told no, rather than handed a gear that is not what they asked for.
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };
  const moduleM = num(values, "module", 0.006);
  const teethIn = Math.round(num(values, "teethIn", 14));
  const teethOut = Math.round(num(values, "teethOut", 28));
  const teethIdler = Math.round(num(values, "teethIdler", 20));
  const faceWidth = num(values, "faceWidth", 0.016);
  const inputRpm = num(values, "inputRpm", 1500);
  if (teethIn < 8 || teethOut < 8) return { ok: false, reason: "a gear needs at least 8 teeth to mesh at this module", rejected };

  const r1 = pitchRadius(moduleM, teethIn);
  const r2 = pitchRadius(moduleM, teethOut);
  const ri = pitchRadius(moduleM, teethIdler);
  const hasIdler = teethIdler > 0;
  const c12 = hasIdler ? r1 + ri : r1 + r2;
  const c23 = hasIdler ? ri + r2 : 0;
  const total = c12 + c23;
  const housingLength = total + Math.max(r1, r2) * 2 + faceWidth * 2;
  const gearY = 0.12;

  // World X placement: driver at −total/2, then each mesh at its centre distance.
  const x1 = -total / 2;
  const x2 = hasIdler ? x1 + c12 : null;
  const x3 = x2 !== null ? x2 + c23 : x1 + c12;
  const hub = (x: number): [number, number] => [x, 0];

  const ratio = teethOut / teethIn;
  const outRpm = inputRpm / ratio;
  const deg = (rpm: number) => rpm * 6;
  const w1 = deg(inputRpm);
  const w2 = hasIdler ? -w1 * (teethIn / Math.max(1, teethIdler)) : 0;
  const w3 = hasIdler ? -w2 * (teethIdler / teethOut) : w1 * (teethIn / teethOut);

  const parts: BuildPart[] = [];

  // ---- Housing --------------------------------------------------------
  parts.push(
    part({
      id: "housing-base",
      name: "Housing base",
      layer: "housing",
      shape: "box",
      size: { width: housingLength, height: 0.02, depth: faceWidth * 3.2 },
      position: [0, gearY - Math.max(r1, r2) - 0.03, 0],
      color: "#6f7885",
      metalness: 0.4,
      roughness: 0.6,
      label: [0, gearY - Math.max(r1, r2) - 0.06, faceWidth],
      explode: [0, -0.34, 0],
      note: "The base that locates both bearing walls.",
    }),
    part({
      id: "housing-wall-front",
      name: "Bearing wall (front)",
      layer: "housing",
      shape: "box",
      size: { width: housingLength, height: Math.max(r1, r2) * 2 + 0.06, depth: 0.008 },
      position: [0, gearY, faceWidth * 1.4],
      color: "#8891a0",
      metalness: 0.3,
      roughness: 0.7,
      opacity: 0.5,
      label: [housingLength * 0.36, gearY + Math.max(r1, r2) + 0.02, faceWidth * 1.4],
      explode: [0, 0, 0.42],
      note: "Holds the three shaft bearings in line.",
    }),
    part({
      id: "housing-wall-back",
      name: "Bearing wall (rear)",
      layer: "housing",
      shape: "box",
      size: { width: housingLength, height: Math.max(r1, r2) * 2 + 0.06, depth: 0.008 },
      position: [0, gearY, -faceWidth * 1.4],
      color: "#8891a0",
      metalness: 0.3,
      roughness: 0.7,
      opacity: 0.5,
      label: [-housingLength * 0.36, gearY + Math.max(r1, r2) + 0.02, -faceWidth * 1.4],
      explode: [0, 0, -0.42],
      note: "The second wall: a gear train needs two bearings per shaft.",
    }),
    part({
      id: "cover",
      name: "Inspection cover",
      layer: "housing",
      shape: "box",
      size: { width: housingLength * 0.9, height: 0.006, depth: faceWidth * 2.6 },
      position: [0, gearY + Math.max(r1, r2) + 0.03, 0],
      color: "#5f6875",
      metalness: 0.3,
      roughness: 0.6,
      opacity: 0.35,
      label: [0, gearY + Math.max(r1, r2) + 0.05, faceWidth * 1.3],
      explode: [0, 0.36, 0],
      note: "Lifts off to inspect the mesh (shown transparent here).",
    }),
  );

  // ---- Shafts ---------------------------------------------------------
  const shaftLength = faceWidth * 3.6;
  const shaft = (id: string, name: string, x: number, speed: number, material: string, note: string): BuildPart =>
    part({
      id,
      name,
      layer: "shafts",
      shape: "cylinder",
      size: { radius: Math.max(0.006, moduleM * 1.2), height: shaftLength },
      position: [x, gearY, 0],
      rotation: [90, 0, 0],
      color: material,
      metalness: 0.8,
      roughness: 0.25,
      label: [x, gearY + Math.max(r1, r2) * 0.9, shaftLength * 0.45],
      explode: [x * 0.4, 0.12, shaftLength * 1.1],
      note,
      spin: { axis: "y", speed },
    });
  parts.push(shaft("shaft-input", "Input shaft", x1, w1, "#b7c0cb", "Takes the drive from the motor at the input speed."));
  if (x2 !== null) parts.push(shaft("shaft-idler", "Idler shaft", x2, w2, "#a9b3bf", "Reverses the direction of the drive without changing the ratio."));
  parts.push(shaft("shaft-output", "Output shaft", x3, w3, "#c2cbd6", `Leaves at ${outRpm.toFixed(0)} rpm with ${ratio.toFixed(2)}:1 reduction.`));
  parts.push(
    part({
      id: "coupling",
      name: "Output coupling",
      layer: "shafts",
      shape: "cylinder",
      size: { radius: Math.max(0.012, r2 * 0.35), height: faceWidth * 0.9 },
      position: [x3 + housingLength * 0.24, gearY, 0],
      rotation: [0, 0, 90],
      color: "#8d97a5",
      metalness: 0.7,
      roughness: 0.3,
      label: [x3 + housingLength * 0.24, gearY + 0.05, 0],
      explode: [0.36, 0.08, 0],
      note: "Couples the output shaft to whatever it drives.",
      spin: { axis: "y", speed: w3 },
    }),
  );

  // ---- Gears ----------------------------------------------------------
  const gearBody = (id: string, name: string, x: number, radius: number, speed: number, color: string, note: string): BuildPart =>
    part({
      id,
      name,
      layer: "gears",
      shape: "cylinder",
      size: { radius, height: faceWidth },
      position: [x, gearY, 0],
      color,
      metalness: 0.55,
      roughness: 0.35,
      label: [x, gearY + radius * 0.8, faceWidth],
      explode: [x * 0.3, radius * 1.5, 0],
      note,
      spin: { axis: "y", speed },
    });
  parts.push(
    gearBody("gear-driver", `Driver gear (${teethIn} teeth)`, x1, r1, w1, "#d4a94e", `The input gear: ${teethIn} teeth at ${(r1 * 1000).toFixed(1)} mm pitch radius.`),
    ...gearTeeth("driver", hub(x1), r1, teethIn, moduleM, faceWidth, "gears", "#e0bb62", w1),
  );
  if (x2 !== null) {
    parts.push(
      gearBody("gear-idler", `Idler gear (${teethIdler} teeth)`, x2, ri, w2, "#e0a13a", `The idler: ${teethIdler} teeth, turning the other way.`),
      ...gearTeeth("idler", hub(x2), ri, teethIdler, moduleM, faceWidth, "gears", "#ecb64f", w2),
    );
  }
  parts.push(
    gearBody("gear-output", `Output gear (${teethOut} teeth)`, x3, r2, w3, "#c98f2f", `The output gear: ${teethOut} teeth, ${(ratio).toFixed(2)}× slower than the driver.`),
    ...gearTeeth("output", hub(x3), r2, teethOut, moduleM, faceWidth, "gears", "#d69c3c", w3),
  );

  // ---- Bearings -------------------------------------------------------
  const bearing = (id: string, name: string, x: number, zSide: number): BuildPart =>
    part({
      id,
      name,
      layer: "bearings",
      shape: "torus",
      size: { radius: Math.max(0.012, moduleM * 2.2), tube: 0.004 },
      position: [x, gearY, zSide * faceWidth * 1.4],
      rotation: [90, 0, 0],
      color: "#9fb4c8",
      metalness: 0.85,
      roughness: 0.2,
      label: [x, gearY - Math.max(r1, r2) * 0.55, zSide * faceWidth * 1.4],
      explode: [x * 0.3, -0.2, zSide * 0.6],
      note: "Supports a shaft in the wall and carries its radial load.",
    });
  for (const [x, name] of [[x1, "input"], [x2 ?? null, "idler"], [x3, "output"]] as Array<[number | null, string]>) {
    if (x === null) continue;
    parts.push(bearing(`bearing-${name}-a`, `Bearing ${name} (front)`, x, 1));
    parts.push(bearing(`bearing-${name}-b`, `Bearing ${name} (rear)`, x, -1));
  }

  // ---- Lubrication ----------------------------------------------------
  parts.push(
    part({
      id: "oil-sump",
      name: "Oil sump",
      layer: "lubrication",
      shape: "box",
      size: { width: housingLength * 0.8, height: 0.03, depth: faceWidth * 2.4 },
      position: [0, gearY - Math.max(r1, r2) - 0.12, 0],
      color: "#f2a541",
      metalness: 0.2,
      roughness: 0.8,
      opacity: 0.75,
      label: [0, gearY - Math.max(r1, r2) - 0.15, faceWidth],
      explode: [0, -0.5, 0],
      note: "Holds the oil the gears dip into.",
    }),
    part({
      id: "oil-nozzle",
      name: "Oil nozzle",
      layer: "lubrication",
      shape: "cylinder",
      size: { radius: 0.003, height: 0.06 },
      position: [x1 + housingLength * 0.15, gearY + Math.max(r1, r2) * 0.75, faceWidth * 0.6],
      rotation: [0, 0, 28],
      color: "#e0a13a",
      metalness: 0.5,
      label: [x1 + housingLength * 0.22, gearY + Math.max(r1, r2) * 0.9, faceWidth * 0.6],
      explode: [0.3, 0.3, 0.2],
      note: "Sprays oil onto the meshing teeth.",
    }),
  );

  const program: BuildProgram = {
    kind: "build",
    builder: "gearbox",
    domain: "mechanical",
    title: title ?? `Gear train — ${teethIn}:${teethOut}${hasIdler ? " with idler" : ""}`,
    params: values,
    paramSpecs: specs.map((spec) => ({ ...spec, value: values[spec.key] })),
    parts,
    layers: layersOf(LAYERS, parts),
    steps: [
      { id: "input", name: "1 · Input", summary: "Motor turns the input shaft", detail: `The input shaft turns at ${inputRpm} rpm and carries the ${teethIn}-tooth driver gear.`, focus: ["shaft-input", "gear-driver"] },
      ...(hasIdler
        ? [
            { id: "mesh-1", name: "2 · First mesh", summary: "Driver → idler", detail: `Driver (${teethIn} teeth) meshes with the idler (${teethIdler} teeth) at a centre distance of ${(c12 * 1000).toFixed(1)} mm. The idler turns at ${Math.abs(w2 / 6).toFixed(0)} rpm in the opposite direction.`, focus: ["gear-driver", "gear-idler"] },
            { id: "mesh-2", name: "3 · Second mesh", summary: "Idler → output", detail: `The idler drives the ${teethOut}-tooth output gear at ${(c23 * 1000).toFixed(1)} mm centre distance, restoring the original direction.`, focus: ["gear-idler", "gear-output"] },
          ]
        : [
            { id: "mesh-1", name: "2 · Mesh", summary: "Driver → output", detail: `Driver (${teethIn} teeth) meshes directly with the output gear (${teethOut} teeth) at ${(c12 * 1000).toFixed(1)} mm centre distance.`, focus: ["gear-driver", "gear-output"] },
          ]),
      { id: "output", name: `${hasIdler ? "4" : "3"} · Output`, summary: `${outRpm.toFixed(0)} rpm at the coupling`, detail: `The output shaft leaves at ${outRpm.toFixed(0)} rpm — a ${ratio.toFixed(2)}:1 reduction, because speed ratio is teethOut ÷ teethIn.`, focus: ["gear-output", "shaft-output", "coupling"] },
      { id: "lube", name: `${hasIdler ? "5" : "4"} · Lubrication`, summary: "Oil reaches the mesh", detail: "The gears dip into the sump and the nozzle sprays the mesh; bearings are fed from the same circuit.", focus: ["oil-sump", "oil-nozzle"] },
    ],
    derived: [
      { label: "Driver pitch radius", value: `${(r1 * 1000).toFixed(1)} mm` },
      { label: "Output pitch radius", value: `${(r2 * 1000).toFixed(1)} mm` },
      { label: "Centre distance", value: hasIdler ? `${((c12 + c23) * 1000).toFixed(1)} mm (${(c12 * 1000).toFixed(1)} + ${(c23 * 1000).toFixed(1)})` : `${(c12 * 1000).toFixed(1)} mm` },
      { label: "Ratio", value: `${ratio.toFixed(2)} : 1` },
      { label: "Output speed", value: `${outRpm.toFixed(0)} rpm` },
    ],
    scene: sceneOf(parts, {
      camera: { position: [housingLength * 0.9, gearY + Math.max(r1, r2) * 1.6, housingLength * 1.1], target: [0, gearY, 0], fov: 40 },
      seed: 4111,
      preset: "gearbox",
    }),
    notes: [
      "Every dimension follows from teeth count and module: pitch radius = module × teeth / 2, and two meshing gears sit at the sum of their pitch radii.",
      `The gears are drawn at their real tooth count (${teethIn}, ${hasIdler ? `${teethIdler}, ` : ""}${teethOut}) on a simplified tooth form — a schematic of a train, not a cutting drawing.`,
      `Turning the driver at ${inputRpm} rpm turns the output at ${outRpm.toFixed(0)} rpm; an idler changes direction, never the ratio.`,
    ],
  };

  return { ok: true, program, rejected };
}

export const gearboxBuilder = {
  id: "gearbox",
  domain: "mechanical" as const,
  label: "Gear train / gearbox",
  keywords: ["gearbox", "gear train", "gears", "gear", "transmission", "reduction", "drive train"],
  paramSpecs,
  build: buildGearbox,
};

export const mechanicalSubjects = {
  gearbox: gearboxBuilder,
  "gear train": gearboxBuilder,
  gears: gearboxBuilder,
  transmission: gearboxBuilder,
};

export function gearboxTitleFor(input: Record<string, unknown>): string {
  const teethIn = Number(input.teethIn ?? 14);
  const teethOut = Number(input.teethOut ?? 28);
  return `Gear train — ${teethIn}:${teethOut}${Number(input.teethIdler ?? 20) > 0 ? " with idler" : ""}`;
}

export function describeGearboxRequest(textInput: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // "16-tooth driver", "16 tooth driver", "16 driver teeth", "driver: 16" —
  // people write all four, and a tooth count is a fact worth reading either way.
  const count = (roles: string): number | undefined => {
    const n = `(\\d{1,2})`;
    const before = new RegExp(`\\b${n}\\s*(?:-|\\s)?(?:tooth|teeth)?\\s*(?:${roles})\\b`, "i").exec(textInput);
    if (before) return Number(before[1]);
    const after = new RegExp(`\\b(?:${roles})\\b[^\\d\\n]{0,14}${n}`, "i").exec(textInput);
    return after ? Number(after[1]) : undefined;
  };
  const teeth = count("driver|input");
  if (teeth !== undefined) out.teethIn = teeth;
  const big = count("output|driven");
  if (big !== undefined) out.teethOut = big;
  if (/\bno idler\b|\btwo gears?\b|\bdirect\b/i.test(textInput)) out.teethIdler = 0;
  const rpm = /\b(\d{3,5})\s*rpm\b/i.exec(textInput);
  if (rpm) out.inputRpm = Number(rpm[1]);
  return out;
}
