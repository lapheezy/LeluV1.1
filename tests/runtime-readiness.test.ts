/**
 * ==========================================================
 * RUNTIME READINESS — the states must mean what they say
 *
 * The point of this registry is that a green dot cannot be
 * earned by importing a module. These tests hold it to that:
 * a claim never produces READY, a confirmation without
 * evidence is not a confirmation, and one failed subsystem
 * degrades only what depends on it.
 * ==========================================================
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPENDS_ON,
  READY_MEANS,
  REQUIRED_FOR_OPERATIONAL,
  readiness,
  type SubsystemId,
} from "../src/core/runtime/readiness";

const ALL = Object.keys(READY_MEANS) as SubsystemId[];

function fresh() {
  const r = readiness();
  r.reset("test");
  return r;
}

test("every subsystem starts NOT_INITIALIZED with no verification", () => {
  const r = fresh();
  const snapshot = r.get();
  assert.equal(snapshot.subsystems.length, ALL.length);
  for (const s of snapshot.subsystems) {
    assert.equal(s.state, "NOT_INITIALIZED", `${s.id} should start uninitialized`);
    assert.equal(s.lastVerified, null, `${s.id} must not claim verification`);
  }
  assert.equal(snapshot.operational, false);
});

test("a claim can never produce READY — an import is not functionality", () => {
  const r = fresh();
  r.claim("cognition", "AIService module loaded");
  assert.equal(r.stateOf("cognition"), "INITIALIZING");
  r.begin("tools", "registering");
  assert.equal(r.stateOf("tools"), "INITIALIZING");
  assert.equal(r.stateOf("cognition") === "READY", false);
});

test("a claim does not downgrade a subsystem that was confirmed", () => {
  const r = fresh();
  r.confirm("chat", "composer laid out at 380x96px");
  assert.equal(r.stateOf("chat"), "READY");
  r.claim("chat", "module re-imported");
  assert.equal(r.stateOf("chat"), "READY", "READY must survive a late claim");
});

test("confirming without evidence is DEGRADED, not READY", () => {
  const r = fresh();
  r.confirm("memory", "");
  assert.equal(r.stateOf("memory"), "DEGRADED");
  r.confirm("network", "   ");
  assert.equal(r.stateOf("network"), "DEGRADED");
});

test("confirming with evidence is READY and records when it was verified", () => {
  const r = fresh();
  r.confirm("memory", "wrote 1.2 KB and read it back");
  const entry = r.get().subsystems.find((s) => s.id === "memory")!;
  assert.equal(entry.state, "READY");
  assert.equal(entry.detail, "wrote 1.2 KB and read it back");
  assert.ok(typeof entry.lastVerified === "number" && entry.lastVerified > 0);
});

test("one failure degrades only its dependents; unrelated systems are untouched", () => {
  const r = fresh();
  r.confirm("shell", "mounted");
  r.confirm("chat", "composer laid out");
  r.confirm("memory", "round trip ok");
  r.fail("cognition", "no provider configured");

  assert.equal(r.stateOf("cognition"), "FAILED");
  // tools and agents declare cognition as a dependency
  for (const dependent of ALL.filter((id) => DEPENDS_ON[id].includes("cognition"))) {
    assert.equal(r.stateOf(dependent), "DEGRADED", `${dependent} should be blocked`);
  }
  // everything else keeps its own state
  assert.equal(r.stateOf("chat"), "READY", "chat must not be taken down by cognition");
  assert.equal(r.stateOf("memory"), "READY");
  assert.equal(r.stateOf("shell"), "READY");
});

test("a blocked dependent is DEGRADED with the reason, never FAILED itself", () => {
  const r = fresh();
  r.fail("network", "offline");
  const cognit = r.get().subsystems.find((s) => s.id === "cognition")!;
  assert.equal(cognit.state, "DEGRADED");
  assert.match(cognit.detail, /Blocked: network failed/);
});

test("a failing subsystem cannot take the app down by reporting itself", () => {
  const r = fresh();
  r.subscribe(() => {
    throw new Error("listener explosion");
  });
  assert.doesNotThrow(() => r.fail("memory", "boom"));
  assert.equal(r.stateOf("memory"), "FAILED");
});

test("marking the same state twice is idempotent and keeps snapshot identity", () => {
  const r = fresh();
  r.confirm("tools", "invoked research.web");
  const first = r.get();
  r.confirm("tools", "invoked research.web");
  assert.equal(r.get(), first, "unchanged state must not produce a new snapshot");
  r.confirm("tools", "invoked research.web again");
  assert.notEqual(r.get(), first, "a real change must produce a new snapshot");
});

test("listeners are a set: double-subscribe fires once, unsubscribe stops delivery", () => {
  const r = fresh();
  let calls = 0;
  const listener = () => {
    calls += 1;
  };
  const off = r.subscribe(listener);
  r.subscribe(listener);
  r.confirm("voice", "input and output verified");
  assert.equal(calls, 1, "the same listener must not fire twice");
  off();
  r.confirm("voice", "verified again");
  assert.equal(calls, 1, "an unsubscribed listener must not fire");
});

test("reset returns everything to uninitialized — no inherited READY", () => {
  const r = fresh();
  r.confirm("chat", "composer laid out");
  r.confirm("cosmos", "world mounted");
  r.reset("Runtime stopped.");
  for (const s of r.get().subsystems) {
    assert.equal(s.state, "NOT_INITIALIZED", `${s.id} survived a reset`);
  }
  assert.equal(r.get().operational, false);
});

test("operational requires every required subsystem, and ignores optional ones", () => {
  const r = fresh();
  for (const id of REQUIRED_FOR_OPERATIONAL) r.confirm(id, `verified ${id}`);
  assert.equal(r.get().operational, true, "required subsystems alone must be enough");

  for (const id of ALL.filter((s) => !REQUIRED_FOR_OPERATIONAL.includes(s))) {
    assert.equal(r.stateOf(id), "NOT_INITIALIZED");
  }

  r.fail("chat", "composer disappeared");
  assert.equal(r.get().operational, false, "a failed required subsystem is not operational");
});

test("the dependency graph is acyclic and only names known subsystems", () => {
  for (const [id, deps] of Object.entries(DEPENDS_ON)) {
    for (const dep of deps) {
      assert.ok(ALL.includes(dep), `${id} depends on unknown ${dep}`);
    }
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (id: string) => {
    if (done.has(id)) return;
    assert.ok(!visiting.has(id), `cycle through ${id}`);
    visiting.add(id);
    for (const dep of DEPENDS_ON[id as SubsystemId]) walk(dep);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of ALL) walk(id);
});
