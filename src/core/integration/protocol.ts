/**
 * ==========================================================
 * LÉLU — CAPABILITY ADAPTER PROTOCOL
 *
 * One typed contract every integrated service speaks. The 16
 * repositories in docs/integration/repository-audit.md do NOT
 * each get their own vocabulary: a coding engine, a speech
 * recogniser and a secrets manager all answer the same
 * initialize / healthCheck / capabilities / execute / cancel /
 * shutdown / getStatus / getMetrics questions, and every
 * request and response carries the same identity, permission
 * and audit fields.
 *
 * WHY THIS EXISTS
 * ---------------
 * Without it, each integration invents its own way to be
 * called, its own idea of "did it work", and its own audit
 * story. The result is sixteen capabilities and no way to
 * answer "who asked for this, was it permitted, what did it
 * touch, and can I prove the result".
 *
 * Non-negotiable properties enforced here:
 *   • every request names an identity, an action, a workspace
 *     and an audit correlation id — there is no anonymous call;
 *   • every request has a bounded timeout and a cancellation
 *     handle, so nothing runs forever by accident;
 *   • model-supplied arguments are VALIDATED against a schema
 *     before they reach an adapter (a model's tool arguments
 *     are untrusted input, exactly like a request body);
 *   • every response states its own verification, so "it ran"
 *     and "it worked" are different fields.
 *
 * This module is pure and browser-safe: no node built-ins, no
 * child processes. Server-only execution lives in plugins/.
 * ==========================================================
 */

/** The eight action classes authorization is expressed in. */
export type CapabilityAction =
  | "READ"
  | "WRITE"
  | "EXECUTE"
  | "INSTALL"
  | "DELETE"
  | "DEPLOY"
  | "ADMINISTER"
  | "ACCESS_EXTERNAL_DEVICE";

export const CAPABILITY_ACTIONS: readonly CapabilityAction[] = [
  "READ",
  "WRITE",
  "EXECUTE",
  "INSTALL",
  "DELETE",
  "DEPLOY",
  "ADMINISTER",
  "ACCESS_EXTERNAL_DEVICE",
];

/** Who is asking. Null is allowed only where the caller genuinely has none. */
export interface ExecutionIdentity {
  /** The authenticated human (Supabase user id), or null when signed out. */
  userId: string | null;
  /** The agent that initiated the work, when an agent did. */
  agentId: string | null;
  /** The temporary session carrying the request. */
  sessionId: string | null;
  /** The isolated workspace the work is confined to. */
  workspaceId: string | null;
}

/** The permission question being asked of the policy layer. */
export interface PermissionContext {
  action: CapabilityAction;
  /** The thing acted on, e.g. "repo:LeluV1.1" or "file:src/App.tsx". */
  resource: string;
  /** The caller's autonomy level (see cognition/AutonomyGate). */
  autonomyLevel: number;
  /** Set when the action is a device operation. */
  deviceId?: string;
  /** Set when the action belongs to a project. */
  projectId?: string;
  /** A human approval that covers this exact call, if one exists. */
  approvalId?: string;
}

/** Where the work may run. Production is never implied. */
export type ExecutionEnvironment = "sandbox" | "project" | "production";

/**
 * Every execution request, in full.
 *
 * `auditCorrelationId` is the thread that ties the user's
 * request, the policy decision, the adapter call and the
 * telemetry span together; it is required, not optional,
 * because a missing correlation id is an untraceable action.
 */
export interface ExecutionRequest {
  requestId: string;
  identity: ExecutionIdentity;
  /** Registry id of the capability, e.g. "coding.openhands". */
  capability: string;
  permission: PermissionContext;
  environment: ExecutionEnvironment;
  timeoutMs: number;
  /** Validated arguments for the capability. */
  args: Record<string, unknown>;
  auditCorrelationId: string;
  /** Cooperative cancellation handle; `cancel(cancelToken)` stops the work. */
  cancelToken?: string;
}

export type ExecutionStatus = "succeeded" | "failed" | "cancelled" | "timed_out" | "denied";

export interface ExecutionArtifact {
  kind: "file" | "log" | "screenshot" | "report" | "diff" | "audio" | "trace";
  /** Stable reference (a path, a URL, a trace id) — never the bytes. */
  ref: string;
  label: string;
  bytes?: number;
}

export interface ExecutionError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * A response says what ran AND whether it was checked.
 *
 * `verification.verified` is false for anything the adapter could
 * not actually confirm, which is the common honest case. A caller
 * must never read `status === "succeeded"` as "the work is proven".
 */
export interface ExecutionResponse {
  executionId: string;
  requestId: string;
  status: ExecutionStatus;
  result: unknown;
  error: ExecutionError | null;
  timing: { startedAt: number; finishedAt: number; durationMs: number };
  artifacts: ExecutionArtifact[];
  verification: { verified: boolean; method: string; evidence: string[] };
  auditCorrelationId: string;
}

export type AdapterHealthState = "healthy" | "degraded" | "unavailable" | "not_configured";

export interface AdapterHealth {
  state: AdapterHealthState;
  /** The real reason, in terms someone can act on. */
  detail: string;
  checkedAt: number;
  latencyMs?: number;
  /** True only when the adapter actually contacted its service. */
  contacted: boolean;
}

export interface AdapterMetrics {
  executions: number;
  failures: number;
  denials: number;
  timeouts: number;
  cancellations: number;
  lastDurationMs: number | null;
  totalDurationMs: number;
  lastExecutionAt: number | null;
}

export interface AdapterCapability {
  id: string;
  action: CapabilityAction;
  description: string;
  /** Which side of the app can use it. */
  surface: "backend" | "frontend" | "both";
  /** JSON Schema for the arguments, when the capability takes any. */
  parameters?: Record<string, unknown>;
}

export interface AdapterStatus {
  id: string;
  name: string;
  /** Which audited repository/service this adapter integrates. */
  source: string;
  initialized: boolean;
  health: AdapterHealth;
  capabilities: AdapterCapability[];
  metrics: AdapterMetrics;
}

/**
 * The contract. Implementations may add methods; they may not
 * omit these, because the registry and the control surfaces are
 * written against exactly this set.
 */
export interface CapabilityAdapter {
  readonly id: string;
  readonly name: string;
  /** The audited source this integrates (repository URL or model card). */
  readonly source: string;
  initialize(): Promise<void>;
  healthCheck(): Promise<AdapterHealth>;
  capabilities(): AdapterCapability[];
  execute(request: ExecutionRequest, signal?: AbortSignal): Promise<ExecutionResponse>;
  cancel(cancelToken: string): Promise<boolean>;
  shutdown(): Promise<void>;
  getStatus(): AdapterStatus;
  getMetrics(): AdapterMetrics;
}

/* ------------------------------------------------------------------ *
 * VALIDATION — model arguments are untrusted input
 * ------------------------------------------------------------------ */

export interface ValidationIssue {
  path: string;
  message: string;
}

const ENVIRONMENTS: readonly ExecutionEnvironment[] = ["sandbox", "project", "production"];
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30 * 60_000;

/**
 * Validate a request before an adapter sees it.
 *
 * Deliberately explicit rather than a schema library: this runs on
 * every capability call, and the checks that matter are the ones a
 * library would not know about — an unknown ACTION, an autonomy
 * level that is not an integer, a timeout that would let a tool
 * hang for a day, an identity object that is present but empty.
 */
export function validateExecutionRequest(request: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!request || typeof request !== "object") {
    return [{ path: "", message: "request must be an object" }];
  }
  const value = request as Record<string, unknown>;
  const text = (key: string): string => {
    const raw = value[key];
    if (typeof raw !== "string" || !raw.trim()) {
      issues.push({ path: key, message: `${key} must be a non-empty string` });
      return "";
    }
    return raw;
  };

  text("requestId");
  text("capability");
  text("auditCorrelationId");

  if (!ENVIRONMENTS.includes(value.environment as ExecutionEnvironment)) {
    issues.push({ path: "environment", message: `environment must be one of ${ENVIRONMENTS.join(", ")}` });
  }

  const timeout = value.timeoutMs;
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
    issues.push({ path: "timeoutMs", message: "timeoutMs must be a number" });
  } else if (timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
    issues.push({
      path: "timeoutMs",
      message: `timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
    });
  }

  const identity = value.identity;
  if (!identity || typeof identity !== "object") {
    issues.push({ path: "identity", message: "identity is required — there are no anonymous executions" });
  } else {
    const id = identity as Record<string, unknown>;
    const any = [id.userId, id.agentId, id.sessionId, id.serviceId].some(
      (item) => typeof item === "string" && item.trim() !== "",
    );
    if (!any) {
      issues.push({
        path: "identity",
        message: "identity must name a user, an agent, a session or a service",
      });
    }
  }

  const permission = value.permission;
  if (!permission || typeof permission !== "object") {
    issues.push({ path: "permission", message: "permission context is required" });
  } else {
    const p = permission as Record<string, unknown>;
    if (!CAPABILITY_ACTIONS.includes(p.action as CapabilityAction)) {
      issues.push({ path: "permission.action", message: "action must be one of the eight capability actions" });
    }
    if (typeof p.resource !== "string" || !p.resource.trim()) {
      issues.push({ path: "permission.resource", message: "permission.resource must name what is acted on" });
    }
    if (typeof p.autonomyLevel !== "number" || !Number.isInteger(p.autonomyLevel) || p.autonomyLevel < 0) {
      issues.push({ path: "permission.autonomyLevel", message: "autonomyLevel must be a non-negative integer" });
    }
  }

  const args = value.args;
  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
    issues.push({ path: "args", message: "args must be an object when present" });
  }

  return issues;
}

/** Build a valid request, filling the fields a caller cannot invent. */
export function createExecutionRequest(input: {
  capability: string;
  identity: ExecutionIdentity;
  permission: PermissionContext;
  environment: ExecutionEnvironment;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  auditCorrelationId?: string;
  cancelToken?: string;
}): ExecutionRequest {
  const correlation = input.auditCorrelationId ?? `aud-${crypto.randomUUID()}`;
  return {
    requestId: `req-${crypto.randomUUID()}`,
    identity: input.identity,
    capability: input.capability,
    permission: input.permission,
    environment: input.environment,
    timeoutMs: Math.min(Math.max(input.timeoutMs ?? 60_000, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS),
    args: input.args ?? {},
    auditCorrelationId: correlation,
    ...(input.cancelToken ? { cancelToken: input.cancelToken } : {}),
  };
}

/** A fresh metrics record for a new adapter. */
export function emptyMetrics(): AdapterMetrics {
  return {
    executions: 0,
    failures: 0,
    denials: 0,
    timeouts: 0,
    cancellations: 0,
    lastDurationMs: null,
    totalDurationMs: 0,
    lastExecutionAt: null,
  };
}

/**
 * Validate arguments against the small JSON-Schema subset the
 * adapters actually publish (object/string/number/boolean/enum/
 * required). Anything beyond that subset is ignored rather than
 * guessed at, and the caller is told so by `supported: false`.
 */
export function validateArguments(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
): { ok: boolean; issues: ValidationIssue[] } {
  if (!schema) return { ok: true, issues: [] };
  const issues: ValidationIssue[] = [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      issues.push({ path: key, message: `${key} is required` });
    }
  }
  for (const [key, spec] of Object.entries(properties)) {
    const value = args[key];
    if (value === undefined) continue;
    const type = spec.type;
    if (type === "string" && typeof value !== "string") {
      issues.push({ path: key, message: `${key} must be a string` });
    }
    if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      issues.push({ path: key, message: `${key} must be a number` });
    }
    if (type === "boolean" && typeof value !== "boolean") {
      issues.push({ path: key, message: `${key} must be a boolean` });
    }
    if (type === "array" && !Array.isArray(value)) {
      issues.push({ path: key, message: `${key} must be an array` });
    }
    if (Array.isArray(spec.enum) && !(spec.enum as unknown[]).includes(value)) {
      issues.push({ path: key, message: `${key} must be one of ${(spec.enum as unknown[]).join(", ")}` });
    }
  }
  // Unknown arguments are refused: an adapter that ignores an argument
  // a model invented is doing something other than what was asked.
  for (const key of Object.keys(args)) {
    if (!(key in properties)) issues.push({ path: key, message: `${key} is not a parameter of this capability` });
  }
  return { ok: issues.length === 0, issues };
}
