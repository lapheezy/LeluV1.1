/**
 * ==========================================================
 * LÉLU — AUTHENTICATED SOURCE ACCESS
 *
 * CATEGORY: unit. The real AuthGate.
 *
 * Why this exists: §13 grants LÉLU a capability and then spends
 * most of its words on what she must never do with it — no
 * dictated passwords, no stored credentials or OTPs, no
 * bypassing access controls. Capability is easy to test and
 * restraint is easy to lose, so the restraints are what is
 * asserted hardest here.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthorizationQueue,
  assessAccess,
  isKnownGatedHost,
} from "../src/core/browser/AuthGate";
import type { BrowserPage } from "../src/core/browser/BrowserTool";

function page(overrides: Partial<BrowserPage>): BrowserPage {
  return {
    url: "https://example.com/thing",
    title: "",
    text: "",
    excerpt: "",
    status: "blocked",
    ...overrides,
  } as BrowserPage;
}

test("a readable page is simply readable", () => {
  const result = assessAccess(page({ status: "read", text: "Real article content. ".repeat(60) }));
  assert.equal(result.verdict, "readable");
});

test("401 and 403 are recognised as needing a sign-in, not as breakage", () => {
  for (const code of [401, 403]) {
    const result = assessAccess(page({ error: `The page responded with HTTP ${code}.` }));
    assert.equal(result.verdict, "auth-required", `HTTP ${code}`);
    assert.ok(result.signInUrl, "the user needs somewhere to go");
  }
});

test("a 200 that renders a sign-in wall is still a sign-in wall", () => {
  const result = assessAccess(page({
    status: "read",
    text: "Please sign in to continue reading this article.",
  }));
  assert.equal(result.verdict, "auth-required");
});

test("a JavaScript-rendered page is NOT reported as needing auth", () => {
  // Signing in would not help, and saying it would sends the user on an
  // errand that cannot succeed.
  const result = assessAccess(page({
    error: "The page returned no readable text — it likely renders with JavaScript.",
  }));
  assert.equal(result.verdict, "not-directly-readable");
  assert.equal(result.signInUrl, undefined, "no sign-in should be offered for this");
});

test("a missing page is unavailable, not gated", () => {
  const result = assessAccess(page({ error: "The page responded with HTTP 404." }));
  assert.equal(result.verdict, "unavailable");
});

test("known session-gated hosts are recognised", () => {
  assert.equal(isKnownGatedHost("https://chatgpt.com/share/abc"), true);
  assert.equal(isKnownGatedHost("https://docs.google.com/document/d/x"), true);
  assert.equal(isKnownGatedHost("https://en.wikipedia.org/wiki/Cat"), false);
});

test("the sign-in destination is the source's own origin, never somewhere LÉLU chose", () => {
  const result = assessAccess(page({
    url: "https://private.example.com/deep/path?x=1",
    error: "The page responded with HTTP 403.",
  }));
  assert.equal(result.signInUrl, "https://private.example.com");
  assert.ok(!result.signInUrl?.includes("deep/path"), "no deep link into a flow");
});

test("a parked request carries a URL and a reason — and nowhere to put a secret", () => {
  AuthorizationQueue.reset();
  const queue = AuthorizationQueue.getInstance();
  const entry = queue.request({
    verdict: "auth-required",
    url: "https://private.example.com/doc",
    reason: "needs sign-in",
    signInUrl: "https://private.example.com",
  });

  // The shape itself is the guarantee: if there is no field for a credential,
  // no code path can quietly start keeping one.
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["id", "reason", "requestedAt", "signInUrl", "url"],
    "a pending request must carry nothing but a URL, a reason and a timestamp",
  );
  for (const forbidden of ["password", "token", "otp", "code", "cookie", "session", "credential"]) {
    assert.ok(!(forbidden in entry), `PendingAccess must not carry "${forbidden}"`);
  }
  AuthorizationQueue.reset();
});

test("resuming an unknown request fails quietly", async () => {
  AuthorizationQueue.reset();
  const result = await AuthorizationQueue.getInstance().resume("never-existed");
  assert.equal(result.ok, false);
  AuthorizationQueue.reset();
});

test("a cancelled request stops being pending", () => {
  AuthorizationQueue.reset();
  const queue = AuthorizationQueue.getInstance();
  const entry = queue.request({ verdict: "auth-required", url: "https://x.example", reason: "r" });
  assert.equal(queue.list().length, 1);
  queue.cancel(entry.id);
  assert.equal(queue.list().length, 0);
  AuthorizationQueue.reset();
});
