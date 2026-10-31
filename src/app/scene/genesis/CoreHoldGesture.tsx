/**
 * ==========================================================
 * LÉLUVERSE
 * CORE HOLD GESTURE — HOLD THE CORE PLANET TO ACTIVATE VOICE
 *
 * A transparent wrapper that sits over the 3D Genesis canvas.
 * Pointer events propagate freely to R3F / Three.js below —
 * this layer only OBSERVES (timer-based hold detection) and
 * never prevents default or stops propagation.
 *
 * Hold logic:
 *  - 500ms stationary hold (mouse/pen) or 600ms (touch) → voice
 *  - Movement > 8px cancels the hold (camera orbit still works)
 *  - No second brain, no second pipeline: fires VoiceEngine.toggle()
 *    which uses the existing AIService → ModelRouter → Anthropic path.
 *
 * Visual feedback:
 *  - Subtle ring that expands during the hold countdown
 *  - Disappears on completion or cancellation
 *  - Implemented as a CSS-animated DOM element — does NOT touch
 *    shaders, lighting, particles, orbit, animation, camera, or Cosmos.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState } from "react";
import VoiceEngine from "../../../core/voice/VoiceEngine";
import { useGenesis } from "./GenesisCore";

const HOLD_MS_MOUSE = 500;
const HOLD_MS_TOUCH = 600;
const MOVE_CANCEL_PX = 8;

interface HoldState {
  startX: number;
  startY: number;
  timer: number;
  pointerType: string;
}

export default function CoreHoldGesture({ children }: { children: React.ReactNode }) {
  const { state, openPanel } = useGenesis();
  const holdRef = useRef<HoldState | null>(null);
  const [holdProgress, setHoldProgress] = useState(0); // 0–1, drives ring animation
  const rafRef = useRef<number | null>(null);
  const holdStartTimeRef = useRef<number>(0);

  const cancelHold = useCallback(() => {
    if (holdRef.current) {
      window.clearTimeout(holdRef.current.timer);
      holdRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHoldProgress(0);
  }, []);

  const animateProgress = useCallback((threshold: number) => {
    const tick = () => {
      const elapsed = performance.now() - holdStartTimeRef.current;
      const progress = Math.min(elapsed / threshold, 1);
      setHoldProgress(progress);
      if (progress < 1 && holdRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Only on the primary button (left-click / first touch)
      if (event.button !== 0 && event.button !== -1) return;
      cancelHold();

      const threshold =
        event.pointerType === "touch" ? HOLD_MS_TOUCH : HOLD_MS_MOUSE;
      holdStartTimeRef.current = performance.now();

      const timer = window.setTimeout(() => {
        holdRef.current = null;
        setHoldProgress(0);
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        // Ensure chat is open so voice responses appear over existing history
        openPanel("chat");
        // Toggle voice — same path as the mic button in chat
        const engine = VoiceEngine.getInstance();
        void engine.toggle();
      }, threshold);

      holdRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        timer,
        pointerType: event.pointerType,
      };

      animateProgress(threshold);
    },
    [cancelHold, animateProgress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const hold = holdRef.current;
      if (!hold) return;
      const dx = Math.abs(event.clientX - hold.startX);
      const dy = Math.abs(event.clientY - hold.startY);
      if (dx + dy > MOVE_CANCEL_PX) {
        cancelHold();
      }
    },
    [cancelHold],
  );

  // Cancel on pointer up (quick click/tap — not a hold)
  const onPointerUp = cancelHold;
  const onPointerCancel = cancelHold;

  // Cancel hold if voice becomes active elsewhere (e.g. mic button in chat)
  useEffect(() => {
    if (state.voice !== "idle") {
      cancelHold();
    }
  }, [state.voice, cancelHold]);

  // Pulse ring color: white during countdown, pink when near completion
  const ringOpacity = holdProgress * 0.6;
  const ringScale = 1 + holdProgress * 0.3;

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {children}

      {/* Subtle hold feedback ring — visible only during an active hold countdown.
          Drawn as a DOM circle over the canvas center; does NOT touch 3D. */}
      {holdProgress > 0 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              border: `1.5px solid rgba(219, 234, 254, ${ringOpacity})`,
              transform: `scale(${ringScale})`,
              transition: "transform 0.05s linear",
              boxShadow: `0 0 ${12 + holdProgress * 18}px rgba(219, 234, 254, ${ringOpacity * 0.4})`,
            }}
          />
        </div>
      )}
    </div>
  );
}
