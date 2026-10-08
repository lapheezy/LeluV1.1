/**
 * ==========================================================
 * LÉLU — LIVE STATE INTEGRATION (audit findings 1, 2, 7)
 *
 * CATEGORY: integration (real singletons, real signals, real
 * self-test suite). No mocks — the only substitute is a browser
 * storage shim so KvStore works outside a browser.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import AIService from "../src/core/AIService";
import AvatarStore from "../src/core/avatar/AvatarProfile";
import AvatarPresenceBridge from "../src/core/avatar/AvatarPresenceBridge";
import SelfTestRunner from "../src/core/selfdev/SelfTestRunner";
import CapabilityRegistry from "../src/core/selfdev/CapabilityRegistry";

/* ------------------------------------------------------------------ *
 * FINDING 1 — avatar presence follows LIVE cognition
 * ------------------------------------------------------------------ */

test("the avatar has no live dialogue state until something drives it", () => {
  // A profile restored from storage is not an observation. Presenting
  // a remembered state as current is how a UI shows thinking that never
  // happened.
  const profile = AvatarStore.getInstance().get();
  assert.equal(profile.runtime.dialogueLive, false);
});

test("thinking, speaking and listening reach avatar presence from the real emitters", async () => {
  const bridge = AvatarPresenceBridge.getInstance();
  const seen: string[] = [];
  const unsubscribe = bridge.subscribe((state) => seen.push(state));
  bridge.start();

  // Drive the EXISTING AIService signals — the same ones chat() raises.
  const ai = AIService.getInstance() as unknown as {
    emitThinking(v: boolean): void;
    emitSpeaking(v: boolean): void;
    emitListening(v: boolean): void;
  };

  ai.emitListening(true);
  assert.equal(bridge.getState(), "listening");

  ai.emitThinking(true);
  assert.equal(bridge.getState(), "thinking", "thinking did not reach presence");

  ai.emitSpeaking(true);
  assert.equal(bridge.getState(), "speaking", "speaking did not reach presence");

  // The store carries it, so the avatar reads real state rather than a
  // separately maintained UI value.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const live = AvatarStore.getInstance().get().runtime;
  assert.equal(live.dialogueState, "speaking");
  assert.equal(live.dialogueLive, true);
  assert.ok(live.dialogueStateAt > 0);

  ai.emitSpeaking(false);
  ai.emitThinking(false);
  ai.emitListening(false);
  assert.equal(bridge.getState(), "idle");

  unsubscribe();
  bridge.stop();
  assert.ok(seen.includes("thinking") && seen.includes("speaking"),
    `transitions did not occur from live signals: ${seen.join(",")}`);
});

test("stopping the bridge marks the state not-live rather than freezing it as current", async () => {
  const bridge = AvatarPresenceBridge.getInstance();
  bridge.start();
  bridge.stop();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(AvatarStore.getInstance().get().runtime.dialogueLive, false);
});

/* ------------------------------------------------------------------ *
 * FINDING 2 + 7 — verification decides capability status
 * ------------------------------------------------------------------ */

test("the self-test suite really executes and reports measured counts", async () => {
  const suite = await SelfTestRunner.getInstance().run();
  // A real run: every result carries its own detail, and the summary
  // adds up. This is what integrate() must consult.
  assert.ok(suite.summary.total > 0, "the self-test suite ran no checks");
  assert.equal(suite.summary.passed + suite.summary.failed, suite.summary.total);
  assert.equal(suite.healthy, suite.summary.failed === 0);
  for (const result of suite.results) {
    assert.ok(typeof result.detail === "string" && result.detail.length > 0,
      `${result.name} reported no evidence`);
  }
});

test("a capability is not marked available just because a status was requested", () => {
  const registry = CapabilityRegistry.getInstance();
  const all = registry.list();
  assert.ok(all.length > 0);
  // Statuses are a closed vocabulary, and "available" is only one of
  // them — the registry must be able to express partial/blocked states
  // rather than collapsing everything to done.
  const statuses = new Set(all.map((capability) => capability.status));
  assert.ok(statuses.size > 1, "every capability reports the same status");
  assert.ok(
    all.some((capability) => capability.status !== "available"),
    "the registry claims everything is available",
  );
});

test("an improvement cycle runs the real suite and lets its result decide the status", async () => {
  const { default: SelfDevelopmentLoop } = await import("../src/core/selfdev/SelfDevelopmentLoop");
  const { default: VersionHistory } = await import("../src/core/selfdev/VersionHistory");

  const registry = CapabilityRegistry.getInstance();
  const target = registry.list().find((capability) => capability.status !== "available");
  assert.ok(target, "no non-available capability to exercise");

  const loop = SelfDevelopmentLoop.getInstance() as unknown as {
    queue: { add(input: Record<string, unknown>): { id: string }; update(id: string, patch: Record<string, unknown>): void };
    integrate(id: string): Promise<{ steps: Array<{ step: string; status: string; detail: string }> }>;
  };

  const proposal = loop.queue.add({
    title: "Self-test verification probe",
    rationale: "Integration must consult the real suite.",
    capabilityId: target.id,
  });
  loop.queue.update(proposal.id, { status: "Ready" });

  const before = VersionHistory.getInstance().listVersions().length;
  const run = await loop.integrate(proposal.id);

  // The suite is CONSULTED, not described.
  const selfTest = run.steps.find((step) => step.step === "self-test");
  assert.ok(selfTest, "integrate() did not run the self-test suite");
  assert.match(selfTest.detail, /SelfTestRunner: \d+\/\d+ passed/);

  const versions = VersionHistory.getInstance().listVersions();
  assert.equal(versions.length, before + 1, "no version was recorded");
  const record = versions[versions.length - 1];
  // These two fields used to be the hardcoded strings "Self-test suite +
  // sandbox tests" and "Green at development time" — a record claiming
  // tests had passed, written without running any.
  assert.match(record.tests, /SelfTestRunner \(\d+ checks\)/);
  assert.match(record.results, /\d+\/\d+ passed/);
  assert.notEqual(record.results, "Green at development time");

  // The measured outcome decides the status, both ways.
  const suite = await SelfTestRunner.getInstance().run();
  const after = registry.get(target.id);
  assert.ok(after);
  assert.equal(
    after.status,
    suite.healthy ? "available" : "partial",
    `status ${after.status} does not match a suite that was healthy=${suite.healthy}`,
  );
  // And the evidence for that status is recorded with it.
  assert.ok(
    after.limitations.some((entry) => /SelfTestRunner: \d+\/\d+/.test(entry)),
    "the status carries no evidence",
  );
});
