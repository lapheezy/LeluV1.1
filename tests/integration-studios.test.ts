/**
 * ==========================================================
 * LÉLU — INTEGRATION STUDIOS (regressions)
 *
 * CATEGORY: unit. No network, no DOM, no WebGL.
 *
 * These tests pin the rules that make the studios honest, and
 * the wiring that makes them reachable:
 *
 *   1. a scanner that did not run can never produce PASS;
 *   2. a finding is normalised so a matched secret cannot reach
 *      a screen, and guidance is attached per rule;
 *   3. "verified" requires a real test run with zero failures;
 *   4. health labels never upgrade an unconfigured service;
 *   5. polling is bounded (no interval under 5 s);
 *   6. each studio is registered in the real navigation and
 *      module host, and no studio imports an adapter directly.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  MIN_POLL_MS,
  formatDuration,
  healthColor,
  healthLabel,
  normaliseFinding,
  relativeTime,
  remediationFor,
  scannerPosture,
  verificationOf,
  type ScanReport,
} from "../src/app/scene/genesis/integration/useIntegration.ts";

const ROOT = new URL("..", import.meta.url).pathname;

function read(relativePath: string): string {
  return readFileSync(`${ROOT}${relativePath}`, "utf8");
}

/* ---------------------------- posture ---------------------------- */

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    gatePassed: false,
    summary: "1/1 scanner(s) ran; 3 finding(s). Gate FAILED",
    scannedAt: Date.now(),
    target: ".",
    results: [
      {
        scanner: "gitleaks",
        ran: true,
        detail: "gitleaks 8.30.1",
        durationMs: 900,
        findings: [],
        counts: { critical: 0, high: 3, medium: 0, low: 0, info: 0, unknown: 0 },
      },
    ],
    ...overrides,
  };
}

test("a scan that never ran is BLOCKED, never PASS", () => {
  const posture = scannerPosture({ gitleaks: true, trivy: true, semgrep: true }, null);
  assert.equal(posture.posture, "unknown");
  assert.notEqual(posture.label, "PASS");
});

test("a missing scanner blocks the gate even when every other scanner is clean", () => {
  const clean = report({
    gatePassed: true,
    results: [
      {
        scanner: "gitleaks",
        ran: true,
        detail: "clean",
        durationMs: 800,
        findings: [],
        counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 },
      },
    ],
  });
  const posture = scannerPosture({ gitleaks: true, trivy: false, semgrep: false }, clean);
  assert.equal(posture.posture, "blocked");
  assert.equal(posture.label, "BLOCKED");
  assert.match(posture.detail, /not installed/);
});

test("a scanner that did not execute blocks the result that contains it", () => {
  const partial = report({
    gatePassed: true,
    results: [
      { scanner: "gitleaks", ran: true, detail: "ok", durationMs: 500, findings: [], counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 } },
      { scanner: "trivy", ran: false, detail: "no vulnerability DB", durationMs: 3, findings: [], counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 } },
    ],
  });
  const posture = scannerPosture({ gitleaks: true, trivy: true, semgrep: true }, partial);
  assert.equal(posture.posture, "blocked");
  assert.match(posture.detail, /trivy did not run/);
});

test("only a complete, clean, passing scan reads PASS", () => {
  const clean = report({
    gatePassed: true,
    results: [
      { scanner: "gitleaks", ran: true, detail: "clean", durationMs: 500, findings: [], counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 } },
    ],
  });
  const posture = scannerPosture({ gitleaks: true, trivy: true, semgrep: true }, clean);
  assert.equal(posture.posture, "pass");
  assert.equal(posture.label, "PASS");
});

test("a failing gate reads FAIL with the server's own summary", () => {
  const posture = scannerPosture({ gitleaks: true, trivy: true, semgrep: true }, report());
  assert.equal(posture.posture, "fail");
  assert.match(posture.detail, /Gate FAILED/);
});

/* ---------------------------- findings ---------------------------- */

test("a finding never carries a matched value, even if a scanner adds one", () => {
  const finding = normaliseFinding({
    rule: "github-pat",
    severity: "HIGH",
    file: "src/example.ts",
    line: 12,
    Secret: "ghp_should-never-render",
    Match: "token=ghp_should-never-render",
  });
  assert.equal(finding.rule, "github-pat");
  assert.equal(finding.severity, "high");
  assert.equal(finding.file, "src/example.ts");
  assert.equal(finding.line, 12);
  const serialised = JSON.stringify(finding);
  assert.doesNotMatch(serialised, /ghp_should-never-render/);
  assert.equal(Object.keys(finding).some((key) => /secret|match/i.test(key)), false);
});

test("remediation guidance exists for credential rules and never contains a value", () => {
  const github = remediationFor("github-pat");
  assert.ok(github && /revoke/i.test(github));
  const anthropic = remediationFor("anthropic-api-key");
  assert.ok(anthropic && /rotat/i.test(anthropic));
  assert.match(remediationFor("generic-api-key") ?? "", /rotate|confirm/i);
  assert.equal(remediationFor("some-benign-rule"), null);
});

/* -------------------------- verification -------------------------- */

test("verified means a real test run with zero failures", () => {
  assert.deepEqual(verificationOf({ verified: true, tests: { ran: true, passed: 12, failed: 0 } }), {
    verified: true,
    reason: "12 test(s) passed, 0 failed.",
  });
  assert.equal(verificationOf({ verified: true, tests: null }).verified, false);
  assert.equal(verificationOf({ verified: true, tests: { ran: false, passed: 0, failed: 0 } }).verified, false);
  assert.equal(verificationOf({ verified: true, tests: { ran: true, passed: 12, failed: 1 } }).verified, false);
  assert.equal(verificationOf({ verified: true, tests: { ran: true, passed: 0, failed: 0 } }).verified, false);
  assert.equal(verificationOf({ verified: false, tests: { ran: true, passed: 5, failed: 0 } }).verified, false);
});

/* --------------------------- formatting --------------------------- */

test("health labels never upgrade an unknown or unconfigured service", () => {
  assert.equal(healthLabel("not_configured"), "NOT CONFIGURED");
  assert.equal(healthLabel("unavailable"), "UNAVAILABLE");
  assert.equal(healthLabel("something-new"), "SOMETHING-NEW");
  assert.notEqual(healthColor("not_configured"), healthColor("healthy"));
});

test("durations and relative times stay human and never invent a value", () => {
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(240), "240 ms");
  assert.equal(formatDuration(1500), "1.5 s");
  assert.equal(relativeTime(null), "never");
  assert.equal(relativeTime(Date.now()), "just now");
});

test("polling has a floor, so a studio cannot hammer the server", () => {
  assert.equal(MIN_POLL_MS, 5_000);
  const source = read("src/app/scene/genesis/integration/useIntegration.ts");
  assert.match(source, /Math\.max\(MIN_POLL_MS, intervalMs\)/);
  assert.match(source, /document\.hidden/, "polling pauses while the tab is hidden");
});

/* ----------------------------- wiring ----------------------------- */

test("all four studios are registered with the module host and the navigation", () => {
  const interfaceSource = read("src/app/scene/genesis/GenesisInterface.tsx");
  const dockSource = read("src/app/scene/genesis/GenesisDock.tsx");
  const coreSource = read("src/app/scene/genesis/GenesisCore.tsx");
  const settingsSource = read("src/app/scene/genesis/GenesisSettingsPanel.tsx");
  for (const panel of ["eng-studio", "voice-studio", "infra-monitor", "security-center"]) {
    assert.match(interfaceSource, new RegExp(`"${panel}"`), `${panel} must be in MODULE_RENDERERS`);
    assert.match(dockSource, new RegExp(`id: "${panel}"`), `${panel} must be in the dock catalogue`);
    assert.match(coreSource, new RegExp(`"${panel}"`), `${panel} must be a GenesisPanel`);
    assert.match(settingsSource, new RegExp(`id: "${panel}"`), `${panel} must be reachable from Settings`);
  }
});

test("no studio component imports an adapter or bypasses the capability gate", () => {
  const panels = [
    "src/app/scene/genesis/integration/EngineeringStudioPanel.tsx",
    "src/app/scene/genesis/integration/VoiceStudioPanel.tsx",
    "src/app/scene/genesis/integration/InfrastructureMonitorPanel.tsx",
    "src/app/scene/genesis/integration/SecurityCenterPanel.tsx",
  ];
  for (const path of panels) {
    const source = read(path);
    assert.doesNotMatch(source, /AdapterRegistry|plugins\/integration\/|from "\.\.\/\.\.\/\.\.\/core\/integration/, `${path} must not touch adapters`);
    assert.match(source, /\/api\/integration\//, `${path} must read the server surface`);
  }
});

test("the server exposes every endpoint the studios read", () => {
  const api = read("plugins/integrationApi.ts");
  for (const route of ["/api/integration/engineering", "/api/integration/voice", "/api/integration/security", "/api/integration/traces"]) {
    assert.match(api, new RegExp(route.replace(/\//g, "\\/")), `${route} must be implemented`);
  }
  assert.match(api, /recordDecision/, "a policy decision must be recorded for the Security Center");
  assert.match(api, /recordScan/, "a scan must be recorded for the Security Center");
});
