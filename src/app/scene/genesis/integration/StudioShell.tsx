/**
 * ==========================================================
 * LÉLU — STUDIO PRIMITIVES
 *
 * The shared visual vocabulary for the four operational
 * studios. Not a new design language: it composes the same
 * glass, cyan accent, uppercase micro-label and 8/10/12/14px
 * radii the rest of Genesis uses, so the studios look like
 * they were always part of Cosmos.
 *
 * Two rules made these primitives instead of per-panel copies:
 *   • every state has a rendered form (loading, error,
 *     unavailable, empty, ready) — a screen can never show an
 *     indefinite spinner or a silent blank;
 *   • status colour comes from the value, never from the panel,
 *     so a green pill always means a probed healthy state.
 * ==========================================================
 */

import type { CSSProperties, ReactNode } from "react";
import { genesisTheme } from "../GenesisTheme";
import { formatDuration, healthColor, healthLabel, relativeTime } from "./useIntegration";

export function Section({ title, hint, children, actions }: { title: string; hint?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.62 }}>{title}</div>
          {hint ? <div style={{ fontSize: 10.5, opacity: 0.45, marginTop: 2 }}>{hint}</div> : null}
        </div>
        {actions}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </section>
  );
}

export function Card({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <div
      style={{
        border: `1px solid ${tint ?? "rgba(255,255,255,0.1)"}`,
        borderRadius: 12,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.03)",
        fontSize: 11.5,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

export function Row({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11.5, lineHeight: 1.6 }} title={title}>
      <span style={{ opacity: 0.6, minWidth: 0 }}>{label}</span>
      <span style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

export function Pill({ state, label }: { state: string; label?: string }) {
  const color = healthColor(state);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 9.5,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        padding: "3px 7px",
        borderRadius: 999,
        color,
        border: `1px solid ${color}55`,
        background: `${color}14`,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {label ?? healthLabel(state)}
    </span>
  );
}

/** A counted value with an honest unit — never a decorative stat. */
export function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: "8px 10px",
        background: "rgba(255,255,255,0.03)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.12em", opacity: 0.55 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: tone ?? "#e6f4ff", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))", gap: 8 }}>{children}</div>
  );
}

export function LoadingState({ what }: { what: string }) {
  return (
    <div role="status" aria-live="polite" style={{ fontSize: 11.5, opacity: 0.65, padding: "10px 0" }}>
      Reading {what} from the server…
    </div>
  );
}

export function ErrorState({ what, error, onRetry }: { what: string; error: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ border: "1px solid rgba(248,113,113,0.4)", borderRadius: 10, padding: "10px 12px", background: "rgba(248,113,113,0.07)", fontSize: 11.5, lineHeight: 1.6 }}>
      <strong style={{ color: "#fca5a5" }}>{what} could not be read.</strong>
      <div style={{ opacity: 0.85, marginTop: 4 }}>{error}</div>
      {onRetry ? (
        <button type="button" onClick={onRetry} style={smallButton}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ border: "1px dashed rgba(148,163,184,0.3)", borderRadius: 10, padding: "10px 12px", fontSize: 11.5, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 600, opacity: 0.85 }}>{title}</div>
      <div style={{ opacity: 0.6, marginTop: 2 }}>{detail}</div>
    </div>
  );
}

export function SourceNote({ path, updatedAt, extra }: { path: string; updatedAt: number | null; extra?: string }) {
  return (
    <div style={{ fontSize: 10, opacity: 0.45, marginTop: 12, lineHeight: 1.6 }}>
      Source <code style={{ opacity: 0.9 }}>{path}</code> · fetched {relativeTime(updatedAt)} · values are server-observed, not estimated
      {extra ? ` · ${extra}` : ""}
    </div>
  );
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length === 0) {
    return <div style={{ fontSize: 10.5, opacity: 0.5 }}>{label}: no samples.</div>;
  }
  const max = Math.max(...values, 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 26 }} aria-hidden>
        {values.slice(-24).map((value, index) => (
          <div
            key={index}
            title={formatDuration(value)}
            style={{
              flex: 1,
              minWidth: 2,
              height: `${Math.max(8, (value / max) * 26)}px`,
              background: "rgba(103,232,249,0.55)",
              borderRadius: 2,
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 10, opacity: 0.5, marginTop: 3 }}>{label}</div>
    </div>
  );
}

export const smallButton: CSSProperties = {
  border: "1px solid rgba(125,211,252,0.35)",
  borderRadius: 8,
  background: "rgba(34,211,238,0.1)",
  color: "#d9f6ff",
  padding: "6px 10px",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
  marginTop: 8,
};

export const ghostButton: CSSProperties = {
  ...smallButton,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "white",
};

export const studioScroll: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  paddingBottom: 8,
  maxHeight: "100%",
  overflowY: "auto",
  overscrollBehavior: "contain",
  scrollbarWidth: "thin",
};

export const codeText: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 10.5,
  opacity: 0.8,
  overflowWrap: "anywhere",
};

export const studioFrame = {
  width: "min(94vw, 760px)",
  maxHeight: "min(90vh, 820px)",
} as const;

export const elevated = genesisTheme.elevation.focus.boxShadow;
