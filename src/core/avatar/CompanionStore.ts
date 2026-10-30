/**
 * ==========================================================
 * LÉLU — COMPANION MODE
 *
 * LÉLU's avatar as a companion that stays with you across the whole
 * app: a small figure floating over whatever you are doing — chat,
 * browser, workspace, Cosmos — instead of a panel or a window you have
 * to open. It is a MODE: off by default, on or off from the Avatar
 * panel, the menu, or by asking her.
 *
 * Where she stands:
 *   - wherever you put her: dragging her pins her there;
 *   - or, unpinned, wherever SHE judges is out of the way — away from
 *     the field you are typing in, the controls marked keep-clear, and
 *     the screen edges' system bars. She only moves when her current
 *     spot starts covering something, so she does not wander.
 *
 * She never takes over the screen: only her own figure receives
 * touches; everything around and beneath her keeps working.
 *
 * Persisted (KvStore), so the mode, her size and your chosen spot
 * survive a reload. The look is not stored here — it is the avatar you
 * chose in the Avatar panel (AvatarStore), the same LÉLU everywhere.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type CompanionSize = "small" | "medium" | "large";
/** All of her, or head and shoulders. */
export type CompanionFraming = "full" | "face";

export interface CompanionState {
  enabled: boolean;
  /** True once the user has placed her; false lets her choose. */
  pinned: boolean;
  /** Centre of the figure as a fraction of the viewport (0..1). */
  x: number;
  y: number;
  size: CompanionSize;
  framing: CompanionFraming;
  /** Who moved her last — shown so a move is never mysterious. */
  lastMovedBy: "user" | "lelu" | "none";
  updatedAt: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** How much covering this matters (the field being typed in: most). Default 1. */
  weight?: number;
}

/** Head-and-shoulders size in CSS px (width × height, portrait 3:4). */
export const COMPANION_DIMENSIONS: Record<CompanionSize, { width: number; height: number }> = {
  small: { width: 84, height: 112 },
  medium: { width: 120, height: 160 },
  large: { width: 168, height: 224 },
};

/** Full-figure size in CSS px: she is about 2.1× as tall as she is wide. */
export const COMPANION_FULL_DIMENSIONS: Record<CompanionSize, { width: number; height: number }> = {
  small: { width: 80, height: 170 },
  medium: { width: 110, height: 235 },
  large: { width: 150, height: 320 },
};

export type CompanionShape = CompanionSize | { width: number; height: number };

/** Her figure's size for a size name (head-and-shoulders) or explicit dimensions. */
export function companionDimensions(shape: CompanionShape, framing: CompanionFraming = "face"): { width: number; height: number } {
  if (typeof shape !== "string") return shape;
  return (framing === "full" ? COMPANION_FULL_DIMENSIONS : COMPANION_DIMENSIONS)[shape];
}

/** Distance kept from the screen edge (and the phone's system bars). */
export const EDGE_MARGIN = 12;

const KEY = "lelu.companion.v1";

export function defaultCompanionState(): CompanionState {
  // On unless turned off: the owner asked for her to be present wherever
  // LÉLU is active (V1.1 avatar brief). Off is remembered.
  return { enabled: true, pinned: false, x: 0.86, y: 0.2, size: "medium", framing: "full", lastMovedBy: "none", updatedAt: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The figure's rectangle for a centre given as viewport fractions. */
export function figureRect(x: number, y: number, size: CompanionShape, viewport: { width: number; height: number }): Rect {
  const { width, height } = companionDimensions(size);
  const left = clamp(x * viewport.width - width / 2, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewport.width - width - EDGE_MARGIN));
  const top = clamp(y * viewport.height - height / 2, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewport.height - height - EDGE_MARGIN));
  return { left, top, width, height };
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Candidate resting spots, as figure-centre fractions: corners first, then edge middles. */
export function candidateSpots(size: CompanionShape, viewport: { width: number; height: number }): Array<{ x: number; y: number }> {
  const { width, height } = companionDimensions(size);
  const cx = (px: number) => px / viewport.width;
  const cy = (px: number) => px / viewport.height;
  const left = cx(EDGE_MARGIN + width / 2);
  const right = cx(viewport.width - EDGE_MARGIN - width / 2);
  const top = cy(EDGE_MARGIN + height / 2 + 56); // below a header bar
  const bottom = cy(viewport.height - EDGE_MARGIN - height / 2 - 72); // above a composer
  const middle = 0.5;
  return [
    { x: right, y: top },
    { x: left, y: top },
    { x: right, y: middle },
    { x: left, y: middle },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/**
 * Where should she stand so she covers nothing that matters?
 *
 * Returns the current spot when it already covers nothing (she does not
 * wander), otherwise the candidate covering the least, preferring the
 * one nearest where she is. `keepClear` are the rectangles of what the
 * user is working with — the focused field, keep-clear controls.
 */
export function chooseSpot(
  current: { x: number; y: number },
  size: CompanionShape,
  viewport: { width: number; height: number },
  keepClear: readonly Rect[],
): { x: number; y: number; moved: boolean } {
  const cover = (spot: { x: number; y: number }) => {
    const rect = figureRect(spot.x, spot.y, size, viewport);
    return keepClear.reduce((sum, clear) => sum + overlapArea(rect, clear) * (clear.weight ?? 1), 0);
  };
  const here = cover(current);
  if (here === 0) return { ...current, moved: false };
  let best: { x: number; y: number; covered: number; distance: number } | null = null;
  for (const spot of candidateSpots(size, viewport)) {
    const covered = cover(spot);
    const distance = Math.hypot(spot.x - current.x, spot.y - current.y);
    if (!best || covered < best.covered || (covered === best.covered && distance < best.distance)) {
      best = { ...spot, covered, distance };
    }
  }
  // Move only for a spot that is actually better than staying.
  if (!best || best.covered >= here) return { ...current, moved: false };
  return { x: best.x, y: best.y, moved: true };
}

type Listener = (state: CompanionState) => void;

export default class CompanionStore {
  private static instance: CompanionStore | null = null;
  private state: CompanionState;
  private readonly listeners = new Set<Listener>();

  private constructor() {
    const saved = KvStore.getInstance().get<Partial<CompanionState>>(KEY);
    this.state = { ...defaultCompanionState(), ...(saved ?? {}) };
    if (this.state.framing !== "full" && this.state.framing !== "face") this.state.framing = "full";
  }

  public static getInstance(): CompanionStore {
    if (!CompanionStore.instance) CompanionStore.instance = new CompanionStore();
    return CompanionStore.instance;
  }

  /** Test-only: forget the singleton (the persisted state stays). */
  public static resetForTests(): void {
    CompanionStore.instance = null;
  }

  public get(): CompanionState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setEnabled(enabled: boolean): CompanionState {
    return this.patch({ enabled });
  }

  public toggle(): CompanionState {
    return this.patch({ enabled: !this.state.enabled });
  }

  public setSize(size: CompanionSize): CompanionState {
    return this.patch({ size });
  }

  public setFraming(framing: CompanionFraming): CompanionState {
    return this.patch({ framing });
  }

  /** The user placed her: she stays there until they let her choose again. */
  public placeByUser(x: number, y: number): CompanionState {
    return this.patch({ x: clamp(x, 0, 1), y: clamp(y, 0, 1), pinned: true, lastMovedBy: "user" });
  }

  /** She moved herself out of the way (only while unpinned). */
  public placeByLelu(x: number, y: number): CompanionState {
    if (this.state.pinned) return this.state;
    return this.patch({ x: clamp(x, 0, 1), y: clamp(y, 0, 1), lastMovedBy: "lelu" });
  }

  /** Let her choose her own spot again. */
  public unpin(): CompanionState {
    return this.patch({ pinned: false });
  }

  private patch(patch: Partial<CompanionState>): CompanionState {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    KvStore.getInstance().set(KEY, this.state);
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("[CompanionStore] listener threw (contained)", error);
      }
    }
    return this.state;
  }
}
