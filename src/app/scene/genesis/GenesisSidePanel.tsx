/**
 * ==========================================================
 * LÉLU — UNIFIED SIDE PANEL
 *
 * The module launcher / control surface of the unified UI.
 * Chat is the persistent core; every environment (Earth,
 * Browser, Render, Self Development, …) is ONE instance whose
 * presentation can be inline → expanded → minimized.
 *
 * This panel is only a control surface — it does not own any
 * module state. It reads/writes the canonical module state in
 * GenesisCore (state.modules + uiControl) and lists the SAME
 * MODULE_CATALOG the dock and palette use.
 * ==========================================================
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useGenesis, type UiControlMode } from "./GenesisCore";
import { MODULE_CATALOG, type DockItem } from "./GenesisDock";
import { genesisTheme } from "./GenesisTheme";

const STATUS_DOT: Record<string, string> = {
  idle: "#64748b",
  active: "#34d399",
  loading: "#fbbf24",
  complete: "#38bdf8",
  attention: "#f59e0b",
  failed: "#f87171",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  active: "Active",
  loading: "Loading",
  complete: "Complete",
  attention: "Needs attention",
  failed: "Failed",
};

const PRESENTATION_LABEL: Record<string, string> = {
  closed: "closed",
  inline: "inline",
  expanded: "expanded",
  minimized: "minimized",
};

const MODES: Array<{ id: UiControlMode; label: string; hint: string }> = [
  { id: "auto", label: "AUTO", hint: "LÉLU chooses environments + presentation" },
  { id: "assisted", label: "ASSISTED", hint: "LÉLU recommends, you approve" },
  { id: "manual", label: "MANUAL", hint: "You choose everything" },
];

const chip: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#cbd5e1",
  borderRadius: 8,
  padding: "4px 7px",
  fontSize: 10.5,
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1,
};

export default function GenesisSidePanel() {
  const { state, openModule, expandModule, minimizeModule, closeModule, restoreModule, setUiControl } = useGenesis();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 720);
  /* The launcher is a movable window too — it must never sit locked over
     the chat. Drag the header to reposition; the position is remembered
     for the session so it stays where the user put it. */
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const startPanelDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType !== "touch") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: panelPos?.x ?? 12,
      baseY: panelPos?.y ?? 56,
    };
  };

  const movePanelDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const maxX = Math.max(8, window.innerWidth - 304);
    const maxY = Math.max(8, window.innerHeight - 420);
    setPanelPos({
      x: Math.max(8, Math.min(maxX, drag.baseX + (e.clientX - drag.startX))),
      y: Math.max(8, Math.min(maxY, drag.baseY + (e.clientY - drag.startY))),
    });
  };

  const endPanelDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const update = () => setMobile(window.innerWidth < 720);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Phones use the chat-owned LÉLU menu. The desktop side launcher must not
  // become a second mobile navigation surface or cover the composer.
  if (mobile) return null;

  const modules = state.modules;
  const openCount = Object.values(modules).filter((m) => m.presentation !== "closed").length;

  const act = (id: string) => {
    const mod = modules[id];
    if (!mod || mod.presentation === "closed") openModule(id);
    else if (mod.presentation === "minimized") restoreModule(id);
    else expandModule(id);
  };

  const row = (item: DockItem) => {
    const mod = modules[item.id];
    const presentation = mod?.presentation ?? "closed";
    const status = mod?.status ?? "idle";
    const active = presentation !== "closed";
    return (
      <div
        key={item.id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 8px",
          borderRadius: 10,
          border: `1px solid ${active ? "rgba(125,211,252,0.28)" : "rgba(255,255,255,0.06)"}`,
          background: active ? "rgba(103,232,249,0.06)" : "transparent",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
        onClick={() => act(item.id)}
        title={`${item.label} — ${STATUS_LABEL[status]}`}
      >
        <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>{item.glyph}</span>
        <span style={{ flex: 1, fontSize: 11.5, color: active ? "#e6f4ff" : "rgba(148,163,184,0.85)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.label}
        </span>
        <span
          title={STATUS_LABEL[status]}
          style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_DOT[status] ?? "#64748b", boxShadow: active ? `0 0 6px ${STATUS_DOT[status] ?? "#64748b"}` : "none", flexShrink: 0 }}
        />
        <span style={{ fontSize: 9, opacity: 0.6, fontFamily: "ui-monospace, monospace", flexShrink: 0 }}>{PRESENTATION_LABEL[presentation]}</span>
      </div>
    );
  };

  const actions = (item: DockItem) => {
    const mod = modules[item.id];
    const presentation = mod?.presentation ?? "closed";
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "2px 8px 6px" }} onClick={(e) => e.stopPropagation()}>
        {presentation === "closed" ? (
          <button type="button" style={chip} onClick={() => openModule(item.id)} title="Open inside Chat">Open</button>
        ) : null}
        {presentation === "inline" ? (
          <button type="button" style={chip} onClick={() => expandModule(item.id)} title="Expand — primary area">⤢ Expand</button>
        ) : null}
        {(presentation === "inline" || presentation === "expanded") ? (
          <button type="button" style={chip} onClick={() => minimizeModule(item.id)} title="Minimize to persistent chip (module keeps running)">▁ Minimize</button>
        ) : null}
        {presentation === "minimized" ? (
          <button type="button" style={chip} onClick={() => expandModule(item.id)} title="Restore">↺ Restore</button>
        ) : null}
        {presentation !== "closed" ? (
          <button type="button" style={{ ...chip, color: "#fca5a5", borderColor: "rgba(248,113,113,0.35)" }} onClick={() => closeModule(item.id)} title="Close">✕</button>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {/* Collapsed handle — always reachable while Chat is active */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="LÉLU · Modules"
          style={{
            position: "fixed",
            left: 90,
            top: 64,
            zIndex: 30,
            pointerEvents: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "rgba(8,16,38,0.85)",
            border: "1px solid rgba(125,211,252,0.35)",
            borderRadius: genesisTheme.radius.pill,
            padding: "7px 12px",
            color: "#a5f3fc",
            fontSize: 11,
            backdropFilter: "blur(14px)",
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: "0 6px 24px rgba(2,6,23,0.5)",
          }}
        >
          ☰ Modules
          {openCount > 0 ? (
            <span style={{ fontSize: 9.5, borderRadius: 999, background: "rgba(103,232,249,0.2)", padding: "2px 7px", color: "#67e8f9" }}>
              {openCount} open
            </span>
          ) : null}
        </button>
      ) : null}

      {open ? (
        <div
          style={{
            position: "fixed",
            top: panelPos?.y ?? 56,
            left: panelPos?.x ?? 12,
            bottom: 24,
            width: "min(292px, calc(100vw - 24px))",
            zIndex: 30,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "rgba(6,14,32,0.92)",
            border: "1px solid rgba(125,211,252,0.22)",
            borderRadius: 16,
            padding: 14,
            backdropFilter: "blur(20px)",
            color: "white",
            boxShadow: "0 16px 56px rgba(2,6,23,0.6)",
            overflowY: "auto",
            fontFamily: "inherit",
          }}
        >
          <div
            onPointerDown={startPanelDrag}
            onPointerMove={movePanelDrag}
            onPointerUp={endPanelDrag}
            onPointerCancel={endPanelDrag}
            title="Drag to move this panel"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "grab",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>LÉLU · Modules</span>
            <span style={{ fontSize: 9.5, opacity: 0.55 }}>one runtime · many views</span>
            <button type="button" onClick={() => setOpen(false)} title="Retract" style={{ ...chip, fontSize: 11 }}>«</button>
          </div>

          {/* AUTO / ASSISTED / MANUAL */}
          <div>
            <div style={{ fontSize: 9.5, letterSpacing: "0.08em", opacity: 0.55, marginBottom: 4 }}>PRESENTATION CONTROL</div>
            <div style={{ display: "flex", gap: 4 }}>
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setUiControl(mode.id)}
                  title={mode.hint}
                  style={{
                    ...chip,
                    flex: 1,
                    textAlign: "center",
                    fontSize: 9.5,
                    background: state.uiControl === mode.id ? "rgba(103,232,249,0.22)" : "rgba(255,255,255,0.04)",
                    border: state.uiControl === mode.id ? "1px solid rgba(125,211,252,0.6)" : "1px solid rgba(255,255,255,0.1)",
                    color: state.uiControl === mode.id ? "#a5f3fc" : "#94a3b8",
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 9.5, opacity: 0.5, marginTop: 4 }}>
              {MODES.find((m) => m.id === state.uiControl)?.hint}
            </div>
          </div>

          {/* Environment modules */}
          <div>
            <div style={{ fontSize: 9.5, letterSpacing: "0.08em", opacity: 0.55, marginBottom: 4 }}>ENVIRONMENTS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {MODULE_CATALOG.filter((item) => item.group === "core").map((item) => (
                <div key={item.id} style={{ display: "flex", flexDirection: "column" }}>
                  {row(item)}
                  {actions(item)}
                </div>
              ))}
            </div>
          </div>

          {/* Everything else */}
          <div>
            <div style={{ fontSize: 9.5, letterSpacing: "0.08em", opacity: 0.55, marginBottom: 4 }}>CAPABILITIES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {MODULE_CATALOG.filter((item) => item.group !== "core").map((item) => row(item))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
