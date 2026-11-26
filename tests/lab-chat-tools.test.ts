/**
 * The laboratory has to be reachable from the conversation, through the ONE
 * tool table — not a second registry, not a parallel dispatch path.
 *
 * Two things are checked here:
 *   • wiring: every declared laboratory tool has an executor, is in the
 *     dispatch table and is in the registry (a declared tool with no executor
 *     is never offered, but it is still a lie in the capability list);
 *   • honesty: a refusal is a refusal. An empty answer that looks like a
 *     repository with no findings is the failure mode this suite exists for.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import ToolRegistry from "../src/core/tools/ToolRegistry";
import { executableToolIds, executorParameters } from "../src/core/tools/ToolDispatcher";
import { LAB_EXECUTORS, LAB_TOOL_DEFINITIONS } from "../src/core/selfdev/lab/LabTools";

const realFetch = globalThis.fetch;

function stubLab(routes: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const key = Object.keys(routes).find((candidate) => url.endsWith(candidate));
    const payload = key ? routes[key] : { ok: false, error: `no stub for ${url}` };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const statusPayload = {
  ok: true,
  token: "test-token",
  root: "repo",
  repository: {
    remote: "https://github.com/lapheezy/LeluV1.1",
    fullName: "lapheezy/LeluV1.1",
    branch: "freebuff/test",
    head: { sha: "abc1234def", shortSha: "abc1234", subject: "Add the laboratory", author: "LÉLU", date: "2026-11-26T00:00:00Z" },
    dirty: 2,
    dirtyFiles: ["plugins/labApi.ts", "tests/x.test.ts"],
    branches: 3,
    branchList: ["main", "freebuff/test", "lelu-lab/exp-1"],
    ahead: 1,
    behind: 0,
  },
  github: { reachable: true, heads: 75, checkedAt: Date.now() },
  sync: null,
  discoveries: [],
  experiments: [],
  worktrees: [{ path: ".", head: "abc1234", branch: "freebuff/test" }],
  scheduler: { running: true, pid: 4242, cycles: 7, lastCycleAt: Date.now() - 60000, nextAt: Date.now() + 3600000, intervalMs: 86400000, mode: "daemon", lastError: null, lastDiscoveryId: "disc-1", lastFindings: 4, startedAt: Date.now() - 3600000, ok: true },
  commands: [{ id: "typecheck", label: "Typecheck" }],
  boundaries: { pushes: false, merges: false, productionDeploy: false },
};

describe("laboratory tools are wired through the one dispatch table", () => {
  test("every declared tool has an executor with the same id", () => {
    assert.ok(LAB_TOOL_DEFINITIONS.length >= 8, `expected the laboratory tool set, found ${LAB_TOOL_DEFINITIONS.length}`);
    const executorIds = new Set(LAB_EXECUTORS.map((executor) => executor.id));
    for (const definition of LAB_TOOL_DEFINITIONS) {
      assert.ok(executorIds.has(definition.id), `${definition.id} is declared but has no executor`);
    }
    assert.equal(executorIds.size, LAB_TOOL_DEFINITIONS.length, "an executor exists with no declared tool");
  });

  test("the dispatcher offers them, with the schema the registry declares", () => {
    const executable = new Set(executableToolIds());
    for (const definition of LAB_TOOL_DEFINITIONS) {
      assert.ok(executable.has(definition.id), `${definition.id} is not in the dispatch table, so it can never run`);
      assert.ok(executorParameters(definition.id), `${definition.id} would be offered with no parameters`);
      const registered = ToolRegistry.getInstance().get(definition.id);
      assert.ok(registered, `${definition.id} is not in the registry`);
      assert.equal(registered?.available, true);
    }
  });

  test("none of them can publish, and none is destructive", () => {
    for (const definition of LAB_TOOL_DEFINITIONS) {
      assert.ok(definition.riskLevel <= 1, `${definition.id} may not exceed local-state risk`);
      assert.ok(definition.permissions.includes("READ"), `${definition.id} must be able to read`);
      assert.equal(definition.permissions.includes("DESTRUCTIVE"), false, `${definition.id} must not be destructive`);
      assert.equal(/push|merge|deploy|publish/i.test(definition.description), false, `${definition.id} must not claim to publish`);
    }
  });
});

describe("a laboratory tool reports what the runtime actually said", () => {
  test("lab.repository returns the real branch, head and scheduler state", async () => {
    stubLab({ "/api/lab/status": statusPayload, "/api/lab/tree": { ok: true, path: ".", entries: [{ name: "src", path: "src", type: "dir" }] } });
    const tool = LAB_EXECUTORS.find((executor) => executor.id === "lab.repository");
    assert.ok(tool);
    const result = await tool.run({});
    assert.equal(result.ok, true);
    assert.match(result.content, /freebuff\/test/);
    assert.match(result.content, /abc1234/);
    assert.match(result.content, /75 remote heads/);
    assert.match(result.content, /running \(pid 4242\)/);
    assert.match(result.content, /pushes=false/);
  });

  test("lab.diff with no experiment refuses instead of showing an empty diff", async () => {
    stubLab({
      "/api/lab/status": statusPayload,
      "/api/lab/experiment": { ok: true, experiments: [] },
    });
    const tool = LAB_EXECUTORS.find((executor) => executor.id === "lab.diff");
    assert.ok(tool);
    const result = await tool.run({});
    assert.equal(result.ok, false, "an empty diff would look like a change that was never made");
    assert.match(result.content, /No experiment/);
  });

  test("lab.diff shows the exact patch against the baseline", async () => {
    stubLab({
      "/api/lab/status": statusPayload,
      "/api/lab/experiment": {
        ok: true,
        experiments: [
          {
            id: "exp-1",
            branch: "lelu-lab/exp-1",
            root: ".lelu-lab/experiments/exp-1",
            createdAt: 1,
            baseCommit: "b56f21e4",
            baseBranch: "freebuff/test",
            baselineCommit: "aaa1111",
            overlaidFiles: [],
            preview: null,
            commit: { sha: "374284a1", at: 2, message: "Fix the typecheck" },
          },
        ],
      },
    });
    // The same route answers list and diff: the stub distinguishes by method body.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      if (url.endsWith("/api/lab/experiment")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
        const payload =
          body.action === "diff"
            ? {
                ok: true,
                diff: {
                  branch: "lelu-lab/exp-1",
                  baseCommit: "aaa1111",
                  head: "374284a1",
                  stat: " plugins/engineerApi.ts | 19 +++++++++++++++----",
                  files: [
                    {
                      path: "plugins/engineerApi.ts",
                      addedLines: 15,
                      removedLines: 4,
                      status: "modified",
                      patch: "--- a/plugins/engineerApi.ts\n+++ b/plugins/engineerApi.ts\n@@\n-bun tsc -b --noEmit\n+npx tsc -b --force\n",
                    },
                  ],
                },
              }
            : {
                ok: true,
                experiments: [
                  {
                    id: "exp-1",
                    branch: "lelu-lab/exp-1",
                    root: ".lelu-lab/experiments/exp-1",
                    createdAt: 1,
                    baseCommit: "b56f21e4",
                    baseBranch: "freebuff/test",
                    baselineCommit: "aaa1111",
                    overlaidFiles: [],
                    preview: null,
                    commit: { sha: "374284a1", at: 2, message: "Fix the typecheck" },
                  },
                ],
              };
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: false, error: "unexpected" }), text: async () => "{}" } as unknown as Response;
    }) as typeof fetch;

    const tool = LAB_EXECUTORS.find((executor) => executor.id === "lab.diff");
    assert.ok(tool);
    const result = await tool.run({ experiment: "exp-1" });
    assert.equal(result.ok, true);
    assert.match(result.content, /Baseline aaa1111 → 374284a/);
    assert.match(result.content, /\+15 \/ −4/);
    assert.match(result.content, /npx tsc -b --force/);
  });
});

describe("a laboratory result says where it came from and what it cannot support", () => {
  /*
   * Mission 44.2, measured: asked to summarise the journal, Lélu reproduced the
   * real rows and then narrated them as "building four objects — three zones,
   * one hub, three links". The rows were true; the sentence was invented. The
   * tool result is the only place that can say "these are recorded titles",
   * so it says it — deterministically, without touching failures.
   */
  test("lab.repository carries SOURCE and LIMITS", async () => {
    stubLab({ "/api/lab/status": statusPayload, "/api/lab/tree": { ok: true, path: ".", entries: [] } });
    const tool = LAB_EXECUTORS.find((executor) => executor.id === "lab.repository");
    assert.ok(tool);
    const result = await tool.run({});
    assert.equal(result.ok, true);
    assert.match(result.content, /\n—\nSOURCE: .*lab\.repository/);
    assert.match(result.content, /LIMITS: .*does not know what a commit changed/);
  });

  test("lab.history says its rows are records, not descriptions", async () => {
    stubLab({
      "/api/lab/status": statusPayload,
      "/api/lab/journal": { ok: true, entries: [{ at: Date.now(), kind: "experiment-commit", id: "exp-1" }] },
      "/api/lab/commits": { ok: true, commits: [] },
    });
    const tool = LAB_EXECUTORS.find((executor) => executor.id === "lab.history");
    assert.ok(tool);
    const result = await tool.run({ source: "journal" });
    assert.equal(result.ok, true);
    assert.match(result.content, /experiment-commit/);
    assert.match(
      result.content,
      /are NOT in the record|does not contain it/,
      "the result must forbid inventing what an entry did",
    );
  });

  test("a failure keeps its own words and gains no footer", async () => {
    stubLab({ "/api/lab/status": statusPayload, "/api/lab/experiment": { ok: true, experiments: [] } });
    const tool = LAB_EXECUTORS.find((executor) => executor.id === "lab.diff");
    assert.ok(tool);
    const result = await tool.run({});
    assert.equal(result.ok, false);
    assert.equal(/SOURCE:/.test(result.content), false, "a refusal must not be dressed up as sourced evidence");
  });
});

describe("laboratory findings reach the ONE development journal", () => {
  test("a successful laboratory tool asks the bridge to import its record", async () => {
    // The bridge (LabJournalBridge) is idempotent and has always been able to
    // import the lab journal into the DevelopmentJournal, but nothing called
    // it, so a real inspection left the journal empty. The wiring lives in the
    // executor path, and this is the check that keeps it there.
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      seen.push(url);
      const payload = url.endsWith("/api/lab/status")
        ? statusPayload
        : url.endsWith("/api/lab/tree")
          ? { ok: true, path: ".", entries: [{ name: "src", path: "src", type: "dir" }] }
          : url.endsWith("/api/lab/journal")
          ? { ok: true, entries: [] }
          : { ok: false, error: `no stub for ${url}` };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    }) as typeof fetch;

    const tool = LAB_EXECUTORS.find((executor) => executor.id === "lab.repository");
    assert.ok(tool);
    const result = await tool.run({});
    assert.equal(result.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(
      seen.some((url) => url.endsWith("/api/lab/journal")),
      `the journal import was never requested (saw ${seen.join(", ")})`,
    );
  });
});
