/**
 * ==========================================================
 * LÉLUVERSE
 * LIVING SYSTEM UI  —  the second interface environment
 *
 * This is NOT a theme, a dark mode, or an overlay on the
 * Genesis interface. It is a structurally separate React
 * environment — its own full-screen layout, its own
 * navigation, its own core, its own workspace arrangement and
 * its own interaction model — while sharing the exact same
 * underlying LÉLU systems:
 *
 *   - AIService / cognition / memory / providers / fallback
 *   - WorkspaceEngine (real agent views, shared state)
 *   - VisualEngine (real agent-event → mode/signal state)
 *   - VoiceEngine / the invisible dialogue overlay
 *
 * Component hierarchy (distinct from the Genesis chrome):
 *
 *   LivingSystemUI
 *   ├── SystemField      — the ACTIVE mode's real visualization
 *   ├── SystemCore       — the central presence; click to talk
 *   ├── SystemNav        — its own navigation (modes + views + exit)
 *   ├── SystemWorkspace  — shared views rendered SPATIALLY in the field
 *   └── ActivityStrip    — real agent events at the bottom of the world
 *
 * Every visual responds to real runtime events through the
 * shared engines — nothing here is decorative or fabricated.
 * The SystemField renders the per-mode visualizations from
 * LivingSystemVisuals (Heartbeat / Matrix / Nerve / Neuron /
 * the ONE shared Genesis Core), so switching modes visibly
 * transforms the environment rather than changing a label.
 * ==========================================================
 */

import { useMemo, useState, type CSSProperties } from "react";
import type { AgentEvent } from "../../../core/agent/AgentEvents";
import { useVisual } from "../../../core/visual/useVisual";
import { useWorkspace } from "../../../core/workspace/useWorkspace";
import type { WorkspaceView } from "../../../core/workspace/WorkspaceEngine";
import { useGenesis } from "./GenesisCore";
import type EngineRuntime from "./engines/EngineRuntime";
import { useSceneMountLog } from "./useSceneMountLog";
import LivingSystemVisuals from "./LivingSystemVisuals";
import WorkspaceVisual from "./WorkspaceVisual";
import {
  type VisualStateRuntime,
  type VisualStateStructure,
  type VisualSignal,
} from "./VisualInterface";

/* ------------------------------ palette ------------------------------- */

const FIELD_BG =
  "radial-gradient(120% 90% at 50% 12%, #0a1220 0%, #060b16 42%, #03070f 78%, #010308 100%)";

/* ------------------------------ shell --------------------------------- */

export default function LivingSystemUI() {
  // TEMP DEBUG — scene-isolation lifecycle log (see useSceneMountLog).
  useSceneMountLog("LivingSystemUI");

  const { state: visualState, engine: visualEngine } = useVisual();
  const { state: workspaceState, engine: workspaceEngine } = useWorkspace();
  const { openPanel, setDialogue, engineRuntime } = useGenesis();

  const { mode, interfaceFocus, heartbeatRate, runtime, structure, signals, activeNodes, activeConnections } =
    visualState;

  // If the shared state somehow no longer points at this environment,
  // render nothing rather than a wrong-looking shell (the switch UI
  // calls setInterfaceFocus, so this only happens during transition).
  if (interfaceFocus !== "visual") {
    return null;
  }

  const activeSignals = signals.filter((signal) => signal.mode === mode || signal.mode === "core");

  return (
    <div
      data-workspace="lelu-system"
      className="lelu-living-system-ui"
      style={{
        position: "fixed",
        inset: 0,
        isolation: "isolate",
        overflow: "hidden",
        background: FIELD_BG,
        color: "white",
        userSelect: "none",
        WebkitUserSelect: "none",
        pointerEvents: "auto",
        animation: "lelu-environment-enter 0.38s ease",
      }}
    >
      {/* The environment itself — the active mode fills the whole field. */}
      <SystemField
        mode={mode}
        runtime={runtime}
        structure={structure}
        signals={activeSignals}
        activeNodes={activeNodes}
        activeConnections={activeConnections}
        heartbeatRate={heartbeatRate}
        engineRuntime={engineRuntime}
      />

      {/* Navigation for THIS environment — not the Genesis dock. */}
      <SystemNav
        mode={mode}
        onMode={(next) => visualEngine.setMode(next)}
        views={workspaceState.views.filter((view) => !view.minimized)}
        focusId={workspaceState.focusId}
        onFocusView={(id) => workspaceEngine.focusView(id)}
        onExit={() => visualEngine.setInterfaceFocus("genesis")}
        onOpenLab={() => {
          visualEngine.setInterfaceFocus("genesis");
          openPanel("genesisv2");
        }}
      />

      {/* The central presence — click to talk to LÉLU. */}
      <SystemCore
        heartbeatRate={heartbeatRate}
        runtime={runtime}
        onClick={() => {
          openPanel("chat");
          setDialogue("typing");
        }}
      />

      {/* Real agent views, laid out spatially inside the field. */}
      <SystemWorkspace
        views={workspaceState.views.filter((view) => !view.minimized)}
        focusId={workspaceState.focusId}
        onFocusView={(id) => workspaceEngine.focusView(id)}
        onCloseView={(id) => workspaceEngine.closeView(id)}
        onOpenChat={() => {
          openPanel("chat");
          setDialogue("typing");
        }}
      />

      {/* Real agent activity, streamed from the shared event bus. */}
      <ActivityStrip events={workspaceState.events} lastEvent={workspaceState.lastEvent} />

      {/* conversation-available hint: the dialogue overlay is shared and
          floats above this environment when active */}
      <div
        style={{
          position: "absolute",
          left: 16,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(148, 163, 184, 0.5)",
          writingMode: "vertical-rl",
          pointerEvents: "none",
          display: "none",
        }}
      >
        · talk to the core
      </div>
    </div>
  );
}

/* --------------------------- system field ----------------------------- */

function SystemField({
  mode,
  runtime,
  structure,
  signals,
  activeNodes,
  activeConnections,
  heartbeatRate,
  engineRuntime,
}: {
  mode: string;
  runtime: VisualStateRuntime;
  structure: VisualStateStructure;
  signals: VisualSignal[];
  activeNodes: string[];
  activeConnections: string[];
  heartbeatRate: number;
  engineRuntime: EngineRuntime | null;
}) {
  // Only the ACTIVE mode's real visualization is rendered — one
  // environment at a time, remounted per mode switch for a fast fade-in.
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Ambient data grid, always present so the field reads as one place. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.5,
          backgroundImage:
            "linear-gradient(rgba(56, 189, 248, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.05) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(80% 70% at 50% 45%, black, transparent 92%)",
          WebkitMaskImage: "radial-gradient(80% 70% at 50% 45%, black, transparent 92%)",
          pointerEvents: "none",
        }}
      />
      <ModeLayer key={mode}>
        <LivingSystemVisuals
          mode={mode}
          rate={heartbeatRate}
          runtime={runtime}
          structure={structure}
          signals={signals}
          activeNodes={activeNodes}
          activeConnections={activeConnections}
          engineRuntime={engineRuntime}
        />
      </ModeLayer>
    </div>
  );
}

function ModeLayer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: 1,
        animation: "living-system-fade-in 0.32s ease",
      }}
    >
      {children}
    </div>
  );
}

/* ----------------------------- system nav ----------------------------- */

const MODES: { id: string; label: string }[] = [
  { id: "heartbeat", label: "Heartbeat" },
  { id: "matrix", label: "Matrix" },
  { id: "nerve", label: "Nerve" },
  { id: "neuron", label: "Neuron" },
  { id: "core", label: "Core" },
];

function SystemNav({
  mode,
  onMode,
  views,
  focusId,
  onFocusView,
  onExit,
  onOpenLab,
}: {
  mode: string;
  onMode: (mode: "heartbeat" | "matrix" | "nerve" | "neuron" | "core") => void;
  views: WorkspaceView[];
  focusId: string | null;
  onFocusView: (id: string) => void;
  onExit: () => void;
  onOpenLab: () => void;
}) {
  const [viewDrawer, setViewDrawer] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: "12px 14px",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 3,
        pointerEvents: "auto",
        background: "linear-gradient(180deg, rgba(3, 7, 15, 0.85), transparent)",
      }}
    >
      {/* Environment identity — its own wordmark. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#67e8f9",
            boxShadow: "0 0 12px #67e8f9",
          }}
        />
        <strong style={{ fontSize: 11.5, letterSpacing: "0.18em", textTransform: "uppercase", color: "#dbeafe" }}>
          Lélu · System
        </strong>
      </div>

      {/* Mode chips — this environment's navigation. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {MODES.map((item) => {
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onMode(item.id as never)}
              style={{
                border: active ? "1px solid rgba(103, 232, 249, 0.55)" : "1px solid rgba(148, 163, 184, 0.2)",
                borderRadius: 999,
                background: active ? "rgba(34, 211, 238, 0.16)" : "rgba(255, 255, 255, 0.04)",
                color: active ? "#a5f3fc" : "rgba(203, 226, 244, 0.8)",
                padding: "5px 10px",
                fontSize: 10.5,
                letterSpacing: "0.06em",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Views — the real agent views in THIS environment. */}
      <button
        type="button"
        onClick={() => setViewDrawer((value) => !value)}
        style={{
          border: "1px solid rgba(148, 163, 184, 0.25)",
          borderRadius: 999,
          background: "rgba(255, 255, 255, 0.05)",
          color: "#dbeafe",
          padding: "5px 10px",
          fontSize: 10.5,
          letterSpacing: "0.06em",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Views {views.length > 0 ? `· ${views.length}` : ""}
      </button>

      {/* UI #3 — Genesis v2 Transformation Lab, reachable from this
          environment too: it switches to the primary environment and
          opens the lab over the SAME one Core. */}
      <button
        type="button"
        onClick={onOpenLab}
        title="Open the Genesis v2 Transformation Lab"
        style={{
          border: "1px solid rgba(232, 121, 249, 0.42)",
          borderRadius: 999,
          background: "rgba(232, 121, 249, 0.1)",
          color: "#f5d0fe",
          padding: "5px 10px",
          fontSize: 10.5,
          letterSpacing: "0.06em",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        ⬡ Genesis v2
      </button>

      {/* Exit back to the primary environment. */}
      <button
        type="button"
        onClick={onExit}
        title="Return to the primary LÉLU environment"
        style={{
          border: "1px solid rgba(52, 211, 153, 0.4)",
          borderRadius: 999,
          background: "rgba(52, 211, 153, 0.1)",
          color: "#a7f3d0",
          padding: "5px 10px",
          fontSize: 10.5,
          letterSpacing: "0.06em",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        ◂ Primary
      </button>

      {/* Drawer of shared views inside this environment. */}
      {viewDrawer ? (
        <div
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 52px)",
            left: 12,
            right: 12,
            maxHeight: "min(46dvh, 320px)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 10,
            borderRadius: 14,
            background: "rgba(4, 9, 18, 0.92)",
            border: "1px solid rgba(103, 232, 249, 0.22)",
            boxShadow: "0 18px 48px rgba(0, 0, 0, 0.5)",
            zIndex: 4,
          }}
        >
          {views.length === 0 ? (
            <div style={{ color: "rgba(148, 163, 184, 0.7)", fontSize: 11, padding: 4 }}>
              No active views yet — ask LÉLU to show providers, memory, research…
            </div>
          ) : (
            views.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => {
                  onFocusView(view.id);
                  setViewDrawer(false);
                }}
                style={{
                  textAlign: "left",
                  border: focusId === view.id ? "1px solid rgba(103, 232, 249, 0.55)" : "1px solid rgba(148, 163, 184, 0.18)",
                  borderRadius: 10,
                  background: focusId === view.id ? "rgba(34, 211, 238, 0.12)" : "rgba(255, 255, 255, 0.03)",
                  color: "#dbeafe",
                  padding: "8px 10px",
                  fontSize: 11.5,
                  cursor: "pointer",
                }}
              >
                <span style={{ opacity: 0.7, marginRight: 8 }}>{view.kind}</span>
                {view.title}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------- system core ---------------------------- */

function SystemCore({
  heartbeatRate,
  runtime,
  onClick,
}: {
  heartbeatRate: number;
  runtime: VisualStateRuntime;
  onClick: () => void;
}) {
  const phase = runtime.thinking
    ? "thinking"
    : runtime.speaking
      ? "speaking"
      : runtime.toolsActive > 0
        ? "tools"
        : runtime.listening
          ? "listening"
          : "idle";
  const color = runtime.error
    ? "#f87171"
    : phase === "thinking"
      ? "#a78bfa"
      : phase === "speaking"
        ? "#67e8f9"
        : phase === "tools"
          ? "#38bdf8"
          : "#34d399";
  const beatMs = Math.max(420, (60 / Math.max(20, heartbeatRate)) * 1000);

  return (
    <button
      type="button"
      onClick={onClick}
      title="Talk to LÉLU"
      aria-label="Talk to LÉLU"
      style={{
        position: "absolute",
        left: "50%",
        top: "46%",
        transform: "translate(-50%, -50%)",
        width: 72,
        height: 72,
        borderRadius: 999,
        border: `1px solid ${color}88`,
        background: "radial-gradient(circle at 50% 40%, rgba(20, 32, 56, 0.9), rgba(4, 9, 18, 0.95))",
        boxShadow: `0 0 ${28 + Math.min(28, heartbeatRate / 3)}px ${color}55, inset 0 0 22px ${color}22`,
        cursor: "pointer",
        zIndex: 3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
        animation: `living-core-beat ${beatMs}ms ease-in-out infinite`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: color,
          boxShadow: `0 0 22px ${color}`,
        }}
      />
    </button>
  );
}

/* -------------------------- system workspace -------------------------- */

/**
 * The shared WorkspaceEngine views, laid out SPATIALLY inside the
 * environment — the focused view sits as a large surface in the field,
 * the others float around it as secondary surfaces. This is a different
 * presentation model from the Genesis grid: nodes in a field, not cards
 * in a window.
 */
function SystemWorkspace({
  views,
  focusId,
  onFocusView,
  onCloseView,
  onOpenChat,
}: {
  views: WorkspaceView[];
  focusId: string | null;
  onFocusView: (id: string) => void;
  onCloseView: (id: string) => void;
  onOpenChat: () => void;
}) {
  const ordered = useMemo(() => {
    const list = [...views];
    list.sort((a, b) => {
      const fa = a.id === focusId ? 0 : 1;
      const fb = b.id === focusId ? 0 : 1;
      return fa - fb || b.updatedAt - a.updatedAt;
    });
    return list;
  }, [views, focusId]);

  if (ordered.length === 0) {
    // Empty field: keep a quiet affordance that the workspace lives here.
    return (
      <div
        style={{
          position: "absolute",
          right: 18,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(148, 163, 184, 0.45)",
          pointerEvents: "none",
        }}
      >
        field ready · ask LÉLU to show work
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {ordered.map((view, index) => {
        const focused = view.id === focusId;
        const position = surfacePosition(index, focused);
        return (
          <div
            key={view.id}
            onClick={() => onFocusView(view.id)}
            style={{
              position: "absolute",
              ...position,
              width: focused ? "min(46vw, 460px)" : "min(30vw, 300px)",
              minWidth: focused ? 260 : 180,
              maxHeight: focused ? "min(46dvh, 420px)" : "min(34dvh, 300px)",
              pointerEvents: "auto",
              overflow: "hidden",
              borderRadius: 14,
              background: "rgba(6, 12, 24, 0.82)",
              border: focused ? "1px solid rgba(103, 232, 249, 0.5)" : "1px solid rgba(148, 163, 184, 0.16)",
              boxShadow: focused
                ? "0 20px 60px rgba(0, 0, 0, 0.55), 0 0 40px rgba(56, 189, 248, 0.12)"
                : "0 10px 32px rgba(0, 0, 0, 0.4)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              transition: "all 0.3s ease",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
                flexShrink: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: focused ? "#67e8f9" : "rgba(148, 163, 184, 0.5)",
                  boxShadow: focused ? "0 0 8px #67e8f9" : "none",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 10.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: focused ? "#bae6fd" : "rgba(203, 226, 244, 0.75)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {view.kind} · {view.title}
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseView(view.id);
                }}
                aria-label={`Close ${view.title}`}
                style={{
                  border: "none",
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "rgba(226, 232, 240, 0.8)",
                  borderRadius: 999,
                  width: 18,
                  height: 18,
                  fontSize: 10,
                  lineHeight: 1,
                  cursor: "pointer",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", minHeight: 0 }}>
              {view.spec ? <WorkspaceVisual spec={view.spec} viewState={view.viewState} /> : null}
            </div>
          </div>
        );
      })}

      {/* Field hint: the core is the conversation. */}
      <button
        type="button"
        onClick={onOpenChat}
        style={{
          position: "absolute",
          right: 16,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
          border: "1px solid rgba(103, 232, 249, 0.35)",
          borderRadius: 999,
          background: "rgba(34, 211, 238, 0.1)",
          color: "#bae6fd",
          padding: "6px 12px",
          fontSize: 10.5,
          letterSpacing: "0.08em",
          cursor: "pointer",
          pointerEvents: "auto",
          zIndex: 3,
        }}
      >
        ◎ talk to LÉLU
      </button>
    </div>
  );
}

/** Deterministic spatial placement for surfaces around the core. */
function surfacePosition(index: number, focused: boolean): CSSProperties {
  if (focused) {
    return { left: "42%", top: "12%", transform: "translateX(-50%)" };
  }
  const slots = [
    { left: "4%", top: "18%" },
    { left: "4%", top: "52%" },
    { left: "50%", top: "64%" },
    { left: "72%", top: "16%" },
    { left: "82%", top: "52%" },
    { left: "30%", top: "74%" },
    { left: "14%", top: "76%" },
  ];
  const slot = slots[Math.max(0, index - 1) % slots.length];
  return { left: slot.left, top: slot.top };
}

/* --------------------------- activity strip --------------------------- */

const EVENT_LABELS: Record<string, string> = {
  task_started: "Task started",
  task_planning: "Planning",
  tool_selected: "Tool selected",
  tool_started: "Tool running",
  tool_result: "Tool result",
  memory_retrieval: "Memory retrieval",
  memory_update: "Memory updated",
  provider_selected: "Provider selected",
  provider_status: "Provider status",
  browser_opened: "Browser opened",
  browser_navigation: "Navigating",
  task_completed: "Task complete",
  task_failed: "Task failed",
  visual_created: "Visual created",
};

function ActivityStrip({ events, lastEvent }: { events: AgentEvent[]; lastEvent: AgentEvent | null }) {
  const recent = lastEvent ? [lastEvent, ...events.slice(-6)].slice(0, 7) : events.slice(-6);
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        display: "flex",
        gap: 6,
        overflowX: "auto",
        padding: "8px 10px",
        borderRadius: 12,
        background: "rgba(4, 9, 18, 0.78)",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 3,
        pointerEvents: "auto",
        scrollbarWidth: "none",
      }}
    >
      {recent.length === 0 ? (
        <span style={{ color: "rgba(148, 163, 184, 0.55)", fontSize: 10.5, letterSpacing: "0.08em" }}>
          waiting for LÉLU… system idle
        </span>
      ) : (
        recent.map((event, index) => (
          <span
            key={`${event.type}-${index}`}
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid rgba(103, 232, 249, 0.18)",
              borderRadius: 999,
              background: "rgba(34, 211, 238, 0.06)",
              color: "rgba(186, 230, 253, 0.85)",
              padding: "3px 9px",
              fontSize: 10,
              letterSpacing: "0.05em",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: event.type === "task_failed" ? "#f87171" : "#67e8f9",
                boxShadow: event.type === "task_failed" ? "0 0 6px #f87171" : "0 0 6px #67e8f9",
              }}
            />
            {EVENT_LABELS[event.type] ?? event.type}
          </span>
        ))
      )}
    </div>
  );
}
