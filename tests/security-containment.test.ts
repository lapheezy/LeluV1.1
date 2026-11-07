/**
 * ==========================================================
 * LÉLU — SECURITY CONTAINMENT
 *
 * CATEGORY: integration. Real HTTP over real sockets against a local
 * fixture server. The fixture stands in for a PUBLIC host: a test
 * resolver answers a public address and the dialler connects that
 * address to the fixture — the address checks themselves are the
 * production code, unloosened. Identity is an injected verifier (the
 * real Supabase verification is exercised by
 * scripts/verify-supabase-test-project.mjs and the production-server
 * run in docs/audit).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { isBlockedAddress, isBlockedHostname, safeFetch, SafeFetchError, MAX_BYTES, type SafeFetchOptions } from "../plugins/safeFetch";
import { createGuard, type IdentityVerifier } from "../plugins/requestGuard";
import { createBrowseApi } from "../plugins/browseApi";
import { createIntegrationApi } from "../plugins/integrationApi";
import { createAiProxyApi } from "../plugins/aiProxyApi";

const PUBLIC_IP = "93.184.215.14";

/* ---------------- fixture "public" web server ---------------- */

let served = 0;
const fixture = http.createServer((req, res) => {
  const path = req.url ?? "/";
  if (path === "/ok") { res.setHeader("content-type", "text/html"); res.end("<title>Fine</title><p>public page</p>"); return; }
  const to = (location: string) => { res.statusCode = 302; res.setHeader("location", location); res.end(); };
  if (path === "/to-localhost") return to("http://127.0.0.1/secret");
  if (path === "/to-private4") return to("http://10.0.0.5/");
  if (path === "/to-metadata") return to("http://169.254.169.254/latest/meta-data/");
  if (path === "/to-private6") return to("http://[fd00::1]/");
  if (path === "/to-mapped6") return to("http://[::ffff:127.0.0.1]/");
  if (path === "/to-internal-name") return to("http://rebind.test/");
  if (path === "/to-ftp") return to("ftp://public.test/file");
  if (path === "/chain/1") return to("/chain/2");
  if (path === "/chain/2") return to("http://public.test/chain/3");
  if (path === "/chain/3") return to("/ok");
  if (path === "/loop-a") return to("/loop-b");
  if (path === "/loop-b") return to("/loop-a");
  if (path.startsWith("/deep/")) return to(`/deep/${Number(path.slice(6)) + 1}`);
  if (path === "/big") {
    res.setHeader("content-type", "text/plain");
    const chunk = Buffer.alloc(64 * 1024, 97);
    let sent = 0;
    const pump = () => {
      while (sent < 20 * 1024 * 1024) {
        sent += chunk.length;
        served = sent;
        if (!res.write(chunk)) { res.once("drain", pump); return; }
      }
      res.end();
    };
    res.on("close", () => { served = sent; });
    pump();
    return;
  }
  if (path === "/gzip-bomb") {
    res.setHeader("content-type", "text/plain");
    res.setHeader("content-encoding", "gzip");
    res.end(zlib.gzipSync(Buffer.alloc(60 * 1024 * 1024, 0)));
    return;
  }
  if (path === "/slow") { res.setHeader("content-type", "text/html"); res.write("<p>"); setTimeout(() => res.end("late</p>"), 5000).unref(); return; }
  if (path === "/binary") { res.setHeader("content-type", "image/png"); res.end(Buffer.alloc(100)); return; }
  if (path === "/broken-gzip") { res.setHeader("content-type", "text/plain"); res.setHeader("content-encoding", "gzip"); res.end("not gzip at all"); return; }
  res.statusCode = 404;
  res.end();
});

let port = 0;
test.before(async () => {
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  port = (fixture.address() as AddressInfo).port;
});
test.after(() => { fixture.closeAllConnections(); fixture.close(); });

const resolveCalls: string[] = [];
const opts = (extra: Partial<SafeFetchOptions> = {}): SafeFetchOptions => ({
  resolve: async (host) => {
    resolveCalls.push(host);
    if (host === "public.test") return [{ address: PUBLIC_IP, family: 4 }];
    if (host === "rebind.test") return [{ address: "169.254.169.254", family: 4 }];
    if (host === "mixed.test") return [{ address: PUBLIC_IP, family: 4 }, { address: "10.1.2.3", family: 4 }];
    if (host === "v6only.test") return [{ address: "fe80::1", family: 6 }];
    throw new Error("NXDOMAIN");
  },
  // Only the vetted public address is ever dialled, and it reaches the fixture.
  dial: (address) => {
    assert.equal(address, PUBLIC_IP, "only a checked public address is ever dialled");
    return { host: "127.0.0.1", port };
  },
  ...extra,
});
const failsWith = async (url: string, code: SafeFetchError["code"], extra?: Partial<SafeFetchOptions>) => {
  await assert.rejects(safeFetch(url, opts(extra)), (e: unknown) => {
    assert.ok(e instanceof SafeFetchError, String(e));
    assert.equal(e.code, code, `${url}: ${e.message}`);
    return true;
  });
};

/* ---------------- address classification ---------------- */

test("address classification: every internal range is refused, public addresses are not", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fd00::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:a00:1::1", "2001:db8::1"]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} must be blocked`);
  }
  for (const ip of ["93.184.215.14", "8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(ip), false, `${ip} is public`);
  }
  for (const name of ["localhost", "db.internal", "printer.local", "intranet", "x.localhost"]) assert.equal(isBlockedHostname(name), true, name);
});

/* ---------------- the fetch ---------------- */

test("a public page is fetched and read", async () => {
  const r = await safeFetch("http://public.test/ok", opts());
  assert.equal(r.status, 200);
  assert.match(r.body, /public page/);
  assert.equal(r.truncated, false);
});

test("redirects to localhost, private IPv4, cloud metadata, private and mapped IPv6 are refused", async () => {
  for (const p of ["/to-localhost", "/to-private4", "/to-metadata", "/to-private6", "/to-mapped6"]) await failsWith(`http://public.test${p}`, "blocked_address");
});

test("a redirect to a NAME that resolves to an internal address is refused", async () => {
  await failsWith("http://public.test/to-internal-name", "blocked_address");
});

test("a name with ANY internal address among its answers is refused (no picking the good one)", async () => {
  await failsWith("http://mixed.test/ok", "blocked_address");
  await failsWith("http://v6only.test/ok", "blocked_address");
});

test("each hop resolves once and the socket is pinned to the checked address", async () => {
  resolveCalls.length = 0;
  const r = await safeFetch("http://public.test/chain/1", opts());
  assert.equal(r.redirects.length, 3);
  assert.match(r.body, /public page/);
  // 4 hops (chain/1, chain/2, chain/3, ok): one resolution each, nothing else asked of DNS.
  assert.deepEqual(resolveCalls, ["public.test", "public.test", "public.test", "public.test"]);
});

test("redirect loops and excessive redirect depth are refused", async () => {
  await failsWith("http://public.test/loop-a", "redirect_loop");
  await failsWith("http://public.test/deep/0", "too_many_redirects");
});

test("an oversized body is cut off at 2 MB while streaming — the rest is never downloaded", async () => {
  const r = await safeFetch("http://public.test/big", opts());
  assert.equal(r.truncated, true);
  assert.equal(r.body.length, MAX_BYTES);
  await new Promise((done) => setTimeout(done, 300));
  assert.ok(served < 8 * 1024 * 1024, `the server wrote ${served} bytes of 20 MB before the reader stopped`);
});

test("a gzip bomb is capped on the decoded size", async () => {
  const r = await safeFetch("http://public.test/gzip-bomb", opts());
  assert.equal(r.truncated, true);
  assert.ok(r.body.length <= MAX_BYTES);
});

test("a slow page times out; malformed compression fails cleanly", async () => {
  await failsWith("http://public.test/slow", "timeout", { timeoutMs: 400 });
  await failsWith("http://public.test/broken-gzip", "network_error");
});

test("non-text content, unsupported protocols, odd ports, credentials and malformed URLs are refused", async () => {
  await failsWith("http://public.test/binary", "unsupported_content");
  await failsWith("ftp://public.test/x", "unsupported_protocol");
  await failsWith("file:///etc/passwd", "unsupported_protocol");
  await failsWith("http://public.test/to-ftp", "unsupported_protocol");
  await failsWith("http://public.test:22/", "port_not_allowed");
  await failsWith("http://user:pass@public.test/ok", "invalid_url");
  await failsWith("http://", "invalid_url");
  await failsWith("not a url", "invalid_url");
  await failsWith("http://127.0.0.1/", "blocked_address");
  await failsWith("http://localhost/", "blocked_address");
});

/* ---------------- identity on the routes ---------------- */

const TOKENS: Record<string, { ok: boolean; status: number; role?: string; id?: string; reason: string }> = {
  "user-token": { ok: true, status: 200, role: "user", id: "u1", reason: "verified" },
  "admin-token": { ok: true, status: 200, role: "admin", id: "a1", reason: "verified" },
  "expired-token": { ok: false, status: 401, reason: "Supabase rejected the session (HTTP 401)." },
};
const verify: IdentityVerifier = async (req) => {
  const raw = req.headers?.authorization;
  const token = typeof raw === "string" ? raw.replace(/^Bearer\s+/i, "") : "";
  if (!token) return { ok: false, status: 401, reason: "No Supabase access token was presented." };
  const t = TOKENS[token];
  if (!t) return { ok: false, status: 401, reason: "Supabase rejected the session (HTTP 403)." };
  return t.ok ? { ok: true, status: 200, identity: { userId: t.id!, email: `${t.id}@x`, role: t.role }, reason: t.reason } : { ok: false, status: t.status, reason: t.reason };
};

async function serve(mount: (use: (path: string, h: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) => void) => void) {
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  mount((p, h) => routes.push([p, h]));
  const server = http.createServer((req, res) => {
    const match = routes.find(([p]) => (req.url ?? "").startsWith(p));
    if (!match) { res.statusCode = 404; res.end(); return; }
    match[1](req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    call: async (path: string, token?: string, init: RequestInit = {}) => {
      const res = await fetch(base + path, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string> | undefined) } });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    close: () => { server.closeAllConnections(); server.close(); },
  };
}

test("browse relay: anonymous, invalid and expired sessions are refused; a signed-in user reads; internal targets stay blocked", async () => {
  const api = createBrowseApi({ guard: createGuard({ verify }), fetchOptions: opts() });
  const s = await serve((use) => api.attach({ use }));
  try {
    assert.equal((await s.call("/api/browse?url=http://public.test/ok")).status, 401, "anonymous");
    assert.equal((await s.call("/api/browse?url=http://public.test/ok", "garbage")).status, 401, "invalid token");
    assert.equal((await s.call("/api/browse?url=http://public.test/ok", "expired-token")).status, 401, "expired session");
    const ok = await s.call("/api/browse?url=http://public.test/ok", "user-token");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.title, "Fine");
    const blocked = await s.call(`/api/browse?url=${encodeURIComponent("http://public.test/to-metadata")}`, "user-token");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "blocked_address");
    assert.doesNotMatch(JSON.stringify(blocked.body), /169\.254/, "the refusal does not echo the internal target");
  } finally { s.close(); }
});

test("browse relay: a user is rate-limited", async () => {
  const api = createBrowseApi({ guard: createGuard({ verify }), fetchOptions: opts() });
  const s = await serve((use) => api.attach({ use }));
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 32; i += 1) statuses.push((await s.call("/api/browse?url=http://public.test/ok", "user-token")).status);
    assert.equal(statuses.filter((x) => x === 200).length, 30);
    assert.equal(statuses.at(-1), 429);
  } finally { s.close(); }
});

test("knowledge relay: anonymous callers cannot spend the server's provider keys", async () => {
  const api = createAiProxyApi(() => undefined, { guard: createGuard({ verify }) });
  const s = await serve((use) => api.attach({ use }));
  try {
    assert.equal((await s.call("/api/knowledge/relay?provider=news&path=/v2/everything")).status, 401);
    assert.notEqual((await s.call("/api/knowledge/relay?provider=news&path=/v2/everything", "user-token")).status, 401);
    assert.equal((await s.call("/api/knowledge/providers")).status, 200, "the booleans-only capability report stays public");
  } finally { s.close(); }
});

test("integration API: identity on every route, admin for scans and policy, no forged roles, rate-limited scans", async () => {
  const handler = createIntegrationApi({ workspaceRoot: process.cwd(), runtime: "test", guard: createGuard({ verify }) });
  const s = await serve((use) => use("/api/integration", handler as never));
  const post = (path: string, token?: string, headers: Record<string, string> = {}) => s.call(path, token, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ target: "plugins", scanners: [] }) });
  try {
    assert.equal((await s.call("/api/integration/status")).status, 401, "anonymous status");
    assert.equal((await s.call("/api/integration/traces")).status, 401, "anonymous traces");
    assert.equal((await post("/api/integration/scan")).status, 401, "anonymous scan — the Phase 0 finding");
    assert.equal((await post("/api/integration/scan", "garbage")).status, 401, "invalid token");
    assert.equal((await post("/api/integration/scan", "expired-token")).status, 401, "expired session");
    assert.equal((await post("/api/integration/scan", "user-token")).status, 403, "a standard user cannot scan");
    assert.equal((await post("/api/integration/scan", "user-token", { "x-lelu-role": "admin" })).status, 403, "a role claimed in a header is not a role");
    assert.equal((await post("/api/integration/policy", "user-token")).status, 403, "policy probing is admin-only");
    const status = await s.call("/api/integration/status", "user-token");
    assert.equal(status.status, 200, "a signed-in user may read status");
    assert.equal(status.body.workspaceRoot, undefined, "but not the server's filesystem path");
    const adminScans: number[] = [];
    for (let i = 0; i < 4; i += 1) adminScans.push((await post("/api/integration/scan", "admin-token")).status);
    assert.ok(adminScans.slice(0, 3).every((x) => x !== 401 && x !== 403), `the administrator is admitted: ${adminScans}`);
    assert.equal(adminScans[3], 429, "the fourth scan in ten minutes is rate-limited");
  } finally { s.close(); }
});

test("production server mounts the same guarded routes as development", () => {
  const server = readFileSync("server.ts", "utf8");
  assert.match(server, /createBrowseApi\(\)\.attach\(middlewares\)/, "page reader mounted");
  assert.match(server, /createAiProxyApi\(\(key\) => process\.env\[key\]\)\.attach\(middlewares\)/, "knowledge relay mounted");
  assert.match(server, /aiRelayGuard\.check\(req, "user", "github-models"/, "the GitHub Models relay requires a signed-in user");
  const browse = readFileSync("plugins/browseApi.ts", "utf8");
  assert.doesNotMatch(browse, /redirect:\s*"follow"/, "no automatic redirect following");
  assert.doesNotMatch(browse, /response\.text\(\)/, "no whole-body buffering");
});
