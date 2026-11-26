/**
 * ==========================================================
 * LÉLU — OWNER ACCESS GATE (production server only)
 *
 * On a public VPS every API this server mounts is reachable by
 * anyone who can reach the port: the model broker spends the
 * owner's provider credit, /api/github relays the owner's
 * token, /api/engineer runs whitelisted commands in the
 * workspace, /api/forge spends Meshy credits. The origin guard
 * stops OTHER WEBSITES driving them from a visitor's browser;
 * it does not stop curl. This gate does.
 *
 *   LELU_ACCESS_PASSWORD   the owner's passphrase (required for
 *                          a public deployment)
 *   LELU_SESSION_SECRET    HMAC key for session cookies; set it so
 *                          sessions survive restarts (otherwise a
 *                          random key is generated per process)
 *   LELU_SESSION_DAYS      cookie lifetime, default 30
 *
 * One passphrase → a signed, HttpOnly, SameSite=Lax session
 * cookie (Secure behind HTTPS). iPhone Safari keeps it, so the
 * owner logs in once per device. Everything — the app shell,
 * assets and every /api route — requires the session, except
 * the login page itself, /healthz and the PWA icons/manifest.
 * Login attempts are rate-limited per address and compared in
 * constant time. Without LELU_ACCESS_PASSWORD the gate is open
 * and says so loudly at startup.
 * ==========================================================
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type EnvReader = (name: string) => string | undefined;

const COOKIE = "lelu_session";
const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/logout",
  "/healthz",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
]);

export interface AccessGate {
  enabled: boolean;
  /** Connect-style middleware; call first. */
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  /** Exposed for tests. */
  issue(now?: number): string;
  verify(cookieValue: string | undefined, now?: number): boolean;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Per-process salt for the constant-time comparison below.
 *
 * It was a hard-coded string, which Semgrep rightly reports as a
 * hard-coded HMAC key. It was never key material protecting a
 * secret (both sides are digested, then compared in constant
 * time), but a random salt is strictly better and removes the
 * finding instead of arguing with it: an attacker cannot precompute
 * digests, and the value dies with the process.
 */
const COMPARE_SALT = randomBytes(32);

function sameSecret(a: string, b: string): boolean {
  const ha = createHmac("sha256", COMPARE_SALT).update(a).digest();
  const hb = createHmac("sha256", COMPARE_SALT).update(b).digest();
  return timingSafeEqual(ha, hb);
}

function clientAddress(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

function isHttps(req: IncomingMessage): boolean {
  return req.headers["x-forwarded-proto"] === "https" || Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

function readForm(req: IncomingMessage, limit = 4096): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > limit) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
    req.on("error", reject);
  });
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Email + password sign-in (Supabase password auth). Nothing else on the page. */
const EMAIL_LOGIN_HTML = (message: string, email = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>LÉLU</title>
<style>
  html,body{margin:0;height:100%;background:#07050d;color:#f5e9ff;font:16px system-ui,-apple-system,sans-serif}
  main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
  form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px}
  h1{font-weight:600;letter-spacing:.3em;text-align:center;margin:0 0 8px}
  input{font-size:17px;padding:14px 16px;border-radius:14px;border:1px solid #f0abfc55;background:#120c1f;color:inherit;width:100%;box-sizing:border-box}
  .pw{position:relative}
  .pw input{padding-right:72px}
  .pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:14px;padding:8px 10px;background:transparent;color:#f0abfc;border:0;font-weight:600}
  button[type=submit]{font-size:17px;padding:14px;border-radius:14px;border:0;background:#c084fc;color:#120c1f;font-weight:600}
  p{min-height:1.2em;margin:0;text-align:center;color:#fda4af;font-size:14px}
</style></head>
<body><main><form method="post" action="/auth/login">
  <h1>LÉLU</h1>
  <input type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="none" placeholder="Email" value="${esc(email)}" ${email ? "" : "autofocus"} required>
  <div class="pw"><input type="password" name="password" id="pw" autocomplete="current-password" placeholder="Password" ${email ? "autofocus" : ""} required>
  <button type="button" id="toggle" aria-label="Show password" aria-pressed="false">Show</button></div>
  <button type="submit">Sign In</button>
  <p role="alert">${esc(message)}</p>
</form></main>
<script>
  var t=document.getElementById("toggle"),p=document.getElementById("pw");
  t.addEventListener("click",function(){var show=p.type==="password";p.type=show?"text":"password";t.textContent=show?"Hide":"Show";t.setAttribute("aria-pressed",String(show));t.setAttribute("aria-label",show?"Hide password":"Show password");p.focus();});
</script></body></html>`;

/**
 * After a successful sign-in: hand the Supabase session to the app (the same
 * storage key and shape supabase-js uses, so the app opens signed in), then go in.
 */
const SIGNED_IN_HTML = (storageKey: string, session: unknown) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LÉLU</title></head><body>
<script>
  try { localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session)).replace(/</g, "\\u003c")}); } catch (e) {}
  location.replace("/");
</script></body></html>`;

const LOGIN_HTML = (message: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>LÉLU</title>
<style>
  html,body{margin:0;height:100%;background:#07050d;color:#f5e9ff;font:16px system-ui,-apple-system,sans-serif}
  main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
  form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px}
  h1{font-weight:600;letter-spacing:.3em;text-align:center;margin:0 0 8px}
  input{font-size:17px;padding:14px 16px;border-radius:14px;border:1px solid #f0abfc55;background:#120c1f;color:inherit}
  button{font-size:17px;padding:14px;border-radius:14px;border:0;background:#c084fc;color:#120c1f;font-weight:600}
  p{min-height:1.2em;margin:0;text-align:center;color:#fda4af;font-size:14px}
</style></head>
<body><main><form method="post" action="/auth/login">
  <h1>LÉLU</h1>
  <input type="password" name="password" autocomplete="current-password" placeholder="Passphrase" autofocus required>
  <button type="submit">Enter</button>
  <p>${message}</p>
</form></main></body></html>`;

export function createAccessGate(readEnv: EnvReader, log: (line: string) => void = console.log): AccessGate {
  const password = readEnv("LELU_ACCESS_PASSWORD") ?? "";
  // Email + password (Supabase) replaces the passphrase as soon as the owner
  // names who may enter. Unset, the passphrase gate stays exactly as it was,
  // so deploying this code can never lock anyone out.
  const allowed = new Set(
    (readEnv("LELU_ACCESS_EMAILS") ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  const firstSet = (names: string[]) => names.map((n) => (readEnv(n) ?? "").trim()).find(Boolean) ?? "";
  const supabaseUrl = firstSet(["VITE_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/+$/, "");
  const supabaseKey = firstSet(["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  const emailMode = allowed.size > 0 && Boolean(supabaseUrl) && Boolean(supabaseKey);
  const enabled = emailMode || password.length > 0;
  let storageKey = "sb-auth-token";
  try { storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`; } catch { /* email mode off */ }
  if (allowed.size > 0 && !emailMode) log("[LÉLU access] LELU_ACCESS_EMAILS is set but Supabase URL/publishable key are not — email sign-in is OFF.");
  if (emailMode) log(`[LÉLU access] email + password sign-in for ${allowed.size} allowed address(es); the passphrase is retired.`);

  /** Supabase password sign-in, server side. Returns the session, or a message safe to show. */
  const passwordSignIn = async (email: string, pass: string): Promise<{ session?: Record<string, unknown>; error?: string }> => {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && typeof data.access_token === "string") {
        if (typeof data.expires_at !== "number" && typeof data.expires_in === "number") data.expires_at = Math.floor(Date.now() / 1000) + data.expires_in;
        return { session: data };
      }
      if (res.status === 400 || res.status === 401) return { error: "That email and password don't match." };
      if (res.status === 429) return { error: "Too many attempts. Wait a minute." };
      return { error: "Sign-in is unavailable right now. Try again shortly." };
    } catch {
      return { error: "Sign-in is unavailable right now. Try again shortly." };
    }
  };
  const secret = readEnv("LELU_SESSION_SECRET") || randomBytes(32).toString("hex");
  const days = Math.max(1, Math.min(365, Number(readEnv("LELU_SESSION_DAYS") ?? 30) || 30));
  const attempts = new Map<string, number[]>();

  if (!enabled) {
    log("[LÉLU access] WARNING: LELU_ACCESS_PASSWORD is not set — every page and API is open to anyone who can reach this port.");
  } else if (!readEnv("LELU_SESSION_SECRET")) {
    log("[LÉLU access] LELU_SESSION_SECRET is not set — sessions will not survive a restart.");
  }

  // The LiveKit voice agent (services/livekit-agent) is a server process with
  // no browser session. It may reach EXACTLY the two routes it needs —
  // transcription through the broker and speech through the VoxCPM2 route —
  // when it presents LELU_VOICE_AGENT_TOKEN. Nothing else is opened by it.
  const agentToken = (readEnv("LELU_VOICE_AGENT_TOKEN") ?? "").trim();
  const AGENT_ROUTES = new Set(["/api/model/groq/audio/transcriptions", "/api/voice/vox/speech"]);
  const voiceAgentAllowed = (req: IncomingMessage, url: string): boolean => {
    if (!agentToken || req.method !== "POST" || !AGENT_ROUTES.has(url)) return false;
    const presented = req.headers["x-lelu-agent-token"];
    return typeof presented === "string" && sameSecret(presented, agentToken);
  };

  const sign = (expiry: number) => createHmac("sha256", secret).update(`lelu:${expiry}`).digest("base64url");

  const gate: AccessGate = {
    enabled,
    issue(now = Date.now()) {
      const expiry = now + days * 86_400_000;
      return `${expiry}.${sign(expiry)}`;
    },
    verify(value, now = Date.now()) {
      if (!value) return false;
      const [exp, mac] = value.split(".");
      const expiry = Number(exp);
      if (!Number.isFinite(expiry) || expiry < now || !mac) return false;
      return sameSecret(mac, sign(expiry));
    },
    handle(req, res, next) {
      if (!enabled) return next();
      const url = (req.url ?? "/").split("?")[0];
      const method = (req.method ?? "GET").toUpperCase();

      if (url === "/auth/login" && method === "POST") {
        const who = clientAddress(req);
        const recent = (attempts.get(who) ?? []).filter((t) => Date.now() - t < 60_000);
        if (recent.length >= 5) {
          res.statusCode = 429;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(emailMode ? EMAIL_LOGIN_HTML("Too many attempts. Wait a minute.") : LOGIN_HTML("Too many attempts. Wait a minute."));
          return;
        }
        if (emailMode) {
          readForm(req)
            .then(async (form) => {
              const email = (form.email ?? "").trim().toLowerCase();
              const fail = (status: number, message: string) => {
                attempts.set(who, [...recent, Date.now()]);
                log(`[LÉLU access] failed sign-in from ${who}`);
                res.statusCode = status;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.setHeader("Cache-Control", "no-store");
                res.end(EMAIL_LOGIN_HTML(message, email));
              };
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !form.password) return fail(400, "Enter your email and password.");
              const result = await passwordSignIn(email, form.password);
              if (!result.session) return fail(401, result.error ?? "That email and password don't match.");
              const user = result.session.user as { email?: string } | undefined;
              if (!allowed.has(email) || (user?.email ?? "").toLowerCase() !== email) return fail(403, "This account does not have access to LÉLU.");
              attempts.delete(who);
              const secure = isHttps(req) ? "; Secure" : "";
              res.statusCode = 200;
              res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(gate.issue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86_400}${secure}`);
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.end(SIGNED_IN_HTML(storageKey, result.session));
            })
            .catch(() => {
              res.statusCode = 400;
              res.end();
            });
          return;
        }
        readForm(req)
          .then((form) => {
            if (form.password && sameSecret(form.password, password)) {
              attempts.delete(who);
              const secure = isHttps(req) ? "; Secure" : "";
              res.statusCode = 303;
              res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(gate.issue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86_400}${secure}`);
              res.setHeader("Location", "/");
              res.end();
              return;
            }
            attempts.set(who, [...recent, Date.now()]);
            log(`[LÉLU access] failed login from ${who}`);
            res.statusCode = 401;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(LOGIN_HTML("That passphrase is not right."));
          })
          .catch(() => {
            res.statusCode = 400;
            res.end();
          });
        return;
      }
      if (url === "/auth/logout") {
        res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
        if (emailMode) {
          // Also end the app's Supabase session in this browser.
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(`<!doctype html><meta charset="utf-8"><script>try{localStorage.removeItem(${JSON.stringify(storageKey)})}catch(e){}location.replace("/auth/login")</script>`);
          return;
        }
        res.statusCode = 303;
        res.setHeader("Location", "/auth/login");
        res.end();
        return;
      }
      if (url === "/auth/login") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(emailMode ? EMAIL_LOGIN_HTML("") : LOGIN_HTML(""));
        return;
      }
      if (PUBLIC_PATHS.has(url)) return next();
      if (gate.verify(parseCookies(req.headers.cookie)[COOKIE])) return next();
      if (voiceAgentAllowed(req, url)) return next();

      if (url.startsWith("/api/")) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Sign in to LÉLU first.", login: "/auth/login" }));
        return;
      }
      res.statusCode = 303;
      res.setHeader("Location", "/auth/login");
      res.setHeader("Cache-Control", "no-store");
      res.end();
    },
  };
  return gate;
}
