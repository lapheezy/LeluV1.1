/**
 * ==========================================================
 * LÉLU — SPATIAL LANGUAGE FOR COSMOS OBJECTS (M17.3-WP01)
 *
 * Pure: words in, a spatial intent out; two positions in, a position
 * out. No store, no tools, no model. The tool (cosmos.object.position)
 * resolves the names against CosmosObjectStore and runs the move; the
 * router (DirectResolver) uses `parseSpatialIntent` to tell "move the
 * gear next to the cabin" (an object) from "put the browser next to the
 * chat" (windows).
 *
 * Conventions are the Cosmos's own, not new ones:
 *   - a position is the object's world frame [x, y, z] (CosmosObjectsLayer
 *     draws `frame.position` directly; a child's frame is world-space too);
 *   - three.js axes as the scene uses them: +x right, +y up, +z toward the
 *     viewer, so "behind" is −z and "in front of" is +z;
 *   - "beside / next to" keeps the existing rule of the position tool: the
 *     reference's position plus one reach along +x, where reach is
 *     1.4 × the larger of the two scales.
 * ==========================================================
 */

export type Vec3 = [number, number, number];

export type SpatialRelation =
  | "beside"
  | "near"
  | "left-of"
  | "right-of"
  | "in-front-of"
  | "behind"
  | "above"
  | "below"
  | "closer"
  | "farther";

export type SpatialDirection = "left" | "right" | "forward" | "backward" | "up" | "down";

export type SpatialIntent =
  | { kind: "relative"; target: string; relation: SpatialRelation; reference: string | null; degree: Degree }
  | { kind: "direction"; target: string; direction: SpatialDirection; degree: Degree; distance: number | null };

export type Degree = "little" | "normal" | "lot";

const VERB = "(?:move|put|place|shift|position|bring|push|pull|nudge|slide|set)";
const ARTICLE = "(?:the\\s+|my\\s+|that\\s+|this\\s+)?";
const NAME = "([\\w][\\w\\s'-]{0,40}?)";

/** Relation phrases, longest first so "to the left of" wins over "left". */
const RELATIONS: Array<[RegExp, SpatialRelation]> = [
  [/^(?:to\s+the\s+left\s+of|on\s+the\s+left\s+of|left\s+of)$/i, "left-of"],
  [/^(?:to\s+the\s+right\s+of|on\s+the\s+right\s+of|right\s+of)$/i, "right-of"],
  [/^(?:in\s+front\s+of|ahead\s+of)$/i, "in-front-of"],
  [/^(?:behind|in\s+back\s+of|at\s+the\s+back\s+of)$/i, "behind"],
  [/^(?:above|over|on\s+top\s+of)$/i, "above"],
  [/^(?:below|under|underneath|beneath)$/i, "below"],
  [/^(?:next\s+to|beside|alongside|by)$/i, "beside"],
  [/^(?:near|close\s+to)$/i, "near"],
  [/^(?:closer\s+to|nearer\s+to|nearer|closer)$/i, "closer"],
  [/^(?:farther\s+(?:away\s+)?from|further\s+(?:away\s+)?from|away\s+from|farther\s+away|further\s+away|farther|further)$/i, "farther"],
];
const RELATION_ALT =
  "to\\s+the\\s+left\\s+of|on\\s+the\\s+left\\s+of|left\\s+of|to\\s+the\\s+right\\s+of|on\\s+the\\s+right\\s+of|right\\s+of|in\\s+front\\s+of|ahead\\s+of|in\\s+back\\s+of|at\\s+the\\s+back\\s+of|behind|on\\s+top\\s+of|above|over|underneath|beneath|below|under|next\\s+to|beside|alongside|close\\s+to|near|closer\\s+to|nearer\\s+to|farther\\s+(?:away\\s+)?from|further\\s+(?:away\\s+)?from|away\\s+from|farther\\s+away|further\\s+away|closer|nearer|farther|further|by";

const DIRECTIONS: Array<[RegExp, SpatialDirection]> = [
  [/^(?:to\s+the\s+)?left(?:wards?)?$/i, "left"],
  [/^(?:to\s+the\s+)?right(?:wards?)?$/i, "right"],
  [/^(?:forwards?|ahead|toward\s+me|towards\s+me|closer\s+to\s+me)$/i, "forward"],
  [/^(?:backwards?|back|away\s+from\s+me)$/i, "backward"],
  [/^(?:up|upwards?|higher)$/i, "up"],
  [/^(?:down|downwards?|lower)$/i, "down"],
];
const DIRECTION_ALT = "to\\s+the\\s+left|leftwards?|left|to\\s+the\\s+right|rightwards?|right|forwards?|ahead|towards?\\s+me|closer\\s+to\\s+me|backwards?|back|away\\s+from\\s+me|upwards?|up|higher|downwards?|down|lower";

function degreeOf(t: string): Degree {
  if (/\b(a\s+(?:little|bit|touch)|slightly|a\s+tad|just\s+a\s+bit)\b/i.test(t)) return "little";
  if (/\b(a\s+lot|much|way|far)\b/i.test(t)) return "lot";
  return "normal";
}

function clean(name: string): string {
  return name
    .trim()
    .replace(/^(?:the|my|that|this)\s+/i, "")
    .replace(/\s+(?:a\s+(?:little|bit|touch)|slightly|a\s+lot|much)$/i, "")
    .replace(/[.?!,]+$/, "")
    .trim();
}

/**
 * Read a sentence as a Cosmos spatial operation, or null. It only reads
 * words — whether the names are objects is the caller's question.
 */
export function parseSpatialIntent(prompt: string): SpatialIntent | null {
  const t = prompt.trim().replace(/[.?!]+$/, "");
  const degree = degreeOf(t);
  const filler = "(?:\\s+(?:a\\s+(?:little|bit|touch)|slightly|a\\s+lot|much|way|just))?";

  // "move the gear (a little) to the left of the cabin", "put the gear behind the cabin"
  const rel = new RegExp(`^(?:please\\s+)?${VERB}\\s+${ARTICLE}${NAME}${filler}\\s+(${RELATION_ALT})(?:\\s+${ARTICLE}([\\w][\\w\\s'-]{0,40}))?$`, "i").exec(t);
  if (rel) {
    const phrase = rel[2].replace(/\s+/g, " ");
    const relation = RELATIONS.find(([re]) => re.test(phrase))?.[1];
    const reference = rel[3] ? clean(rel[3]) : null;
    if (relation && !(reference && /^\d+(\.\d+)?(\s*\w+)?$/.test(reference))) {
      // "move the gear closer" / "farther away" may omit the reference; every other relation needs one.
      if (!reference && relation !== "closer" && relation !== "farther") return null;
      // "move the gear back" / "move it up" are directions, not "behind"/"above" something.
      return { kind: "relative", target: clean(rel[1]), relation, reference, degree };
    }
  }

  // "move the gear left", "move it up by 2", "nudge the cabin forward a little"
  const dir = new RegExp(`^(?:please\\s+)?${VERB}\\s+${ARTICLE}${NAME}${filler}\\s+(${DIRECTION_ALT})(?:\\s+(?:by\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:units?|m|metres?|meters?)?)?${filler}$`, "i").exec(t);
  if (dir) {
    const direction = DIRECTIONS.find(([re]) => re.test(dir[2].replace(/\s+/g, " ")))?.[1];
    if (direction) return { kind: "direction", target: clean(dir[1]), direction, degree, distance: dir[3] ? Number(dir[3]) : null };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* positions                                                           */
/* ------------------------------------------------------------------ */

export interface Placeable {
  position: Vec3;
  scale: number;
}

const FACTOR: Record<Degree, number> = { little: 0.5, normal: 1, lot: 2 };
/** The nearest "closer" goes, as a share of the beside spacing (objects never meet centre to centre). */
export const CLOSEST = 0.6;
/** One step of a directional move, in the Cosmos's units (scaled by the object). */
export const DIRECTION_STEP = 1.5;

/** The existing "beside" spacing of cosmos.object.position. */
export function reachOf(target: Placeable, reference: Placeable): number {
  return Math.max(reference.scale * 1.4, target.scale * 1.4);
}

const round = (v: Vec3): Vec3 => v.map((n) => Math.round(n * 1000) / 1000) as Vec3;

export function placeRelative(target: Placeable, reference: Placeable, relation: SpatialRelation, degree: Degree = "normal"): Vec3 {
  const [rx, ry, rz] = reference.position;
  const reach = reachOf(target, reference);
  switch (relation) {
    case "beside":
    case "near":
    case "right-of":
      return round([rx + reach, ry, rz]);
    case "left-of":
      return round([rx - reach, ry, rz]);
    case "in-front-of":
      return round([rx, ry, rz + reach]);
    case "behind":
      return round([rx, ry, rz - reach]);
    case "above":
      return round([rx, ry + reach, rz]);
    case "below":
      return round([rx, ry - reach, rz]);
    case "closer":
    case "farther": {
      const d: Vec3 = [target.position[0] - rx, target.position[1] - ry, target.position[2] - rz];
      const dist = Math.hypot(...d);
      // Coincident: there is no direction to move along; step out along +x.
      const unit: Vec3 = dist > 1e-6 ? [d[0] / dist, d[1] / dist, d[2] / dist] : [1, 0, 0];
      const f = FACTOR[degree];
      // "Closer" may come inside the beside spacing, down to CLOSEST × reach,
      // so it still moves something already placed beside or behind — but
      // never into the reference.
      const closest = reach * CLOSEST;
      const next =
        relation === "closer"
          ? Math.max(closest, dist - Math.max(dist - closest, 0) * 0.5 * f) // halve the gap (a little: a quarter)
          : dist + Math.max(dist, reach) * 0.5 * f; // half as far again (a little: a quarter)
      return round([rx + unit[0] * next, ry + unit[1] * next, rz + unit[2] * next]);
    }
  }
}

export function placeDirection(target: Placeable, direction: SpatialDirection, degree: Degree = "normal", distance: number | null = null): Vec3 {
  const step = distance ?? DIRECTION_STEP * FACTOR[degree] * Math.max(1, target.scale);
  const [x, y, z] = target.position;
  const by: Record<SpatialDirection, Vec3> = {
    left: [x - step, y, z],
    right: [x + step, y, z],
    forward: [x, y, z + step],
    backward: [x, y, z - step],
    up: [x, y + step, z],
    down: [x, y - step, z],
  };
  return round(by[direction]);
}

export const RELATION_WORDS: Record<SpatialRelation, string> = {
  beside: "beside",
  near: "near",
  "left-of": "to the left of",
  "right-of": "to the right of",
  "in-front-of": "in front of",
  behind: "behind",
  above: "above",
  below: "below",
  closer: "closer to",
  farther: "farther from",
};
