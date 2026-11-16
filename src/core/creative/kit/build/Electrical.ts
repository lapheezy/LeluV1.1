/**
 * LÉLU — BUILD ENGINE: an electrical circuit
 *
 * A series circuit that is actually calculated: resistor count and value set
 * the total resistance, Ohm's law gives the current, and V·I gives the power.
 * The geometry follows the calculation, not the other way round — the wire is
 * drawn between the battery, the resistors and the lamp in that order.
 *
 * These figures are arithmetic on the numbers you gave, nothing more: no
 * tolerance, no temperature, no real component model.
 */

import { part, sceneOf, layersOf, num, text, validateParams, type BuildOutcome, type BuildPart, type ParamSpec } from "./BuildTypes";

const LAYERS = [
  { id: "source", label: "Source", color: "#f2a541", note: "The battery: where the voltage comes from." },
  { id: "wiring", label: "Wiring", color: "#b98cff", note: "The conductors that close the loop." },
  { id: "components", label: "Components", color: "#67e8f9", note: "Resistors in series — the load." },
  { id: "switch", label: "Switch", color: "#9fb4c8", note: "Open means no current, whatever the voltage." },
  { id: "load", label: "Lamp", color: "#ffe08a", note: "What the current lights." },
];

function paramSpecs(input?: Record<string, unknown>): ParamSpec[] {
  const has = (k: string) => input !== undefined && typeof input[k] !== "undefined";
  return [
    { key: "volts", label: "Source voltage", kind: "number", value: has("volts") ? Number(input?.volts) : 9, min: 1.5, max: 48, step: 0.5, unit: "V", affects: "Current, power and the size of the lamp glow." },
    { key: "resistors", label: "Resistors", kind: "number", value: has("resistors") ? Number(input?.resistors) : 2, min: 1, max: 6, step: 1, affects: "How many loads sit in the loop, and the total resistance." },
    { key: "ohms", label: "Each resistor", kind: "number", value: has("ohms") ? Number(input?.ohms) : 100, min: 1, max: 10000, step: 1, unit: "Ω", affects: "Total resistance = resistors × this." },
    { key: "switchClosed", label: "Switch", kind: "choice", value: has("switchClosed") ? String(input?.switchClosed) : "closed", choices: ["closed", "open"], affects: "An open switch stops the current, so power is zero." },
  ];
}

export function buildCircuit(input?: Record<string, unknown>, title?: string): BuildOutcome {
  const specs = paramSpecs(input);
  const { values, rejected } = validateParams(specs, input);
  if (rejected.length) return { ok: false, reason: `${rejected.length} parameter${rejected.length === 1 ? "" : "s"} refused`, rejected };

  const volts = num(values, "volts", 9);
  const count = Math.round(num(values, "resistors", 2));
  const ohms = num(values, "ohms", 100);
  const closed = text(values, "switchClosed", "closed") === "closed";
  const totalOhms = count * ohms;
  const current = closed ? volts / totalOhms : 0;
  const power = current * current * totalOhms;
  const spacing = 0.118;

  const parts: BuildPart[] = [];
  const width = (count + 2) * spacing;

  parts.push(part({
    id: "battery", name: `Battery ${volts} V`, layer: "source", shape: "box",
    size: { width: 0.062, height: 0.092, depth: 0.032 },
    position: [-width / 2, 0, 0], color: "#f2a541", metalness: 0.5, roughness: 0.4,
    explode: [-0.12, -0.06, 0],
    note: `Provides ${volts} V; the long terminal is positive.`,
  }));

  // The loop: battery → resistors → switch → lamp → battery.
  const top = 0.09;
  const bottom = -0.09;
  let x = -width / 2 + spacing;
  for (let i = 0; i < count; i += 1) {
    const id = `resistor-${i + 1}`;
    parts.push(part({
      id, name: `Resistor R${i + 1}`, layer: "components", shape: "cylinder",
      size: { radius: 0.016, height: 0.055 },
      position: [x, top, 0], rotation: [0, 0, 90], color: "#67e8f9", metalness: 0.3, roughness: 0.5,
      explode: [0, 0.09, 0],
      note: `${ohms} Ω in series: the same ${(current * 1000).toFixed(1)} mA passes through every one.`,
    }));
    x += spacing;
  }

  parts.push(part({
    id: "switch", name: closed ? "Switch (closed)" : "Switch (open)", layer: "switch", shape: "box",
    size: { width: 0.05, height: 0.018, depth: 0.02 },
    position: [x, top, 0], color: closed ? "#7ee2b8" : "#f87171", metalness: 0.4, roughness: 0.4,
    explode: [0, 0.11, 0],
    note: closed ? "Closed: the loop is complete." : "Open: the loop is broken and the current is zero.",
  }));

  parts.push(part({
    id: "lamp", name: "Lamp", layer: "load", shape: "sphere",
    size: { radius: 0.034 },
    position: [x + spacing * 0.9, 0, 0], color: "#ffe08a", metalness: 0.1, roughness: 0.35,
    opacity: 1, emissive: "#ffd166", emissiveIntensity: closed ? Math.min(1, power / 2) : 0,
    explode: [0.08, 0.05, 0],
    note: closed ? `Dissipates ${power.toFixed(2)} W at ${current.toFixed(3)} A.` : "Dark: with the switch open it dissipates nothing.",
  }));

  const wire = (id: string, from: [number, number, number], to: [number, number, number], level: number) =>
    part({
      id, name: `Wire ${id.replace("wire-", "")}`, layer: "wiring", shape: "cylinder",
      size: { radius: 0.0035, height: Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) },
      position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      rotation: [0, 0, Math.abs(to[0] - from[0]) < 1e-9 ? 0 : 90], color: "#b98cff", metalness: 0.6, roughness: 0.3,
      explode: [0, level, 0],
      note: "A conductor: the return path matters as much as the supply.",
    });

  parts.push(wire("wire-1", [-width / 2, top, 0], [-width / 2 + spacing * 0.6, top, 0], 0.05));
  parts.push(wire("wire-2", [x, top, 0], [x + spacing * 0.9, top, 0], 0.05));
  parts.push(wire("wire-3", [x + spacing * 0.9, top, 0], [x + spacing * 0.9, bottom, 0], 0.05));
  parts.push(wire("wire-4", [x + spacing * 0.9, bottom, 0], [-width / 2, bottom, 0], 0.05));
  parts.push(wire("wire-5", [-width / 2, bottom, 0], [-width / 2, -0.02, 0], 0.05));

  const layers = layersOf(LAYERS, parts);

  return {
    ok: true,
    rejected: [],
    program: {
      kind: "build",
      builder: "circuit",
      domain: "electrical",
      title: title ?? `Series circuit — ${volts} V, ${count} × ${ohms} Ω`,
      params: values,
      paramSpecs: specs,
      parts,
      layers,
      steps: [
        { id: "source", name: "1 · Source", summary: `${volts} V`, detail: `The battery fixes the voltage across the whole loop: ${volts} V divides between the loads in series.`, focus: ["battery"] },
        { id: "series", name: "2 · Series", summary: `${count} × ${ohms} Ω`, detail: `Resistances in series add: ${count} × ${ohms} Ω = ${totalOhms} Ω.`, focus: Array.from({ length: count }, (_, i) => `resistor-${i + 1}`) },
        { id: "current", name: "3 · Current", summary: `${(current * 1000).toFixed(1)} mA`, detail: closed ? `Ohm's law: I = V / R = ${volts} / ${totalOhms} = ${current.toFixed(4)} A, the same through every element.` : "With the switch open the resistance is infinite, so the current is zero.", focus: ["switch", "lamp"] },
        { id: "power", name: "4 · Power", summary: `${power.toFixed(2)} W`, detail: `P = I²R = ${power.toFixed(3)} W, shared equally by the ${count} identical resistors.`, focus: ["lamp", "resistor-1"] },
      ],
      derived: [
        { label: "Total resistance", value: `${totalOhms} Ω` },
        { label: "Current", value: `${(current * 1000).toFixed(1)} mA` },
        { label: "Power", value: `${power.toFixed(2)} W` },
        { label: "Across each resistor", value: `${(current * ohms).toFixed(2)} V` },
        { label: "Loop", value: closed ? "closed" : "open — no current" },
      ],
      scene: sceneOf(parts, {
        camera: { position: [0, 0.24, width * 1.15], target: [0, 0, 0], fov: 42 },
        seed: 5201,
        preset: "circuit",
      }),
      notes: [
        "Current and power are Ohm's law on the values given: I = V / ΣR, P = I²R. No tolerance, temperature or component model is applied.",
        "A schematic: components are laid out topologically (in series), not to scale or to a board layout.",
      ],
      sources: [],
    },
  };
}

export const circuitBuilder = {
  id: "circuit",
  domain: "electrical" as const,
  label: "Circuit",
  blurb: "A series circuit: voltage, resistors and a switch, calculated with Ohm's law.",
  keywords: ["circuit", "electrical", "wiring", "resistor", "battery", "schematic", "electronics"],
  paramSpecs,
  build: (input?: Record<string, unknown>, title?: string) => buildCircuit(input, title),
  describe: (request: string) => describeCircuitRequest(request),
};

export function describeCircuitRequest(request: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const volts = /\b(\d+(?:\.\d+)?)\s*(?:v|volt|volts)\b/i.exec(request);
  if (volts) out.volts = Number(volts[1]);
  const ohms = /\b(\d+(?:\.\d+)?)\s*(?:ohm|ohms|Ω)\b/i.exec(request);
  if (ohms) out.ohms = Number(ohms[1]);
  const count = /\b(\d)\s*(?:resistors?|loads?)\b/i.exec(request);
  if (count) out.resistors = Number(count[1]);
  if (/\bopen switch|switch open|switched off\b/i.test(request)) out.switchClosed = "open";
  return out;
}
