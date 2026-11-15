/**
 * LÉLU — BUILD ENGINE: the registry
 *
 * One place that knows which domains can be constructed, resolves a request
 * to a builder, validates the parameters through that builder's own surface,
 * and applies a modification by rebuilding from the previous parameters.
 *
 * Modification is deliberately a rebuild, not a patch: the artifact keeps its
 * id and gains a revision, and every dependent dimension is recomputed, so a
 * changed gear really moves its shaft and lengthens the housing.
 */

import {
  diffPrograms,
  num,
  type BuildBuilder,
  type BuildOutcome,
  type BuildProgram,
  type Rejection,
} from "./BuildTypes";
import { cabinBuilder, describeCabinRequest } from "./Architecture";
import { gearboxBuilder, describeGearboxRequest } from "./Mechanical";
import { moleculeBuilder, describeMoleculeRequest } from "./Science";
import { v8Builder, describeV8Request } from "./V8";
import { circuitBuilder, describeCircuitRequest } from "./Electrical";
import { cellBuilder, describeCellRequest } from "./Biology";
import { fabricBuilder, describeFabricRequest } from "./Textiles";
import { furnitureBuilder, describeFurnitureRequest } from "./Furniture";
import { garmentBuilder, describeGarmentRequest } from "./Garment";

export const BUILDERS: BuildBuilder[] = [gearboxBuilder, v8Builder, cabinBuilder, moleculeBuilder, circuitBuilder, cellBuilder, fabricBuilder, furnitureBuilder, garmentBuilder];

export function builderById(id: string): BuildBuilder | undefined {
  return BUILDERS.find((b) => b.id === id.toLowerCase());
}

export function builderForDomain(domain: string): BuildBuilder[] {
  return BUILDERS.filter((b) => b.domain === domain);
}

/**
 * Which builder a phrase is asking for.
 *
 * Longest keyword wins, so "water molecule" is not read as "water" and
 * "gear train" beats "gear". Returns undefined when nothing matches — the
 * caller must say so rather than picking a default.
 */
export function findBuilder(subject: string): BuildBuilder | undefined {
  const text = subject.toLowerCase();
  let best: { builder: BuildBuilder; length: number } | null = null;
  for (const builder of BUILDERS) {
    for (const keyword of builder.keywords) {
      if (!text.includes(keyword)) continue;
      if (!best || keyword.length > best.length) best = { builder, length: keyword.length };
    }
  }
  return best?.builder;
}

export function buildWith(builder: BuildBuilder, params: Record<string, unknown>, title?: string): BuildOutcome {
  return builder.build(params, title);
}

/**
 * Rebuild an existing program with changes applied to its own parameters.
 *
 * The builder is chosen by the program's recorded id (not by its title), so a
 * renamed artifact still modifies the thing it was. Unknown keys are rejected
 * by the builder's validator and reported, never silently dropped.
 */
export function modifyProgram(
  previous: BuildProgram,
  changes: Record<string, unknown>,
): { ok: boolean; program?: BuildProgram; reason?: string; rejected: Rejection[]; changes: string[] } {
  const builder = builderById(previous.builder);
  if (!builder) return { ok: false, reason: `this artifact was built by “${previous.builder}”, which is not registered any more`, rejected: [], changes: [] };
  const merged: Record<string, unknown> = { ...previous.params };
  for (const [key, value] of Object.entries(changes)) merged[key] = value;
  const outcome = builder.build(merged, previous.title);
  if (!outcome.ok || !outcome.program) {
    return { ok: false, reason: outcome.reason ?? "the builder refused the change", rejected: outcome.rejected, changes: [] };
  }
  // A builder may normalise a value (teeth counts round, steps snap); compare
  // what was asked with what was actually built and report the real change.
  const changed = new Set<string>();
  for (const [key, value] of Object.entries(changes)) {
    if (String(previous.params[key]) !== String(outcome.program.params[key])) changed.add(key);
    else if (String(value) !== String(outcome.program.params[key])) changed.add(key);
  }
  if (changed.size === 0 && diffPrograms(previous, outcome.program).length === 0) {
    return { ok: false, reason: "nothing changed — those values are already what the artifact has", rejected: outcome.rejected, changes: [] };
  }
  return {
    ok: true,
    program: outcome.program,
    rejected: outcome.rejected,
    changes: diffPrograms(previous, outcome.program),
  };
}

/* ------------------------------------------------------------------ *
 * Turning a sentence into parameter changes
 * ------------------------------------------------------------------ */

export interface ParsedModification {
  changes: Record<string, unknown>;
  /** The words that produced each change, for an honest explanation. */
  because: string[];
  /** Things the sentence asked for that this builder cannot do. */
  unsupported: string[];
}

const GEAR_BUMP = 4;

/**
 * Reads a modification request against a program's own parameter surface.
 *
 * Only words that map to a parameter are acted on; the rest is reported as
 * unsupported instead of being ignored, because "bigger" means nothing on a
 * cabin's bay count.
 */
export function parseModification(text: string, program: BuildProgram): ParsedModification {
  const lower = text.toLowerCase();
  const changes: Record<string, unknown> = {};
  const because: string[] = [];
  const unsupported: string[] = [];
  const builder = program.builder;

  // Explicit assignments first: "teethOut=32", "set storeys to 2".
  for (const spec of program.paramSpecs) {
    const key = spec.key.toLowerCase();
    const eq = new RegExp(`\\b${key}\\s*=\\s*([\\w.]+)`, "i").exec(text);
    const say = new RegExp(`\\b${key}\\s+(?:to|=)\\s+([\\w.]+)`, "i").exec(text);
    const match = eq ?? say;
    if (!match) continue;
    changes[spec.key] = spec.kind === "number" ? Number(match[1]) : match[1];
    because.push(`${spec.label} explicitly set to ${match[1]}`);
  }

  if (builder === "gearbox") {
    if (/\b(no idler|two gears?|direct drive|without (the )?idler|remove (the )?idler|drop (the )?idler)\b/.test(lower) && !("teethIdler" in changes)) {
      changes.teethIdler = 0;
      because.push("no idler: a direct two-gear mesh");
    }
    if (/\b(add|with|include) (an )?idler\b/.test(lower) && !("teethIdler" in changes)) {
      changes.teethIdler = Math.max(10, Math.round(num(program.params as never, "teethIdler", 0)) || 20);
      because.push("an idler gear added between driver and output");
    }
    const bigger = /\b(bigger|larger|increase|more torque|slower output|reduce speed)\b/.test(lower);
    const smaller = /\b(smaller|decrease|less torque|faster output|increase speed)\b/.test(lower);
    if ((bigger || smaller) && !("teethOut" in changes) && !("teethIn" in changes)) {
      const current = Number(program.params.teethOut ?? 28);
      const next = Math.max(10, Math.min(60, current + (bigger ? GEAR_BUMP : -GEAR_BUMP)));
      changes.teethOut = next;
      because.push(`${bigger ? "larger" : "smaller"} output gear: ${current} → ${next} teeth (the ratio follows)`);
    }
    if (/\b(wider|thicker)\b/.test(lower) && !("faceWidth" in changes)) {
      changes.faceWidth = Math.min(0.032, Number(program.params.faceWidth ?? 0.016) + 0.004);
      because.push("wider face");
    }
    const rpm = /\b(\d{3,5})\s*rpm\b/.exec(lower);
    if (rpm && !("inputRpm" in changes)) {
      changes.inputRpm = Number(rpm[1]);
      because.push(`input speed ${rpm[1]} rpm`);
    }
    void program;
  }

  if (builder === "cabin") {
    if (/\b(taller|another floor|extra storey|more storeys)\b/.test(lower) && !("storeys" in changes)) {
      changes.storeys = Math.min(3, Number(program.params.storeys ?? 1) + 1);
      because.push(`one more storey (${program.params.storeys} → ${changes.storeys})`);
    }
    if (/\b(one storey|single storey|shorter|fewer storeys)\b/.test(lower) && !("storeys" in changes)) {
      changes.storeys = 1;
      because.push("a single storey");
    }
    if (/\b(wider)\b/.test(lower) && !("width" in changes)) {
      changes.width = Math.min(12, Number(program.params.width ?? 6) + 1);
      because.push(`wider (${program.params.width} → ${changes.width} m)`);
    }
    if (/\b(deeper)\b/.test(lower) && !("depth" in changes)) {
      changes.depth = Math.min(9, Number(program.params.depth ?? 4.5) + 0.5);
      because.push(`deeper (${program.params.depth} → ${changes.depth} m)`);
    }
    if (/\bmore bays\b/.test(lower) && !("bays" in changes)) {
      changes.bays = Math.min(5, Number(program.params.bays ?? 3) + 1);
      because.push(`one more bay (${program.params.bays} → ${changes.bays})`);
    }
    if (/\b(steeper|higher pitch|steeper roof)\b/.test(lower) && !("roofPitch" in changes)) {
      changes.roofPitch = Math.min(45, Number(program.params.roofPitch ?? 25) + 10);
      because.push(`steeper roof (${program.params.roofPitch}° → ${changes.roofPitch}°)`);
    }
    if (/\b(shallower|lower (the )?pitch|flatter roof)\b/.test(lower) && !("roofPitch" in changes)) {
      changes.roofPitch = Math.max(5, Number(program.params.roofPitch ?? 25) - 10);
      because.push(`flatter roof (${program.params.roofPitch}° → ${changes.roofPitch}°)`);
    }
  }

  if (builder === "molecule") {
    if (/space[- ]filling/.test(lower) && !("style" in changes)) {
      changes.style = "space-filling";
      because.push("space-filling model");
    }
    if (/ball[- ]and[- ]stick/.test(lower) && !("style" in changes)) {
      changes.style = "ball-and-stick";
      because.push("ball-and-stick model");
    }
    for (const id of ["water", "methane", "ammonia", "benzene"]) {
      if (new RegExp(`\\b${id}\\b`).test(lower) && id !== String(program.params.molecule)) {
        changes.molecule = id;
        because.push(`${id} instead`);
      }
    }
    const bigger = /\b(bigger|larger|increase)\b/.test(lower);
    const smaller = /\b(smaller|decrease|compact)\b/.test(lower);
    if ((bigger || smaller) && !("bondScale" in changes)) {
      changes.bondScale = Math.max(0.6, Math.min(1.8, Number(program.params.bondScale ?? 1) + (bigger ? 0.2 : -0.2)));
      because.push(`${bigger ? "longer" : "shorter"} bonds`);
    }
  }

  if (builder === "v8") {
    const next = (key: string, delta: number, min: number, max: number) => Math.min(max, Math.max(min, Number(program.params[key] ?? 0) + delta));
    if (/\b(bigger|larger|more power|increase displacement)\b/.test(lower) && !("bore" in changes)) {
      changes.bore = next("bore", 0.004, 0.06, 0.13);
      changes.stroke = next("stroke", 0.004, 0.05, 0.12);
      because.push(`longer stroke and wider bore (${program.params.bore} × ${program.params.stroke} m)`);
    }
    if (/\b(narrower|tighter) (the )?v\b|\b(60|75)\s*(?:°|deg)/.test(lower) && !("vAngle" in changes)) {
      changes.vAngle = Math.max(45, Number(program.params.vAngle ?? 90) - 30);
      because.push(`narrower V (${program.params.vAngle}° → ${changes.vAngle}°)`);
    }
    if (/\b(wider|broader) (the )?v\b/.test(lower) && !("vAngle" in changes)) {
      changes.vAngle = Math.min(120, Number(program.params.vAngle ?? 90) + 15);
      because.push(`wider V (${program.params.vAngle}° → ${changes.vAngle}°)`);
    }
    if (/\bmore cylinders\b/.test(lower) && !("cylindersPerBank" in changes)) {
      changes.cylindersPerBank = Math.min(6, Number(program.params.cylindersPerBank ?? 4) + 1);
      because.push(`one more cylinder per bank (${program.params.cylindersPerBank} → ${changes.cylindersPerBank})`);
    }
  }

  if (builder === "circuit") {
    const volts = /\b(\d+(?:\.\d+)?)\s*(?:v|volts?)\b/.exec(lower);
    if (volts && !("volts" in changes)) {
      changes.volts = Number(volts[1]);
      because.push(`source ${volts[1]} V`);
    }
    if (/\b(open|switch off|off)\b/.test(lower) && !("switchClosed" in changes)) {
      changes.switchClosed = "open";
      because.push("the switch is open, so no current flows");
    }
    if (/\b(closed|switch on|switch it on)\b/.test(lower) && !("switchClosed" in changes)) {
      changes.switchClosed = "closed";
      because.push("the switch is closed and the loop is complete");
    }
    if (/\b(more|another) resistor\b/.test(lower) && !("resistors" in changes)) {
      changes.resistors = Math.min(6, Number(program.params.resistors ?? 2) + 1);
      because.push(`one more resistor (${program.params.resistors} → ${changes.resistors})`);
    }
  }

  if (builder === "cell") {
    if (/\b(bigger|larger)\b/.test(lower) && !("radius" in changes)) {
      changes.radius = Math.min(0.08, Number(program.params.radius ?? 0.03) * 1.3);
      because.push(`a larger cell (radius ${program.params.radius} → ${changes.radius} m)`);
    }
    if (/\b(smaller|compact)\b/.test(lower) && !("radius" in changes)) {
      changes.radius = Math.max(0.008, Number(program.params.radius ?? 0.03) / 1.3);
      because.push(`a smaller cell (radius ${program.params.radius} → ${changes.radius} m)`);
    }
    if (/\bmore mitochondri/i.test(lower) && !("mitochondria" in changes)) {
      changes.mitochondria = Math.min(16, Number(program.params.mitochondria ?? 6) + 2);
      because.push(`more mitochondria (${program.params.mitochondria} → ${changes.mitochondria})`);
    }
  }

  if (builder === "fabric") {
    for (const weave of ["plain", "twill", "satin"]) {
      if (new RegExp(`\\b${weave}\\b`).test(lower) && weave !== String(program.params.weave)) {
        changes.weave = weave;
        because.push(`${weave} weave instead`);
      }
    }
    if (/\b(denser|more ends|tighter)\b/.test(lower) && !("density" in changes)) {
      changes.density = Math.min(60, Number(program.params.density ?? 24) + 8);
      because.push(`denser cloth (${program.params.density} → ${changes.density} ends/cm)`);
    }
    if (/\b(looser|more open|airier)\b/.test(lower) && !("density" in changes)) {
      changes.density = Math.max(8, Number(program.params.density ?? 24) - 8);
      because.push(`more open cloth (${program.params.density} → ${changes.density} ends/cm)`);
    }
    if (/\b(bigger|wider|larger)\b/.test(lower) && !("threads" in changes)) {
      changes.threads = Math.min(22, Number(program.params.threads ?? 10) + 4);
      changes.rows = Math.min(22, Number(program.params.rows ?? 10) + 4);
      because.push(`a larger panel (${program.params.threads}×${program.params.rows} → ${changes.threads}×${changes.rows})`);
    }
  }

  if (builder === "furniture") {
    const grow = (key: string, delta: number, min: number, max: number, why: string) => {
      if (key in changes) return;
      changes[key] = Math.min(max, Math.max(min, Number(program.params[key] ?? 0) + delta));
      because.push(why);
    };
    if (/\b(taller|higher)\b/.test(lower) && !/\bseat\b/.test(lower)) {
      grow("height", 0.08, 0.3, 2.2, `taller (${program.params.height} → ${Number(program.params.height ?? 0) + 0.08} m)`);
      if (!("seatHeight" in changes)) grow("seatHeight", 0.03, 0.28, 1.1, "and the seat rises with it");
    }
    if (/\b(lower|shorter)\b/.test(lower) && !/\bseat\b/.test(lower)) grow("height", -0.08, 0.3, 2.2, `lower (${program.params.height} → ${Math.max(0.3, Number(program.params.height ?? 0) - 0.08)} m)`);
    if (/\b(wider|longer)\b/.test(lower)) grow("width", 0.1, 0.3, 2.4, `wider (${program.params.width} → ${Number(program.params.width ?? 0) + 0.1} m)`);
    if (/\b(deeper)\b/.test(lower)) grow("depth", 0.08, 0.3, 1.2, `deeper (${program.params.depth} → ${Number(program.params.depth ?? 0) + 0.08} m)`);
    if (/\b(seat|sit) (?:higher|up)\b|\bhigher seat\b/.test(lower)) grow("seatHeight", 0.04, 0.28, 1.1, "a higher seat");
    if (/\b(seat|sit) (?:lower|down)\b|\blower seat\b/.test(lower)) grow("seatHeight", -0.04, 0.28, 1.1, "a lower seat");
    for (const material of ["oak", "walnut", "birch", "steel", "upholstered"]) {
      if (new RegExp(`\\b${material}\\b`).test(lower) && material !== String(program.params.material)) {
        changes.material = material;
        because.push(`in ${material}`);
      }
    }
  }

  if (builder === "garment") {
    const grow = (key: string, delta: number, min: number, max: number, why: string) => {
      if (key in changes) return;
      changes[key] = Math.min(max, Math.max(min, Number(program.params[key] ?? 0) + delta));
      because.push(why);
    };
    if (/\b(longer|taller)\b/.test(lower) && /\b(sleeve|arm)\b/.test(lower)) grow("sleeve", 4, 0, 90, `longer sleeves (${program.params.sleeve} → ${Number(program.params.sleeve ?? 0) + 4} cm)`);
    else if (/\b(shorter)\b/.test(lower) && /\b(sleeve|arm)\b/.test(lower)) grow("sleeve", -4, 0, 90, "shorter sleeves");
    else if (/\b(longer|taller)\b/.test(lower)) grow("length", 5, 30, 150, `longer (${program.params.length} → ${Number(program.params.length ?? 0) + 5} cm)`);
    else if (/\b(shorter|cropped)\b/.test(lower)) grow("length", -5, 30, 150, "shorter");
    if (/\b(looser|bigger|wider)\b/.test(lower)) grow("chest", 6, 60, 160, `a looser chest (${program.params.chest} → ${Number(program.params.chest ?? 0) + 6} cm)`);
    if (/\b(tighter|slimmer|narrower)\b/.test(lower)) grow("chest", -6, 60, 160, "a slimmer fit");
    if (/\bsleeveless\b/.test(lower)) changes.sleeve = 0;
    for (const weave of ["plain", "twill", "satin", "knit"]) {
      if (new RegExp(`\\b${weave}\\b`).test(lower) && weave !== String(program.params.weave)) {
        changes.weave = weave;
        because.push(`cut from ${weave}`);
      }
    }
    if (/\b(denser|tighter cloth)\b/.test(lower)) grow("density", 6, 8, 60, "denser cloth");
  }

  const asksBigger = /\b(bigger|larger|taller|wider|deeper|more)\b/.test(lower);
  if (Object.keys(changes).length === 0 && asksBigger) {
    unsupported.push("nothing in that request maps to a parameter of this build");
  }

  return { changes, because, unsupported };
}

/** Natural-language parameters for a first build ("a 4-storey cabin with 3 bays"). */
export function describeRequest(builder: BuildBuilder, text: string): Record<string, unknown> {
  if (builder.id === "gearbox") return describeGearboxRequest(text);
  if (builder.id === "cabin") return describeCabinRequest(text);
  if (builder.id === "molecule") return describeMoleculeRequest(text);
  if (builder.id === "v8") return describeV8Request(text);
  if (builder.id === "circuit") return describeCircuitRequest(text);
  if (builder.id === "cell") return describeCellRequest(text);
  if (builder.id === "fabric") return describeFabricRequest(text);
  if (builder.id === "furniture") return describeFurnitureRequest(text);
  if (builder.id === "garment") return describeGarmentRequest(text);
  return {};
}

export function catalog(): Array<{ id: string; domain: string; label: string; keywords: string[] }> {
  return BUILDERS.map((b) => ({ id: b.id, domain: b.domain, label: b.label, keywords: b.keywords }));
}
