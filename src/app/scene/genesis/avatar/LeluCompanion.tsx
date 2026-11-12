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
import { planPresence, presenceModeFor, sameSpace, type AvatarAnchor, type Rect, type SpaceLayout } from "./spatialPresence";
import { choosePlace, clampBox, nearestFree, readSpace, rectOf } from "./presencePlacement";
import AvatarStore from "../../../../core/avatar/AvatarProfile";
import CompanionStore, { type CompanionState } from "../../../../core/avatar/CompanionStore";
import { layer, within } from "../../../../core/ui/Layers";
import { CHAT_WINDOW_Z, useGenesis } from "../GenesisCore";
import { useSurface } from "../surface/useSurface";
import { ACTIVITY_ACCENT, useLeluActivity, type LeluActivity } from "./leluActivity";
import LeluCharacter from "./LeluCharacter";
import { FULL_BODY_COMMANDS } from "./LeluBody";
import AvatarCommandBus from "../../../../core/avatar/AvatarCommandBus";

/** Her tools at work: she steps forward to be seen working. */
const TOOL_ACTIVITIES = new Set<LeluActivity>(["SEARCHING", "BROWSING", "WORKING", "BUILDING", "RENDERING", "EXPLORING", "PRESENTING"]);
/** How long she stays forward after tool work ends (no flicker between steps). */
const TOOL_HOLD_MS = 8000;
/** A press that moves less than this is a tap (talk to her), not a drag. */
const DRAG_SLOP = 6;

type Box = Rect;

function viewportSize(): { width: number; height: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    width: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024),
    height: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768),
  };
}

/** The live layout, read from the interface. Polled: panels open and resize without a window event. */
function useSpaceLayout(): SpaceLayout {
  const [space, setSpace] = useState<SpaceLayout>(() => readSpace());
  useEffect(() => {
    const read = () => {
      // A hidden page cannot change its layout, and this poll is a
      // querySelector walk, a handful of getBoundingClientRect calls and a
      // JSON.stringify of the result — twice a second, forever, in every
      // mode. Nothing it could learn exists while the page is hidden.
      if (document.hidden) return;
      setSpace((current) => {
        const next = readSpace();
        return sameSpace(current, next) ? current : next;
      });
    };
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
      if (document.hidden) return;
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
  const underSheet = compact && !surface.cosmosRendered;
  // Her last frame, captured as she paused beside a phone sheet.
  const [still, setStill] = useState<string | null>(null);
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
  // Her canvas size before a sheet took the screen: kept under the sheet,
  // where she is scaled rather than resized (a resize clears the canvas).
  const sizeBeforeSheet = useRef<{ width: number; height: number } | null>(null);
  if (!underSheet) sizeBeforeSheet.current = { width: box.width, height: box.height };
  const drawn = underSheet && sizeBeforeSheet.current ? sizeBeforeSheet.current : { width: box.width, height: box.height };
  const scale = Math.min(1, box.width / drawn.width, box.height / drawn.height);
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
    width: drawn.width,
    height: drawn.height,
    transformOrigin: "top left",
    transform: `translate3d(${Math.round(box.left)}px, ${Math.round(box.top)}px, 0)${scale < 1 ? ` scale(${scale.toFixed(4)})` : ""}`,
    transition: duration ? `transform ${duration}ms ${ease}, width ${duration}ms ${ease}, height ${duration}ms ${ease}, opacity 300ms` : "none",
    // Above workspace windows (so she stays seen), below menus, the
    // composer, notifications and dialogs. Over a phone's full-screen
    // sheet she rests just above it, at the edge spot that avoids its
    // controls — or she would be behind it, unreachable.
    zIndex: live ? layer("panelActive") : underSheet ? CHAT_WINDOW_Z + 10 : within("panel", 45),
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
      data-scene={state.activeScene}
      data-panel={state.activePanel}
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
        {/* Under a phone sheet she stays visible and reachable, PAUSED on
            her last frame: measured on iPhone 13 emulation, any drawing of
            her canvas beside a full-screen sheet stalled the page (60 fps →
            0 after ~15 s; 60 fps throughout with her paused or off). Her
            canvas keeps its size and one captured frame of it is shown,
            scaled to the edge spot; she animates again when it closes. */}
        <LeluCharacter framing={framing} testId="lelu-companion-character" paused={inWorld || underSheet} onStill={underSheet ? setStill : undefined} />
        {underSheet && still ? (
          <img data-testid="lelu-companion-still" src={still} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
        ) : null}
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
            width: compact ? 44 : 28,
            height: compact ? 44 : 28,
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
