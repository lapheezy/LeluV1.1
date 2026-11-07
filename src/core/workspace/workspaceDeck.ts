/**
 * ==========================================================
 * LÉLU — WORKSPACE DECK
 *
 * The workspace used to have one presentation per surface: every open
 * surface got a full working window, tiled in rows. That puts a hard
 * ceiling on how much can be seen at once — four or five at a large
 * desktop — and the ceiling is a product decision, not a layout accident.
 *
 * The deck removes it. One surface is PRIMARY and gets the working area;
 * every other live surface gets a COMPACT preview beside it, still live,
 * still reachable, promoted to primary by a tap. Anything that does not
 * fit the preview tier goes to the SHELF: it stays open, keeps its state,
 * and can be promoted. Nothing is ever silently closed to make room.
 *
 * Pure geometry: no React, no DOM. Every rect is inside the viewport and
 * no two rects overlap, by construction — `planDeck` places them from a
 * single allocation, and the tests assert it for 1…20 surfaces.
 * ==========================================================
 */

export interface DeckViewport {
  width: number;
  height: number;
}

export interface DeckInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  gap?: number;
  /** Width of the preview rail on desktop. */
  railWidth?: number;
  /** Width of one preview tile on a phone strip. */
  tileWidth?: number;
  /** Height of the preview strip on a phone. */
  stripHeight?: number;
}

export type DeckDensity = "compact" | "regular" | "wide";

export interface DeckWindow {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: "primary" | "preview";
}

export interface DeckPlan {
  primary: DeckWindow | null;
  previews: DeckWindow[];
  /** Open, state-preserved surfaces not currently drawn (promote to see). */
  shelf: string[];
  density: DeckDensity;
  /** primary + previews: how many surfaces are visible at once. */
  capacity: number;
  visible: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function deckDensity(width: number): DeckDensity {
  if (width < 720) return "compact";
  if (width < 1280) return "regular";
  return "wide";
}

const MIN_PRIMARY_WIDTH = 320;
const MIN_PRIMARY_HEIGHT = 220;
const MIN_PREVIEW_HEIGHT = 84;
const MAX_PREVIEW_HEIGHT = 168;

/**
 * Arrange `ids` for `viewport`. `focused` is promoted to primary; when it
 * is absent or not in `ids`, the first surface is primary. Result is stable
 * for the same input, so it can be persisted and diffed.
 */
export function planDeck(
  ids: string[],
  focused: string | null,
  viewport: DeckViewport,
  insets: DeckInsets = {},
): DeckPlan {
  const density = deckDensity(viewport.width);
  const surfaces = ids.filter((id, index) => ids.indexOf(id) === index);
  const empty: DeckPlan = { primary: null, previews: [], shelf: [], density, capacity: 0, visible: 0 };
  if (surfaces.length === 0) return empty;

  const primaryId = focused && surfaces.includes(focused) ? focused : surfaces[0];
  const others = surfaces.filter((id) => id !== primaryId);

  const gap = Math.max(0, insets.gap ?? (density === "compact" ? 8 : 10));
  const left = Math.max(0, insets.left ?? (density === "compact" ? 8 : 88));
  const right = Math.max(0, insets.right ?? 16);
  const top = Math.max(0, insets.top ?? (density === "compact" ? 16 : 64));
  const bottom = Math.max(0, insets.bottom ?? (density === "compact" ? 96 : 20));

  const availableWidth = Math.max(1, viewport.width - left - right);
  const availableHeight = Math.max(1, viewport.height - top - bottom);

  if (density === "compact") {
    // Phone: the working surface keeps the top, previews form a strip
    // along the bottom that scrolls sideways when it overflows.
    const strip = Math.max(72, Math.min(insets.stripHeight ?? 104, availableHeight * 0.4));
    const tileWidth = Math.max(96, insets.tileWidth ?? 148);
    const primaryHeight = Math.max(1, availableHeight - strip - gap);
    const perRow = Math.max(1, Math.floor((availableWidth + gap) / (tileWidth + gap)));
    const maxTiles = perRow; // one visible row; the rest wait on the shelf
    const shown = others.slice(0, maxTiles);

    const previews: DeckWindow[] = shown.map((id, index) => ({
      id,
      x: left + index * (tileWidth + gap),
      y: top + primaryHeight + gap,
      width: tileWidth,
      height: strip,
      role: "preview" as const,
    }));

    return {
      primary: { id: primaryId, x: left, y: top, width: availableWidth, height: primaryHeight, role: "primary" },
      previews,
      shelf: others.slice(shown.length),
      density,
      capacity: 1 + previews.length,
      visible: 1 + previews.length,
    };
  }

  // Tablet/desktop: a preview rail on the right, the working surface on
  // the left. When the viewport is too narrow for both, the rail is
  // dropped rather than squeezing the working surface below its minimum.
  const rail = Math.max(160, insets.railWidth ?? (density === "wide" ? 300 : 236));
  const canHostRail = availableWidth - rail - gap >= MIN_PRIMARY_WIDTH;
  const primaryWidth = canHostRail ? availableWidth - rail - gap : availableWidth;

  const primaryHeight = availableHeight;
  const railX = left + primaryWidth + gap;
  const fit = Math.max(
    1,
    Math.floor((availableHeight + gap) / (MIN_PREVIEW_HEIGHT + gap)),
  );
  const shown = canHostRail ? others.slice(0, fit) : [];
  const rows = Math.max(1, shown.length);
  const previewHeight = clamp(
    (availableHeight - gap * (rows - 1)) / rows,
    MIN_PREVIEW_HEIGHT,
    MAX_PREVIEW_HEIGHT,
  );

  const previews: DeckWindow[] = shown.map((id, index) => ({
    id,
    x: railX,
    y: top + index * (previewHeight + gap),
    width: rail,
    height: previewHeight,
    role: "preview" as const,
  }));

  return {
    primary: {
      id: primaryId,
      x: left,
      y: top,
      width: Math.max(Math.min(MIN_PRIMARY_WIDTH, availableWidth), primaryWidth),
      height: Math.max(Math.min(MIN_PRIMARY_HEIGHT, availableHeight), primaryHeight),
      role: "primary",
    },
    previews,
    shelf: canHostRail ? others.slice(shown.length) : others,
    density,
    capacity: 1 + previews.length,
    visible: 1 + previews.length,
  };
}

/** Promote a surface: the same arrangement, re-anchored on the new primary. */
export function promoteDeck(plan: DeckPlan, id: string, ids: string[], viewport: DeckViewport, insets: DeckInsets = {}): DeckPlan {
  if (plan.primary?.id === id) return plan;
  if (!ids.includes(id)) return plan;
  return planDeck(ids, id, viewport, insets);
}

/** Which surfaces the deck can show at once for a given viewport. */
export function deckCapacity(viewport: DeckViewport, insets: DeckInsets = {}): number {
  // One primary plus previews; measured with a synthetic set large enough
  // to fill the preview tier.
  const probe = Array.from({ length: 24 }, (_, index) => `probe-${index}`);
  return planDeck(probe, probe[0], viewport, insets).capacity;
}
