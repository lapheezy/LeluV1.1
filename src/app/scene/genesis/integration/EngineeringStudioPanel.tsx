/**
 * ==========================================================
 * LÉLU — ENGINEERING STUDIO
 *
 * The visible face of `EngineeringOrchestrator`, reading the real
 * `/api/integration/engineering` payload plus the existing
 * `/api/engineer/status`. It shows what is actually true:
 *
 *   • which engines exist and whether each is usable right now;
 *   • which workspaces are locked, and by which engine;
 *   • every task with its changed files, test counts and verdict;
 *   • the verification rules the orchestrator enforces.
 *
 * An unavailable engine is shown as unavailable. A task is shown
 * as VERIFIED only when the payload carries a real test run with
 * zero failures — the same rule the server applies.
 * ==========================================================
 */

import GenesisWindowFrame from "../GenesisWindowFrame";
import {
  formatDuration,
  relativeTime,
  useIntegrationResource,
  verificationOf,
  type EngineeringPayload,
  type IntegrationStatus,
} from "./useIntegration";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  MetricGrid,
  Pill,
  Row,
  Section,
  SourceNote,
  codeText,
  ghostButton,
  studioFrame,
  studioScroll,
} from "./StudioShell";

interface EngineerRuntimeStatus {
  ok: boolean;
  runtime: string;
  available: boolean;
  operations: string[];
  workspace: string;
  tokenRequired: boolean;
  identityVerification: boolean;
  runtimeInfo?: Record<string, unknown>;
}

export default function EngineeringStudioPanel({ onClose }: { onClose: () => void }) {
  const engineering = useIntegrationResource<EngineeringPayload>("/api/integration/engineering", 15_000);
  const runtime = useIntegrationResource<EngineerRuntimeStatus>("/api/engineer/status", 30_000);
  const integration = useIntegrationResource<IntegrationStatus>("/api/integration/status", 30_000);
  const payload = engineering.data;

  const tasks = payload?.tasks ?? [];
  const locks = payload?.locks ?? [];
  const engines = payload?.engines ?? [];

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Engineering"
      title="Engineering Studio · execution, verification, engines"
      onClose={onClose}
      width={studioFrame.width}
      maxHeight={studioFrame.maxHeight}
      elevation="focus"
      extraActions={
        <button type="button" style={ghostButton} onClick={engineering.refresh} aria-label="Refresh engineering state">
          Refresh
        </button>
      }
    >
      <div style={studioScroll}>
        {engineering.state === "loading" ? <LoadingState what="engineering state" /> : null}
        {engineering.state === "error" ? (
          <ErrorState what="Engineering state" error={engineering.error ?? "unknown error"} onRetry={engineering.refresh} />
        ) : null}

        {payload ? (
          <>
            <MetricGrid>
              <Metric label="Active tasks" value={tasks.filter((task) => task.state === "running").length} />
              <Metric label="Workspaces locked" value={locks.length} tone={locks.length > 0 ? "#fbbf24" : undefined} />
              <Metric label="Verified" value={tasks.filter((t) => verificationOf(t).verified).length} />
              <Metric label="Engines usable" value={`${engines.filter((e) => e.selectable).length}/${engines.length}`} />
            </MetricGrid>

            <Section title="Execution runtime" hint="The local engineering runtime this app is actually serving from">
              <Card>
                {runtime.state === "ready" && runtime.data ? (
                  <>
                    <Row label="Runtime" value={<span style={codeText}>{runtime.data.runtime}</span>} />
                    <Row label="Available" value={runtime.data.available ? "yes" : "no"} />
                    <Row label="Workspace" value={<span style={codeText}>{runtime.data.workspace}</span>} />
                    <Row label="Token required" value={runtime.data.tokenRequired ? "yes (x-lelu-token)" : "no"} />
                    <Row
                      label="Identity verification"
                      value={runtime.data.identityVerification ? "configured" : "not configured — apply is refused"}
                    />
                    <Row label="Operations" value={`${runtime.data.operations.length} whitelisted`} title={runtime.data.operations.join(", ")} />
                  </>
                ) : runtime.state === "error" ? (
                  <ErrorState what="Engineering runtime" error={runtime.error ?? "unknown error"} onRetry={runtime.refresh} />
                ) : (
                  <LoadingState what="the engineering runtime" />
                )}
              </Card>
            </Section>

            <Section title="Coding engines" hint="Interchangeable backends — an explicit request is honoured or refused, never substituted">
              {engines.length === 0 ? (
                <EmptyState title="No engine reported" detail="The orchestrator returned no engine list, so nothing is claimed about availability." />
              ) : (
                engines.map((engine) => (
                  <Card key={engine.id} tint={engine.selectable ? "rgba(52,211,153,0.28)" : "rgba(255,255,255,0.1)"}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <strong style={{ fontSize: 12 }}>{engine.name}</strong>
                      <Pill state={engine.health.state} />
                    </div>
                    <div style={{ opacity: 0.6, marginTop: 3 }}>{engine.health.detail}</div>
                    <Row label="Source" value={<span style={codeText}>{engine.source}</span>} />
                    <Row label="Selectable" value={engine.selectable ? "yes" : "no — requesting it is refused"} />
                  </Card>
                ))
              )}
            </Section>

            <Section title="Workspace locks" hint="One engine per workspace; a second engine cannot edit while a lock is held">
              {locks.length === 0 ? (
                <EmptyState title="No workspace is locked" detail="No engine is editing a workspace in this runtime." />
              ) : (
                locks.map((lock) => (
                  <Card key={lock.workspaceId} tint="rgba(251,191,36,0.3)">
                    <Row label="Workspace" value={<span style={codeText}>{lock.workspaceId}</span>} />
                    <Row label="Held by" value={lock.engine} />
                    <Row label="Since" value={relativeTime(lock.since)} />
                  </Card>
                ))
              )}
            </Section>

            <Section title="Tasks" hint="Changed files, tests and verdict come from the backend's own records">
              {tasks.length === 0 ? (
                <EmptyState
                  title="No engineering task has run in this runtime"
                  detail="The orchestrator is connected; nothing has been dispatched to it yet. Tasks appear here only when SHAMAN or the user actually submits one."
                />
              ) : (
                tasks.map((task) => {
                  const verdict = verificationOf(task);
                  return (
                    <Card key={task.id} tint={verdict.verified ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.25)"}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong style={{ fontSize: 12, overflowWrap: "anywhere" }}>{task.objective}</strong>
                        <Pill state={verdict.verified ? "healthy" : "unavailable"} label={verdict.verified ? "VERIFIED" : "UNVERIFIED"} />
                      </div>
                      <Row label="Engine" value={task.engine ?? "none selected"} />
                      <Row label="Workspace" value={<span style={codeText}>{task.workspaceId}</span>} />
                      <Row label="State" value={task.state} />
                      <Row label="Files changed" value={task.filesChanged.length === 0 ? "none" : task.filesChanged.length} />
                      <Row
                        label="Tests"
                        value={task.tests ? `${task.tests.passed} passed · ${task.tests.failed} failed` : "not run"}
                      />
                      <div style={{ opacity: 0.65, marginTop: 4 }}>{verdict.reason}</div>
                      {task.filesChanged.length > 0 ? (
                        <div style={{ marginTop: 6, ...codeText }}>
                          {task.filesChanged.slice(0, 8).map((file) => (
                            <div key={file}>{file}</div>
                          ))}
                          {task.filesChanged.length > 8 ? <div>+{task.filesChanged.length - 8} more</div> : null}
                        </div>
                      ) : null}
                    </Card>
                  );
                })
              )}
            </Section>

            <Section title="Verification policy" hint="Enforced by the server before a change may be called done">
              {payload.verificationPolicy.map((item) => (
                <Row key={item.rule} label={item.rule} value={<span style={{ opacity: 0.75 }}>{item.detail}</span>} />
              ))}
            </Section>

            <Section title="Execution history" hint="Newest first, bounded in memory">
              {payload.history.length === 0 ? (
                <EmptyState title="Nothing recorded yet" detail="History fills in when tasks complete." />
              ) : (
                payload.history.map((item) => (
                  <Row
                    key={`${item.taskId}-${item.at}`}
                    label={`${item.taskId} · ${item.engine ?? "no engine"}`}
                    value={`${item.verified ? "verified" : "unverified"} · ${relativeTime(item.at)}`}
                    title={item.reason}
                  />
                ))
              )}
            </Section>

            <Section title="Integration surface" hint="Where the numbers above come from">
              <Row
                label="Policy engine"
                value={
                  integration.data ? (
                    <Pill
                      state={integration.data.policy.engine === "opa" && integration.data.policy.available ? "healthy" : "degraded"}
                      label={integration.data.policy.engine.toUpperCase()}
                    />
                  ) : (
                    "—"
                  )
                }
              />
              <Row label="Elapsed" value={formatDuration(null)} title="Per-task timing is in the task's own record; no aggregate is invented here." />
            </Section>

            <SourceNote path="/api/integration/engineering + /api/engineer/status" updatedAt={engineering.updatedAt} />
          </>
        ) : null}
      </div>
    </GenesisWindowFrame>
  );
}
