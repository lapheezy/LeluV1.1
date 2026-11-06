/**
 * ==========================================================
 * LÉLU — CAPABILITY REGISTRY & SECURITY GATEWAY
 *
 * The ONE door every integrated capability is called through.
 * An adapter cannot be reached by a model, an agent, a workflow
 * or the UI without passing:
 *
 *   1. request validation  — identity, action, workspace, timeout
 *   2. relationship check  — OpenFGA tuples (device/session/owner)
 *   3. policy decision     — OPA semantics (eight action classes)
 *   4. argument validation — the capability's own JSON Schema
 *   5. bounded execution   — timeout + cooperative cancellation
 *   6. audit + telemetry   — a correlated, secret-redacted record
 *
 * This is deliberately NOT a second provider registry or a second
 * orchestrator: it is the security and accounting layer in front
 * of adapters. SHAMAN still decides WHO does work; the
 * EngineeringOrchestrator still decides WITH WHAT; this decides
 * whether the call may happen at all, and records that it did.
 * ==========================================================
 */

import {
  emptyMetrics,
  validateArguments,
  validateExecutionRequest,
  type AdapterCapability,
  type AdapterStatus,
  type CapabilityAdapter,
  type ExecutionRequest,
  type ExecutionResponse,
  type ExecutionStatus,
} from "./protocol.ts";
import { evaluatePolicy, type PolicyDecision, type PolicyInput, type PolicySubject } from "../security/policy.ts";
import RelationshipStore from "../security/authz/RelationshipStore.ts";
import Telemetry from "../observability/Telemetry.ts";

export interface AuditEntry {
  at: number;
  requestId: string;
  capability: string;
  action: string;
  resource: string;
  subject: string;
  userId: string | null;
  agentId: string | null;
  sessionId: string | null;
  workspaceId: string | null;
  environment: string;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  risk: string;
  engine: string;
  correlationId: string;
  status: ExecutionStatus | "refused_before_execution";
}

export type Authorizer = (input: PolicyInput) => PolicyDecision | Promise<PolicyDecision>;

export interface ExecuteOptions {
  /** Override the policy evaluator (the server passes real OPA). */
  authorizer?: Authorizer;
  /** Is this approval live? Defaults to "no" — never assumed. */
  approvalVerifier?: (approvalId: string) => boolean;
}

const MAX_AUDIT = 500;

export default class AdapterRegistry {
  private static instance: AdapterRegistry | null = null;
  private readonly adapters = new Map<string, CapabilityAdapter>();
  private readonly auditLog: AuditEntry[] = [];
  private readonly active = new Map<string, AbortController>();

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) AdapterRegistry.instance = new AdapterRegistry();
    return AdapterRegistry.instance;
  }

  public register(adapter: CapabilityAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Adapter "${adapter.id}" is already registered — one owner per capability.`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  public get(id: string): CapabilityAdapter | undefined {
    return this.adapters.get(id);
  }

  public all(): CapabilityAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Every capability across every adapter, for the control surfaces. */
  public capabilities(): Array<AdapterCapability & { adapter: string }> {
    return this.all().flatMap((adapter) =>
      adapter.capabilities().map((capability) => ({ ...capability, adapter: adapter.id })),
    );
  }

  public async statuses(): Promise<AdapterStatus[]> {
    const statuses: AdapterStatus[] = [];
    for (const adapter of this.all()) {
      let status = adapter.getStatus();
      // Health is probed only when asked, so a status page never
      // launches sixteen outbound calls on every render.
      try {
        status = { ...status, health: await adapter.healthCheck() };
      } catch (error) {
        status = {
          ...status,
          health: {
            state: "unavailable",
            detail: `health check threw: ${error instanceof Error ? error.message : String(error)}`,
            checkedAt: Date.now(),
            contacted: false,
          },
        };
      }
      statuses.push(status);
    }
    return statuses;
  }

  public audit(limit = 100): AuditEntry[] {
    return [...this.auditLog].reverse().slice(0, limit);
  }

  /** Every capability currently registered, by adapter. */
  public async initializeAll(): Promise<void> {
    for (const adapter of this.all()) {
      try {
        await adapter.initialize();
      } catch {
        // An adapter that cannot initialize reports unavailable through
        // its own health check; it must not stop the others starting.
      }
    }
  }

  /**
   * The one execution path.
   *
   * Returns a response for every outcome — including a refusal. A
   * denial is a real, recorded result, not a thrown error the caller
   * has to guess about.
   */
  public async execute(request: ExecutionRequest, options: ExecuteOptions = {}): Promise<ExecutionResponse> {
    const startedAt = Date.now();
    const telemetry = Telemetry.getInstance();

    const issues = validateExecutionRequest(request);
    if (issues.length > 0) {
      return this.response(request, startedAt, "denied", null, {
        code: "invalid_request",
        message: issues.map((issue) => `${issue.path || "request"}: ${issue.message}`).join("; "),
        retryable: false,
      }, {
        verified: false,
        method: "none",
        evidence: ["request rejected before any adapter was contacted"],
      });
    }

    const adapter = this.adapters.get(request.capability);
    if (!adapter) {
      return this.response(request, startedAt, "denied", null, {
        code: "unknown_capability",
        message: `No adapter is registered for "${request.capability}".`,
        retryable: false,
      }, { verified: false, method: "none", evidence: ["capability not registered"] });
    }

    // ---- relationship + policy ------------------------------------
    const subject = this.subjectOf(request);
    const deviceId = request.permission.deviceId ?? "";
    const sessionId = request.identity.sessionId ?? "";
    const deviceCheck =
      request.permission.action === "ACCESS_EXTERNAL_DEVICE" && deviceId && sessionId
        ? RelationshipStore.getInstance().sessionMay(sessionId, deviceId, request.capability)
        : null;

    const approvalId = request.permission.approvalId;
    const approvalValid = approvalId
      ? options.approvalVerifier
        ? options.approvalVerifier(approvalId)
        : false
      : false;

    const policyInput: PolicyInput = {
      subject,
      action: request.permission.action,
      resource: {
        kind: resourceKindOf(request.permission.resource),
        id: request.permission.resource,
        ...(request.identity.userId ? { ownerId: request.identity.userId } : {}),
      },
      context: {
        autonomyLevel: request.permission.autonomyLevel,
        environment: request.environment,
        approvalValid,
        deviceAuthorized: deviceCheck ? deviceCheck.allowed : false,
        agentSelfElevation: request.args.selfElevation === true,
      },
    };

    let decision: PolicyDecision;
    try {
      decision = options.authorizer ? await options.authorizer(policyInput) : evaluatePolicy(policyInput);
    } catch (error) {
      decision = {
        allowed: false,
        requiresApproval: false,
        reason: `Policy evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        action: request.permission.action,
        risk: "high",
        engine: "reference",
        rules: ["policy_error"],
      };
    }

    if (!decision.allowed) {
      this.record(request, decision, "refused_before_execution");
      const metrics = adapter.getMetrics();
      metrics.denials += 1;
      return this.response(request, startedAt, "denied", null, {
        code: decision.requiresApproval ? "approval_required" : "policy_denied",
        message: decision.reason,
        retryable: false,
      }, {
        verified: false,
        method: `policy:${decision.engine}`,
        evidence: [`rules: ${decision.rules.join(", ")}`],
      });
    }

    // ---- argument validation --------------------------------------
    const capability = adapter.capabilities().find((item) => item.id === request.capability) ??
      adapter.capabilities().find((item) => request.capability.endsWith(item.id));
    const argumentCheck = validateArguments(capability?.parameters, request.args);
    if (!argumentCheck.ok) {
      this.record(request, decision, "refused_before_execution");
      const metrics = adapter.getMetrics();
      metrics.denials += 1;
      return this.response(request, startedAt, "denied", null, {
        code: "invalid_arguments",
        message: argumentCheck.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
        retryable: false,
      }, {
        verified: false,
        method: "argument_schema",
        evidence: ["model-supplied arguments failed the capability schema"],
      });
    }

    // ---- execution ------------------------------------------------
    const controller = new AbortController();
    if (request.cancelToken) this.active.set(request.cancelToken, controller);
    const timer = setTimeout(() => controller.abort(new Error("timeout")), request.timeoutMs);

    const span = telemetry.startSpan({
      traceId: request.auditCorrelationId,
      stage: "service",
      name: `${adapter.id}:${request.permission.action}`,
      attributes: {
        capability: request.capability,
        action: request.permission.action,
        resource: request.permission.resource,
        environment: request.environment,
        engine: decision.engine,
        autonomyLevel: request.permission.autonomyLevel,
      },
    });

    const metrics = adapter.getMetrics();
    metrics.executions += 1;
    metrics.lastExecutionAt = startedAt;

    try {
      const result = await adapter.execute({ ...request, args: sanitizeArguments(request.args) }, controller.signal);
      const finishedAt = Date.now();
      metrics.lastDurationMs = finishedAt - startedAt;
      metrics.totalDurationMs += metrics.lastDurationMs;
      if (result.status === "failed") metrics.failures += 1;
      if (result.status === "cancelled") metrics.cancellations += 1;
      if (result.status === "timed_out") metrics.timeouts += 1;

      telemetry.annotate(span.id, {
        status: result.status,
        verified: result.verification.verified,
        durationMs: metrics.lastDurationMs,
      });
      telemetry.endSpan(span.id, result.status === "succeeded" ? "ok" : result.status === "cancelled" ? "cancelled" : "failed", result.error?.message);
      this.record(request, decision, result.status);
      return {
        ...result,
        requestId: request.requestId,
        auditCorrelationId: request.auditCorrelationId,
        timing: { startedAt, finishedAt, durationMs: finishedAt - startedAt },
      };
    } catch (error) {
      const timedOut = controller.signal.aborted && String(controller.signal.reason).includes("timeout");
      const status: ExecutionStatus = timedOut ? "timed_out" : "failed";
      const finishedAt = Date.now();
      metrics.lastDurationMs = finishedAt - startedAt;
      metrics.totalDurationMs += metrics.lastDurationMs;
      if (timedOut) metrics.timeouts += 1;
      else metrics.failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      telemetry.annotate(span.id, { status, durationMs: metrics.lastDurationMs });
      telemetry.endSpan(span.id, timedOut ? "cancelled" : "failed", message);
      this.record(request, decision, status);
      return this.response(request, startedAt, status, null, {
        code: timedOut ? "timeout" : "adapter_error",
        message,
        retryable: true,
      }, {
        verified: false,
        method: "none",
        evidence: ["the adapter threw or the call timed out before a verified result"],
      });
    } finally {
      clearTimeout(timer);
      if (request.cancelToken) this.active.delete(request.cancelToken);
    }
  }

  /** Cooperatively stop an execution by its cancel token. */
  public async cancel(cancelToken: string): Promise<boolean> {
    const controller = this.active.get(cancelToken);
    if (!controller) {
      // The adapter may hold it; ask every adapter that can cancel.
      for (const adapter of this.all()) {
        if (await adapter.cancel(cancelToken)) return true;
      }
      return false;
    }
    controller.abort(new Error("cancelled"));
    return true;
  }

  public resetForTests(): void {
    this.adapters.clear();
    this.auditLog.length = 0;
    this.active.clear();
  }

  /* ---------------- internals ---------------- */

  private subjectOf(request: ExecutionRequest): PolicySubject {
    if (request.identity.agentId && !request.identity.userId) {
      return { kind: "agent", userId: null, agentId: request.identity.agentId, sessionId: request.identity.sessionId };
    }
    if (request.identity.userId) {
      return { kind: "user", userId: request.identity.userId, agentId: request.identity.agentId, sessionId: request.identity.sessionId };
    }
    return { kind: "service", userId: null, agentId: request.identity.agentId, sessionId: request.identity.sessionId };
  }

  private record(request: ExecutionRequest, decision: PolicyDecision, status: ExecutionStatus | "refused_before_execution"): void {
    this.auditLog.push({
      at: Date.now(),
      requestId: request.requestId,
      capability: request.capability,
      action: request.permission.action,
      resource: request.permission.resource,
      subject: this.subjectOf(request).kind,
      userId: request.identity.userId,
      agentId: request.identity.agentId,
      sessionId: request.identity.sessionId,
      workspaceId: request.identity.workspaceId,
      environment: request.environment,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      reason: decision.reason,
      risk: decision.risk,
      engine: decision.engine,
      correlationId: request.auditCorrelationId,
      status,
    });
    if (this.auditLog.length > MAX_AUDIT) this.auditLog.splice(0, this.auditLog.length - MAX_AUDIT);
  }

  private response(
    request: ExecutionRequest,
    startedAt: number,
    status: ExecutionStatus,
    result: unknown,
    error: ExecutionResponse["error"],
    verification: ExecutionResponse["verification"],
  ): ExecutionResponse {
    const finishedAt = Date.now();
    return {
      executionId: `exec-${crypto.randomUUID()}`,
      requestId: request.requestId,
      status,
      result,
      error,
      timing: { startedAt, finishedAt, durationMs: finishedAt - startedAt },
      artifacts: [],
      verification,
      auditCorrelationId: request.auditCorrelationId,
    };
  }
}

function resourceKindOf(resource: string): PolicyInput["resource"]["kind"] {
  const prefix = resource.split(":")[0]?.toLowerCase() ?? "";
  const known: PolicyInput["resource"]["kind"][] = [
    "file",
    "repository",
    "workspace",
    "project",
    "device",
    "database",
    "external_api",
    "shell",
    "deployment",
    "secret",
  ];
  return (known as string[]).includes(prefix) ? (prefix as PolicyInput["resource"]["kind"]) : "external_api";
}

/**
 * Nothing secret survives into an adapter's arguments.
 *
 * The adapter gets the caller's arguments minus any credential-shaped
 * key: an integrated service must receive its key from ITS OWN server
 * configuration, never because a caller passed one through. A model
 * that "helpfully" includes a token is refused that value, not obeyed.
 */
export function sanitizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/(api[_-]?key|token|secret|password|authorization|credential|private[_-]?key)/i.test(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/** A metrics view that includes adapters with no executions yet. */
export function emptyStatus(id: string, name: string, source: string): AdapterStatus {
  return {
    id,
    name,
    source,
    initialized: false,
    health: { state: "not_configured", detail: "not initialized", checkedAt: Date.now(), contacted: false },
    capabilities: [],
    metrics: emptyMetrics(),
  };
}
