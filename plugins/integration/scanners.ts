/**
 * ==========================================================
 * LÉLU — SECURITY SCANNING GATEWAY (server side)
 *
 * Gitleaks, Semgrep and Trivy, run as REAL processes against a
 * real path. No finding is invented and no clean result is
 * reported without the scanner having actually run.
 *
 * The contract every scanner keeps:
 *   • it reports `ran: false` with the real reason when its
 *     binary is missing, its database could not be fetched, or
 *     it timed out — never "0 findings" for a scan that did not
 *     happen;
 *   • its raw output is parsed, not summarised away: a finding
 *     keeps its rule, severity, file and line;
 *   • a credential found by Gitleaks is described by its rule
 *     and location and NEVER reproduced in the report.
 *
 * Binaries are resolved from LELU_<TOOL>_BINARY, .tools/<tool>,
 * node_modules/.bin/<tool>, then PATH.
 * ==========================================================
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ScannerId = "gitleaks" | "semgrep" | "trivy";
export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

export interface Finding {
  scanner: ScannerId;
  rule: string;
  severity: Severity;
  file: string;
  line?: number;
  /** A description that is safe to display — never a secret value. */
  message: string;
}

export interface ScanResult {
  scanner: ScannerId;
  /** Did the scanner actually execute? */
  ran: boolean;
  /** Why not, or what limited the scan. */
  detail: string;
  durationMs: number;
  findings: Finding[];
  /** Whether the severity gate is satisfied. */
  gatePassed: boolean;
  /** Findings by severity, for the security centre. */
  counts: Record<Severity, number>;
  /** The binary that ran, or null. */
  binary: string | null;
  version: string | null;
}

const EMPTY_COUNTS = (): Record<Severity, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  unknown: 0,
});

function resolveBinary(tool: ScannerId, workspaceRoot: string): string[] {
  const envName = `LELU_${tool.toUpperCase()}_BINARY`;
  const fromEnv = process.env[envName]?.trim();
  // An explicit path is authoritative. If it does not run, the scanner is
  // reported as not installed rather than silently substituting another
  // binary the operator did not choose.
  if (fromEnv) return [fromEnv];
  return [
    join(workspaceRoot, ".tools", tool),
    join(workspaceRoot, "node_modules", ".bin", tool),
    tool,
  ];
}

async function firstWorking(tool: ScannerId, workspaceRoot: string, args: string[]): Promise<{ binary: string; version: string } | null> {
  for (const binary of resolveBinary(tool, workspaceRoot)) {
    try {
      const { stdout, stderr } = await execFileAsync(binary, args, { timeout: 20_000 });
      const version = `${stdout}\n${stderr}`.trim().split("\n")[0] ?? "";
      return { binary, version };
    } catch {
      // next candidate
    }
  }
  return null;
}

function normaliseSeverity(raw: unknown): Severity {
  const text = String(raw ?? "").toUpperCase();
  if (text === "CRITICAL") return "critical";
  if (text === "HIGH" || text === "ERROR") return "high";
  if (text === "MEDIUM" || text === "MODERATE" || text === "WARNING") return "medium";
  if (text === "LOW" || text === "INFO") return text === "INFO" ? "info" : "low";
  return "unknown";
}

function count(findings: Finding[]): Record<Severity, number> {
  const counts = EMPTY_COUNTS();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export interface ScanOptions {
  /** The path to scan. Must stay inside the workspace. */
  target: string;
  workspaceRoot: string;
  /** Scan the whole git history (Gitleaks) rather than the working tree. */
  history?: boolean;
  /** Fail the gate at or above this severity. Default: high. */
  failAt?: Severity;
  timeoutMs?: number;
}

const FAIL_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

function gate(findings: Finding[], failAt: Severity): boolean {
  const threshold = FAIL_ORDER.indexOf(failAt);
  return !findings.some((finding) => {
    const index = FAIL_ORDER.indexOf(finding.severity);
    return index !== -1 && index <= threshold;
  });
}

/* ------------------------------------------------------------------ *
 * GITLEAKS — secret detection
 * ------------------------------------------------------------------ */

export async function runGitleaks(options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const found = await firstWorking("gitleaks", options.workspaceRoot, ["version"]);
  if (!found) {
    return {
      scanner: "gitleaks",
      ran: false,
      detail:
        "gitleaks is not installed (looked at LELU_GITLEAKS_BINARY, .tools/gitleaks, node_modules/.bin/gitleaks, PATH). " +
        "No secret scan was performed — this is NOT a clean result.",
      durationMs: Date.now() - startedAt,
      findings: [],
      gatePassed: false,
      counts: EMPTY_COUNTS(),
      binary: null,
      version: null,
    };
  }

  // The report goes to a real file, not /dev/stdout. Writing the report to
  // the child's stdout is fragile under a pipe (it failed only when spawned
  // from the test runner, which is exactly the kind of environment difference
  // a scanner must not be sensitive to), and a missing report file is an
  // unambiguous "this scan produced nothing", which is handled explicitly.
  const directory = mkdtempSync(join(tmpdir(), "lelu-gitleaks-"));
  const reportFile = join(directory, "report.json");
  const args = options.history
    ? ["detect", "--source", options.target, "--no-banner", "--report-format", "json", "--report-path", reportFile, "--exit-code", "0"]
    : ["detect", "--no-git", "--source", options.target, "--no-banner", "--report-format", "json", "--report-path", reportFile, "--exit-code", "0"];

  const readReport = (): Array<Record<string, unknown>> => {
    if (!existsSync(reportFile)) return [];
    try {
      const raw = readFileSync(reportFile, "utf8").trim();
      return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    } catch {
      return [];
    }
  };

  const toFindings = (parsed: Array<Record<string, unknown>>): Finding[] =>
    parsed.map((item) => ({
      scanner: "gitleaks" as const,
      rule: String(item.RuleID ?? "unknown-rule"),
      severity: "high" as Severity,
      file: String(item.File ?? ""),
      ...(typeof item.StartLine === "number" ? { line: item.StartLine } : {}),
      // Deliberately excludes Match and Secret: the report must never
      // reproduce a credential, not even truncated.
      message: `Potential secret matched rule "${String(item.RuleID ?? "unknown")}" (${String(item.Description ?? "no description")}). Value withheld.`,
    }));

  try {
    try {
      await execFileAsync(found.binary, args, {
        timeout: options.timeoutMs ?? 180_000,
        maxBuffer: 64 * 1024 * 1024,
        cwd: options.workspaceRoot,
      });
    } catch (error) {
      // A non-zero exit is normal when leaks exist. What matters is whether a
      // report was produced: that is the difference between "ran and found"
      // and "did not run".
      if (!existsSync(reportFile)) throw error;
    }
    const findings = toFindings(readReport());
    const counts = count(findings);
    return {
      scanner: "gitleaks",
      ran: true,
      detail: `${options.history ? "git history" : "working tree"} scanned by gitleaks ${found.version} at ${options.target}`,
      durationMs: Date.now() - startedAt,
      findings,
      gatePassed: findings.length === 0,
      counts,
      binary: found.binary,
      version: found.version,
    };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const detail = `${error instanceof Error ? error.message.slice(0, 200) : String(error)}${stderr ? ` | ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`;
    return {
      scanner: "gitleaks",
      ran: false,
      detail: `gitleaks did not produce a report: ${detail}`,
      durationMs: Date.now() - startedAt,
      findings: [],
      gatePassed: false,
      counts: EMPTY_COUNTS(),
      binary: found.binary,
      version: found.version,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ *
 * TRIVY — dependencies, filesystem, secrets
 * ------------------------------------------------------------------ */

export async function runTrivy(options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const found = await firstWorking("trivy", options.workspaceRoot, ["--version"]);
  if (!found) {
    return {
      scanner: "trivy",
      ran: false,
      detail:
        "trivy is not installed (looked at LELU_TRIVY_BINARY, .tools/trivy, node_modules/.bin/trivy, PATH). " +
        "No dependency scan was performed — this is NOT a clean result.",
      durationMs: Date.now() - startedAt,
      findings: [],
      gatePassed: false,
      counts: EMPTY_COUNTS(),
      binary: null,
      version: null,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      found.binary,
      ["fs", "--format", "json", "--quiet", "--scanners", "vuln,secret", "--timeout", `${Math.floor((options.timeoutMs ?? 240_000) / 1000)}s`, options.target],
      { timeout: options.timeoutMs ?? 240_000, maxBuffer: 128 * 1024 * 1024, cwd: options.workspaceRoot },
    );
    const parsed = JSON.parse(stdout) as {
      Results?: Array<{
        Target?: string;
        Class?: string;
        Vulnerabilities?: Array<Record<string, unknown>>;
        Secrets?: Array<Record<string, unknown>>;
      }>;
    };
    const findings: Finding[] = [];
    for (const result of parsed.Results ?? []) {
      for (const vuln of result.Vulnerabilities ?? []) {
        findings.push({
          scanner: "trivy",
          rule: String(vuln.VulnerabilityID ?? "unknown"),
          severity: normaliseSeverity(vuln.Severity),
          file: String(result.Target ?? ""),
          message: `${String(vuln.PkgName ?? "package")} ${String(vuln.InstalledVersion ?? "?")} → ${
            String(vuln.FixedVersion ?? "no fix")
          }: ${String(vuln.Title ?? vuln.VulnerabilityID ?? "")}`.slice(0, 300),
        });
      }
      for (const secret of result.Secrets ?? []) {
        findings.push({
          scanner: "trivy",
          rule: String(secret.RuleID ?? "secret"),
          severity: "high",
          file: String(result.Target ?? ""),
          ...(typeof secret.StartLine === "number" ? { line: secret.StartLine } : {}),
          message: `Potential secret (${String(secret.Title ?? "rule matched")}). Value withheld.`,
        });
      }
    }
    return {
      scanner: "trivy",
      ran: true,
      detail: `filesystem + dependencies scanned by trivy ${found.version} at ${options.target}`,
      durationMs: Date.now() - startedAt,
      findings,
      gatePassed: gate(findings, options.failAt ?? "high"),
      counts: count(findings),
      binary: found.binary,
      version: found.version,
    };
  } catch (error) {
    return {
      scanner: "trivy",
      ran: false,
      detail:
        `trivy failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}. ` +
        "A failed scan is not a clean scan.",
      durationMs: Date.now() - startedAt,
      findings: [],
      gatePassed: false,
      counts: EMPTY_COUNTS(),
      binary: found.binary,
      version: found.version,
    };
  }
}

/* ------------------------------------------------------------------ *
 * SEMGREP — static analysis of changed code
 * ------------------------------------------------------------------ */

export async function runSemgrep(options: ScanOptions): Promise<ScanResult> {
  const startedAt = Date.now();
  const found = await firstWorking("semgrep", options.workspaceRoot, ["--version"]);
  if (!found) {
    return {
      scanner: "semgrep",
      ran: false,
      detail:
        "semgrep is not installed (looked at LELU_SEMGREP_BINARY, .tools/semgrep, node_modules/.bin/semgrep, PATH). " +
        "No static analysis was performed — this is NOT a clean result.",
      durationMs: Date.now() - startedAt,
      findings: [],
      gatePassed: false,
      counts: EMPTY_COUNTS(),
      binary: null,
      version: null,
    };
  }
  try {
    const { stdout } = await execFileAsync(
      found.binary,
      ["--json", "--quiet", "--config", "auto", "--timeout", "60", options.target],
      { timeout: options.timeoutMs ?? 240_000, maxBuffer: 64 * 1024 * 1024, cwd: options.workspaceRoot },
    );
    const parsed = JSON.parse(stdout) as {
      results?: Array<{ check_id?: string; path?: string; start?: { line?: number }; extra?: { severity?: string; message?: string } }>;
    };
    const findings: Finding[] = (parsed.results ?? []).map((item) => ({
      scanner: "semgrep" as const,
      rule: String(item.check_id ?? "unknown-rule"),
      severity: normaliseSeverity(item.extra?.severity),
      file: String(item.path ?? ""),
      ...(typeof item.start?.line === "number" ? { line: item.start.line } : {}),
      message: String(item.extra?.message ?? "static analysis finding").slice(0, 300),
    }));
    return {
      scanner: "semgrep",
      ran: true,
      detail: `static analysis by semgrep ${found.version} at ${options.target}`,
      durationMs: Date.now() - startedAt,
      findings,
      gatePassed: gate(findings, options.failAt ?? "high"),
      counts: count(findings),
      binary: found.binary,
      version: found.version,
    };
  } catch (error) {
    return {
      scanner: "semgrep",
      ran: false,
      detail: `semgrep failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
      durationMs: Date.now() - startedAt,
      findings: [],
      gatePassed: false,
      counts: EMPTY_COUNTS(),
      binary: found.binary,
      version: found.version,
    };
  }
}

export interface SecurityReport {
  at: number;
  target: string;
  results: ScanResult[];
  /** True only when every requested scanner actually ran and passed. */
  gatePassed: boolean;
  summary: string;
}

/**
 * Run the security gate.
 *
 * `gatePassed` requires every scanner to have RUN and passed. A
 * scanner that could not run fails the gate, because "we could not
 * check" is not "there is nothing to find".
 */
export async function runSecurityGate(options: ScanOptions & { scanners?: ScannerId[] }): Promise<SecurityReport> {
  const wanted = new Set(options.scanners ?? (["gitleaks", "trivy", "semgrep"] as ScannerId[]));
  const results: ScanResult[] = [];
  if (wanted.has("gitleaks")) results.push(await runGitleaks(options));
  if (wanted.has("trivy")) results.push(await runTrivy(options));
  if (wanted.has("semgrep")) results.push(await runSemgrep(options));

  const gatePassed = results.every((result) => result.ran && result.gatePassed);
  const ran = results.filter((result) => result.ran).length;
  const findings = results.reduce((total, result) => total + result.findings.length, 0);
  return {
    at: Date.now(),
    target: options.target,
    results,
    gatePassed,
    summary:
      `${ran}/${results.length} scanner(s) ran; ${findings} finding(s). ` +
      (gatePassed
        ? "Gate passed."
        : `Gate FAILED — ${results.filter((r) => !r.ran).map((r) => `${r.scanner} did not run`).join("; ") || "findings at or above the threshold"}.`),
  };
}

export function scannerBinaryExists(tool: ScannerId, workspaceRoot: string): boolean {
  return resolveBinary(tool, workspaceRoot).some((binary) => binary.includes("/") && existsSync(binary));
}
