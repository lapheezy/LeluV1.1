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
 *
 * Mobile enhancements (iPhone / touch):
 *   - Bottom sheet mode is now resizable via drag handle at top
 *   - Content area supports pinch-to-zoom (2× max)
 *   - Double-tap to toggle zoom
 *   - Header drag to reposition the sheet on screen
 * ==========================================================
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { genesisTheme } from "./GenesisTheme";
import PinchZoomContainer from "./PinchZoomContainer";

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
  /** Enable pinch-to-zoom on the content area. Default true. */
  zoomable?: boolean;
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
  zoomable = true,
}: GenesisWindowFrameProps) {
  const depth = genesisTheme.elevation[elevation];
  const reduceMotion = prefersReducedMotion();
  const narrow = useIsNarrow();
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width?: number; height?: number }>({});

  /* ---------------------------------------------------------
   * Mobile: resizable bottom sheet height via top-edge drag
   * --------------------------------------------------------- */
  const [mobileHeight, setMobileHeight] = useState<number | null>(null);
  const mobileResizeRef = useRef<{ pointerId: number; startY: number; originHeight: number } | null>(null);

  /* ---------------------------------------------------------
   * Mobile: zoom toggle for content
   * --------------------------------------------------------- */
  const [mobileZoomed, setMobileZoomed] = useState(false);

  useEffect(() => {
    setPosition({ x: 0, y: 0 });
    setSize({});
    setMobileHeight(null);
  }, [motionKey]);

  /* ---------------------------------------------------------
   * Pointer event handlers (desktop drag + resize)
   * --------------------------------------------------------- */
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

      // Mobile: bottom sheet top-edge resize (drag downward = taller, upward = shorter)
      if (mobileResizeRef.current) {
        const mr = mobileResizeRef.current;
        const delta = mr.startY - event.clientY; // dragging up makes sheet taller
        const newHeight = Math.max(180, Math.min(
          window.innerHeight * 0.95,
          mr.originHeight + delta,
        ));
        setMobileHeight(newHeight);
      }
    }

    function stopPointerInteraction() {
      dragRef.current = null;
      resizeRef.current = null;
      mobileResizeRef.current = null;
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopPointerInteraction);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopPointerInteraction);
    };
  }, []);

  /* ---------------------------------------------------------
   * Desktop: drag from header
   * --------------------------------------------------------- */
  function handleHeaderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggable || event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }

    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    // On mobile narrow mode: allow header drag to move the bottom sheet
    if (narrow) {
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
      };
      document.body.style.userSelect = "none";
      event.currentTarget.setPointerCapture?.(event.pointerId);
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

  /* ---------------------------------------------------------
   * Desktop: resize from bottom-right corner
   * --------------------------------------------------------- */
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

  /* ---------------------------------------------------------
   * Mobile: resize bottom sheet from top edge handle
   * --------------------------------------------------------- */
  function handleMobileResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;

    mobileResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      originHeight: mobileHeight ?? rect.height,
    };
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  /* ---------------------------------------------------------
   * Style computation
   * --------------------------------------------------------- */
  const frameStyle: CSSProperties = narrow
    ? {
        // Mobile: a full-width bottom sheet with touch resize and move
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        maxWidth: "100%",
        maxHeight: mobileHeight ? `${mobileHeight}px` : "min(86dvh, 92svh)",
        height: mobileHeight ? `${mobileHeight}px` : "min(86dvh, 92svh)",
        overflowY: "hidden",
        overscrollBehavior: "contain",
        touchAction: "none",
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(148, 163, 184, 0.45) rgba(255, 255, 255, 0.06)",
        pointerEvents: "auto",
        background: background ?? genesisTheme.glass.panel,
        border: active ? genesisTheme.glass.borderAccent : genesisTheme.glass.border,
        borderBottom: "none",
        borderRadius: "18px 18px 0 0",
        padding: 16,
        paddingTop: 0,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        color: "white",
        boxShadow: "0 -12px 48px rgba(2, 6, 23, 0.6)",
        backdropFilter: depth.backdropFilter,
        display: "flex",
        flexDirection: "column",
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
        transformOrigin: "bottom center",
      };

  return (
    <motion.div
      key={motionKey}
      ref={frameRef}
      initial={{ opacity: 0, x: "-50%", y: 24, scale: 0.96 }}
      animate={{
        opacity: 1,
        x: narrow ? position.x : `calc(-50% + ${position.x}px)`,
        y: narrow ? position.y : position.y,
        scale: active ? 1.01 : 1,
      }}
      exit={{ opacity: 0, x: "-50%", y: 20, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.7 }}
      whileHover={
        reduceMotion ? undefined : { y: -3, filter: "brightness(1.03)" }
      }
      className={
        "genesis-window-frame" + (active ? " genesis-signal-active" : "")
      }
      style={frameStyle}
    >
      {/* Mobile: drag handle at top for resizing the bottom sheet */}
      {narrow && resizable ? (
        <div
          onPointerDown={handleMobileResizePointerDown}
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 4,
            cursor: "ns-resize",
            touchAction: "none",
            flexShrink: 0,
          }}
          aria-label="Drag to resize panel"
        >
          {/* Handle bar */}
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 999,
              background: "rgba(148, 163, 184, 0.35)",
              marginBottom: 4,
            }}
          />
          {/* Resize grip dots */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: "rgba(148, 163, 184, 0.3)",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

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
          flexShrink: 0,
        }}
        onPointerDown={handleHeaderPointerDown}
      >
        <div style={{ minWidth: 0 }}>
          <div style={genesisTheme.text.eyebrow}>{eyebrow}</div>
          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{title}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
          {/* Mobile: zoom toggle button */}
          {narrow && zoomable ? (
            <button
              type="button"
              onClick={() => setMobileZoomed((prev) => !prev)}
              title={mobileZoomed ? "Reset zoom" : "Zoom content"}
              aria-label={mobileZoomed ? "Reset zoom" : "Zoom content"}
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                border: mobileZoomed
                  ? "1px solid rgba(103, 232, 249, 0.5)"
                  : "1px solid rgba(148, 163, 184, 0.24)",
                background: mobileZoomed
                  ? "rgba(103, 232, 249, 0.12)"
                  : "rgba(8, 16, 38, 0.55)",
                color: mobileZoomed ? "#67e8f9" : "rgba(214, 228, 244, 0.9)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 13,
                flexShrink: 0,
                transition: "background 0.15s ease, border-color 0.15s ease",
              }}
            >
              {mobileZoomed ? "1×" : "⊕"}
            </button>
          ) : null}
          {extraActions}
          <button type="button" onClick={onClose} style={genesisTheme.closeButton}>
            {closeLabel}
          </button>
        </div>
      </div>

      {/* Content area — with pinch-to-zoom on mobile */}
      {narrow && zoomable ? (
        <PinchZoomContainer
          enabled={true}
          minScale={1}
          maxScale={2.5}
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(148, 163, 184, 0.45) rgba(255, 255, 255, 0.06)",
          }}
        >
          {children}
        </PinchZoomContainer>
      ) : (
        children
      )}

      {/* Desktop: resize from bottom-right corner */}
      {resizable && !narrow ? (
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
