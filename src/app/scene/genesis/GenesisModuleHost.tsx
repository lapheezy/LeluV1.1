/**
 * ==========================================================
 * LÉLU — UNIFIED MODULE HOST
 *
 * The presentation engine of the unified UI. Every environment
 * (Earth, Browser, Render, Self Development, …) is ONE module
 * instance held in GenesisCore.state.modules; this host decides
 * HOW it is presented:
 *
 *   inline    → floating window alongside the persistent Chat —
 *               draggable, resizable, stackable (move/resize/raise
 *               live in GenesisCore, shared by LÉLU's tool actions)
 *   expanded  → primary visual area (fullscreen backdrop, Chat
 *               stays mounted and reachable underneath)
 *   minimized → compact persistent chip strip — the module keeps
 *               running (its singleton runtime is untouched)
 * Changing presentation never creates a second module instance —
 * it only moves how the single instance is shown. Window geometry
 * (position/size/z-order) is persisted on the module state so a
 * module remembers where the user (or LÉLU) put it.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useGenesis, type GenesisPanel, type ModuleState } from "./GenesisCore";
import { MODULE_CATALOG } from "./GenesisDock";

const STATUS_DOT: Record<string, string> = {
  idle: "#64748b",
  active: "#34d399",
  loading: "#fbbf24",
  complete: "#38bdf8",
  attention: "#f59e0b",
  failed: "#f87171",
};

export type ModuleRenderers = Partial<Record<GenesisPanel, (props: { onClose: () => void }) => ReactNode>>;

const CHROME_HEIGHT = 40;
// Large enough for a finger: the resize grip must be reachable on iPhone.
const RESIZE_HANDLE = 28;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

interface FloatingWindowProps {
  id: GenesisPanel;
  mod: ModuleState;
  render: (props: { onClose: () => void }) => ReactNode;
  label: string;
  glyph: string;
  cascadeIndex: number;
}

/**
 * ONE floating module window — the single implementation of the
 * inline/expanded presentations. It owns drag (title bar), resize
 * (bottom-right handle), and the window controls (minimize, expand
 * toggle, detach, close), all through the canonical module actions
 * in GenesisCore — the same actions LÉLU's structured tool calls use.
 */
function FloatingModuleWindow({ id, mod, render, label, glyph, cascadeIndex }: FloatingWindowProps) {
  const { moveModule, resizeModule, raiseModule, minimizeModule, expandModule, setModulePresentation, closeModule } = useGenesis();
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.visualViewport?.width ?? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.visualViewport?.height ?? window.innerHeight : 800,
  }));

  useEffect(() => {
    const updateViewport = () => {
      const visual = window.visualViewport;
      setViewport({
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;

  /* Mobile module windows behave like the chat sheet so they never overlap
     the composer or sit off-screen: opened modules dock as a full-width
     bottom sheet above the safe-area + the mobile LÉLU pill, still freely
     draggable and resizable. Desktop keeps the cascade so two opened
     modules never stack exactly. */
  const isMobile = viewportWidth < 720;
  const MOBILE_TOP_RESERVE = 16;
  const MOBILE_BOTTOM_RESERVE = 96; // composer + safe-area + the floating LÉLU menu
  const defaultPosition = isMobile
    ? {
        x: 8,
        y: Math.max(MOBILE_TOP_RESERVE, viewportHeight - MOBILE_BOTTOM_RESERVE - (Math.min(viewportHeight * 0.6, 520))),
      }
    : { x: 88 + (cascadeIndex % 6) * 34, y: 76 + (cascadeIndex % 5) * 34 };

  /* Default geometry cascades so two opened modules never stack exactly. */
  const mobileWidth = Math.max(1, viewportWidth - 16);
  const mobileHeight = Math.max(1, viewportHeight - MOBILE_TOP_RESERVE - MOBILE_BOTTOM_RESERVE);
  const mobileMinWidth = Math.min(MIN_WIDTH, mobileWidth);
  const mobileMinHeight = Math.min(MIN_HEIGHT, mobileHeight);
  const size = isMobile
    ? {
        width: Math.max(mobileMinWidth, Math.min(mod.size?.width ?? mobileWidth, mobileWidth)),
        height: Math.max(mobileMinHeight, Math.min(mod.size?.height ?? Math.min(viewportHeight * 0.6, 520), mobileHeight)),
      }
    : mod.size ?? {
        width: Math.min(620, viewportWidth - 24),
        height: Math.min(480, viewportHeight - CHROME_HEIGHT - 24),
      };
  const rawPosition = mod.position ?? defaultPosition;
  const position = {
    x: isMobile
      ? Math.max(0, Math.min(rawPosition.x, Math.max(0, viewportWidth - size.width)))
      : rawPosition.x,
    y: isMobile
      ? Math.max(MOBILE_TOP_RESERVE, Math.min(rawPosition.y, Math.max(MOBILE_TOP_RESERVE, viewportHeight - MOBILE_BOTTOM_RESERVE - size.height)))
      : rawPosition.y,
  };
  const zIndex = mod.zIndex ?? 30 + cascadeIndex;

  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; baseW: number; baseH: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType !== "touch") return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: position.x, baseY: position.y };
      raiseModule(id);
    },
    [id, position.x, position.y, raiseModule],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const x = drag.baseX + (e.clientX - drag.startX);
      const y = drag.baseY + (e.clientY - drag.startY);
      // Keep the window's full chrome + resize handle within the visual
      // viewport — on mobile the window must never be clipped at an edge or
      // slide its composer out of reach.
      moveModule(id, {
        x: isMobile
          ? Math.max(0, Math.min(x, viewportWidth - Math.min(size.width, viewportWidth)))
          : Math.max(-size.width + 140, Math.min(x, viewportWidth - 96)),          y: isMobile
          ? Math.max(MOBILE_TOP_RESERVE, Math.min(y, viewportHeight - MOBILE_BOTTOM_RESERVE - size.height))
          : Math.max(0, Math.min(y, viewportHeight - CHROME_HEIGHT - 16)),

      });
    },
    [id, moveModule, size.width, viewportWidth, viewportHeight, isMobile],
  );

  const handleResizeDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType !== "touch") return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      resizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseW: size.width, baseH: size.height };
      raiseModule(id);
    },
    [id, size.width, size.height, raiseModule],
  );

  const handleResizeMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const resize = resizeRef.current;
      if (!resize || e.pointerId !== resize.pointerId) return;
      resizeModule(id, {
        width: Math.max(isMobile ? mobileMinWidth : MIN_WIDTH, Math.min(resize.baseW + (e.clientX - resize.startX), Math.max(isMobile ? mobileMinWidth : MIN_WIDTH, viewportWidth - position.x - 16))),
        height: Math.max(isMobile ? mobileMinHeight : MIN_HEIGHT, Math.min(resize.baseH + (e.clientY - resize.startY), Math.max(isMobile ? mobileMinHeight : MIN_HEIGHT, viewportHeight - position.y - CHROME_HEIGHT - (isMobile ? MOBILE_BOTTOM_RESERVE : 16)))),
      });
    },
    [id, resizeModule, position.x, position.y, viewportWidth, viewportHeight, isMobile, mobileMinWidth, mobileMinHeight],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
  }, []);

  const isExpanded = mod.presentation === "expanded";

  const controlButton: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 7,
    border: "1px solid rgba(148,163,184,0.2)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(203,213,225,0.85)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
    fontFamily: "inherit",
    flexShrink: 0,
  };

  const chrome = (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        height: CHROME_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 10px",
        borderBottom: "1px solid rgba(125,211,252,0.16)",
        background: "rgba(8,16,38,0.82)",
        cursor: "grab",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: 13, opacity: 0.9 }}>{glyph}</span>
      <strong style={{ fontSize: 12, letterSpacing: "0.04em", color: "#dbeafe", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </strong>
      <span
        title={`status: ${mod.status}`}
        style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_DOT[mod.status] ?? "#64748b", boxShadow: `0 0 6px ${STATUS_DOT[mod.status] ?? "#64748b"}` }}
      />
      <button type="button" title="Minimize — keeps running" aria-label={`Minimize ${label}`} onClick={() => minimizeModule(id)} style={controlButton}>—</button>
      <button type="button" title={isExpanded ? "Restore window" : "Expand"} aria-label={isExpanded ? "Restore" : "Expand"} onClick={() => (isExpanded ? setModulePresentation(id, "inline") : expandModule(id))} style={controlButton}>{isExpanded ? "⊡" : "⤢"}</button>
      <button type="button" title="Close" aria-label={`Close ${label}`} onClick={() => closeModule(id)} style={controlButton}>✕</button>
    </div>
  );

  if (isExpanded) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex,
          background: "rgba(2,6,23,0.55)",
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            width: "min(92vw, 900px)",
            height: "min(84dvh, 640px)",
            display: "flex",
            flexDirection: "column",
            background: "rgba(6,14,32,0.97)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderRadius: 16,
            border: "1px solid rgba(103,232,249,0.22)",
            boxShadow: "0 24px 80px rgba(2,6,23,0.65)",
            overflow: "hidden",
          }}
        >
          {chrome}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              {render({ onClose: () => closeModule(id) })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        left: isMobile
          ? Math.max(0, Math.min(position.x, viewportWidth - Math.min(size.width, viewportWidth)))
          : Math.max(0, Math.min(position.x, viewportWidth - 96)),
        top: isMobile
          ? Math.max(MOBILE_TOP_RESERVE, Math.min(position.y, viewportHeight - MOBILE_BOTTOM_RESERVE - size.height))
          : Math.max(0, Math.min(position.y, viewportHeight - CHROME_HEIGHT - 16)),
        width: Math.min(size.width, viewportWidth),
        height: size.height,
        zIndex,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        background: "rgba(6,14,32,0.96)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderRadius: 14,
        border: "1px solid rgba(103,232,249,0.22)",
        boxShadow: "0 16px 56px rgba(2,6,23,0.6)",
        overflow: "hidden",
      }}
    >
      {chrome}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {render({ onClose: () => closeModule(id) })}
      </div>
      {/* Resize handle — bottom-right corner */}
      <div
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Resize"
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: RESIZE_HANDLE,
          height: RESIZE_HANDLE,
          cursor: "nwse-resize",
          touchAction: "none",
          background: "linear-gradient(135deg, transparent 50%, rgba(103,232,249,0.5) 50%)",
          borderBottomRightRadius: 14,
        }}
      />
    </div>
  );
}

export default function GenesisModuleHost({ renderers }: { renderers: ModuleRenderers }) {
  const { state, expandModule } = useGenesis();

  if (state.minimized) return null;

  const entries = Object.entries(state.modules) as Array<[GenesisPanel, ModuleState]>;
  // Legacy detached state is still restored as the same inline module window;
  // it never gets a tab or an independent application surface.
  const floating = entries.filter(([, m]) =>
    m.presentation === "inline" || m.presentation === "expanded",
  );
  const minimized = entries.filter(([, m]) => m.presentation === "minimized");

  const labelOf = (id: string) => MODULE_CATALOG.find((m) => m.id === id)?.label ?? id;
  const glyphOf = (id: string) => MODULE_CATALOG.find((m) => m.id === id)?.glyph ?? "◈";

  return (
    <>
      {floating.map(([id, mod], index) => {
        const render = renderers[id];
        if (!render) return null;
        return (
          <FloatingModuleWindow
            key={id}
            id={id}
            mod={mod}
            render={render}
            label={labelOf(id)}
            glyph={glyphOf(id)}
            cascadeIndex={index}
          />
        );
      })}

      {minimized.length > 0 ? (
        <div
          style={{
            position: "fixed",
            bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 32,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 6,
            pointerEvents: "auto",
            maxWidth: "calc(100vw - 24px)",
          }}
        >
          {minimized.map(([id, mod]) => (
            <button
              key={id}
              type="button"
              onClick={() => expandModule(id)}
              title={`Restore ${labelOf(id)} — it is still running in the background`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: "rgba(8,16,38,0.9)",
                border: "1px solid rgba(125,211,252,0.35)",
                borderRadius: 999,
                padding: "6px 12px",
                color: "#dbeafe",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 6px 20px rgba(2,6,23,0.5)",
                backdropFilter: "blur(14px)",
              }}
            >
              <span style={{ fontSize: 12 }}>{glyphOf(id)}</span>
              <span>{labelOf(id)}</span>
              <span
                title={`status: ${mod.status}`}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: STATUS_DOT[mod.status] ?? "#64748b",
                  boxShadow: `0 0 6px ${STATUS_DOT[mod.status] ?? "#64748b"}`,
                }}
              />
              <span style={{ fontSize: 9, opacity: 0.6 }}>{mod.status}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
