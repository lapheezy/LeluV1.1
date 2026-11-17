/**
 * ==========================================================
 * LÉLU — SUPABASE NETWORK GUARD (development validation only)
 *
 * The production Supabase project URL is compiled into the app
 * (core/config/supabasePublic.ts), so anything that boots
 * persistence in Node can reach the live project even with no
 * environment configured. Development validation must never do
 * that.
 *
 * Load with `--import ./tests/support/block-supabase.mjs`. Every
 * request to a hosted Supabase project (*.supabase.co,
 * *.supabase.in) through fetch, WebSocket, http or https is
 * refused before any byte leaves the process, the same way an
 * offline network would refuse it. Each refused attempt is counted
 * and, when LELU_SUPABASE_GUARD_LOG is set, appended to that file
 * as one JSON line (method + host + path; never headers or bodies).
 * ==========================================================
 */
import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const BLOCKED_SUFFIXES = [".supabase.co", ".supabase.in"];
const LOG = process.env.LELU_SUPABASE_GUARD_LOG;

globalThis.__leluSupabaseGuard = { blocked: 0 };

function hostOf(target) {
  try {
    if (typeof target === "string") return new URL(target).hostname;
    if (target instanceof URL) return target.hostname;
    if (target && typeof target.url === "string") return new URL(target.url).hostname;
    if (target && typeof target === "object") return String(target.hostname ?? target.host ?? "").split(":")[0];
  } catch {
    /* not a URL */
  }
  return "";
}

function isBlocked(host) {
  const h = String(host || "").toLowerCase();
  return BLOCKED_SUFFIXES.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix));
}

function record(kind, target, method) {
  globalThis.__leluSupabaseGuard.blocked += 1;
  if (!LOG) return;
  let path = "";
  try {
    path = new URL(typeof target === "string" ? target : target?.url ?? String(target)).pathname;
  } catch {
    path = typeof target === "object" ? String(target?.path ?? "") : "";
  }
  try {
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), kind, method: method ?? "GET", host: hostOf(target), path }) + "\n");
  } catch {
    /* logging must never break the guard */
  }
}

const blockedError = () => new TypeError("fetch failed: Supabase access is blocked in development validation");

if (typeof globalThis.fetch === "function") {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function guardedFetch(input, init) {
    if (isBlocked(hostOf(input))) {
      record("fetch", input, init?.method ?? input?.method);
      return Promise.reject(blockedError());
    }
    return realFetch(input, init);
  };
}

if (typeof globalThis.WebSocket === "function") {
  const RealWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class GuardedWebSocket extends RealWebSocket {
    constructor(url, protocols) {
      if (isBlocked(hostOf(String(url)))) {
        record("websocket", String(url));
        throw blockedError();
      }
      super(url, protocols);
    }
  };
}

for (const [name, mod] of [["http", http], ["https", https]]) {
  for (const fn of ["request", "get"]) {
    const real = mod[fn];
    mod[fn] = function guardedRequest(target, ...rest) {
      const host = hostOf(target) || hostOf(rest.find((arg) => arg && typeof arg === "object") ?? {});
      if (isBlocked(host)) {
        record(name, target, (typeof target === "object" && target?.method) || undefined);
        throw blockedError();
      }
      return real.call(this, target, ...rest);
    };
  }
}

process.on("exit", () => {
  if (globalThis.__leluSupabaseGuard.blocked > 0) {
    process.stderr.write(`[supabase-guard] refused ${globalThis.__leluSupabaseGuard.blocked} Supabase request(s)\n`);
  }
});
