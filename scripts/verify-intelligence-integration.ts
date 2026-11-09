/**
 * ==========================================================
 * LÉLU — INTELLIGENCE INTEGRATION EVIDENCE
 *
 * Produces a timestamped evidence directory containing what the
 * running system ACTUALLY reported, so a claim in the docs can be
 * checked against an artefact:
 *
 *   policy-decisions.json   real OPA + reference decisions
 *   security-scan.json      real gitleaks run over this repo
 *   services.json           real probes of every integrated service
 *   trace.json              a correlated chain of real operations
 *   REPORT.md               a human-readable summary of the above
 *
 * Every number in REPORT.md is read from those files; nothing is
 * typed from memory. A stage that did not run is recorded as
 * absent rather than filled in.
 *
 *   bun run scripts/verify-intelligence-integration.ts
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { evaluatePolicy, type PolicyInput } from "../src/core/security/policy.ts";
import { detectOpa, evaluateWithOpa } from "../plugins/integration/opa.ts";
import { runSecurityGate } from "../plugins/integration/scanners.ts";
import { probeAllServices } from "../plugins/integration/services.ts";
import Telemetry from "../src/core/observability/Telemetry.ts";
import Shaman from "../src/core/agents/Shaman.ts";

const ROOT = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = join(ROOT, "docs", "acceptance", "intelligence-integration", stamp);
mkdirSync(directory, { recursive: true });

function save(name: string, value: unknown): void {
  writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function policyInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    subject: { kind: "user", userId: "evidence-user", agentId: null, sessionId: "evidence-session" },
    action: "READ",
    resource: { kind: "file", id: "file:src/App.tsx", ownerId: "evidence-user" },
    context: { autonomyLevel: 3, environment: "sandbox" },
    ...overrides,
  };
}

const CASES: Array<{ name: string; input: PolicyInput }> = [
  { name: "read own file", input: policyInput() },
  { name: "write own file", input: policyInput({ action: "WRITE" }) },
  { name: "write at observe level", input: policyInput({ action: "WRITE", context: { autonomyLevel: 0, environment: "sandbox" } }) },
  { name: "delete without approval", input: policyInput({ action: "DELETE" }) },
  {
    name: "delete with approval",
    input: policyInput({ action: "DELETE", context: { autonomyLevel: 5, environment: "sandbox", approvalId: "evidence-approval", approvalValid: true } }),
  },
  { name: "administer as agent", input: policyInput({ subject: { kind: "agent", userId: null, agentId: "agent-1", sessionId: "s" }, action: "ADMINISTER" }) },
  { name: "agent self-elevation", input: policyInput({ subject: { kind: "agent", userId: null, agentId: "agent-1", sessionId: "s" }, context: { autonomyLevel: 5, environment: "sandbox", agentSelfElevation: true } }) },
  { name: "cross-user write", input: policyInput({ action: "WRITE", resource: { kind: "file", id: "file:theirs.ts", ownerId: "someone-else" } }) },
  { name: "device access without relationship", input: policyInput({ action: "ACCESS_EXTERNAL_DEVICE", resource: { kind: "device", id: "device:phone" } }) },
  { name: "production deploy without approval", input: policyInput({ action: "DEPLOY", context: { autonomyLevel: 5, environment: "production" } }) },
];

async function main(): Promise<void> {
  const telemetry = Telemetry.getInstance();
  telemetry.resetForTests();
  const correlationId = `evidence-${Date.now()}`;

  /* ---- 1. policy, with the real binary ---------------------------- */
  const opa = await detectOpa(ROOT);
  const decisions = [];
  const traceId = telemetry.startTrace("verify intelligence integration", correlationId);

  const coreSpan = telemetry.startSpan({ traceId, stage: "core", name: "LÉLU CORE — authorization preflight" });
  for (const item of CASES) {
    const evaluated = await evaluateWithOpa(item.input, ROOT);
    const reference = evaluatePolicy(item.input);
    decisions.push({
      case: item.name,
      action: item.input.action,
      engine: evaluated.fromOpa ? "opa" : "reference",
      allowed: evaluated.decision.allowed,
      requiresApproval: evaluated.decision.requiresApproval,
      risk: evaluated.decision.risk,
      rule: evaluated.decision.rules[0] ?? null,
      reason: evaluated.decision.reason,
      referenceAllowed: reference.allowed,
      agrees: reference.allowed === evaluated.decision.allowed,
      durationMs: evaluated.durationMs,
    });
  }
  telemetry.annotate(coreSpan.id, { cases: decisions.length, engine: opa.available ? "opa" : "reference" });
  telemetry.endSpan(coreSpan.id, "ok");
  save("policy-decisions.json", { opa: { available: opa.available, version: opa.version, detail: opa.detail }, decisions });

  /* ---- 2. the router really routing ------------------------------- */
  const shamanSpan = telemetry.startSpan({ traceId, stage: "shaman", name: "SHAMAN — classify objective" });
  const objective = "fix the failing parser test and show me the diff";
  const galaxy = Shaman.getInstance().classify(objective);
  telemetry.annotate(shamanSpan.id, { objective, classified: galaxy ?? "none" });
  telemetry.endSpan(shamanSpan.id, "ok");

  /* ---- 3. the real security scan ---------------------------------- */
  const toolSpan = telemetry.startSpan({ traceId, stage: "tool", name: "security gate — gitleaks over the working tree" });
  const scan = await runSecurityGate({ target: ROOT, workspaceRoot: ROOT, scanners: ["gitleaks"] });
  telemetry.annotate(toolSpan.id, {
    scannersRan: scan.results.filter((result) => result.ran).length,
    findings: scan.results.reduce((total, result) => total + result.findings.length, 0),
    gatePassed: scan.gatePassed,
  });
  telemetry.endSpan(toolSpan.id, scan.summary.includes("Gate FAILED") ? "failed" : "ok");
  save("security-scan.json", scan);

  /* ---- 4. service probes, really contacted ------------------------ */
  const modelSpan = telemetry.startSpan({ traceId, stage: "model", name: "model gateway probes" });
  const services = await probeAllServices();
  telemetry.annotate(modelSpan.id, { services: services.length });
  telemetry.endSpan(modelSpan.id, "ok");
  save("services.json", services);

  /* ---- 5. verification, from the artefacts themselves ------------- */
  const resultSpan = telemetry.startSpan({ traceId, stage: "result", name: "collected evidence" });
  telemetry.endSpan(resultSpan.id, "ok");
  const verificationSpan = telemetry.startSpan({ traceId, stage: "verification", name: "verify the gate and the parity" });
  const parity = decisions.every((decision) => decision.agrees);
  const gateHonest = scan.results.every((result) => (result.ran ? true : !result.gatePassed));
  telemetry.annotate(verificationSpan.id, { parity, gateHonest, opaRan: opa.available });
  telemetry.endSpan(verificationSpan.id, parity && gateHonest ? "ok" : "failed");

  const trace = {
    traceId,
    correlationId,
    summary: telemetry.recentTraces(1)[0] ?? null,
    chain: telemetry.chain(traceId),
    spans: telemetry.traceSpans(traceId),
  };
  save("trace.json", trace);

  /* ---- 6. a report whose every number comes from the files -------- */
  const gitleaks = scan.results[0];
  const report = [
    "# Intelligence integration — evidence",
    "",
    `Generated ${new Date().toISOString()} by \`scripts/verify-intelligence-integration.ts\` in this container.`,
    "",
    "## What was actually executed",
    "",
    "| Check | Result | Source |",
    "|---|---|---|",
    `| OPA binary | ${opa.available ? `available — ${opa.version}` : "NOT AVAILABLE"} | policy-decisions.json |`,
    `| Policy cases evaluated | ${decisions.length} | policy-decisions.json |`,
    `| OPA/reference agreement | ${decisions.filter((d) => d.agrees).length}/${decisions.length} | policy-decisions.json |`,
    `| Cases decided by OPA (not the fallback) | ${decisions.filter((d) => d.engine === "opa").length}/${decisions.length} | policy-decisions.json |`,
    `| Gitleaks ran | ${gitleaks?.ran ? "yes" : "NO"} | security-scan.json |`,
    `| Gitleaks findings | ${gitleaks?.findings.length ?? "n/a"} | security-scan.json |`,
    `| Security gate passed | ${scan.gatePassed} | security-scan.json |`,
    `| SHAMAN classification | ${galaxy ?? "no executive signalled"} | trace.json |`,
    `| Services probed | ${services.length} | services.json |`,
    `| Services healthy | ${services.filter((s) => s.health.state === "healthy").length} | services.json |`,
    `| Services not configured | ${services.filter((s) => s.health.state === "not_configured").length} | services.json |`,
    `| Trace spans | ${trace.spans.length} | trace.json |`,
    `| Trace stages observed | ${trace.chain.map((entry) => entry.stage).join(" → ")} | trace.json |`,
    "",
    "## Service states, as probed",
    "",
    "| Service | State | Detail |",
    "|---|---|---|",
    ...services.map((service) => `| ${service.name} | ${service.health.state} | ${service.health.detail.replace(/\|/g, "\\|")} |`),
    "",
    "## Policy decisions",
    "",
    "| Case | Action | Allowed | Approval | Engine | Agrees with reference |",
    "|---|---|---|---|---|---|",
    ...decisions.map(
      (decision) =>
        `| ${decision.case} | ${decision.action} | ${decision.allowed} | ${decision.requiresApproval} | ${decision.engine} | ${decision.agrees} |`,
    ),
    "",
    "## What this evidence does NOT show",
    "",
    "- No live model call: this runtime holds no provider credential, so the `agent` and live `model` stages are absent from the trace by design rather than simulated.",
    "- No microphone or speaker: voice adapters are covered by unit tests, not audio.",
    "- Trivy and Semgrep were not run here (no vulnerability DB download / not installed); their adapters report that instead of a clean result.",
    "- No remote OpenFGA, Temporal, LiteLLM, Pipecat, Infisical, OpenHands or OpenCode server is configured, so those services report `not_configured`.",
    "",
  ].join("\n");
  writeFileSync(join(directory, "REPORT.md"), report, "utf8");

  console.info(`evidence written to ${directory}`);
  console.info(report.split("\n").slice(0, 26).join("\n"));
}

await main();
