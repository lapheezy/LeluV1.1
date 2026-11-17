/**
 * The isolated workspace the development loop works in, checked against the
 * live local runtime. No model is involved: the edit below is a labelled
 * PROBE that exercises the mechanics, not a correction of anything.
 *
 *   copy → edit IN THE COPY → diff → syntax / relevant test / typecheck
 *   IN THE COPY → the real tree is byte-for-byte unchanged → the
 *   production boundary (request-apply, apply, git commit/push) refuses
 *   → the copy is removed
 *
 *   LELU_ENGINEER_TOKEN=<local runtime token> node isolated-workspace-check.mjs http://127.0.0.1:5173 <out.json>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const base = (process.argv[2] ?? "http://127.0.0.1:5173").replace(/\/+$/, "");
const outPath = process.argv[3] ?? "isolated-workspace-check.json";
const token = process.env.LELU_ENGINEER_TOKEN ?? "";
const post = async (route, body) => {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lelu-token": token },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  return { http: response.status, ...data };
};

const TARGET = "src/core/selfdev/DevelopmentRecord.ts";
const TEST = "tests/development-gates.test.ts";
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const realBefore = { [TARGET]: hash(TARGET), gitStatus: execSync("git status --porcelain").toString() };

const id = `ws-probe-${Date.now().toString(36)}`;
const steps = [];
const step = (name, ok, detail) => steps.push({ name, ok, detail });

const created = await post("/api/engineer/workspace", { action: "create", workspace: id });
step("copy", created.ok === true, `${created.workspace?.fileCount ?? 0} files in .lelu-sandbox/${id}`);

const original = await post("/api/engineer/read", { workspace: id, path: TARGET });
const probe = `${original.content}\n// workspace-isolation probe (not a change to LÉLU)\nexport const __WORKSPACE_PROBE__ = true;\n`;
const wrote = await post("/api/engineer/write", { workspace: id, path: TARGET, content: probe });
step("edit in copy", wrote.ok === true, TARGET);

const diff = await post("/api/engineer/workspace", { action: "diff", workspace: id, includePatch: true });
const changed = (diff.changes ?? []).map((c) => c.path);
step("diff shows only the probe", changed.length === 1 && changed[0] === TARGET, changed.join(", "));

const syntax = await post("/api/engineer/command", { workspace: id, operation: "syntax-files", files: [TARGET], timeoutMs: 240_000 });
step("syntax (copy)", syntax.status === 0, `exit ${syntax.status}`);
const tests = await post("/api/engineer/command", { workspace: id, operation: "test-files", files: [TEST], timeoutMs: 240_000 });
step("relevant test (copy)", tests.status === 0, `${TEST}: exit ${tests.status}; ${String(tests.stdout ?? tests.output ?? "").match(/# (pass|fail) \d+/g)?.join(", ") ?? ""}`);
const typecheck = await post("/api/engineer/command", { workspace: id, operation: "typecheck" });
step("typecheck (copy)", typecheck.status === 0, `exit ${typecheck.status}`);

const realAfter = { [TARGET]: hash(TARGET), gitStatus: execSync("git status --porcelain").toString() };
step("real tree unchanged", realAfter[TARGET] === realBefore[TARGET] && realAfter.gitStatus === realBefore.gitStatus, "sha256 of the target and git status identical before/after");

// Production boundary: every route that writes the real project or its history.
const requestApply = await post("/api/engineer/workspace", { action: "request-apply", workspace: id });
step("request-apply refused", requestApply.ok !== true, `HTTP ${requestApply.http}: ${String(requestApply.error ?? "").slice(0, 160)}`);
const apply = await post("/api/engineer/workspace", { action: "apply", workspace: id, grant: "forged" });
step("apply refused", apply.ok !== true, `HTTP ${apply.http}: ${String(apply.error ?? "").slice(0, 160)}`);
const commit = await post("/api/engineer/git", { action: "commit", message: "probe" });
step("git commit refused", commit.ok !== true, `HTTP ${commit.http}: ${String(commit.error ?? "").slice(0, 160)}`);
const push = await post("/api/engineer/git", { action: "push" });
step("git push refused", push.ok !== true, `HTTP ${push.http}: ${String(push.error ?? "").slice(0, 160)}`);
const noToken = await fetch(`${base}/api/engineer/workspace`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list" }) });
step("no token → refused", noToken.status === 401 || noToken.status === 503, `HTTP ${noToken.status}`);

const removed = await post("/api/engineer/workspace", { action: "remove", workspace: id });
step("copy removed", removed.ok === true && !existsSync(`.lelu-sandbox/${id}`), id);
step("real tree still unchanged", hash(TARGET) === realBefore[TARGET] && execSync("git status --porcelain").toString() === realBefore.gitStatus, "after cleanup");

const summary = { base, workspace: id, passed: steps.filter((s) => s.ok).length, total: steps.length, steps };
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(steps.every((s) => s.ok) ? 0 : 1);
