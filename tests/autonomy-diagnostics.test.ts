/**
 * ==========================================================
 * LÉLU — FOUR FAULTS, NOT ONE
 *
 * CATEGORY: unit for the live test's diagnostic reporter, with
 * the real objective store and the real provider registry.
 *
 * Every red live run used to print the same sentence — "only 1
 * action(s) were taken: workflow_list" — and that symptom is
 * shared by faults that are not the same thing at all:
 *
 *   provider-auth-failure   the credential was refused
 *   model-under-completed   the serving model stopped short
 *   tool-execution-failure  a required tool ran and failed
 *   runtime-failure         LÉLU marked it complete anyway
 *
 * Only the last is a cognition defect. A classifier that can
 * only ever say "pass" is not a classifier, and the live runs
 * on this container have all passed since the completion
 * verifier landed — so the other three branches are proven
 * here rather than waited for.
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

import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AIService from "../src/core/AIService";
import { AutonomyReport } from "./support/autonomy-report";

const objectives = AgentObjectives.getInstance();
const EXPECTED = ["workflow_list", "workflow_author", "workflow_run"];

/** Start from a registry with no failure history, so a case is a case. */
async function clearProviderFailures(): Promise<void> {
  const service = AIService.getInstance();
  await service.initialize();
  const registry = service.getAIProviderRegistry();
  for (const name of registry.names()) registry.clearFailure(name);
}

/** An objective with a scripted cycle history. */
function seed(
  objectiveText: string,
  cycles: Array<{ executed: Array<{ tool: string; ok: boolean }>; provider?: string }>,
  finalState: "completed" | "yielded" | "active",
): string {
  const objective = objectives.create({ agentId: "diagnostics", objective: objectiveText });
  for (const entry of cycles) {
    objectives.recordCycle({
      cycleId: crypto.randomUUID(),
      agentId: "diagnostics",
      objectiveId: objective.id,
      trigger: "runtime:test",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      decision: "DONE: finished.",
      executed: entry.executed,
      provider: entry.provider ?? "TestProvider",
      nextState: "active",
    });
  }
  if (finalState === "completed") objectives.complete(objective.id, "done");
  if (finalState === "yielded") objectives.yieldObjective(objective.id, "no-progress", "stopped");
  return objective.id;
}

test("everything ran and it completed: pass", async () => {
  await clearProviderFailures();
  const report = new AutonomyReport();
  const id = seed(
    "List, author and run it.",
    [{ executed: EXPECTED.map((tool) => ({ tool, ok: true })) }],
    "completed",
  );

  assert.equal(report.classify(id, EXPECTED).classification, "pass");
});

test("the model stopped short and the runtime did NOT accept it: model-under-completed", async () => {
  await clearProviderFailures();
  const report = new AutonomyReport();
  const id = seed(
    "List, author and run it.",
    [{ executed: [{ tool: "workflow_list", ok: true }], provider: "Fireworks" }],
    "yielded",
  );

  const { classification, detail } = report.classify(id, EXPECTED);
  assert.equal(classification, "model-under-completed");
  assert.match(detail, /Fireworks/, "the detail does not name who served the turn");
  assert.match(detail, /did NOT accept it as complete/, "the detail does not clear the runtime");
});

test("a required tool ran and failed: tool-execution-failure", async () => {
  await clearProviderFailures();
  const report = new AutonomyReport();
  const id = seed(
    "List, author and run it.",
    [
      {
        executed: [
          { tool: "workflow_list", ok: true },
          { tool: "workflow_author", ok: false },
        ],
      },
    ],
    "yielded",
  );

  const { classification, detail } = report.classify(id, EXPECTED);
  assert.equal(classification, "tool-execution-failure");
  assert.match(detail, /workflow_author/);
});

test("the objective is marked complete with required work never executed: runtime-failure", async () => {
  await clearProviderFailures();
  const report = new AutonomyReport();
  // THE ONE THAT WOULD BE A LÉLU DEFECT. The completion verifier is
  // what makes this state unreachable in the product; this proves the
  // report would NAME it rather than blaming the model, if it ever
  // happened again.
  const id = seed(
    "List, author and run it.",
    [{ executed: [{ tool: "workflow_list", ok: true }] }],
    "completed",
  );

  const { classification, detail } = report.classify(id, EXPECTED);
  assert.equal(classification, "runtime-failure");
  assert.match(detail, /completion verifier should have rejected/i);
});

/**
 * WHOSE FAULT, AND WHEN.
 *
 * These three used to assert that ANY recorded provider failure
 * explained whatever happened next. That collapses the distinction
 * this classifier exists to make: on this container the two preferred
 * providers answer 401 on every single run, so every failure came out
 * as provider-auth-failure.
 *
 * A real run caught it. Fireworks served the turn, workflow_list
 * executed and returned "No workflows are defined yet", and the model
 * then declared BLOCKED claiming it had not retrieved the list.
 * Nothing about that was the credential's fault — and calling it one
 * would have hidden a model that misreports its own tool results.
 *
 * So health explains a run only when the run could not get a usable
 * answer. The failures are still reported either way.
 */
test("a refused credential is blamed when it left nothing able to serve the turn", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  assert.ok(first, "there is no provider to mark");
  registry.markFailure(first, `${first} failed 401: Invalid API Key`);

  const report = new AutonomyReport();
  // No cycle at all: the credential was refused before anything could
  // serve a decision, which is exactly what happens here when every
  // configured provider answers 401.
  const id = seed("List, author and run it.", [], "yielded");

  const { classification, detail } = report.classify(id, EXPECTED);
  assert.equal(classification, "provider-auth-failure");
  assert.match(detail, /not a cognition defect/);
  registry.clearFailure(first);
});

test("a provider that timed out is blamed only if it was the one serving", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  registry.markFailure(first, `${first} request timed out after 30000ms`);

  const report = new AutonomyReport();
  const servedByTheFailing = seed(
    "List, author and run it.",
    [{ executed: [{ tool: "workflow_list", ok: true }], provider: first }],
    "yielded",
  );
  const { classification, detail } = report.classify(servedByTheFailing, EXPECTED);
  assert.equal(classification, "provider-timeout");
  assert.match(detail, /timed out/);
  assert.match(detail, /not a cognition defect/);
  registry.clearFailure(first);
});

test("an unreachable provider that did not serve does not excuse the one that did", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  registry.markFailure(first, `${first} failed: ECONNREFUSED`);

  const report = new AutonomyReport();
  const id = seed(
    "List, author and run it.",
    [{ executed: [{ tool: "workflow_list", ok: true }], provider: "Fallback" }],
    "yielded",
  );

  assert.equal(
    report.classify(id, EXPECTED).classification,
    "model-under-completed",
    "a fallback that answered perfectly well was excused by someone else's network failure",
  );
  // The failure is still REPORTED, by kind, even though it is not blamed.
  assert.match(report.render(id, EXPECTED), /unreachable|NETWORK/i);
  registry.clearFailure(first);
});

test("a fallback that answered is named in the detail, but not blamed", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  registry.markFailure(first, `${first} failed 401: Invalid API Key`);

  const report = new AutonomyReport();
  const id = seed(
    "List, author and run it.",
    [{ executed: [{ tool: "workflow_list", ok: true }], provider: "Fallback" }],
    "yielded",
  );

  const { classification, detail } = report.classify(id, EXPECTED);
  assert.equal(classification, "model-under-completed");
  assert.match(detail, new RegExp(first.split(" ")[0]), "the refused credential is not mentioned at all");
  assert.match(detail, /the fallback answered/);
  registry.clearFailure(first);
});

/**
 * THREE CODES THAT USED TO COLLAPSE TO "unknown"
 *
 * 402 / 404 / 400+422 all map to "unknown" before, because the
 * registry's classifier only knew auth, timeout, network, and server.
 * A billing failure, a missing model, or a bad request each needed its
 * own actionable kind — and none of them required changes to the provider
 * error channel; they were readable from the reason string all along.
 */
test("a billing failure (402) classifies as billing, not unknown", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  assert.ok(first, "there is no provider to mark");
  registry.markFailure(first, `${first} failed 402: payment required`);

  const failure = registry.failure(first);
  assert.equal(
    failure?.kind,
    "billing",
    `402 classified as "${failure?.kind}" instead of "billing"`,
  );
  registry.clearFailure(first);
});

test("a model-not-found failure (404) classifies as model-not-found, not unknown", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  assert.ok(first, "there is no provider to mark");
  registry.markFailure(first, `${first} failed 404: model not found`);

  const failure = registry.failure(first);
  assert.equal(
    failure?.kind,
    "model-not-found",
    `404 classified as "${failure?.kind}" instead of "model-not-found"`,
  );
  registry.clearFailure(first);
});

test("a bad-request failure (400) classifies as bad-request, not unknown", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  assert.ok(first, "there is no provider to mark");
  registry.markFailure(first, `${first} failed 400: bad request`);

  const failure = registry.failure(first);
  assert.equal(
    failure?.kind,
    "bad-request",
    `400 classified as "${failure?.kind}" instead of "bad-request"`,
  );
  registry.clearFailure(first);
});

test("the report prints the evidence and no credentials", async () => {
  await clearProviderFailures();
  const registry = AIService.getInstance().getAIProviderRegistry();
  const [first] = registry.names();
  registry.markFailure(first, `${first} failed 401: key sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`);

  const report = new AutonomyReport();
  const id = seed(
    "List, author and run it.",
    [{ executed: [{ tool: "workflow_list", ok: true }], provider: "Fallback" }],
    "yielded",
  );
  const rendered = report.render(id, EXPECTED);

  // The evidence a reader needs.
  assert.match(rendered, /AUTONOMY RUN REPORT/);
  assert.match(rendered, /PROVIDERS/);
  assert.match(rendered, /AUTH REFUSED/);
  assert.match(rendered, /✓ workflow_list/, "a satisfied requirement is not shown as satisfied");
  assert.match(rendered, /✗ workflow_author/, "an unsatisfied requirement is not shown as missing");
  assert.match(rendered, /CONTINUATIONS SCHEDULED/);

  // And not the key.
  assert.ok(!/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/.test(rendered), "a key reached the report");
  assert.match(rendered, /\[redacted\]/);
  registry.clearFailure(first);
});
