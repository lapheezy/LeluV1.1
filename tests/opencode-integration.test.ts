/**
 * ==========================================================
 * LÉLU — OPENCODE INTEGRATION
 *
 * The adapter is real, the registration is real, and the refusal is
 * real. This environment has no OpenCode server, so every test here
 * asserts the honest branch: not configured, never substituted.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { afterEach, beforeEach, describe } from "node:test";

import { openCodeHealth, runOpenCodeTask } from "../plugins/integration/opencode.ts";
import OpenCodeBackend from "../src/core/engineering/OpenCodeBackend.ts";
import EngineeringOrchestrator from "../src/core/engineering/EngineeringOrchestrator.ts";

const realFetch = globalThis.fetch;
const realBase = process.env.OPENCODE_BASE_URL;

beforeEach(() => {
  delete process.env.OPENCODE_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realBase === undefined) delete process.env.OPENCODE_BASE_URL;
  else process.env.OPENCODE_BASE_URL = realBase;
});

describe("OpenCode server adapter", () => {
  test("an unset base URL reports not_configured and contacts nothing", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be contacted");
    }) as typeof fetch;

    const health = await openCodeHealth();
    assert.equal(health.state, "not_configured");
    assert.equal(health.contacted, false);
    assert.match(health.detail, /OPENCODE_BASE_URL is unset/);
    assert.equal(called, false);
  });

  test("a task is refused, not redirected to another engine, when unconfigured", async () => {
    const result = await runOpenCodeTask({ objective: "add a test for the router" });
    assert.equal(result.ok, false);
    assert.equal(result.state, "not_configured");
    assert.equal(result.contacted, false);
    assert.match(result.detail, /nothing was dispatched/);
    assert.deepEqual(result.changedFiles, []);
  });

  test("a configured but unreachable server is unavailable, with the real error", async () => {
    process.env.OPENCODE_BASE_URL = "http://127.0.0.1:1";
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const health = await openCodeHealth();
    assert.equal(health.state, "unavailable");
    assert.equal(health.contacted, true);
    assert.match(health.detail, /ECONNREFUSED/);
  });

  test("a reachable server's health is reported as contacted", async () => {
    process.env.OPENCODE_BASE_URL = "http://opencode.test/";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /^http:\/\/opencode\.test\/health$/);
      return { ok: true, status: 200, json: async () => ({ healthy: true }) } as Response;
    }) as typeof fetch;

    const health = await openCodeHealth();
    assert.equal(health.state, "healthy");
    assert.equal(health.contacted, true);
  });
});

describe("OpenCode backend registration", () => {
  test("health is transported from the server route, including not_configured", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/integration/opencode/health");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          state: "not_configured",
          detail: "OPENCODE_BASE_URL is unset",
          contacted: false,
        }),
      } as Response;
    }) as typeof fetch;

    const health = await new OpenCodeBackend().health();
    assert.equal(health.state, "not_configured");
    assert.equal(health.contacted, false);
  });

  test("the orchestrator refuses to select an unconfigured OpenCode", async () => {
    const orchestrator = EngineeringOrchestrator.getInstance();
    orchestrator.resetForTests();
    orchestrator.registerBackend(new OpenCodeBackend());
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ state: "not_configured", detail: "OPENCODE_BASE_URL is unset", contacted: false }),
      }) as Response) as typeof fetch;

    const selected = await orchestrator.selectEngine({
      id: "t1",
      objective: "change one file",
      repository: "lelu",
      workspaceId: "ws-1",
      engine: "opencode",
    });
    assert.equal(selected.engine, null);
    assert.match(selected.reason, /not_configured/);
    assert.match(selected.reason, /OPENCODE_BASE_URL/);
    orchestrator.resetForTests();
  });

  test("a task runs only when a backend reports itself usable", async () => {
    const orchestrator = EngineeringOrchestrator.getInstance();
    orchestrator.resetForTests();
    orchestrator.registerBackend({
      id: "opencode",
      name: "OpenCode",
      source: "stub",
      async health() {
        return { state: "healthy", detail: "stub server answered", checkedAt: Date.now(), contacted: true };
      },
      async run(task) {
        return {
          ok: true,
          engine: "opencode",
          summary: `handled: ${task.objective}`,
          changedFiles: ["src/x.ts"],
          commands: [{ command: "npm test", exitCode: 0, output: "1 passed" }],
          tests: { passed: 1, failed: 0, failures: [], ran: true, command: "npm test" },
          artifacts: [],
        };
      },
    });

    const outcome = await orchestrator.run({
      id: "t2",
      objective: "rename a symbol",
      repository: "lelu",
      workspaceId: "ws-2",
      engine: "opencode",
      checks: ["test"],
    });
    assert.equal(outcome.engine, "opencode");
    assert.equal(outcome.ran, true);
    assert.equal(outcome.verification.verified, true);
    orchestrator.resetForTests();
  });
});
