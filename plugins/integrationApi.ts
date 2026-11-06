/**
 * ==========================================================
 * LÉLU — INTEGRATION API (server middleware)
 *
 * The one server surface for the intelligence integrations:
 *
 *   GET  /api/integration/status   → what each integration really is
 *   POST /api/integration/policy   → a REAL OPA decision
 *   POST /api/integration/scan     → REAL gitleaks/trivy/semgrep runs
 *   GET  /api/integration/intelligence       → the four-studio snapshot
 *   GET  /api/integration/intelligence/explain?capability=… → why it is blocked
 *   POST /api/integration/intelligence/plan  → an activation plan (never executes)
 *
 * Every answer here is observed, not asserted:
 *   • `/status` probes each service and reports it unconfigured
 *     when it is, instead of listing sixteen impressive names;
 *   • `/policy` runs the `opa` binary against policies/lelu and
 *     says which engine answered;
 *   • `/scan` runs the scanners and REFUSES to call a scanner that
 *     did not run a clean result.
 *
 * Safety, matching the engineering API's own rules:
 *   • state-changing POSTs are same-origin only (CSRF guard);
 *   • an optional LELU_ENGINEER_TOKEN gate, shared with the rest of
 *     the runtime, so a deployed instance can require a credential;
 *   • scan targets are resolved inside the workspace root;
 *   • no secret value is ever returned — only key NAMES and
 *     booleans, and Gitleaks findings never carry a matched value.
 * ==========================================================
 */

import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { detectOpa, evaluateWithOpa } from "./integration/opa.ts";
import { probeAllServices } from "./integration/services.ts";
import { runSecurityGate, type ScannerId } from "./integration/scanners.ts";
import { integrationState } from "./integration/state.ts";
import { collectOperationalSnapshot, explainOperationalState, planActivation } from "./integration/intelligence.ts";
import { REPOSITORY_CATALOG, dependencyCoverage, repositoryCoverage } from "../src/core/operational-intelligence/index.ts";
import { evaluatePolicy, type PolicyInput } from "../src/core/security/policy.ts";
import { VadDetector } from "../src/core/voice/adapters/VoiceAdapters.ts";

export interface IntegrationApiOptions {
  workspaceRoot: string;
  /** Runtime label reported by /status. */
  runtime: string;
  /** Shared token gate (same variable the engineering API uses). */
  token?: string;
  /** Allowed origins for cross-origin POSTs; empty = same-origin only. */
  allowedOrigins?: string[];
  /**
   * The prefix this middleware was mounted at when the host does NOT strip
   * it (Vite's `server.middlewares.use(fn)`). Setting it makes the handler
   * claim ONLY its own paths — without it, an unstripped mount answered
   * every request, including `/`, and the whole application 404'd.
   *
   * Leave undefined when the host mounts at a path (connect's
   * `use("/api/integration", fn)`), which strips the prefix.
   */
  mountPath?: string;
}

const POLICY_ACTIONS = [
  "READ",
  "WRITE",
  "EXECUTE",
  "INSTALL",
  "DELETE",
  "DEPLOY",
  "ADMINISTER",
  "ACCESS_EXTERNAL_DEVICE",
] as const;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(payload);
}

async function readBody(request: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

function sameOrigin(request: IncomingMessage, options: IntegrationApiOptions): boolean {
  const origin = request.headers.origin;
  // A same-origin fetch from a browser normally omits Origin on GET and
  // sends it on POST; a missing Origin is a non-browser or same-origin
  // caller and is allowed, exactly like the engineering API.
  if (!origin) return true;
  if (options.allowedOrigins?.includes(origin)) return true;
  const host = request.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** This server's own origin, for probing its own APIs honestly. */
function publicOrigin(request: IncomingMessage): string | undefined {
  const host = request.headers.host;
  if (!host) return undefined;
  const forwarded = request.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}

function authorized(request: IncomingMessage, options: IntegrationApiOptions): { ok: boolean; status: number; reason: string } {
  if (options.token) {
    const presented = request.headers["x-lelu-token"];
    if (typeof presented !== "string" || presented !== options.token) {
      return { ok: false, status: 401, reason: "LELU_ENGINEER_TOKEN is configured; x-lelu-token is required." };
    }
  }
  return { ok: true, status: 200, reason: "ok" };
}

/**
 * Which scanner binaries this host actually has. A path is required —
 * a bare name on PATH is not probed here, so "installed" always means
 * "found at a path we can run", and the lightweight probe list matches
 * the adapters' own resolution order (env → .tools → node_modules/.bin).
 */
function scannerBinaries(workspaceRoot: string): { gitleaks: boolean; trivy: boolean; semgrep: boolean } {
  const present = (tool: string) => {
    // Same rule as the adapters: an explicit path is authoritative, with no
    // fallback to a different binary.
    const explicit = process.env[`LELU_${tool.toUpperCase()}_BINARY`]?.trim();
    if (explicit) return existsSync(explicit);
    return [join(workspaceRoot, ".tools", tool), join(workspaceRoot, "node_modules", ".bin", tool)]
      .filter((candidate): candidate is string => typeof candidate === "string")
      .some((candidate) => candidate.includes("/") && existsSync(candidate));
  };
  return { gitleaks: present("gitleaks"), trivy: present("trivy"), semgrep: present("semgrep") };
}

/** Begin a trace for a real request and expose the correlation id the client sees. */
function beginTrace(name: string, attributes: Record<string, unknown>, runtime: string): { traceId: string; rootId: string; correlationId: string } {
  const correlationId = `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const traceId = integrationState.telemetry.startTrace(name, correlationId, { runtime, ...attributes });
  const rootId = integrationState.telemetry.recentTraces(1)[0]?.rootSpanId ?? "";
  return { traceId, rootId, correlationId };
}

/** Resolve a scan target inside the workspace; refuse an escape. */
function scopedTarget(workspaceRoot: string, requested: unknown): { ok: true; path: string } | { ok: false; reason: string } {
  const raw = typeof requested === "string" && requested.trim() ? requested.trim() : ".";
  const absolute = resolve(workspaceRoot, raw);
  const rel = relative(workspaceRoot, absolute);
  if (rel.startsWith("..") || resolve(rel) === resolve("..")) {
    return { ok: false, reason: `"${raw}" resolves outside the workspace root.` };
  }
  if (!existsSync(absolute)) return { ok: false, reason: `"${raw}" does not exist in the workspace.` };
  return { ok: true, path: absolute };
}

/**
 * Handle an integration route. Returns true when the request was
 * handled, so the caller can fall through to the rest of the stack.
 *
 * Routes are matched on the mount-point remainder, because
 * connect-style servers rewrite req.url before invoking a handler.
 */
export async function handleIntegrationRoute(
  route: string,
  request: IncomingMessage,
  response: ServerResponse,
  options: IntegrationApiOptions,
): Promise<boolean> {
  const method = request.method ?? "GET";

  if (route === "/api/integration/status" && method === "GET") {
    const gate = authorized(request, options);
    const [opa, services] = await Promise.all([detectOpa(options.workspaceRoot), probeAllServices()]);
    const binaries = scannerBinaries(options.workspaceRoot);
    sendJson(response, 200, {
      ok: true,
      runtime: options.runtime,
      tokenRequired: Boolean(options.token),
      tokenAccepted: gate.ok,
      workspaceRoot: gate.ok ? options.workspaceRoot : undefined,
      policy: {
        engine: opa.available ? "opa" : "reference",
        available: opa.available,
        version: opa.version,
        policyDir: opa.policyDir,
        detail: opa.detail,
      },
      scanners: binaries,
      services,
    });
    return true;
  }

  if (route === "/api/integration/policy" && method === "POST") {
    if (!sameOrigin(request, options)) {
      sendJson(response, 403, { ok: false, error: "Cross-origin POST refused." });
      return true;
    }
    const gate = authorized(request, options);
    if (!gate.ok) {
      sendJson(response, gate.status, { ok: false, error: gate.reason });
      return true;
    }
    const body = (await readBody(request)) as Record<string, unknown>;
    if (!body || typeof body !== "object" || !body.subject || !body.action || !body.resource || !body.context) {
      sendJson(response, 400, {
        ok: false,
        error: "subject, action, resource and context are required.",
      });
      return true;
    }
    if (!POLICY_ACTIONS.includes(body.action as (typeof POLICY_ACTIONS)[number])) {
      sendJson(response, 400, { ok: false, error: `action must be one of ${POLICY_ACTIONS.join(", ")}` });
      return true;
    }
    const input = body as unknown as PolicyInput;
    const trace = beginTrace("policy decision", { action: String(body.action), subjectKind: input.subject?.kind ?? "unknown" }, options.runtime);
    const core = integrationState.telemetry.startSpan({
      traceId: trace.traceId,
      stage: "core",
      name: "validate request",
      parentId: trace.rootId,
      attributes: { action: String(body.action), resource: input.resource?.kind ?? "unknown" },
    });
    integrationState.telemetry.endSpan(core.id, "ok");

    const tool = integrationState.telemetry.startSpan({
      traceId: trace.traceId,
      stage: "tool",
      name: "policy evaluation",
      parentId: core.id,
      attributes: { engine: "opa-or-reference" },
    });
    const evaluated = await evaluateWithOpa(input, options.workspaceRoot);
    integrationState.telemetry.endSpan(tool.id, "ok", evaluated.fromOpa ? undefined : "OPA unavailable — reference evaluator answered");
    const reference = evaluatePolicy(input);
    const agrees = reference.allowed === evaluated.decision.allowed;

    const resultSpan = integrationState.telemetry.startSpan({
      traceId: trace.traceId,
      stage: "result",
      name: "decision",
      parentId: tool.id,
      attributes: { allowed: evaluated.decision.allowed, rules: evaluated.decision.rules.join(","), engine: evaluated.fromOpa ? "opa" : "reference" },
    });
    integrationState.telemetry.endSpan(resultSpan.id, "ok");
    const verificationSpan = integrationState.telemetry.startSpan({
      traceId: trace.traceId,
      stage: "verification",
      name: "reference parity",
      parentId: resultSpan.id,
      attributes: { agrees },
    });
    integrationState.telemetry.endSpan(verificationSpan.id, agrees ? "ok" : "failed", agrees ? undefined : "The reference evaluator disagrees with the policy engine.");

    integrationState.recordDecision({
      subjectKind: String(input.subject?.kind ?? "unknown"),
      subjectId: input.subject?.userId ?? input.subject?.agentId ?? null,
      action: String(body.action),
      resourceKind: String(input.resource?.kind ?? "unknown"),
      resourceId: input.resource?.id ?? null,
      allowed: evaluated.decision.allowed,
      requiresApproval: evaluated.decision.requiresApproval,
      rules: evaluated.decision.rules,
      engine: evaluated.fromOpa ? "opa" : "reference",
      durationMs: evaluated.durationMs,
      agrees,
      correlationId: trace.correlationId,
    });

    sendJson(response, 200, {
      ok: true,
      decision: evaluated.decision,
      engine: evaluated.fromOpa ? "opa" : "reference",
      detail: evaluated.detail,
      durationMs: evaluated.durationMs,
      correlationId: trace.correlationId,
      // The reference answer is returned beside it so a divergence is
      // visible in production, not only in the test suite.
      reference: { allowed: reference.allowed, requiresApproval: reference.requiresApproval, rules: reference.rules },
      agrees,
    });
    return true;
  }

  if (route === "/api/integration/scan" && method === "POST") {
    if (!sameOrigin(request, options)) {
      sendJson(response, 403, { ok: false, error: "Cross-origin POST refused." });
      return true;
    }
    const gate = authorized(request, options);
    if (!gate.ok) {
      sendJson(response, gate.status, { ok: false, error: gate.reason });
      return true;
    }
    const body = (await readBody(request)) as { target?: unknown; history?: unknown; scanners?: unknown; failAt?: unknown };
    const target = scopedTarget(options.workspaceRoot, body.target);
    if (!target.ok) {
      sendJson(response, 400, { ok: false, error: target.reason });
      return true;
    }
    const requested = Array.isArray(body.scanners)
      ? body.scanners.filter((item): item is ScannerId => item === "gitleaks" || item === "trivy" || item === "semgrep")
      : undefined;
    const trace = beginTrace("security scan", { target: relative(options.workspaceRoot, target.path) || "." }, options.runtime);
    const tool = integrationState.telemetry.startSpan({
      traceId: trace.traceId,
      stage: "tool",
      name: "scanners",
      parentId: trace.rootId,
      attributes: { scanners: (requested ?? ["gitleaks", "trivy", "semgrep"]).join(",") },
    });
    const report = await runSecurityGate({
      target: target.path,
      workspaceRoot: options.workspaceRoot,
      history: body.history === true,
      ...(requested && requested.length > 0 ? { scanners: requested } : {}),
      ...(typeof body.failAt === "string" ? { failAt: body.failAt as "critical" | "high" | "medium" | "low" } : {}),
    });
    const skipped = report.results.filter((result) => !result.ran).map((result) => result.scanner);
    integrationState.telemetry.endSpan(tool.id, skipped.length > 0 ? "failed" : "ok", skipped.length > 0 ? `did not run: ${skipped.join(", ")}` : undefined);

    const resultSpan = integrationState.telemetry.startSpan({
      traceId: trace.traceId,
      stage: "result",
      name: "scan report",
      parentId: tool.id,
      attributes: { gatePassed: report.gatePassed, findingCount: report.results.reduce((total, item) => total + item.findings.length, 0) },
    });
    integrationState.telemetry.endSpan(resultSpan.id, "ok");
    const verificationSpan = integrationState.telemetry.startSpan({
      traceId: trace.traceId,
      stage: "verification",
      name: "gate verdict",
      parentId: resultSpan.id,
      attributes: { gatePassed: report.gatePassed, skipped: skipped.join(",") },
    });
    integrationState.telemetry.endSpan(verificationSpan.id, skipped.length > 0 ? "failed" : "ok");

    integrationState.recordScan(relative(options.workspaceRoot, target.path) || ".", report);
    sendJson(response, 200, { ok: true, report, correlationId: trace.correlationId });
    return true;
  }

  if (route === "/api/integration/security" && method === "GET") {
    const gate = authorized(request, options);
    const [opa, services] = await Promise.all([detectOpa(options.workspaceRoot), probeAllServices()]);
    const relevant = new Set(["openfga", "infisical", "temporal", "litellm"]);
    const scans = integrationState.scans_();
    sendJson(response, 200, {
      ok: true,
      tokenAccepted: gate.ok,
      policy: {
        engine: opa.available ? "opa" : "reference",
        available: opa.available,
        version: opa.version,
        policyDir: opa.policyDir,
        detail: opa.detail,
      },
      scanners: scannerBinaries(options.workspaceRoot),
      decisions: integrationState.decisions_(),
      audit: integrationState.audit_(),
      lastScan: integrationState.lastScan(),
      scanHistory: scans.map((entry) => ({ at: entry.at, gatePassed: entry.report.gatePassed, summary: entry.report.summary })),
      relationships: integrationState.relationshipSummary(),
      services: services.filter((service) => relevant.has(service.id)),
      // Triage of the baseline scan is a human judgement recorded in
      // docs/integration/acceptance-report.md; the panel does not
      // pretend to have classified them on its own.
      gitleaksTriage: gate.ok
        ? {
            known: 59,
            needsReview: 13,
            detail:
              "Baseline working-tree scan: 59 findings are generation logs or the bundle-secret canary scanner's own patterns; 13 source files are still awaiting human review. This count is documentation, not a live re-scan.",
          }
        : null,
    });
    return true;
  }

  if (route === "/api/integration/engineering" && method === "GET") {
    const services = await probeAllServices();
    const healthOf = (id: string) =>
      services.find((service) => service.id === id)?.health ?? {
        state: "not_configured" as const,
        detail: `No probe exists for "${id}"; nothing is claimed about it.`,
      };
    const orchestrator = integrationState.orchestrator;
    const locks = orchestrator.activeLocks().map((lock) => ({ workspaceId: lock.workspaceId, engine: lock.engine, since: lock.at }));
    const outcomes = orchestrator.history(20);
    const registered = new Set(orchestrator.backends_().map((backend) => backend.id));
    sendJson(response, 200, {
      ok: true,
      runtime: {
        name: options.runtime,
        workspaceRoot: options.workspaceRoot,
        node: process.version,
        engineeringApi: true,
        detail:
          registered.size === 0
            ? "The whitelisted engineering runtime is mounted, but no CodingBackend is registered with the orchestrator, so no task can execute yet. That is a real gap, not a health state."
            : `${registered.size} coding backend(s) registered with the orchestrator.`,
      },
      engines: [
        { id: "openhands", name: "OpenHands", source: "OPENHANDS_BASE_URL", health: healthOf("openhands"), selectable: registered.has("openhands") },
        { id: "opencode", name: "OpenCode", source: "OPENCODE_BASE_URL", health: healthOf("opencode"), selectable: registered.has("opencode") },
        {
          id: "local",
          name: "Local engineering runtime",
          source: "plugins/engineerApi.ts",
          health: {
            state: registered.has("local") ? "healthy" : "degraded",
            detail: registered.has("local")
              ? "registered with the orchestrator"
              : "runtime mounted (whitelisted commands, workspace copies) but not registered as an orchestrator backend",
          },
          selectable: registered.has("local"),
        },
      ],
      tasks: [],
      locks,
      verificationPolicy: [
        { rule: "backend_reported_success", detail: "the backend itself reported ok" },
        { rule: "changes_within_allowed_paths", detail: "every changed file is inside the task's allowed paths" },
        { rule: "tests_ran", detail: "a test command actually ran" },
        { rule: "tests_passed", detail: "zero failures and at least one passing test" },
        { rule: "other_commands_succeeded", detail: "no other recorded command failed" },
      ],
      history: outcomes.map((outcome) => ({
        taskId: outcome.taskId,
        engine: outcome.engine,
        verified: outcome.verification.verified,
        at: outcome.finishedAt,
        reason: outcome.verification.checks.find((check) => !check.ok)?.detail ?? outcome.selectedReason,
      })),
    });
    return true;
  }

  if (route === "/api/integration/voice" && method === "GET") {
    const services = await probeAllServices();
    const healthOf = (id: string) =>
      services.find((service) => service.id === id)?.health ?? {
        state: "not_configured" as const,
        detail: `No probe exists for "${id}"; nothing is claimed about it.`,
      };
    const vad = new VadDetector();
    sendJson(response, 200, {
      ok: true,
      adapters: [
        {
          id: "whisper",
          label: "Whisper.cpp · speech recognition",
          state: healthOf("whisper").state,
          detail: healthOf("whisper").detail,
          model: process.env.WHISPER_MODEL ?? null,
          streaming: false,
        },
        {
          id: "kokoro",
          label: "Kokoro · speech synthesis",
          state: healthOf("kokoro").state,
          detail: healthOf("kokoro").detail,
          model: process.env.KOKORO_VOICE ?? null,
          streaming: true,
        },
        {
          id: "pipecat",
          label: "Pipecat · realtime transport",
          state: healthOf("pipecat").state,
          detail: `${healthOf("pipecat").detail} Streaming WebRTC transport is not in use here.`,
          model: null,
          streaming: true,
        },
      ],
      vad: {
        implementation: vad.model(),
        neuralModelPresent: false,
        // Mirrors VadDetector's documented defaults (see VadOptions).
        thresholds: { openRatio: 3.2, closeRatio: 1.6, minSpeechFrames: 3, minSilenceFrames: 17 },
        detail:
          "An energy detector with an adaptive noise floor: it learns steady room tone while the user is silent and uses hysteresis so a quiet tail is still speech. Silero's ONNX weights are not present.",
      },
      benchmark: {
        samples: 0,
        median: null,
        p95: null,
        detail: "No audio device or synthesis server is reachable from this runtime, so no sample has been recorded.",
      },
    });
    return true;
  }

  if (route === "/api/integration/intelligence" && method === "GET") {
    const gate = authorized(request, options);
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const snapshot = await collectOperationalSnapshot({
      workspaceRoot: options.workspaceRoot,
      baseUrl: publicOrigin(request),
      force: query.get("refresh") === "1",
    });
    sendJson(response, 200, {
      ok: true,
      tokenAccepted: gate.ok,
      snapshot,
      // Which reported capabilities have a stated dependency position. An
      // undeclared capability is listed here rather than assumed ready.
      dependencyDeclarations: dependencyCoverage(snapshot.capabilities.map((capability) => capability.capabilityId)),
    });
    return true;
  }

  if (route === "/api/integration/repositories" && method === "GET") {
    const gate = authorized(request, options);
    const coverage = repositoryCoverage();
    sendJson(response, 200, {
      ok: true,
      tokenAccepted: gate.ok,
      verifiedAt: REPOSITORY_CATALOG[0]?.verifiedAt ?? null,
      coverage,
      catalog: REPOSITORY_CATALOG,
      note: "Catalog entries are verified provenance and identified boundaries. PRESENT is the only state backed by an adapter that produced evidence; listing a repository never means it is installed or running.",
    });
    return true;
  }

  if (route === "/api/integration/intelligence/explain" && method === "GET") {
    const gate = authorized(request, options);
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    const capability = (query.get("capability") ?? "").trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(capability)) {
      sendJson(response, 400, { ok: false, error: "capability must be a capability id, e.g. engineering.openhands.execute" });
      return true;
    }
    const explanation = await explainOperationalState(capability, {
      workspaceRoot: options.workspaceRoot,
      baseUrl: publicOrigin(request),
    });
    sendJson(response, 200, { ok: true, tokenAccepted: gate.ok, ...explanation });
    return true;
  }

  if (route === "/api/integration/intelligence/plan" && method === "POST") {
    if (!sameOrigin(request, options)) {
      sendJson(response, 403, { ok: false, error: "Cross-origin POST refused." });
      return true;
    }
    const gate = authorized(request, options);
    if (!gate.ok) {
      sendJson(response, gate.status, { ok: false, error: gate.reason });
      return true;
    }
    const body = (await readBody(request)) as { goal?: unknown };
    if (typeof body.goal !== "string" || !body.goal.trim()) {
      sendJson(response, 400, { ok: false, error: "goal is required" });
      return true;
    }
    // A plan is a proposal. This route never dispatches work: execution is
    // AdapterRegistry + EngineeringOrchestrator, and it is not called here.
    const { plan, snapshot } = await planActivation(body.goal.trim().slice(0, 400), {
      workspaceRoot: options.workspaceRoot,
      baseUrl: publicOrigin(request),
    });
    sendJson(response, 200, {
      ok: true,
      plan,
      snapshotId: snapshot.snapshotId,
      readiness: snapshot.overallReadiness,
    });
    return true;
  }

  if (route === "/api/integration/traces" && method === "GET") {
    const telemetry = integrationState.telemetry;
    const traces = telemetry.recentTraces(25).map((trace) => ({
      ...trace,
      spans: telemetry.traceSpans(trace.traceId).map((span) => ({
        id: span.id,
        parentId: span.parentId,
        stage: span.stage,
        name: span.name,
        startedAt: span.startedAt,
        durationMs: span.endedAt ? span.endedAt - span.startedAt : null,
        status: span.status,
        attributes: span.attributes,
        ...(span.error ? { error: span.error } : {}),
      })),
    }));
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    sendJson(response, 200, {
      ok: true,
      traces,
      exporter: {
        configured: Boolean(endpoint),
        // The endpoint itself may carry credentials in its userinfo; only
        // the origin is ever disclosed.
        endpoint: endpoint ? safeOrigin(endpoint) : null,
        detail: endpoint
          ? "An OTLP endpoint is configured; traces can be exported from a server-side caller."
          : "No collector is configured. Traces stay in this process and nothing is shipped.",
      },
      buffer: integrationState.traceBuffer(),
    });
    return true;
  }

  return false;
}

function safeOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "configured (unparseable as a URL)";
  }
}

/**
 * A connect-style middleware, so Vite dev, the standalone server and
 * any other connect stack mount the SAME implementation.
 */
export function createIntegrationApi(options: IntegrationApiOptions) {
  return async function integrationApi(
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> {
    const url = request.url ?? "/";
    const raw = url.split("?")[0] ?? "/";
    let route: string;
    if (options.mountPath) {
      // Unstripped mount (Vite): claim only the prefix we own.
      const prefix = options.mountPath;
      if (raw !== prefix && !raw.startsWith(`${prefix}/`)) {
        next();
        return;
      }
      route = raw;
    } else {
      // Stripped mount (connect): a request mounted at /api/integration
      // arrives as "/status", so restore the full route.
      route = raw.startsWith("/api/integration")
        ? raw
        : `/api/integration${raw.startsWith("/") ? raw : `/${raw}`}`;
    }
    if (!route.startsWith("/api/integration/")) {
      // Only an unknown path UNDER our prefix is ours to 404. Anything else
      // belongs to the next middleware — this is the branch whose absence
      // took the application down.
      next();
      return;
    }
    try {
      const handled = await handleIntegrationRoute(route, request, response, options);
      if (!handled) {
        sendJson(response, 404, { ok: false, error: `No integration route for ${route}.` });
      }
    } catch (error) {
      // Never let a handler rejection escape: an unhandled rejection in
      // the dev server's middleware took the whole server down once.
      if (!response.headersSent) {
        sendJson(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        response.end();
      }
    }
  };
}
