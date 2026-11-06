/**
 * ==========================================================
 * LÉLU — INFRASTRUCTURE MONITOR
 *
 * Live service health, provider availability and the correlated
 * execution chain — all from the server, none estimated.
 *
 * The monitor deliberately distinguishes four states that a
 * typical dashboard collapses into "up/down":
 *
 *   HEALTHY          a request reached the service and it answered
 *   DEGRADED         reachable, but not fully usable
 *   UNAVAILABLE      configured, contacted, failed
 *   NOT CONFIGURED   no endpoint set — nothing was contacted
 *
 * The last one is the important one: sixteen impressive names
 * that were never configured must read as sixteen unconfigured
 * services, not sixteen green dots.
 * ==========================================================
 */

import { useState } from "react";
import GenesisWindowFrame from "../GenesisWindowFrame";
import {
  formatDuration,
  healthColor,
  relativeTime,
  useIntegrationResource,
  type IntegrationStatus,
  type ProviderStatus,
  type TracesPayload,
  type TraceView,
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

const STAGE_LABEL: Record<string, string> = {
  user_request: "User request",
  core: "CORE",
  shaman: "SHAMAN",
  agent: "Agent",
  model: "Model",
  tool: "Tool",
  result: "Result",
  verification: "Verification",
  service: "Service",
};

const CHAIN: Array<{ stage: string; label: string }> = [
  { stage: "user_request", label: "User request" },
  { stage: "core", label: "CORE" },
  { stage: "shaman", label: "SHAMAN" },
  { stage: "agent", label: "Agent" },
  { stage: "model", label: "Model" },
  { stage: "tool", label: "Tool" },
  { stage: "result", label: "Result" },
  { stage: "verification", label: "Verification" },
];

function TraceRow({ trace }: { trace: TraceView }) {
  const [open, setOpen] = useState(false);
  const present = new Set(trace.stages);
  const missing = CHAIN.filter((step) => !present.has(step.stage) && step.stage !== "agent");

  return (
    <Card tint={trace.status === "failed" ? "rgba(248,113,113,0.28)" : "rgba(255,255,255,0.1)"}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "baseline",
          background: "transparent",
          border: 0,
          color: "inherit",
          padding: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 11.5, overflowWrap: "anywhere" }}>{trace.rootName}</strong>
          <span style={{ display: "block", opacity: 0.55, fontSize: 10 }}>
            {relativeTime(trace.startedAt)} · {trace.spans.length} span(s) · {formatDuration(trace.durationMs)}
          </span>
        </span>
        <Pill state={trace.status === "ok" ? "healthy" : trace.status === "failed" ? "unavailable" : "degraded"} label={trace.status.toUpperCase()} />
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
        {CHAIN.map((step) => {
          const seen = present.has(step.stage);
          return (
            <span
              key={step.stage}
              title={seen ? `${step.label}: recorded` : `${step.label}: no span in this trace`}
              style={{
                fontSize: 9.5,
                padding: "2px 6px",
                borderRadius: 6,
                border: `1px solid ${seen ? "rgba(103,232,249,0.4)" : "rgba(148,163,184,0.25)"}`,
                color: seen ? "#9be8ff" : "rgba(148,163,184,0.7)",
                background: seen ? "rgba(34,211,238,0.1)" : "transparent",
              }}
            >
              {step.label}
            </span>
          );
        })}
      </div>
      {missing.length > 0 ? (
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
          Absent: {missing.map((step) => step.label).join(", ")} — the request genuinely did not reach them.
        </div>
      ) : null}

      {open ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {trace.spans.map((span) => (
            <div key={span.id} style={{ borderLeft: "2px solid rgba(103,232,249,0.3)", paddingLeft: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5 }}>
                <span style={{ overflowWrap: "anywhere" }}>
                  {STAGE_LABEL[span.stage] ?? span.stage} · {span.name}
                </span>
                <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>{formatDuration(span.durationMs)}</span>
              </div>
              {Object.keys(span.attributes).length > 0 ? (
                <div style={{ ...codeText, fontSize: 9.5, opacity: 0.6 }}>
                  {Object.entries(span.attributes)
                    .slice(0, 8)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join("  ")}
                </div>
              ) : null}
              {span.error ? <div style={{ fontSize: 10, color: "#fca5a5" }}>{span.error}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export default function InfrastructureMonitorPanel({ onClose }: { onClose: () => void }) {
  const status = useIntegrationResource<IntegrationStatus>("/api/integration/status", 20_000);
  const traces = useIntegrationResource<TracesPayload>("/api/integration/traces", 10_000);
  const providers = useIntegrationResource<ProviderStatus>("/api/model/status", 60_000);

  function refreshAll() {
    status.refresh();
    traces.refresh();
    providers.refresh();
  }

  const services = status.data?.services ?? [];
  const healthy = services.filter((service) => service.health.state === "healthy").length;
  const unconfigured = services.filter((service) => service.health.state === "not_configured").length;
  const providerEntries = Object.entries(providers.data?.providers ?? {});
  const configuredProviders = providerEntries.filter(([, value]) => value).length;

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Infrastructure"
      title="Infrastructure Monitor · services, providers, traces"
      onClose={onClose}
      width={studioFrame.width}
      maxHeight={studioFrame.maxHeight}
      elevation="focus"
      extraActions={
        <button type="button" style={ghostButton} onClick={refreshAll} aria-label="Refresh infrastructure state">
          Refresh
        </button>
      }
    >
      <div style={studioScroll}>
        {status.state === "loading" ? <LoadingState what="service probes" /> : null}
        {status.state === "error" ? (
          <ErrorState what="Service probes" error={status.error ?? "unknown error"} onRetry={status.refresh} />
        ) : null}

        <MetricGrid>
          <Metric label="Services healthy" value={`${healthy}/${services.length}`} tone={healthy === 0 ? "rgba(148,163,184,0.9)" : undefined} />
          <Metric label="Not configured" value={unconfigured} />
          <Metric label="Providers configured" value={providerEntries.length === 0 ? "unknown" : `${configuredProviders}/${providerEntries.length}`} />
          <Metric label="Runtime" value={status.data?.runtime ?? "…"} />
        </MetricGrid>

        <Section title="Backend services" hint="Probed now — a service with no endpoint is reported unconfigured, never healthy">
          {services.length === 0 && status.state === "ready" ? (
            <EmptyState title="No services reported" detail="The server returned an empty probe list." />
          ) : (
            services.map((service) => (
              <Card key={service.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 11.5 }}>{service.label ?? service.id}</strong>
                  <Pill state={service.health.state} />
                </div>
                <div style={{ opacity: 0.6, marginTop: 3 }}>{service.health.detail}</div>
                {typeof service.health.contacted === "boolean" ? (
                  <Row label="Network contacted" value={service.health.contacted ? "yes" : "no"} />
                ) : null}
                {service.role ? <Row label="Role" value={service.role} /> : null}
              </Card>
            ))
          )}
        </Section>

        <Section title="AI providers" hint="Booleans from the server broker — a key's value is never sent to this screen">
          {providers.state === "error" ? (
            <ErrorState what="Provider status" error={providers.error ?? "unknown error"} onRetry={providers.refresh} />
          ) : providerEntries.length === 0 ? (
            <EmptyState
              title="Provider status unavailable"
              detail="The broker answered nothing, so availability is unknown rather than assumed."
            />
          ) : (
            <Card>
              {providerEntries.map(([id, configured]) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ opacity: 0.7 }}>{id}</span>
                  <span style={{ color: configured ? healthColor("healthy") : healthColor("not_configured"), fontSize: 10.5 }}>
                    {configured ? "configured" : "no credential"}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </Section>

        <Section title="Model routing" hint="Where a turn goes, and what happens when a provider is refused">
          <Card>
            <Row label="Primary coding route" value="configured in ModelRouter (unchanged by this work)" />
            <Row label="Anthropic" value="opt-in via LELU_ENABLE_ANTHROPIC" />
            <Row label="Gateway (LiteLLM)" value={status.data ? <Pill state={status.data.services.find((s) => s.id === "litellm")?.health.state ?? "not_configured"} /> : "…"} />
            <div style={{ opacity: 0.55, marginTop: 4 }}>
              A refused credential cools down and the turn advances the chain. The provider that answered is the one reported.
            </div>
          </Card>
        </Section>

        <Section title="Workflows" hint="Durable execution state, not a simulated queue">
          <Card>
            <Row label="Workflow engine" value="WorkflowEngine (in-process, persisted steps)" />
            <Row label="Temporal" value={status.data ? <Pill state={status.data.services.find((s) => s.id === "temporal")?.health.state ?? "not_configured"} /> : "…"} />
            <Row label="Queue depth" value="not instrumented — no queue exists in this runtime" />
            <Row label="Failed tasks" value="see Engineering Studio history" />
          </Card>
        </Section>

        <Section
          title="Execution traces"
          hint="User request → CORE → SHAMAN → Agent → Model → Tool → Result → Verification"
          actions={
            <button type="button" style={ghostButton} onClick={traces.refresh} aria-label="Refresh traces">
              Refresh
            </button>
          }
        >
          {traces.state === "error" ? (
            <ErrorState what="Traces" error={traces.error ?? "unknown error"} onRetry={traces.refresh} />
          ) : !traces.data || traces.data.traces.length === 0 ? (
            <EmptyState
              title="No trace has been recorded yet"
              detail="Traces appear as this runtime handles integration calls. Nothing is pre-seeded."
            />
          ) : (
            traces.data.traces.map((trace) => <TraceRow key={trace.traceId} trace={trace} />)
          )}
          {traces.data ? (
            <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
              Buffer {traces.data.buffer.spans}/{traces.data.buffer.capacity} spans · exporter{" "}
              {traces.data.exporter.configured ? traces.data.exporter.endpoint : "not configured (nothing is shipped)"}
            </div>
          ) : null}
        </Section>

        <Section title="Error rates and latency" hint="Only rates that can be computed from recorded spans">
          <Card>
            {(() => {
              const all = traces.data?.traces ?? [];
              const failed = all.filter((trace) => trace.status === "failed").length;
              const durations = all.map((trace) => trace.durationMs).filter((value): value is number => typeof value === "number");
              const median = durations.length > 0 ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null;
              return (
                <>
                  <Row label="Traces recorded" value={all.length} />
                  <Row label="Failed" value={`${failed}${all.length > 0 ? ` (${Math.round((failed / all.length) * 100)}%)` : ""}`} />
                  <Row label="Median duration" value={median == null ? "no samples" : formatDuration(median)} />
                </>
              );
            })()}
          </Card>
        </Section>

        <SourceNote path="/api/integration/status + /api/integration/traces + /api/model/status" updatedAt={status.updatedAt} />
      </div>
    </GenesisWindowFrame>
  );
}
