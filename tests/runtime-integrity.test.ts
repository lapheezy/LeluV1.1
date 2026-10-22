/**
 * ==========================================================
 * LÉLU — HONEST TASKS, ONE AVAILABILITY ANSWER, SANE PROVIDERS
 *
 * CATEGORY: unit + integration. Real TaskEngine, real
 * ToolRegistry, real AIProviderRegistry.
 *
 * Three unrelated-looking properties that are the same
 * property: the system must not report a capability or a
 * completion it does not have.
 *
 *  · A task was marked completed from the model's reply text.
 *  · Tool availability had two owners that could disagree, so a
 *    tool could be offered that could not run, or be runnable
 *    and never offered.
 *  · A credential the server had refused was retried every 30
 *    seconds forever, which is a failure reported as a retry.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
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

import TaskEngine from "../src/core/tasks/TaskEngine";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import AIProviderRegistry, {
  classifyProviderFailure,
  isAuthRejection,
} from "../src/core/AIProviderRegistry";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import { toolPermitted } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ------------------------------------------------------------------ *
 * 6D — A TASK RECORD IS NOT AN EXECUTION
 * ------------------------------------------------------------------ */

test("a conversational answer is recorded on a task without completing it", () => {
  const tasks = TaskEngine.getInstance();
  const task = tasks.create({
    goal: "Something with planned steps",
    steps: [
      { title: "Step one", description: "first" },
      { title: "Step two", description: "second" },
    ] as never,
  });
  tasks.start(task.id);

  tasks.recordAnswer(task.id, "Here is what I think you should do.");

  const stored = tasks.get(task.id);
  assert.ok(stored);
  assert.notEqual(stored.status, "completed", "a task was completed by a reply");
  assert.equal(stored.status, "waiting", `the task is ${stored.status}, not awaiting real execution`);
  for (const step of stored.steps) {
    assert.notEqual(step.status, "completed", "a step nothing ran was marked completed");
  }
  // The answer is kept — it is useful, it is just not evidence of work.
  assert.match(stored.steps[0].result ?? "", /what I think you should do/);
});

test("tools that really ran are named on the record", () => {
  const tasks = TaskEngine.getInstance();
  const task = tasks.create({ goal: "With real execution", steps: [{ title: "s", description: "d" }] as never });
  tasks.recordAnswer(task.id, "Wrote the file.", ["sandbox_write"]);
  assert.match(tasks.get(task.id)?.steps[0].result ?? "", /executed: sandbox_write/);
  // Still not completed: naming what ran is not the same as the step
  // being done, and only a real result may say that.
  assert.notEqual(tasks.get(task.id)?.status, "completed");
});

test("nothing completes a task from reply text any more", () => {
  const source = code("src/core/orchestrator/Orchestrator.ts");
  assert.ok(
    !/completeStep\(task\.id, step\.id, response\.text/.test(source),
    "Orchestrator still completes steps from the model's reply text",
  );
  assert.match(source, /recordAnswer\(/, "the conversational answer is not recorded at all");
  // And it no longer claims to be executing steps it does not execute.
  assert.ok(!/Executing \$\{task\.steps\.length\} steps/.test(source));
});

/* ------------------------------------------------------------------ *
 * 6E — ONE AUTHORITATIVE AVAILABILITY ANSWER
 * ------------------------------------------------------------------ */

test("only the registry writes availability", () => {
  const workspace = code("src/core/engineering/EngineeringWorkspace.ts");
  assert.ok(
    !/registry\.updateAvailability\(/.test(workspace),
    "EngineeringWorkspace still writes availability, so there are two owners again",
  );
  assert.match(workspace, /public async runtimeReachable\(\)/, "the probe is missing");

  const registry = code("src/core/tools/ToolRegistry.ts");
  assert.match(registry, /runtimeReachable\(\)/, "the registry does not consult the runtime probe");
  assert.match(
    registry,
    /"project\.read",/,
    "the registry does not own the project.* answer",
  );
});

test("a workspace command needs the gate AND a runtime, not either", () => {
  const registry = code("src/core/tools/ToolRegistry.ts");
  assert.match(
    registry,
    /workspace\.allowed\(op\) && runtimeReachable/,
    "workspace commands are offered on the autonomy gate alone, with no runtime to run on",
  );
});

test("with no development runtime, no project or workspace tool is offered", async () => {
  // This process has no /api/engineer, which is exactly the static
  // deployment case. The probe must fail closed.
  await ToolRegistry.getInstance().refreshAvailability();

  const offered = new Set(toolSchemasForModel().map((schema) => schema.name));
  for (const id of ["project_read", "project_write", "project_apply", "project_commit", "workspace_test", "workspace_build"]) {
    assert.ok(!offered.has(id), `${id} was offered with no runtime able to execute it`);
  }
  // And something that genuinely works here still is.
  assert.ok(offered.has("sandbox_write"), "nothing is offered at all, which is a different bug");
});

test("authorization is still the final word, not availability", async () => {
  const gate = AutonomyGate.getInstance();
  assert.ok(gate.can(3), "the default autonomy level regressed below L3");

  // Even at L3, and even if a runtime were reachable, the real project
  // needs a human grant. There is none in this process.
  assert.equal(toolPermitted("project.apply"), false, "L3 granted apply authority");
  assert.equal(toolPermitted("project.commit"), false, "L3 granted commit authority");

  const dispatcher = code("src/core/tools/ToolDispatcher.ts");
  assert.match(
    dispatcher,
    /authorizedWorkspaceExists\(\)/,
    "the human authorization check is gone from the permission predicate",
  );
});

test("the authorization grant's runtime-only scope is a documented decision", () => {
  const source = readFileSync("src/core/engineering/EngineeringAuthorization.ts", "utf8");
  assert.match(source, /private grants = new Map/, "grants are no longer held in the runtime");
  assert.match(
    source,
    /not persisted/i,
    "the decision not to persist grants is undocumented, so it reads as an oversight",
  );
});

/* ------------------------------------------------------------------ *
 * 6G — A REFUSED CREDENTIAL IS NOT A TRANSIENT FAILURE
 * ------------------------------------------------------------------ */

test("a refused credential is recognised, and a transient failure is not", () => {
  // The real message this repository logs on every boot.
  assert.equal(isAuthRejection("API request failed {status: 401, message: Wrong API Key}"), true);
  assert.equal(isAuthRejection("401 Unauthorized"), true);
  assert.equal(isAuthRejection("Invalid API key provided"), true);
  assert.equal(isAuthRejection("403 Forbidden"), true);

  // These must NOT be treated as refusals, or a dropped connection
  // would put a working provider to sleep for a quarter of an hour.
  assert.equal(isAuthRejection("fetch failed"), false);
  assert.equal(isAuthRejection("network timeout after 10000ms"), false);
  assert.equal(isAuthRejection("500 Internal Server Error"), false);
  assert.equal(isAuthRejection("529 overloaded"), false);
  assert.equal(isAuthRejection("ECONNRESET"), false);
});

test("a refused credential sits out far longer than a failed request", () => {
  const registry = new AIProviderRegistry();
  registry.markFailure("Flaky", "fetch failed");
  registry.markFailure("Refused", "API request failed {status: 401, message: Wrong API Key}");

  const transient = registry.cooldownFor("Flaky");
  const refused = registry.cooldownFor("Refused");
  assert.ok(refused > transient, `a refusal cools for ${refused}ms, a failure for ${transient}ms`);
  assert.ok(refused >= 10 * 60_000, "a refused credential is retried too soon to stop costing anything");
  assert.equal(registry.isInCooldown("Refused"), true);
  assert.equal(registry.isInCooldown("Flaky"), true);
});

test("a later ordinary failure does not shorten a refusal's cooldown", () => {
  const registry = new AIProviderRegistry();
  registry.markFailure("Sticky", "401 Unauthorized");
  const refused = registry.cooldownFor("Sticky");
  registry.markFailure("Sticky", "fetch failed");
  assert.equal(
    registry.cooldownFor("Sticky"),
    refused,
    "an ordinary failure reset a refused credential back to the short cooldown",
  );
});

test("a fixed credential can be tried again without a reload", () => {
  const registry = new AIProviderRegistry();
  registry.markFailure("Fixable", "401 Unauthorized");
  assert.equal(registry.isInCooldown("Fixable"), true);
  registry.clearFailure("Fixable");
  assert.equal(
    registry.isInCooldown("Fixable"),
    false,
    "a provider whose key was corrected cannot come back until a reload",
  );
});

test("a transient failure still allows the chain to recover quickly", () => {
  const registry = new AIProviderRegistry();
  registry.markFailure("Transient", "529 overloaded");
  assert.equal(registry.cooldownFor("Transient"), 30_000, "the transient cooldown changed");
});

test("a provider failure is classified by what someone would actually do about it", () => {
  // "failed" is not a diagnosis: these four need four different actions.
  assert.equal(classifyProviderFailure("API request failed {status: 401, message: Wrong API Key}"), "credential-refused");
  assert.equal(classifyProviderFailure("request timed out after 30000ms"), "timeout");
  assert.equal(classifyProviderFailure("fetch failed: ECONNRESET"), "network");
  assert.equal(classifyProviderFailure("503 Service Unavailable"), "server");
  assert.equal(classifyProviderFailure("something nobody has seen before"), "unknown");

  // Auth wins over the transport detail, so a refusal is never reported
  // as a timeout just because the socket also closed.
  assert.equal(classifyProviderFailure("401 Unauthorized: aborted"), "credential-refused");

  const registry = new AIProviderRegistry();
  registry.markFailure("Slow", "request timed out after 30000ms");
  registry.markFailure("Offline", "ECONNREFUSED");
  assert.equal(registry.failure("Slow")?.kind, "timeout");
  assert.equal(registry.failure("Offline")?.kind, "network");

  // The kind follows the latest failure, so a recovered network stops
  // reading as a timeout; a refusal stays sticky like its cooldown.
  registry.markFailure("Slow", "fetch failed");
  assert.equal(registry.failure("Slow")?.kind, "network");
  registry.markFailure("Offline", "401 Unauthorized");
  registry.markFailure("Offline", "fetch failed");
  assert.equal(registry.failure("Offline")?.kind, "credential-refused");
});
