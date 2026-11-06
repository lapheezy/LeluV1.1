/**
 * ==========================================================
 * LÉLU — REAL OPA EVALUATION (server side)
 *
 * Runs the actual `opa` binary against policies/lelu, so the
 * server's authorization decision comes from the Rego document
 * and not from a JavaScript re-implementation of it.
 *
 * HONESTY RULES
 * -------------
 * • The binary is looked for in a documented order and, if it
 *   is absent, this reports `available: false` with the reason.
 *   It never returns a JavaScript decision labelled "opa".
 * • A failed evaluation is a DENY, not a pass. If the policy
 *   engine cannot answer, the answer is "no".
 * • The input document is the one builder in
 *   src/core/security/policy.ts, so server and browser cannot
 *   disagree about what was evaluated.
 *
 * Expected deployment: the `opa` binary on PATH (or
 * LELU_OPA_BINARY), with policies/lelu mounted beside the app.
 * ==========================================================
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fromRegoResult, toRegoInput, type PolicyDecision, type PolicyInput } from "../../src/core/security/policy.ts";

const execFileAsync = promisify(execFile);

const QUERY = "data.lelu.authz.decision";

export interface OpaAvailability {
  available: boolean;
  binary: string | null;
  version: string | null;
  policyDir: string;
  detail: string;
}

/**
 * Cached per policy bundle, not globally.
 *
 * A single cached answer meant a request naming a DIFFERENT bundle (a
 * test, a second workspace, a preview copy) silently reused the first
 * bundle's verdict — the check "is this policy present" then passed for
 * a directory that does not exist. The cache is keyed by the bundle it
 * describes.
 */
const cache = new Map<string, OpaAvailability>();

function candidates(workspaceRoot: string): string[] {
  const fromEnv = process.env.LELU_OPA_BINARY?.trim();
  // An explicit path is authoritative: no silent fallback to .tools or PATH.
  if (fromEnv) return [fromEnv];
  return [
    join(workspaceRoot, ".tools", "opa"),
    join(workspaceRoot, "node_modules", ".bin", "opa"),
    "opa",
  ];
}

export async function detectOpa(workspaceRoot: string): Promise<OpaAvailability> {
  const policyDir = join(workspaceRoot, "policies", "lelu");
  const remembered = cache.get(policyDir);
  if (remembered) return remembered;

  // No bundle, no decision. This is checked BEFORE the binary: an OPA that
  // can run but has nothing to evaluate must not be reported as usable.
  if (!existsSync(policyDir)) {
    const missing: OpaAvailability = {
      available: false,
      binary: null,
      version: null,
      policyDir,
      detail: `No policy bundle at ${policyDir} — there is nothing to evaluate, so authorization refuses.`,
    };
    cache.set(policyDir, missing);
    return missing;
  }

  for (const binary of candidates(workspaceRoot)) {
    try {
      const { stdout } = await execFileAsync(binary, ["version"], { timeout: 10_000 });
      const found: OpaAvailability = {
        available: true,
        binary,
        version: stdout.split("\n")[0]?.trim() ?? null,
        policyDir,
        detail: `OPA ${stdout.split("\n")[0]?.trim()} with ${policyDir}`,
      };
      cache.set(policyDir, found);
      return found;
    } catch {
      // try the next candidate
    }
  }
  const missing: OpaAvailability = {
    available: false,
    binary: null,
    version: null,
    policyDir,
    detail:
      "No opa binary found (looked at LELU_OPA_BINARY, .tools/opa, node_modules/.bin/opa, PATH). " +
      "Server decisions fall back to the reference evaluator, which reports engine \"reference\".",
  };
  cache.set(policyDir, missing);
  return missing;
}

export interface OpaEvaluation {
  decision: PolicyDecision;
  /** True only when this decision came out of the opa binary. */
  fromOpa: boolean;
  detail: string;
  durationMs: number;
}

/**
 * Evaluate one policy input with real OPA.
 *
 * On any failure this returns a DENY decision labelled
 * `engine: "reference"` with `rules: ["policy_unavailable"]`, so a
 * caller can tell "OPA said no" from "OPA could not be asked".
 */
export async function evaluateWithOpa(input: PolicyInput, workspaceRoot: string): Promise<OpaEvaluation> {
  const startedAt = Date.now();
  const availability = await detectOpa(workspaceRoot);
  if (!availability.available || !availability.binary) {
    return {
      decision: {
        allowed: false,
        requiresApproval: false,
        reason: `Authorization could not be evaluated: ${availability.detail}`,
        action: input.action,
        risk: "high",
        engine: "reference",
        rules: ["policy_unavailable"],
      },
      fromOpa: false,
      detail: availability.detail,
      durationMs: Date.now() - startedAt,
    };
  }

  // `--stdin-input` needs a writable stdin, and promisified execFile has no
  // `input` option (that is the SYNC API). A temp input file is the smallest
  // correct way to hand OPA a document.
  const directory = mkdtempSync(join(tmpdir(), "lelu-opa-"));
  const inputFile = join(directory, "input.json");
  writeFileSync(inputFile, JSON.stringify(toRegoInput(input)), "utf8");
  try {
    const { stdout } = await execFileAsync(
      availability.binary,
      ["eval", "--format", "json", "--data", availability.policyDir, "--input", inputFile, QUERY],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as {
      result?: Array<{ expressions?: Array<{ value?: Record<string, unknown> }> }>;
    };
    const value = parsed.result?.[0]?.expressions?.[0]?.value;
    if (!value) {
      return {
        decision: {
          allowed: false,
          requiresApproval: false,
          reason: "OPA returned no decision document — refusing.",
          action: input.action,
          risk: "high",
          engine: "reference",
          rules: ["policy_empty_result"],
        },
        fromOpa: false,
        detail: "opa eval produced an empty result",
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      decision: fromRegoResult(value, input),
      fromOpa: true,
      detail: `${availability.binary} ${availability.version ?? ""}`.trim(),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      decision: {
        allowed: false,
        requiresApproval: false,
        reason: `OPA evaluation failed — refusing: ${message.slice(0, 200)}`,
        action: input.action,
        risk: "high",
        engine: "reference",
        rules: ["policy_error"],
      },
      fromOpa: false,
      detail: message.slice(0, 300),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
