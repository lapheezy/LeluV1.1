/**
 * ==========================================================
 * LÉLU — RESCORING IS NOT SAVING, AND A RENDER IS NOT A LIFECYCLE
 *
 * CATEGORY: integration for the stores (the real stores, real
 * KvStore, instrumented backends), structural for the one thing
 * that needs a DOM this project has no harness for.
 *
 * Three defects of one shape, all found by measuring real
 * browser turns rather than by reading code:
 *
 *   1. AgentObjectives.prioritize() wrote each rescored
 *      objective through update(), which notified, which
 *      re-entered the very read path (considerPending →
 *      actionable → prioritize) the notification came from.
 *      Shipped in Phase 3, found in Phase 4. Fixed, but nothing
 *      stopped it coming back — that is what this file is for.
 *
 *   2. SelfStudyEngine.prioritize() had the same defect in its
 *      other form: no cascade, just N full-array writes for one
 *      cycle's rescoring. Measured: 22 writes, 225KB.
 *
 *   3. AvatarPresenceBridge start/stop persisted the WHOLE
 *      avatar profile to record `dialogueLive` — a field get()
 *      deliberately never reads back from storage. Measured: 24
 *      writes, 170KB in one turn, because the effect owning the
 *      bridge re-ran at render rate.
 *
 * The numbers in these comments were measured in a real browser
 * (scripts/measure-render-cost.mjs and an equivalent probe), not
 * estimated.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/** Instrumented storage, installed before any store is imported. */
const writes: Array<{ backend: string; key: string; bytes: number }> = [];

function makeStorage(backend: string) {
  const data: Record<string, string> = {};
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      writes.push({ backend, key, bytes: value.length });
      data[key] = value;
    },
    removeItem: (key: string) => { delete data[key]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    get length() { return Object.keys(data).length; },
    key: (i: number) => Object.keys(data)[i] ?? null,
  };
}

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
(globalThis as Record<string, unknown>).localStorage = makeStorage("local");
(globalThis as Record<string, unknown>).sessionStorage = makeStorage("session");

import AgentObjectives from "../src/core/cognition/AgentObjectives";
import StudyObjectives from "../src/core/cognition/StudyObjectives";
import AvatarStore from "../src/core/avatar/AvatarProfile";

/**
 * SAVES, not setItem calls. One KvStore.set writes the same string to
 * localStorage AND sessionStorage, so counting setItem counts backends.
 * Only the local backend is counted, so a save is a save.
 */
function savesOf(storedKey: string): number {
  return writes.filter((w) => w.backend === "local" && w.key === storedKey).length;
}

/**
 * The keys as they ACTUALLY land in storage.
 *
 * KvStore prefixes every key with "lelu.", and some stores already
 * name their own key "lelu.something" — so those are really stored
 * double-prefixed, as "lelu.lelu.something", while a store whose key
 * has no prefix of its own is stored singly. Confirmed against a real
 * browser's localStorage. Spelling these out beats a clever helper:
 * the first version of this file had one, and it silently turned the
 * avatar assertion into a count of writes to a key nothing uses, which
 * passed while proving nothing.
 */
const AGENT_OBJECTIVES = "lelu.lelu.agent.objectives.v1";
const STUDY_OBJECTIVES = "lelu.lelu.selfstudy.objectives.v1";
const AVATAR = "lelu.avatar.v1";

function reset(): void {
  localStorage.clear();
  sessionStorage.clear();
  writes.length = 0;
}

/* ===================================================================
 * 1. AgentObjectives — the Phase 3 regression, pinned
 * =================================================================== */

test("rescoring several objectives is ONE write, not one per objective", () => {
  reset();
  const objectives = AgentObjectives.getInstance();
  for (let i = 0; i < 6; i += 1) {
    objectives.create({ agentId: "a", objective: `work ${i}`, basePriority: 40 + i });
  }

  // Make every one of them due for a different score, so prioritize()
  // genuinely has six changes to apply rather than nothing to do.
  for (const objective of objectives.list("a")) {
    objectives.update(objective.id, { cyclesRun: 2 });
  }

  const before = writes.length;
  objectives.prioritize();
  const saves = writes.filter(
    (w, i) => i >= before && w.backend === "local" && w.key === AGENT_OBJECTIVES,
  ).length;

  assert.equal(saves, 1, `six rescored objectives should cost one save, saw ${saves}`);
});

test("prioritize() does not notify, so it cannot re-enter the path that called it", () => {
  reset();
  const objectives = AgentObjectives.getInstance();
  const created = objectives.create({ agentId: "b", objective: "re-entrancy", basePriority: 55 });
  objectives.update(created.id, { cyclesRun: 3 });

  let notifications = 0;
  const unsubscribe = objectives.subscribe(() => { notifications += 1; });
  objectives.prioritize();
  unsubscribe();

  // This is the whole bug. AgentCognitionRuntime subscribes to this
  // store and answers a notification by calling considerPending() →
  // actionable() → prioritize(). A notification from inside prioritize
  // therefore re-entered its own caller, once per rescored objective,
  // and each pass reset the continuation timer — so an objective with a
  // scheduled next cycle never reached it.
  assert.equal(notifications, 0, "prioritize() notified, which re-enters its own caller");
});

test("a subscriber that reads actionable() does not recurse", () => {
  reset();
  const objectives = AgentObjectives.getInstance();
  for (let i = 0; i < 4; i += 1) {
    const made = objectives.create({ agentId: "c", objective: `loop ${i}`, basePriority: 30 + i * 5 });
    objectives.update(made.id, { cyclesRun: 1 });
  }

  // Exactly what AgentCognitionRuntime does, including the read.
  let depth = 0;
  let maxDepth = 0;
  const unsubscribe = objectives.subscribe(() => {
    depth += 1;
    maxDepth = Math.max(maxDepth, depth);
    objectives.actionable("c");
    depth -= 1;
  });

  // One real state change, which SHOULD notify exactly once.
  const [first] = objectives.list("c");
  objectives.update(first.id, { state: "scheduled", resumeAt: Date.now() + 60_000 });
  unsubscribe();

  assert.equal(maxDepth, 1, `the notification nested ${maxDepth} deep`);
});

test("rescoring still produces the right numbers — the batching changed cost, not behaviour", () => {
  reset();
  const objectives = AgentObjectives.getInstance();
  const low = objectives.create({ agentId: "d", objective: "cheap", basePriority: 40, source: "cognition" });
  const high = objectives.create({ agentId: "d", objective: "asked for", basePriority: 40, source: "user" });

  objectives.prioritize();

  const after = new Map(objectives.list("d").map((o) => [o.id, o.priority]));
  assert.ok(
    (after.get(high.id) ?? 0) > (after.get(low.id) ?? 0),
    "the user's own request should outrank the inferred one after a batched rescore",
  );
});

/* ===================================================================
 * 2. StudyObjectives — the same defect, the other form
 * =================================================================== */

test("a whole cycle's study rescoring is one write", () => {
  reset();
  const study = StudyObjectives.getInstance();
  const ids: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const made = study.add({
      question: `what is ${i}?`,
      detail: "measured",
      origin: "seed",
      domain: "architecture",
      priority: 50,
      createdInCycle: 1,
    });
    assert.ok(made, "the fixture objective should be accepted");
    ids.push(made.id);
  }

  writes.length = 0;
  study.applyPriorities(new Map(ids.map((id, i) => [id, 60 + i])));

  assert.equal(
    savesOf(STUDY_OBJECTIVES),
    1,
    "eight rescored study objectives should cost one save",
  );
  const stored = study.list();
  for (const [i, id] of ids.entries()) {
    assert.equal(stored.find((o) => o.id === id)?.priority, 60 + i, "every new score should be applied");
  }
});

test("applying no change writes nothing at all", () => {
  reset();
  const study = StudyObjectives.getInstance();
  const made = study.add({
    question: "already correct?",
    detail: "measured",
    origin: "seed",
    domain: "memory",
    priority: 44,
    createdInCycle: 1,
  });
  assert.ok(made);

  writes.length = 0;
  study.applyPriorities(new Map([[made.id, 44]]));
  assert.equal(savesOf(STUDY_OBJECTIVES), 0, "an unchanged score is not a save");

  study.applyPriorities(new Map());
  assert.equal(savesOf(STUDY_OBJECTIVES), 0, "an empty batch is not a save");
});

test("a priority for an objective that is not there is ignored, not created", () => {
  reset();
  const study = StudyObjectives.getInstance();
  const countBefore = study.list().length;
  study.applyPriorities(new Map([["an-id-that-does-not-exist", 90]]));
  assert.equal(study.list().length, countBefore, "a stray priority must not invent an objective");
  assert.equal(savesOf(STUDY_OBJECTIVES), 0, "and must not cost a write");
});

test("self-study's rescoring loop collects, then applies once", () => {
  // Structural, deliberately: prioritize() is private and runs inside a
  // cycle that needs a provider. What matters is that the loop no longer
  // writes per objective, and that is visible in the source.
  const source = readFileSync("src/core/cognition/SelfStudyEngine.ts", "utf8");
  const start = source.indexOf("private prioritize(");
  assert.ok(start > 0, "prioritize() should still exist");
  const body = source.slice(start, source.indexOf("\n  }", start));

  assert.doesNotMatch(
    body,
    /this\.objectives\.update\(/,
    "prioritize() is writing per objective again",
  );
  assert.match(body, /applyPriorities\(/, "prioritize() should apply its scores in one batch");
});

/* ===================================================================
 * 3. The avatar — a field read from memory is not persisted
 * =================================================================== */

test("marking the avatar's dialogue live writes nothing", async () => {
  reset();
  const avatar = AvatarStore.getInstance();
  // Seed one real write so the key exists and the count below is about
  // the liveness calls rather than about first-write behaviour.
  await avatar.updateRuntime({ lastAction: "seeded" });
  writes.length = 0;

  for (let i = 0; i < 12; i += 1) {
    await avatar.updateRuntime({ dialogueLive: i % 2 === 0 });
  }

  assert.equal(
    savesOf(AVATAR),
    0,
    "liveness is read from memory, so storing it writes a value no reader uses",
  );
});

test("but liveness is still reported, and still only from memory", async () => {
  reset();
  const avatar = AvatarStore.getInstance();
  await avatar.updateRuntime({ dialogueLive: true });
  assert.equal(avatar.get().runtime.dialogueLive, true, "the caller's change should be visible");

  await avatar.updateRuntime({ dialogueLive: false });
  assert.equal(avatar.get().runtime.dialogueLive, false, "and so should turning it off");

  // Nothing about liveness reached storage, so a fresh reader cannot
  // mistake a remembered state for a current observation.
  const raw = localStorage.getItem(AVATAR);
  if (raw) {
    assert.doesNotMatch(raw, /"dialogueLive":true/, "a stored true would survive a reload as a lie");
  }
});

test("subscribers are still told when liveness changes", async () => {
  reset();
  const avatar = AvatarStore.getInstance();
  let seen = 0;
  const unsubscribe = avatar.subscribe(() => { seen += 1; });
  await avatar.updateRuntime({ dialogueLive: true });
  unsubscribe();
  assert.ok(seen >= 1, "not writing is not the same as not telling anyone");
});

test("a real runtime change is still persisted", async () => {
  reset();
  const avatar = AvatarStore.getInstance();
  writes.length = 0;
  await avatar.updateRuntime({ dialogueState: "thinking", dialogueStateAt: Date.now(), dialogueLive: true });

  assert.equal(savesOf(AVATAR), 1, "a dialogue state change is real state and must be saved");
  assert.equal(avatar.get().runtime.dialogueState, "thinking");
});

/* ===================================================================
 * 4. The effect that caused it — structural, for want of a DOM
 * =================================================================== */

test("nothing with a lifecycle is started by an effect that re-runs every render", () => {
  // This is the root cause of defect 3, and it needs a DOM to test
  // behaviourally — this project has no DOM harness, so this asserts
  // the structure instead, and says so rather than implying otherwise.
  //
  // `openPanel` comes from the Genesis context, whose memo depends on
  // `state`. Its identity therefore changes on every state change, so
  // an effect listing it re-runs at render rate. Measured in a real
  // browser turn before the split: 12 stop/start pairs of the presence
  // bridge for one message.
  const source = readFileSync("src/app/scene/genesis/GenesisInterface.tsx", "utf8");

  const starts = [...source.matchAll(/AvatarPresenceBridge\.getInstance\(\)\.start\(\)|presence\.start\(\)/g)];
  assert.ok(starts.length >= 2, "both lifecycles should still be started somewhere");

  for (const match of starts) {
    // The dependency array closing the effect this start() sits in.
    const deps = source.slice(match.index ?? 0).match(/\n  \}, \[([^\]]*)\]\);/);
    assert.ok(deps, "a start() should be inside an effect");
    assert.equal(
      deps[1].trim(),
      "",
      `a lifecycle is started by an effect keyed on [${deps[1].trim()}] — ` +
        "openPanel-shaped values change every render, which restarts it every render",
    );
  }
});
