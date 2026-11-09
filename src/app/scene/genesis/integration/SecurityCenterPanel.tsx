/**
 * ==========================================================
 * LÉLU — SECURITY CENTER
 *
 * The honest security surface. Three properties it refuses to
 * give up:
 *
 *   1. A scanner that did not run makes the posture BLOCKED or
 *      UNKNOWN. It is never PASS. "We did not check" must never
 *      look like "we checked and it was clean".
 *   2. A finding shows rule, file, line, severity and what to do
 *      about it — never the matched value. The client strips any
 *      such field defensively even if a scanner adds one.
 *   3. Every decision listed here was actually evaluated, by the
 *      engine named beside it, with its real duration.
 *
 * The two action buttons run REAL checks against this server
 * (a policy probe and a Gitleaks scan). They are labelled as
 * such, and the result replaces the panel's data rather than
 * being announced as success.
 * ==========================================================
 */

import { useState } from "react";
import GenesisWindowFrame from "../GenesisWindowFrame";
import {
  formatDuration,
  normaliseFinding,
  postJson,
  relativeTime,
  scannerPosture,
  useIntegrationResource,
  type ScanReport,
  type SecurityPayload,
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
  smallButton,
  studioFrame,
  studioScroll,
} from "./StudioShell";

const POSTURE_COLOR: Record<string, string> = {
  pass: "#34d399",
  fail: "#f87171",
  blocked: "#fbbf24",
  unknown: "rgba(148,163,184,0.9)",
};

export default function SecurityCenterPanel({ onClose }: { onClose: () => void }) {
  const security = useIntegrationResource<SecurityPayload>("/api/integration/security", 20_000);
  const [busy, setBusy] = useState<"policy" | "scan" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const data = security.data;
  const posture = scannerPosture(data?.scanners, data?.lastScan ?? null);
  const postureColor = POSTURE_COLOR[posture.posture] ?? POSTURE_COLOR.unknown;

  async function runPolicyProbe() {
    setBusy("policy");
    setActionError(null);
    setLastAction(null);
    try {
      const result = await postJson<{
        ok: boolean;
        decision: { allowed: boolean; requiresApproval: boolean; reason: string; engine: string; rules: string[] };
        engine: string;
        durationMs: number;
        agrees: boolean;
      }>("/api/integration/policy", {
        subject: { kind: "agent", userId: null, agentId: "studio-probe", sessionId: "studio" },
        action: "ADMINISTER",
        resource: { kind: "system", id: "system:lelu" },
        context: { autonomyLevel: 5, environment: "production", approvalValid: true },
      });
      setLastAction(
        `Agent ADMINISTER was ${result.decision.allowed ? "ALLOWED" : "DENIED"} by ${result.engine.toUpperCase()} in ${Math.round(
          result.durationMs,
        )} ms${result.agrees ? "" : " — the reference evaluator DISAGREES"}. ${result.decision.reason}`,
      );
      security.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function runScan() {
    setBusy("scan");
    setActionError(null);
    setLastAction(null);
    try {
      const result = await postJson<{ ok: boolean; report: ScanReport }>("/api/integration/scan", {
        target: ".",
        scanners: ["gitleaks", "semgrep", "trivy"],
      });
      setLastAction(
        `Scan finished: ${result.report.summary} Gate ${result.report.gatePassed ? "passed" : "FAILED"} — findings are listed below, without values.`,
      );
      security.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Security"
      title="Security Center · policy, permissions, scanners"
      onClose={onClose}
      width={studioFrame.width}
      maxHeight={studioFrame.maxHeight}
      elevation="focus"
      extraActions={
        <button type="button" style={ghostButton} onClick={security.refresh} aria-label="Refresh security state">
          Refresh
        </button>
      }
    >
      <div style={studioScroll}>
        {security.state === "loading" ? <LoadingState what="security state" /> : null}
        {security.state === "error" ? (
          <ErrorState what="Security state" error={security.error ?? "unknown error"} onRetry={security.refresh} />
        ) : null}

        {data ? (
          <>
            <div
              style={{
                border: `1px solid ${postureColor}55`,
                borderRadius: 12,
                padding: "10px 12px",
                background: `${postureColor}10`,
              }}
              role="status"
              aria-live="polite"
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.7 }}>Security gate</span>
                <span style={{ color: postureColor, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>{posture.label}</span>
              </div>
              <div style={{ fontSize: 11.5, marginTop: 4, opacity: 0.85 }}>{posture.detail}</div>
            </div>

            <MetricGrid>
              <Metric label="Policy engine" value={data.policy.engine.toUpperCase()} tone={data.policy.available ? "#34d399" : "#fbbf24"} />
              <Metric label="Decisions logged" value={data.decisions.length} />
              <Metric label="Denied" value={data.decisions.filter((decision) => !decision.allowed).length} />
              <Metric label="Audit entries" value={data.audit.length} />
            </MetricGrid>

            <Section title="Policy engine" hint="The authority for every capability call">
              <Card tint={data.policy.available ? "rgba(52,211,153,0.25)" : "rgba(251,191,36,0.3)"}>
                <Row label="Engine" value={data.policy.engine === "opa" ? "Open Policy Agent (real binary)" : "TypeScript reference only"} />
                <Row label="Available" value={data.policy.available ? "yes" : "no — decisions fall back and say so"} />
                <Row label="Version" value={<span style={codeText}>{data.policy.version}</span>} />
                {data.policy.policyDir ? <Row label="Bundle" value={<span style={codeText}>{data.policy.policyDir}</span>} /> : null}
                <Row label="Fail mode" value="closed — a missing binary, bundle or eval error denies" />
              </Card>
            </Section>

            <Section title="Scanner availability" hint="What is installed here, right now">
              {(["gitleaks", "trivy", "semgrep"] as const).map((scanner) => (
                <Row
                  key={scanner}
                  label={scanner}
                  value={
                    <span style={{ color: data.scanners[scanner] ? "#34d399" : "#fbbf24" }}>
                      {data.scanners[scanner] ? "installed" : "not installed — checks BLOCKED"}
                    </span>
                  }
                />
              ))}
              <Row label="Last successful scan" value={data.scanHistory.find((entry) => entry.gatePassed)?.at ? relativeTime(data.scanHistory.find((entry) => entry.gatePassed)!.at) : "none"} />
            </Section>

            <Section title="Run a real check" hint="Both actions call this server; the result replaces the data above">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={smallButton} onClick={() => void runPolicyProbe()} disabled={busy !== null}>
                  {busy === "policy" ? "Evaluating…" : "Evaluate policy (agent ADMINISTER)"}
                </button>
                <button type="button" style={smallButton} onClick={() => void runScan()} disabled={busy !== null}>
                  {busy === "scan" ? "Scanning…" : "Run security scan"}
                </button>
              </div>
              {lastAction ? (
                <div style={{ fontSize: 11, lineHeight: 1.6, color: "#d9f6ff", marginTop: 6 }} role="status" aria-live="polite">
                  {lastAction}
                </div>
              ) : null}
              {actionError ? <ErrorState what="Check" error={actionError} /> : null}
            </Section>

            <Section title="Authorization decisions" hint="Newest first — subject, action, rule that fired, engine and real latency">
              {data.decisions.length === 0 ? (
                <EmptyState
                  title="No decision has been made in this runtime"
                  detail="Use the probe above or open a capability; each evaluation is recorded here with the rule that decided it."
                />
              ) : (
                data.decisions.slice(0, 12).map((decision, index) => (
                  <Card
                    key={`${decision.at}-${index}`}
                    tint={decision.allowed ? "rgba(255,255,255,0.1)" : "rgba(248,113,113,0.25)"}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <strong style={{ fontSize: 11.5 }}>
                        {decision.action} · {decision.subjectKind}
                        {decision.subjectId ? `:${decision.subjectId}` : ""}
                      </strong>
                      <Pill
                        state={decision.allowed ? "healthy" : "unavailable"}
                        label={decision.allowed ? "ALLOW" : decision.requiresApproval ? "APPROVAL" : "DENY"}
                      />
                    </div>
                    <Row label="Resource" value={<span style={codeText}>{decision.resourceId ?? decision.resourceKind}</span>} />
                    <Row label="Rules" value={decision.rules.length === 0 ? "none" : decision.rules.join(", ")} />
                    <Row
                      label="Engine"
                      value={`${decision.engine.toUpperCase()} · ${formatDuration(decision.durationMs)}${
                        decision.agrees === false ? " · REFERENCE DISAGREES" : ""
                      }`}
                    />
                    <Row label="When" value={relativeTime(decision.at)} />
                  </Card>
                ))
              )}
            </Section>

            <Section title="Relationships and sessions" hint="Owner → device → authorized session → capability">
              <Card>
                <Row label="Enforcement" value={data.relationships.enforced ? "active" : "not active"} />
                <Row label="Device sessions" value={data.relationships.sessions} />
                <Row label="Tuples" value={data.relationships.tuples} />
                <Row label="Expiry / revocation" value="expired tuples pruned on read; a revoked session fails its next call" />
                <div style={{ opacity: 0.6, marginTop: 4 }}>{data.relationships.detail}</div>
              </Card>
            </Section>

            <Section title="Last scan findings" hint="Rule, file, line and remediation — never the matched value">
              {!data.lastScan ? (
                <EmptyState title="No scan has run" detail="Run a scan above; findings appear here with no secret content." />
              ) : (
                <>
                  <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.6 }}>{data.lastScan.summary}</div>
                  {data.lastScan.results.map((result) => (
                    <Card key={result.scanner}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong style={{ fontSize: 11.5 }}>{result.scanner}</strong>
                        <Pill
                          state={!result.ran ? "unavailable" : Object.values(result.counts).some((count) => count > 0) ? "degraded" : "healthy"}
                          label={!result.ran ? "DID NOT RUN" : Object.values(result.counts).some((count) => count > 0) ? "FINDINGS" : "CLEAN"}
                        />
                      </div>
                      <div style={{ opacity: 0.62, marginTop: 3 }}>{result.detail}</div>
                      <Row label="Duration" value={formatDuration(result.durationMs)} />
                      <Row
                        label="Counts"
                        value={Object.entries(result.counts)
                          .filter(([, count]) => count > 0)
                          .map(([severity, count]) => `${severity} ${count}`)
                          .join(" · ") || "none"}
                      />
                      {result.findings.slice(0, 25).map((raw, index) => {
                        const finding = normaliseFinding(raw);
                        return (
                          <div key={`${finding.file}-${finding.line}-${index}`} style={{ marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 600 }}>{finding.rule}</span>
                              <span style={{ fontSize: 10, color: "rgba(251,191,36,0.9)", textTransform: "uppercase" }}>{finding.severity}</span>
                            </div>
                            <div style={codeText}>
                              {finding.file}
                              {finding.line ? `:${finding.line}` : ""}
                            </div>
                            {finding.remediation ? (
                              <div style={{ fontSize: 10.5, opacity: 0.62, marginTop: 2 }}>{finding.remediation}</div>
                            ) : null}
                          </div>
                        );
                      })}
                      {result.findings.length > 25 ? (
                        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>+{result.findings.length - 25} more finding(s) — full report is in the scan payload.</div>
                      ) : null}
                    </Card>
                  ))}
                  <div style={{ fontSize: 10, opacity: 0.45, marginTop: 4 }}>
                    Target <code>{data.lastScan.target ?? "."}</code> · scanned {relativeTime(data.lastScan.scannedAt)}
                  </div>
                </>
              )}
            </Section>

            <Section title="Security audit history" hint="Actions the gate actually recorded">
              {data.audit.length === 0 ? (
                <EmptyState title="No audited action yet" detail="Audit entries are written by the capability gate, not by this screen." />
              ) : (
                data.audit.slice(0, 12).map((entry, index) => (
                  <Row
                    key={`${entry.at}-${index}`}
                    label={`${entry.subject} · ${entry.action}`}
                    value={`${entry.decision} · ${entry.engine} · ${relativeTime(entry.at)}`}
                    title={`${entry.resource} · correlation ${entry.correlationId}`}
                  />
                ))
              )}
            </Section>

            <Section title="Secrets management (Infisical)" hint="Reported, not migrated">
              <Card>
                <Row
                  label="Status"
                  value={<Pill state={data.services.find((service) => service.id === "infisical")?.health.state ?? "not_configured"} />}
                />
                <div style={{ opacity: 0.62, marginTop: 4 }}>
                  No credential was migrated into a new store by this work, and `.env.local` was not modified. The scanner finding
                  for that file is reported because it holds a live key — it is untracked and gitignored, so it is not in Git history.
                </div>
              </Card>
            </Section>

            <SourceNote path="/api/integration/security" updatedAt={security.updatedAt} extra="values never leave the server" />
          </>
        ) : null}
      </div>
    </GenesisWindowFrame>
  );
}
