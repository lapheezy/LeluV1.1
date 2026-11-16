/**
 * ==========================================================
 * LÉLU — RUNTIME READINESS DASHBOARD
 *
 * An INTERNAL surface, never part of the experience: it is
 * rendered only when the page is opened with `?diagnostics`,
 * so nothing here can clutter the Cosmos, and it costs nothing
 * on a normal load (its own chunk is never fetched).
 *
 * It exists to answer the question this mission is built on:
 *
 *     APPLICATION LOADED  ≠  LÉLU OPERATIONAL
 *
 * so the two are shown as two different lines, and every
 * subsystem carries the EVIDENCE behind its state rather than a
 * green dot. A subsystem with no evidence is grey, not green.
 * ==========================================================
 */

import { useSyncExternalStore } from "react";
import {
  DEPENDS_ON,
  READY_MEANS,
  readiness,
  type ReadinessSnapshot,
  type ReadinessState,
} from "../../../../core/runtime/readiness";

const COLOR: Record<ReadinessState, string> = {
  NOT_INITIALIZED: "#64748b",
  INITIALIZING: "#38bdf8",
  READY: "#34d399",
  DEGRADED: "#fbbf24",
  FAILED: "#f87171",
  SUSPENDED: "#94a3b8",
  RECOVERING: "#a78bfa",
};

const LABEL: Record<ReadinessState, string> = {
  NOT_INITIALIZED: "not initialized",
  INITIALIZING: "initializing",
  READY: "ready",
  DEGRADED: "degraded",
  FAILED: "failed",
  SUSPENDED: "suspended",
  RECOVERING: "recovering",
};

function since(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export default function ReadinessDashboard() {
  const registry = readiness();
  const snapshot: ReadinessSnapshot = useSyncExternalStore(
    (onChange) => registry.subscribe(onChange),
    () => registry.get(),
    () => registry.get(),
  );

  const ready = snapshot.subsystems.filter((s) => s.state === "READY").length;

  return (
    <div
      data-lelu-diagnostics="readiness"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        maxWidth: "100vw",
        zIndex: 9000,
        /*
         * `pointer-events: none` is load-bearing, not cosmetic. Measured on a
         * 384px viewport: a 380px panel covers the entire interface, and
         * Playwright could not click Chat because this overlay swallowed the
         * tap. A diagnostics READOUT must never take input from the app it is
         * describing, so nothing in here is interactive and every tap passes
         * through to the interface underneath.
         */
        pointerEvents: "none",
        background: "rgba(2, 6, 23, 0.96)",
        borderLeft: "1px solid rgba(148, 163, 184, 0.25)",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.45,
        overflowY: "auto",
        padding: "14px 14px 24px",
      }}
    >
      <div style={{ letterSpacing: "0.18em", color: "#94a3b8", fontSize: 9 }}>
        RUNTIME READINESS
      </div>

      <div style={{ marginTop: 8, fontSize: 12 }}>
        <span style={{ color: "#34d399" }}>APPLICATION LOADED</span>
        <span style={{ color: "#64748b" }}> — always true when you can read this</span>
      </div>
      <div style={{ fontSize: 12 }}>
        <span style={{ color: snapshot.operational ? "#34d399" : "#fbbf24" }}>
          {snapshot.operational ? "LÉLU OPERATIONAL" : "LÉLU PARTIALLY OPERATIONAL"}
        </span>
        <span style={{ color: "#64748b" }}>
          {" "}
          — {ready}/{snapshot.subsystems.length} subsystems confirmed
        </span>
      </div>

      <div
        style={{
          marginTop: 12,
          borderTop: "1px solid rgba(148, 163, 184, 0.2)",
          paddingTop: 8,
        }}
      >
        {snapshot.subsystems.map((s) => (
          <div key={s.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  background: COLOR[s.state],
                  flex: "0 0 auto",
                }}
              />
              <strong style={{ fontSize: 11.5 }}>{s.id}</strong>
              <span style={{ color: COLOR[s.state], fontSize: 10 }}>
                {LABEL[s.state]}
              </span>
              <span style={{ marginLeft: "auto", color: "#475569", fontSize: 9 }}>
                {since(s.durationMs)}
              </span>
            </div>
            <div style={{ color: "#94a3b8", paddingLeft: 13 }}>{s.detail}</div>
            {s.state !== "READY" && (
              <div style={{ color: "#475569", paddingLeft: 13, fontSize: 9.5 }}>
                ready means: {READY_MEANS[s.id]}
              </div>
            )}
            {DEPENDS_ON[s.id].length > 0 && (
              <div style={{ color: "#334155", paddingLeft: 13, fontSize: 9.5 }}>
                depends on {DEPENDS_ON[s.id].join(", ")}
              </div>
            )}
            {s.lastVerified !== null && (
              <div style={{ color: "#334155", paddingLeft: 13, fontSize: 9.5 }}>
                last verified {new Date(s.lastVerified).toLocaleTimeString()}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, color: "#475569", fontSize: 9.5 }}>
        snapshot {new Date(snapshot.at).toLocaleTimeString()} · close the page to stop
      </div>
    </div>
  );
}
