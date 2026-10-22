/**
 * ==========================================================
 * LÉLU — PRIORITY DECIDES WHAT RUNS NEXT
 *
 * CATEGORY: unit + integration. Real AgentObjectives, real
 * AgentCognitionRuntime selection, the real shared formula.
 *
 * The property being pinned: priority is a decision input, not a
 * field. Before this, StudyObjectives had a real prioritisation
 * engine and AgentObjectives — the store the autonomous executor
 * actually reads — had no priority at all and returned active
 * objectives in insertion order. TaskEngine.priority was written
 * once at creation and never read by anything.
 *
 * Also pinned: there is ONE implementation of the formula.
 * SelfStudyEngine.prioritize() and AgentObjectives.prioritize()
 * both call Prioritization.computePriority, and the numbers it
 * uses are the ones self-study has always used — the extraction
 * was not an opportunity to retune them.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";

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
if (typeof sessionStorage === "undefined") {
  (globalThis as Record<string, unknown>).sessionStorage = globalThis.localStorage;
}

import AgentObjectives, { DEFAULT_BASE_PRIORITY } from "../src/core/cognition/AgentObjectives";
import AgentStore from "../src/core/agents/AgentStore";
import {
  computePriority,
  clampPriority,
  basePriorityForWork,
  projectPriorityAdjustment,
  MIN_PRIORITY,
  MAX_PRIORITY,
} from "../src/core/cognition/Prioritization";
import { stopBackgroundCognition } from "./support/isolation";

await stopBackgroundCognition();

const objectives = AgentObjectives.getInstance();
const agentId = AgentStore.getInstance().list()[0].id;

after(async () => { await stopBackgroundCognition(); });

/** A fresh objective with a stated base, so each test starts level. */
function objective(label: string, basePriority?: number, extra: Record<string, unknown> = {}) {
  const created = objectives.create({
    agentId,
    objective: label,
    source: "cognition",
    ...(basePriority === undefined ? {} : { basePriority }),
    ...extra,
  });
  return created;
}

/* ------------------------------------------------------------------ *
 * THE SHARED FORMULA
 * ------------------------------------------------------------------ */

test("priority is always recomputed from the base, never from the last result", () => {
  const inputs = { basePriority: 50, adjustments: [{ reason: "x", delta: 10 }], now: 0, createdAt: 0 };
  // Called repeatedly with the same inputs it must not drift. A formula
  // that compounded would sink an objective that lost the contest once,
  // permanently.
  assert.equal(computePriority(inputs), 60);
  assert.equal(computePriority(inputs), 60);
  assert.equal(computePriority(inputs), 60);
});

test("attempts lower a priority but never zero it", () => {
  const base = { basePriority: 50, createdAt: 0, now: 0 };
  assert.equal(computePriority({ ...base, attempts: 0 }), 50);
  assert.equal(computePriority({ ...base, attempts: 1 }), 40);
  assert.equal(computePriority({ ...base, attempts: 4 }), 10);
  // Far past zero on the raw arithmetic, and still on the scale.
  assert.equal(computePriority({ ...base, attempts: 99 }), MIN_PRIORITY);
});

test("age nudges work upward, capped, so nothing starves", () => {
  const hour = 60 * 60 * 1000;
  const at = (ms: number) => computePriority({ basePriority: 50, createdAt: 0, now: ms });
  assert.equal(at(0), 50);
  assert.equal(at(3 * hour), 53);
  assert.equal(at(10 * hour), 60);
  // Capped: age must not become a second priority system that
  // eventually outranks everything stated.
  assert.equal(at(500 * hour), 60);
});

test("recency fatigue moves attention on instead of grinding", () => {
  const base = { basePriority: 80, createdAt: 0, now: 0 };
  assert.equal(computePriority({ ...base, recentSameKind: 0 }), 80);
  assert.equal(computePriority({ ...base, recentSameKind: 1 }), 62);
  assert.equal(computePriority({ ...base, recentSameKind: 3 }), 26);
});

test("the scale is closed at both ends", () => {
  assert.equal(computePriority({ basePriority: 1000 }), MAX_PRIORITY);
  assert.equal(computePriority({ basePriority: -1000 }), MIN_PRIORITY);
  assert.equal(clampPriority(Number.NaN), MIN_PRIORITY);
  assert.equal(clampPriority(50.4), 50);
});

test("the extraction reproduces self-study's original arithmetic exactly", () => {
  // The formula below is the ORIGINAL body of SelfStudyEngine.prioritize(),
  // transcribed from the commit before the extraction. Moving a working
  // scoring function is only safe if it still answers the same; this is
  // the check that the move was not quietly a retune.
  const original = (o: {
    basePriority: number;
    domain: string;
    origin: string;
    attempts: number;
    createdAt: number;
  }, runtimeReachable: boolean, recentDomains: string[]) => {
    let priority = o.basePriority;
    if (o.domain === "runtime" && !runtimeReachable) priority += 20;
    if (o.origin === "contradiction") priority += 15;
    if (o.origin === "discovery") priority += 8;
    if (o.origin === "revalidation" && !runtimeReachable) priority -= 15;
    priority -= o.attempts * 10;
    priority += Math.min(10, Math.floor((NOW - o.createdAt) / (60 * 60 * 1000)));
    priority -= 18 * recentDomains.filter((d) => d === o.domain).length;
    return Math.max(1, Math.min(100, Math.round(priority)));
  };

  const NOW = 1_700_000_000_000;
  const hour = 60 * 60 * 1000;
  const domains = ["runtime", "research", "testing", "capability"];
  const origins = ["contradiction", "discovery", "revalidation", "mission"];

  let compared = 0;
  for (const basePriority of [1, 30, 50, 77, 100]) {
    for (const domain of domains) {
      for (const origin of origins) {
        for (const attempts of [0, 1, 3]) {
          for (const ageHours of [0, 2, 40]) {
            for (const runtimeReachable of [true, false]) {
              for (const recentDomains of [[], ["runtime"], ["research", "research"]]) {
                const o = { basePriority, domain, origin, attempts, createdAt: NOW - ageHours * hour };
                const adjustments = [];
                if (domain === "runtime" && !runtimeReachable) adjustments.push({ reason: "r", delta: 20 });
                if (origin === "contradiction") adjustments.push({ reason: "c", delta: 15 });
                if (origin === "discovery") adjustments.push({ reason: "d", delta: 8 });
                if (origin === "revalidation" && !runtimeReachable) adjustments.push({ reason: "v", delta: -15 });

                const extracted = computePriority({
                  basePriority,
                  adjustments,
                  attempts,
                  createdAt: o.createdAt,
                  recentSameKind: recentDomains.filter((d) => d === domain).length,
                  now: NOW,
                });
                assert.equal(
                  extracted,
                  original(o, runtimeReachable, recentDomains),
                  `the extraction changed the answer for ${JSON.stringify({ basePriority, domain, origin, attempts, ageHours, runtimeReachable, recentDomains })}`,
                );
                compared += 1;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(compared > 1000, `only ${compared} cases were compared`);
});

test("the formula lives in exactly one place", () => {
  const strip = (path: string) =>
    readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const study = strip("src/core/cognition/SelfStudyEngine.ts");
  const agents = strip("src/core/cognition/AgentObjectives.ts");

  for (const [name, source] of [["SelfStudyEngine", study], ["AgentObjectives", agents]] as const) {
    assert.match(source, /computePriority\(/, `${name} does not use the shared formula`);
    // The tell-tale numbers of a second copy of the algorithm.
    assert.ok(
      !/attempts \* 10/.test(source),
      `${name} still carries its own attempts penalty`,
    );
    assert.ok(
      !/60 \* 60 \* 1000\)\)/.test(source),
      `${name} still carries its own age nudge`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * SEEDING: WHERE A NUMBER COMES FROM
 * ------------------------------------------------------------------ */

test("the queue category an item was filed under sets its intrinsic importance", () => {
  assert.ok(basePriorityForWork({ category: "NOW" }) > basePriorityForWork({ category: "NEXT" }));
  assert.ok(basePriorityForWork({ category: "NEXT" }) > basePriorityForWork({ category: "LEARNING" }));
  assert.ok(basePriorityForWork({ category: "LEARNING" }) > basePriorityForWork({ category: "IDEAS" }));
  // A BLOCKED item matters BECAUSE something is stuck behind it.
  assert.ok(basePriorityForWork({ category: "BLOCKED" }) > basePriorityForWork({ category: "NEXT" }));
  // An unknown category contributes nothing rather than guessing.
  assert.equal(basePriorityForWork({ category: "NOT-A-CATEGORY" }), DEFAULT_BASE_PRIORITY);
  assert.equal(basePriorityForWork({}), DEFAULT_BASE_PRIORITY);
});

test("a project's own stated priority moves its work", () => {
  const next = basePriorityForWork({ category: "NEXT" });
  assert.ok(basePriorityForWork({ category: "NEXT", projectPriority: "P0" }) > next);
  assert.ok(basePriorityForWork({ category: "NEXT", projectPriority: "P4" }) < next);
  // Free-form in the store, so it is parsed tolerantly and anything
  // unrecognised is ignored rather than guessed at.
  assert.equal(projectPriorityAdjustment("urgent"), null);
  assert.equal(projectPriorityAdjustment(undefined), null);
  assert.equal(projectPriorityAdjustment("P2"), null, "P2 is the neutral middle");
  assert.equal(basePriorityForWork({ category: "NEXT", projectPriority: "nonsense" }), next);
});

/* ------------------------------------------------------------------ *
 * EXECUTION ORDER — the point of the whole phase
 * ------------------------------------------------------------------ */

test("the runtime is offered the highest-priority work first", () => {
  const low = objective("low priority work", 20);
  const high = objective("high priority work", 90);
  const middle = objective("middling work", 55);

  const order = objectives.actionable().map((item) => item.id);
  const mine = order.filter((id) => [low.id, high.id, middle.id].includes(id));

  assert.deepEqual(
    mine,
    [high.id, middle.id, low.id],
    "actionable() is still returning insertion order",
  );
});

test("equal priorities are ordered oldest first, stably", () => {
  const first = objective("same priority, created first", 50);
  const second = objective("same priority, created second", 50);
  // Nudge createdAt apart; two objects made in the same millisecond
  // would otherwise make this test about Array.sort's stability.
  objectives.update(second.id, { createdAt: first.createdAt + 1000 });

  const run = () =>
    objectives
      .actionable()
      .map((item) => item.id)
      .filter((id) => [first.id, second.id].includes(id));

  assert.deepEqual(run(), [first.id, second.id]);
  assert.deepEqual(run(), [first.id, second.id], "the order changed between calls");
});

test("work the user asked for outranks the same work cognition inferred", () => {
  const inferred = objectives.create({ agentId, objective: "inferred", source: "cognition", basePriority: 60 });
  const asked = objectives.create({ agentId, objective: "asked for", source: "user", basePriority: 60 });

  const order = objectives.actionable().map((item) => item.id).filter((id) => [inferred.id, asked.id].includes(id));
  assert.deepEqual(order, [asked.id, inferred.id]);
});

test("cycles already spent push an objective down, so one objective cannot hog the runtime", () => {
  const busy = objective("has already had several goes", 80);
  const fresh = objective("has not run yet", 70);

  // Four cycles spent without finishing: still important, no longer first.
  objectives.update(busy.id, { cyclesRun: 4 });

  const order = objectives.actionable().map((item) => item.id).filter((id) => [busy.id, fresh.id].includes(id));
  assert.deepEqual(order, [fresh.id, busy.id], "an objective that keeps failing kept winning");
});

test("a blocked objective does not keep winning the contest it cannot act on", () => {
  const waiting = objective("waiting on an answer", 95);
  const runnable = objective("can actually proceed", 60);

  objectives.waitFor(waiting.id, "an answer from the user");
  objectives.prioritize();

  // It is out of the actionable set entirely, which is the strong form.
  const actionable = objectives.actionable().map((item) => item.id);
  assert.ok(!actionable.includes(waiting.id), "a waiting objective was offered for execution");
  assert.ok(actionable.includes(runnable.id));

  // And its score was marked down, so when it does become actionable
  // again it has not kept a 95 it never earned.
  const stored = objectives.get(waiting.id);
  assert.ok(stored && stored.priority < 95, `waiting priority stayed at ${stored?.priority}`);
});

test("completed work never outranks live work, because it is not live", () => {
  const done = objective("finished", 100);
  const live = objective("still going", 30);
  objectives.complete(done.id, "Done.");

  const actionable = objectives.actionable().map((item) => item.id);
  assert.ok(!actionable.includes(done.id), "a completed objective was offered for execution");
  assert.ok(actionable.includes(live.id));
  // Its stored priority is left exactly as it ended; recomputing a
  // finished objective would only move a number nothing reads.
  assert.equal(objectives.get(done.id)?.priority, 100);
});

test("priority survives a reload, and recomputes rather than drifting", () => {
  const created = objective("persisted work", 70);
  assert.equal(created.basePriority, 70);

  // Two recomputes in a row must land on the same number: the base is
  // the only thing either of them starts from.
  objectives.prioritize();
  const first = objectives.get(created.id)?.priority;
  objectives.prioritize();
  const second = objectives.get(created.id)?.priority;
  assert.equal(first, second, "priority drifted between recomputes");

  // And the base itself is never rewritten by a recompute.
  assert.equal(objectives.get(created.id)?.basePriority, 70);
});

test("an objective created without a stated base gets the middle of the scale", () => {
  const created = objectives.create({ agentId, objective: "unstated", source: "cognition" });
  assert.equal(created.basePriority, DEFAULT_BASE_PRIORITY);
  assert.equal(created.priority, DEFAULT_BASE_PRIORITY);
});
