/**
 * ==========================================================
 * LÉLU — INTEGRATION STUDIO CLIENT
 *
 * One data layer for the four operational studios
 * (Engineering, Voice, Infrastructure, Security).
 *
 * RULES THIS FILE ENFORCES
 * ------------------------
 * • A studio never invents a value. Every field it draws comes
 *   from a server response; when the server says `not_configured`
 *   the screen says NOT CONFIGURED.
 * • No studio calls an adapter. They read the HTTP surface that
 *   sits in front of `AdapterRegistry`, so the security sequence
 *   (identity → relationship → policy → schema → bounded run →
 *   audit + trace) cannot be bypassed by a component.
 * • Polling is bounded and pauseable: no interval below 5 s, no
 *   requests while the tab is hidden, one in-flight request per
 *   resource, and a timeout on every call.
 * • Credentials cannot be displayed even by accident: every
 *   finding is normalised so a `Secret`/`Match` field is dropped
 *   before it reaches a component.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { sessionAuthHeader } from "../../../../core/persistence/sessionAuth";

/* ------------------------------ types ------------------------------ */

export type HealthState = "healthy" | "degraded" | "unavailable" | "not_configured";

export interface ServiceProbe {
  id: string;
  label: string;
  health: { state: HealthState; detail: string; contacted?: boolean };
  role?: string;
}

export interface IntegrationStatus {
  ok: boolean;
  runtime: string;
  tokenRequired: boolean;
  workspaceRoot?: string;
  policy: { engine: "opa" | "reference"; available: boolean; version: string; policyDir?: string; detail?: string };
  scanners: { gitleaks: boolean; trivy: boolean; semgrep: boolean };
  services: ServiceProbe[];
}

export interface Finding {
  rule: string;
  severity: string;
  file: string;
  line: number;
  /** Remediation guidance keyed by rule. Never the matched value. */
  remediation?: string;
}

export interface ScanReport {
  gatePassed: boolean;
  summary: string;
  scannedAt?: number;
  target?: string;
  results: Array<{
    scanner: string;
    ran: boolean;
    detail: string;
    durationMs: number;
    findings: Finding[];
    counts: Record<string, number>;
  }>;
}

export interface DecisionRecord {
  at: number;
  subjectKind: string;
  subjectId: string | null;
  action: string;
  resourceKind: string;
  resourceId: string | null;
  allowed: boolean;
  requiresApproval: boolean;
  rules: string[];
  engine: "opa" | "reference";
  durationMs: number;
  agrees: boolean | null;
}

export interface SecurityPayload {
  ok: boolean;
  policy: IntegrationStatus["policy"];
  scanners: IntegrationStatus["scanners"];
  decisions: DecisionRecord[];
  audit: Array<{ at: number; subject: string; action: string; resource: string; decision: string; engine: string; correlationId: string }>;
  lastScan: ScanReport | null;
  scanHistory: Array<{ at: number; gatePassed: boolean; summary: string }>;
  relationships: { enforced: boolean; sessions: number; tuples: number; detail: string };
  services: ServiceProbe[];
  gitleaksTriage?: { known: number; needsReview: number; detail: string } | null;
}

export interface EngineeringPayload {
  ok: boolean;
  runtime: { name: string; workspaceRoot: string; node: string; engineeringApi: boolean; detail: string };
  engines: Array<{ id: string; name: string; source: string; health: { state: HealthState; detail: string }; selectable: boolean }>;
  tasks: Array<{
    id: string;
    objective: string;
    engine: string | null;
    workspaceId: string;
    state: string;
    startedAt: number;
    filesChanged: string[];
    tests: { ran: boolean; passed: number; failed: number } | null;
    verified: boolean | null;
    verification: string;
  }>;
  locks: Array<{ workspaceId: string; engine: string; since: number }>;
  verificationPolicy: Array<{ rule: string; detail: string }>;
  history: Array<{ taskId: string; engine: string | null; verified: boolean; at: number; reason: string }>;
}

export interface TraceSpanView {
  id: string;
  parentId: string | null;
  stage: string;
  name: string;
  startedAt: number;
  durationMs: number | null;
  status: string;
  attributes: Record<string, string | number | boolean>;
  error?: string;
}

export interface TraceView {
  traceId: string;
  rootName: string;
  startedAt: number;
  durationMs: number | null;
  status: string;
  stages: string[];
  correlationId: string;
  spans: TraceSpanView[];
}

export interface TracesPayload {
  ok: boolean;
  traces: TraceView[];
  exporter: { configured: boolean; endpoint: string | null; detail: string };
  buffer: { spans: number; capacity: number };
}

export interface VoicePayload {
  ok: boolean;
  adapters: Array<{
    id: string;
    label: string;
    state: HealthState;
    detail: string;
    model: string | null;
    streaming: boolean;
  }>;
  vad: { implementation: string; neuralModelPresent: boolean; thresholds: Record<string, number>; detail: string };
  benchmark: { samples: number; median: Record<string, number> | null; p95: Record<string, number> | null; detail: string };
}

export interface ProviderStatus {
  providers: Record<string, boolean>;
}

/* --------------------------- normalisation --------------------------- */

/**
 * Drop any field that could carry a matched secret. Scanners do not
 * send one today; this makes that a property of the client too, so a
 * future scanner that adds `Match` cannot leak it onto a screen.
 */
export function normaliseFinding(raw: unknown): Finding {
  const item = (raw ?? {}) as Record<string, unknown>;
  const file = typeof item.file === "string" ? item.file : "";
  const line = typeof item.line === "number" ? item.line : Number(item.line ?? 0) || 0;
  const rule = typeof item.rule === "string" ? item.rule : "unknown";
  const guidance = remediationFor(rule);
  return {
    rule,
    severity: typeof item.severity === "string" ? item.severity.toLowerCase() : "unknown",
    file,
    line,
    ...(guidance ? { remediation: guidance } : {}),
  };
}

/** Rule → what a human should actually do. Guidance only; no values. */
export function remediationFor(rule: string): string | null {
  const key = rule.toLowerCase();
  if (key.includes("github")) return "Revoke the token in GitHub → Settings → Developer settings, then purge it from history before re-adding.";
  if (key.includes("anthropic") || key.includes("openai") || key.includes("api-key") || key.includes("generic"))
    return "Confirm whether the value is a real credential. If it is, rotate it at the provider and move it to a server-side secret store.";
  if (key.includes("private-key")) return "Treat the key as compromised: rotate the certificate, and remove the file from the repository and its history.";
  if (key.includes("aws")) return "Deactivate the access key in IAM, review CloudTrail for use, then rotate.";
  return null;
}

/* ----------------------------- postures ----------------------------- */

export type Posture = "pass" | "fail" | "blocked" | "unknown";

/**
 * The security gate's verdict, computed the same way the server does:
 * a scanner that did not run makes the answer BLOCKED or UNKNOWN, never
 * PASS. A green panel must mean "we checked and it was clean".
 */
export function scannerPosture(
  scanners: { gitleaks: boolean; trivy: boolean; semgrep: boolean } | undefined,
  lastScan: ScanReport | null,
): { posture: Posture; label: string; detail: string } {
  if (!scanners) return { posture: "unknown", label: "UNKNOWN", detail: "Scanner availability has not been reported yet." };
  const missing = (Object.keys(scanners) as Array<keyof typeof scanners>).filter((id) => !scanners[id]);
  // A missing scanner blocks the posture whether or not some OTHER scanner
  // ran cleanly. "Gitleaks found nothing" is not a clean security result
  // while the dependency and static-analysis checks do not exist.
  if (missing.length > 0) {
    return {
      posture: "blocked",
      label: "BLOCKED",
      detail: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not installed, so ${
        lastScan ? "this scan covers only part of the surface" : "no scan can cover the surface"
      }. This is not a clean result.`,
    };
  }
  if (!lastScan) {
    return {
      posture: "unknown",
      label: "NOT RUN",
      detail: "Every scanner is installed, but no scan has been run in this runtime.",
    };
  }
  const skipped = lastScan.results.filter((result) => !result.ran).map((result) => result.scanner);
  if (skipped.length > 0) {
    return {
      posture: "blocked",
      label: "BLOCKED",
      detail: `${skipped.join(", ")} did not run — this is not a clean result.`,
    };
  }
  if (!lastScan.gatePassed) {
    return { posture: "fail", label: "FAIL", detail: lastScan.summary };
  }
  return { posture: "pass", label: "PASS", detail: lastScan.summary };
}

/** A verified task needs a real test run with zero failures. Nothing else counts. */
export function verificationOf(task: {
  verified: boolean | null;
  tests: { ran: boolean; passed: number; failed: number } | null;
}): { verified: boolean; reason: string } {
  if (task.verified === true && task.tests?.ran && task.tests.failed === 0 && task.tests.passed > 0) {
    return { verified: true, reason: `${task.tests.passed} test(s) passed, 0 failed.` };
  }
  if (!task.tests || !task.tests.ran) return { verified: false, reason: "No test run was recorded — this is not verified." };
  if (task.tests.failed > 0) return { verified: false, reason: `${task.tests.failed} test(s) failed.` };
  if (task.tests.passed === 0) return { verified: false, reason: "A test command ran but reported no passing test." };
  return { verified: false, reason: "The backend did not mark the change verified." };
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function relativeTime(at: number | null | undefined, now = Date.now()): string {
  if (!at) return "never";
  const diff = Math.max(0, now - at);
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

/** Human label for a probed service state — never upgraded to "healthy". */
export function healthLabel(state: HealthState | string): string {
  switch (state) {
    case "healthy":
      return "HEALTHY";
    case "degraded":
      return "DEGRADED";
    case "unavailable":
      return "UNAVAILABLE";
    case "not_configured":
      return "NOT CONFIGURED";
    default:
      return String(state).toUpperCase();
  }
}

export function healthColor(state: HealthState | string): string {
  switch (state) {
    case "healthy":
      return "#34d399";
    case "degraded":
      return "#fbbf24";
    case "unavailable":
      return "#f87171";
    default:
      return "rgba(148,163,184,0.85)";
  }
}

/* ------------------------------ fetching ------------------------------ */

export const MIN_POLL_MS = 5_000;

export interface Resource<T> {
  state: "loading" | "ready" | "error";
  data: T | null;
  error: string | null;
  updatedAt: number | null;
  refresh: () => void;
}

async function getJson<T>(path: string, timeoutMs = 8_000): Promise<T> {
  const response = await fetch(path, {
    headers: { ...sessionAuthHeader(), Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body?.error ?? `Request failed with ${response.status}.`);
  return body;
}

/**
 * Bounded, pauseable polling for one resource.
 *
 * `intervalMs` is clamped to MIN_POLL_MS; the timer stops while the tab
 * is hidden and refreshes once on return, so a backgrounded Cosmos does
 * not hammer the server. Only one request is in flight at a time.
 */
export function useIntegrationResource<T>(path: string, intervalMs = 15_000): Resource<T> {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const wait = Math.max(MIN_POLL_MS, intervalMs);

    const load = async () => {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      try {
        const body = await getJson<T>(path);
        if (cancelled || !mounted.current) return;
        setData(body);
        setState("ready");
        setError(null);
        setUpdatedAt(Date.now());
      } catch (cause) {
        if (cancelled || !mounted.current) return;
        setState("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        inFlight.current = false;
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        if (typeof document !== "undefined" && document.hidden) {
          schedule();
          return;
        }
        await load();
        schedule();
      }, wait);
    };

    void load();
    schedule();

    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) void load();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, intervalMs, nonce]);

  return { state, data, error, updatedAt, refresh };
}

/** POST helper used by the Security Center's policy probe and scan button. */
export async function postJson<T>(path: string, body: unknown, timeoutMs = 90_000): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...sessionAuthHeader(), "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
  return payload;
}
