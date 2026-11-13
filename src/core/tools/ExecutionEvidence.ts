/**
 * ==========================================================
 * LÉLU — EXECUTION EVIDENCE
 *
 * One identity for one real tool invocation, and the lifecycle stages that
 * identity passes through. Both production paths (the chat tool loop and the
 * task engine) end at `dispatchToolCall`, so both get the same identity from
 * the same place — no second bus, no second registry.
 *
 * The rule this module exists to enforce: a record is only ever produced by
 * the code that OBSERVED the outcome. A model's summary is never evidence,
 * a planned step is not an execution, and a suppressed duplicate is its own
 * outcome rather than a second success.
 * ==========================================================
 */

export type ExecutionPath = "chat" | "task" | "unknown";

/** The lifecycle of one real invocation. */
export type ExecutionStage =
  | "requested"
  | "authorized"
  | "refused"
  | "started"
  | "succeeded"
  | "failed"
  | "timed-out"
  | "suppressed";

export type ExecutionOutcome = "succeeded" | "failed" | "timed-out" | "refused" | "suppressed" | "not-found";

export type ApprovalState = "not-required" | "approved" | "refused";

export interface ExecutionRecord {
  /** Stable across every stage of ONE invocation. */
  executionId: string;
  /** The turn or task this work belongs to. */
  taskId: string;
  path: ExecutionPath;
  /** Plan step, when the task engine drove this execution. */
  stepId?: string;
  /** Registry id (`workflow.list`), the name the dispatcher resolved. */
  tool: string;
  /** The name the model used, when it differs from the registry id. */
  requestedName?: string;
  approval: ApprovalState;
  stage: ExecutionStage;
  outcome?: ExecutionOutcome;
  /** Measured by the execution layer, never by the model. */
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  /** Redacted, truncated reason for a refusal or failure. Never arguments. */
  reason?: string;
}

let sequence = 0;

/** A fresh identity. Includes the path so a record is readable on its own. */
export function newExecutionId(path: ExecutionPath, taskId: string | undefined): string {
  sequence += 1;
  return `${path}-${Date.now().toString(36)}-${sequence.toString(36)}-${hash(taskId)}`;
}

function hash(value: string | undefined): string {
  // A caller that passed no task id still gets an identity: an execution with
  // an unknown owner is recorded, not silently dropped or crashed on.
  const text = value ?? "no-task";
  let out = 0;
  for (let index = 0; index < text.length; index += 1) {
    out = (out * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(out).toString(36).slice(0, 6);
}

/**
 * Strip anything that looks like a credential and clamp the length.
 *
 * A refusal reason can quote a path or an upstream error; it can also quote a
 * token if a provider echoes one. Tool ARGUMENTS are never included anywhere,
 * and this is the second line of defence for free text.
 */
export function redactExecutionText(text: string, limit = 200): string {
  return text
    .replace(/\b(sk|rk|pk|ghp|gho|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** The one-line form written to the server log. No arguments, no prompt text. */
export function formatExecutionLine(record: ExecutionRecord): string {
  const parts = [
    `id=${record.executionId}`,
    `stage=${record.stage}`,
    `path=${record.path}`,
    `tool=${record.tool}`,
    `task=${record.taskId.slice(0, 24)}`,
  ];
  if (record.stepId) parts.push(`step=${record.stepId.slice(0, 24)}`);
  if (record.approval !== "not-required") parts.push(`approval=${record.approval}`);
  if (record.outcome) parts.push(`outcome=${record.outcome}`);
  if (typeof record.durationMs === "number") parts.push(`durationMs=${Math.round(record.durationMs)}`);
  if (record.reason) parts.push(`reason="${redactExecutionText(record.reason)}"`);
  return `[execution] ${parts.join(" ")}`;
}

/** Attach a redacted explanation without any caller repeating the pattern. */
export function withReason<T extends object>(record: T, text: string): T & { reason: string } {
  return { ...record, reason: redactExecutionText(text) } as T & { reason: string };
}

/** Shape guard for anything arriving from a browser. */
export function isExecutionRecord(value: unknown): value is ExecutionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const stages = ["requested", "authorized", "refused", "started", "succeeded", "failed", "timed-out", "suppressed"];
  const paths = ["chat", "task", "unknown"];
  return (
    typeof record.executionId === "string" &&
    record.executionId.length > 0 &&
    record.executionId.length <= 120 &&
    typeof record.taskId === "string" &&
    record.taskId.length <= 120 &&
    typeof record.tool === "string" &&
    record.tool.length <= 80 &&
    typeof record.stage === "string" &&
    stages.includes(record.stage) &&
    typeof record.path === "string" &&
    paths.includes(record.path)
  );
}

/**
 * Drop fields a browser must not be able to choose.
 *
 * `reason` is re-redacted here: the client is not trusted, and the server log
 * is the copy that outlives the tab.
 */
export function sanitizeExecutionRecord(record: ExecutionRecord): ExecutionRecord {
  return {
    executionId: record.executionId,
    taskId: record.taskId.slice(0, 120),
    path: record.path,
    ...(record.stepId ? { stepId: String(record.stepId).slice(0, 120) } : {}),
    tool: record.tool.slice(0, 80),
    ...(record.requestedName ? { requestedName: String(record.requestedName).slice(0, 80) } : {}),
    approval: record.approval === "approved" || record.approval === "refused" ? record.approval : "not-required",
    stage: record.stage,
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(typeof record.startedAt === "number" ? { startedAt: record.startedAt } : {}),
    ...(typeof record.finishedAt === "number" ? { finishedAt: record.finishedAt } : {}),
    ...(typeof record.durationMs === "number" ? { durationMs: Math.min(Math.max(0, record.durationMs), 86_400_000) } : {}),
    ...(record.reason ? { reason: redactExecutionText(String(record.reason)) } : {}),
  };
}
