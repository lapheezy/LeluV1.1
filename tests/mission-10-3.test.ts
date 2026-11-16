/**
 * Mission 10.3 — the pure parts of the three fixes:
 *   - the spatial navigator lifts clear of the chat composer,
 *   - Share Screen is shown only where getDisplayMedia exists (capability, not UA),
 *   - voice-turn failures are told apart and never spoken as answers.
 * The live behaviour is verified in a real browser by
 * scripts/verify-navigator-composer.cjs and scripts/verify-voice-reliability.cjs.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { composerLift, liftOverflowsTop } from "../src/app/scene/spatial/composerClearance";
import { explainScreenShareFailure, screenShareSupport } from "../src/core/perception/screenCapability";
import { classifyChainFailure, classifyProviderError, failureFromError, failureFromResponse } from "../src/core/voice/turnFailure";

/* ---- navigator ↔ composer ---- */

test("the measured defect: open groups over a centred desktop composer are lifted clear", () => {
  // From the 20-turn run screenshot (1440×900): groups 638..880, composer ~745..800.
  const nav = { top: 585, bottom: 880, left: 448, right: 1070 };
  const composer = { top: 745, bottom: 800, left: 426, right: 1014 };
  const lift = composerLift(nav, composer);
  assert.equal(lift, 880 - (745 - 8));
  assert.ok(nav.bottom - lift <= composer.top - 8, "after lifting, the navigator ends above the composer");
});

test("no lift when there is no composer, no horizontal overlap, or it already clears", () => {
  const nav = { top: 800, bottom: 880, left: 100, right: 400 };
  assert.equal(composerLift(nav, null), 0);
  assert.equal(composerLift(nav, { top: 820, bottom: 860, left: 500, right: 900 }), 0, "side by side");
  assert.equal(composerLift({ top: 600, bottom: 700, left: 100, right: 400 }, { top: 720, bottom: 760, left: 0, right: 500 }), 0, "already above");
  assert.equal(composerLift({ top: 800, bottom: 850, left: 100, right: 400 }, { top: 700, bottom: 780, left: 0, right: 500 }), 0, "entirely below");
  assert.equal(composerLift(nav, { top: 0, bottom: 0, left: 0, right: 0 }), 0, "hidden composer (zero rect)");
});

test("a lift that would leave the top of the screen is detected (groups collapse instead)", () => {
  assert.equal(liftOverflowsTop({ top: 120, bottom: 400, left: 0, right: 10 }, 200), true);
  assert.equal(liftOverflowsTop({ top: 500, bottom: 700, left: 0, right: 10 }, 200), false);
});

/* ---- Share Screen capability ---- */

test("Share Screen: supported only where getDisplayMedia is a function", () => {
  const desktop = { mediaDevices: { getDisplayMedia: () => undefined, getUserMedia: () => undefined } };
  const iosSafari = { mediaDevices: { getUserMedia: () => undefined } }; // WebKit on iOS: no getDisplayMedia
  assert.deepEqual(screenShareSupport(desktop, true), { supported: true });
  assert.deepEqual(screenShareSupport(iosSafari, true), { supported: false, reason: "no-display-media" });
  assert.deepEqual(screenShareSupport({}, true), { supported: false, reason: "no-media-devices" });
  assert.deepEqual(screenShareSupport(desktop, false), { supported: false, reason: "insecure-context" });
});

test("Share Screen: a refusal is explained as a refusal, distinct from a device failure", () => {
  const refused = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
  const unreadable = Object.assign(new Error("Could not start video source"), { name: "NotReadableError" });
  assert.match(explainScreenShareFailure(refused), /declined/);
  assert.match(explainScreenShareFailure(unreadable), /could not start/);
  assert.doesNotMatch(explainScreenShareFailure(unreadable), /declined/);
});

/* ---- voice-turn failures ---- */

test("the 20-turn run's errors classify correctly", () => {
  assert.equal(classifyProviderError("BodyStreamBuffer was aborted"), "provider-timeout");
  assert.equal(classifyProviderError("OpenRouter timed out after 30s"), "provider-timeout");
  assert.equal(classifyProviderError("Fireworks HTTP 412: Account is suspended"), "provider-unavailable");
  assert.equal(classifyProviderError("Groq failed 429: Rate limit reached"), "provider-unavailable");
  assert.equal(classifyProviderError("OpenRouter network error: Failed to fetch"), "network-failure");
  // The exact chain seen per turn: OpenRouter timeout, then quota/credit refusals.
  assert.equal(classifyChainFailure([
    "BodyStreamBuffer was aborted",
    "Fireworks HTTP 412: Account suspended",
    "Anthropic failed 400: Your credit balance is too low",
  ]), "provider-timeout");
  assert.equal(classifyChainFailure(["Failed to fetch", "NetworkError when attempting to fetch resource."]), "network-failure");
  assert.equal(classifyChainFailure(["Cerebras HTTP 401: Wrong API Key"]), "provider-unavailable");
});

test("the offline notice is recognised as a failure, not an answer", () => {
  const offline = { text: "I'm in offline mode right now…", provider: "offline", metadata: { success: false, reason: "all-ai-providers-failed", failureKind: "provider-timeout" } };
  assert.deepEqual(failureFromResponse(offline), { kind: "provider-timeout", message: offline.text });
  assert.equal(failureFromResponse({ text: "Lima.", provider: "OpenRouter", metadata: {} }), null, "a real answer");
  assert.equal(failureFromResponse({ text: "Budget reached", provider: "budget", metadata: { success: false, budgetExhausted: {} } }), null, "budget notice is the answer");
  assert.equal(failureFromResponse({ text: "I did the work…", metadata: { success: false, partial: true } }), null, "partial work is reported");
  assert.equal(failureFromResponse({ text: "Stopped before anything ran.", provider: "cancelled", metadata: { success: false, toolLoopStopped: "user" } })?.kind, "user-cancellation");
});

test("a thrown provider timeout is never a user cancellation; a real abort is", () => {
  const userStop = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
  const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
  const streamTimeout = Object.assign(new Error("BodyStreamBuffer was aborted"), { name: "AbortError" });
  assert.equal(failureFromError(userStop).kind, "user-cancellation");
  assert.equal(failureFromError(timeout).kind, "provider-timeout");
  assert.equal(failureFromError(streamTimeout).kind, "provider-timeout");
  assert.equal(failureFromError(new TypeError("Failed to fetch")).kind, "network-failure");
});
