/**
 * Passwordless email auth contract.
 *
 * These tests drive the same helper the browser uses, with a fake auth
 * object. They prove what is sent, what is shown on failure, and that no
 * callback token can escape through a diagnostic. They do not claim a real
 * Supabase email was delivered or clicked.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isBrowserSafeM145Key, unquoteEnvValue, validateM145Target } from "../scripts/m145-config.mjs";
import {
  authCallbackError,
  explainEmailAuthError,
  requestEmailLink,
  sanitizeAuthDetail,
  verifyEmailCode,
  type EmailAuthClient,
} from "../src/core/persistence/emailAuth";

type OtpRequest = { email: string; options?: { emailRedirectTo?: string; shouldCreateUser?: boolean } };
type OtpVerify = { email: string; token: string; type: "email" };

function fakeAuth(response: { error?: { message?: string } | null } = {}) {
  const requests: OtpRequest[] = [];
  const verifies: OtpVerify[] = [];
  const auth: EmailAuthClient = {
    async signInWithOtp(credentials) {
      requests.push(credentials);
      return { error: response.error ?? null };
    },
    async verifyOtp(params) {
      verifies.push(params);
      return { error: response.error ?? null };
    },
  };
  return { auth, requests, verifies };
}

test("requesting a sign-in link lower-cases the address and supplies a same-origin redirect", async () => {
  const { auth, requests } = fakeAuth();
  const result = await requestEmailLink(auth, "  Test.User@Example.COM ", "https://app.example/");
  assert.equal(result.error, null);
  assert.deepEqual(requests, [{
    email: "test.user@example.com",
    options: { shouldCreateUser: true, emailRedirectTo: "https://app.example/" },
  }]);
});

test("an invalid address never reaches Supabase", async () => {
  const { auth, requests } = fakeAuth();
  const result = await requestEmailLink(auth, "not-an-email");
  assert.match(result.error ?? "", /valid email/i);
  assert.equal(requests.length, 0);
});

test("a project with email sign-up disabled reports that, without echoing the address", async () => {
  const { auth } = fakeAuth({ error: { message: "Signups not allowed for otp for test@example.com" } });
  const result = await requestEmailLink(auth, "test@example.com");
  assert.match(result.error ?? "", /does not allow email sign-up/i);
  assert.ok(!(result.error ?? "").includes("test@example.com"));
});

test("rate limiting is a useful, non-secret message", async () => {
  const { auth } = fakeAuth({ error: { message: "For security purposes, you can only request this after 42 seconds." } });
  const result = await requestEmailLink(auth, "test@example.com");
  assert.match(result.error ?? "", /requested recently/i);
});

test("verifying a code trims it and uses the email OTP type", async () => {
  const { auth, verifies } = fakeAuth();
  const result = await verifyEmailCode(auth, "Test@Example.com", " 123 456 ");
  assert.equal(result.error, null);
  assert.deepEqual(verifies, [{ email: "test@example.com", token: "123456", type: "email" }]);
});

test("an expired or invalid code is reported as such", async () => {
  const { auth } = fakeAuth({ error: { message: "Token has expired or is invalid" } });
  const result = await verifyEmailCode(auth, "test@example.com", "000000");
  assert.match(result.error ?? "", /invalid or has expired/i);
  assert.ok(!(result.error ?? "").includes("000000"));
});

test("a cancelled callback is distinguished from an expired one", () => {
  assert.match(
    authCallbackError("#error=access_denied&error_description=User+cancelled") ?? "",
    /cancelled/i,
  );
  assert.match(
    authCallbackError("#error=server_error&error_description=Email+link+expired") ?? "",
    /invalid or has expired/i,
  );
});

test("a successful callback returns no error and never exposes its token", () => {
  const hash = "#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature&refresh_token=refresh-secret&type=magiclink";
  const message = authCallbackError(hash);
  assert.equal(message, null);
  assert.ok(!JSON.stringify(message).includes("eyJ"));
  assert.ok(!JSON.stringify(message).includes("refresh-secret"));
});

test("diagnostics redact a submitted address and token-shaped text", () => {
  const message = sanitizeAuthDetail(
    "failed for test@example.com with access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig and token=123456",
    "test@example.com",
  );
  assert.ok(!message.includes("test@example.com"));
  assert.ok(!message.includes("eyJhbGci"));
  assert.ok(!message.includes("123456"));
  assert.match(message, /\[redacted\]/);
});

test("the helper has no storage, logging or second client path", () => {
  const source = readFileSync("src/core/persistence/emailAuth.ts", "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|createClient|console\.(log|info|warn|error)/);
});

// Mission 3.7.3: the owner reversed the passwordless design. Every sign-in
// surface is email + password through signInWithPassword, with nothing else:
// no emailed link, no code entry.
test("the sign-in gate is email + password only", () => {
  const gate = readFileSync("src/app/scene/genesis/LeluSignInGate.tsx", "utf8");
  assert.match(gate, /signInWithEmail\(email, password\)/);
  assert.match(gate, /data-lelu-auth-email/);
  assert.match(gate, /data-lelu-auth-password/);
  assert.match(gate, /Show password/);
  assert.doesNotMatch(gate, /requestEmailSignIn|verifyEmailCode|one-time-code|Email me a sign-in link|Verify code/);
});

test("the settings surfaces sign in with email + password only", () => {
  const genesis = readFileSync("src/app/scene/genesis/GenesisSettingsPanel.tsx", "utf8");
  const og = readFileSync("src/og/components/core/panels/SettingsPanel.tsx", "utf8");
  assert.match(genesis, /signInWithEmail\(authEmail, authPassword\)/);
  assert.match(og, /signInWithPassword\(/);
  for (const source of [genesis, og]) {
    assert.match(source, /type=\{[a-zA-Z]+ \? "text" : "password"\}/);
    assert.doesNotMatch(source, /requestEmailSignIn|requestEmailLink|verifyEmailCode|one-time-code|Email me a sign-in link|Verify code/);
  }
});

test("requesting a link returns no session before the email is verified", async () => {
  const { auth } = fakeAuth();
  const result = await requestEmailLink(auth, "test@example.com");
  assert.deepEqual(Object.keys(result), ["error"]);
  assert.equal(result.error, null);
});

test("the persistent browser client restores the session from the callback URL", () => {
  const persistence = readFileSync("src/core/persistence/SupabasePersistence.ts", "utf8");
  assert.match(persistence, /detectSessionInUrl:\s*true/);
  assert.match(persistence, /persistSession:\s*true/);
});

test("runtime session material is gitignored, not tracked", () => {
  const ignore = readFileSync(".gitignore", "utf8");
  assert.match(ignore, /^\.lelu-runtime\/$/m);
  assert.match(ignore, /^\.env\.local$/m);
});

test("the two-profile harness creates a second independent context and cleans up", () => {
  const source = readFileSync("scripts/verify-m145-two-profile.mjs", "utf8");
  assert.match(source, /browser\.newContext\(\{ storageState/);
  assert.match(source, /localStorage/);
  assert.match(source, /finally\s*\{[\s\S]*browser\.close\(\)/);
});

test("the real-cloud guard requires explicit opt-in and refuses production or a mismatched ref", () => {
  assert.equal(validateM145Target({}).status, "BLOCKED");
  assert.equal(
    validateM145Target({
      allowReal: "1",
      url: "https://ugshflwlyakipeduifkd.supabase.co",
      projectRef: "ugshflwlyakipeduifkd",
    }).missing?.[0],
    "LELU_M145_SUPABASE_PUBLISHABLE_KEY",
  );
  assert.equal(
    validateM145Target({
      allowReal: "1",
      url: "https://ugshflwlyakipeduifkd.supabase.co",
      projectRef: "ugshflwlyakipeduifkd",
      publishableKey: "sb_publishable_test",
    }).ok,
    true,
  );
  const production = validateM145Target({
    allowReal: "1",
    url: "https://nrehsldbfxthspikaxvr.supabase.co",
    projectRef: "nrehsldbfxthspikaxvr",
    publishableKey: "sb_publishable_test",
  });
  assert.equal(production.ok, false);
  assert.equal(production.status, "FAIL");
  assert.ok(!(production.reason ?? "").includes("sb_publishable_test"));
});

test("the real-cloud guard refuses a secret/admin key and unwraps quoted env values", () => {
  const secret = "sb_secret_example_value_not_real";
  const rejected = validateM145Target({
    allowReal: "1",
    url: "https://ugshflwlyakipeduifkd.supabase.co",
    projectRef: "ugshflwlyakipeduifkd",
    publishableKey: secret,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, "FAIL");
  assert.ok(!(rejected.reason ?? "").includes(secret), "the reason must not echo the key");

  // A secret key bypasses RLS, so it cannot stand in for authenticated acceptance.
  assert.equal(isBrowserSafeM145Key(secret), false);
  assert.equal(isBrowserSafeM145Key("sbp_personal_access_token"), false);
  assert.equal(isBrowserSafeM145Key("sb_publishable_ok"), true);

  // The platform writes .env.local values quoted; Vite strips the quotes, and
  // the harness must do the same or every value arrives invalid.
  assert.equal(unquoteEnvValue('"sb_publishable_ok"'), "sb_publishable_ok");
  assert.equal(
    validateM145Target({
      allowReal: "1",
      url: "https://ugshflwlyakipeduifkd.supabase.co",
      projectRef: "ugshflwlyakipeduifkd",
      publishableKey: '"sb_publishable_ok"',
    }).ok,
    true,
  );

  // A production ref cannot pass even when the URL looks like the test project,
  // and the test ref cannot vouch for a production URL.
  const productionRef = validateM145Target({
    allowReal: "1",
    url: "https://ugshflwlyakipeduifkd.supabase.co",
    projectRef: "nrehsldbfxthspikaxvr",
    publishableKey: "sb_publishable_ok",
  });
  assert.equal(productionRef.ok, false);
  assert.equal(productionRef.status, "FAIL");
  const productionUrl = validateM145Target({
    allowReal: "1",
    url: "https://nrehsldbfxthspikaxvr.supabase.co",
    projectRef: "ugshflwlyakipeduifkd",
    publishableKey: "sb_publishable_ok",
  });
  assert.equal(productionUrl.ok, false);
  assert.equal(productionUrl.status, "FAIL");
});

test("both acceptance harnesses are passwordless and point at the test guard", () => {
  for (const path of ["scripts/verify-m145-real-cloud.ts", "scripts/verify-m145-two-profile.mjs"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /PASSWORD|signInWithPassword|input\[type="password"\]/);
    assert.match(source, /validateM145Target/);
    assert.match(source, /acquireEmailSession|data-lelu-auth-email/);
  }
  const helper = readFileSync("scripts/m145-browser-session.mjs", "utf8");
  assert.match(helper, /data-lelu-auth-email/);
});

test("the browser auth helper never writes a session to disk or logs it", () => {
  const source = readFileSync("scripts/m145-browser-session.mjs", "utf8");
  assert.doesNotMatch(source, /writeFile|appendFile|console\.(log|info|warn|error)/);
  assert.match(source, /localStorage\.getItem/);
});

test("the email-auth error mapping is shared by all three surfaces", () => {
  for (const path of [
    "src/app/scene/genesis/LeluSignInGate.tsx",
    "src/app/scene/genesis/GenesisSettingsPanel.tsx",
    "src/og/components/core/panels/SettingsPanel.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    // Directly, or through persistence.signInWithEmail, which maps with the shared helper.
    assert.ok(/emailAuth/.test(source) || /signInWithEmail\(/.test(source), `${path} must use the shared helper`);
  }
  assert.match(readFileSync("src/core/persistence/SupabasePersistence.ts", "utf8"), /explainEmailAuthError\(error\?\.message, normalizedEmail\)/);
});

test("a wrong password is reported plainly, without saying which half was wrong or echoing the address", async () => {
  const { explainEmailAuthError } = await import("../src/core/persistence/emailAuth");
  const msg = explainEmailAuthError("Invalid login credentials", "owner@example.com");
  assert.equal(msg, "That email and password don't match.");
  assert.ok(!String(msg).includes("owner@example.com"));
});
