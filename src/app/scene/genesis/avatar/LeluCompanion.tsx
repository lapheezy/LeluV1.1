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
 *   - She says what she is doing in a small caption, taken from real
 *     events: the tool that started, the page she opened, the sentence
 *     she is speaking. Nothing invented.
 *
 * A photo cannot move its lips: with a saved image she speaks with her
 * whole presence, not a mouth. Real lip-sync needs a rigged model.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AvatarStore from "../../../../core/avatar/AvatarProfile";
import CompanionStore, {
  COMPANION_DIMENSIONS,
  chooseSpot,
  figureRect,
  type CompanionState,
  type Rect,
} from "../../../../core/avatar/CompanionStore";
import AgentEventBus from "../../../../core/agent/AgentEvents";
import VoiceEngine from "../../../../core/voice/VoiceEngine";
import { within } from "../../../../core/ui/Layers";
import AvatarPortrait from "../AvatarPortrait";
import { useGenesis } from "../GenesisCore";
import { ACTIVITY_ACCENT, useLeluActivity, type LeluActivity } from "./leluActivity";
import { captionForEvent } from "./companionCaption";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

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
const INTERACTIVE = "button, a[href], input, textarea, select, [role='button'], [role='tab'], [contenteditable='true'], [data-lelu-keep-clear], [role='dialog']";

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
  if (!companion.enabled) return null;
  return <CompanionFigure companion={companion} />;
}

function CompanionFigure({ companion }: { companion: CompanionState }) {
  const store = CompanionStore.getInstance();
  const { openPanel } = useGenesis();
  const activity = useLeluActivity();
  const accent = ACTIVITY_ACCENT[activity];

  const [referenceImage, setReferenceImage] = useState<string | null>(() => AvatarStore.getInstance().get().referenceImage);
  const [name, setName] = useState(() => AvatarStore.getInstance().get().identity.name || "LÉLU");
  useEffect(
    () =>
      AvatarStore.getInstance().subscribe((profile) => {
        setReferenceImage(profile.referenceImage);
        setName(profile.identity.name || "LÉLU");
      }),
    [],
  );

  const [viewport, setViewport] = useState(viewportSize);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [caption, setCaption] = useState<{ text: string; at: number } | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pulseRef = useRef(0); // speech beat, decays each frame
  const speakingRef = useRef(false);
  const activityRef = useRef<LeluActivity>(activity);
  activityRef.current = activity;
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
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
    const spot = chooseSpot({ x: current.x, y: current.y }, current.size, viewportSize(), keepClearRects(rootRef.current));
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
  }, [reconsider, viewport, companion.size, companion.pinned]);

  /* ------------------- what she says (real events only) ------------------ */
  useEffect(() => {
    const unsubscribeEvents = AgentEventBus.getInstance().subscribe((event) => {
      const text = captionForEvent(event);
      if (text) setCaption({ text: text.slice(0, 120), at: Date.now() });
    });
    const unsubscribeSpeech = VoiceEngine.getInstance().onSpeechActivity((speech) => {
      speakingRef.current = speech.speaking;
      if (speech.kind === "word") pulseRef.current = 1;
      if (speech.kind === "start" && speech.text) setCaption({ text: speech.text.slice(0, 140), at: Date.now() });
    });
    return () => {
      unsubscribeEvents();
      unsubscribeSpeech();
    };
  }, []);

  useEffect(() => {
    if (!caption) return;
    const timer = setTimeout(() => setCaption((current) => (current?.at === caption.at ? null : current)), 6000);
    return () => clearTimeout(timer);
  }, [caption]);

  /* --------------- her body: breath, lean, gaze, speech beat ------------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const onPointer = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - last < 33) return; // ~30 fps is plenty
      last = now;
      const body = bodyRef.current;
      if (!body) return;
      const t = now / 1000;
      const state = activityRef.current;
      const breathe = Math.sin(t * 1.15) * 0.012;
      const thinking = state === "THINKING" || state === "SEARCHING" || state === "WORKING" || state === "BUILDING" || state === "BROWSING" || state === "RENDERING";
      const sway = thinking ? Math.sin(t * 0.7) * 2.2 : Math.sin(t * 0.45) * 0.8;
      const lean = state === "LISTENING" ? -3.5 : 0;
      pulseRef.current *= 0.82;
      const beat = speakingRef.current ? pulseRef.current : 0;
      // Gaze: a slight turn toward where the user is working.
      let turn = 0;
      const pointer = pointerRef.current;
      if (pointer) {
        const box = body.getBoundingClientRect();
        turn = Math.max(-1, Math.min(1, (pointer.x - (box.left + box.width / 2)) / 600)) * 6;
      }
      body.style.transform =
        `perspective(600px) rotateY(${turn.toFixed(2)}deg) rotate(${(sway + lean).toFixed(2)}deg) ` +
        `translateY(${(-beat * 4).toFixed(2)}px) scale(${(1 + breathe + beat * 0.025).toFixed(4)})`;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

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
  const rect = figureRect(position.x, position.y, companion.size, viewport);
  const { width, height } = COMPANION_DIMENSIONS[companion.size];
  const captionLeftOfHer = rect.left > viewport.width / 2;
  // The caption sits beside her and the controls under her — both kept
  // inside the screen (measured on phones: centred controls ran off the
  // right edge when she stood near it).
  const captionRoom = Math.max(120, captionLeftOfHer ? rect.left - 16 : viewport.width - (rect.left + width) - 16);
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
        <div
          ref={bodyRef}
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
            transformOrigin: "50% 90%",
            borderRadius: 18,
            overflow: "hidden",
            background: "radial-gradient(120% 90% at 50% 20%, #1a1020 0%, #06040a 80%)",
            boxShadow: `0 10px 30px rgba(0,0,0,0.45), 0 0 0 2px ${accent}AA, 0 0 ${speakingRef.current ? 28 : 16}px ${accent}66`,
            transition: "box-shadow 300ms ease",
            userSelect: "none",
          }}
        >
          {referenceImage ? (
            <img
              src={referenceImage}
              alt={name}
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center bottom", display: "block", pointerEvents: "none" }}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", width: "100%", height: "100%", pointerEvents: "none" }}>
              <AvatarPortrait size={width} ring={accent} pulse={activity !== "IDLE"} />
            </div>
          )}
        </div>

        {/* status dot: what she is doing, in her accent colour */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: 6,
            top: 6,
            width: 10,
            height: 10,
            borderRadius: 5,
            background: accent,
            boxShadow: `0 0 8px ${accent}`,
            pointerEvents: "none",
          }}
        />

        {caption && !drag ? (
          <div
            data-testid="lelu-companion-caption"
            style={{
              // Words, not a control: the caption never takes a touch, so it
              // can never stand between the user and what is beneath it.
              pointerEvents: "none",
              position: "absolute",
              top: 6,
              ...(captionLeftOfHer ? { right: width + 8 } : { left: width + 8 }),
              maxWidth: Math.min(260, captionRoom),
              padding: "7px 10px",
              borderRadius: 12,
              background: "rgba(14,10,22,0.92)",
              border: `1px solid ${accent}55`,
              color: "#efe7ff",
              font: "500 12px/1.35 system-ui, sans-serif",
              boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
            }}
          >
            {caption.text}
          </div>
        ) : null}

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
            }}
          >
            {[
              { label: "Chat", act: () => openPanel("chat") },
              { label: `Size: ${nextSize}`, act: () => store.setSize(nextSize) },
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
