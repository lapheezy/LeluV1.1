/**
 * ==========================================================
 * LÉLU — CREATIVE OBJECT INTENTS
 *
 * Turns a sentence about the creations into the tool calls the
 * existing dispatcher already runs. No model is involved, so the
 * same sentence always produces the same plan and costs nothing.
 *
 * This is not a second cognition system: it emits the SAME
 * `couture.objects` calls a model emits, into the SAME
 * DirectPlan the DirectResolver already executes through
 * dispatchToolCall, with the same gate and the same events.
 *
 * It refuses rather than guesses. "Move the chair" with two
 * chairs compiles to a step that will fail with the candidate
 * list, which is the honest outcome — the alternative is moving
 * the wrong chair.
 * ==========================================================
 */

import type { DirectPlan } from "../creative/kit/DirectCompiler";
import type { SpatialRelation } from "./layout";

export interface IntentContext {
  /** The object already selected, so "it" has a referent. */
  selectedId?: string | null;
}

interface Clause {
  tool: "couture.objects";
  label: string;
  args: Record<string, unknown>;
}

const DEFAULT_MOVE_MM = 300;

const clean = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(the|my|a|an|this|that)\s+/i, "")
    .trim();

/** "the chair by its sleeve" → { object: "chair", component: "sleeve" } */
function splitComponent(text: string): { object: string; component?: string } {
  const match = /^(.*?)\s+by\s+(?:its|the|her|his)\s+(.+)$/i.exec(text.trim());
  if (!match) return { object: clean(text) };
  return { object: clean(match[1]), component: clean(match[2]) };
}

function scaleFactor(text: string): number | null {
  if (/\b(twice|double|two times)\b/i.test(text)) return 2;
  if (/\b(three times|triple)\b/i.test(text)) return 3;
  if (/\bhalf\b/i.test(text)) return 0.5;
  const factor = /\b(\d+(?:\.\d+)?)\s*(?:x|times)\b/i.exec(text);
  if (factor) return Number(factor[1]);
  if (/\b(a (?:little|bit) (?:bigger|larger)|slightly (?:bigger|larger)|bigger|larger|enlarge|grow)\b/i.test(text)) return 1.25;
  if (/\b(a (?:little|bit) (?:smaller)|slightly (?:smaller)|smaller|shrink|reduce)\b/i.test(text)) return 0.8;
  return null;
}

const RELATIONS: Array<{ pattern: RegExp; relation: SpatialRelation }> = [
  { pattern: /\b(next to|beside|alongside)\b/i, relation: "beside" },
  { pattern: /\b(to the |on the )?left of\b/i, relation: "left" },
  { pattern: /\b(to the |on the )?right of\b/i, relation: "right" },
  { pattern: /\b(in front of|in-front of|before)\b/i, relation: "in-front" },
  { pattern: /\b(behind|at the back of)\b/i, relation: "behind" },
  { pattern: /\b(on top of|above|over)\b/i, relation: "above" },
  { pattern: /\b(under|below|beneath)\b/i, relation: "below" },
  { pattern: /\b(in the middle of|in the centre of|in the center of|on)\b/i, relation: "centre" },
];

/** "move it beside the chair" → subject + anchor + relation. */
function relativeMove(clause: string): { subject: string; anchor: string; relation: SpatialRelation } | null {
  const verb = /\b(move|put|place|set|position)\s+(.+)$/i.exec(clause);
  if (!verb) return null;
  const rest = verb[2];
  for (const { pattern, relation } of RELATIONS) {
    const split = pattern.exec(rest);
    if (!split) continue;
    const subject = clean(rest.slice(0, split.index));
    const anchor = clean(rest.slice(split.index + split[0].length));
    if (!subject || !anchor) continue;
    return { subject, anchor, relation };
  }
  return null;
}

const DIRECTIONS: Array<{ pattern: RegExp; axis: 0 | 1 | 2; sign: 1 | -1; label: string }> = [
  { pattern: /\b(to the )?left\b/i, axis: 0, sign: -1, label: "left" },
  { pattern: /\b(to the )?right\b/i, axis: 0, sign: 1, label: "right" },
  { pattern: /\b(up|upwards?|higher)\b/i, axis: 2, sign: 1, label: "up" },
  { pattern: /\b(down|downwards?|lower)\b/i, axis: 2, sign: -1, label: "down" },
  { pattern: /\b(forward|forwards?|towards? (?:me|the camera)|closer to the camera)\b/i, axis: 1, sign: -1, label: "forward" },
  { pattern: /\b(back|backwards?|away from the camera)\b/i, axis: 1, sign: 1, label: "back" },
];

function directionDelta(clause: string): { delta: [number, number, number]; label: string } | null {
  const distance = /\b(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i.exec(clause);
  let amount = DEFAULT_MOVE_MM;
  if (distance) {
    const value = Number(distance[1]);
    const unit = distance[2].toLowerCase();
    amount = unit === "m" ? value * 1000 : unit === "cm" ? value * 10 : value;
  }
  for (const { pattern, axis, sign, label } of DIRECTIONS) {
    if (!pattern.test(clause)) continue;
    const delta: [number, number, number] = [0, 0, 0];
    delta[axis] = sign * amount;
    return { delta, label };
  }
  return null;
}

/**
 * Compile one clause. `referent` is what "it" means here: the selection, or
 * the object named by an earlier clause in the same sentence.
 */
/**
 * Does this clause talk about something in the creative world?
 *
 * Without this, "what is the weather in Lisbon" parses as an instruction to
 * inspect the object "weather in Lisbon". A resolver that answers the wrong
 * sentence is worse than one that stays quiet, so the vocabulary is explicit:
 * a creation noun, or a pronoun that has a real referent.
 */
const CREATION_NOUNS =
  /\b(chair|stool|table|pendant|necklace|ring|brooch|earring|gown|dress|garment|sleeve|bodice|skirt|corset|stone|gem|jewel(?:ry|le)?|product|creation|object|piece|mannequin|vase|lamp|cabinet|shelf|outfit)\b/i;

function aboutCreations(clause: string, referent: string | null): boolean {
  if (CREATION_NOUNS.test(clause)) return true;
  return Boolean(referent) && /\b(it|that one|this one|that|this)\b/i.test(clause);
}

function compileClause(raw: string, referent: string | null): Clause | { error: string } | null {
  const clause = raw.trim();
  if (!clause) return null;
  if (!aboutCreations(clause, referent)) return null;

  const subjectOf = (text: string): string => {
    const body = splitComponent(text).object;
    if (/^(it|that one|this one)$/i.test(body) || !body) {
      if (referent) return referent;
      return "";
    }
    return body;
  };

  const select = /^(?:select|pick|choose|highlight)\s+(.+)$/i.exec(clause);
  if (select) {
    const parsed = splitComponent(select[1]);
    const object = subjectOf(select[1]);
    if (!object) return { error: `nothing to select in "${clause}"` };
    return {
      tool: "couture.objects",
      label: `select ${object}`,
      args: { action: "select", object, ...(parsed.component ? { component: parsed.component } : {}) },
    };
  }

  const focus = /^(?:focus(?: on)?|frame|zoom (?:in )?(?:on|to)|look at|show me)\s+(.+)$/i.exec(clause);
  if (focus) {
    const object = subjectOf(focus[1]);
    if (!object) return { error: `nothing to frame in "${clause}"` };
    return { tool: "couture.objects", label: `frame ${object}`, args: { action: "focus", object } };
  }

  const find = /^(?:find|locate|where is|inspect|describe)\s+(.+)$/i.exec(clause);
  if (find) {
    const object = subjectOf(find[1]);
    if (!object) return { error: `nothing to look for in "${clause}"` };
    return { tool: "couture.objects", label: `inspect ${object}`, args: { action: "inspect", object } };
  }

  const rotate = /\b(?:rotate|turn)\b/i.test(clause) ? /(?:rotate|turn)\s+(.+?)(?:\s+by)?\s+(\d+(?:\.\d+)?)\s*(?:degrees?|°)?\s*$/i.exec(clause) : null;
  if (rotate) {
    const object = subjectOf(rotate[1]);
    const degrees = Number(rotate[2]);
    return {
      tool: "couture.objects",
      label: `rotate ${object} ${degrees}°`,
      args: { action: "rotate", object, rotation: [0, 0, degrees] },
    };
  }

  if (/\b(?:rotate|turn)\b/i.test(clause)) {
    const object = subjectOf(clause.replace(/^.*?\b(?:rotate|turn)\b\s*/i, "").replace(/\b(a (?:quarter|half) turn|around|it)\b/gi, ""));
    const degrees = /\bquarter turn\b/i.test(clause) ? 90 : /\bhalf turn\b/i.test(clause) ? 180 : 90;
    if (object) {
      return {
        tool: "couture.objects",
        label: `rotate ${object} ${degrees}°`,
        args: { action: "rotate", object, rotation: [0, 0, degrees] },
      };
    }
  }

  const relation = relativeMove(clause);
  if (relation) {
    const subject = /^(it|that one|this one)$/i.test(relation.subject) && referent ? referent : relation.subject;
    return {
      tool: "couture.objects",
      label: `move ${subject} ${relation.relation} ${relation.anchor}`,
      args: { action: "move", object: subject, relativeTo: relation.anchor, relation: relation.relation },
    };
  }

  const wantsMove = /\b(move|shift|push|nudge|slide|drag)\b/i.test(clause);
  if (wantsMove) {
    const direction = directionDelta(clause);
    const object = subjectOf(
      clause
        .replace(/^.*?\b(?:move|shift|push|nudge|slide|drag)\b\s*/i, "")
        .replace(/\b(is |the |a )?(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/gi, "")
        .replace(/\b(to the |a bit |slightly )?(left|right|up|down|forward|back|backwards?|forwards?)\b/gi, ""),
    );
    if (direction && object) {
      return {
        tool: "couture.objects",
        label: `move ${object} ${direction.label}`,
        args: { action: "move", object, delta: direction.delta },
      };
    }
    if (direction) return { error: `I don't know which object to move. Say which one, e.g. "move the chair left".` };
    // No direction and no anchor: still emit the call, so the tool's own
    // validation answers with what the instruction was missing. A silent
    // non-answer would leave the person guessing whether anything happened.
    if (object) {
      return {
        tool: "couture.objects",
        label: `move ${object}`,
        args: { action: "move", object },
      };
    }
  }

  const factor = scaleFactor(clause);
  if (factor !== null && /\b(scale|size|bigger|larger|smaller|enlarge|shrink|reduce|double|twice|half|times|x)\b/i.test(clause)) {
    const object = subjectOf(
      clause
        .replace(/^.*?\b(?:make|scale|resize|enlarge|shrink|reduce|grow)\b\s*/i, "")
        .replace(/\b(twice as large|twice|double|three times|triple|half(?: the size)?|a (?:little|bit) (?:bigger|larger|smaller)|slightly (?:bigger|larger|smaller)|bigger|larger|smaller|enlarge|shrink|reduce|grow|\d+(?:\.\d+)?\s*(?:x|times))\b/gi, "")
        .replace(/\b(scale|size)\b/gi, ""),
    );
    if (!object) return { error: `I don't know which object to resize. Say which one, e.g. "make the pendant twice as large".` };
    return { tool: "couture.objects", label: `scale ${object} ×${factor}`, args: { action: "scale", object, scale: factor } };
  }

  const duplicate = /^(?:duplicate|copy)\s+(.+)$/i.exec(clause);
  if (duplicate) {
    const object = subjectOf(duplicate[1]);
    if (!object) return { error: `nothing to duplicate in "${clause}"` };
    return { tool: "couture.objects", label: `duplicate ${object}`, args: { action: "duplicate", object } };
  }

  return null;
}

/**
 * Compile a whole instruction into a DirectPlan of couture.objects steps.
 * Returns null when the sentence isn't about the creations at all, so the
 * other resolvers keep their turn.
 */
export function compileCreativeObjectPlan(prompt: string, context: IntentContext = {}): DirectPlan | null {
  const text = prompt.trim().replace(/^\/creative\s+/i, "");
  if (!text) return null;

  const clauses = text
    .split(/\s*(?:,|;| and then | then | and )\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const steps: Clause[] = [];
  let referent: string | null = context.selectedId ?? null;

  for (const clause of clauses) {
    const compiled = compileClause(clause, referent);
    if (!compiled) continue;
    if ("error" in compiled) continue;
    steps.push(compiled);
    // The first named object becomes what "it" refers to in the next clause.
    if (typeof compiled.args.object === "string" && compiled.args.object && !/^(it|that one|this one)$/i.test(compiled.args.object)) {
      referent = compiled.args.object;
    }
  }

  if (!steps.length) return null;

  return {
    explicit: false,
    summary: steps.map((step) => step.label).join(", then "),
    steps: steps.map((step) => ({ tool: step.tool, label: step.label, args: step.args })),
  } as DirectPlan;
}
