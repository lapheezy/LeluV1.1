/**
 * ==========================================================
 * LÉLU — CREATIVE KIT: THE ENGINE EXPERIENCE
 *
 * One deterministic program for a single-cylinder four-stroke
 * internal combustion engine: every part with its layer, its
 * position in the assembly, where it sits when exploded, the
 * label anchor, and what it does. The strokes carry the timing
 * (valve lift, injection, ignition) so the viewer animates a
 * real cycle from the numbers here rather than from a model.
 *
 * The same parts are also emitted as a Scene3D program, so the
 * existing GLB/glTF exporter writes the assembly unchanged.
 * ==========================================================
 */

import type { Scene3DProgram, SceneObject } from "./Scene3D";

type Vec3 = [number, number, number];

export const ENGINE_LAYERS = [
  { id: "block", label: "Block & head", color: "#8e9aa8", note: "The structure that holds the bore, the head and every bearing." },
  { id: "piston", label: "Piston & crank", color: "#c0c4cc", note: "Rotation becomes a straight push: crank → rod → piston." },
  { id: "valvetrain", label: "Valvetrain", color: "#d4a94e", note: "The camshaft opens the valves at the right moment in the cycle." },
  { id: "fuel", label: "Fuel & ignition", color: "#e4572e", note: "Fuel is injected, the plug fires, and the charge burns." },
  { id: "air", label: "Intake & exhaust", color: "#4ea5e9", note: "Fresh charge in through the intake, burnt gas out through the exhaust." },
  { id: "cooling", label: "Cooling", color: "#2fb8ac", note: "Coolant carries combustion heat away through the radiator." },
  { id: "lubrication", label: "Lubrication", color: "#f2a541", note: "Oil is pumped to the bearings and the cylinder wall." },
  { id: "output", label: "Output", color: "#b98cff", note: "The flywheel smooths the single power pulse into steady rotation." },
] as const;

export type EngineLayerId = (typeof ENGINE_LAYERS)[number]["id"];

export interface EnginePart {
  id: string;
  name: string;
  layer: EngineLayerId;
  shape: "box" | "cylinder" | "cone" | "sphere" | "torus";
  /** Size parameters for the shape (metres, engine is ~0.55 m tall). */
  size: Record<string, number>;
  position: Vec3;
  /** Degrees. */
  rotation?: Vec3;
  color: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  /** Where the label points, in world space. */
  label: Vec3;
  /** Where this part moves to in the fully exploded view. */
  explode: Vec3;
  /** What it does, in one sentence. */
  note: string;
  /** Driven by the cycle rather than placed by hand. */
  moving?: "piston" | "rod" | "crank" | "cam" | "intakeValve" | "exhaustValve" | "injector" | "spark";
}

export interface EngineStroke {
  id: "intake" | "compression" | "power" | "exhaust";
  name: string;
  /** Crank-angle window, degrees, in firing order. */
  from: number;
  to: number;
  intakeValveLift: number;
  exhaustValveLift: number;
  injection: boolean;
  ignition: boolean;
  /** Which flow the viewer should animate. */
  flow: "air+fuel" | "none" | "combustion" | "exhaust";
  summary: string;
  detail: string;
}

export interface EngineProgram {
  kind: "engine";
  title: string;
  /** Crank geometry, for the piston kinematics. */
  geometry: { crankRadius: number; rodLength: number; boreRadius: number; strokeTravel: number };
  parts: EnginePart[];
  strokes: EngineStroke[];
  layers: Array<{ id: EngineLayerId; label: string; color: string; note: string; parts: string[] }>;
  /** Scene3D-compatible program, so GLB/glTF export works unchanged. */
  scene: Scene3DProgram;
  notes: string[];
}

const C = {
  block: "#8e9aa8",
  head: "#9aa5b1",
  piston: "#c0c4cc",
  rod: "#a8b0bb",
  crank: "#7f8b98",
  cam: "#d4a94e",
  valve: "#e0c26a",
  plug: "#e6e9ee",
  fuel: "#e4572e",
  intake: "#4ea5e9",
  exhaust: "#b06a52",
  cooling: "#2fb8ac",
  oil: "#f2a541",
  fly: "#b98cff",
};

/** One part, with the defaults that make the assembly readable. */
function part(p: EnginePart): EnginePart {
  return { metalness: 0.35, roughness: 0.45, ...p };
}

export function engineParts(): EnginePart[] {
  const R = 0.05; // crank radius (half the stroke)
  const L = 0.16; // connecting rod length
  return [
    // ---- Block & head -------------------------------------------------
    part({ id: "block", name: "Cylinder block", layer: "block", shape: "box", size: { width: 0.2, height: 0.26, depth: 0.2 }, position: [0, 0, 0], color: C.block, note: "The casting that carries the bore, the crankcase and the coolant jacket.", label: [-0.1, 0.06, 0.1], explode: [-0.34, 0, 0] }),
    part({ id: "liner", name: "Cylinder liner (bore)", layer: "block", shape: "cylinder", size: { radius: 0.062, height: 0.24 }, position: [0, 0.02, 0], color: "#c8ced6", metalness: 0.6, roughness: 0.2, note: "The honed bore the piston slides in; its wall is what the rings seal against.", label: [0.08, 0.1, 0.02], explode: [-0.34, 0.02, 0] }),
    part({ id: "head", name: "Cylinder head", layer: "block", shape: "box", size: { width: 0.21, height: 0.09, depth: 0.21 }, position: [0, 0.2, 0], color: C.head, note: "Closes the cylinder and holds the valves, the camshaft, the plug and the injector.", label: [-0.1, 0.24, 0.1], explode: [-0.34, 0.26, 0] }),
    part({ id: "gasket", name: "Head gasket", layer: "block", shape: "box", size: { width: 0.215, height: 0.006, depth: 0.215 }, position: [0, 0.152, 0], color: "#d76a5a", metalness: 0.1, roughness: 0.9, note: "Seals the joint between block and head against compression and coolant.", label: [0.1, 0.15, -0.1], explode: [-0.2, 0.16, 0] }),
    part({ id: "sump", name: "Oil sump", layer: "lubrication", shape: "box", size: { width: 0.19, height: 0.07, depth: 0.19 }, position: [0, -0.16, 0], color: C.oil, metalness: 0.2, roughness: 0.7, note: "Holds the oil supply the pump draws from.", label: [0.09, -0.16, 0.09], explode: [0, -0.2, 0] }),

    // ---- Piston, rod, crank -------------------------------------------
    part({ id: "piston", name: "Piston", layer: "piston", shape: "cylinder", size: { radius: 0.06, height: 0.07 }, position: [0, 0.05, 0], color: C.piston, metalness: 0.55, roughness: 0.3, note: "Seals the charge and takes the combustion push down the bore.", label: [0.09, 0.07, 0.02], explode: [0.3, 0.1, 0], moving: "piston" }),
    part({ id: "rings", name: "Piston rings", layer: "piston", shape: "torus", size: { radius: 0.06, tube: 0.0045 }, position: [0, 0.075, 0], rotation: [90, 0, 0], color: "#9aa5b1", metalness: 0.7, roughness: 0.3, note: "Spring against the bore: compression seal, oil control.", label: [0.08, 0.085, 0.02], explode: [0.3, 0.13, 0], moving: "piston" }),
    part({ id: "pin", name: "Wrist pin", layer: "piston", shape: "cylinder", size: { radius: 0.012, height: 0.11 }, position: [0, 0.035, 0], rotation: [0, 0, 90], color: "#cfd5dd", metalness: 0.8, roughness: 0.2, note: "The joint between piston and connecting rod.", label: [0.06, 0.03, 0.05], explode: [0.3, 0.03, 0], moving: "piston" }),
    part({ id: "rod", name: "Connecting rod", layer: "piston", shape: "box", size: { width: 0.028, height: L, depth: 0.02 }, position: [0, -0.03, 0], color: C.rod, metalness: 0.6, note: "Converts the piston's straight travel into crank rotation.", label: [0.07, -0.03, 0.02], explode: [0.32, -0.02, 0], moving: "rod" }),
    part({ id: "crank", name: "Crankshaft", layer: "piston", shape: "cylinder", size: { radius: 0.018, height: 0.3 }, position: [0, -0.145, 0], rotation: [0, 0, 90], color: C.crank, metalness: 0.75, roughness: 0.25, note: "The output shaft: each power stroke turns it half a revolution.", label: [0.11, -0.145, 0.06], explode: [0.02, -0.3, 0], moving: "crank" }),
    part({ id: "crankpin", name: "Crank pin & web", layer: "piston", shape: "cylinder", size: { radius: 0.02, height: 0.055 }, position: [0, -0.145 + R, 0], rotation: [0, 0, 90], color: "#95a1ad", metalness: 0.7, note: "Offset from the axis by the crank radius — that offset IS the stroke.", label: [0.04, -0.09, 0.08], explode: [0.02, -0.24, 0.06], moving: "crank" }),
    part({ id: "flywheel", name: "Flywheel", layer: "output", shape: "cylinder", size: { radius: 0.11, height: 0.02 }, position: [0.16, -0.145, 0], rotation: [0, 0, 90], color: C.fly, metalness: 0.5, note: "Stores the power stroke's energy and carries the engine through the other three.", label: [0.2, -0.09, 0], explode: [0.26, -0.145, 0], moving: "crank" }),

    // ---- Valvetrain ---------------------------------------------------
    part({ id: "camshaft", name: "Camshaft", layer: "valvetrain", shape: "cylinder", size: { radius: 0.012, height: 0.2 }, position: [0, 0.25, -0.02], rotation: [0, 0, 90], color: C.cam, metalness: 0.7, note: "Turns at half crank speed; its lobes push the valves open.", label: [-0.08, 0.28, -0.02], explode: [-0.3, 0.34, -0.06], moving: "cam" }),
    part({ id: "intakeCam", name: "Intake cam lobe", layer: "valvetrain", shape: "cylinder", size: { radius: 0.021, height: 0.016 }, position: [-0.04, 0.25, 0.045], rotation: [0, 0, 90], color: "#e0c26a", metalness: 0.7, note: "Lifts the intake valve just before top dead centre.", label: [-0.04, 0.26, 0.09], explode: [-0.24, 0.34, 0.05], moving: "cam" }),
    part({ id: "exhaustCam", name: "Exhaust cam lobe", layer: "valvetrain", shape: "cylinder", size: { radius: 0.021, height: 0.016 }, position: [0.04, 0.25, -0.045], rotation: [0, 0, 90], color: "#e0c26a", metalness: 0.7, note: "Lifts the exhaust valve before bottom dead centre of the power stroke.", label: [0.05, 0.26, -0.09], explode: [-0.16, 0.34, -0.08], moving: "cam" }),
    part({ id: "intakeValve", name: "Intake valve", layer: "valvetrain", shape: "cylinder", size: { radius: 0.011, height: 0.075 }, position: [-0.04, 0.2, 0.045], color: C.valve, metalness: 0.7, note: "Opens the intake port for the full intake stroke.", label: [-0.04, 0.21, 0.1], explode: [-0.24, 0.24, 0.08], moving: "intakeValve" }),
    part({ id: "exhaustValve", name: "Exhaust valve", layer: "valvetrain", shape: "cylinder", size: { radius: 0.011, height: 0.075 }, position: [0.04, 0.2, -0.045], color: "#d9b48f", metalness: 0.7, note: "Opens the exhaust port so burnt gas leaves.", label: [0.05, 0.21, -0.1], explode: [-0.16, 0.24, -0.1], moving: "exhaustValve" }),
    part({ id: "springs", name: "Valve springs", layer: "valvetrain", shape: "cylinder", size: { radius: 0.014, height: 0.03 }, position: [0, 0.225, 0.045], color: "#c8ced6", metalness: 0.6, roughness: 0.4, note: "Close each valve again as the cam lobe turns away.", label: [0.08, 0.23, 0.05], explode: [-0.1, 0.28, 0.06] }),
    part({ id: "timingGear", name: "Timing drive", layer: "valvetrain", shape: "torus", size: { radius: 0.045, tube: 0.008 }, position: [-0.14, 0.19, -0.02], rotation: [0, 0, 90], color: "#a9b3bf", metalness: 0.7, note: "Keeps cam and crank locked at the 2:1 ratio the cycle needs.", label: [-0.18, 0.19, -0.02], explode: [-0.34, 0.2, -0.02] }),

    // ---- Fuel & ignition ----------------------------------------------
    part({ id: "injector", name: "Fuel injector", layer: "fuel", shape: "cylinder", size: { radius: 0.008, height: 0.055 }, position: [0.045, 0.235, 0.02], rotation: [18, 0, 0], color: C.fuel, metalness: 0.5, roughness: 0.35, note: "Meters atomised fuel into the intake port once per cycle.", label: [0.06, 0.26, 0.02], explode: [0.16, 0.36, 0.02], moving: "injector" }),
    part({ id: "sparkplug", name: "Spark plug", layer: "fuel", shape: "cylinder", size: { radius: 0.007, height: 0.06 }, position: [-0.045, 0.245, -0.02], color: C.plug, metalness: 0.6, roughness: 0.3, note: "Fires a spark just before top dead centre to start combustion.", label: [-0.06, 0.28, -0.02], explode: [-0.08, 0.38, -0.03], moving: "spark" }),
    part({ id: "chamber", name: "Combustion chamber", layer: "fuel", shape: "sphere", size: { radius: 0.042 }, position: [0, 0.16, 0], color: "#ff7a45", emissive: "#ff4d1f", emissiveIntensity: 0, opacity: 0.55, note: "Where the burning charge pushes the piston down.", label: [0.02, 0.17, 0.08], explode: [0.06, 0.2, 0.06] }),

    // ---- Air & exhaust -------------------------------------------------
    part({ id: "intakeManifold", name: "Intake manifold", layer: "air", shape: "box", size: { width: 0.055, height: 0.07, depth: 0.05 }, position: [-0.14, 0.21, 0.045], color: C.intake, metalness: 0.3, roughness: 0.6, note: "Ducts filtered air to the intake valve.", label: [-0.16, 0.25, 0.05], explode: [-0.4, 0.26, 0.1] }),
    part({ id: "throttle", name: "Throttle body", layer: "air", shape: "cylinder", size: { radius: 0.026, height: 0.03 }, position: [-0.19, 0.21, 0.045], rotation: [0, 0, 90], color: "#3f8fc4", metalness: 0.4, note: "Sets how much air the engine can take in.", label: [-0.22, 0.24, 0.05], explode: [-0.44, 0.26, 0.1] }),
    part({ id: "filter", name: "Air filter", layer: "air", shape: "box", size: { width: 0.06, height: 0.05, depth: 0.06 }, position: [-0.25, 0.21, 0.045], color: "#6fb7e0", metalness: 0.1, roughness: 0.9, note: "Stops dust before it reaches the bore.", label: [-0.27, 0.24, 0.05], explode: [-0.5, 0.26, 0.1] }),
    part({ id: "exhaustManifold", name: "Exhaust manifold", layer: "air", shape: "box", size: { width: 0.06, height: 0.07, depth: 0.05 }, position: [-0.14, 0.21, -0.05], color: C.exhaust, metalness: 0.35, roughness: 0.65, note: "Collects burnt gas from the exhaust valve.", label: [-0.16, 0.25, -0.06], explode: [-0.4, 0.26, -0.14] }),
    part({ id: "pipe", name: "Exhaust pipe", layer: "air", shape: "cylinder", size: { radius: 0.018, height: 0.1 }, position: [-0.21, 0.19, -0.05], rotation: [0, 0, 90], color: "#93604a", metalness: 0.4, note: "Carries the gas away to the silencer.", label: [-0.25, 0.22, -0.06], explode: [-0.48, 0.24, -0.16] }),

    // ---- Cooling -------------------------------------------------------
    part({ id: "radiator", name: "Radiator", layer: "cooling", shape: "box", size: { width: 0.04, height: 0.18, depth: 0.16 }, position: [0.27, 0.02, 0], color: C.cooling, metalness: 0.3, roughness: 0.6, note: "Rejects the heat the coolant picked up in the block.", label: [0.3, 0.06, 0.06], explode: [0.56, 0, 0] }),
    part({ id: "hoses", name: "Coolant hoses", layer: "cooling", shape: "cylinder", size: { radius: 0.008, height: 0.2 }, position: [0.2, 0.1, 0], rotation: [0, 0, 62], color: "#1f8f88", metalness: 0.1, roughness: 0.85, note: "Loop coolant between block and radiator.", label: [0.23, 0.12, 0.04], explode: [0.4, 0.12, 0.06] }),
    part({ id: "waterPump", name: "Water pump", layer: "cooling", shape: "cylinder", size: { radius: 0.028, height: 0.035 }, position: [0.14, 0.06, -0.06], rotation: [90, 0, 0], color: "#2aa39a", metalness: 0.5, note: "Circulates coolant whenever the engine turns.", label: [0.16, 0.08, -0.09], explode: [0.32, 0.06, -0.14] }),

    // ---- Lubrication ---------------------------------------------------
    part({ id: "oilPump", name: "Oil pump", layer: "lubrication", shape: "cylinder", size: { radius: 0.024, height: 0.03 }, position: [0.1, -0.16, 0.05], rotation: [0, 0, 90], color: C.oil, metalness: 0.5, note: "Pressurises oil from the sump to every bearing.", label: [0.13, -0.13, 0.06], explode: [0.2, -0.24, 0.1] }),
    part({ id: "oilFilter", name: "Oil filter", layer: "lubrication", shape: "cylinder", size: { radius: 0.026, height: 0.05 }, position: [0.11, -0.19, -0.05], color: "#e0a13a", metalness: 0.4, note: "Traps wear particles before the oil reaches the bearings.", label: [0.15, -0.2, -0.06], explode: [0.24, -0.3, -0.1] }),
    part({ id: "galleries", name: "Oil galleries", layer: "lubrication", shape: "cylinder", size: { radius: 0.005, height: 0.22 }, position: [0.06, -0.02, 0.06], rotation: [8, 0, 0], color: "#c98f2f", metalness: 0.5, roughness: 0.5, note: "Drilled passages that feed the main and cam bearings.", label: [0.09, 0.0, 0.07], explode: [0.16, 0.02, 0.12] }),
  ];
}

export function engineStrokes(): EngineStroke[] {
  return [
    { id: "intake", name: "1 · Intake", from: 0, to: 180, intakeValveLift: 1, exhaustValveLift: 0, injection: true, ignition: false, flow: "air+fuel", summary: "Piston down, intake valve open", detail: "The piston travels from top dead centre to bottom dead centre. The intake valve is held open by its cam lobe, the injector adds fuel, and the descending piston draws the air–fuel charge into the cylinder." },
    { id: "compression", name: "2 · Compression", from: 180, to: 360, intakeValveLift: 0, exhaustValveLift: 0, injection: false, ignition: false, flow: "none", summary: "Piston up, both valves shut", detail: "Both valves are closed and the rising piston squeezes the charge into the combustion chamber. Compression ratio (here about 10:1) is what makes the burn fast and forceful." },
    { id: "power", name: "3 · Combustion / power", from: 360, to: 540, intakeValveLift: 0, exhaustValveLift: 0, injection: false, ignition: true, flow: "combustion", summary: "Spark, burn, piston forced down", detail: "Just before top dead centre the plug fires. The burning charge expands, driving the piston down and turning the crankshaft — the only stroke that produces work." },
    { id: "exhaust", name: "4 · Exhaust", from: 540, to: 720, intakeValveLift: 0, exhaustValveLift: 1, injection: false, ignition: false, flow: "exhaust", summary: "Piston up, exhaust valve open", detail: "The exhaust valve opens and the rising piston pushes the burnt gas out through the manifold and pipe. Then the cycle begins again." },
  ];
}

/** Convert the assembly into a Scene3D program (so GLB/glTF export is the same code path). */
export function engineScene(parts: EnginePart[]): Scene3DProgram {
  const objects: SceneObject[] = parts.map((p) => ({
    id: p.id,
    shape: p.shape,
    position: p.position,
    rotation: p.rotation ?? [0, 0, 0],
    scale: [1, 1, 1],
    color: p.color,
    metalness: p.metalness ?? 0.35,
    roughness: p.roughness ?? 0.45,
    opacity: p.opacity ?? 1,
    emissive: p.emissive,
    emissiveIntensity: p.emissiveIntensity,
    size: p.size,
  }));
  return {
    background: "#07060f",
    camera: { position: [0.75, 0.45, 0.85], target: [0, 0.05, 0], fov: 38 },
    lights: [
      { type: "hemisphere", color: "#cfd8ff", intensity: 0.5, position: [0, 1, 0], ground: "#1b1330" },
      { type: "directional", color: "#ffffff", intensity: 1.7, position: [1.2, 1.8, 1.4] },
      { type: "directional", color: "#b98cff", intensity: 0.6, position: [-1.4, 0.6, -1.2] },
    ],
    objects,
    duration: 3,
    seed: 19714,
    preset: "engine",
  };
}

export function buildEngineProgram(title = "Four-stroke engine — interactive assembly"): EngineProgram {
  const parts = engineParts();
  const strokes = engineStrokes();
  const layers = ENGINE_LAYERS.map((layer) => ({
    id: layer.id,
    label: layer.label,
    color: layer.color,
    note: layer.note,
    parts: parts.filter((p) => p.layer === layer.id).map((p) => p.id),
  }));
  return {
    kind: "engine",
    title,
    geometry: { crankRadius: 0.05, rodLength: 0.16, boreRadius: 0.062, strokeTravel: 0.1 },
    parts,
    strokes,
    layers,
    scene: engineScene(parts),
    notes: [
      "Every part is its own object: toggle a layer to isolate it, or explode the whole assembly and inspect one component at a time.",
      "The cycle is real kinematics: crank angle drives piston height through the slider-crank equation, and cam timing drives valve lift.",
      "It is one cylinder shown honestly — the same parts repeat on a multi-cylinder engine, sharing crank, cam and cooling circuit.",
    ],
  };
}

/** Piston height (from the crank axis) at a crank angle, in metres. */
export function pistonHeight(degrees: number, crankRadius: number, rodLength: number): number {
  const theta = (degrees * Math.PI) / 180;
  return crankRadius * Math.cos(theta) + Math.sqrt(rodLength * rodLength - (crankRadius * Math.sin(theta)) ** 2);
}

/** Which stroke a crank angle sits in. */
export function strokeAt(degrees: number, strokes: EngineStroke[]): EngineStroke {
  const angle = ((degrees % 720) + 720) % 720;
  return strokes.find((stroke) => angle >= stroke.from && angle < stroke.to) ?? strokes[0];
}

/** How far through its own window a stroke is, 0…1. */
export function strokeProgress(degrees: number, stroke: EngineStroke): number {
  const angle = ((degrees % 720) + 720) % 720;
  return Math.min(1, Math.max(0, (angle - stroke.from) / (stroke.to - stroke.from)));
}
