/**
 * ==========================================================
 * LÉLU — DEDICATED AVATAR WINDOW
 *
 * A floating, movable, resizable window for LÉLU's persistent
 * visual embodiment. Uses the existing CoreGlyph visual language
 * from GenesisLab to render LÉLU's representation.
 *
 * Connected to:
 * - AvatarProfile store (persistent identity config)
 * - GenesisUIState (dialogue/voice phase for state display)
 * - VoiceEngine (listening/speaking/thinking states)
 *
 * Independent from:
 * - Earth Core (separate component)
 * - GPS bubble (separate component)
 * - Chat (sibling, not child)
 * ==========================================================
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { motion } from "framer-motion";
import { useGenesis } from "./GenesisCore";
import { useVoice } from "../../../core/voice/useVoice";
import AvatarStore, {
  type AvatarProfile,
} from "../../../core/avatar/AvatarProfile";
import KvStore from "../../../core/storage/KvStore";
import AvatarPortrait, { CoreGlyph } from "./AvatarPortrait";

/* ------------------------------------------------------------------
 * Persisted position & size
 * ------------------------------------------------------------------ */

const AVATAR_POS_KEY = "lelu.avatar.v1";

interface AvatarWindowPrefs {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  visible: boolean;
}

function readPrefs(): AvatarWindowPrefs {
  const defaults: AvatarWindowPrefs = {
    x: -1,
    y: -1,
    w: 240,
    h: 320,
    minimized: false,
    visible: true,
  };
  try {
    const stored = KvStore.getInstance().get<Partial<AvatarWindowPrefs>>(
      AVATAR_POS_KEY,
    );
    return { ...defaults, ...(stored ?? {}) };
  } catch {
    return defaults;
  }
}

function persistPrefs(prefs: AvatarWindowPrefs): void {
  try {
    KvStore.getInstance().set(AVATAR_POS_KEY, prefs);
  } catch {
    // persistence must never break the window
  }
}

/* ------------------------------------------------------------------
 * Size limits
 * ------------------------------------------------------------------ */

const MIN_W = 160;
const MIN_H = 220;
const MAX_W = 560;
const MAX_H = 700;

/* ------------------------------------------------------------------
 * State ring colors
 * ------------------------------------------------------------------ */

const RING_IDLE = "rgba(103, 232, 249, 0.5)";
const RING_LISTEN = "rgba(167, 139, 250, 0.8)";
const RING_THINK = "rgba(251, 191, 36, 0.8)";
const RING_SPEAK = "rgba(74, 222, 128, 0.8)";

function stateRing(
  dialogue: string,
  voicePhase: string,
): { color: string; pulse: boolean; label: string } {
  if (voicePhase === "listening")
    return { color: RING_LISTEN, pulse: true, label: "Listening" };
  if (voicePhase === "speaking")
    return { color: RING_SPEAK, pulse: true, label: "Speaking" };
  if (dialogue === "processing" || dialogue === "responding")
    return { color: RING_THINK, pulse: true, label: "Thinking" };
  if (dialogue === "typing")
    return { color: RING_LISTEN, pulse: false, label: "Attentive" };
  if (dialogue === "complete")
    return { color: RING_SPEAK, pulse: false, label: "Responding" };
  return { color: RING_IDLE, pulse: false, label: "Idle" };
}

/* ------------------------------------------------------------------
 * The Avatar window
 * ------------------------------------------------------------------ */

export default function AvatarWindow() {
  const { state } = useGenesis();
  const voice = useVoice();
  const store = useMemo(() => AvatarStore.getInstance(), []);
  const [profile, setProfile] = useState<AvatarProfile>(() => store.get());

  useEffect(() => {
    return store.subscribe((next: AvatarProfile) => setProfile(next));
  }, [store]);

  const [prefs, setPrefs] = useState<AvatarWindowPrefs>(() => readPrefs());

  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // Default position: desktop → bottom-right of the 3D scene, mobile → top-right compact
  const isMobile = typeof window !== "undefined" && window.innerWidth < 720;
  const defaultX = isMobile
    ? (typeof window !== "undefined" ? window.innerWidth - 160 : 0)
    : (typeof window !== "undefined" ? window.innerWidth - 280 : 0);
  const defaultY = isMobile ? 72 : 120;
  const defaultW = isMobile ? 130 : 240;
  const defaultH = isMobile ? 180 : 320;

  const effectiveX =
    prefs.x >= 0 ? prefs.x : defaultX;
  const effectiveY =
    prefs.y >= 0 ? prefs.y : defaultY;
  const effectiveW = prefs.w || defaultW;
  const effectiveH = prefs.h || defaultH;
  const minimized = prefs.minimized;
  const visible = prefs.visible;

  const ring = stateRing(state.dialogue, voice.state.phase);

  const clampPos = useCallback(
    (x: number, y: number) => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1440;
      const h = typeof window !== "undefined" ? window.innerHeight : 900;
      const maxX = Math.max(0, w - effectiveW);
      const maxY = Math.max(0, h - effectiveH);
      return {
        x: Math.round(Math.min(maxX, Math.max(0, x))),
        y: Math.round(Math.min(maxY, Math.max(0, y))),
      };
    },
    [effectiveW, effectiveH],
  );

  const updatePrefs = useCallback(
    (patch: Partial<AvatarWindowPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        persistPrefs(next);
        return next;
      });
    },
    [],
  );

  // Drag handlers
  const onHeaderDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: effectiveX - event.clientX,
        offsetY: effectiveY - event.clientY,
      };
    },
    [effectiveX, effectiveY],
  );

  const onHeaderMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const x = event.clientX + drag.offsetX;
      const y = event.clientY + drag.offsetY;
      const clamped = clampPos(x, y);
      setPrefs((prev) => ({ ...prev, x: clamped.x, y: clamped.y }));
    },
    [clampPos],
  );

  const onHeaderUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [],
  );

  // Resize handlers
  const onResizeDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startW: effectiveW,
        startH: effectiveH,
      };
    },
    [effectiveW, effectiveH],
  );

  const onResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const r = resizeRef.current;
      if (!r) return;
      const dw = event.clientX - r.startX;
      const dh = event.clientY - r.startY;
      const w = Math.min(MAX_W, Math.max(MIN_W, r.startW + dw));
      const h = Math.min(MAX_H, Math.max(MIN_H, r.startH + dh));
      setPrefs((prev) => ({ ...prev, w, h }));
    },
    [],
  );

  const onResizeUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      resizeRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [],
  );

  if (!visible) {
    return (
      <button
        type="button"
        title="Show Lélu"
        aria-label="Show Lélu avatar"
        onClick={() => updatePrefs({ visible: true, minimized: false })}
        style={{
          position: "fixed",
          right: isMobile ? 10 : 90,
          bottom: isMobile ? 90 : 20,
          zIndex: 17,
          width: 36,
          height: 36,
          borderRadius: 999,
          border: `1px solid ${RING_IDLE}`,
          background: "rgba(8, 16, 32, 0.72)",
          color: "rgba(203, 228, 255, 0.85)",
          fontSize: 16,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(10px)",
          pointerEvents: "auto",
        }}
      >
        ◉
      </button>
    );
  }

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{
        opacity: 1,
        scale: minimized ? 0.88 : 1,
      }}
      transition={{ duration: 0.25 }}
      style={{
        position: "fixed",
        left: effectiveX,
        top: effectiveY,
        width: minimized ? 52 : effectiveW,
        height: minimized ? 52 : effectiveH,
        zIndex: 17,
        pointerEvents: "auto",
        borderRadius: minimized ? 999 : 16,
        border: minimized
          ? `1.5px solid ${ring.color}`
          : "1px solid rgba(148, 163, 184, 0.18)",
        background: minimized
          ? "rgba(8, 16, 38, 0.8)"
          : "linear-gradient(160deg, rgba(12, 10, 32, 0.85), rgba(6, 14, 32, 0.78))",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: minimized
          ? `0 8px 28px rgba(2,6,23,0.5), 0 0 18px ${ring.color}44`
          : "0 16px 48px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
        overflow: minimized ? "hidden" : "hidden",
        cursor: "auto",
        userSelect: "none",
        WebkitUserSelect: "none",
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
      }}
    >
      {minimized ? (
        /* Minimized — compact pill with state dot */
        <button
          type="button"
          onClick={() => updatePrefs({ minimized: false })}
          title={`Lélu · ${ring.label}`}
          aria-label={`Lélu avatar — ${ring.label}, click to expand`}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 999,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: ring.color,
              boxShadow: ring.pulse
                ? `0 0 12px ${ring.color}, 0 0 24px ${ring.color}66`
                : `0 0 6px ${ring.color}`,
              animation: ring.pulse
                ? "genesis-status-glow-pulse 1.4s ease-in-out infinite"
                : undefined,
            }}
          />
        </button>
      ) : (
        /* Full window */
        <>
          {/* Header bar — draggable */}
          <div
            onPointerDown={onHeaderDown}
            onPointerMove={onHeaderMove}
            onPointerUp={onHeaderUp}
            onPointerCancel={onHeaderUp}
            style={{
              height: 36,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 10px",
              cursor: "grab",
              touchAction: "none",
              borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                background: ring.color,
                boxShadow: ring.pulse
                  ? `0 0 10px ${ring.color}`
                  : `0 0 4px ${ring.color}`,
                animation: ring.pulse
                  ? "genesis-status-glow-pulse 1.4s ease-in-out infinite"
                  : undefined,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                color: "rgba(226, 238, 252, 0.9)",
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Lélu · {ring.label}
            </span>
            <button
              type="button"
              onClick={() => updatePrefs({ minimized: true })}
              title="Minimize"
              aria-label="Minimize avatar"
              style={iconButtonStyle}
            >
              ─
            </button>
            <button
              type="button"
              onClick={() => updatePrefs({ visible: false })}
              title="Hide"
              aria-label="Hide avatar"
              style={{ ...iconButtonStyle, color: "rgba(248, 113, 113, 0.8)" }}
            >
              ✕
            </button>
          </div>

          {/* Avatar body — the visual representation */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 12px 14px",
              gap: 8,
              overflow: "hidden",
            }}
          >
            {/* The AVATAR — draws the canonical saved referenceImage when
                one exists, falling back to the stylized SVG portrait. */}
            <AvatarPortrait
              size={Math.min(effectiveW - 32, effectiveH - 100)}
              ring={ring.color}
              pulse={ring.pulse}
              referenceImage={profile.referenceImage}
              animated={profile.runtime.animationActive}
              simulated={profile.runtime.simulationActive}
            />

            {/* Tiny Earth Core indicator — shows the Core is alive and connected */}
            <div
              title="Earth Core — tap for Chat, hold for Voice"
              style={{
                position: "absolute",
                bottom: 8,
                right: 12,
                width: 28,
                height: 28,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${ring.color}55`,
                background: "rgba(8,16,38,0.6)",
                backdropFilter: "blur(8px)",
                pointerEvents: "none",
              }}
            >
              <CoreGlyph size={22} ring={ring} />
            </div>

            {/* State label */}
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: ring.color,
                textShadow: `0 0 8px ${ring.color}66`,
              }}
            >
              {ring.label}
            </div>

            {/* Identity line */}
            <div
              style={{
                fontSize: 10,
                color: "rgba(148, 163, 184, 0.6)",
                letterSpacing: "0.04em",
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              {profile.identity.name} · {profile.appearance.hair.slice(0, 30)}…
            </div>
          </div>

          {/* Resize handle */}
          {!isMobile ? (
            <div
              onPointerDown={onResizeDown}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              title="Drag to resize"
              style={{
                position: "absolute",
                right: 0,
                bottom: 0,
                width: 20,
                height: 20,
                cursor: "nwse-resize",
                touchAction: "none",
                background:
                  "linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.25) 50%)",
                borderBottomRightRadius: 14,
              }}
            />
          ) : null}
        </>
      )}
    </motion.div>
  );
}

const iconButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: 0,
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  borderRadius: 6,
  color: "rgba(214, 228, 244, 0.65)",
  fontFamily: "inherit",
  flexShrink: 0,
};