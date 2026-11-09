/**
 * ==========================================================
 * LÉLU — ACQUISITION RESOLVER
 *
 * Makes the repository workforce accessible in ordinary conversation.
 * "Find an open-source memory system, research it, acquire it, adapt
 * it, test it and integrate it" is carried out by the real Repo
 * Executive and Repo Executor through the command center — not
 * narrated by a model.
 *
 * The boundary is explicit and conversational:
 *
 *   turn 1  → prepare: real discovery/research, a real proposal,
 *             the council's review, and the prepared id
 *   turn 2  → "approve cmd-…": run the pipeline (selftest evidence,
 *             commit approval, registration approval)
 *
 * A model/provider is never asked to claim an acquisition happened;
 * this resolver either ran the operation and reports its real result
 * or leaves the turn untouched.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";
import EngineeringCommandCenter from "../acquisition/EngineeringCommandCenter";

const PREPARE_VERB =
  /\b(acquire|acquiring|integrate|integrating|adopt|bring in|pull in|research|find|evaluate)\b/i;
const SUBJECT = /\b(open[- ]source|repositor(?:y|ies)|repo|library|package|module|engine|system|capability|project)\b/i;
const STATUS = /\b(acquisition|repository|repo)\s+(status|state|summary|report)\b|\bwhat are you acquiring\b|\bpending acquisition\b/i;
const APPROVE = /^\s*(?:please\s+)?(?:approve|integrate it|proceed|go ahead|yes,?\s*(?:integrate|proceed|approve))\b/i;
const REPO_URL = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:[\/\s]|$)/i;
const REPO_SLUG = /\b([A-Za-z0-9][A-Za-z0-9_.-]{1,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{1,38})\b/;

const OPERATOR = "chat-operator";

function response(context: RouterContext, text: string, data?: Record<string, unknown>): AIResponse {
  return {
    text,
    provider: "acquisition",
    model: "repo-workforce",
    processingTime: Date.now() - context.started,
    metadata: { intent: "engineering", success: true, ...(data ?? {}) },
  };
}

function extractRepository(prompt: string): string | undefined {
  const url = REPO_URL.exec(prompt);
  if (url) return url[1].replace(/\.git$/, "");
  const slug = REPO_SLUG.exec(prompt);
  if (!slug) return undefined;
  const candidate = slug[1];
  // Reject file paths and prose like "and/or".
  if (/^(and|or|the|a|an)\//i.test(candidate)) return undefined;
  if (/\.(ts|tsx|js|json|md|css|html)$/i.test(candidate)) return undefined;
  return candidate;
}

function extractKeywords(prompt: string, repository?: string): string {
  let text = prompt;
  if (repository) {
    text = text.replace(new RegExp(repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    text = text.replace(/https?:\/\/\S+/gi, " ");
  }
  const cleaned = text
    .replace(/\b(please|lelu|lélu|can you|could you|i want you to|i'd like you to|would you)\b/gi, " ")
    .replace(/\b(acquire|acquiring|integrate|integrating|adopt|bring in|pull in|research|find|evaluate)\b/gi, " ")
    .replace(/\b(open[- ]source|repositor(?:y|ies)|repo|library|package|module|project)\b/gi, " ")
    .replace(/\b(and|then|it|its|to|for|from|with|into|your|existing|architecture|test|tests|adapted?|adapt|the|a|an|of|that|which|improves?|improve|add|adds)\b/gi, " ")
    .replace(/[^A-Za-z0-9+#._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "capability";
}

export default class AcquisitionResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = (context.request.prompt ?? "").trim();
    if (!prompt) return { handled: false };
    const center = EngineeringCommandCenter.getInstance();

    if (STATUS.test(prompt)) {
      const snapshot = center.snapshot();
      const pending = snapshot.pending;
      return {
        handled: true,
        response: response(
          context,
          [
            `Acquisition state: ${snapshot.completed.length} registered capabilit${snapshot.completed.length === 1 ? "y" : "ies"}, ` +
              `${snapshot.assignments.length} assignment(s), ${snapshot.blocked.length} blocked.`,
            pending
              ? `Prepared ${pending.id}: ${pending.proposal.candidate.identifier} — ${pending.proposal.findings.license.spdx}, ` +
                `priority ${pending.proposal.priority}/100. Reply "approve ${pending.id}" to integrate it.`
              : "Nothing is prepared and awaiting approval.",
            snapshot.runs[0]
              ? `Latest run: ${snapshot.runs[0].stage} · ${snapshot.runs[0].complete ? "complete" : snapshot.runs[0].failure ? `stopped — ${snapshot.runs[0].failure}` : "in progress"}`
              : "No pipeline run has been recorded.",
          ].join("\n"),
          { acquisition: snapshot },
        ),
      };
    }

    const pending = center.getPending();
    if (APPROVE.test(prompt)) {
      if (!pending) {
        return {
          handled: true,
          response: response(context, "There is no prepared acquisition to approve. Describe the capability first and I will research it."),
        };
      }
      const events = AgentEventBus.getInstance();
      const taskId = `acq-${Date.now().toString(36)}`;
      events.emit({ type: "tool_selected", taskId, tool: "repo.pipeline", label: `acquire ${pending.proposal.candidate.identifier}` });
      events.emit({ type: "tool_started", taskId, tool: "repo.pipeline", label: "running the acquisition pipeline" });
      try {
        const executed = await center.execute(pending.id, OPERATOR);
        const run = executed.result?.run;
        const lines = run
          ? run.events.map((event) => `${event.ok ? "✓" : "✗"} ${event.stage}: ${event.detail}`)
          : [];
        const text = executed.ok
          ? [
              `Approved and integrated ${pending.proposal.candidate.identifier}.`,
              ...lines,
              "",
              `Capability: ${executed.result?.capability?.id ?? "none"}`,
              `Use: ${executed.result?.useResult ?? "not called"}`,
              "It is now listed in the capability marketplace.",
            ].join("\n")
          : [
              `The acquisition was not completed: ${executed.error ?? "the pipeline stopped."}`,
              ...lines,
            ].join("\n");
        events.emit({
          type: "tool_result",
          taskId,
          tool: "repo.pipeline",
          status: executed.ok ? "complete" : "error",
          result: executed.ok ? "capability registered" : "pipeline stopped",
        });
        return {
          handled: true,
          response: response(context, text, { acquisition: executed, run: run ?? null }),
        };
      } catch (error) {
        events.emit({ type: "tool_result", taskId, tool: "repo.pipeline", status: "error", result: "pipeline failed" });
        return {
          handled: true,
          response: response(
            context,
            `The acquisition failed before it could register anything: ${error instanceof Error ? error.message : String(error)}`,
          ),
        };
      }
    }

    if (!PREPARE_VERB.test(prompt) || !SUBJECT.test(prompt)) return { handled: false };
    if (/\b(how do i|how to|explain|what is)\b/i.test(prompt)) return { handled: false };
    if (context.intent === "avatar" || context.intent === "time") return { handled: false };

    const repository = extractRepository(prompt);
    const keywords = extractKeywords(prompt, repository);
    const events = AgentEventBus.getInstance();
    const taskId = `acq-${Date.now().toString(36)}`;
    events.emit({ type: "tool_selected", taskId, tool: "repo.research", label: "repository research" });
    events.emit({ type: "tool_started", taskId, tool: "repo.research", label: "discovering and researching" });

    try {
      const prepared = await center.prepare(prompt, {
        repository,
        keywords,
        requestedBy: "chat",
      });
      const proposal = prepared.proposal;
      events.emit({ type: "tool_result", taskId, tool: "repo.research", status: "complete", result: proposal.candidate.identifier });
      const council = prepared.council;
      return {
        handled: true,
        response: response(
          context,
          [
            `I researched ${proposal.candidate.identifier} for “${prepared.requestedCapability}”.`,
            `Priority ${proposal.priority}/100 — ${proposal.reasons.slice(0, 3).join(" ")}`,
            `Licence ${proposal.findings.license.spdx} (${proposal.findings.license.risk}); compatibility ${Math.round(proposal.findings.compatibility.score * 100)}% (${proposal.findings.compatibility.runtime}); security ${proposal.findings.security.riskLevel}.`,
            `Capability signals: ${proposal.findings.capabilities.slice(0, 8).join(", ") || "none detected"}.`,
            council
              ? `Council: ${council.verdict} — ${council.reports.length} specialists reviewed in ${council.durationMs}ms.` +
                (council.risks.length > 0 ? ` Risks: ${council.risks.slice(0, 3).join(" ")}` : "")
              : "Council review was unavailable.",
            "",
            `Prepared as ${prepared.id}. Nothing has been cloned, committed or registered yet.`,
            `Reply "approve ${prepared.id}" to acquire, adapt, test and integrate it.`,
          ].join("\n"),
          { acquisition: prepared },
        ),
      };
    } catch (error) {
      events.emit({ type: "tool_result", taskId, tool: "repo.research", status: "error", result: "research failed" });
      const message = error instanceof Error ? error.message : String(error);
      return {
        handled: true,
        response: response(
          context,
          `I could not prepare that acquisition: ${message}\n\n` +
            "Give me a repository as owner/name (for example `sindresorhus/quick-lru`) and I will research it for real.",
        ),
      };
    }
  }
}
