/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS DIAGNOSTICS PANEL
 *
 * Phase 6.
 *
 * `EngineRuntime` registers ~36 simulation engines (Gravity,
 * Memory, Knowledge, Consciousness, ...) and GenesisCore has
 * tracked `state.engineStatuses: EngineStatus[]` since the
 * runtime was first wired up — but no UI ever read it. This
 * is the first surface for it: a calm badge (just a live
 * count + error count) that expands into the full per-engine
 * list only when asked, matching the brief's "expose useful
 * state through the interface without overwhelming the user."
 *
 * Read-only. Does not attempt to enable/disable engines from
 * here — EngineRegistry has no such live-toggle API, and
 * adding one is a runtime-safety decision that belongs in a
 * pass with a real build environment to verify against, not
 * bolted on from the UI layer blind.
 * ==========================================================
 */

import { useMemo, useState } from "react";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import GenesisWindowFrame from "./GenesisWindowFrame";

interface GenesisDiagnosticsPanelProps {
  onClose: () => void;
}

export default function GenesisDiagnosticsPanel({ onClose }: GenesisDiagnosticsPanelProps) {
  const { state } = useGenesis();
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled" | "error">("all");

  const statuses = state.engineStatuses;

  const summary = useMemo(() => {
    const enabled = statuses.filter((engine) => engine.enabled).length;
    const errors = statuses.filter((engine) => Boolean(engine.error)).length;
    return { total: statuses.length, enabled, errors };
  }, [statuses]);

  const rows = useMemo(() => {
    const sorted = [...statuses].sort((a, b) => a.priority - b.priority);
    if (filter === "all") return sorted;
    if (filter === "error") return sorted.filter((engine) => Boolean(engine.error));
    if (filter === "enabled") return sorted.filter((engine) => engine.enabled);
    return sorted.filter((engine) => !engine.enabled);
  }, [statuses, filter]);

  return (
    <GenesisWindowFrame
      title={
        <>
          Engine diagnostics · {summary.enabled}/{summary.total} live
          {summary.errors > 0 ? ` · ${summary.errors} error${summary.errors === 1 ? "" : "s"}` : ""}
        </>
      }
      onClose={onClose}
      width="min(92vw, 520px)"
      active={summary.errors > 0}
    >
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {(["all", "enabled", "disabled", "error"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            style={{
              border: filter === option ? genesisTheme.glass.borderAccent : genesisTheme.glass.borderSoft,
              borderRadius: genesisTheme.radius.pill,
              background: filter === option ? "rgba(34, 211, 238, 0.16)" : "rgba(255,255,255,0.04)",
              color: "white",
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {option}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {statuses.length === 0
            ? "Engine runtime is still booting — statuses will appear once it reports in."
            : "No engines match this filter."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((engine) => {
            const dotColor = engine.error
              ? genesisTheme.status.error
              : engine.enabled
                ? genesisTheme.status.ok
                : genesisTheme.status.idle;

            return (
              <div
                key={engine.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  padding: "6px 8px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <span
                  style={{
                    marginTop: 4,
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: dotColor,
                    boxShadow: engine.error ? `0 0 8px ${genesisTheme.status.error}` : "none",
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{engine.id}</span>
                    <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>priority {engine.priority}</span>
                  </div>
                  {engine.error ? (
                    <div style={{ color: "#fecaca", marginTop: 2, overflowWrap: "anywhere" }}>{engine.error}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GenesisWindowFrame>
  );
}
