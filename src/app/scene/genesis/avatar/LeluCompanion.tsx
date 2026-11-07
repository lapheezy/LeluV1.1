/**
 * ==========================================================
 * LÉLU — THE COMPANION
 *
 * Her 3D self (the approved Forge model, through LeluCharacter /
 * LeluBody) with you everywhere, in one of two presences she switches
 * between on her own:
 *
 *   FACE    — while you are simply talking with her: her face, large and
 *             soft, BEHIND the conversation inside the chat window (its
 *             data-lelu-face-host layer, between the sky and the text).
 *             Under every word, never over one; it takes no touches.
 *
 *   WINDOW  — when a workspace, a module or her tools are in use (or the
 *             chat is closed): all of her, in her own small window docked
 *             in the right corner, beside the chat box when there is room.
 *             You can move it (drag its top bar) and resize it (the corner
 *             grip); it stays where you put it until you dock it again.
 *
 *   - Mounted ONCE at app level (GenesisScene); the parsed model is
 *     shared between presences (LeluBody), so switching is cheap.
 *   - Driven by what she is REALLY doing (useLeluActivity — the agent
 *     event bus and the live dialogue), the same reading the Cosmos uses.
 *   - No caption cards.
 *   - In Genesis V2 she stands in the world itself, so neither presence
 *     is shown there.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import AvatarStore from "../../../../core/avatar/AvatarProfile";
import CompanionStore, { type CompanionState } from "../../../../core/avatar/CompanionStore";
import { layer, within } from "../../../../core/ui/Layers";
import { useGenesis } from "../GenesisCore";
import { useSurface } from "../surface/useSurface";
import { useWorkspace } from "../useWorkspace";
import { chatFillsScreen } from "../chat/chatLayout";
import { ACTIVITY_ACCENT, useLeluActivity, type LeluActivity } from "./leluActivity";
import LeluCharacter from "./LeluCharacter";
import { FULL_BODY_COMMANDS } from "./LeluBody";
import AvatarCommandBus from "../../../../core/avatar/AvatarCommandBus";

/** Her tools at work: she steps out of the backdrop to be seen working. */
const TOOL_ACTIVITIES = new Set<LeluActivity>(["SEARCHING", "BROWSING", "WORKING", "BUILDING", "RENDERING", "EXPLORING", "PRESENTING"]);
/** How long she stays in her window after tool work ends (no flicker between steps). */
const TOOL_HOLD_MS = 8000;

const EDGE = 12;
const MIN_W = 100;
const MIN_H = 160;

export type CompanionPresence = "face" | "window" | "hero";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function viewportSize(): { width: number; height: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    width: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024),
    height: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768),
  };
}

/** The chat window and its face layer, looked up live (the chat mounts and unmounts). */
function useChatGeometry(): { host: HTMLElement | null; hero: HTMLElement | null; chat: Box | null; viewport: { width: number; height: number } } {
  const [geometry, setGeometry] = useState(() => ({ host: null as HTMLElement | null, hero: null as HTMLElement | null, chat: null as Box | null, viewport: viewportSize() }));
  useEffect(() => {
    const read = () => {
      const host = document.querySelector<HTMLElement>("[data-lelu-face-host]");
      // The home's hero spot (home/CosmosHome), when the home is showing.
      const hero = document.querySelector<HTMLElement>("[data-lelu-hero-host]");
      const r = document.querySelector("[data-lelu-chat-window]")?.getBoundingClientRect();
      const chat = r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
      const viewport = viewportSize();
      setGeometry((current) =>
        current.host === host &&
        current.hero === hero &&
        current.viewport.width === viewport.width &&
        current.viewport.height === viewport.height &&
        JSON.stringify(current.chat) === JSON.stringify(chat)
          ? current
          : { host, hero, chat, viewport },
      );
    };
    read();
    const timer = setInterval(read, 400);
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
    };
  }, []);
  return geometry;
}

/** Where her window docks: beside the chat box when it fits, else the right corner. */
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
  // The right corner, above a phone composer / the desktop dock.
  // Clear of the spatial navigation bar (and its raised orb) at the bottom.
  return { left: viewport.width - width - EDGE, top: Math.max(EDGE, viewport.height - height - (compact ? 116 : 108)), width, height };
}

function clampBox(box: Box, viewport: { width: number; height: number }): Box {
  const width = Math.min(Math.max(MIN_W, box.width), viewport.width - EDGE * 2);
  const height = Math.min(Math.max(MIN_H, box.height), viewport.height - EDGE * 2);
  const left = Math.min(Math.max(EDGE, box.left), viewport.width - width - EDGE);
  const top = Math.min(Math.max(EDGE, box.top), viewport.height - height - EDGE);
  return { left, top, width, height };
}

export default function LeluCompanion() {
  const [companion, setCompanion] = useState<CompanionState>(() => CompanionStore.getInstance().get());
  useEffect(() => CompanionStore.getInstance().subscribe(setCompanion), []);
  const { state } = useGenesis();
  // In the Genesis V2 world she stands in the scene as her full 3D self
  // (LeluV2Presence, same model and body); a second her over it would be two.
  if (!companion.enabled || state.activeScene === "genesisv2") return null;
  return <Companion companion={companion} />;
}

function Companion({ companion }: { companion: CompanionState }) {
  const { state, openPanel } = useGenesis();
  const surface = useSurface();
  const workspace = useWorkspace();
  const compact = chatFillsScreen(workspace);
  const activity = useLeluActivity();
  const { host, hero, chat, viewport } = useChatGeometry();

  // Tool work keeps her in her window a little after it ends.
  const [toolsUntil, setToolsUntil] = useState(0);
  // Only tools working on YOUR turn count. Her background cognition
  // (self-study, research) runs tools all the time; reading that as "tools
  // in use" flipped her between face and window every few seconds.
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

  // Asked for something that needs all of her (dance, sit, walk off): her
  // window opens for it, for long enough to watch — longer to sit or leave.
  const [bodyUntil, setBodyUntil] = useState(0);
  useEffect(
    () =>
      AvatarCommandBus.getInstance().subscribe((command) => {
        if (!FULL_BODY_COMMANDS.has(command.kind)) return;
        const hold = command.kind === "sit" || command.kind === "leave" ? 120_000 : 20_000;
        setBodyUntil(Date.now() + hold);
      }),
    [],
  );
  useEffect(() => {
    if (bodyUntil <= Date.now()) return;
    const timer = setTimeout(() => tick((n) => n + 1), bodyUntil - Date.now() + 20);
    return () => clearTimeout(timer);
  }, [bodyUntil]);
  const bodyWanted = bodyUntil > Date.now();

  const modulesOpen = Object.entries(state.modules).some(
    ([id, module]) => id !== "chat" && (module.presentation === "inline" || module.presentation === "expanded"),
  );
  const chatOpen = state.activePanel === "chat" && Boolean(host);
  const workspaceInUse = modulesOpen || surface.workspaceOwnsScreen || surface.mode === "workspace" || surface.mode === "agent";
  const presence: CompanionPresence = chatOpen && !workspaceInUse && !toolsInUse && !bodyWanted ? "face" : "window";

  // On a phone a full-screen sheet (a conversation, an artifact) covers
  // her window completely. Rendering it there drew a WebGL scene nobody
  // could see, and in a software-GL browser that canvas stalled the GPU
  // channel for ~35 s after a turn — the page produced no frames at all.
  // She unmounts with the rest of the scene, as Home and Cosmos do; her
  // face behind the classic chat panel is visible and stays.
  if (presence === "window" && !surface.cosmosRendered) return null;

  if (presence === "face" && host) {
    return createPortal(<FaceBackdrop activity={activity} />, host);
  }
  // On the home she is its hero: her face, in the middle of her workspace.
  if (hero && state.activePanel === "none" && !workspaceInUse && !bodyWanted) {
    return createPortal(<HeroPresence activity={activity} />, hero);
  }
  return (
    <CompanionWindow
      companion={companion}
      activity={activity}
      viewport={viewport}
      docked={dockedWindow(viewport, state.activePanel === "chat" ? chat : null, compact)}
      onOpenChat={() => openPanel("chat")}
    />
  );
}

/** Face mode: her face behind the conversation, softly faded at the edges. */
function FaceBackdrop({ activity }: { activity: LeluActivity }) {
  return (
    <div
      data-testid="lelu-companion"
      data-presence="face"
      data-activity={activity}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: 0.5,
        // Faded toward the edges and the composer, so text stays readable.
        WebkitMaskImage: "radial-gradient(ellipse 62% 52% at 50% 40%, #000 35%, transparent 100%)",
        maskImage: "radial-gradient(ellipse 62% 52% at 50% 40%, #000 35%, transparent 100%)",
      }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: "4%", height: "74%" }}>
        <LeluCharacter framing="face" testId="lelu-companion-character" />
      </div>
    </div>
  );
}

/** Hero: her face at the centre of the home (home/CosmosHome's hero spot). */
function HeroPresence({ activity }: { activity: LeluActivity }) {
  return (
    <div data-testid="lelu-companion" data-presence="hero" data-activity={activity} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <LeluCharacter framing="face" testId="lelu-companion-character" />
    </div>
  );
}

/** Window mode: all of her, docked in the right corner; movable and resizable. */
function CompanionWindow({
  companion,
  activity,
  viewport,
  docked,
  onOpenChat,
}: {
  companion: CompanionState;
  activity: LeluActivity;
  viewport: { width: number; height: number };
  docked: Box;
  onOpenChat: () => void;
}) {
  const store = CompanionStore.getInstance();
  const accent = ACTIVITY_ACCENT[activity];
  const [name, setName] = useState(() => AvatarStore.getInstance().get().identity.name || "LÉLU");
  useEffect(() => AvatarStore.getInstance().subscribe((profile) => setName(profile.identity.name || "LÉLU")), []);

  const saved = companion.window;
  const placed: Box | null = saved
    ? clampBox(
        { left: saved.left * viewport.width, top: saved.top * viewport.height, width: saved.width * viewport.width, height: saved.height * viewport.height },
        viewport,
      )
    : null;
  const [live, setLive] = useState<Box | null>(null); // while dragging / resizing
  const box = live ?? placed ?? docked;

  const gesture = useRef<{ kind: "move" | "resize"; x: number; y: number; start: Box } | null>(null);
  const begin = (kind: "move" | "resize") => (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    gesture.current = { kind, x: event.clientX, y: event.clientY, start: box };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    const next =
      g.kind === "move"
        ? { ...g.start, left: g.start.left + dx, top: g.start.top + dy }
        : // The grip is the top-left corner: the window grows up and left, its
          // docked corner (bottom-right) stays put.
          { left: g.start.left + dx, top: g.start.top + dy, width: g.start.width - dx, height: g.start.height - dy };
    setLive(clampBox(next, viewport));
  };
  const end = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    setLive((current) => {
      if (g && current) {
        store.setWindow({
          left: current.left / viewport.width,
          top: current.top / viewport.height,
          width: current.width / viewport.width,
          height: current.height / viewport.height,
        });
      }
      return null;
    });
  }, [store, viewport]);

  const buttonStyle = {
    border: "none",
    background: "transparent",
    color: "rgba(239,231,255,0.8)",
    font: "600 12px system-ui, sans-serif",
    width: 22,
    height: 22,
    borderRadius: 6,
    cursor: "pointer",
    padding: 0,
  } as const;

  return (
    <div
      data-testid="lelu-companion"
      data-presence="window"
      data-activity={activity}
      data-docked={saved ? "false" : "true"}
      role="complementary"
      aria-label={`${name} — her window. Drag the top bar to move it, the corner grip to resize it.`}
      style={{
        position: "fixed",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        // Above the chat box and workspace windows (so she stays seen), below
        // menus, tabs, the composer, notifications and dialogs (so she never
        // covers a control). Raised while you are moving or resizing her.
        zIndex: live ? layer("panelActive") : within("panel", 45),
        borderRadius: 16,
        overflow: "hidden",
        background: "linear-gradient(180deg, rgba(30,18,52,0.55), rgba(14,10,22,0.72))",
        border: `1px solid ${accent}55`,
        boxShadow: `0 12px 32px rgba(0,0,0,0.45), 0 0 18px ${accent}22`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        transition: live ? "none" : "left 450ms cubic-bezier(.2,.8,.2,1), top 450ms cubic-bezier(.2,.8,.2,1), width 450ms, height 450ms",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar: drag to move. */}
      <div
        data-testid="lelu-companion-bar"
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          flex: "0 0 26px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 4px 0 22px",
          cursor: live ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
          color: "#efe7ff",
          font: "600 11px system-ui, sans-serif",
          letterSpacing: "0.08em",
        }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: accent, boxShadow: `0 0 6px ${accent}` }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {saved ? (
          <button type="button" title="Dock her beside the chat" aria-label="Dock her window" onClick={() => store.dockWindow()} style={buttonStyle}>
            ⤓
          </button>
        ) : null}
        <button type="button" title="Hide" aria-label="Hide her window" onClick={() => store.setEnabled(false)} style={buttonStyle}>
          ✕
        </button>
      </div>

      {/* All of her. Double-click / double-tap: talk to her. */}
      <div style={{ flex: 1, minHeight: 0 }} onDoubleClick={onOpenChat}>
        <LeluCharacter framing="full" testId="lelu-companion-character" />
      </div>

      {/* Corner grip: drag to resize (grows up and to the left). */}
      <div
        data-testid="lelu-companion-resize"
        role="separator"
        aria-label="Resize her window"
        onPointerDown={begin("resize")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 20,
          height: 20,
          cursor: "nwse-resize",
          touchAction: "none",
          background: `linear-gradient(135deg, ${accent}aa 0 22%, transparent 23%)`,
          borderTopLeftRadius: 16,
        }}
      />
    </div>
  );
}
