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

test("the voice agent's token opens exactly its two routes, nothing else", async () => {
  const s = await serve({ LELU_ACCESS_PASSWORD: "pass", LELU_VOICE_AGENT_TOKEN: "agent-token-123" });
  try {
    const post = (path: string, token?: string) =>
      fetch(`${s.base}${path}`, { method: "POST", headers: token ? { "X-Lelu-Agent-Token": token } : {}, body: "{}" });
    assert.equal((await post("/api/voice/vox/speech", "agent-token-123")).status, 200);
    assert.equal((await post("/api/model/groq/audio/transcriptions", "agent-token-123")).status, 200);
    assert.equal((await post("/api/voice/vox/speech", "wrong")).status, 401, "wrong token");
    assert.equal((await post("/api/voice/vox/speech")).status, 401, "no token");
    assert.equal((await post("/api/model/groq/chat/completions", "agent-token-123")).status, 401, "chat is not the agent's");
    assert.equal((await post("/api/livekit/token", "agent-token-123")).status, 401, "nor is the token endpoint");
    const get = await fetch(`${s.base}/api/voice/vox/speech`, { headers: { "X-Lelu-Agent-Token": "agent-token-123" } });
    assert.equal(get.status, 401, "POST only");
  } finally {
    await s.close();
  }
});

test("without LELU_VOICE_AGENT_TOKEN configured, no agent header opens anything", async () => {
  const s = await serve({ LELU_ACCESS_PASSWORD: "pass" });
  try {
    const r = await fetch(`${s.base}/api/voice/vox/speech`, { method: "POST", headers: { "X-Lelu-Agent-Token": "" }, body: "{}" });
    assert.equal(r.status, 401);
  } finally {
    await s.close();
  }
});

/* -------- Mission 3.7.3: email + password (Supabase) replaces the passphrase -------- */

const OWNER = "owner@example.com";
const RIGHT = "right-password-123";

/** A stand-in for Supabase's /auth/v1/token?grant_type=password. */
async function fakeSupabase() {
  const calls: Array<{ apikey: string | undefined; body: Record<string, string> }> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ apikey: req.headers.apikey as string | undefined, body });
      res.setHeader("Content-Type", "application/json");
      if (req.url !== "/auth/v1/token?grant_type=password") { res.statusCode = 404; res.end("{}"); return; }
      const known = [OWNER, "other@example.com"];
      if (known.includes(body.email) && body.password === RIGHT) {
        res.end(JSON.stringify({ access_token: "AT-test", token_type: "bearer", expires_in: 3600, expires_at: 1_900_000_000, refresh_token: "RT-test", user: { id: "u1", email: body.email } }));
      } else {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const signIn = (base: string, email: string, password: string, ip = "10.0.0.9") =>
  fetch(`${base}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": ip },
    body: new URLSearchParams({ email, password }).toString(),
  });

test("email + password: the first screen is Email, Password, Show and Sign In — nothing else", async () => {
  const sb = await fakeSupabase();
  const s = await serve({ LELU_ACCESS_PASSWORD: "old passphrase", LELU_SESSION_SECRET: "k", LELU_ACCESS_EMAILS: OWNER, VITE_SUPABASE_URL: sb.url, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
  try {
    const html = await (await fetch(`${s.base}/auth/login`)).text();
    assert.match(html, /type="email" name="email"/);
    assert.match(html, /type="password" name="password"/);
    assert.match(html, />Show</);
    assert.match(html, /<button type="submit">Sign In<\/button>/);
    assert.doesNotMatch(html, /Passphrase|one-time|code|magic|sign-in link|Enter<\/button>/i);
    assert.equal((html.match(/<input/g) ?? []).length, 2, "exactly two inputs");
    assert.equal((await fetch(`${s.base}/`, { redirect: "manual" })).status, 303, "still nothing without a session");
    assert.match(s.logs.join("\n"), /passphrase is retired/);
  } finally {
    await s.close(); await sb.close();
  }
});

test("email + password: the right password signs in (gate cookie + the app's Supabase session); the old passphrase does not", async () => {
  const sb = await fakeSupabase();
  const s = await serve({ LELU_ACCESS_PASSWORD: "old passphrase", LELU_SESSION_SECRET: "k", LELU_ACCESS_EMAILS: `${OWNER}`, VITE_SUPABASE_URL: sb.url, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
  try {
    const ok = await signIn(s.base, " Owner@Example.com ", RIGHT);
    assert.equal(ok.status, 200);
    assert.equal(sb.calls.at(-1)?.apikey, "sb_publishable_test", "the publishable key, never a secret one");
    assert.equal(sb.calls.at(-1)?.body.email, OWNER, "the address is normalised");
    const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(cookie, /^lelu_session=/);
    const page = await ok.text();
    assert.match(page, /localStorage\.setItem\("sb-127-auth-token"/, "the app's own session key");
    assert.match(page, /RT-test/);
    assert.match(page, /location\.replace\("\/"\)/);
    assert.ok(!page.includes(RIGHT), "the password is never echoed");
    assert.equal((await fetch(`${s.base}/api/model/status`, { headers: { cookie } })).status, 200, "the session opens LÉLU");

    const pass = await fetch(`${s.base}/auth/login`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "password=old+passphrase" });
    assert.notEqual(pass.status, 303);
    assert.equal(pass.headers.get("set-cookie"), null, "the passphrase no longer opens anything");

    const out = await fetch(`${s.base}/auth/logout`, { headers: { cookie } });
    assert.match(out.headers.get("set-cookie") ?? "", /lelu_session=; .*Max-Age=0/);
    assert.match(await out.text(), /localStorage\.removeItem\("sb-127-auth-token"\)/, "logout also ends the app's session");
  } finally {
    await s.close(); await sb.close();
  }
});

test("email + password: a wrong password, an unlisted account and a malformed email are refused with a plain message", async () => {
  const sb = await fakeSupabase();
  const s = await serve({ LELU_SESSION_SECRET: "k", LELU_ACCESS_EMAILS: OWNER, VITE_SUPABASE_URL: sb.url, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
  try {
    const wrong = await signIn(s.base, OWNER, "nope", "10.1.0.1");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);
    const w = await wrong.text();
    assert.match(w, /That email and password don&#39;t match\./);
    assert.match(w, /value="owner@example\.com"/, "the email stays filled in");
    assert.ok(!w.includes("nope"), "the password is never echoed");

    const other = await signIn(s.base, "other@example.com", RIGHT, "10.1.0.2");
    assert.equal(other.status, 403, "a real account that is not allowed in");
    assert.equal(other.headers.get("set-cookie"), null);

    const bad = await signIn(s.base, "not-an-email", RIGHT, "10.1.0.3");
    assert.equal(bad.status, 400);
    assert.equal(sb.calls.filter((c) => c.body.email === "not-an-email").length, 0, "never sent to Supabase");
  } finally {
    await s.close(); await sb.close();
  }
});

test("email + password stays OFF until LELU_ACCESS_EMAILS is set: deploying the code cannot lock anyone out", async () => {
  const s = await serve({ LELU_ACCESS_PASSWORD: "correct horse", LELU_SESSION_SECRET: "k", VITE_SUPABASE_URL: "http://127.0.0.1:9", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
  try {
    assert.match(await (await fetch(`${s.base}/auth/login`)).text(), /Passphrase/);
    assert.equal((await login(s.base, "correct horse")).status, 303);
  } finally {
    await s.close();
  }
});
