/**
 * ==========================================================
 * LÉLU — REPOSITORY WORKFORCE TOOLS
 *
 * The seam between Mission 7's acquisition workforce and the
 * cognition loop that already exists.
 *
 * Nothing is re-implemented here. RepoExecutive already
 * researches real repositories and assigns work; RepoExecutor
 * already clones, inspects, adapts, tests and commits against a
 * real acquisition runtime. What was missing was a way for LÉLU
 * to REACH them from a conversation: a tool table entry, which
 * is the only thing ToolDispatcher will ever offer a model.
 *
 * So these are adapters, not a second engine:
 *
 *   repo.research   gaps → discover → research → rank   (risk 3)
 *   repo.acquire    assign → acquire → adapt → test     (risk 3)
 *   repo.inspect    real tree/manifest/license reads    (risk 0)
 *   repo.status     what exists, what ran, what failed  (risk 0)
 *
 * An executor that fails returns ok:false with the runtime's own
 * error text. There is no path here that reports an acquisition
 * it did not perform.
 * ==========================================================
 */

import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import RepoExecutive from "../acquisition/RepoExecutive";
import RepoExecutor from "../acquisition/RepoExecutor";
import AcquisitionStore from "../acquisition/AcquisitionStore";
import AcquisitionRuntime from "../acquisition/AcquisitionRuntime";
import type { AcquisitionProposal } from "../acquisition/AcquisitionTypes";

interface ToolExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function count(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = Number(args[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(max, Math.floor(value)) : fallback;
}

/** One line per proposal: what it is, how it ranked, and why. */
function describeProposal(proposal: AcquisitionProposal, index: number): string {
  const license = proposal.findings.license?.spdx ?? "license unknown";
  const reasons = proposal.reasons.slice(0, 2).join("; ");
  const risks = proposal.risks.length ? ` | risks: ${proposal.risks.slice(0, 2).join("; ")}` : "";
  return `${index + 1}. ${proposal.candidate.identifier} — priority ${proposal.priority}/100, ${license}. ${reasons}${risks}`;
}

export const ACQUISITION_EXECUTORS: ToolExecutor[] = [
  {
    id: "repo.research",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "What LÉLU needs, in her own words, e.g. 'a memory architecture for my ecosystem'." },
        keywords: { type: "string", description: "Search terms for repository discovery. Defaults to the objective." },
        language: { type: "string", description: "Optional primary language filter." },
        limit: { type: "number", description: "How many candidates to research (default 5, max 10)." },
      },
      required: ["objective"],
    },
    run: async (args) => {
      const objective = str(args, "objective");
      if (!objective) return { ok: false, content: "repo.research needs an objective." };
      const keywords = str(args, "keywords") || objective;
      const executive = RepoExecutive.getInstance();

      const { proposals, errors, gaps } = await executive.proposals(objective, {
        keywords,
        ...(str(args, "language") ? { language: str(args, "language") } : {}),
        limit: count(args, "limit", 5, 10),
      });

      if (proposals.length === 0) {
        const why = errors.length
          ? ` The sources answered with errors: ${errors.map((entry) => `${entry.sourceId}: ${entry.error}`).join("; ")}.`
          : "";
        return { ok: false, content: `No repository could be researched for "${keywords}".${why}` };
      }

      const ranked = proposals.slice(0, 5);
      const text = [
        `Researched ${proposals.length} candidate(s) for "${objective}":`,
        ...ranked.map(describeProposal),
        ...(gaps.length ? [`Capability gaps this would close: ${gaps.slice(0, 3).map((gap) => `${gap.name} [${gap.status}]`).join(", ")}.`] : []),
      ].join("\n");

      return {
        ok: true,
        content: text,
        data: {
          proposals: ranked.map((proposal) => ({
            identifier: proposal.candidate.identifier,
            url: proposal.candidate.url,
            priority: proposal.priority,
            license: proposal.findings.license?.spdx ?? null,
            reasons: proposal.reasons,
            risks: proposal.risks,
            recommendedIntegration: proposal.recommendedIntegration,
          })),
          errors,
          gaps: gaps.slice(0, 5),
        },
      };
    },
  },

  {
    id: "repo.acquire",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The capability being acquired and why." },
        identifier: { type: "string", description: "A specific repository (owner/name or URL). Omit to use the best research result." },
        keywords: { type: "string", description: "Search terms when no identifier is given." },
        maxFiles: { type: "number", description: "Maximum source files to extract (default 8, max 16)." },
        skipTests: { type: "boolean", description: "Skip the repository's own install/test commands." },
        authorized: { type: "boolean", description: "The user approved a commit on an isolated branch." },
      },
      required: ["objective"],
    },
    run: async (args) => {
      const objective = str(args, "objective");
      if (!objective) return { ok: false, content: "repo.acquire needs an objective." };
      const identifier = str(args, "identifier");
      const executive = RepoExecutive.getInstance();

      let proposal: AcquisitionProposal | undefined;
      if (identifier) {
        proposal = await executive.proposeFor(identifier, objective, str(args, "keywords") || identifier);
      } else {
        const keywords = str(args, "keywords") || objective;
        const found = await executive.proposals(objective, { keywords, limit: 3 });
        proposal = found.proposals[0];
        if (!proposal) {
          const why = found.errors.length
            ? ` Sources: ${found.errors.map((entry) => `${entry.sourceId}: ${entry.error}`).join("; ")}.`
            : "";
          return { ok: false, content: `Nothing to acquire for "${keywords}".${why}` };
        }
      }

      const assignment = executive.assign(proposal, objective, "lelu");
      const stages: string[] = [];
      const outcome = await RepoExecutor.getInstance().execute(assignment, {
        maxFiles: count(args, "maxFiles", 8, 16),
        skipRepositoryTests: args.skipTests === true,
        // A commit needs authorization; without it the executor stops short of
        // one and says so, rather than committing and calling it approved.
        ...(args.authorized === true ? { committer: "user-authorized" } : {}),
        onStage: (stage, ok, detail) => stages.push(`${stage}: ${ok ? "ok" : "failed"} — ${detail}`),
      });

      const text = [
        `Assignment ${assignment.id} against ${proposal.candidate.identifier}: ${outcome.ok ? "completed" : "failed"}.`,
        ...stages,
        ...(outcome.written.length ? [`Files written: ${outcome.written.join(", ")}`] : []),
        ...(outcome.tests.length
          ? [`Tests: ${outcome.tests.map((test) => `${test.command} → exit ${test.exitCode ?? "not run"}`).join("; ")}`]
          : []),
        ...(outcome.failure ? [`Failure: ${outcome.failure}`] : []),
      ].join("\n");

      return {
        ok: outcome.ok,
        content: text,
        data: {
          assignmentId: assignment.id,
          acquisitionId: outcome.acquisitionId,
          written: outcome.written,
          tests: outcome.tests,
          diagnostics: outcome.diagnostics,
          failure: outcome.failure,
        },
      };
    },
  },

  {
    id: "repo.inspect",
    parameters: {
      type: "object",
      properties: {
        acquisitionId: { type: "string", description: "Acquisition to inspect. Defaults to the most recent one." },
      },
    },
    run: async (args) => {
      const store = AcquisitionStore.getInstance();
      const id = str(args, "acquisitionId") || store.acquisitions().slice(-1)[0]?.id || "";
      if (!id) return { ok: false, content: "There is no acquisition to inspect yet." };

      const result = (await RepoExecutor.getInstance().inspect(id)) as unknown as {
        ok: boolean;
        error?: string;
        structure?: unknown[];
        manifest?: unknown;
        readme?: string | null;
        license?: unknown;
      };

      if (!result.ok) return { ok: false, content: `Inspection of ${id} failed: ${result.error ?? "unknown error"}` };

      const record = store.getAcquisition(id);
      return {
        ok: true,
        content: [
          `Acquisition ${id}${record ? ` — ${record.source.url} @ ${record.commit.slice(0, 10)}` : ""}`,
          `Top-level entries: ${Array.isArray(result.structure) ? result.structure.length : 0}`,
          `License: ${JSON.stringify(result.license ?? "unknown").slice(0, 160)}`,
        ].join("\n"),
        data: result,
      };
    },
  },

  {
    id: "repo.status",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const store = AcquisitionStore.getInstance();
      const runtime = AcquisitionRuntime.getInstance();
      const status = (await runtime.status()) as unknown as { ok: boolean; error?: string };
      const acquisitions = store.acquisitions();
      const assignments = store.assignments();
      const capabilities = store.capabilities();

      return {
        ok: true,
        content: [
          runtime.isReachable()
            ? `Runtime reachable${status && status.ok === false ? `, status error: ${status.error}` : ""}.`
            : `Runtime not reachable${runtime.getLastError() ? `: ${runtime.getLastError()}` : "."}`,
          RepoExecutive.getInstance().report(),
          `Acquisitions: ${acquisitions.length ? acquisitions.map((record) => record.id).join(", ") : "none"}.`,
          `Assignments: ${assignments.length ? assignments.map((assignment) => `${assignment.id} [${assignment.status}]`).join(", ") : "none"}.`,
          `Capabilities: ${capabilities.length ? capabilities.map((capability) => capability.name).join(", ") : "none"}.`,
        ].join("\n"),
        data: { acquisitions, assignments, capabilities },
      };
    },
  },
];
