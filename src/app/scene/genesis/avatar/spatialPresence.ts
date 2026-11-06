/**
 * ==========================================================
 * LÉLU — WHERE SHE STANDS, AND WHY
 *
 * Her body was a window in the corner. This decides where that body
 * belongs in the environment that is actually on screen: beside the
 * conversation when there is room, peeking over its top edge when there
 * is not, leaning on the panel she is working with, resting against the
 * edge of the screen when nothing is open — and out of the way when the
 * viewport cannot hold her without covering a control.
 *
 * It reads the EXISTING interface (the chat window, the composer, the
 * open module windows, the dock and its tabs) through the data-lelu-*
 * markers those components already publish. It is not a second layout
 * engine: it never moves the chat, never resizes a panel, and it owns
 * no state the application depends on. If this module returned nothing
 * the app would be exactly as it was, minus her.
 *
 * Two rules it must never break:
 *   • her box never covers the composer or an interactive control,
 *   • reduced motion gets the final position with no travel at all.
 *
 * Pure geometry: `measureSpace` reads the DOM, `planPresence` decides.
 * `planPresence` is deterministic and takes no globals, so the rules
 * below can be tested without a browser.
 * ==========================================================
 */

/* ------------------------------- types -------------------------------- */

/** How much of her the moment calls for. */
export type PresenceMode = "ambient" | "companion" | "interactive";

/**
 * What her body is doing. These are the states the environment can put
 * her in — every one of them is chosen from real app state below.
 */
export type SpatialState =
  | "hidden"
  | "idle"
  | "observing"
  | "peeking"
  | "climbing"
  | "leaning"
  | "resting"
  | "emerging"
  | "retreating"
  | "listening"
  | "speaking"
  | "interacting"
  | "demonstrating"
  | "transitioning";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SpaceLayout {
  viewport: { width: number; height: number };
  /** Safe-area insets: notches, home indicator, rounded corners. */
  safe: Insets;
  /** The conversation window, when it is open and laid out. */
  chat: Rect | null;
  /** Open module / studio / browser windows, front-most first. */
  panels: Rect[];
  /** The chat input. She never covers it. */
  composer: Rect | null;
  /** Interactive chrome: dock, tabs, menus, consent bars. */
  controls: Rect[];
  reducedMotion: boolean;
}

export interface PresenceIntent {
  /** Interactive while you are talking with her; companion with work open. */
  mode: PresenceMode;
  chatOpen: boolean;
  workspaceOpen: boolean;
  /** A capability is being shown and she should stand beside it. */
  demonstrating: boolean;
  speaking: boolean;
  listening: boolean;
  /** You are directly manipulating her (drag, resize, command). */
  interacting: boolean;
  /** A tool is running on your turn. */
  toolActive: boolean;
}

export type Posture = "peek" | "lean" | "sit" | "stand" | "climb" | "retreat" | "center";

export interface AvatarAnchor {
  state: SpatialState;
  mode: PresenceMode;
  /** Her window, in viewport pixels. */
  rect: Rect;
  /** Which interface edge she is attached to. */
  edge: "top" | "right" | "bottom" | "left" | "none";
  posture: Posture;
  /** Motion of her body inside her own box (never the chrome). */
  transform: string;
  opacity: number;
  /** Why this anchor was chosen — evidence, not decoration. */
  reason: string;
  /** 0 under reduced motion. */
  durationMs: number;
  /** No placement keeps her clear: she is gone rather than in the way. */
  hidden: boolean;
  /** Pixel gap kept from controls and the composer. */
  clearance: number;
}

/* ----------------------------- constants ------------------------------ */

const GAP = 10;
const CLEARANCE = 8;
/** Below this a phone viewport cannot hold her next to anything. */
const MIN_USABLE_WIDTH = 300;
const MIN_USABLE_HEIGHT = 420;

const EMERGE_MS = 520;
const RETREAT_MS = 420;
const MOVE_MS = 450;
const STILL_MS = 260;

const POSTURE_TRANSFORM: Record<Posture, string> = {
  // Only her head clears the edge of the thing she is behind.
  peek: "translateY(-9%) scale(0.95) rotate(-4deg)",
  // Weight against the panel boundary, looking into it.
  lean: "translateX(-6%) rotate(-6deg)",
  // Settled on an edge.
  sit: "translateY(-2%) scale(0.98)",
  stand: "none",
  // Mid-climb up an interface edge.
  climb: "translateY(-4%) rotate(3deg) scale(0.97)",
  // Turning away, smaller: leaving, not arriving.
  retreat: "translateY(12%) scale(0.9)",
  center: "none",
};

/* ------------------------------ geometry ------------------------------ */

function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

/** Do two boxes overlap once each is grown by `margin`? Touching is not overlapping. */
export function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.left < b.left + b.width + margin &&
    a.left + a.width + margin > b.left &&
    a.top < b.top + b.height + margin &&
    a.top + a.height + margin > b.top
  );
}

function inside(rect: Rect, space: SpaceLayout, clearance = CLEARANCE): boolean {
  const { safe, viewport } = space;
  return (
    rect.left >= safe.left + clearance &&
    rect.top >= safe.top + clearance &&
    rect.left + rect.width <= viewport.width - safe.right - clearance &&
    rect.top + rect.height <= viewport.height - safe.bottom - clearance
  );
}

function blockedBy(rect: Rect, space: SpaceLayout): string | null {
  if (space.composer && overlaps(rect, space.composer, CLEARANCE)) return "composer";
  for (const control of space.controls) {
    if (overlaps(rect, control, CLEARANCE)) return "control";
  }
  return null;
}

/** Her size for the moment, kept a minority of the viewport. */
export function sizeFor(mode: PresenceMode, viewport: { width: number; height: number }): { width: number; height: number } {
  const phone = viewport.width < 700;
  const base =
    mode === "ambient"
      ? { width: 104, height: 142 }
      : mode === "interactive"
        ? { width: 208, height: 340 }
        : { width: phone ? 120 : 200, height: phone ? 196 : 320 };
  // Never more than a third of a narrow screen, never more than half its height.
  const width = Math.floor(Math.min(base.width, viewport.width * 0.42));
  const height = Math.floor(Math.min(base.height, viewport.height * 0.5));
  return { width, height };
}

/* ------------------------------ decisions ----------------------------- */

/**
 * Which state the environment puts her in. Ordered by what is most
 * visible to you: a demonstration, then her voice, then your turn.
 */
export function spatialStateFor(intent: PresenceIntent): SpatialState {
  if (intent.demonstrating) return "demonstrating";
  if (intent.speaking) return intent.mode === "interactive" ? "speaking" : "observing";
  if (intent.listening) return "listening";
  if (intent.interacting) return "interacting";
  if (intent.toolActive) return intent.workspaceOpen ? "climbing" : "observing";
  if (intent.workspaceOpen) return "leaning";
  if (intent.chatOpen) return intent.mode === "ambient" ? "resting" : "observing";
  return intent.mode === "ambient" ? "resting" : "idle";
}

/** The mode the app state calls for, before any geometry is known. */
export function presenceModeFor(input: {
  chatOpen: boolean;
  workspaceOpen: boolean;
  turnActive: boolean;
  dialogue: string;
}): PresenceMode {
  if (input.turnActive || input.dialogue === "listening") return "interactive";
  if (input.chatOpen || input.workspaceOpen) return "companion";
  return "ambient";
}

function postureFor(state: SpatialState, edge: AvatarAnchor["edge"]): Posture {
  switch (state) {
    case "peeking":
      return "peek";
    case "leaning":
    case "demonstrating":
      return "lean";
    case "climbing":
      return "climb";
    case "resting":
      return edge === "top" || edge === "bottom" ? "peek" : "sit";
    case "retreating":
      return "retreat";
    case "speaking":
    case "listening":
    case "interacting":
      return "stand";
    default:
      return edge === "none" ? "center" : "stand";
  }
}

function anchor(
  rect: Rect,
  edge: AvatarAnchor["edge"],
  state: SpatialState,
  mode: PresenceMode,
  space: SpaceLayout,
  reason: string,
  opacity = 1,
): AvatarAnchor {
  const posture = postureFor(state, edge);
  return {
    state,
    mode,
    rect,
    edge,
    posture,
    transform: space.reducedMotion ? "none" : POSTURE_TRANSFORM[posture],
    opacity,
    reason,
    durationMs: space.reducedMotion ? 0 : state === "emerging" ? EMERGE_MS : state === "retreating" ? RETREAT_MS : state === "resting" ? STILL_MS : MOVE_MS,
    hidden: false,
    clearance: CLEARANCE,
  };
}

/**
 * Place her in the space she has, not the space a design assumed.
 *
 * Tries, in order:
 *   1. beside the conversation (or beside the panel being demonstrated),
 *   2. over the top edge of it — a peek, head and shoulders only,
 *   3. the free right edge of the screen, resting,
 *   4. above the composer on a phone.
 *
 * A candidate is used only if it is inside the safe area and clear of
 * the composer and every control. When none is, she is hidden: an avatar
 * that covers a button is worse than one that steps out.
 */
export function planPresence(space: SpaceLayout, intent: PresenceIntent): AvatarAnchor {
  const state = spatialStateFor(intent);
  const { width, height } = sizeFor(intent.mode, space.viewport);
  const focus = intent.demonstrating ? (space.panels[0] ?? space.chat) : space.chat;

  if (space.viewport.width < MIN_USABLE_WIDTH || space.viewport.height < MIN_USABLE_HEIGHT) {
    return {
      ...anchor({ left: 0, top: 0, width: 0, height: 0 }, "none", "retreating", intent.mode, space, "viewport too small to stand clear of the controls"),
      hidden: true,
      opacity: 0,
      durationMs: 0,
    };
  }

  const candidates: Array<{ rect: Rect; edge: AvatarAnchor["edge"]; reason: string; state?: SpatialState; opacity?: number }> = [];
  const safeBottom = space.viewport.height - space.safe.bottom;

  if (focus) {
    // 1. Beside it, aligned to its top — she stands next to what you are
    //    looking at rather than floating in a corner.
    const besideLeft = focus.left + focus.width + GAP;
    const besideTop = Math.max(space.safe.top + CLEARANCE, Math.min(focus.top + 8, safeBottom - height - CLEARANCE));
    candidates.push({
      rect: { left: besideLeft, top: besideTop, width, height },
      edge: "right",
      reason: intent.demonstrating ? "beside the demonstration" : "beside the conversation",
    });

    // 2. Over its top edge: enough room above for her head to clear it.
    const peekTop = focus.top - height * 0.55;
    if (peekTop > space.safe.top) {
      candidates.push({
        rect: {
          left: Math.min(focus.left + focus.width * 0.55, space.viewport.width - space.safe.right - width - CLEARANCE),
          top: peekTop,
          width,
          height,
        },
        edge: "top",
        reason: "peeking over its top edge",
        state: intent.demonstrating ? "observing" : "peeking",
      });
    }

    // 3. Leaning on its right boundary, half over it — only when the
    //    panel is not the full width of the screen.
    if (focus.width < space.viewport.width * 0.82) {
      candidates.push({
        rect: {
          left: focus.left + focus.width - width * 0.45,
          top: Math.max(space.safe.top + CLEARANCE, focus.top + 24),
          width,
          height,
        },
        edge: "right",
        reason: "leaning over its boundary",
        state: "leaning",
      });
    }
  }

  // 4. The strip above the window, when the screen is mostly window:
  //    head and shoulders over its top edge, outside it entirely. This is
  //    the phone and cramped-panel placement — she never sits in the text.
  if (focus) {
    const top = space.safe.top + CLEARANCE;
    const room = focus.top - top - 4;
    if (room >= 56) {
      const peekHeight = Math.min(height, room);
      const peekWidth = Math.min(width, 140);
      candidates.push({
        rect: {
          left: Math.min(focus.left + focus.width - peekWidth - CLEARANCE, space.viewport.width - space.safe.right - peekWidth - CLEARANCE),
          top,
          width: peekWidth,
          height: peekHeight,
        },
        edge: "top",
        reason: "peeking over its top edge",
        state: "peeking",
      });
    }
  }

  // 5. The free right edge, above the dock: at rest.
  candidates.push({
    rect: {
      left: space.viewport.width - space.safe.right - width - GAP,
      top: Math.max(space.safe.top + CLEARANCE, safeBottom - height - 96),
      width,
      height,
    },
    edge: "right",
    reason: "resting against the screen edge",
    state: intent.mode === "ambient" ? "resting" : state,
    opacity: intent.mode === "ambient" ? 0.82 : 1,
  });

  for (const candidate of candidates) {
    if (!inside(candidate.rect, space)) continue;
    if (blockedBy(candidate.rect, space)) continue;
    // Panels behind her are fine (she stands between windows), the
    // conversation is not: a window she covers is a window you cannot read.
    const result = anchor(candidate.rect, candidate.edge, candidate.state ?? state, intent.mode, space, candidate.reason, candidate.opacity ?? 1);
    // A peeking body reads as peeking, whatever the turn state was.
    if (candidate.state === "peeking") return { ...result, state: "peeking" };
    return result;
  }

  return {
    ...anchor({ left: 0, top: 0, width: 0, height: 0 }, "none", "retreating", intent.mode, space, "no placement stayed clear of the composer and controls"),
    hidden: true,
    opacity: 0,
    durationMs: 0,
  };
}

/**
 * Cost of a placement, for evidence and for choosing between two that
 * are both legal. Lower is better: cover nothing, stay near what is
 * happening, keep her body whole.
 */
export function placementCost(anchorRect: Rect, space: SpaceLayout): number {
  let cost = 0;
  for (const panel of space.panels) cost += overlaps(anchorRect, panel) ? area(anchorRect) * 0.15 : 0;
  if (space.chat && overlaps(anchorRect, space.chat)) cost += area(anchorRect) * 0.5;
  if (space.composer && overlaps(anchorRect, space.composer)) cost += area(anchorRect);
  for (const control of space.controls) if (overlaps(anchorRect, control)) cost += area(anchorRect);
  return Math.round(cost);
}

/* ------------------------------- reading ------------------------------ */

function rectOf(element: Element | null): Rect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

const probeCache = new WeakMap<Document, HTMLElement>();

/** Real env(safe-area-inset-*) values, measured — not assumed to be zero. */
export function measureSafeInsets(doc: Document): Insets {
  if (!doc.body) return { top: 0, right: 0, bottom: 0, left: 0 };
  let probe = probeCache.get(doc);
  if (!probe || !probe.isConnected) {
    probe = doc.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);" +
      "padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);";
    doc.body.appendChild(probe);
    probeCache.set(doc, probe);
  }
  const style = doc.defaultView?.getComputedStyle(probe);
  const px = (value: string | undefined) => {
    const parsed = Number.parseFloat(value ?? "0");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    top: px(style?.paddingTop),
    right: px(style?.paddingRight),
    bottom: px(style?.paddingBottom),
    left: px(style?.paddingLeft),
  };
}

export function prefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Read the live interface. Only elements the app already marks are
 * consulted — no new markup contract, no layout writes.
 */
export function measureSpace(doc: Document = document): SpaceLayout {
  const chatEl = doc.querySelector('[data-lelu-window="chat"]');
  const chat = rectOf(chatEl);
  const composer = rectOf(doc.querySelector("[data-lelu-composer]"));
  const panels: Rect[] = [];
  for (const element of Array.from(doc.querySelectorAll('[data-lelu-module-window], [data-lelu-window]:not([data-lelu-window="chat"])'))) {
    if (element.closest("[data-lelu-chat-window]")) continue;
    const rect = rectOf(element);
    if (rect) panels.push(rect);
  }
  const controls: Rect[] = [];
  for (const element of Array.from(
    doc.querySelectorAll("[data-lelu-dock], [data-lelu-mobile-menu], [data-lelu-tab], [data-lelu-chats-button], [data-lelu-consent]"),
  )) {
    const rect = rectOf(element);
    if (rect) controls.push(rect);
  }
  const view = doc.defaultView;
  const viewport = {
    width: view?.visualViewport?.width ?? view?.innerWidth ?? 0,
    height: view?.visualViewport?.height ?? view?.innerHeight ?? 0,
  };
  return {
    viewport,
    safe: measureSafeInsets(doc),
    chat,
    panels,
    composer,
    controls,
    reducedMotion: prefersReducedMotion(doc),
  };
}

/** True when two readings describe the same space (so React can keep the old one). */
export function sameSpace(a: SpaceLayout, b: SpaceLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
