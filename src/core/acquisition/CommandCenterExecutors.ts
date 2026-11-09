/**
 * Mission 8 workforce executors, layered onto Claude's canonical dispatcher.
 * These reach the same real acquisition runtime and knowledge base; the ids
 * that Claude already dispatches (repo.research/acquire/inspect/status) are
 * left to Claude's own executors.
 */
import type { ToolExecutor } from "../tools/ToolDispatcher";
import ToolRegistry from "../tools/ToolRegistry";
import ApprovalGate from "./ApprovalGate";

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

const COMMAND_CENTER_EXECUTORS: ToolExecutor[] = [
  {
    id: "kb.search",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for in the technology knowledge base." },
        limit: { type: "number", description: "Maximum entries to return (1-20, default 8)." },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = str(args, "query");
      if (!query) return { ok: false, content: "kb.search requires a non-empty query." };
      const { default: TechnologyKnowledgeBase } = await import("../acquisition/TechnologyKnowledgeBase");
      const requested = Number(args.limit ?? 8);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.floor(requested))) : 8;
      const hits = TechnologyKnowledgeBase.getInstance().search(query, limit);
      if (hits.length === 0) {
        return {
          ok: true,
          content: `No technology entry matched "${query}". The knowledge base holds ${TechnologyKnowledgeBase.getInstance().size()} entries.`,
          data: [],
        };
      }
      const content = [
        `${hits.length} technology entr${hits.length === 1 ? "y" : "ies"} for "${query}":`,
        ...hits.map(
          (hit) =>
            `- ${hit.entry.title} (${hit.entry.license}, score ${hit.score.toFixed(3)})` +
            `${hit.entry.integration ? ` — integrated as ${hit.entry.integration.capabilityId}` : ""}: ${hit.highlighted}`,
        ),
      ].join("\n");
      return { ok: true, content, data: hits };
    },
  },
  {
    id: "kb.describe",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { default: TechnologyKnowledgeBase } = await import("../acquisition/TechnologyKnowledgeBase");
      const { default: AcquisitionStore } = await import("../acquisition/AcquisitionStore");
      const knowledge = TechnologyKnowledgeBase.getInstance().describe();
      const capabilities = AcquisitionStore.getInstance().capabilityReport();
      return { ok: true, content: `${knowledge}\n\nAcquired capabilities:\n${capabilities}` };
    },
  },
  {
    id: "repo.search",
    parameters: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Capability to look for, e.g. \"fuzzy search\" or \"pdf text extraction\"." },
        language: { type: "string", description: "Optional primary language filter." },
        minStars: { type: "number" },
        limit: { type: "number" },
      },
      required: ["keywords"],
    },
    run: async (args) => {
      const keywords = str(args, "keywords");
      if (!keywords) return { ok: false, content: "repo.search requires keywords." };
      const { default: RepoExecutive } = await import("../acquisition/RepoExecutive");
      const result = await RepoExecutive.getInstance().discover({
        keywords,
        language: str(args, "language") || undefined,
        minStars: Number(args.minStars ?? 0) || undefined,
        limit: Number(args.limit ?? 8) || 8,
      });
      if (result.candidates.length === 0) {
        return {
          ok: false,
          content:
            `No repository was returned for "${keywords}". ` +
            (result.errors.length > 0
              ? `Source errors: ${result.errors.map((entry) => `${entry.sourceId}: ${entry.error}`).join("; ")}`
              : "GitHub returned an empty result set."),
        };
      }
      return {
        ok: true,
        content: [
          `${result.candidates.length} repository candidate(s):`,
          ...result.candidates.map(
            (candidate) =>
              `- ${candidate.identifier} — ${candidate.stars} stars, ${candidate.license || "no licence"}, ` +
              `${candidate.language || "unknown language"}, pushed ${candidate.updatedAt.slice(0, 10)}: ${candidate.description.slice(0, 160)}`,
          ),
          ...(result.errors.length > 0 ? [`Source errors: ${result.errors.map((entry) => entry.error).join("; ")}`] : []),
        ].join("\n"),
        data: result,
      };
    },
  },
  {
    id: "repo.research",
    parameters: {
      type: "object",
      properties: { identifier: { type: "string", description: "owner/repository on GitHub." } },
      required: ["identifier"],
    },
    run: async (args) => {
      const identifier = str(args, "identifier");
      if (!identifier) return { ok: false, content: "repo.research requires owner/repository." };
      const { default: RepoExecutive } = await import("../acquisition/RepoExecutive");
      const { default: RepositorySourceRegistry } = await import("../acquisition/RepositorySource");
      const executive = RepoExecutive.getInstance();
      executive.refreshSources();
      const source = RepositorySourceRegistry.getInstance().get("github");
      if (!source) return { ok: false, content: "No GitHub connector is registered, so nothing was researched." };
      try {
        const candidate = await source.metadata(identifier);
        const findings = await executive.research(candidate);
        return {
          ok: true,
          content: [
            `${findings.identifier}: ${findings.summary.slice(0, 240)}`,
            `Licence: ${findings.license.spdx} (${findings.license.risk}) — ${findings.license.obligations.join(" ")}`,
            `Capabilities: ${findings.capabilities.join(", ") || "none detected"}`,
            `Build: ${findings.buildSystem}; runtime ${findings.compatibility.runtime}; compatibility ${Math.round(findings.compatibility.score * 100)}%`,
            `Maintenance: ${findings.maintenance.commitsLast90Days} commits/90d, last ${findings.maintenance.lastCommitAt.slice(0, 10)}, ${findings.maintenance.stars} stars`,
            `Security (${findings.security.riskLevel}): ${findings.security.observations.join(" ") || "no adverse observations"}`,
          ].join("\n"),
          data: findings,
        };
      } catch (error) {
        return { ok: false, content: `Research failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  },
  {
    id: "repo.acquire",
    parameters: {
      type: "object",
      properties: {
        repository: { type: "string", description: "owner/repository or an https URL." },
        ref: { type: "string", description: "Optional branch or tag." },
      },
      required: ["repository"],
    },
    run: async (args) => {
      const repository = str(args, "repository");
      if (!repository) return { ok: false, content: "repo.acquire requires a repository." };
      const { default: AcquisitionRuntime } = await import("../acquisition/AcquisitionRuntime");
      const url = /^https?:\/\//i.test(repository) ? repository : `https://github.com/${repository}`;
      const result = await AcquisitionRuntime.getInstance().clone({ url, ref: str(args, "ref") || undefined });
      if (!result.ok) return { ok: false, content: `Acquisition failed: ${result.error}` };
      return {
        ok: true,
        content:
          `Acquired ${result.acquisition.source.identifier}@${result.acquisition.commit.slice(0, 10)} as ${result.acquisition.id} — ` +
          `${result.acquisition.fileCount} files, ${result.acquisition.license.spdx}, ` +
          `${(result.acquisition.sizeBytes / 1024).toFixed(0)} KB.`,
        data: result.acquisition,
      };
    },
  },
  {
    id: "repo.inspect",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Acquisition id." },
        path: { type: "string", description: "Directory to list, or a file to read." },
      },
      required: ["id"],
    },
    run: async (args) => {
      const id = str(args, "id");
      const target = str(args, "path") || ".";
      if (!id) return { ok: false, content: "repo.inspect requires an acquisition id." };
      const { default: AcquisitionRuntime } = await import("../acquisition/AcquisitionRuntime");
      const runtime = AcquisitionRuntime.getInstance();
      if (/\.(ts|tsx|js|mjs|json|md|txt|py|rs|go|toml|yml|yaml)$/i.test(target)) {
        const file = await runtime.read(id, target);
        if (!file.ok) return { ok: false, content: file.error };
        return { ok: true, content: `${file.path} (${file.bytes} bytes):\n${file.content}` };
      }
      const tree = await runtime.tree(id, target);
      if (!tree.ok) return { ok: false, content: tree.error };
      return {
        ok: true,
        content: [
          `${tree.entries.length} entr${tree.entries.length === 1 ? "y" : "ies"} under ${tree.root}${tree.truncated ? " (truncated)" : ""}:`,
          ...tree.entries.slice(0, 200).map((entry) => `- ${entry.path}${entry.size !== undefined ? ` (${entry.size} B)` : ""}`),
        ].join("\n"),
        data: tree.entries,
      };
    },
  },
  {
    id: "repo.exec",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Acquisition id." },
        operation: { type: "string", enum: ["install", "test", "build", "typecheck"], description: "Which declared operation to run." },
      },
      required: ["id", "operation"],
    },
    run: async (args) => {
      const id = str(args, "id");
      const operation = str(args, "operation");
      if (!id) return { ok: false, content: "repo.exec requires an acquisition id." };
      if (!["install", "test", "build", "typecheck"].includes(operation)) {
        return { ok: false, content: "operation must be install, test, build or typecheck." };
      }
      const { default: AcquisitionRuntime } = await import("../acquisition/AcquisitionRuntime");
      const result = await AcquisitionRuntime.getInstance().exec(
        id,
        operation as "install" | "test" | "build" | "typecheck",
        { timeoutMs: 600_000 },
      );
      if (!result.ok) return { ok: false, content: result.error };
      const output = `${result.result.stdout}\n${result.result.stderr}`.trim();
      return {
        ok: result.result.ok,
        content:
          `${operation} exited ${result.result.status} after ${Math.round(result.result.durationMs / 1000)}s.\n` +
          output.slice(-2000),
        data: result.result,
      };
    },
  },
  {
    id: "repo.commit",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Acquisition id." },
        message: { type: "string", description: "Commit message." },
      },
      required: ["id", "message"],
    },
    run: async (args) => {
      const id = str(args, "id");
      const message = str(args, "message");
      if (!id || !message) return { ok: false, content: "repo.commit requires an acquisition id and a message." };
      const gate = ApprovalGate.getInstance().require("canonical-write", id);
      if (!gate.allowed) return { ok: false, content: `Commit refused: ${gate.reason}` };
      const { default: AcquisitionRuntime } = await import("../acquisition/AcquisitionRuntime");
      const runtime = AcquisitionRuntime.getInstance();
      const approval = await runtime.approve({ scope: "canonical-write", targetId: id });
      if (!approval.ok) return { ok: false, content: `The runtime refused the commit grant: ${approval.error}` };
      const committed = await runtime.commit(id, message, approval.nonce);
      ApprovalGate.getInstance().consume("canonical-write", id);
      if (!committed.ok) return { ok: false, content: `Commit failed: ${committed.error}` };
      return {
        ok: true,
        content: `Committed ${committed.commit.slice(0, 10)} on ${committed.branch} (version ${committed.version ?? "n/a"}), approved by ${committed.approver}.`,
      };
    },
  },
  {
    id: "repo.rollback",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Acquisition id." },
        version: { type: "string", description: "Recorded version (v1, v2, …) or commit prefix." },
      },
      required: ["id", "version"],
    },
    run: async (args) => {
      const id = str(args, "id");
      const version = str(args, "version");
      if (!id || !version) return { ok: false, content: "repo.rollback requires an acquisition id and a version." };
      const gate = ApprovalGate.getInstance().require("destructive", id);
      if (!gate.allowed) return { ok: false, content: `Rollback refused: ${gate.reason}` };
      const { default: AcquisitionRuntime } = await import("../acquisition/AcquisitionRuntime");
      const runtime = AcquisitionRuntime.getInstance();
      const approval = await runtime.approve({ scope: "destructive", targetId: id });
      if (!approval.ok) return { ok: false, content: `The runtime refused the rollback grant: ${approval.error}` };
      const rolled = await runtime.rollback(id, version, approval.nonce);
      ApprovalGate.getInstance().consume("destructive", id);
      if (!rolled.ok) return { ok: false, content: `Rollback failed: ${rolled.error}` };
      return { ok: true, content: `Rolled ${id} back to ${rolled.version} (${rolled.commit.slice(0, 10)}), approved by ${rolled.approver}.` };
    },
  },
  {
    id: "capabilities.list",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    run: async (args) => {
      const { default: CapabilityMarketplace } = await import("../acquisition/CapabilityMarketplace");
      const entries = CapabilityMarketplace.getInstance().inventory(str(args, "query"));
      if (entries.length === 0) return { ok: true, content: "No acquired capability is registered yet.", data: [] };
      return {
        ok: true,
        content: entries
          .map(
            (entry) =>
              `- ${entry.name} (${entry.id}) — ${entry.active ? "active" : "inactive"}, ${entry.status}; ` +
              `${entry.source.identifier}@${entry.source.commit.slice(0, 10)}, ${entry.license.spdx}; tools: ${entry.tools.join(", ") || "none"}`,
          )
          .join("\n"),
        data: entries,
      };
    },
  },
  {
    id: "capabilities.activate",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (args) => {
      const id = str(args, "id");
      if (!id) return { ok: false, content: "capabilities.activate requires a capability id." };
      const { default: CapabilityMarketplace } = await import("../acquisition/CapabilityMarketplace");
      const result = CapabilityMarketplace.getInstance().activate(id);
      if (!result.ok) return { ok: false, content: result.error ?? "Activation refused." };
      await ToolRegistry.getInstance().refreshAvailability();
      return { ok: true, content: `${id} is active again.`, data: result.entry };
    },
  },
  {
    id: "capabilities.deactivate",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (args) => {
      const id = str(args, "id");
      if (!id) return { ok: false, content: "capabilities.deactivate requires a capability id." };
      const { default: CapabilityMarketplace } = await import("../acquisition/CapabilityMarketplace");
      const result = CapabilityMarketplace.getInstance().deactivate(id);
      if (!result.ok) return { ok: false, content: result.error ?? "Deactivation refused." };
      await ToolRegistry.getInstance().refreshAvailability();
      return { ok: true, content: `${id} is inactive; its tools are no longer offered.`, data: result.entry };
    },
  },
  {
    id: "capabilities.remove",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, approver: { type: "string" } },
      required: ["id", "approver"],
    },
    run: async (args) => {
      const id = str(args, "id");
      const approver = str(args, "approver");
      if (!id || !approver) return { ok: false, content: "capabilities.remove requires an id and a named approver." };
      const { default: CapabilityMarketplace } = await import("../acquisition/CapabilityMarketplace");
      const result = await CapabilityMarketplace.getInstance().remove(id, approver);
      if (!result.ok) return { ok: false, content: result.error ?? "Removal refused." };
      await ToolRegistry.getInstance().refreshAvailability();
      return { ok: true, content: `${id} was removed by ${approver}; its acquisition history is retained.` };
    },
  },
  {
    id: "repo.pipeline",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        repository: { type: "string" },
        keywords: { type: "string" },
        approver: { type: "string", description: "Named operator. Omit to only prepare." },
      },
      required: ["objective"],
    },
    run: async (args) => {
      const objective = str(args, "objective");
      if (!objective) return { ok: false, content: "repo.pipeline requires an objective." };
      const { default: EngineeringCommandCenter } = await import("../acquisition/EngineeringCommandCenter");
      const center = EngineeringCommandCenter.getInstance();
      const prepared = await center.prepare(objective, {
        repository: str(args, "repository") || undefined,
        keywords: str(args, "keywords") || objective,
      });
      const approver = str(args, "approver");
      if (!approver) {
        return {
          ok: true,
          content: `Prepared ${prepared.id}: ${prepared.proposal.candidate.identifier} — priority ${prepared.proposal.priority}/100. Call again with approver set.`,
          data: prepared,
        };
      }
      const executed = await center.execute(prepared.id, approver);
      if (!executed.ok) return { ok: false, content: executed.error ?? "The pipeline stopped.", data: executed };
      return {
        ok: true,
        content: `Capability ${executed.result?.capability?.id ?? "none"} registered. Use result: ${executed.result?.useResult ?? "none"}`,
        data: executed,
      };
    },
  },
  {
    id: "repo.maintenance",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["verify", "recover", "cleanup"] },
        approver: { type: "string" },
      },
      required: ["operation"],
    },
    run: async (args) => {
      const operation = str(args, "operation");
      if (!["verify", "recover", "cleanup"].includes(operation)) {
        return { ok: false, content: "operation must be verify, recover or cleanup." };
      }
      if (operation === "cleanup") {
        const { default: DurableAcquisitions } = await import("../acquisition/DurableAcquisitions");
        const result = await DurableAcquisitions.getInstance().cleanup(str(args, "approver"));
        return {
          ok: result.ok,
          content: result.ok
            ? `Removed ${result.removed.length} experimental acquisition(s); kept ${result.kept.length}.`
            : (result.error ?? "Cleanup refused."),
          data: result,
        };
      }
      const { default: AcquisitionRuntime } = await import("../acquisition/AcquisitionRuntime");
      const result = await AcquisitionRuntime.getInstance().maintenance(operation as "verify" | "recover");
      if (!result.ok) return { ok: false, content: result.error ?? "Maintenance failed." };
      return {
        ok: true,
        content:
          operation === "recover"
            ? `Recovered ${result.recovered.length} acquisition(s).`
            : `${result.findings.filter((finding: { status: string }) => finding.status === "ok").length}/${result.findings.length} acquisition(s) verified.`,
        data: result,
      };
    },
  },
  {
    id: "creator.build",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        kind: { type: "string", enum: ["website", "tool", "api", "agent", "dashboard", "game"] },
      },
      required: ["objective"],
    },
    run: async (args) => {
      const objective = str(args, "objective");
      if (!objective) return { ok: false, content: "creator.build requires an objective." };
      const { default: CreatorStudio } = await import("../acquisition/CreatorStudio");
      const studio = CreatorStudio.getInstance();
      const kind = (str(args, "kind") || "website") as "website" | "tool" | "api" | "agent" | "dashboard" | "game";
      const result = await studio.create(studio.plan(objective, kind));
      if (!result.ok) return { ok: false, content: result.error ?? "Creation failed.", data: result };
      return {
        ok: true,
        content:
          `Wrote ${result.written.length} file(s) into workspace ${result.workspaceId}: ${result.written.join(", ")}. ` +
          `Typecheck: ${result.validation ? (result.validation.ok ? `exit 0 in ${result.validation.durationMs}ms` : `exit ${result.validation.exitCode}`) : "not run"}.`,
        data: result,
      };
    },
  },
  {
    id: "memory.cache",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["put", "get", "stats", "selftest", "clear"] },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["action"],
    },
    run: async (args) => {
      const action = str(args, "action");
      const { WORKING_MEMORY, selftestBoundedCache } = await import("../acquisition/capabilities/BoundedCache");
      if (action === "selftest") {
        const result = selftestBoundedCache();
        return {
          ok: result.ok,
          content: `Bounded cache self-test ${result.ok ? "passed" : "failed"}:\n${result.steps.join("\n")}\nstats ${JSON.stringify(result.stats)}`,
          data: result,
        };
      }
      if (action === "stats") return { ok: true, content: JSON.stringify(WORKING_MEMORY.stats()), data: WORKING_MEMORY.stats() };
      if (action === "clear") { WORKING_MEMORY.clear(); return { ok: true, content: "Working cache cleared." }; }
      const key = str(args, "key");
      if (!key) return { ok: false, content: `memory.cache ${action} requires a key.` };
      if (action === "put") {
        WORKING_MEMORY.set(key, str(args, "value"));
        return { ok: true, content: `Stored "${key}" (${WORKING_MEMORY.size}/${WORKING_MEMORY.stats().maxSize} entries).` };
      }
      const value = WORKING_MEMORY.get(key);
      return value === undefined
        ? { ok: false, content: `No live entry for "${key}".` }
        : { ok: true, content: value, data: { key, value } };
    },
  },
];


export default COMMAND_CENTER_EXECUTORS;
