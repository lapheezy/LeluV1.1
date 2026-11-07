/**
 * ==========================================================
 * LÉLU — HER PRESENCE (one, everywhere)
 *
 * LÉLU is one presence that lives in the interface, not a window.
 *
 *   ONE SURFACE  — she is mounted once (GenesisScene) with ONE
 *                  LeluCharacter: one canvas, one model upload, one
 *                  animation lifecycle for the whole session. Moving
 *                  between Home, Chat, Studio, graphs, drawings and
 *                  worlds changes where she stands and how she is
 *                  framed — never who she is. Before, each presentation
 *                  (face behind the chat, hero on Home, a floating
 *                  window) mounted its own canvas: every switch rebuilt
 *                  her and re-uploaded ~96 MB of textures.
 *
 *   WHERE        — on Home she takes the hero spot the home reserves
 *                  for her. Everywhere else the existing space planner
 *                  (spatialPresence.planPresence) chooses: beside the
 *                  conversation when there is room, leaning on the panel
 *                  in use, resting at an edge — never over the composer
 *                  or a control. When nothing fits she rests small at
 *                  the least obstructive edge rather than vanish, so she
 *                  stays reachable when Chat or Studio fill the screen.
 *
 *   YOUR HAND    — drag HER (there is no title bar) to put her
 *                  somewhere; tap her to talk. Where you put her is
 *                  kept (CompanionStore, the existing store) until it
 *                  would cover a control — then she steps aside on her
 *                  own and comes back when there is room. "Return"
 *                  gives her back her own judgement.
 *
 *   WORLDS       — in Genesis v2 she stands IN the world (LeluV2Presence),
 *                  so this presence hides and stops drawing, keeping her
 *                  canvas for when you come back.
 *
 *   Cognition, memory, voice and personality are untouched: what she is
 *   doing is read from useLeluActivity, the same signal as before.
 * ==========================================================
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  measureSpace,
  overlaps,
  planPresence,
  presenceModeFor,
  sameSpace,
  type AvatarAnchor,
  type Rect,
  type SpaceLayout,
} from "./spatialPresence";
import AvatarStore from "../../../../core/avatar/AvatarProfile";
import CompanionStore, { type CompanionState } from "../../../../core/avatar/CompanionStore";
import { layer, within } from "../../../../core/ui/Layers";
import { useGenesis } from "../GenesisCore";
import { useSurface } from "../surface/useSurface";
import { ACTIVITY_ACCENT, useLeluActivity, type LeluActivity } from "./leluActivity";
import LeluCharacter from "./LeluCharacter";
import { FULL_BODY_COMMANDS } from "./LeluBody";
import AvatarCommandBus from "../../../../core/avatar/AvatarCommandBus";

/** Her tools at work: she steps forward to be seen working. */
const TOOL_ACTIVITIES = new Set<LeluActivity>(["SEARCHING", "BROWSING", "WORKING", "BUILDING", "RENDERING", "EXPLORING", "PRESENTING"]);
/** How long she stays forward after tool work ends (no flicker between steps). */
const TOOL_HOLD_MS = 8000;
const EDGE = 12;
/** A press that moves less than this is a tap (talk to her), not a drag. */
const DRAG_SLOP = 6;

type Box = Rect;

/** Where she is, and why — the attribute tests and evidence read. */
export type PresencePlace = "hero" | "planned" | "placed" | "edge" | "world";

function viewportSize(): { width: number; height: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    width: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024),
    height: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768),
  };
}

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

function rectOf(element: Element): Rect | null {
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

function clampBox(box: Box, viewport: { width: number; height: number }): Box {
  const width = Math.min(box.width, viewport.width - EDGE * 2);
  const height = Math.min(box.height, viewport.height - EDGE * 2);
  return {
    left: Math.min(Math.max(EDGE, box.left), viewport.width - width - EDGE),
    top: Math.min(Math.max(EDGE, box.top), viewport.height - height - EDGE),
    width,
    height,
  };
}

/** The live layout, read from the interface. Polled: panels open and resize without a window event. */
function useSpaceLayout(): SpaceLayout {
  const [space, setSpace] = useState<SpaceLayout>(() => readSpace());
  useEffect(() => {
    const read = () => setSpace((current) => {
      const next = readSpace();
      return sameSpace(current, next) ? current : next;
    });
    read();
    const timer = setInterval(read, 500);
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    window.visualViewport?.addEventListener("resize", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
      window.visualViewport?.removeEventListener("resize", read);
    };
  }, []);
  return space;
}

/** The home's hero spot, when the home is showing (its rect, followed live). */
function useHeroRect(): Rect | null {
  const [hero, setHero] = useState<Rect | null>(null);
  useEffect(() => {
    const read = () => {
      const el = document.querySelector("[data-lelu-hero-host]");
      const r = el ? rectOf(el) : null;
      setHero((current) => (JSON.stringify(current) === JSON.stringify(r) ? current : r));
    };
    read();
    const timer = setInterval(read, 400);
    window.addEventListener("resize", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", read);
    };
  }, []);
  return hero;
}

export default function LeluCompanion() {
  const [companion, setCompanion] = useState<CompanionState>(() => CompanionStore.getInstance().get());
  useEffect(() => CompanionStore.getInstance().subscribe(setCompanion), []);
  if (!companion.enabled) return null;
  return <Presence companion={companion} />;
}

function Presence({ companion }: { companion: CompanionState }) {
  const { state, openPanel } = useGenesis();
  const surface = useSurface();
  const activity = useLeluActivity();
  const space = useSpaceLayout();
  const hero = useHeroRect();
  const store = CompanionStore.getInstance();
  const viewport = space.viewport.width > 0 ? space.viewport : viewportSize();
  const compact = viewport.width < 600;

  // Tool work keeps her forward a little after it ends (no flicker).
  const [toolsUntil, setToolsUntil] = useState(0);
  const turnActive = Boolean(state.thinking) || state.dialogue === "processing" || state.dialogue === "responding";
  const toolsNow = turnActive && TOOL_ACTIVITIES.has(activity);
  useEffect(() => {
    if (toolsNow) setToolsUntil(Number.POSITIVE_INFINITY);
    else setToolsUntil((until) => (until === Number.POSITIVE_INFINITY ? Date.now() + TOOL_HOLD_MS : until));
  }, [toolsNow]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(toolsUntil) || toolsUntil <= Date.now()) return;
    const timer = setTimeout(() => tick((n) => n + 1), toolsUntil - Date.now() + 20);
    return () => clearTimeout(timer);
  }, [toolsUntil]);
  const toolsInUse = toolsNow || toolsUntil > Date.now();

  // Asked for something that needs all of her (dance, sit, walk off).
  const [bodyUntil, setBodyUntil] = useState(0);
  useEffect(
    () =>
      AvatarCommandBus.getInstance().subscribe((command) => {
        if (!FULL_BODY_COMMANDS.has(command.kind)) return;
        setBodyUntil(Date.now() + (command.kind === "sit" || command.kind === "leave" ? 120_000 : 20_000));
      }),
    [],
  );
  useEffect(() => {
    if (bodyUntil <= Date.now()) return;
    const timer = setTimeout(() => tick((n) => n + 1), bodyUntil - Date.now() + 20);
    return () => clearTimeout(timer);
  }, [bodyUntil]);
  const bodyWanted = bodyUntil > Date.now();

  const [name, setName] = useState(() => AvatarStore.getInstance().get().identity.name || "LÉLU");
  useEffect(() => AvatarStore.getInstance().subscribe((profile) => setName(profile.identity.name || "LÉLU")), []);

  const modulesOpen = Object.entries(state.modules).some(
    ([id, module]) => id !== "chat" && (module.presentation === "inline" || module.presentation === "expanded"),
  );
  const chatOpen = Boolean(space.chat) || state.activePanel === "chat";
  const workspaceInUse = modulesOpen || surface.workspaceOwnsScreen || surface.mode === "workspace" || surface.mode === "agent";
  const inWorld = state.activeScene === "genesisv2";
  const onHome = Boolean(hero) && state.activePanel === "none" && !workspaceInUse && !bodyWanted && !inWorld;

  const mode = presenceModeFor({ chatOpen, workspaceOpen: workspaceInUse, turnActive, dialogue: state.dialogue });
  const plan: AvatarAnchor = planPresence(space, {
    mode,
    chatOpen,
    workspaceOpen: workspaceInUse,
    demonstrating: workspaceInUse && (toolsInUse || activity === "PRESENTING"),
    speaking: Boolean(state.speaking) || state.dialogue === "responding",
    listening: Boolean(state.listening) || state.dialogue === "listening",
    interacting: false,
    toolActive: toolsInUse,
  });

  // Where you put her, while it covers nothing you need.
  const saved = companion.window;
  const placedBox = saved
    ? clampBox({ left: saved.left * viewport.width, top: saved.top * viewport.height, width: saved.width * viewport.width, height: saved.height * viewport.height }, viewport)
    : null;

  // Live drag.
  const [live, setLive] = useState<Box | null>(null);
  const gesture = useRef<{ x: number; y: number; start: Box; moved: boolean } | null>(null);

  const { place, target } = choosePlace({ inWorld, placed: placedBox, onHome, hero, plan, space, compact });
  const box = live ?? target;
  const framing = place === "hero" || box.height < 150 ? "face" : "full";
  const duration = space.reducedMotion ? 0 : live ? 0 : Math.max(plan.durationMs, 520);

  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    gesture.current = { x: event.clientX, y: event.clientY, start: box, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    g.moved = true;
    setLive(clampBox({ ...g.start, left: g.start.left + dx, top: g.start.top + dy }, viewport));
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.moved) {
      // A tap: talk to her.
      if (event.type === "pointerup") openPanel("chat");
      return;
    }
    setLive((current) => {
      // Dropped on a control: the nearest free spot instead of the control.
      const spot = current ? nearestFree(current, readSpace()) : null;
      if (spot) {
        store.setWindow({ left: spot.left / viewport.width, top: spot.top / viewport.height, width: spot.width / viewport.width, height: spot.height / viewport.height });
      }
      return null;
    });
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPanel("chat"); }
    if (event.key === "Escape" || event.key === "Home") { event.preventDefault(); store.dockWindow(); }
  };

  const accent = ACTIVITY_ACCENT[activity];
  const ease = "cubic-bezier(.2,.8,.2,1)";
  const style: CSSProperties = {
    position: "fixed",
    left: 0,
    top: 0,
    width: box.width,
    height: box.height,
    transform: `translate3d(${Math.round(box.left)}px, ${Math.round(box.top)}px, 0)`,
    transition: duration ? `transform ${duration}ms ${ease}, width ${duration}ms ${ease}, height ${duration}ms ${ease}, opacity 300ms` : "none",
    // Above workspace windows (so she stays seen), below menus, the
    // composer, notifications and dialogs (so she never covers a control).
    zIndex: live ? layer("panelActive") : within("panel", 45),
    visibility: inWorld ? "hidden" : "visible",
    opacity: inWorld ? 0 : place === "planned" ? plan.opacity : 1,
    pointerEvents: "none",
    userSelect: "none",
    // No frame, no title bar: only her, with a soft light of what she is doing.
    filter: `drop-shadow(0 10px 18px rgba(0,0,0,0.45)) drop-shadow(0 0 10px ${accent}33)`,
  };

  return (
    <div
      data-testid="lelu-companion"
      data-presence={place}
      data-activity={activity}
      data-framing={framing}
      data-spatial-state={place === "planned" ? plan.state : place}
      data-presence-mode={plan.mode}
      data-posture={place === "planned" ? plan.posture : "stand"}
      data-placement={place === "planned" ? plan.reason : place}
      data-placed={saved ? "true" : "false"}
      style={style}
    >
      {/* Only her visible body takes touches: a posture (peek, lean) moves
          the body inside the box, and the box itself must never block what
          lies under it. */}
      <div
        data-testid="lelu-companion-body"
        role="button"
        tabIndex={inWorld ? -1 : 0}
        aria-label={`${name} — tap to talk, drag to move her${saved ? "; Escape returns her to her own place" : ""}`}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKey}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: inWorld ? "none" : "auto",
          touchAction: "none",
          cursor: live ? "grabbing" : "grab",
          outline: "none",
          transform: place === "planned" ? plan.transform : "none",
          transformOrigin: "bottom center",
          transition: duration ? `transform ${duration}ms ${ease}` : "none",
        }}
      >
        {/* The one canvas: framing and size change, the surface never does. */}
        <LeluCharacter framing={framing} testId="lelu-companion-character" paused={inWorld} fps={compact && !surface.cosmosRendered ? 12 : 30} />
      {saved ? (
        <button
          type="button"
          data-testid="lelu-companion-return"
          aria-label="Return LÉLU to her own place"
          title="Let her choose her place again"
          onClick={() => store.dockWindow()}
          style={{
            position: "absolute",
            right: -6,
            top: -6,
            width: compact ? 36 : 26,
            height: compact ? 36 : 26,
            borderRadius: 999,
            border: `1px solid ${accent}88`,
            background: "rgba(20,12,36,0.82)",
            color: "#efe7ff",
            font: "600 13px system-ui, sans-serif",
            cursor: "pointer",
            padding: 0,
          }}
        >
          ⤓
        </button>
      ) : null}
      </div>
    </div>
  );
}
