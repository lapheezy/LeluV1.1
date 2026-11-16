/**
 * ==========================================================
 * LÉLU — WHERE HER PRESENCE GOES (pure placement rules)
 * Used by LeluCompanion. Pure geometry over the space the existing
 * planner reads (spatialPresence.measureSpace): no state, no React.
 * ==========================================================
 */

import { measureSpace, overlaps, type AvatarAnchor, type Rect, type SpaceLayout } from "./spatialPresence";

const EDGE = 12;
type Box = Rect;

/** Where she is, and why — the attribute tests and evidence read. */
export type PresencePlace = "hero" | "planned" | "placed" | "edge" | "world";


/**
 * The corner she rests in when no planned spot is clear. Kept for the
 * dock geometry tests: beside a floating chat box when it fits, else the
 * right corner above the phone composer / desktop navigation.
 */
export function dockedWindow(viewport: { width: number; height: number }, chat: Box | null, compact: boolean): Box {
  const width = compact ? 120 : 200;
  const height = compact ? 200 : 330;
  const floatingChat = chat && !compact && chat.width < viewport.width * 0.9;
  if (floatingChat) {
    const left = chat.left + chat.width + EDGE;
    if (left + width <= viewport.width - EDGE) {
      const top = Math.max(EDGE, Math.min(chat.top + chat.height - height, viewport.height - height - EDGE));
      return { left, top, width, height };
    }
  }
  return { left: viewport.width - width - EDGE, top: Math.max(EDGE, viewport.height - height - (compact ? 116 : 108)), width, height };
}

/** The controls the current shell adds on top of what measureSpace reads. */
const EXTRA_CONTROLS = [
  "[data-spatial-groups]",
  "[data-spatial-control]",
  "[data-lelu-fullscreen] textarea",
  "[data-lelu-fullscreen] form",
  "[data-lelu-module-window] > header",
  "[data-lelu-graph-editor] .lst-toolbar",
  "[data-lelu-drawing-editor] .lst-toolbar",
  ".excalidraw .App-toolbar",
  ".react-flow__controls",
];

export function rectOf(element: Element): Rect | null {
  const r = element.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/** The space planner's reading of the interface, plus the current shell's controls. Never her own box. */
export function readSpace(doc: Document = document): SpaceLayout {
  const space = measureSpace(doc);
  const extra: Rect[] = [];
  for (const selector of EXTRA_CONTROLS) {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      if (element.closest("[data-testid=lelu-companion]")) continue;
      const r = rectOf(element);
      if (r) extra.push(r);
    }
  }
  return { ...space, controls: [...space.controls, ...extra] };
}

/** Does this box cover something you need (the composer, a control)? */
export function blocksSomething(box: Rect, space: SpaceLayout, margin = 4): boolean {
  if (space.composer && overlaps(box, space.composer, margin)) return true;
  return space.controls.some((control) => overlaps(box, control, margin));
}

/** Smallest edge rest that covers nothing — or the least bad one. */
export function edgeRest(space: SpaceLayout, compact: boolean): Box {
  const { width: vw, height: vh } = space.viewport;
  const width = compact ? 76 : 120;
  const height = compact ? 104 : 170;
  const top = space.safe.top + EDGE;
  const bottom = vh - space.safe.bottom - height - EDGE;
  const ys = [0.5, 0.33, 0.66, 0.2, 0.8].map((f) => Math.round(top + (bottom - top) * f));
  const candidates: Box[] = [];
  for (const y of ys) {
    candidates.push({ left: vw - space.safe.right - width - 2, top: y, width, height });
    candidates.push({ left: space.safe.left + 2, top: y, width, height });
  }
  const covered = (b: Box) =>
    (space.composer && overlaps(b, space.composer) ? 1000 : 0) +
    space.controls.filter((c) => overlaps(b, c)).length * 100 +
    (space.chat && overlaps(b, space.chat) ? 10 : 0) +
    space.panels.filter((p) => overlaps(b, p)).length;
  return candidates.reduce((best, b) => (covered(b) < covered(best) ? b : best), candidates[0]);
}

/**
 * Where she goes, in order: hidden in a world view (she stands in it);
 * where you put her, unless that now covers something you need; the
 * home's hero spot; the space planner's spot; the least obstructive edge.
 */
export function choosePlace(input: {
  inWorld: boolean;
  placed: Box | null;
  onHome: boolean;
  hero: Rect | null;
  plan: Pick<AvatarAnchor, "hidden" | "rect">;
  space: SpaceLayout;
  compact: boolean;
}): { place: PresencePlace; target: Box } {
  const { inWorld, placed, onHome, hero, plan, space, compact } = input;
  if (inWorld) return { place: "world", target: placed ?? edgeRest(space, compact) };
  if (placed && !blocksSomething(placed, space)) return { place: "placed", target: placed };
  if (onHome && hero) return { place: "hero", target: hero };
  if (!plan.hidden) return { place: "planned", target: plan.rect };
  return { place: "edge", target: edgeRest(space, compact) };
}

/**
 * Where you dropped her, moved to the nearest spot that covers nothing you
 * need (searched outward from the drop point). Null when nothing nearby is
 * free — she then keeps her own place rather than sit on a control.
 */
export function nearestFree(drop: Box, space: SpaceLayout): Box | null {
  const { width: vw, height: vh } = space.viewport;
  let best: Box | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let ring = 0; ring <= 12; ring += 1) {
    const step = ring * 24;
    for (let dx = -step; dx <= step; dx += Math.max(24, step)) {
      for (let dy = -step; dy <= step; dy += Math.max(24, step)) {
        const candidate = clampBox({ ...drop, left: drop.left + dx, top: drop.top + dy }, { width: vw, height: vh });
        if (blocksSomething(candidate, space)) continue;
        const distance = Math.hypot(candidate.left - drop.left, candidate.top - drop.top);
        if (distance < bestDistance) { best = candidate; bestDistance = distance; }
      }
    }
    if (best) return best;
  }
  return null;
}

export function clampBox(box: Box, viewport: { width: number; height: number }): Box {
  const width = Math.min(box.width, viewport.width - EDGE * 2);
  const height = Math.min(box.height, viewport.height - EDGE * 2);
  return {
    left: Math.min(Math.max(EDGE, box.left), viewport.width - width - EDGE),
    top: Math.min(Math.max(EDGE, box.top), viewport.height - height - EDGE),
    width,
    height,
  };
}

