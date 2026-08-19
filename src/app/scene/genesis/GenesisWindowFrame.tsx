/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS WINDOW FRAME
 *
 * Phase 12 — the shared "floating glass window" chrome.
 *
 * Every panel (Reasoning, Diagnostics, Memory, Providers,
 * Knowledge, History, Workspaces, Logs) plus the chat surface
 * in GenesisInterface.tsx was independently re-typing the same
 * motion.div: same entry/exit spring, same bottom-center
 * anchor, same glass background/border/radius, same header
 * with an eyebrow label + title + "Exit Core" button. Nine
 * copies of one component. This file is that component,
 * extracted so the desktop-over-Genesis visual language lives
 * in one place — a change to how windows float, elevate, or
 * feel now happens here once instead of nine times.
 *
 * This does NOT change the underlying architecture: Genesis
 * still mounts exactly one panel at a time via
 * `state.activePanel` in GenesisCore.tsx / GenesisInterface.tsx.
 * This is chrome only — a clean foundation a later phase can
 * build true simultaneous floating windows on top of, without
 * every panel needing to be touched again.
 * ==========================================================
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { genesisTheme } from "./GenesisTheme";

// Phase 13 — read once per render, not reactive to the preference
// changing mid-session (rare enough not to warrant a matchMedia
// listener + state here). Guarded for non-browser environments
// (tests) where `window` may not exist.
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export type GenesisWindowElevation = keyof typeof genesisTheme.elevation;

export interface GenesisWindowFrameProps {
  /** Small uppercase label above the title — defaults to "Genesis Core". */
  eyebrow?: string;
  /** Main header text. Can include inline counts, e.g. "Memory · 12 stored". */
  title: ReactNode;
  /** Called when the primary close/"Exit Core" button is pressed. */
  onClose: () => void;
  /** Extra header buttons rendered before the close button (e.g. "Clear"). */
  extraActions?: ReactNode;
  /** Label for the primary close button. Defaults to "Exit Core". */
  closeLabel?: string;
  /** CSS width, e.g. "min(92vw, 520px)". Defaults to the Genesis standard panel width. */
  width?: string;
  /** How strongly this window should feel "lifted" above Genesis. */
  elevation?: GenesisWindowElevation;
  /**
   * True while this window represents a live, active signal (thinking,
   * reasoning, speaking) rather than a static inspector — adds the
   * shared accent pulse from index.css to the window edge, echoing the
   * same language GenesisDock already uses for the same signals.
   */
  active?: boolean;
  /** Content below the header. */
  children: ReactNode;
  /** Escape hatch for a panel that needs a taller/shorter body area. */
  maxHeight?: string;
  /** Override the glass background gradient — chat uses a cyan-tinted variant. */
  background?: string;
  /** Purely decorative content rendered above the header row (e.g. chat's glow line). */
  beforeHeader?: ReactNode;
  /** Passed through to the outer motion.div — lets AnimatePresence key it. */
  motionKey?: string;
  /** Overflow behavior. Panels scroll their body; chat clips its decorative glow instead. */
  overflow?: "auto-y" | "hidden";
  /** Allow the shared frame to be repositioned on large screens. */
  draggable?: boolean;
  /** Allow the shared frame to be resized from its lower-right corner. */
  resizable?: boolean;
}

const DEFAULT_WIDTH = "min(92vw, 520px)";

/** Narrow viewport (<720px): panels become full-width bottom sheets. */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 720 : false,
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const listener = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return narrow;
}

export default function GenesisWindowFrame({
  eyebrow = "Genesis Core",
  title,
  onClose,
  extraActions,
  closeLabel = "Exit Core",
  width = DEFAULT_WIDTH,
  elevation = "float",
  active = false,
  children,
  maxHeight = "70vh",
  background,
  beforeHeader,
  motionKey,
  overflow = "auto-y",
  draggable = true,
  resizable = true,
}: GenesisWindowFrameProps) {
  const depth = genesisTheme.elevation[elevation];
  const reduceMotion = prefersReducedMotion();
  const narrow = useIsNarrow();
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width?: number; height?: number }>({});

  useEffect(() => {
    setPosition({ x: 0, y: 0 });
    setSize({});
  }, [motionKey]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (dragRef.current) {
        const drag = dragRef.current;
        setPosition({
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        });
      }

      if (resizeRef.current) {
        const resize = resizeRef.current;
        setSize({
          width: Math.max(280, resize.originWidth + event.clientX - resize.startX),
          height: Math.max(220, resize.originHeight + event.clientY - resize.startY),
        });
      }
    }

    function stopPointerInteraction() {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopPointerInteraction);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopPointerInteraction);
    };
  }, []);

  function handleHeaderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggable || narrow || event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }

    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizable || event.button !== 0 || narrow) {
      return;
    }

    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: rect.width,
      originHeight: rect.height,
    };
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
  }

  // Phase 13 fix — this used to set a static `transform:
  // translateX(-50%)` in `style` below *and* animate `y`/`scale`
  // through framer-motion's `initial`/`animate`/`exit`. Framer takes
  // full ownership of the `transform` CSS property whenever any
  // transform-related value (x, y, scale, ...) is animated, so the
  // static translateX was being silently discarded the moment the
  // component mounted — every window would render flush against the
  // left half of its `left: 50%` anchor instead of centered. Folding
  // the -50% horizontal offset into `x` itself (constant across all
  // three animation states, so it never actually animates) lets
  // framer compose it into the same transform it already controls.
  const frameStyle: CSSProperties = narrow
    ? {
        // Mobile: a full-width bottom sheet that respects the viewport
        // and safe-area insets, instead of a desktop window compressed
        // onto a phone. Drag/resize are disabled — touch swiping a sheet
        // must never be hijacked by window plumbing.
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        maxWidth: "100%",
        maxHeight: "min(86dvh, 92svh)",
        height: "min(86dvh, 92svh)",
        overflowY: "auto",
        overscrollBehavior: "contain",
        touchAction: "pan-y",
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(148, 163, 184, 0.45) rgba(255, 255, 255, 0.06)",
        pointerEvents: "auto",
        background: background ?? genesisTheme.glass.panel,
        border: active ? genesisTheme.glass.borderAccent : genesisTheme.glass.border,
        borderBottom: "none",
        borderRadius: "18px 18px 0 0",
        padding: 16,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        color: "white",
        boxShadow: "0 -12px 48px rgba(2, 6, 23, 0.6)",
        backdropFilter: depth.backdropFilter,
      }
    : {
        position: "absolute",
        left: "50%",
        bottom: 24,
        width: size.width ?? width,
        maxWidth: "calc(100vw - 24px)",
        height: size.height,
        maxHeight: size.height === undefined && overflow === "auto-y" ? maxHeight : undefined,
        overflowY: overflow === "auto-y" ? "auto" : undefined,
        overflow: overflow === "hidden" ? "hidden" : undefined,
        // Scroll hardening for auto-y windows: the app's html/body/#root
        // are overflow:hidden (canvas app), so once the wheel is inside a
        // panel it must never chain out to the frozen page, and touch
        // scrolling must not be swallowed by the drag/pointer plumbing.
        // Thin translucent scrollbar keeps the scroll affordance visible.
        overscrollBehavior: overflow === "auto-y" ? "contain" : undefined,
        touchAction: overflow === "auto-y" ? "pan-y" : undefined,
        scrollbarWidth: overflow === "auto-y" ? "thin" : undefined,
        scrollbarColor:
          overflow === "auto-y"
            ? "rgba(148, 163, 184, 0.45) rgba(255, 255, 255, 0.06)"
            : undefined,
        pointerEvents: "auto",
        background: background ?? genesisTheme.glass.panel,
        border: active ? genesisTheme.glass.borderAccent : genesisTheme.glass.border,
        borderRadius: genesisTheme.radius.lg,
        padding: 16,
        color: "white",
        boxShadow: depth.boxShadow,
        backdropFilter: depth.backdropFilter,
        // Spatial positioning: a window catching a live signal sits a hair
        // closer to the viewer than an idle inspector, instead of every
        // panel occupying the exact same visual plane.
        transformOrigin: "bottom center",
      };

  return (
    <motion.div
      key={motionKey}
      ref={frameRef}
      initial={{ opacity: 0, x: "-50%", y: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: `calc(-50% + ${position.x}px)`, y: position.y, scale: active ? 1.01 : 1 }}
      exit={{ opacity: 0, x: "-50%", y: 20, scale: 0.96 }}
      // Phase 13 — slightly stiffer/lighter than Phase 12's tuning so
      // switching between panels (mode="wait" in GenesisInterface —
      // one closes before the next opens) reads as one continuous
      // layer transition rather than two separate animations with a
      // beat of bare Genesis in between.
      transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.7 }}
      // Phase 13 — desktop-only hover lift (framer-motion's
      // whileHover does not fire for touch input, so phone/tablet
      // get no extra state to misfire on tap). Skipped entirely when
      // the OS asks for reduced motion.
      whileHover={
        reduceMotion ? undefined : { y: -3, filter: "brightness(1.03)" }
      }
      className={
        "genesis-window-frame" + (active ? " genesis-signal-active" : "")
      }
      style={frameStyle}
    >
      {beforeHeader}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 12,
          cursor: draggable ? "grab" : undefined,
          touchAction: draggable ? "none" : undefined,
        }}
        onPointerDown={handleHeaderPointerDown}
      >
        <div style={{ minWidth: 0 }}>
          <div style={genesisTheme.text.eyebrow}>{eyebrow}</div>
          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{title}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {extraActions}
          <button type="button" onClick={onClose} style={genesisTheme.closeButton}>
            {closeLabel}
          </button>
        </div>
      </div>

      {children}
      {resizable ? (
        <div
          aria-label="Resize window"
          role="presentation"
          onPointerDown={handleResizePointerDown}
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            touchAction: "none",
            opacity: 0.55,
            background: "linear-gradient(135deg, transparent 48%, rgba(255,255,255,0.8) 49%, transparent 55%, transparent 65%, rgba(255,255,255,0.8) 66%, transparent 72%)",
          }}
        />
      ) : null}
    </motion.div>
  );
}
