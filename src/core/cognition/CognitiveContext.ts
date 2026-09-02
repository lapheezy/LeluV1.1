/**
 * ==========================================================
 * LÉLU
 * COGNITIVE CONTEXT
 *
 * A live snapshot of the entire runtime state, assembled from
 * existing singletons (SelfModel, CapabilityManifest,
 * ProjectStore, AgentStore, AgentEventBus). This is NOT a
 * duplicate cognition system — it's the shared context that
 * routes the existing components through one connected pipeline.
 *
 * Built fresh on every request by AIRuntime, then injected
 * into RouterContext so every resolver, agent, and executive
 * operates from the same live state.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import SelfModel from "./SelfModel";
import type { SelfModelState } from "./SelfModel";
import ProjectStore from "../projects/ProjectStore";
import type { LeluProject } from "../projects/ProjectStore";
import AgentStore from "../agents/AgentStore";

import CapabilityManifest from "../capabilities/CapabilityManifest";
import AutonomyGate from "./AutonomyGate";
import UIStateStore, { type UIStateSnapshot } from "./UIStateStore";
import ExecutiveRuntime from "../executive/ExecutiveRuntime";
import EarthCore from "../earth/EarthCore";
import SelfStudyEngine, { type CognitiveStateView } from "./SelfStudyEngine";

export interface CognitiveContextSnapshot {
  /** Current self-model state. */
  self: SelfModelState;

  /** Active projects (non-archived). */
  projects: LeluProject[];

  /** Active agents (enabled, non-archived). */
  agents: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    projectId?: string;
  }>;

  /** Capability health from CapabilityManifest. */
  capabilities: Array<{
    name: string;
    status: "available" | "degraded" | "unavailable" | "not_configured";
  }>;

  /** Current autonomy level. */
  autonomyLevel: number;

  /** Current UI state (read live from UIStateStore singleton). */
  ui: UIStateSnapshot;

  /** Recent cognitive events (last N from AgentEventBus). */
  recentEvents: Array<{
    type: string;
    tool?: string;
    result?: string;
    timestamp: number;
  }>;

  /** Authoritative measured self-state from the Executive Runtime. */
  executiveSelfStateText: string;

  /** Canonical Earth Core spatial context (compact; null when dormant). */
  earthContext: string | null;

  /**
   * LÉLU's autonomous self-study state, READ as it already is.
   *
   * Building this context never starts a cycle and never calls a
   * provider — a chat request reports cognition, it does not cause it.
   */
  selfStudy: CognitiveStateView;

  /** Current persistent project checkpoints available to cognition. */
  checkpoints: Array<{
    projectId: string;
    projectName: string;
    status: string;
    summary: string;
    nextAction: string | null;
    pending: string[];
  }>;

  /** Timestamp of this snapshot. */
  builtAt: number;
}



/**
 * Build a fresh CognitiveContextSnapshot from live singleton state.
 * Called by AIRuntime on every process() invocation.
 */
export function buildCognitiveContext(): CognitiveContextSnapshot {
  const selfModel = SelfModel.getInstance();
  const projectStore = ProjectStore.getInstance();
  const agentStore = AgentStore.getInstance();
  const capabilityManifest = CapabilityManifest.getInstance();
  const autonomyGate = AutonomyGate.getInstance();
  const uiStateStore = UIStateStore.getInstance();

  const self = selfModel.get();

  // REAL recent execution events — the last actions actually emitted
  // by executing code (never model claims), for situational awareness.
  const recentEvents = AgentEventBus.getInstance()
    .recent(8)
    .map((event) => ({
      type: event.type,
      tool: "tool" in event ? event.tool : undefined,
      result: "result" in event && typeof event.result === "string" ? event.result : undefined,
      timestamp: Date.now(),
    }));

  const projects = projectStore
    .list()
    .filter((p) => p.status === "active" || p.status === "paused");
  const checkpoints = projects
    .filter((project) => project.checkpoint)
    .map((project) => ({
      projectId: project.id,
      projectName: project.name,
      status: project.checkpoint?.status ?? project.status,
      summary: project.checkpoint?.summary ?? "",
      nextAction: project.checkpoint?.nextAction ?? null,
      pending: project.checkpoint?.pending ?? [],
    }));

  const agents = agentStore
    .list()
    .filter((a) => a.enabled && a.status !== "archived")
    .map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      projectId: a.projectId ?? undefined,
    }));

  const capabilities = capabilityManifest.getAll().map((c) => ({
    name: c.name,
    status: c.status,
  }));

  return {
    self,
    projects,
    agents,
    capabilities,
    autonomyLevel: autonomyGate.getLevel(),
    ui: uiStateStore.get() as UIStateSnapshot,
    recentEvents,
    // Measured operational state — never assumed, never fabricated.
    executiveSelfStateText: ExecutiveRuntime.getInstance().getSelfStateText(),
    // Earth Core spatial context — canonical state from the one Earth runtime.
    earthContext: EarthCore.getInstance().buildSpatialContext(),
    // Autonomous self-study state, READ ONLY. getCognitiveState() runs no
    // cycle and mutates nothing, so assembling context for a chat request
    // can never be what produced the state it reports.
    selfStudy: SelfStudyEngine.getInstance().getCognitiveState(),
    checkpoints,
    builtAt: Date.now(),
  };
}

/**
 * Format the cognitive context into a compact text block for
 * injection into the AI model's system prompt. This is how
 * LÉLU's cognition actually "sees" her own runtime state.
 */
export function formatCognitiveContext(ctx: CognitiveContextSnapshot): string {
  const sections: string[] = [];

  // Measured executive self-state comes FIRST — it is authoritative
  // and overrides any assumption the model might otherwise make.
  if (ctx.executiveSelfStateText) sections.push(ctx.executiveSelfStateText);

  // Self state
  sections.push(`## LÉLU SELF STATE
Name: ${ctx.self.identity.name}
Capabilities: ${ctx.self.capabilities.join(", ")}
${ctx.self.projects.length > 0 ? `Projects: ${ctx.self.projects.join(", ")}` : ""}
${ctx.self.goals.length > 0 ? `Goals: ${ctx.self.goals.join(", ")}` : ""}
${ctx.self.knows.length > 0 ? `Knowledge: ${ctx.self.knows.slice(0, 5).join(", ")}` : ""}`);

  // Active projects
  if (ctx.projects.length > 0) {
    const projLines = ctx.projects
      .map((p) => `- ${p.name} (${p.status})${p.queries?.length ? ` — tracks: ${p.queries.join(", ")}` : ""}`)
      .join("\n");
    sections.push(`## ACTIVE PROJECTS\n${projLines}`);
  }

  // Durable project checkpoints — work state, not just transcript.
  if (ctx.checkpoints.length > 0) {
    sections.push(`## PROJECT CHECKPOINTS\n${ctx.checkpoints.map((checkpoint) => {
      const pending = checkpoint.pending.slice(0, 4).join("; ") || "none recorded";
      return `- ${checkpoint.projectName} [${checkpoint.status}]: ${checkpoint.summary || "No summary"}. Next: ${checkpoint.nextAction || "reassess"}. Pending: ${pending}`;
    }).join("\\n")}`);
  }

  // Active agents
  if (ctx.agents.length > 0) {
    const agentLines = ctx.agents
      .map((a) => `- ${a.name}: ${a.role} [${a.status}]`)
      .join("\n");
    sections.push(`## ACTIVE AGENTS\n${agentLines}`);
  }

  // Capability health
  const available = ctx.capabilities.filter((c) => c.status === "available");
  const degraded = ctx.capabilities.filter((c) => c.status === "degraded");
  const unavailable = ctx.capabilities.filter((c) => c.status === "unavailable");

  const capParts: string[] = [];
  if (available.length > 0) capParts.push(`Available: ${available.map((c) => c.name).join(", ")}`);
  if (degraded.length > 0) capParts.push(`Degraded: ${degraded.map((c) => c.name).join(", ")}`);
  if (unavailable.length > 0) capParts.push(`Unavailable: ${unavailable.map((c) => c.name).join(", ")}`);

  if (capParts.length > 0) {
    sections.push(`## CAPABILITY STATUS\n${capParts.join("\n")}`);
  }

  // UI state
  const uiParts: string[] = [];
  if (ctx.ui.activeTab) uiParts.push(`Active panel: ${ctx.ui.activeTab}`);
  if (ctx.ui.openPanels.length > 0) uiParts.push(`Open panels: ${ctx.ui.openPanels.join(", ")}`);
  if (ctx.ui.isChatOpen) uiParts.push("Chat: open");
  if (ctx.ui.cosmosExploring) uiParts.push("Cosmos: actively exploring");
  if (ctx.ui.avatarState !== "idle") uiParts.push(`Avatar: ${ctx.ui.avatarState}`);
  if (ctx.ui.isTyping) uiParts.push("User: typing");

  if (uiParts.length > 0) {
    sections.push(`## UI STATE\n${uiParts.join("\n")}`);
  }

  // Earth Core spatial context — LÉLU understands the globe she is showing.
  if (ctx.earthContext) sections.push(ctx.earthContext);

  // Recent real activity — what the runtime ACTUALLY did, newest last.
  if (ctx.recentEvents.length > 0) {
    const eventLines = ctx.recentEvents.map((e) => {
      const detail = [e.tool, e.result].filter(Boolean).join(": ");
      return `- ${e.type}${detail ? ` · ${detail}` : ""}`;
    });
    sections.push(`## RECENT EXECUTION EVENTS\n${eventLines.join("\n")}`);
  }

  // Autonomous self-study — the cognition that has been running on its
  // own. Injected so a provider answers about her actual state instead
  // of inventing one.
  sections.push(formatSelfStudyState(ctx.selfStudy));

  // Autonomy
  sections.push(`## AUTONOMY LEVEL: ${ctx.autonomyLevel}`);

  return sections.join("\n\n");
}

/**
 * Render the autonomous cognitive state as structured facts:
 * focus, active investigation, why it was selected, discoveries,
 * unresolved questions, current understanding, next intended step.
 *
 * Conclusions and observations only — no hidden reasoning trace.
 */
export function formatSelfStudyState(study: CognitiveStateView): string {
  const lines: string[] = ["## LÉLU AUTONOMOUS COGNITION (self-study, already running)"];

  if (study.source === "none") {
    lines.push(
      "No self-study cycle has completed yet in this session, and no durable trace was found.",
      `Loop scheduling itself: ${study.running ? "yes" : "no"}.`,
    );
    return lines.join("\n");
  }

  lines.push(
    `Loop scheduling itself: ${study.running ? "yes" : "no"} · cycles this session: ${study.cycle} · durable cycle: ${study.persistedCycle} · state read from: ${study.source}`,
  );
  if (study.lastCycleAt) {
    lines.push(`Last cycle finished: ${new Date(study.lastCycleAt).toISOString()}`);
  }

  if (study.focus) {
    lines.push(
      "",
      "### CURRENT FOCUS",
      `Question: ${study.focus.question}`,
      `Kind: ${study.focus.domain} · raised as: ${study.focus.origin}`,
      study.focus.target ? `Target: ${study.focus.target}` : "",
      `Why this one: ${study.focus.whySelected}`,
    );
  }

  if (study.investigation) {
    lines.push(
      "",
      "### ACTIVE INVESTIGATION",
      `Agent/tool: ${study.investigation.agent} / ${study.investigation.tool}`,
      `Evidence: ${study.investigation.evidenceCount} observation(s) from ${
        study.investigation.evidenceOrigin === "development-runtime"
          ? "REAL_DEVELOPMENT_RUNTIME"
          : study.investigation.evidenceOrigin === "static-snapshot"
            ? "STATIC_SNAPSHOT (build-time, may be behind the working tree)"
            : "internal runtime state"
      }`,
      `Evaluated by: ${
        study.investigation.provider
          ? `provider ${study.investigation.provider}`
          : "no provider was reachable — evidence evaluated deterministically, cognition continued"
      }`,
      `Outcome: ${study.investigation.learned ? "learned" : "nothing conclusive"}; long-term memory ${
        study.investigation.memoryConsolidated ? "written" : "not written"
      }`,
      study.investigation.conclusion ? `Conclusion: ${study.investigation.conclusion}` : "",
    );
  }

  if (study.discoveries.length > 0) {
    lines.push("", "### RECENT DISCOVERIES", ...study.discoveries.map((item) => `- ${item}`));
  }

  if (study.unresolved.length > 0) {
    lines.push("", "### UNRESOLVED", ...study.unresolved.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "### CURRENT UNDERSTANDING",
    `Knowledge: ${study.understanding.knowledgeEntries} entries, ${study.understanding.verified} verified/tested, ${study.understanding.openGaps} still untrusted.`,
    `Source access: ${study.understanding.sourceAccess === "development-runtime" ? "REAL_DEVELOPMENT_RUNTIME" : "STATIC_SNAPSHOT"} (runtime reachable: ${study.understanding.runtimeReachable}).`,
    study.understanding.agents.length > 0
      ? `Agents/tools in play: ${study.understanding.agents.join(", ")}.`
      : "No agent has run a cycle yet.",
    study.understanding.mission.length > 0
      ? `Mission I work from: ${study.understanding.mission.join(" | ")}`
      : "Mission: understand and improve this system.",
  );

  if (study.nextIntended) {
    lines.push(
      "",
      "### NEXT INTENDED INVESTIGATION",
      `Question: ${study.nextIntended.question}`,
      `Kind: ${study.nextIntended.domain} · raised as: ${study.nextIntended.origin}`,
      `Why next: ${study.nextIntended.whySelected}`,
    );
  }
  lines.push(`Questions carried in the buffer: ${study.carried}.`);

  return lines.filter((line) => line !== "").join("\n");
}
