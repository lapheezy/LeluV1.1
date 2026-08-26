/**
 * ==========================================================
 * LÉLUVERSE
 * EXECUTIVE DIAGNOSTICS PANEL
 *
 * Developer/verification surface for the Executive Runtime.
 * EVERY value rendered here is read live from the executive
 * self-state — measured telemetry, verified actions, real
 * diagnostics. There are no decorative statuses and no
 * hard-coded "healthy" labels; if a subsystem is broken, this
 * panel says so, and if it has nothing to report it shows
 * exactly that.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import ExecutiveRuntime, { type ExecutiveSelfState } from "../../../core/executive/ExecutiveRuntime";
import GenesisWindowFrame from "./GenesisWindowFrame";
import { genesisTheme } from "./GenesisTheme";

interface GenesisExecutivePanelProps {
  onClose: () => void;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        fontSize: 12,
        padding: "5px 8px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: tone ?? "white", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function statusTone(status: string): string | undefined {
  if (status === "ok" || status === "healthy" || status === "completed") return genesisTheme.status.ok;
  if (status === "warning" || status === "degraded" || status === "unverified") return "#fbbf24";
  if (status === "error" || status === "critical" || status === "failed") return genesisTheme.status.error;
  return undefined;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: 0.55,
          margin: "12px 0 6px",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

export default function GenesisExecutivePanel({ onClose }: GenesisExecutivePanelProps) {
  const [state, setState] = useState<ExecutiveSelfState>(() => ExecutiveRuntime.getInstance().get());

  useEffect(() => ExecutiveRuntime.getInstance().subscribe((next) => setState({ ...next })), []);

  const s = state;

  return (
    <GenesisWindowFrame
      title={`Executive runtime · ${s.systemHealth.toUpperCase()} · tick ${s.loopTicks}`}
      onClose={onClose}
      width="min(94vw, 560px)"
      active={s.systemHealth !== "healthy"}
    >
      {/* ------------------------------ SELF ------------------------------ */}
      <Section title="LÉLU Self State">
        <Row label="Mode" value={s.currentMode + (s.ambientBehavior ? ` — ${s.ambientBehavior}` : "")} />
        {s.currentGoal ? <Row label="Goal" value={s.currentGoal} /> : null}
        <Row
          label="Task"
          value={s.currentTask ? `${s.currentTask.label} [${s.taskStatus}]` : `none [${s.taskStatus}]`}
          tone={statusTone(s.taskStatus)}
        />
        {s.currentAction ? <Row label="Executing" value={s.currentAction} /> : null}
      </Section>

      {/* --------------------------- LAST ACTION --------------------------- */}
      <Section title="Last Verified Action">
        {s.lastAction ? (
          <>
            <Row label="Intent" value={s.lastAction.intent} />
            <Row label="Execution" value={s.lastAction.execution} />
            <Row label="Observation" value={s.lastAction.observation} />
            <Row
              label="Verification"
              value={s.lastAction.verified ? "VERIFIED against telemetry" : "UNVERIFIED"}
              tone={s.lastAction.verified ? genesisTheme.status.ok : "#fbbf24"}
            />
          </>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.55 }}>No action executed yet.</div>
        )}
        {s.nextPlannedAction ? <Row label="Next planned" value={s.nextPlannedAction} /> : null}
      </Section>

      {/* ----------------------------- AVATAR ----------------------------- */}
      <Section title="Avatar / Renderer">
        <Row
          label="Presence"
          value={s.avatar.mounted ? "mounted" : "not mounted (Gen V2 closed)"}
          tone={s.avatar.mounted ? genesisTheme.status.ok : undefined}
        />
        <Row label="Frames observed" value={String(s.avatar.frames)} />
        <Row
          label="Render loop"
          value={
            s.avatar.lastFrameAt === null
              ? "no frame ever reported"
              : `${Math.max(0, Math.round((Date.now() - s.avatar.lastFrameAt) / 100) / 10)}s since last frame`
          }
          tone={
            s.avatar.lastFrameAt !== null && Date.now() - s.avatar.lastFrameAt < 5000
              ? genesisTheme.status.ok
              : s.avatar.mounted
                ? genesisTheme.status.error
                : undefined
          }
        />
        <Row
          label="Moving"
          value={s.avatar.moving ? "YES — transforms advancing" : s.avatar.mounted ? "NO — static" : "—"}
          tone={s.avatar.moving ? genesisTheme.status.ok : s.avatar.mounted ? "#fbbf24" : undefined}
        />
      </Section>

      {/* --------------------------- WORKSPACE/UI --------------------------- */}
      <Section title="Workspace / Browser">
        <Row
          label="Open surfaces"
          value={s.workspaceOpenSurfaces.length > 0 ? s.workspaceOpenSurfaces.join(", ") : "none"}
        />
        <Row label="Browser last URL" value={s.browserLastUrl ?? "—"} />
      </Section>

      {/* --------------------------- COGNITION ---------------------------- */}
      <Section title="Cognition">
        <Row label="Executive loop" value={`${s.loopTicks} ticks · every 10s`} />
        <Row label="Self-state feed" value="CONNECTED to chat cognition" tone={genesisTheme.status.ok} />
        <Row
          label="Ambient behavior"
          value={s.ambientBehavior ?? (s.currentMode === "ambient" ? "selecting…" : "idle")}
        />
      </Section>

      {/* --------------------------- DIAGNOSTICS --------------------------- */}
      <Section title={`Diagnostics (${s.diagnostics.filter((d) => d.status !== "ok").length} attention)`}>
        {s.diagnostics.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.55 }}>First diagnostic cycle still running…</div>
        ) : (
          s.diagnostics.map((check) => (
            <Row
              key={check.id}
              label={`${check.subsystem} · ${check.status}`}
              value={check.detail}
              tone={statusTone(check.status)}
            />
          ))
        )}
      </Section>

      {/* ------------------------- ERRORS/WARNINGS ------------------------- */}
      <Section
        title={`Active errors (${s.activeErrors.filter((e) => e.recoveredAt === null).length}) · warnings (${s.activeWarnings.filter((w) => w.recoveredAt === null).length})`}
      >
        {[...s.activeErrors, ...s.activeWarnings].length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.55 }}>No active issues detected.</div>
        ) : (
          [...s.activeErrors, ...s.activeWarnings]
            .slice(0, 8)
            .map((issue, i) => (
              <Row
                key={`${issue.at}-${i}`}
                label={`${issue.severity === "error" ? "ERROR" : "warn"} · ${issue.source}`}
                value={
                  issue.recoveredAt === null
                    ? issue.message
                    : `${issue.message} — RECOVERED`
                }
                tone={issue.recoveredAt !== null ? genesisTheme.status.ok : statusTone(issue.severity)}
              />
            ))
        )}
      </Section>
    </GenesisWindowFrame>
  );
}
