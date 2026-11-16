/**
 * ==========================================================
 * LÉLU — OPENCODE ADAPTER (server side)
 *
 * OpenCode is a coding engine that runs as its own HTTP server.
 * This module is the ONE place LÉLU talks to it:
 *
 *   GET  /api/integration/opencode/health → is a real server there?
 *   POST /api/integration/opencode/run    → dispatch one task
 *
 * Three rules, because this is an execution boundary:
 *
 * • The base URL comes from `OPENCODE_BASE_URL`, read on the
 *   server. A browser never chooses which engine to contact.
 * • An unset base URL is reported as `not_configured` — it is not
 *   "healthy", not "degraded", and never quietly replaced by the
 *   local shell. A task that must run on OpenCode is not the same
 *   task on a different engine.
 * • The dispatch shape follows OpenCode's HTTP API (POST /session,
 *   then POST /session/{id}/message with text parts). No live
 *   OpenCode server exists in this environment, so that path is
 *   implemented and unit-tested against a stub, but it is NOT
 *   claimed as verified against a running engine. The response
 *   says which of the two it was.
 * ==========================================================
 */

import type { AdapterHealth } from "../../src/core/integration/protocol.ts";

const DEFAULT_TIMEOUT_MS = 8_000;
const DISPATCH_TIMEOUT_MS = 120_000;

function baseUrl(): string | null {
  const raw = process.env.OPENCODE_BASE_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: Record<string, unknown>; latencyMs: number }> {
  const started = Date.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body, latencyMs: Date.now() - started };
}

export async function openCodeHealth(): Promise<AdapterHealth> {
  const base = baseUrl();
  const checkedAt = Date.now();
  if (!base) {
    return {
      state: "not_configured",
      detail:
        "OPENCODE_BASE_URL is unset — no OpenCode server is configured, so no task can be dispatched to it. The local engineering runtime is a different engine and is not substituted.",
      checkedAt,
      contacted: false,
    };
  }
  try {
    const { status, latencyMs } = await requestJson(`${base}/health`, { method: "GET" }, DEFAULT_TIMEOUT_MS);
    if (status > 0 && status < 500) {
      return {
        state: status < 400 ? "healthy" : "degraded",
        detail: `OpenCode answered /health with HTTP ${status} at ${base}.`,
        checkedAt,
        latencyMs,
        contacted: true,
      };
    }
    return {
      state: "unavailable",
      detail: `OpenCode is configured at ${base} but answered HTTP ${status}.`,
      checkedAt,
      latencyMs,
      contacted: true,
    };
  } catch (error) {
    return {
      state: "unavailable",
      detail: `OpenCode is configured at ${base} but unreachable: ${error instanceof Error ? error.message : String(error)}`,
      checkedAt,
      contacted: true,
    };
  }
}

export interface OpenCodeTaskInput {
  objective: string;
  /** Workspace id the work belongs to. Recorded; OpenCode runs in its own directory. */
  workspace?: string;
  checks?: string[];
}

export interface OpenCodeTaskResult {
  ok: boolean;
  state: AdapterHealth["state"];
  detail: string;
  summary: string;
  changedFiles: string[];
  commands: Array<{ command: string; exitCode: number; output: string }>;
  artifacts: Array<{ kind: "log" | "report"; ref: string; label: string }>;
  /** True only when a live OpenCode server actually produced the answer. */
  contacted: boolean;
  sessionId?: string;
}

function emptyResult(detail: string, state: AdapterHealth["state"]): OpenCodeTaskResult {
  return {
    ok: false,
    state,
    detail,
    summary: detail,
    changedFiles: [],
    commands: [],
    artifacts: [],
    contacted: false,
  };
}

/**
 * Dispatch one objective to OpenCode.
 *
 * Returns a result for every outcome — including "nothing is configured".
 * It never falls back to another engine: a caller that asked for OpenCode
 * gets OpenCode or a reason.
 */
export async function runOpenCodeTask(input: OpenCodeTaskInput): Promise<OpenCodeTaskResult> {
  const base = baseUrl();
  if (!base) {
    return emptyResult(
      "OPENCODE_BASE_URL is unset — OpenCode is not configured, so nothing was dispatched.",
      "not_configured",
    );
  }

  const objective = input.objective.trim();
  if (!objective) return emptyResult("objective is required", "not_configured");

  try {
    const session = await requestJson(
      `${base}/session`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ title: `LÉLU: ${objective.slice(0, 60)}` }),
      },
      DEFAULT_TIMEOUT_MS,
    );
    const sessionId = typeof session.body.id === "string" ? session.body.id : null;
    if (!sessionId) {
      return emptyResult(
        `OpenCode did not return a session id (HTTP ${session.status}); nothing was dispatched.`,
        session.status >= 500 ? "unavailable" : "degraded",
      );
    }

    const message = await requestJson(
      `${base}/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: objective }] }),
      },
      DISPATCH_TIMEOUT_MS,
    );

    const parts = Array.isArray(message.body.parts) ? (message.body.parts as Array<Record<string, unknown>>) : [];
    const text = parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join("\n")
      .trim();

    const ok = message.status > 0 && message.status < 400;
    return {
      ok,
      state: ok ? "healthy" : message.status >= 500 ? "unavailable" : "degraded",
      detail: ok
        ? `OpenCode session ${sessionId} answered in ${message.latencyMs} ms.`
        : `OpenCode session ${sessionId} answered HTTP ${message.status}.`,
      summary: text || (ok ? "OpenCode answered with no text parts." : `HTTP ${message.status}`),
      // OpenCode's message response does not report a diff or command log
      // in this shape. Nothing is invented to fill them in: verification
      // therefore stays false until a real diff is read from the workspace.
      changedFiles: [],
      commands: [],
      artifacts: [{ kind: "log", ref: `opencode:session:${sessionId}`, label: `OpenCode session ${sessionId}` }],
      contacted: true,
      sessionId,
    };
  } catch (error) {
    return emptyResult(
      `OpenCode dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      "unavailable",
    );
  }
}

/** Test hook: is a base URL configured at all? */
export function openCodeConfigured(): boolean {
  return baseUrl() !== null;
}
