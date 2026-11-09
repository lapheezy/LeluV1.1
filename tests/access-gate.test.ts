/**
 * LÉLU — OWNER ACCESS GATE (plugins/accessGate.ts)
 *
 * On the public VPS nothing — app shell, assets, any /api route —
 * is served without the owner's session; the login page, /healthz
 * and the PWA icons are. Wrong passphrases are refused and rate
 * limited; sessions are signed and expire; without a passphrase
 * the gate is open (and says so).
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createAccessGate } from "../plugins/accessGate";

async function serve(env: Record<string, string>) {
  const logs: string[] = [];
  const gate = createAccessGate((k) => env[k], (l) => logs.push(l));
  const server = createServer((req, res) =>
    gate.handle(req, res, () => {
      res.statusCode = 200;
      res.end(`inner ${req.url}`);
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { gate, base, logs, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const login = (base: string, password: string, ip = "10.0.0.1") =>
  fetch(`${base}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": ip, "X-Forwarded-Proto": "https" },
    body: new URLSearchParams({ password }).toString(),
  });

test("without a passphrase the gate is open and warns", async () => {
  const s = await serve({});
  try {
    assert.equal(s.gate.enabled, false);
    assert.match(s.logs.join("\n"), /not set/);
    assert.equal((await fetch(`${s.base}/api/model/status`)).status, 200);
  } finally {
    await s.close();
  }
});

test("with a passphrase: nothing private without a session; login issues a working one", async () => {
  const s = await serve({ LELU_ACCESS_PASSWORD: "correct horse", LELU_SESSION_SECRET: "k" });
  try {
    const api = await fetch(`${s.base}/api/model/anthropic/messages`, { method: "POST" });
    assert.equal(api.status, 401, "APIs refuse without a session");
    const page = await fetch(`${s.base}/`, { redirect: "manual" });
    assert.equal(page.status, 303);
    assert.equal(page.headers.get("location"), "/auth/login");
    assert.equal((await fetch(`${s.base}/assets/index.js`, { redirect: "manual" })).status, 303, "the bundle itself is private");
    for (const open of ["/auth/login", "/healthz", "/apple-touch-icon.png", "/manifest.webmanifest"]) {
      assert.equal((await fetch(`${s.base}${open}`)).status, 200, `${open} is public`);
    }

    const bad = await login(s.base, "wrong");
    assert.equal(bad.status, 401);

    const ok = await login(s.base, "correct horse");
    assert.equal(ok.status, 303);
    const cookie = ok.headers.get("set-cookie") ?? "";
    assert.match(cookie, /lelu_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
    const session = cookie.split(";")[0];
    const inner = await fetch(`${s.base}/api/model/status`, { headers: { cookie: session } });
    assert.equal(inner.status, 200);
    assert.equal(await inner.text(), "inner /api/model/status");

    // A forged or expired cookie is refused.
    assert.equal((await fetch(`${s.base}/api/x`, { headers: { cookie: "lelu_session=9999999999999.forged" } })).status, 401);
    assert.equal(s.gate.verify(s.gate.issue(Date.now() - 31 * 86_400_000)), false, "expired");
    assert.equal(s.gate.verify(s.gate.issue()), true);
  } finally {
    await s.close();
  }
});

test("login attempts are rate limited per address", async () => {
  const s = await serve({ LELU_ACCESS_PASSWORD: "pw" });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await login(s.base, "nope", "10.9.9.9")).status, 401);
    assert.equal((await login(s.base, "pw", "10.9.9.9")).status, 429, "even the right passphrase waits after 5 failures");
    assert.equal((await login(s.base, "pw", "10.1.1.1")).status, 303, "other addresses are unaffected");
  } finally {
    await s.close();
  }
});
