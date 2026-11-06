/**
 * ==========================================================
 * LÉLU — SERVER REQUEST GUARD
 *
 * One gate for server routes that act on the caller's behalf
 * (browse relay, knowledge relay, integration API):
 *
 *   1. identity  — the Supabase session is verified BY SUPABASE
 *                  (plugins/engineerIdentity.verifyRequestIdentity);
 *                  this server never trusts a token it parsed itself;
 *   2. role      — "admin" only from app_metadata.lelu_role, which a
 *                  user cannot set on themselves (user_metadata can be
 *                  edited by the user and is never consulted);
 *   3. rate      — a fixed window per identity and route.
 *
 * Refusals carry a status and a reason that never includes a token,
 * a key or an environment value.
 * ==========================================================
 */

import { verifyRequestIdentity, type IdentityCheck } from "./engineerIdentity.ts";

export type Requirement = "user" | "admin";

export interface GuardRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export type GuardDecision =
  | { ok: true; userId: string; email: string | null; role: string | null }
  | { ok: false; status: number; reason: string; retryAfterSeconds?: number };

export type IdentityVerifier = (req: GuardRequest) => Promise<IdentityCheck>;

export interface RateLimit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

export interface Guard {
  check(req: GuardRequest, requirement: Requirement, bucket: string, limit: RateLimit): Promise<GuardDecision>;
}

export function createRateLimiter(now: () => number = () => Date.now()) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(key: string, limit: RateLimit): { ok: true } | { ok: false; retryAfterSeconds: number } {
      const t = now();
      const w = windows.get(key);
      if (!w || t - w.start >= limit.windowMs) {
        windows.set(key, { start: t, count: 1 });
        if (windows.size > 10_000) {
          // Bounded memory: drop expired windows.
          for (const [k, v] of windows) if (t - v.start >= limit.windowMs) windows.delete(k);
        }
        return { ok: true };
      }
      if (w.count >= limit.max) return { ok: false, retryAfterSeconds: Math.ceil((w.start + limit.windowMs - t) / 1000) };
      w.count += 1;
      return { ok: true };
    },
  };
}

export function createGuard(options: { verify?: IdentityVerifier; now?: () => number } = {}): Guard {
  const verify = options.verify ?? verifyRequestIdentity;
  const limiter = createRateLimiter(options.now);
  // Anonymous callers are refused before verification, but a flood of them
  // still costs a Supabase round trip each: cap them per remote address too.
  const anonymousLimit: RateLimit = { max: 60, windowMs: 60_000 };
  return {
    async check(req, requirement, bucket, limit) {
      const address = req.socket?.remoteAddress ?? "unknown";
      const pre = limiter.take(`addr:${address}`, anonymousLimit);
      if (!pre.ok) return { ok: false, status: 429, reason: "Too many requests; try again shortly.", retryAfterSeconds: pre.retryAfterSeconds };
      const identity = await verify(req);
      if (!identity.ok || !identity.identity) {
        return { ok: false, status: identity.status === 503 ? 503 : 401, reason: identity.reason };
      }
      const role = identity.identity.role ?? null;
      if (requirement === "admin" && role !== "admin") {
        return { ok: false, status: 403, reason: "This action needs the LÉLU administrator role (app_metadata.lelu_role = admin)." };
      }
      const taken = limiter.take(`${bucket}:${identity.identity.userId}`, limit);
      if (!taken.ok) return { ok: false, status: 429, reason: "Too many requests; try again shortly.", retryAfterSeconds: taken.retryAfterSeconds };
      return { ok: true, userId: identity.identity.userId, email: identity.identity.email, role };
    },
  };
}

/** Write a refusal the same way on every route. */
export function sendRefusal(
  res: { statusCode?: number; setHeader: (name: string, value: string) => void; end: (body: string) => void },
  decision: Extract<GuardDecision, { ok: false }>,
): void {
  res.statusCode = decision.status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (decision.retryAfterSeconds) res.setHeader("Retry-After", String(decision.retryAfterSeconds));
  res.end(JSON.stringify({ ok: false, error: decision.reason }));
}
