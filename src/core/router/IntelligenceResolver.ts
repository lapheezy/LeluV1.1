/**
 * ==========================================================
 * LÉLU — INTELLIGENCE RESOLVER (chat)
 *
 * A stage in the EXISTING router chain. It answers operational
 * questions from the live cross-studio snapshot instead of from
 * the model's memory:
 *
 *   "what is operational?"              → snapshot
 *   "why can't you run OpenHands?"      → explain + requirements
 *   "prepare yourself to use OpenHands" → approval-gated plan
 *   "which repository provides this?"   → verified catalog
 *
 * Three rules this stage cannot break:
 *
 * • It reads `/api/integration/*` — the same server surface the
 *   studios read. It never imports an adapter and never executes.
 * • It answers only when it actually got data. A failed fetch
 *   returns unhandled, so the provider answers conversationally
 *   rather than this stage inventing a status.
 * • A plan is returned as a proposal. Nothing here approves it.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import AgentEventBus from "../agent/AgentEvents";
import type { OperationalSnapshot } from "../operational-intelligence/types.ts";
import { repositoryCoverage, REPOSITORY_CATALOG } from "../operational-intelligence/repositories.ts";

export type IntelligenceIntent =
  | { kind: "snapshot" }
  | { kind: "explain"; capability: string }
  | { kind: "plan"; goal: string }
  | { kind: "repositories"; topic: string };

/** Keyword → the capability ids it can refer to, most specific first. */
const CAPABILITY_HINTS: Array<{ pattern: RegExp; ids: string[] }> = [
  { pattern: /openhands/i, ids: ["engineering.openhands.execute", "engineering.openhands.runtime"] },
  { pattern: /opencode/i, ids: ["engineering.opencode.execute", "engineering.opencode.runtime"] },
  { pattern: /whisper|transcri|recogni[sz]e|speech.to.text/i, ids: ["voice.recognition.transcribe"] },
  { pattern: /kokoro|synth|speak|voice out/i, ids: ["voice.synthesis.speak"] },
  { pattern: /pipecat|audio pipeline/i, ids: ["voice.pipeline.realtime"] },
  { pattern: /silero|\bvad\b/i, ids: ["voice.vad.silero", "voice.vad.energy"] },
  { pattern: /\bopa\b|policy engine/i, ids: ["security.policy.opa"] },
  { pattern: /semgrep/i, ids: ["security.scanner.semgrep"] },
  { pattern: /trivy/i, ids: ["security.scanner.trivy"] },
  { pattern: /gitleaks/i, ids: ["security.scanner.gitleaks"] },
  { pattern: /litellm/i, ids: ["infrastructure.litellm"] },
  { pattern: /temporal/i, ids: ["infrastructure.temporal"] },
  { pattern: /opentelemetry|\botel\b/i, ids: ["infrastructure.opentelemetry"] },
  { pattern: /engineering|coding|code\b/i, ids: ["engineering.local.execute", "engineering.openhands.execute"] },
  { pattern: /voice|hear|listen/i, ids: ["voice.synthesis.speak", "voice.recognition.transcribe"] },
];

const STUDIO_STATUS = /\b(what('?s| is) (operational|working|usable)|what can you actually do|studio (status|state)|capabilit(y|ies) (status|report)|what('?s| is) missing|what('?s| is) blocked|which studios?)\b/i;
const EXPLAIN = /\b(why (can'?t|cannot|aren'?t|isn'?t|is|are|does|do)|what('?s| is) blocking|why (is|are) .* (blocked|not configured|down)|explain (the )?(blocker|status))\b/i;
const PLAN = /\b(prepare yourself|set yourself up|what would it take|what would installing|how (do|would) (i|we) (enable|configure|install|set up)|make yourself able|activate)\b/i;
const REPOS = /\b(repositor(y|ies)|open.?source|which (project|package)|what would i need to install)\b/i;

/**
 * Decide whether a prompt is an operational question this stage owns.
 *
 * Deliberately narrow: a question only qualifies when it names a
 * capability, a studio or a repository. Ordinary conversation about
 * code or voice must keep reaching the model.
 */
export function detectIntelligenceIntent(prompt: string): IntelligenceIntent | null {
  const text = prompt.trim();
  if (!text) return null;

  const named = CAPABILITY_HINTS.find((hint) => hint.pattern.test(text));

  if (PLAN.test(text) && (named || STUDIO_STATUS.test(text) || /\bengineering|voice|security|infrastructure|openhands|opencode\b/i.test(text))) {
    return { kind: "plan", goal: text.slice(0, 400) };
  }

  if (EXPLAIN.test(text)) {
    if (named) return { kind: "explain", capability: named.ids[0]! };
    const studio = text.match(/\b(engineering|voice|security|infrastructure)\b/i)?.[1]?.toLowerCase();
    if (studio) return { kind: "snapshot" };
    return null;
  }

  if (STUDIO_STATUS.test(text)) return { kind: "snapshot" };

  if (REPOS.test(text) && /\b(which|what|capabilit|blocked|missing|install)\b/i.test(text)) {
    return { kind: "repositories", topic: text.slice(0, 200) };
  }

  return null;
}

/* ---------------------------- formatting ---------------------------- */

const USABLE = new Set(["AVAILABLE", "VERIFIED", "COMPLETED"]);

function usableCount(capabilities: OperationalSnapshot["capabilities"]): number {
  return capabilities.filter((capability) => USABLE.has(capability.state)).length;
}

/** The snapshot as an operator reads it — counts first, then the blockers. */
export function formatSnapshot(snapshot: OperationalSnapshot): string {
  const readiness = snapshot.overallReadiness;
  const studios = snapshot.studioStatuses;
  const lines: string[] = [];

  lines.push(
    `**Operational snapshot** — ${new Date(snapshot.timestamp).toISOString()} (${snapshot.collection.durationMs} ms, ${
      snapshot.collection.studiosRead}/${studios.length
    } studios read${snapshot.collection.fromCache ? ", cached" : ", read just now"})`,
  );
  lines.push("");
  lines.push(
    `Readiness **${(readiness.score * 100).toFixed(0)}%** — ${readiness.readyCapabilities} of ${readiness.totalCapabilities} capabilities usable, ${readiness.blockedCapabilities} blocked or unconfigured.`,
  );
  lines.push("");
  lines.push("## Studios");

  for (const studio of studios) {
    const usable = usableCount(studio.capabilities);
    const suffix = studio.error ? ` — unreadable: ${studio.error}` : "";
    lines.push(
      `- **${studio.studioId}**: ${studio.operationalState} — ${usable}/${studio.capabilities.length} usable${suffix}`,
    );
  }

  const blocked = snapshot.capabilities.filter((capability) => capability.state === "BLOCKED" || capability.state === "NOT_CONFIGURED");
  if (blocked.length > 0) {
    lines.push("");
    lines.push("## What is blocking");
    for (const capability of blocked.slice(0, 10)) {
      lines.push(`- \`${capability.capabilityId}\` — ${capability.state}: ${capability.blockingReasons[0] ?? "no reason reported"}`);
    }
    if (blocked.length > 10) lines.push(`- …and ${blocked.length - 10} more`);
  }

  const unreadable = studios.filter((studio) => studio.error);
  if (unreadable.length > 0) {
    lines.push("");
    lines.push("## Studios that could not be read");
    for (const studio of unreadable) lines.push(`- ${studio.studioId}: ${studio.error}`);
  }

  lines.push("");
  lines.push(`Every line above comes from the four studio sources; ${snapshot.collection.studiosFailed} failed. Nothing here is inferred.`);
  return lines.join("\n");
}

export interface ExplanationPayload {
  capabilityId: string;
  state: string;
  reasons: string[];
  requirements: Array<{ required: string; state: string; reason: string }>;
}

export function formatExplanation(payload: ExplanationPayload): string {
  const lines: string[] = [];
  lines.push(`**\`${payload.capabilityId}\`** is **${payload.state}**.`);
  if (payload.reasons.length > 0) {
    lines.push("");
    lines.push("Why:");
    for (const reason of payload.reasons) lines.push(`- ${reason}`);
  }
  if (payload.requirements.length > 0) {
    lines.push("");
    lines.push("Requirements:");
    for (const requirement of payload.requirements) {
      const mark = requirement.reason === "satisfied" ? "met" : "missing";
      lines.push(`- \`${requirement.required}\` — ${requirement.state} (${mark})${requirement.reason === "satisfied" ? "" : `: ${requirement.reason}`}`);
    }
  }
  if (payload.state === "NOT_REPORTED") {
    lines.push("");
    lines.push("No studio reported this capability, so I cannot describe it as working or broken — only absent.");
  }
  return lines.join("\n");
}

export interface PlanPayload {
  plan: {
    goal: string;
    status: string;
    approvalRequired: boolean;
    steps: Array<{ title: string; status: string; observedState: string; description: string; requiresApproval: boolean }>;
    execution: { started: false; note: string };
    evidence: string[];
  };
}

export function formatPlan(payload: PlanPayload): string {
  const { plan } = payload;
  const lines: string[] = [];
  lines.push(`**Plan:** ${plan.goal}`);
  lines.push(
    `Status **${plan.status}**${plan.approvalRequired ? " — approval is required before any step runs" : ""}.`,
  );
  lines.push("");
  for (const [index, step] of plan.steps.entries()) {
    lines.push(`${index + 1}. **${step.title}** — ${step.status} (observed: ${step.observedState})`);
    if (step.description) lines.push(`   ${step.description}`);
  }
  lines.push("");
  lines.push(`Nothing has run. ${plan.execution.note}`);
  return lines.join("\n");
}

export function formatRepositories(topic = ""): string {
  const coverage = repositoryCoverage();
  const lines: string[] = [];
  lines.push(
    `**${coverage.total} repositories assessed** — ${coverage.verified} with a verified upstream and licence, ${coverage.unverified.length} that cannot be pinned from the name alone.`,
  );
  lines.push("");
  lines.push("## Already providing a capability (real adapters)");
  for (const record of REPOSITORY_CATALOG.filter((item) => item.integration === "PRESENT")) {
    lines.push(`- **${record.name}** — ${record.license}; ${record.statusDetail}`);
  }
  lines.push("");
  lines.push("## Assessed, boundary identified, not running");
  for (const record of REPOSITORY_CATALOG.filter((item) => item.integration === "ADAPTED" || item.integration === "PLANNED")) {
    lines.push(`- **${record.name}** (${record.license}) → ${record.boundary}`);
  }
  if (coverage.unverifiedDetail.length > 0) {
    lines.push("");
    lines.push("## Cannot be verified as named");
    for (const item of coverage.unverifiedDetail) lines.push(`- **${item.name}** — ${item.actual}`);
  }
  lines.push("");
  lines.push(
    `Catalog entries describe intent and provenance, not runtime state${topic ? ` (asked about: ${topic})` : ""}. Installation is never implied.`,
  );
  return lines.join("\n");
}

/* ----------------------------- the stage ----------------------------- */

async function getJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body?.error ?? `Request failed with ${response.status}.`);
  return body;
}

export default class IntelligenceResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request?.prompt ?? "";
    const intent = detectIntelligenceIntent(prompt);
    if (!intent) return { handled: false };
    if (typeof fetch !== "function") return { handled: false };

    const taskId = String(context.request.timestamp ?? Date.now());
    const events = AgentEventBus.getInstance();
    const label = `operational ${intent.kind}`;
    events.emit({ type: "tool_selected", taskId, tool: "intelligence", label });

    try {
      let text: string;
      let model: string;

      if (intent.kind === "snapshot") {
        const payload = await getJson<{ snapshot: OperationalSnapshot }>("/api/integration/intelligence");
        text = formatSnapshot(payload.snapshot);
        model = "operational-snapshot";
      } else if (intent.kind === "explain") {
        const payload = await getJson<ExplanationPayload>(
          `/api/integration/intelligence/explain?capability=${encodeURIComponent(intent.capability)}`,
        );
        if (payload.state === "NOT_REPORTED") {
          // Ask the snapshot which capabilities DO exist before claiming absence.
          const snapshot = await getJson<{ snapshot: OperationalSnapshot }>("/api/integration/intelligence");
          const alternatives = snapshot.snapshot.capabilities
            .filter((capability) => capability.capabilityId.includes(intent.capability.split(".")[0] ?? ""))
            .slice(0, 6)
            .map((capability) => `- \`${capability.capabilityId}\` — ${capability.state}`);
          text = [formatExplanation(payload), alternatives.length ? `\nReported capabilities nearby:\n${alternatives.join("\n")}` : ""]
            .join("\n")
            .trim();
        } else {
          text = formatExplanation(payload);
        }
        model = "capability-explanation";
      } else if (intent.kind === "plan") {
        const response = await fetch("/api/integration/intelligence/plan", {
          method: "POST",
          headers: { "content-type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ goal: intent.goal }),
          signal: AbortSignal.timeout(12_000),
        });
        const payload = (await response.json().catch(() => ({}))) as PlanPayload & { error?: string };
        if (!response.ok || !payload.plan) throw new Error(payload.error ?? `Plan refused with ${response.status}.`);
        text = formatPlan(payload);
        model = "activation-plan";
      } else {
        text = formatRepositories(intent.topic);
        model = "repository-catalog";
      }

      events.emit({ type: "tool_result", taskId, tool: "intelligence", result: `${intent.kind} answered from live state` });

      const response: AIResponse = {
        text,
        provider: "intelligence",
        model,
        processingTime: Date.now() - context.started,
        metadata: { source: "IntelligenceResolver", kind: intent.kind, live: true },
      };
      context.logger.info("IntelligenceResolver", "Answered from operational intelligence", { kind: intent.kind });
      return { handled: true, response };
    } catch (error) {
      // No data, no answer: the provider keeps the turn rather than this
      // stage describing a state it could not read.
      events.emit({
        type: "execution_phase",
        taskId,
        phase: "error",
        label: "Operational intelligence unavailable",
        side: "backend",
        detail: error instanceof Error ? error.message : String(error),
      });
      return { handled: false };
    }
  }
}
