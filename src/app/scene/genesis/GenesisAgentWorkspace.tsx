/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS AGENT WORKSPACE
 *
 * The visual execution surface of LÉLU's agent. Rendered as a
 * layer beneath the invisible dialogue overlay, so conversation
 * and workspace run SIMULTANEOUSLY.
 *
 * The layout is computed by the AdaptiveLayoutEngine from the
 * actual active views and the live viewport: desktop gets a
 * multi-column grid with the focused view enlarged, tablets a
 * two-column arrangement, and phones a focused surface plus a
 * swipeable strip of secondary surfaces — multiple views stay
 * active on every screen size. Sizing uses dynamic viewport
 * units (dvh) and safe-area insets so the iOS address bar and
 * keyboard never break the layout.
 *
 * LÉLU controls the workspace through the engine's structured
 * API; the user keeps override power here: drag to reorder,
 * resize handles, pin, maximize, close, and lock/auto layout.
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import useWorkspace from "../../../core/workspace/useWorkspace";
import type { WorkspaceView, WorkspaceLayoutMode } from "../../../core/workspace/WorkspaceEngine";
import ExecutiveRuntime, { type ExecutiveSelfState } from "../../../core/executive/ExecutiveRuntime";
import AgentEventBus, { type AgentEvent } from "../../../core/agent/AgentEvents";
import { computeLayout, isMobile } from "../../../core/workspace/AdaptiveLayout";
import { activityTimeline } from "../../../core/workspace/visualizers";
import type { VisualSpec } from "../../../core/workspace/VisualSpec";
import { useGenesis } from "./GenesisCore";
import WorkspaceVisual, { surfaceAccent } from "./WorkspaceVisual";
import { genesisTheme } from "./GenesisTheme";

/* ---------------------------- live viewport hook -------------------------- */

function useViewport() {
  const [size, setSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const update = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const visual = window.visualViewport;
    visual?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      visual?.removeEventListener("resize", update);
    };
  }, []);

  return size;
}

/* --------------------------- live Genesis view --------------------------- */

function GenesisLiveView() {
  const { state } = useGenesis();
  const ecosystem = state.ecosystem;
  const metrics: Array<[string, string]> = [
    ["Mode", state.mode],
    ["Runtime", state.runtimeReady ? "live" : "booting"],
    ["Thinking", state.thinking ? "yes" : "no"],
    ["Speaking", state.speaking ? "yes" : "no"],
    ["Listening", state.listening ? "yes" : "no"],
    ["Dialogue", state.dialogue],
    ["Voice", state.voice],
    ["Workspace", state.activeWorkspace ?? "—"],
    ["Biodiversity", ecosystem.biodiversity.toFixed(2)],
    ["Vegetation", ecosystem.vegetation.toFixed(2)],
    ["Biomass", ecosystem.biomass.toFixed(2)],
    ["Stability", ecosystem.stability.toFixed(2)],
    ["Adaptation", ecosystem.adaptation.toFixed(2)],
    ["Extinction", ecosystem.extinction.toFixed(2)],
  ];

  return (
    <div style={{ padding: 14, boxSizing: "border-box", overflowY: "auto", height: "100%" }}>
      <div style={eyebrowStyle(surfaceAccent("genesis"))}>Genesis · live state</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {metrics.map(([label, value]) => (
          <div key={label} style={{ background: "rgba(8, 16, 38, 0.55)", border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: genesisTheme.radius.md, padding: "8px 10px" }}>
            <div style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148, 163, 184, 0.75)" }}>{label}</div>
            <div style={{ fontSize: 13, color: "rgba(228, 244, 255, 0.95)", marginTop: 3, fontFamily: "ui-monospace, monospace", wordBreak: "break-word" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(148, 163, 184, 0.9)", margin: "16px 0 8px" }}>Engines</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(state.engineStatuses ?? []).map((engine) => (
          <div key={engine.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "rgba(8, 16, 38, 0.45)", border: `1px solid ${engine.error ? "rgba(248, 113, 113, 0.35)" : "rgba(103, 232, 249, 0.18)"}`, borderRadius: genesisTheme.radius.md, padding: "7px 10px" }}>
            <span style={{ fontSize: 12, color: "rgba(228, 244, 255, 0.92)" }}>{engine.id}{engine.enabled ? "" : " · disabled"}</span>
            <span style={{ fontSize: 11, color: engine.error ? "#f87171" : "#34d399" }}>{engine.error ? "error" : "ok"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- live activity view -------------------------- */

function ActivityView() {
  const { state } = useWorkspace();
  const spec = useMemo(() => activityTimeline(state.events, 14), [state.events]);
  return <WorkspaceVisual spec={spec} />;
}

/* -------------------- live executive validation view --------------------- */

/**
 * The LIVE VALIDATION MIRROR: what LÉLU is doing RIGHT NOW, streamed
 * straight from the Executive Runtime and the agent event bus. Every
 * value here is measured runtime state — never a simulated progress
 * bar, never a static diagram.
 */
function ExecutiveLiveView() {
  const [exec, setExec] = useState<ExecutiveSelfState>(() => ({
    ...ExecutiveRuntime.getInstance().get(),
  }));
  const [events, setEvents] = useState<AgentEvent[]>(() => AgentEventBus.getInstance().recent(8));

  useEffect(() => {
    const rt = ExecutiveRuntime.getInstance();
    const bus = AgentEventBus.getInstance();
    const unsubExec = rt.subscribe((s) => setExec({ ...s, avatar: { ...s.avatar }, currentTask: s.currentTask ? { ...s.currentTask } : null }));
    const unsubEvents = bus.subscribe(() => setEvents([...bus.recent(8)].reverse()));
    return () => {
      unsubExec();
      unsubEvents();
    };
  }, []);

  const avatarState = !exec.avatar.mounted
    ? "not mounted"
    : exec.avatar.moving
      ? "moving"
      : exec.avatar.lastMoveAt !== null && Date.now() - exec.avatar.lastMoveAt < 4_000
        ? "just moved"
        : exec.avatar.lastFrameAt !== null
          ? "present · static"
          : "no frames yet";

  const metrics: Array<[string, string, string | undefined]> = [
    ["Mode", exec.currentMode + (exec.ambientBehavior ? ` · ${exec.ambientBehavior}` : ""), "#67e8f9"],
    ["Task", exec.currentTask ? `${exec.currentTask.label} [${exec.taskStatus}]` : `none [${exec.taskStatus}]`, exec.taskStatus === "failed" ? "#f87171" : exec.taskStatus === "unverified" ? "#fbbf24" : undefined],
    ["Executing", exec.currentAction || "—", undefined],
    [
      "Last verified",
      exec.lastAction ? `${exec.lastAction.execution} — ${exec.lastAction.verified ? "VERIFIED" : "UNVERIFIED"}` : "—",
      exec.lastAction && !exec.lastAction.verified ? "#fbbf24" : undefined,
    ],
    ["Avatar (3D)", avatarState, exec.avatar.mounted && !exec.avatar.moving && exec.avatar.lastFrameAt !== null ? undefined : "#a78bfa"],
    ["Renderer frames", exec.avatar.mounted ? String(exec.avatar.frames) : "0", undefined],
    ["Open surfaces", exec.workspaceOpenSurfaces.length > 0 ? exec.workspaceOpenSurfaces.join(", ") : "—", undefined],
    ["System health", exec.systemHealth, exec.systemHealth === "critical" ? "#f87171" : exec.systemHealth === "degraded" ? "#fbbf24" : "#34d399"],
    ["Issues", `${exec.activeErrors.length} errors · ${exec.activeWarnings.length} warnings`, exec.activeErrors.length > 0 ? "#f87171" : undefined],
  ];

  return (
    <div style={{ padding: 14, boxSizing: "border-box", overflowY: "auto", height: "100%" }}>
      <div style={eyebrowStyle(surfaceAccent("executive"))}>Lélu · live execution (measured)</div>
      {exec.lastAction && !exec.lastAction.verified ? (
        <div style={{ background: "rgba(251, 191, 36, 0.08)", border: "1px solid rgba(251, 191, 36, 0.35)", borderRadius: genesisTheme.radius.md, padding: "7px 10px", fontSize: 11.5, color: "rgba(253, 230, 138, 0.95)", marginBottom: 8 }}>
          Unverified: {exec.lastAction.intent} → {exec.lastAction.observation}
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {metrics.map(([label, value, color]) => (
          <div key={label} style={{ background: "rgba(8, 16, 38, 0.55)", border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: genesisTheme.radius.md, padding: "8px 10px" }}>
            <div style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(148, 163, 184, 0.75)" }}>{label}</div>
            <div style={{ fontSize: 12.5, color: color ?? "rgba(228, 244, 255, 0.95)", marginTop: 3, fontFamily: "ui-monospace, monospace", wordBreak: "break-word" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(148, 163, 184, 0.9)", margin: "16px 0 8px" }}>Execution stream (newest first)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {events.length === 0 ? (
          <div style={{ fontSize: 11.5, color: "rgba(148, 163, 184, 0.7)" }}>No execution yet — give Lélu a task.</div>
        ) : (
          events.map((event, index) => {
            const detail = [("tool" in event && event.tool) || "", "result" in event && event.result ? String(event.result).slice(0, 90) : "", "error" in event && event.error ? String(event.error).slice(0, 90) : ""].filter(Boolean).join(" · ");
            const failed = event.type === "tool_failed" || event.type === "task_failed";
            return (
              <div key={`${event.type}-${index}`} style={{ display: "flex", gap: 8, alignItems: "baseline", background: "rgba(8, 16, 38, 0.45)", border: `1px solid ${failed ? "rgba(248, 113, 113, 0.3)" : "rgba(103, 232, 249, 0.14)"}`, borderRadius: genesisTheme.radius.md, padding: "6px 9px" }}>
                <span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: failed ? "#f87171" : "#67e8f9", whiteSpace: "nowrap" }}>{event.type}</span>
                <span style={{ fontSize: 11.5, color: "rgba(228, 244, 255, 0.85)", wordBreak: "break-word" }}>{detail || ("label" in event && event.label ? String(event.label) : "")}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function eyebrowStyle(accent: { color: string }): CSSProperties {
  return {
    fontSize: 9.5,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: accent.color,
    opacity: 0.9,
    marginBottom: 8,
  };
}

function renderView(view: WorkspaceView) {
  if (view.kind === "genesis") {
    return <GenesisLiveView />;
  }
  if (view.kind === "activity") {
    return <ActivityView />;
  }
  if (view.kind === "executive") {
    return <ExecutiveLiveView />;
  }
  const spec: VisualSpec = view.spec ?? {
    kind: "table",
    title: view.title,
    caption: "No data yet — the agent is still working.",
    source: "live",
    columns: [],
    rows: [],
  };
  return <WorkspaceVisual spec={spec} viewState={view.viewState} />;
}

/* --------------------------- view card with controls ---------------------- */

interface ViewCardProps {
  view: WorkspaceView;
  focused: boolean;
  compact?: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onPin: (id: string) => void;
  onMaximize: (id: string) => void;
  onResize: (id: string, delta: number) => void;
  onDragStart: (id: string) => void;
  onDrop: (targetId: string) => void;
  className?: string;
}

function ViewCard({ view, focused, compact = false, onFocus, onClose, onPin, onMaximize, onResize, onDragStart, onDrop, className }: ViewCardProps) {
  const accent = surfaceAccent(view.kind);
  const resizeRef = useRef<{ startX: number; started: boolean } | null>(null);

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { startX: event.clientX, started: false };
    const handleMove = () => {
      if (resizeRef.current) {
        resizeRef.current.started = true;
      }
    };
    const handleUp = (up: PointerEvent) => {
      const state = resizeRef.current;
      resizeRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      if (!state) {
        return;
      }
      const delta = up.clientX - state.startX;
      if (delta > 30) {
        onResize(view.id, 1);
      } else if (delta < -30) {
        onResize(view.id, -1);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div
      className={className}
      draggable
      onDragStart={(event) => {
        event.dataTransfer?.setData("text/plain", view.id);
        onDragStart(view.id);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
        event.preventDefault();
        onDrop(view.id);
      }}
      onClick={() => onFocus(view.id)}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        background: focused
          ? `radial-gradient(120% 90% at 50% 0%, ${accent.glow.replace("0.35", "0.10").replace("0.32", "0.09").replace("0.30", "0.08")}, rgba(2, 6, 23, 0.35) 70%)`
          : "rgba(2, 6, 23, 0.42)",
        border: focused ? `1px solid ${accent.color}55` : "1px solid rgba(148, 163, 184, 0.14)",
        borderRadius: genesisTheme.radius.md,
        overflow: "hidden",
        boxShadow: focused ? `0 0 26px ${accent.glow}` : "none",
        cursor: "grab",
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderBottom: `1px solid ${accent.color}22`,
          background: "rgba(8, 16, 38, 0.4)",
          userSelect: "none",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: accent.color, boxShadow: `0 0 8px ${accent.color}`, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: "rgba(228, 244, 255, 0.95)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {view.title}
        </span>
        <span style={{ fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: accent.color, opacity: 0.9, flexShrink: 0 }}>
          {accent.label}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            aria-label={view.pinned ? "Unpin" : "Pin"}
            title={view.pinned ? "Pinned — survives cleanup" : "Pin this view"}
            onClick={(event) => { event.stopPropagation(); onPin(view.id); }}
            style={iconButtonStyle(view.pinned ? accent.color : "rgba(148, 163, 184, 0.6)")}
          >
            {view.pinned ? "📌" : "📍"}
          </button>
          <button
            type="button"
            aria-label="Maximize"
            title="Maximize"
            onClick={(event) => { event.stopPropagation(); onMaximize(view.id); }}
            style={iconButtonStyle("rgba(148, 163, 184, 0.7)")}
          >
            ⛶
          </button>
          <button
            type="button"
            aria-label="Close view"
            title="Close"
            onClick={(event) => { event.stopPropagation(); onClose(view.id); }}
            style={iconButtonStyle("rgba(248, 113, 113, 0.85)")}
          >
            ✕
          </button>
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{renderView(view)}</div>

      {/* Resize handle */}
      {!compact ? (
        <div
          onPointerDown={handleResizePointerDown}
          title="Drag to resize"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 22,
            height: 22,
            cursor: "nwse-resize",
            opacity: 0.5,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: 4,
            color: "rgba(148, 163, 184, 0.7)",
            fontSize: 10,
          }}
        >
          ◢
        </div>
      ) : null}
    </div>
  );
}

function iconButtonStyle(color: string): CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color,
    fontSize: 11,
    lineHeight: 1,
    cursor: "pointer",
    padding: "2px 3px",
  };
}

/* ------------------------------ the workspace ---------------------------- */

interface GenesisAgentWorkspaceProps {
  onDockToggle: () => void;
}

const LAYOUT_LABELS: Record<WorkspaceLayoutMode, string> = {
  auto: "Auto",
  grid: "Grid",
  split: "Split",
  stack: "Stack",
};

export default function GenesisAgentWorkspace({ onDockToggle }: GenesisAgentWorkspaceProps) {
  const { state, engine } = useWorkspace();
  const viewport = useViewport();
  const mobile = isMobile(viewport.width);
  const draggingRef = useRef<string | null>(null);

  /*
   * UNIFIED MODE — Chat + Workspace are one environment. While the
   * conversation is open, the workspace IS the whole UI: it expands to
   * the full surface (below the chrome, beside the dock) and the
   * conversation floats over it. Tools, agents and execution all live
   * in this one surface — no separate Workspace tab exists anymore.
   */
  const { state: genesisState } = useGenesis();
  const unified = genesisState.activePanel === "chat" && !genesisState.minimized;

  const visibleViews = useMemo(() => state.views.filter((view) => !view.minimized), [state.views]);
  const layout = useMemo(
    () => computeLayout(visibleViews, state.focusId, state.layout, state.splitIds, viewport),
    [visibleViews, state.focusId, state.layout, state.splitIds, viewport],
  );

  const viewById = useMemo(() => {
    const map = new Map<string, WorkspaceView>();
    for (const view of state.views) {
      map.set(view.id, view);
    }
    return map;
  }, [state.views]);

  function handleDrop(targetId: string) {
    const source = draggingRef.current;
    draggingRef.current = null;
    if (!source || source === targetId) {
      return;
    }
    const ordered = [...visibleViews.map((view) => view.id)];
    const sourceIndex = ordered.indexOf(source);
    const targetIndex = ordered.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }
    ordered.splice(sourceIndex, 1);
    ordered.splice(targetIndex, 0, source);
    engine.reorderViews(ordered);
  }

  const cells = layout.cells;
  const stackMode = layout.mode === "stack";

  return (
    <motion.div
      className="genesis-agent-workspace-layer"
      initial={false}
      animate={{ opacity: state.visible ? 1 : 0, y: state.visible ? 0 : 24 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      style={{
        position: "fixed",
        // Unified: the workspace fills the environment. Floating: the
        // original bottom-centered execution box.
        ...(unified
          ? {
              left: mobile ? 8 : 88,
              right: 8,
              top: mobile ? 8 : 60,
              bottom: mobile
                ? "calc(env(safe-area-inset-bottom, 0px) + 76px)"
                : 16,
              width: "auto",
              height: "auto",
              transform: "none",
              borderRadius: mobile ? 18 : genesisTheme.radius.lg,
            }
          : {
              left: mobile ? 8 : "50%",
              right: mobile ? 8 : undefined,
              bottom: "clamp(96px, 12vh, 128px)",
              transform: mobile ? "none" : "translateX(-50%)",
              width: mobile ? "auto" : "min(94vw, 1120px)",
              height: mobile ? "min(62dvh, 480px)" : "min(56dvh, 520px)",
              borderRadius: mobile ? 18 : genesisTheme.radius.lg,
            }),
        zIndex: 19,
        pointerEvents: state.visible ? "auto" : "none",
        display: "flex",
        flexDirection: "column",
        background: unified ? "rgba(4, 10, 26, 0.92)" : "rgba(6, 12, 30, 0.84)",
        border: unified ? "1px solid rgba(103, 232, 249, 0.16)" : "1px solid rgba(103, 232, 249, 0.22)",
        boxShadow: unified ? "0 24px 80px rgba(2, 6, 23, 0.7)" : "0 18px 60px rgba(2, 6, 23, 0.65)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        overflow: "hidden",
      }}
    >
      {/* Header: view chips + orchestration controls. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          paddingBottom: `calc(env(safe-area-inset-top, 0px) + 8px)`,
          borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
          overflowX: "auto",
          scrollbarWidth: "thin",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(148, 163, 184, 0.8)", marginRight: 4, whiteSpace: "nowrap" }}>
          Lélu Workspace
        </span>
        <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: state.locked ? "#fbbf24" : "rgba(148, 163, 184, 0.7)", border: `1px solid ${state.locked ? "rgba(251, 191, 36, 0.4)" : "rgba(148, 163, 184, 0.2)"}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
          {state.locked ? "Locked" : LAYOUT_LABELS[state.layout]}
        </span>
        {visibleViews.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => engine.focusView(view.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
              background: view.id === state.focusId ? "rgba(103, 232, 249, 0.16)" : "rgba(8, 16, 38, 0.55)",
              border: view.id === state.focusId ? "1px solid rgba(103, 232, 249, 0.4)" : "1px solid rgba(148, 163, 184, 0.18)",
              borderRadius: genesisTheme.radius.pill,
              padding: "4px 9px",
              color: view.id === state.focusId ? "#e0f7ff" : "rgba(203, 226, 244, 0.85)",
              fontSize: 11,
              cursor: "pointer",
              opacity: view.pinned ? 1 : 0.9,
            }}
          >
            {view.pinned ? "📌 " : ""}
            {view.title}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" title="Return to automatic layout" onClick={() => engine.setLayout("auto")} style={headerButtonStyle()}>
          Auto
        </button>
        <button
          type="button"
          title={state.locked ? "Unlock layout" : "Lock layout"}
          onClick={() => engine.lockLayout(!state.locked)}
          style={headerButtonStyle()}
        >
          {state.locked ? "Unlock" : "Lock"}
        </button>
        <button type="button" title="Hide workspace" onClick={onDockToggle} style={headerButtonStyle()}>
          Hide
        </button>
      </div>

      {/* Body: adaptive cells (grid/split) or stacked surfaces. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          display: "grid",
          gridTemplateColumns: stackMode || layout.cols <= 1 ? "1fr" : `repeat(${layout.cols}, 1fr)`,
          gridAutoRows: stackMode ? "1fr" : "minmax(0, 1fr)",
          gap: 8,
          padding: 8,
          overflow: "hidden",
        }}
      >
        {cells.map((cell) => {
          const view = viewById.get(cell.viewId);
          if (!view) {
            return null;
          }
          const focused = view.id === state.focusId;
          return (
            <div
              key={view.id}
              style={
                stackMode
                  ? {
                      position: "absolute",
                      inset: 0,
                      zIndex: cell.layer + 1,
                      opacity: focused ? 1 : 0.55,
                      pointerEvents: focused ? "auto" : "auto",
                      transform: focused ? "none" : `translate(${cell.layer * 8}px, ${cell.layer * 8}px) scale(0.97)`,
                      transition: "opacity 0.3s ease, transform 0.3s ease",
                    }
                  : {
                      gridColumn: `span ${cell.colSpan}`,
                      gridRow: "span 1",
                      gridColumnStart: cell.col + 1,
                      gridRowStart: cell.row + 1,
                      minHeight: 0,
                      minWidth: 0,
                    }
              }
            >
              <ViewCard
                view={view}
                focused={focused}
                onFocus={(id) => engine.focusView(id)}
                onClose={(id) => engine.closeView(id)}
                onPin={(id) => engine.pinView(id, !view.pinned)}
                onMaximize={(id) => engine.maximizeView(id)}
                onResize={(id, delta) => engine.resizeView(id, view.weight + delta)}
                onDragStart={(id) => { draggingRef.current = id; }}
                onDrop={handleDrop}
              />
            </div>
          );
        })}
        {cells.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(148, 163, 184, 0.7)", fontSize: 12.5 }}>
            No views yet — ask Lélu to show her work, or start a task.
          </div>
        ) : null}
      </div>

      {/* Mobile secondary strip: views that stay active outside the grid. */}
      {mobile && layout.secondary.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            padding: "6px 10px",
            paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 6px)`,
            borderTop: "1px solid rgba(148, 163, 184, 0.14)",
            flexShrink: 0,
            scrollbarWidth: "none",
          }}
        >
          {layout.secondary.map((id) => {
            const view = viewById.get(id);
            if (!view) {
              return null;
            }
            const accent = surfaceAccent(view.kind);
            return (
              <button
                key={id}
                type="button"
                onClick={() => engine.focusView(id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                  background: "rgba(8, 16, 38, 0.6)",
                  border: `1px solid ${accent.color}44`,
                  borderRadius: genesisTheme.radius.pill,
                  padding: "6px 12px",
                  color: "rgba(228, 244, 255, 0.92)",
                  fontSize: 11.5,
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 999, background: accent.color, boxShadow: `0 0 8px ${accent.color}`, flexShrink: 0 }} />
                {view.title}
              </button>
            );
          })}
        </div>
      ) : null}
    </motion.div>
  );
}

function headerButtonStyle(): CSSProperties {
  return {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: genesisTheme.radius.pill,
    background: "rgba(8, 16, 38, 0.6)",
    color: "rgba(203, 226, 244, 0.9)",
    fontSize: 11,
    padding: "4px 10px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
