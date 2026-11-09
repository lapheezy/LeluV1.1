/**
 * ==========================================================
 * LÉLU — A PROPOSAL'S CHANGE IS GENERATED, CHECKED AND REVERSIBLE
 *
 * CATEGORY: unit + integration (real Node engineering adapter on a
 * throwaway project directory). No network, no model: the model is a
 * scripted function, so what is asserted is the engineering logic.
 *
 * Pins Phase 6 defects found by the audit at 665f849:
 *  - develop() ran checks on an unchanged sandbox and reported Ready —
 *    ProposalEngineer now produces the change, and refuses one it
 *    cannot ground in the real files;
 *  - a failed post-apply verification had nothing to roll back to —
 *    applyWorkspace now keeps a backup and rollbackApply restores it;
 *  - the targeted check operations accept only strict project paths.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ProposalEngineer, { applyEdits, extractJson, type ProposalSourceAccess } from "../src/core/selfdev/ProposalEngineer";
import { createNodeEngineerAdapter } from "../plugins/nodeAdapters";
import { TARGETED_OPERATIONS } from "../plugins/engineerApi";
import { recoverInterrupted, type ImprovementProposal } from "../src/core/selfdev/ImprovementQueue";

const proposal = {
  id: "p1",
  title: "Clamp the edge size",
  problem: "EDGE can exceed the panel width.",
  observation: "",
  evidence: "measured",
  proposedSolution: "Clamp EDGE to 40.",
  expectedBenefit: "No overflow.",
  testPlan: "unit test",
} as unknown as ImprovementProposal;

const sources: Record<string, string> = {
  "src/core/edge.ts": "export const EDGE = 48;\nexport function edge() {\n  return EDGE;\n}\n",
  "src/core/other.ts": "export const OTHER = 1;\n",
};

const access: ProposalSourceAccess = {
  listSources: async () => Object.keys(sources),
  listTests: async () => ["tests/edge.test.ts"],
  read: async (p) => sources[p] ?? null,
};

test("edits: exact unique search/replace, new files only under src/ or tests/, nothing outside what was inspected", () => {
  const ok = applyEdits(sources, [{ path: "src/core/edge.ts", search: "EDGE = 48", replace: "EDGE = 40" }]);
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.files[0].content.startsWith("export const EDGE = 40;"), true);

  const ambiguous = applyEdits({ "a.ts": "x x" }, [{ path: "a.ts", search: "x", replace: "y" }]);
  assert.equal(ambiguous.ok, false);
  assert.match(!ambiguous.ok ? ambiguous.error : "", /matches 2 times/);

  const uninspected = applyEdits(sources, [{ path: "src/secret.ts", search: "a", replace: "b" }]);
  assert.match(!uninspected.ok ? uninspected.error : "", /not inspected/);

  const escape = applyEdits(sources, [{ path: "src/../plugins/x.ts", create: "x" }]);
  assert.equal(escape.ok, false);
  const outside = applyEdits(sources, [{ path: "plugins/engineerApi.ts", create: "x" }]);
  assert.equal(outside.ok, false);

  const noop = applyEdits(sources, [{ path: "src/core/edge.ts", search: "EDGE = 48", replace: "EDGE = 48" }]);
  assert.deepEqual(noop.ok && noop.files, [], "an edit that changes nothing is not a change");

  assert.deepEqual(extractJson('Sure:\n```json\n{"a": "}"}\n```'), { a: "}" });
  assert.equal(extractJson("no json here"), null);
});

test("generate: selects real files only, reads them, returns the change, the plan and the agent that answered", async () => {
  const calls: string[] = [];
  const engineer = new ProposalEngineer(async (prompt) => {
    calls.push(prompt);
    if (calls.length === 1) {
      return { text: '{"files": ["src/core/edge.ts", "src/invented.ts"], "tests": ["tests/edge.test.ts"]}', provider: "anthropic", model: "test-model" };
    }
    assert.match(prompt, /=== src\/core\/edge\.ts ===\nexport const EDGE = 48;/, "the real file content is in context");
    return {
      text: JSON.stringify({
        plan: "Clamp EDGE and test it.",
        edits: [
          { path: "src/core/edge.ts", search: "export const EDGE = 48;", replace: "export const EDGE = Math.min(48, 40);" },
          { path: "tests/edge-clamp.test.ts", create: "import test from 'node:test';\ntest('x', () => {});\n" },
        ],
      }),
      provider: "anthropic",
      model: "test-model",
    };
  });
  const result = await engineer.generate(proposal, access);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.agent, "anthropic/test-model");
  assert.deepEqual(result.filesInspected, ["src/core/edge.ts"], "the invented path was dropped");
  assert.deepEqual(result.files.map((f) => `${f.created ? "+" : "~"}${f.path}`), ["~src/core/edge.ts", "+tests/edge-clamp.test.ts"]);
  assert.deepEqual(result.tests, ["tests/edge.test.ts", "tests/edge-clamp.test.ts"]);
});

test("generate: no usable change is a failure with the reason — never an empty success", async () => {
  const noEdits = new ProposalEngineer(async (prompt) =>
    prompt.startsWith("Pick")
      ? { text: '{"files": ["src/core/edge.ts"]}' }
      : { text: '{"plan": "nothing", "edits": []}', provider: "p", model: "m" },
  );
  const a = await noEdits.generate(proposal, access);
  assert.equal(a.ok, false);
  assert.match(a.error ?? "", /proposed no edits/);

  const invented = new ProposalEngineer(async () => ({ text: '{"files": ["src/made-up.ts"]}' }));
  const b = await invented.generate(proposal, access);
  assert.equal(b.ok, false);
  assert.match(b.error ?? "", /no file that exists/);
});

test("the real adapter: apply keeps a backup and rollbackApply restores modified files and removes created ones", async () => {
  const project = mkdtempSync(path.join(tmpdir(), "lelu-rollback-"));
  const cwd = process.cwd();
  try {
    mkdirSync(path.join(project, "src"), { recursive: true });
    writeFileSync(path.join(project, "src", "edge.ts"), "export const EDGE = 48;\n");
    process.chdir(project);
    const adapter = createNodeEngineerAdapter("test");
    await adapter.createWorkspace("ws");
    const copyRoot = path.join(project, ".lelu-sandbox", "ws");
    writeFileSync(path.join(copyRoot, "src", "edge.ts"), "export const EDGE = 40;\n");
    writeFileSync(path.join(copyRoot, "src", "added.ts"), "export const ADDED = true;\n");

    const applied = await adapter.applyWorkspace("ws", []);
    assert.deepEqual(applied.sort(), ["src/added.ts", "src/edge.ts"]);
    assert.equal(readFileSync(path.join(project, "src", "edge.ts"), "utf8"), "export const EDGE = 40;\n");
    assert.ok(existsSync(path.join(project, ".lelu-sandbox", "ws.apply-backup.json")), "backup written before the apply");

    const diffAfter = await adapter.diffWorkspace("ws");
    assert.ok(!diffAfter.some((c) => c.path.includes("apply-backup")), "the backup is never part of a diff");

    assert.ok(adapter.rollbackApply, "the Node adapter can roll back");
    const restored = await adapter.rollbackApply!("ws");
    assert.deepEqual(restored.sort(), ["src/added.ts", "src/edge.ts"]);
    assert.equal(readFileSync(path.join(project, "src", "edge.ts"), "utf8"), "export const EDGE = 48;\n", "modified file restored");
    assert.equal(existsSync(path.join(project, "src", "added.ts")), false, "created file removed");
    await assert.rejects(adapter.rollbackApply!("ws"), /No apply to roll back/, "a backup is used once");
  } finally {
    process.chdir(cwd);
    rmSync(project, { recursive: true, force: true });
  }
});

test("targeted check operations accept only strict project-relative paths", () => {
  const syntax = TARGETED_OPERATIONS["syntax-files"].pattern;
  const tests = TARGETED_OPERATIONS["test-files"].pattern;
  assert.ok(syntax.test("src/core/selfdev/ProposalEngineer.ts"));
  assert.ok(!syntax.test("src/x.ts; rm -rf /"));
  assert.ok(!syntax.test("/etc/passwd.ts"));
  assert.ok(tests.test("tests/proposal-engineering.test.ts"));
  assert.ok(!tests.test("tests/../plugins/x.test.ts"));
  assert.ok(!tests.test("tests/a.test.ts && curl x"));
});

test("a proposal saved mid-run is not left showing in progress after a reload", () => {
  const stored = [
    { ...proposal, id: "a", status: "In Development", lastExecution: { executionId: "e1", kind: "develop", started: 1, filesInspected: [], filesChanged: [], checks: [] } },
    { ...proposal, id: "b", status: "Applying" },
    { ...proposal, id: "c", status: "Ready" },
  ] as ImprovementProposal[];
  const recovered = recoverInterrupted(stored, 99);
  assert.deepEqual(recovered.map((p) => p.status), ["Failed", "Failed", "Ready"]);
  assert.match(recovered[0].lastExecution?.error ?? "", /Interrupted: the development run stopped/);
  assert.equal(recovered[0].lastExecution?.outcome, "Failed");
  const untouched = [{ ...proposal, id: "d", status: "Proposed" }] as ImprovementProposal[];
  assert.equal(recoverInterrupted(untouched), untouched, "nothing to recover returns the same array");
});
