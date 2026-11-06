/**
 * ==========================================================
 * LÉLU — THE SECURITY INTEGRATIONS, RUN FOR REAL
 *
 * CATEGORY: integration. These tests execute the actual
 * binaries in .tools/ when they are present:
 *
 *   • OPA: the Rego policy and the reference evaluator are
 *     compared on the same inputs, so a divergence between the
 *     server's decision and the browser's fails here;
 *   • Gitleaks: a real secret is planted in a real temporary
 *     directory and must be found — with its VALUE withheld;
 *   • a missing scanner must report "did not run", never "clean".
 *
 * When a binary is absent the test SKIPS with the reason
 * printed. A skip is not a pass and is reported as such.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluatePolicy, type PolicyInput } from "../src/core/security/policy";
import { detectOpa, evaluateWithOpa } from "../plugins/integration/opa";
import { runGitleaks, runSecurityGate } from "../plugins/integration/scanners";

const ROOT = process.cwd();
const OPA = join(ROOT, ".tools", "opa");
const GITLEAKS = join(ROOT, ".tools", "gitleaks");

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    subject: { kind: "user", userId: "user-1", agentId: null, sessionId: "session-1" },
    action: "READ",
    resource: { kind: "file", id: "file:src/App.tsx", ownerId: "user-1" },
    context: { autonomyLevel: 3, environment: "sandbox" },
    ...overrides,
  };
}

const MATRIX: PolicyInput[] = [
  input(),
  input({ action: "WRITE", context: { autonomyLevel: 3, environment: "sandbox" } }),
  input({ action: "WRITE", context: { autonomyLevel: 1, environment: "sandbox" } }),
  input({ action: "EXECUTE", context: { autonomyLevel: 2, environment: "sandbox" } }),
  input({ action: "EXECUTE", context: { autonomyLevel: 3, environment: "sandbox" } }),
  input({ action: "DELETE", context: { autonomyLevel: 5, environment: "sandbox" } }),
  input({ action: "DELETE", context: { autonomyLevel: 5, environment: "sandbox", approvalValid: true, approvalId: "a" } }),
  input({ action: "DEPLOY", context: { autonomyLevel: 5, environment: "production" } }),
  input({ action: "DEPLOY", context: { autonomyLevel: 5, environment: "production", approvalValid: true, approvalId: "a" } }),
  input({ action: "ADMINISTER", context: { autonomyLevel: 5, environment: "sandbox", approvalValid: true } }),
  input({ resource: { kind: "file", id: "file:theirs.ts", ownerId: "user-2" }, action: "WRITE" }),
  input({ subject: { kind: "user", userId: null, agentId: null, sessionId: null }, action: "READ" }),
  input({
    subject: { kind: "agent", userId: null, agentId: "agent-7", sessionId: "s" },
    action: "READ",
    context: { autonomyLevel: 5, environment: "sandbox", agentSelfElevation: true },
  }),
  input({
    subject: { kind: "agent", userId: null, agentId: "agent-7", sessionId: "s" },
    action: "DEPLOY",
    context: { autonomyLevel: 5, environment: "sandbox", approvalValid: true },
  }),
  input({ action: "ACCESS_EXTERNAL_DEVICE", resource: { kind: "device", id: "device:phone" } }),
  input({
    action: "ACCESS_EXTERNAL_DEVICE",
    resource: { kind: "device", id: "device:phone" },
    context: { autonomyLevel: 4, environment: "sandbox", deviceAuthorized: true },
  }),
];

test("the real OPA binary and the policy bundle are detected", async (t) => {
  if (!existsSync(OPA)) {
    t.skip(`opa is not present at ${OPA}; set LELU_OPA_BINARY or place it in .tools/`);
    return;
  }
  const availability = await detectOpa(ROOT);
  assert.equal(availability.available, true);
  assert.match(String(availability.detail), /polic/i);
});

test("OPA and the reference evaluator agree on every case in the matrix", async (t) => {
  if (!existsSync(OPA)) {
    t.skip("opa is not present; the Rego could not be compared with the reference");
    return;
  }
  for (const [index, policyInput] of MATRIX.entries()) {
    const reference = evaluatePolicy(policyInput);
    const evaluated = await evaluateWithOpa(policyInput, ROOT);
    assert.equal(evaluated.fromOpa, true, `case ${index}: OPA was not actually used — ${evaluated.detail}`);
    assert.equal(evaluated.decision.engine, "opa", `case ${index}: decision is not labelled opa`);
    assert.equal(
      evaluated.decision.allowed,
      reference.allowed,
      `case ${index} (${policyInput.action}, ${policyInput.subject.kind}, autonomy ${policyInput.context.autonomyLevel}): ` +
        `OPA said ${evaluated.decision.allowed}, reference said ${reference.allowed} — ${evaluated.decision.reason}`,
    );
    assert.equal(
      evaluated.decision.requiresApproval,
      reference.requiresApproval,
      `case ${index}: approval requirement diverged`,
    );
  }
});

test("a missing policy bundle is a REFUSAL, not a pass", async () => {
  const evaluated = await evaluateWithOpa(input(), join(ROOT, "does-not-exist"));
  assert.equal(evaluated.fromOpa, false);
  assert.equal(evaluated.decision.allowed, false);
  assert.match(evaluated.decision.reason, /could not be evaluated|failed/i);
});

test("gitleaks finds a planted secret and never repeats its value", async (t) => {
  if (!existsSync(GITLEAKS)) {
    t.skip(`gitleaks is not present at ${GITLEAKS}`);
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "lelu-scan-"));
  // A synthetic GitHub-token-shaped value, assembled at runtime so this
  // repository does not itself contain a token-shaped literal. Not a real
  // credential: no such token was ever issued, and it exists only inside a
  // temporary directory that is deleted at the end of the test.
  const secret = ["ghp", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"].join("_");
  writeFileSync(
    join(directory, "leaked-config.ts"),
    `// deliberately planted\nexport const github_token = "${secret}";\n`,
    "utf8",
  );
  try {
    const result = await runGitleaks({ target: directory, workspaceRoot: ROOT });
    assert.equal(result.ran, true, result.detail);
    assert.ok(result.findings.length > 0, "the planted AWS key must be found");
    assert.equal(result.gatePassed, false, "a real finding must fail the gate");
    for (const finding of result.findings) {
      assert.ok(!finding.message.includes(secret), "the report must never reproduce the credential");
    }
    assert.ok(result.counts.high > 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a clean directory scans clean — and says it actually ran", async (t) => {
  if (!existsSync(GITLEAKS)) {
    t.skip(`gitleaks is not present at ${GITLEAKS}`);
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "lelu-scan-clean-"));
  writeFileSync(join(directory, "hello.ts"), "export const hello = 'world';\n", "utf8");
  try {
    const result = await runGitleaks({ target: directory, workspaceRoot: ROOT });
    assert.equal(result.ran, true, result.detail);
    assert.equal(result.findings.length, 0);
    assert.equal(result.gatePassed, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a scanner that is not installed fails the gate instead of reporting clean", async () => {
  // semgrep is deliberately not bundled with this project.
  const report = await runSecurityGate({
    target: ROOT,
    workspaceRoot: ROOT,
    scanners: ["semgrep"],
  });
  const [semgrep] = report.results;
  assert.equal(semgrep.ran, false);
  assert.equal(semgrep.gatePassed, false);
  assert.match(semgrep.detail, /not installed/);
  assert.equal(report.gatePassed, false);
  assert.match(report.summary, /did not run/);
});
