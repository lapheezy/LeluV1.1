/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS STATUS PANEL
 *
 * The reference workspace preview's upper-left panel. This is
 * the SAME status card that used to live inline in
 * GenesisInterface — extracted, restyled to the reference
 * (header + workspace pills + destination line + evolution
 * footer) and widened to ~500px on desktop.
 *
 * Every value is real application state:
 *   Live · pulse %   → state.runtimeReady / universe.pulse.heartbeat
 *   pills            → state.cognition.workspaces (live list)
 *   destination      → state.activeDestination
 *   Evolution · cycle → universe.evolutionSystem.stage / universe.age
 *
 * Refresh re-dispatches the existing genesis:interaction event
 * so any engine listening for interaction reacts; minimize
 * keeps the existing collapse behavior (reference shows only
 * the refresh glyph, but collapsing the environment must stay
 * reachable — a subtle second glyph preserves it).
 * ==========================================================
 */

import { useState, type CSSProperties } from "react";
import { useGenesis } from "./GenesisCore";

export default function GenesisStatusPanel() {
  const { state, universe, minimize, dispatch, focusWorkspace, selectDestination } = useGenesis();

  const [spinning, setSpinning] = useState(false);

  const workspaces = state.cognition?.workspaces ?? [];
  const pulse = universe.pulse.heartbeat;
  const morphology = universe.morphology ?? "PLASMA";
  const evolutionStage = Math.max(0, Math.min(1, universe.evolutionSystem.stage));
  const evolutionColor =
    universe.evolutionSystem.colorShift > 0.72
      ? "#fbbf24"
      : universe.evolutionSystem.colorShift > 0.42
        ? "#a78bfa"
        : "#67e8f9";

  function handleRefresh() {
    // Real event: engines/interaction subscribers react; the button
    // briefly spins so the user sees the handshake happen.
    dispatch("genesis:interaction", { kind: "refresh" });
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 600);
  }

  function handleWorkspace(id: string, name: string, index: number) {
    focusWorkspace(id);
    selectDestination({
      id,
      type: "workspace",
      name,
      position: { x: index * 3 - 3, y: 0, z: -5 },
    });
  }

  const iconButton: CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(214, 228, 244, 0.85)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
    transition: "background 0.15s ease, border-color 0.15s ease",
  };

  return (
    <div
      style={{
        width: "min(500px, calc(100vw - 130px))",
        boxSizing: "border-box",
        borderRadius: 22,
        border: `1px solid rgba(148, 210, 255, 0.28)`,
        background:
          "linear-gradient(150deg, rgba(8, 16, 40, 0.72), rgba(14, 24, 54, 0.55) 55%, rgba(30, 14, 58, 0.42))",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        boxShadow:
          "0 18px 50px rgba(2, 6, 23, 0.45), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 34px rgba(59, 130, 246, 0.14), 0 0 90px rgba(168, 85, 247, 0.10)",
        padding: "14px 16px 12px",
        color: "white",
        pointerEvents: "auto",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* subtle internal cosmic glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -60,
          right: -40,
          width: 180,
          height: 180,
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(103, 232, 249, 0.14), transparent 65%)",
          pointerEvents: "none",
        }}
      />

      {/* Header row: Genesis · Live · pulse · refresh/minimize */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>
          Genesis
        </strong>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span
            aria-hidden
            className="genesis-status-glow"
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: "#4ade80",
              color: "#4ade80",
            }}
          />
          <span style={{ color: "#4ade80", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>
            Live
          </span>
        </span>
        <span style={{ opacity: 0.62, fontSize: 11.5, whiteSpace: "nowrap" }}>
          · {state.runtimeReady ? `${Math.round(pulse * 100)}% pulse` : "booting"}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleRefresh}
          title="Refresh Genesis state"
          aria-label="Refresh Genesis state"
          style={{ ...iconButton, transform: spinning ? "rotate(180deg)" : "none", transition: "transform 0.5s ease, background 0.15s ease" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={minimize}
          title="Minimize Genesis"
          aria-label="Minimize Genesis"
          style={iconButton}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Workspace pills — single scrolling row so the panel stays compact
          on phones and never grows over the core visualization. */}
      <div
        style={{
          display: "flex",
          flexWrap: "nowrap",
          gap: 6,
          marginTop: 11,
          overflowX: "auto",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {workspaces.length > 0 ? (
          workspaces.map((workspace: any, index: number) => {
            const id = workspace.id ?? String(index);
            const active = state.activeWorkspace === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleWorkspace(id, workspace.name ?? "Workspace", index)}
                style={{
                  border: active
                    ? "1px solid rgba(125, 211, 252, 0.55)"
                    : "1px solid rgba(148, 163, 184, 0.22)",
                  borderRadius: 999,
                  background: active
                    ? "rgba(34, 211, 238, 0.16)"
                    : "rgba(2, 6, 23, 0.42)",
                  color: active ? "#dff6ff" : "rgba(203, 226, 244, 0.88)",
                  padding: "5px 12px",
                  fontSize: 11.5,
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  transition: "background 0.15s ease, border-color 0.15s ease",
                }}
              >
                {workspace.name ?? "Workspace"}
              </button>
            );
          })
        ) : (
          <span style={{ fontSize: 11, opacity: 0.6 }}>No workspaces yet</span>
        )}
      </div>

      {/* Destination line */}
      <div style={{ opacity: 0.6, fontSize: 11.5, marginTop: 10 }}>
        {state.activeDestination ? `At: ${state.activeDestination}` : "No active destination"}
      </div>

      {/* Footer status: green dot · evolution · cycle · morphology */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          fontSize: 11.5,
          color: "rgba(228, 244, 255, 0.92)",
        }}
      >
        <span
          aria-hidden
          className="genesis-status-glow"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: evolutionColor,
            color: evolutionColor,
            flexShrink: 0,
          }}
        />
        <span style={{ letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
          Evolution {Math.round(evolutionStage * 100)}% · cycle {Math.floor(universe.age)}
        </span>
        <span
          aria-hidden
          style={{ width: 1, height: 10, background: "rgba(255,255,255,0.14)", flexShrink: 0 }}
        />
        <span
          style={{
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontSize: 10,
            color: "rgba(186, 230, 253, 0.78)",
            whiteSpace: "nowrap",
          }}
        >
          Morph · {morphology}
        </span>
      </div>
    </div>
  );
}
