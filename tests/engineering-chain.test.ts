/**
 * ==========================================================
 * LÉLU — THE CODING CHAIN, LINK BY LINK
 *
 * CATEGORY: unit. Real executors, real proxy handler, real sandbox
 * file system; no network (a write is refused before any request).
 *
 * Measured before these fixes, in the real app:
 *   - sandbox.execute and all six github.* tools were registered and
 *     marked AVAILABLE, but no model tool call could reach them; the
 *     dispatcher answered "There is no tool named …" for a tool the
 *     registry listed.
 *   - ToolRegistry.execute() was a second, five-entry dispatch table.
 *   - sandbox.write trimmed the content it was given (a read-back did
 *     not match what was written).
 *   - the GitHub proxy forwarded any write with the server's token and
 *     no identity at all — a plain request created a real branch.
 *   - validation ran `bun test`, which reports 20 failures on the
 *     unmodified project, where the project's own `npm test` passes.
 *   - a slow worker start was reported as code that "timed out".
 * The end-to-end evidence is scripts/verify-github-bridge.ts and the
 * report in docs/LELU_ENGINEERING_CHAIN_REPORT.md.
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

import ToolRegistry from "../src/core/tools/ToolRegistry";
import { dispatchToolCall, executableToolIds } from "../src/core/tools/ToolDispatcher";
import { ENGINEER_OPERATIONS, ENGINEER_OPERATION_TIMEOUT_MS } from "../plugins/engineerApi";
import { createGithubApi, writeTargetBranch } from "../plugins/githubApi";

const code = (path: string) => readFileSync(path, "utf8");
const call = (name: string, args: Record<string, unknown> = {}) =>
  dispatchToolCall({ id: `t-${name}`, name, arguments: args }, `test-${name}`);

/* ------------------------------ dispatch ------------------------------ */

test("every coding tool the registry declares has a real executor", () => {
  const executable = new Set(executableToolIds());
  for (const id of [
    "sandbox.read", "sandbox.write", "sandbox.execute",
    "project.copy", "project.list", "project.read", "project.write", "project.diff",
    "project.validate", "project.apply", "project.git", "project.commit",
    "github.auth", "github.repos", "github.files", "github.branches", "github.commits", "github.prs",
  ]) {
    assert.ok(ToolRegistry.getInstance().get(id), `${id} is registered`);
    assert.ok(executable.has(id), `${id} has an executor — registered and runnable are the same set`);
  }
});

test("a registered tool with no executor says so, not 'no such tool'", async () => {
  const unwired = ToolRegistry.getInstance().all().find((tool) => !executableToolIds().includes(tool.id));
  assert.ok(unwired, "there is at least one catalog-only tool to check against");
  const result = await call(unwired.id.replace(/\./g, "_"));
  assert.equal(result.ok, false);
  assert.match(result.content, /registered but has no executor/);
  const unknown = await call("definitely_not_a_tool");
  assert.equal(unknown.ok, false);
  assert.match(unknown.content, /no tool named/);
});

test("sandbox.write stores exactly what it was given", async () => {
  const content = "  console.log('LELU_SANDBOX_EXECUTION_OK');\n\n";
  const wrote = await call("sandbox_write", { path: "verification/exact.js", content });
  assert.equal(wrote.ok, true, wrote.content);
  const read = await call("sandbox_read", { path: "verification/exact.js" });
  assert.equal(read.content, content, "leading spaces and trailing newlines survive");
  const missing = await call("sandbox_write", { path: "verification/none.js" });
  assert.equal(missing.ok, false, "no content is not an empty file");
});

test("ToolRegistry.execute runs the same executors as a model tool call", async () => {
  const registry = ToolRegistry.getInstance();
  const wrote = await registry.execute("sandbox.write", { path: "verification/registry.js", content: "x\n" });
  assert.equal(wrote.ok, true, wrote.detail);
  const read = await registry.execute("sandbox.read", { path: "verification/registry.js" });
  assert.equal(read.ok, true);
  assert.equal(read.detail, "x\n");
  const unknown = await registry.execute("no.such.tool");
  assert.equal(unknown.ok, false);
});

/* ------------------------------- GitHub ------------------------------- */

test("a GitHub write with no signed-in identity is refused before any request", async () => {
  const registry = ToolRegistry.getInstance();
  for (const id of ["github.branches", "github.commits", "github.prs"]) registry.updateAvailability(id, true);
  const realFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    throw new Error("no request should be made");
  }) as typeof fetch;
  try {
    for (const [name, args] of [
      ["github_branches", { owner: "o", repo: "r", action: "create", name: "work" }],
      ["github_commits", { owner: "o", repo: "r", action: "commit", branch: "work", path: "a.md", content: "x", message: "m" }],
      ["github_prs", { owner: "o", repo: "r", action: "create", title: "t", head: "work", base: "main" }],
    ] as const) {
      const result = await call(name, args);
      assert.equal(result.ok, false, name);
      assert.match(result.content, /Nothing was written to GitHub/, name);
    }
    assert.equal(requests, 0, "the refusal happens before anything reaches the network");
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** Drive the real proxy handler with a fake request. */
function proxyRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const routes = new Map<string, (req: unknown, res: unknown, next: () => void) => void>();
  createGithubApi().attach({ use: (path, handler) => routes.set(path, handler as never) });
  const handler = routes.get("/api/github/proxy")!;
  return new Promise((resolve) => {
    const listeners: Record<string, (chunk?: unknown) => void> = {};
    const req = {
      method: "POST",
      url: "/",
      headers: { host: "localhost", ...headers },
      on: (event: string, fn: (chunk?: unknown) => void) => { listeners[event] = fn; },
    };
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (text: string) => resolve({ status: res.statusCode, json: JSON.parse(text) as Record<string, unknown> }),
    };
    handler(req, res, () => resolve({ status: 404, json: {} }));
    listeners.data?.(JSON.stringify(body));
    listeners.end?.();
  });
}

test("the proxy refuses every GitHub write without a verified identity", async () => {
  const saved = { token: process.env.GITHUB_TOKEN, url: process.env.VITE_SUPABASE_URL, push: process.env.LELU_ALLOW_PUSH };
  process.env.GITHUB_TOKEN = "test-token-not-used";
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  process.env.LELU_ALLOW_PUSH = "1";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("no request should reach GitHub"); }) as typeof fetch;
  try {
    for (const [method, endpoint] of [
      ["POST", "/repos/o/r/git/refs"],
      ["PUT", "/repos/o/r/contents/a.md"],
      ["PATCH", "/repos/o/r/git/refs/heads/work"],
      ["DELETE", "/repos/o/r/git/refs/heads/work"],
    ]) {
      const { status, json } = await proxyRequest({ endpoint, method, body: {} });
      assert.equal(json.ok, false, `${method} ${endpoint}`);
      assert.ok(status >= 400, `${method} ${endpoint} → ${status}`);
      assert.match(String(json.error), /GitHub write refused/);
    }
  } finally {
    globalThis.fetch = realFetch;
    if (saved.token === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = saved.token;
    if (saved.url !== undefined) process.env.VITE_SUPABASE_URL = saved.url;
    if (saved.push === undefined) delete process.env.LELU_ALLOW_PUSH; else process.env.LELU_ALLOW_PUSH = saved.push;
  }
});

test("the proxy knows which branch a write would change", () => {
  assert.equal(writeTargetBranch("/repos/o/r/contents/a.md", "PUT", { branch: "work" }), "work");
  assert.equal(writeTargetBranch("/repos/o/r/contents/a.md", "PUT", {}), "", "no branch = the default branch");
  assert.equal(writeTargetBranch("/repos/o/r/git/refs/heads/main", "PATCH", {}), "main");
  assert.equal(writeTargetBranch("/repos/o/r/git/refs/heads/feature%2Fx", "DELETE", {}), "feature/x");
  assert.equal(writeTargetBranch("/repos/o/r/merges", "POST", { base: "main" }), "main");
  assert.equal(writeTargetBranch("/repos/o/r/git/refs", "POST", { ref: "refs/heads/new" }), null, "creating a branch changes none");
  const proxy = code("plugins/githubApi.ts");
  assert.match(proxy, /target === "" \|\| target === defaultBranch/, "the default branch is refused");
  assert.match(proxy, /process\.env\.LELU_ALLOW_PUSH !== "1"/, "publishing needs the same switch as git push");
  assert.ok(!/Rate limited — too many requests/.test(proxy), "a second request waits its turn instead of failing");
});

/* ----------------------------- validation ----------------------------- */

test("validation runs the project's own test suite, with time to finish", () => {
  assert.equal(ENGINEER_OPERATIONS.test, "npm test");
  assert.ok(ENGINEER_OPERATION_TIMEOUT_MS.test >= 600_000, "measured: the suite takes about 6.5 minutes");
  const workspace = code("src/core/engineering/EngineeringWorkspace.ts");
  const validate = workspace.slice(workspace.indexOf("public async validate("), workspace.indexOf("if (typeof data.status", workspace.indexOf("public async validate(")));
  assert.ok(validate.length > 0 && !/timeoutMs/.test(validate), "validate() does not cap the suite at 3 minutes");
  assert.match(code("src/core/engineering/WorkspaceRuntime.ts"), /exitCode: outcome\.exitCode \?\? \(outcome\.ok \? 0 : 1\)/, "the real exit status is kept");
  const node = code("plugins/nodeAdapters.ts");
  assert.match(node, /process\.kill\(-child\.pid, "SIGKILL"\)/, "a timed-out command's whole process tree is stopped");
});

/* ------------------------------- sandbox ------------------------------ */

test("the execution timeout starts when the job starts, not when the worker is created", () => {
  const worker = code("src/core/engineering/sandbox.worker.ts");
  assert.match(worker, /scope\.postMessage\(\{ type: "started", id: job\?\.id \?\? "" \}\)/);
  const runtime = code("src/core/engineering/SandboxRuntime.ts");
  assert.match(runtime, /type === "started"/);
  assert.match(runtime, /did not start within \$\{BOOT_TIMEOUT_MS\} ms; nothing was executed/, "a boot failure is not called a timeout");
  assert.match(runtime, /fail\(`Timed out after \$\{timeoutMs\} ms — execution was terminated\.`, true, 124, timeoutMs\)/);
});

/* --------------------------- chat → the model -------------------------- */

test("a request that names a tool reaches the model, not a keyword scaffold", () => {
  const router = code("src/core/AIRouter.ts");
  assert.match(router, /const namesTool = this\.namesAnOfferedTool\(context\);/);
  assert.match(router, /if \(!this\.modelCanDoEngineeringWork\(context\) && !namesTool\) \{\s*const creative = await this\.creative\.execute\(context\);/);
  assert.match(code("src/core/cognition/CognitiveContext.ts"), /that request is the confirmation — do it, do not ask again/);
});

test("naming the model's tools keeps device and project keyword resolvers out of the turn", () => {
  // Measured: a self-improvement request naming browser_capture and
  // project_copy fired a CAMERA capture ("capture") and was answered by
  // ProjectResolver with a toy scaffold — the model never saw it.
  const router = code("src/core/AIRouter.ts");
  assert.match(router, /if \(!namesTool\) \{\s*const tools = await this\.tools\.execute\(context\);/);
  assert.match(router, /!this\.modelCanRunWorkflow\(context\) &&\s*!namesTool\s*\) \{\s*const projectResult = await this\.projects\.execute/);
  assert.match(router, /if \(!namesTool\) \{\s*const browser = await this\.browser\.execute\(context\);/);
});

test("the dev server does not watch LÉLU's workspace copies", () => {
  // Measured: creating a workspace copy made Vite force a full reload of
  // the live app (tsconfig in .lelu-sandbox) — her own chat turn with it.
  assert.match(code("vite.config.ts"), /watch:\s*\{\s*ignored:\s*\[[^\]]*\.lelu-sandbox/);
});
