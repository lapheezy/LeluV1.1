/**
 * ==========================================================
 * LÉLU — quality checkpoint for what her tools produced
 *
 * A tool that "succeeded" is not the same as a result the user will find
 * acceptable: a "detailed cat" drawn as three strokes, a "statue" placed as
 * one grey cylinder, a "cozy room" with a single chair. This checkpoint
 * reads the tool calls' OWN arguments (no model, no network, no cost) and
 * names deficiencies plainly.
 *
 *   1. As each call runs, a short note is added to that tool's result so
 *      the model can improve it in the same free tool loop.
 *   2. When the turn ends, whatever is still deficient is stated in the
 *      reply — never hidden behind "done" — with the free next step, and
 *      the paid option is only OFFERED: nothing paid is used without the
 *      user's explicit authorization (plugins/spendPolicy.ts enforces it).
 * ==========================================================
 */

export interface QualityCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface QualityDeficiency {
  /** Which artifact family: "drawing" | "3d-object" | "room". */
  area: "drawing" | "3d-object" | "room";
  problem: string;
  freeImprovement: string;
  /** A paid route that could do better — offered, never taken. */
  paidOption?: string;
}

const DETAIL_WORDS = /\b(detail\w*|realistic|intricate|complex|elaborate|beautiful|high[- ]quality|polished|professional)\b/i;
const MIN_DRAWING_ELEMENTS = 6;
const MIN_DETAILED_DRAWING_ELEMENTS = 15;
const MIN_ROOM_ITEMS = 3;

/** Things a single primitive (box/sphere/cylinder/cone/torus/plane) cannot represent. */
const COMPLEX_SUBJECT =
  /\b(statue|sculpture|person|human|figure|character|animal|cat|dog|horse|dragon|bird|car|vehicle|plane|ship|robot|tree|flower|face|bust|creature)\b/i;

const norm = (name: string): string => name.replace(/_/g, ".").toLowerCase();

function drawingElements(args: Record<string, unknown>): number | null {
  if (String(args.kind ?? "").toLowerCase() !== "drawing") return null;
  const scene = args.scene as { elements?: unknown } | undefined;
  return Array.isArray(scene?.elements) ? scene.elements.length : 0;
}

/** The deficiency of ONE executed call, if any. */
export function checkCall(prompt: string, call: QualityCall): QualityDeficiency | null {
  if (!call.ok) return null;
  const name = norm(call.name);
  if (name === "studio.create" || name === "studio.revise") {
    const count = drawingElements(call.args);
    if (count === null) return null;
    const needed = DETAIL_WORDS.test(prompt) ? MIN_DETAILED_DRAWING_ELEMENTS : MIN_DRAWING_ELEMENTS;
    if (count >= needed) return null;
    return {
      area: "drawing",
      problem: `the drawing has only ${count} element${count === 1 ? "" : "s"}, so it will look very simple${DETAIL_WORDS.test(prompt) ? " for the detail asked for" : ""}`,
      freeImprovement: `revise it with more shapes, lines and labels (at least ${needed} elements)`,
      paidOption: "a stronger paid model to plan a more detailed drawing",
    };
  }
  if (name === "world.object" && String(call.args.action ?? "create") === "create") {
    const label = `${String(call.args.label ?? "")} ${prompt}`;
    const subject = COMPLEX_SUBJECT.exec(label)?.[1];
    if (!subject) return null;
    const shape = String(call.args.shape ?? "box");
    return {
      area: "3d-object",
      problem: `the ${subject} is a single ${shape} primitive — a stand-in, not a modelled ${subject}`,
      freeImprovement: `build it from several primitives (body, head, limbs or parts) with world.object, or describe it with world.generate`,
      paidOption: "a real mesh from 3D Forge (Meshy, paid credits)",
    };
  }
  if (name === "world.generate") {
    const items = Array.isArray(call.args.items) ? call.args.items.length : null;
    if (items === null || items >= MIN_ROOM_ITEMS) return null;
    return {
      area: "room",
      problem: `the room has only ${items} furnishing${items === 1 ? "" : "s"}, so it will look sparse`,
      freeImprovement: "furnish it further with world.generate (furnishCurrent) or more world.object items",
    };
  }
  return null;
}

/** Note added to a tool's result so the model can fix it in the same (free) loop. */
export function inLoopNote(deficiency: QualityDeficiency): string {
  return `\n\nQUALITY CHECK: ${deficiency.problem}. If you can, ${deficiency.freeImprovement} now with the same free tools. Do not use any paid service.`;
}

/**
 * Deficiencies still standing at the end of the turn: a later call in the
 * same area that passes clears earlier ones (the model improved it).
 */
export function assessTurn(prompt: string, calls: QualityCall[]): QualityDeficiency[] {
  const latest = new Map<string, QualityDeficiency | null>();
  for (const call of calls) {
    const name = norm(call.name);
    const area =
      name === "studio.create" || name === "studio.revise"
        ? drawingElements(call.args) === null ? null : "drawing"
        : name === "world.object" && String(call.args.action ?? "create") === "create"
          ? "3d-object"
          : name === "world.generate"
            ? "room"
            : null;
    if (!area || !call.ok) continue;
    const found = checkCall(prompt, call);
    // A 3D object passing means "not a complex subject", which does not
    // clear a different object's stand-in; only an assembly of several
    // primitives does.
    if (area === "3d-object" && !found && latest.get(area)) continue;
    latest.set(area, found);
  }
  // Several primitives for the subject = an assembly, not a stand-in.
  const objects = calls.filter((c) => c.ok && norm(c.name) === "world.object" && String(c.args.action ?? "create") === "create");
  if (objects.length >= 3) latest.set("3d-object", null);
  return [...latest.values()].filter((d): d is QualityDeficiency => d !== null);
}

/** The reply's honest account of what is still below the bar. */
export function qualityNotice(deficiencies: QualityDeficiency[]): string {
  if (deficiencies.length === 0) return "";
  const lines = deficiencies.map((d) => `- ${d.problem}. Free next step: ${d.freeImprovement}.`);
  const paid = deficiencies.map((d) => d.paidOption).filter(Boolean);
  return [
    "",
    "",
    "Quality check — this is below what you asked for:",
    ...lines,
    paid.length
      ? `A better result is possible with ${paid.join("; ")}. I have not used it — that costs money and needs your explicit go-ahead. Say "refine it" for the free improvement instead.`
      : `Say "refine it" and I'll do the free improvement.`,
  ].join("\n");
}
