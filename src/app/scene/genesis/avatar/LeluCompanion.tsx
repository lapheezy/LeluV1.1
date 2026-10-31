/**
 * ==========================================================
 * LÉLU — THE COMPANION
 *
 * LÉLU's avatar in companion mode: the look you chose (Avatar panel →
 * AvatarStore), floating over the whole app — chat, browser, workspace,
 * Cosmos — while you work. Not a panel, not a window: a figure.
 *
 *   - Mounted ONCE at app level (GenesisScene), so navigating between
 *     surfaces never destroys and recreates her.
 *   - Only her figure takes touches. The overlay around her is
 *     pointer-events: none, so nothing beneath stops working.
 *   - Drag her anywhere: she stays there (pinned). Unpinned, she moves
 *     herself away from what you are using — the field you type in, the
 *     composer, keep-clear controls — and only when she is in the way.
 *   - She moves with what she is REALLY doing: the live activity
 *     (listening, thinking, browsing, working…) from the same reading the
 *     3D presence uses, and her speech as it actually plays — each word
 *     boundary from the speech engine is a beat of her body.
 *   - No caption cards: what she is doing and saying belongs in the
 *     conversation and the notifications, not in a bubble beside her.
 *
 * A photo cannot move its lips: with a saved image she speaks with her
 * whole presence, not a mouth. Real lip-sync needs a rigged model.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AvatarStore from "../../../../core/avatar/AvatarProfile";
import CompanionStore, {
  companionDimensions,
  chooseSpot,
  figureRect,
  type CompanionState,
  type Rect,
} from "../../../../core/avatar/CompanionStore";
import { within } from "../../../../core/ui/Layers";
import { useGenesis } from "../GenesisCore";
import { ACTIVITY_ACCENT, useLeluActivity } from "./leluActivity";
import LeluCharacterStore from "../../../../core/avatar/LeluCharacterStore";
import LeluCharacter from "./LeluCharacter";
import { useLeluCharacter } from "./useLeluCharacter";

function viewportSize(): { width: number; height: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return {
    width: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024),
    height: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768),
  };
}

/**
 * What she must not stand on: every control you could touch (buttons,
 * links, fields), dialogs, anything marked keep-clear — and, weighted
 * far above the rest, the field you are typing in right now.
 */
const INTERACTIVE = "button, a[href], input, textarea, select, [role='button'], [role='tab'], [contenteditable='true'], [data-lelu-keep-clear], [role='dialog'], article.lelu-cc-msg";

function keepClearRects(own: HTMLElement | null): Rect[] {
  if (typeof document === "undefined") return [];
  const { width, height } = viewportSize();
  const rects: Rect[] = [];
  const add = (element: Element, weight: number) => {
    if (own && own.contains(element)) return;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    if (box.right < 0 || box.bottom < 0 || box.left > width || box.top > height) return;
    rects.push({ left: box.left, top: box.top, width: box.width, height: box.height, weight });
  };
  for (const element of document.querySelectorAll(INTERACTIVE)) add(element, 1);
  const active = document.activeElement;
  if (active && active !== document.body) add(active, 12);
  return rects;
}

const MOTION_STYLE = `
@keyframes lelu-companion-in { from { opacity: 0; transform: translateY(18px) scale(0.86); } to { opacity: 1; transform: none; } }
`;

export default function LeluCompanion() {
  const [companion, setCompanion] = useState<CompanionState>(() => CompanionStore.getInstance().get());
  useEffect(() => CompanionStore.getInstance().subscribe(setCompanion), []);
  // In the Genesis V2 world she stands in the scene as her full 3D self
  // (LeluV2Presence, same model and body); a second her over it would be two.
  const { state } = useGenesis();
  if (!companion.enabled || state.activeScene === "genesisv2") return null;
  return <CompanionFigure companion={companion} />;
}

function CompanionFigure({ companion }: { companion: CompanionState }) {
  const store = CompanionStore.getInstance();
  const { openPanel } = useGenesis();
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];

  const [name, setName] = useState(() => AvatarStore.getInstance().get().identity.name || "LÉLU");
  useEffect(() => AvatarStore.getInstance().subscribe((profile) => setName(profile.identity.name || "LÉLU")), []);
  const character = useLeluCharacter();

  const [viewport, setViewport] = useState(viewportSize);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  // Measured once shown, so the controls can be kept inside the screen.
  const [, remeasure] = useState(0);
  useEffect(() => {
    if (controlsOpen) requestAnimationFrame(() => remeasure((n) => n + 1));
  }, [controlsOpen]);

  /* ------------------------------ viewport ------------------------------ */
  useEffect(() => {
    const update = () => setViewport(viewportSize());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  /* ------------------- she moves herself out of the way ----------------- */
  const reconsider = useCallback(() => {
    const current = CompanionStore.getInstance().get();
    if (current.pinned || drag) return;
    const spot = chooseSpot({ x: current.x, y: current.y }, companionDimensions(current.size, current.framing), viewportSize(), keepClearRects(rootRef.current));
    if (spot.moved) CompanionStore.getInstance().placeByLelu(spot.x, spot.y);
  }, [drag]);

  useEffect(() => {
    reconsider();
    const onFocus = () => setTimeout(reconsider, 50);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    // The app changes under her (panels open, the keyboard rises): a cheap
    // look every second and a half, moving only when she is in the way.
    const timer = setInterval(reconsider, 1500);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      clearInterval(timer);
    };
  }, [reconsider, viewport, companion.size, companion.framing, companion.pinned]);

  /* ------------------------- drag: you place her ------------------------- */
  const pressRef = useRef<{ x: number; y: number; moved: boolean; at: number } | null>(null);
  const lastTapRef = useRef(0);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pressRef.current = { x: event.clientX, y: event.clientY, moved: false, at: Date.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (!press) return;
    if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
    press.moved = true;
    setDrag({ x: event.clientX / viewport.width, y: event.clientY / viewport.height });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press?.moved) {
      store.placeByUser(event.clientX / viewport.width, event.clientY / viewport.height);
      setDrag(null);
      return;
    }
    // The input event's own time, not when the handler happens to run: on
    // a busy main thread two quick taps can be handled far apart.
    const now = event.timeStamp;
    if (now - lastTapRef.current < 350) {
      openPanel("chat"); // double tap: talk to her
      setControlsOpen(false);
    } else {
      setControlsOpen((open) => !open);
    }
    lastTapRef.current = now;
  };

  const position = drag ?? { x: companion.x, y: companion.y };
  const dimensions = companionDimensions(companion.size, companion.framing);
  const rect = figureRect(position.x, position.y, dimensions, viewport);
  const { width, height } = dimensions;
  // The controls sit under her, kept inside the screen (measured on phones:
  // centred controls ran off the right edge when she stood near it).
  const controlsWidth = controlsRef.current?.offsetWidth ?? 180;
  const controlsLeft =
    Math.min(Math.max(8, rect.left + width / 2 - controlsWidth / 2), Math.max(8, viewport.width - controlsWidth - 8)) - rect.left;
  const nextSize = useMemo(() => (companion.size === "small" ? "medium" : companion.size === "medium" ? "large" : "small"), [companion.size]);

  return (
    <div
      ref={rootRef}
      data-testid="lelu-companion"
      data-activity={activity}
      data-pinned={companion.pinned ? "true" : "false"}
      style={{
        position: "fixed",
        inset: 0,
        // Above toasts, below the command palette and modals.
        zIndex: within("notification", 50),
        pointerEvents: "none", // the screen beneath keeps working
      }}
    >
      <style>{MOTION_STYLE}</style>
      <div
        style={{
          position: "absolute",
          left: rect.left,
          top: rect.top,
          width,
          height,
          transition: drag ? "none" : "left 600ms cubic-bezier(.2,.8,.2,1), top 600ms cubic-bezier(.2,.8,.2,1)",
          animation: "lelu-companion-in 420ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Her, and nothing around her: no card, no frame, no background.
            The shadow follows her outline, not a box. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`${name} — companion. Drag to move, tap for options, double-tap to chat.`}
          data-testid="lelu-companion-figure"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            pressRef.current = null;
            setDrag(null);
          }}
          onDoubleClick={() => {
            // The browser's own double-click detection (mouse); touch uses
            // the tap timing above.
            openPanel("chat");
            setControlsOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") openPanel("chat");
          }}
          style={{
            pointerEvents: "auto",
            width: "100%",
            height: "100%",
            cursor: drag ? "grabbing" : "grab",
            touchAction: "none",
            userSelect: "none",
            filter: `drop-shadow(0 8px 12px rgba(0,0,0,0.45))${activity !== "IDLE" ? ` drop-shadow(0 0 7px ${accent}55)` : ""}`,
            transition: "filter 300ms ease",
          }}
        >
          <LeluCharacter framing={companion.framing} testId="lelu-companion-character" />
        </div>


        {controlsOpen && !drag ? (
          <div
            ref={controlsRef}
            data-testid="lelu-companion-controls"
            style={{
              pointerEvents: "auto",
              position: "absolute",
              left: controlsLeft,
              ...(rect.top + height + 44 < viewport.height ? { top: height + 6 } : { bottom: height + 6 }),
              display: "flex",
              gap: 4,
              padding: 4,
              borderRadius: 12,
              background: "rgba(14,10,22,0.94)",
              border: "1px solid rgba(255,255,255,0.12)",
              whiteSpace: "nowrap",
              // Six controls are wider than a phone: they wrap, inside the screen.
              flexWrap: "wrap",
              justifyContent: "center",
              width: "max-content",
              maxWidth: Math.max(160, viewport.width - 16),
              boxSizing: "border-box", // the cap includes padding and border
            }}
          >
            {[
              { label: "Chat", act: () => openPanel("chat") },
              { label: `Size: ${nextSize}`, act: () => store.setSize(nextSize) },
              { label: companion.framing === "full" ? "Face" : "Full body", act: () => store.setFraming(companion.framing === "full" ? "face" : "full") },
              {
                label: character.form === "hologram" ? "Embodied" : "Hologram",
                act: () => LeluCharacterStore.getInstance().setForm(character.form === "hologram" ? "embodied" : "hologram"),
              },
              ...(companion.pinned ? [{ label: "Let her choose", act: () => store.unpin() }] : []),
              { label: "Hide", act: () => store.setEnabled(false) },
            ].map((control) => (
              <button
                key={control.label}
                type="button"
                onClick={() => {
                  control.act();
                  setControlsOpen(false);
                }}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 8px",
                  background: "rgba(255,255,255,0.08)",
                  color: "#efe7ff",
                  font: "600 11px system-ui, sans-serif",
                  cursor: "pointer",
                }}
              >
                {control.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
