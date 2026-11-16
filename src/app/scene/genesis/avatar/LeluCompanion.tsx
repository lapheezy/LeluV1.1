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
 *   HOW (M15.3)  — this presence is also the authority for HOW she shows:
 *                  the interface she is in asks for a framing and a form
 *                  (presentationProfile.choosePresentation): her portrait
 *                  on Home, all of her in creative work and roomy chat, a
 *                  compact projection beside engineering and browser work.
 *                  A form or framing chosen by the person or by her
 *                  (LeluCharacterStore) wins. She is never hidden because
 *                  windows fill the screen: she rests compact at the least
 *                  obstructive edge instead, still live. Behind a modal
 *                  sheet (the App Library) she stays visible and live but
 *                  under it, so the sheet's controls take their own touches.
 *
 *   Cognition, memory, voice and personality are untouched: what she is
 *   doing is read from useLeluActivity, the same signal as before.
 * ==========================================================
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { planPresence, presenceModeFor, sameSpace, type AvatarAnchor, type Rect, type SpaceLayout } from "./spatialPresence";
import { blocksSomething, choosePlace, clampBox, nearestFree, readSpace, rectOf } from "./presencePlacement";
import AvatarStore from "../../../../core/avatar/AvatarProfile";
import CompanionStore, { type CompanionState } from "../../../../core/avatar/CompanionStore";
import { layer, within } from "../../../../core/ui/Layers";
import { CHAT_WINDOW_Z, useGenesis } from "../GenesisCore";
import { useSurface } from "../surface/useSurface";
import { ACTIVITY_ACCENT, useLeluActivity, type LeluActivity } from "./leluActivity";
import LeluCharacter from "./LeluCharacter";
import { FULL_BODY_COMMANDS } from "./LeluBody";
import AvatarCommandBus from "../../../../core/avatar/AvatarCommandBus";
import { useLeluCharacter } from "./useLeluCharacter";
import { choosePresentation, contextOf, restsOnStill } from "./presentationProfile";
import { isUniverseOpen, setUniverseOpen, useUniverseOpen } from "../chat/universe/universeOpen";
import { useRenderProfile } from "../SceneRenderManager";

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

/** Whether a part of the interface is in the page: a modal sheet, the Home. */
function usePresent(selector: string): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    /*
     * One lookup per 40 ms burst, however many nodes a streaming reply adds.
     * A timer, not requestAnimationFrame: frames can be far apart on a slow
     * device (measured ~0.5 s here), and her touches must come back as soon
     * as a sheet closes.
     */
    let timer = 0;
    const read = () => {
      timer = 0;
      setPresent(Boolean(document.querySelector(selector)));
    };
    read();
    const observer = new MutationObserver(() => {
      if (!timer) timer = window.setTimeout(read, 40);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [selector]);
  return present;
}

/** A reserved spot for her (its rect, followed live): the home's hero spot, the Avatar panel's preview. */
function useHeroRect(selector = "[data-lelu-hero-host]"): Rect | null {
  const [hero, setHero] = useState<Rect | null>(null);
  useEffect(() => {
    const read = () => {
      if (document.hidden) return;
      const el = document.querySelector(selector);
      const r = el ? rectOf(el) : null;
      setHero((current) => (JSON.stringify(current) === JSON.stringify(r) ? current : r));
    };
    read();
    /*
     * The spot appearing or disappearing (the Avatar panel opening/closing)
     * is followed within one 40 ms burst, like usePresent. M15.3 WP03
     * measured the 400 ms timer alone, starved by the long tasks after a
     * window closes, leaving her in a closed panel's spot for up to 4.2 s.
     * The timer stays for moves of a spot that do not change the DOM.
     */
    let burst = 0;
    const observer = new MutationObserver(() => {
      if (!burst) burst = window.setTimeout(() => { burst = 0; read(); }, 40);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setInterval(read, 400);
    window.addEventListener("resize", read);
    return () => {
      observer.disconnect();
      if (burst) window.clearTimeout(burst);
      clearInterval(timer);
      window.removeEventListener("resize", read);
    };
  }, [selector]);
  return hero;
}

export default function LeluCompanion() {
  const [companion, setCompanion] = useState<CompanionState>(() => CompanionStore.getInstance().get());
  useEffect(() => CompanionStore.getInstance().subscribe(setCompanion), []);
  if (!companion.enabled) return null;
  return <Presence companion={companion} />;
}

function Presence({ companion }: { companion: CompanionState }) {
  const { state, openPanel, minimizeModule } = useGenesis();
  const surface = useSurface();
  const activity = useLeluActivity();
  const space = useSpaceLayout();
  const hero = useHeroRect();
  // The Avatar panel's preview spot: she stands in it herself.
  const previewRect = useHeroRect("[data-lelu-preview-host]");
  /*
   * The panel closing is known in the SAME commit that removes it (its module
   * leaves `state.modules`); the DOM spot is only seen by the hook a task
   * later, which long tasks after a close delayed by 1–3 s (M15.3 WP03). Once
   * the Avatar module has been seen open, its closing ends the preview at
   * once. (Hosts that show the panel without that module rely on the spot.)
   */
  const avatarModule = state.modules.avatar;
  const sawAvatarModule = useRef(false);
  if (avatarModule) sawAvatarModule.current = true;
  const avatarModuleClosed = sawAvatarModule.current && (!avatarModule || avatarModule.presentation === "closed" || avatarModule.presentation === "minimized");
  if (!avatarModule && !previewRect) sawAvatarModule.current = false;
  const previewSpot = avatarModuleClosed ? null : previewRect;
  // A modal sheet (App Library, Windows, Worlds) is open over the interface.
  const sheetOpen = usePresent(".lsh-backdrop");
  const universeOpen = useUniverseOpen();
  const homeShown = usePresent("[data-lelu-home]");
  const character = useLeluCharacter();
  const renderProfile = useRenderProfile();
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
  /*
   * When the Workspace Steward has filled the screen with windows there is no
   * free spot left for her, and the planner's "best" spot is on top of
   * someone's work.
   */
  const windowCover = space.panels.reduce((sum, r) => sum + r.width * r.height, 0) / Math.max(1, viewport.width * viewport.height);
  /*
   * Windows fill the screen: she used to be HIDDEN here (yet her canvas kept
   * drawing). She now takes the least obstructive edge, compact — present,
   * reachable, never on someone's work.
   */
  const crowded = modulesOpen && windowCover > 0.5;
  const underSheet = compact && !surface.cosmosRendered;
  // The window she is beside: the top-most open one, else the active panel.
  const focused =
    Object.entries(state.modules)
      .filter(([id, m]) => id !== "chat" && (m.presentation === "inline" || m.presentation === "expanded"))
      .sort((a, b) => (b[1].zIndex ?? 0) - (a[1].zIndex ?? 0) || b[1].updatedAt - a[1].updatedAt)[0]?.[0] ??
    (state.activePanel !== "none" ? state.activePanel : null);
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

  const { place, target } = choosePlace({ inWorld, placed: placedBox, onHome, hero, plan: crowded ? { ...plan, hidden: true } : plan, space, compact, preview: inWorld ? null : previewSpot });
  const box = live ?? target;
  /*
   * Her canvas keeps its size when her place merely shrinks (Home portrait →
   * an edge spot): it is scaled down instead. Resizing a WebGL canvas
   * reallocates its (multisampled) drawing buffers — measured ~0.6 s on a
   * phone-size screen switch (M15.3 WP02). It is resized when she grows, or
   * would shrink below about half.
   */
  const [drawn, setDrawn] = useState<{ width: number; height: number }>(() => ({ width: box.width, height: box.height }));
  const fitsDrawn = box.width <= drawn.width + 0.5 && box.height <= drawn.height + 0.5;
  const shrink = Math.min(box.width / drawn.width, box.height / drawn.height);
  // A screen switch passes through transient places (measured: a larger
  // planned box for ~300 ms before her edge spot, which resized her canvas
  // twice). She grows her canvas only for a place that lasts; a drag is live.
  useEffect(() => {
    if (fitsDrawn && shrink >= 0.4) return;
    const grow = !fitsDrawn;
    if (live || !grow) {
      setDrawn((d) => (d.width === box.width && d.height === box.height ? d : { width: box.width, height: box.height }));
      return;
    }
    const timer = window.setTimeout(() => setDrawn({ width: box.width, height: box.height }), 500);
    return () => window.clearTimeout(timer);
  }, [fitsDrawn, shrink, live, box.width, box.height]);
  const scale = Math.min(1, box.width / drawn.width, box.height / drawn.height);
  const context = place === "preview" ? "preview" : contextOf({ onHome: onHome || (homeShown && state.activePanel === "none" && !workspaceInUse && !inWorld && !universeOpen), inWorld, chatOpen: chatOpen || universeOpen, focused });
  const presentation = choosePresentation({
    context,
    boxHeight: box.height,
    hero: place === "hero",
    userForm: character.form,
    userFraming: character.framing,
  });
  const { framing, form } = presentation;
  /*
   * Her rate: 24 fps; ~12 beside a phone's full-screen sheet, with reduced
   * motion, or on a device the render manager measured as light. Never 0
   * while she is in view (that was the freeze).
   */
  const fps = underSheet || space.reducedMotion || renderProfile === "light" ? 12 : 24;
  /*
   * Low-power rest: ONLY on a device the render manager measured as "light"
   * (a software renderer, no WebGL, or data saver) and only beside a phone's
   * full-screen sheet. Measured in M15.3 (393×852, SwiftShader): with any
   * element animating over that sheet — her canvas, or even a plain 2D canvas
   * changing 4×/s — the page fell from ~42 to 2–7 fps; it is the software
   * compositor, not her drawing (her canvas hidden but still drawing: 42 fps).
   * There she rests: her canvas keeps showing a frame of her (redrawn once
   * when her form, framing or size changes; no readback) and she resumes the
   * moment the sheet closes. On a real GPU she stays live everywhere (before M15.3 she
   * was frozen beside every phone sheet on every device).
   */
  const lowPowerRest = restsOnStill({ besidePhoneSheet: underSheet, renderProfile });
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

  /*
   * Asked to move across the interface ("move to the left", "go back to your
   * spot"): over the interface her places are sides of the screen. Confirmed
   * only when her element has measurably moved there. In a world, the world
   * presence takes movement instead.
   */
  const latest = useRef({ box, viewport, inWorld, workspaceOwnsScreen: surface.workspaceOwnsScreen, modules: state.modules });
  latest.current = { box, viewport, inWorld, workspaceOwnsScreen: surface.workspaceOwnsScreen, modules: state.modules };
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    () =>
      AvatarCommandBus.getInstance().subscribe((command) => {
        const where = command.target?.place;
        /*
         * Asked to walk or turn in her world while, on a phone, the chat
         * window owns the screen: her world is not mounted under it, so she
         * could never act "where you can watch" (M15.3 WP04: every phone walk
         * timed out). She steps out of the chat the way the workspace bar's
         * "windows keep running" does: the chat window is minimized, not
         * closed, and her reply waits in it. Only chat windows; never other
         * work. Her world presence then takes the command from the bus.
         */
        if (latest.current.inWorld && where && (command.kind === "move" || command.kind === "look") && latest.current.workspaceOwnsScreen) {
          for (const [id, m] of Object.entries(latest.current.modules)) {
            if (id.startsWith("chat") && (m.presentation === "inline" || m.presentation === "expanded")) minimizeModule(id);
          }
        }
        // And the Universe itself, as her world presence does once mounted
        // (on a phone it is not mounted until the chat stops covering it).
        if (latest.current.inWorld && where && (command.kind === "move" || command.kind === "look") && isUniverseOpen()) setUniverseOpen(false);
        if (latest.current.inWorld || command.kind !== "move" || !where) return;
        if (where !== "left" && where !== "right" && where !== "center" && where !== "home") return;
        const before = rootRef.current?.getBoundingClientRect();
        if (where === "home") {
          store.dockWindow();
        } else {
          const { box: b, viewport: vp } = latest.current;
          const left = where === "left" ? 8 : where === "right" ? vp.width - b.width - 8 : (vp.width - b.width) / 2;
          const room = readSpace();
          // Anywhere along that side that covers nothing you need, then the
          // nearest free spot to it; never on a control.
          const heights = [b.top, 0.5, 0.33, 0.66, 0.2, 0.8].map((f, i) => (i === 0 ? f : (vp.height - b.height) * f));
          const along = heights.map((top) => clampBox({ left, top, width: b.width, height: b.height }, vp));
          const spot = along.find((c) => !blocksSomething(c, room)) ?? nearestFree(along[0], room);
          if (!spot) {
            AvatarCommandBus.getInstance().decline(command.id, `every spot on the ${where} of the screen would cover a control you are using, so I stayed where I am`);
            return;
          }
          store.setWindow({ left: spot.left / vp.width, top: spot.top / vp.height, width: spot.width / vp.width, height: spot.height / vp.height });
        }
        // Confirmed from her measured position as her move eases in (it can
        // take over a second); "home" is her own place by definition.
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          const after = rootRef.current?.getBoundingClientRect();
          const moved = before && after ? Math.hypot(after.left - before.left, after.top - before.top) : 0;
          if (where === "home" || moved > 4) {
            window.clearInterval(timer);
            AvatarCommandBus.getInstance().confirm(command.id, where === "home" ? "back in her own place on the interface" : `moved ${Math.round(moved)} px to the ${where} of the screen (now at x ${Math.round(after?.left ?? 0)})`);
          } else if (Date.now() - startedAt > 4000) {
            window.clearInterval(timer);
          }
        }, 150);
      }),
    // store and space flags are stable for this purpose; positions come from `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
    // Behind an open modal sheet she stays in view (dimmed with the rest of
    // the interface) but under it: the sheet's own controls take touches.
    zIndex: place === "preview" ? layer("panelActive") + 1 : live ? layer("panelActive") : sheetOpen ? 1 : underSheet ? CHAT_WINDOW_Z + 10 : within("panel", 45),
    visibility: inWorld ? "hidden" : "visible",
    opacity: inWorld ? 0 : place === "planned" ? plan.opacity : 1,
    pointerEvents: "none",
    userSelect: "none",
    // No frame, no title bar: only her, with a soft light of what she is doing.
    filter: `drop-shadow(0 10px 18px rgba(0,0,0,0.45)) drop-shadow(0 0 10px ${accent}33)`,
  };

  return (
    <div
      ref={rootRef}
      data-testid="lelu-companion"
      data-presence={place}
      data-crowded={crowded ? "true" : "false"}
      data-activity={activity}
      data-framing={framing}
      data-form={form}
      data-context={context}
      data-presentation-reason={presentation.reason}
      data-sheet={sheetOpen ? "under" : "none"}
      data-low-power={lowPowerRest ? "rest" : "none"}
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
          pointerEvents: inWorld || sheetOpen || place === "preview" ? "none" : "auto",
          touchAction: "none",
          cursor: live ? "grabbing" : "grab",
          outline: "none",
          transform: place === "planned" ? plan.transform : "none",
          transformOrigin: "bottom center",
          transition: duration ? `transform ${duration}ms ${ease}` : "none",
        }}
      >
        {/* The one canvas: framing and size change, the surface never does. */}
        {/* Paused only where she is not in view here (a world shows her in
            the scene), or in the measured low-power rest above. Beside a
            phone sheet she used to be paused on a captured still on EVERY
            device — frozen on every screen but Home. */}
        <LeluCharacter framing={framing} form={form} fps={fps} testId="lelu-companion-character" paused={inWorld || lowPowerRest} />
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
