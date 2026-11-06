/**
 * ==========================================================
 * LÉLU — INTEGRATION API (server middleware)
 *
 * The one server surface for the intelligence integrations:
 *
 *   GET  /api/integration/status   → what each integration really is
 *   POST /api/integration/policy   → a REAL OPA decision
 *   POST /api/integration/scan     → REAL gitleaks/trivy/semgrep runs
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
import { evaluatePolicy, type PolicyInput } from "../src/core/security/policy.ts";

export interface IntegrationApiOptions {
  workspaceRoot: string;
  /** Runtime label reported by /status. */
  runtime: string;
  /** Shared token gate (same variable the engineering API uses). */
  token?: string;
  /** Allowed origins for cross-origin POSTs; empty = same-origin only. */
  allowedOrigins?: string[];
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

function authorized(request: IncomingMessage, options: IntegrationApiOptions): { ok: boolean; status: number; reason: string } {
  if (options.token) {
    const presented = request.headers["x-lelu-token"];
    if (typeof presented !== "string" || presented !== options.token) {
      return { ok: false, status: 401, reason: "LELU_ENGINEER_TOKEN is configured; x-lelu-token is required." };
    }
  }
  return { ok: true, status: 200, reason: "ok" };
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
    const binaries = {
      gitleaks: [process.env.LELU_GITLEAKS_BINARY, join(options.workspaceRoot, ".tools", "gitleaks"), "gitleaks"]
        .filter((candidate): candidate is string => typeof candidate === "string")
        .some((candidate) => candidate.includes("/") && existsSync(candidate)),
      trivy: [process.env.LELU_TRIVY_BINARY, join(options.workspaceRoot, ".tools", "trivy"), "trivy"]
        .filter((candidate): candidate is string => typeof candidate === "string")
        .some((candidate) => candidate.includes("/") && existsSync(candidate)),
      semgrep: [process.env.LELU_SEMGREP_BINARY, join(options.workspaceRoot, ".tools", "semgrep"), "semgrep"]
        .filter((candidate): candidate is string => typeof candidate === "string")
        .some((candidate) => candidate.includes("/") && existsSync(candidate)),
    };
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
    const evaluated = await evaluateWithOpa(input, options.workspaceRoot);
    const reference = evaluatePolicy(input);
    sendJson(response, 200, {
      ok: true,
      decision: evaluated.decision,
      engine: evaluated.fromOpa ? "opa" : "reference",
      detail: evaluated.detail,
      durationMs: evaluated.durationMs,
      // The reference answer is returned beside it so a divergence is
      // visible in production, not only in the test suite.
      reference: { allowed: reference.allowed, requiresApproval: reference.requiresApproval, rules: reference.rules },
      agrees: reference.allowed === evaluated.decision.allowed,
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
    const report = await runSecurityGate({
      target: target.path,
      workspaceRoot: options.workspaceRoot,
      history: body.history === true,
      ...(requested && requested.length > 0 ? { scanners: requested } : {}),
      ...(typeof body.failAt === "string" ? { failAt: body.failAt as "critical" | "high" | "medium" | "low" } : {}),
    });
    sendJson(response, 200, { ok: true, report });
    return true;
  }

  return false;
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
    // Connect-style servers strip the mount prefix before invoking the
    // handler, so a request mounted at /api/integration arrives as
    // "/status". Restore the full route so one implementation serves both
    // the unstripped (Vite, `use(fn)`) and stripped (mounted) forms.
    const route = raw.startsWith("/api/integration")
      ? raw
      : `/api/integration${raw.startsWith("/") ? raw : `/${raw}`}`;
    if (!route.startsWith("/api/integration/")) {
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
