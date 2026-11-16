/**
 * ==========================================================
 * LÉLU — REPO EXECUTOR
 *
 * The engineering half of the acquisition workforce. It takes an
 * assignment from the Repo Executive and does the work against
 * the real acquisition runtime:
 *
 *   acquire  → git clone into an isolated acquisition workspace
 *   inspect  → real tree, manifest, README and license reads
 *   extract  → real source reads, chosen by capability signals
 *   adapt    → files written inside the acquisition, import paths
 *              preserved, attribution and license carried with them
 *   connect  → a machine-readable adapter manifest LÉLU can wire
 *   test     → the acquired repository's own install/test commands,
 *              with their real exit codes (or an honest "not run")
 *   commit   → an authorized branch, with a server-issued approval
 *
 * A failure at any step stops the run and is reported as a failure.
 * There is no partial-success path that claims more than happened.
 * ==========================================================
 */

import AcquisitionRuntime from "./AcquisitionRuntime";
import AcquisitionStore from "./AcquisitionStore";
import ApprovalGate from "./ApprovalGate";
import {
  licenseObligations,
  licenseRisk,
  type AcquisitionAssignment,
  type AdaptationEvidence,
  type RepositoryFileEntry,
  type TestEvidence,
} from "./AcquisitionTypes";

export interface ExecutorOptions {
  /** Branch to create for the adaptation. Defaults to lelu/acquisition/<capability>. */
  branch?: string;
  /** Maximum source files to extract. Defaults to 8. */
  maxFiles?: number;
  /** Skip the repository's own install/test commands. */
  skipRepositoryTests?: boolean;
  /** Who authorized the commit. Required for the commit step. */
  committer?: string;
  /** Called as each real step completes, so a pipeline records evidence live. */
  onStage?: (stage: "acquire" | "inspect" | "adapt" | "connect" | "test" | "approve", ok: boolean, detail: string) => void;
  /**
   * Prepare the branch and evidence but leave the commit to the caller.
   * A pipeline uses this to test and approve BEFORE anything is committed.
   */
  deferCommit?: boolean;
}

export interface ExecutorOutcome {
  ok: boolean;
  acquisitionId: string | null;
  evidence: AdaptationEvidence | null;
  tests: TestEvidence[];
  diagnostics: string[];
  failure: string | null;
  /** Files that the adaptation produced, relative to the acquisition. */
  written: string[];
}

const SOURCE_FILE = /\.(ts|tsx|js|mjs|cjs|py|rs|go|java|kt|swift|rb|php)$/i;
const NEVER_EXTRACT = /(^|\/)(test|tests|spec|__tests__|fixtures|bench|benchmark|docs?|examples?|node_modules|dist|build)\//i;
const MAX_EXTRACTED_FILE_BYTES = 200 * 1024;

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "capability"
  );
}

function keywordScore(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase().trim();
    if (needle.length < 3) continue;
    if (lower.includes(needle)) score += Math.min(4, needle.length / 3);
  }
  return score;
}

export default class RepoExecutor {
  private static instance: RepoExecutor | null = null;
  private readonly runtime = AcquisitionRuntime.getInstance();
  private readonly store = AcquisitionStore.getInstance();

  static getInstance(): RepoExecutor {
    if (!RepoExecutor.instance) RepoExecutor.instance = new RepoExecutor();
    return RepoExecutor.instance;
  }

  static resetForTests(): void {
    RepoExecutor.instance = null;
  }

  /**
   * Inspect an acquisition without changing anything.
   * Used by the Executive to ground a proposal before assignment.
   */
  async inspect(acquisitionId: string): Promise<{
    ok: boolean;
    structure: RepositoryFileEntry[];
    manifest: string;
    readme: string;
    diagnostics: string[];
    failure?: string;
  }> {
    const diagnostics: string[] = [];
    const tree = await this.runtime.tree(acquisitionId, ".");
    if (!tree.ok) {
      return { ok: false, structure: [], manifest: "", readme: "", diagnostics, failure: tree.error };
    }

    const paths = new Set(tree.entries.map((entry) => entry.path));
    const manifestPath = ["package.json", "Cargo.toml", "pyproject.toml", "go.mod"].find((candidate) =>
      paths.has(candidate),
    );
    const readmePath = [...paths].find((path) => /^readme(\.md|\.txt|\.rst)?$/i.test(path));

    const manifest = manifestPath
      ? await this.readOrEmpty(acquisitionId, manifestPath, diagnostics)
      : "";
    const readme = readmePath ? await this.readOrEmpty(acquisitionId, readmePath, diagnostics) : "";

    if (!manifestPath) diagnostics.push("No package manifest at the repository root was found.");
    if (!readmePath) diagnostics.push("No README was found at the repository root.");

    return {
      ok: true,
      structure: tree.entries,
      manifest,
      readme,
      diagnostics,
    };
  }

  private async readOrEmpty(id: string, path: string, diagnostics: string[]): Promise<string> {
    const result = await this.runtime.read(id, path);
    if (!result.ok) {
      diagnostics.push(`Could not read ${path}: ${result.error}`);
      return "";
    }
    return result.content;
  }

  /**
   * Acquire the assigned repository, build the adaptation, test what can
   * be tested and commit the result to an authorized branch.
   */
  async execute(assignment: AcquisitionAssignment, options: ExecutorOptions = {}): Promise<ExecutorOutcome> {
    const diagnostics: string[] = [];
    const tests: TestEvidence[] = [];
    const failure = (message: string, acquisitionId: string | null): ExecutorOutcome => {
      this.store.saveAssignment({ ...assignment, status: "failed", failure: message, acquisitionId: acquisitionId ?? undefined });
      return { ok: false, acquisitionId, evidence: null, tests, diagnostics, failure: message, written: [] };
    };

    if (!this.runtime.isReachable() && (await this.runtime.status()).ok === false) {
      return failure(
        "The acquisition runtime is not reachable, so no repository was cloned and nothing was adapted. " +
          "Start the engineering runtime (npm run dev or npm run serve) and retry.",
        null,
      );
    }

    this.store.saveAssignment({ ...assignment, status: "running" });

    /* ------------------------------ acquire ------------------------------ */
    const candidate = assignment.proposal.candidate;
    const clone = await this.runtime.clone({ url: candidate.url });
    if (!clone.ok) {
      options.onStage?.("acquire", false, clone.error);
      return failure(`Acquisition failed: ${clone.error}`, null);
    }
    const acquisitionId = clone.acquisition.id;
    options.onStage?.(
      "acquire",
      true,
      `cloned ${clone.acquisition.source.identifier}@${clone.acquisition.commit.slice(0, 10)} ` +
        `(${clone.acquisition.fileCount} files, ${clone.acquisition.license.spdx})`,
    );
    this.store.saveAcquisition(clone.acquisition);
    void this.runtime.update(acquisitionId, { status: "inspected" });
    diagnostics.push(
      `Acquired ${clone.acquisition.source.identifier} at ${clone.acquisition.commit.slice(0, 10)} ` +
        `(${clone.acquisition.fileCount} files, ${clone.acquisition.license.spdx}).`,
    );

    /* ------------------------------ inspect ------------------------------ */
    const inspection = await this.inspect(acquisitionId);
    if (!inspection.ok) {
      options.onStage?.("inspect", false, inspection.failure ?? "inspection failed");
      return failure(`Inspection failed: ${inspection.failure ?? "unknown"}`, acquisitionId);
    }
    options.onStage?.(
      "inspect",
      true,
      `${inspection.structure.length} entries; manifest ${inspection.manifest ? "found" : "absent"}; README ${inspection.readme ? "found" : "absent"}`,
    );
    diagnostics.push(...inspection.diagnostics);
    const paths = inspection.structure.map((entry) => entry.path);
    diagnostics.push(`Structure: ${paths.length} entries (bounded listing).`);

    /* ------------------------------ extract ------------------------------ */
    const keywords = [
      assignment.requestedCapability,
      ...assignment.proposal.findings.capabilities,
      ...assignment.proposal.findings.entryPoints.map((entry) => entry.split("/").pop() ?? ""),
    ].filter(Boolean);

    const scored = inspection.structure
      .filter((entry) => SOURCE_FILE.test(entry.path))
      .filter((entry) => !NEVER_EXTRACT.test(entry.path))
      .filter((entry) => (entry.size ?? 0) > 0 && (entry.size ?? 0) <= MAX_EXTRACTED_FILE_BYTES)
      .map((entry) => ({
        entry,
        score:
          keywordScore(entry.path, keywords) * 2 +
          keywordScore(assignment.proposal.findings.summary, [entry.path.split("/").pop() ?? ""]),
      }))
      .sort((a, b) => b.score - a.score || (b.entry.size ?? 0) - (a.entry.size ?? 0));

    const chosen = scored.slice(0, Math.max(1, Math.min(12, options.maxFiles ?? 8)));
    if (chosen.length === 0) {
      return failure(
        `No source file in ${candidate.identifier} matched the capability signals (${keywords.slice(0, 6).join(", ")}). ` +
          "Nothing was adapted.",
        acquisitionId,
      );
    }

    const capability = slug(assignment.requestedCapability);
    const base = `lelu/${capability}`;
    const extracted: string[] = [];
    const written: string[] = [];
    const rationale: string[] = [];

    for (const { entry, score } of chosen) {
      const file = await this.runtime.read(acquisitionId, entry.path);
      if (!file.ok) {
        diagnostics.push(`Skipped ${entry.path}: ${file.error}`);
        continue;
      }
      const destination = `${base}/source/${entry.path}`;
      const writtenFile = await this.runtime.write(acquisitionId, destination, file.content);
      if (!writtenFile.ok) {
        return failure(`Could not write the adapted copy of ${entry.path}: ${writtenFile.error}`, acquisitionId);
      }
      extracted.push(entry.path);
      written.push(destination);
      rationale.push(
        `${entry.path} (${(entry.size ?? 0) / 1024 >= 1 ? `${Math.round((entry.size ?? 0) / 1024)} KB` : `${entry.size ?? 0} B`}, ` +
          `signal score ${score.toFixed(1)})`,
      );
    }

    if (extracted.length === 0) {
      options.onStage?.("adapt", false, "every candidate source file failed to read");
      return failure("Every candidate source file failed to read; nothing was adapted.", acquisitionId);
    }
    options.onStage?.("adapt", true, `extracted ${extracted.length} file(s) into ${base}/source`);

    /* -------------------------------- adapt ------------------------------- */
    const licenseSpdx = inspection.manifest.match(/"license"\s*:\s*"([^"]+)"/)?.[1] ?? candidate.license ?? "UNKNOWN";
    const obligations = licenseObligations(licenseSpdx);
    const attribution = [
      `# Attribution — ${candidate.identifier}`,
      "",
      `- Source: ${candidate.url}`,
      `- Commit: ${clone.acquisition.commit}`,
      `- License: ${licenseSpdx} (${licenseRisk(licenseSpdx)})`,
      `- Adapted by: LÉLU Repo Executor (${new Date().toISOString()})`,
      `- Capability: ${assignment.requestedCapability}`,
      "",
      "## Files copied",
      ...extracted.map((path) => `- \`${path}\` → \`${base}/source/${path}\``),
      "",
      "## License obligations",
      ...obligations.map((line) => `- ${line}`),
      "",
    ].join("\n");

    const readme = [
      `# ${assignment.requestedCapability}`,
      "",
      `Extracted from ${candidate.identifier} at commit \`${clone.acquisition.commit}\`.`,
      "",
      "## Why these files",
      ...rationale.map((line) => `- ${line}`),
      "",
      "## Integration contract",
      "See `lelu.adapter.json` for the entry points and expected exports.",
      "",
    ].join("\n");

    const adapter = JSON.stringify(
      {
        capabilityId: `acquired.${capability}`,
        requestedCapability: assignment.requestedCapability,
        source: {
          identifier: candidate.identifier,
          url: candidate.url,
          commit: clone.acquisition.commit,
          license: licenseSpdx,
        },
        runtime: assignment.proposal.findings.compatibility.runtime,
        language: candidate.language || "unknown",
        entryPoints: extracted.slice(0, 6),
        expectedExports: assignment.proposal.findings.capabilities.slice(0, 8),
        copyRoot: `${base}/source`,
        attribution: `${base}/ATTRIBUTION.md`,
        testsRequired: assignment.proposal.findings.capabilities.slice(0, 3),
      },
      null,
      2,
    );

    for (const [path, content] of [
      [`${base}/README.md`, readme],
      [`${base}/ATTRIBUTION.md`, attribution],
      [`${base}/lelu.adapter.json`, adapter],
    ] as const) {
      const result = await this.runtime.write(acquisitionId, path, content);
      if (!result.ok) return failure(`Could not write ${path}: ${result.error}`, acquisitionId);
      written.push(path);
    }
    void this.runtime.update(acquisitionId, { status: "adapted", capability: `acquired.${capability}` });
    options.onStage?.("connect", true, `wrote adapter contract ${base}/lelu.adapter.json`);

    /* -------------------------------- test -------------------------------- */
    if (!options.skipRepositoryTests) {
      const install = await this.runtime.exec(acquisitionId, "install", { timeoutMs: 300_000 });
      if (install.ok) {
        tests.push(this.toTestEvidence("install", install.result));
      } else {
        diagnostics.push(`Dependency installation was not performed: ${install.error}`);
      }

      const repoTest = await this.runtime.exec(acquisitionId, "test", { timeoutMs: 600_000 });
      if (repoTest.ok) {
        tests.push(this.toTestEvidence("test (repository)", repoTest.result));
        options.onStage?.(
          "test",
          repoTest.result.ok,
          `repository test command exited ${repoTest.result.status} after ${Math.round(repoTest.result.durationMs / 1000)}s`,
        );
        if (repoTest.result.ok) {
          void this.runtime.update(acquisitionId, { status: "tested" });
        } else {
          diagnostics.push(
            `The repository's own test command exited ${repoTest.result.status}. ` +
              "That is the repository's suite, not LÉLU's integration evidence, and it is reported as it is.",
          );
        }
      } else {
        options.onStage?.("test", false, `no runnable repository test command: ${repoTest.error}`);
        diagnostics.push(
          `The repository declares no runnable test command (${repoTest.error}); no repository test was run.`,
        );
      }
    }

    /* ------------------------------- branch ------------------------------- */
    const branch = options.branch ?? `lelu/acquisition/${capability}`;
    let commit: string | null = null;
    const branchResult = await this.runtime.createBranch(acquisitionId, branch);
    if (!branchResult.ok) {
      const checkout = await this.runtime.git<{ output?: string }>(acquisitionId, "checkout", { name: branch });
      diagnostics.push(
        checkout.ok
          ? `Branch ${branch} already existed and was checked out.`
          : `Could not create branch ${branch}: ${branchResult.error}`,
      );
    }

    const commitMessage =
      `acquire(${capability}): adapt ${assignment.proposal.candidate.identifier} for LÉLU\n\n` +
      `Source commit: ${clone.acquisition.commit}\nLicense: ${licenseSpdx}\n` +
      `Files: ${written.join(", ")}`;

    if (!options.deferCommit) {
      const committed = await this.commitAdaptation({
        acquisitionId,
        message: commitMessage,
        committer: options.committer ?? "",
        branch,
      });
      if (!committed.ok) return failure(committed.error, acquisitionId);
      commit = committed.commit;
      options.onStage?.(
        "approve",
        true,
        `committed ${commit.slice(0, 10)} on ${committed.branch}, approved by ${committed.approver}`,
      );
      diagnostics.push(
        `Committed ${commit.slice(0, 10)} on ${committed.branch} (version ${committed.version ?? "n/a"}), ` +
          `approved by ${committed.approver}.`,
      );
      void this.runtime.update(acquisitionId, { status: "tested" });
    } else {
      diagnostics.push(`Prepares ${branch}; the commit is deferred to the caller's approval stage.`);
    }

    const evidence: AdaptationEvidence = {
      acquisitionId,
      capability: `acquired.${capability}`,
      extracted,
      written,
      rationale,
      branch: commit ? branch : null,
      commit,
      sourceCommit: clone.acquisition.commit,
      license: licenseSpdx,
    };

    const status = options.deferCommit ? "running" : commit ? "delivered" : "blocked";
    this.store.saveAssignment({
      ...assignment,
      status,
      acquisitionId,
      failure: !options.deferCommit && !commit ? "The adaptation was built but no commit could be recorded." : undefined,
    });

    return {
      ok: options.deferCommit || commit !== null,
      acquisitionId,
      evidence,
      tests,
      diagnostics,
      failure: !options.deferCommit && !commit ? "The adaptation was built but no commit could be recorded." : null,
      written,
    };
  }

  /**
   * Commit the prepared adaptation. Separated from execute() so a
   * pipeline can run its tests and take the operator's approval first.
   *
   * Approval happens twice and both are required: a named operator at
   * this boundary, and the runtime's own single-use grant.
   */
  async commitAdaptation(input: {
    acquisitionId: string;
    message: string;
    committer: string;
    branch?: string;
  }): Promise<
    | { ok: true; commit: string; branch: string; version: string | null; approver: string }
    | { ok: false; error: string }
  > {
    if (!input.committer.trim()) {
      return { ok: false, error: "Commit refused: no named operator approved it." };
    }
    const local = ApprovalGate.getInstance().authorize(
      "canonical-write",
      input.acquisitionId,
      input.committer,
      `Commit the adaptation to ${input.branch ?? "the acquisition branch"}`,
    );
    if (!local.allowed) return { ok: false, error: `Commit refused: ${local.reason}` };

    const serverApproval = await this.runtime.approve({ scope: "canonical-write", targetId: input.acquisitionId });
    if (!serverApproval.ok) {
      return { ok: false, error: `The runtime refused the commit approval: ${serverApproval.error}` };
    }
    ApprovalGate.getInstance().consume("canonical-write", input.acquisitionId);

    const committed = await this.runtime.commit(input.acquisitionId, input.message, serverApproval.nonce);
    if (!committed.ok) return { ok: false, error: `Commit failed: ${committed.error}` };

    void this.runtime.update(input.acquisitionId, { status: "tested" });
    return {
      ok: true,
      commit: committed.commit,
      branch: committed.branch,
      version: committed.version,
      approver: committed.approver,
    };
  }

  private toTestEvidence(label: string, result: { status: number; ok: boolean; durationMs: number; stdout: string; stderr: string }): TestEvidence {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      command: label,
      exitCode: result.status,
      ok: result.ok,
      durationMs: result.durationMs,
      outputTail: output.slice(-2000),
      ranAt: Date.now(),
    };
  }
}
