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
import Sentinel from "../sentinel/Sentinel";
import ImprovementQueue from "../selfdev/ImprovementQueue";

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

  /** Current persistent project checkpoints available to cognition. */
  checkpoints: Array<{
    projectId: string;
    projectName: string;
    status: string;
    summary: string;
    nextAction: string | null;
    pending: string[];
  }>;

  /**
   * Recent unacknowledged runtime errors/warnings from Sentinel — real
   * uncaught exceptions, rejected promises, and subsystem-reported
   * failures. Universal (every request), not only when an
   * "engineering" intent happens to be detected — so cognition already
   * knows what's currently broken without being told.
   */
  recentErrors: Array<{
    type: string;
    severity: string;
    message: string;
    source: string;
    timestamp: number;
  }>;

  /**
   * Open self-development proposals (the real ImprovementQueue, not a
   * count nobody explains) — her own pending engineering work, visible
   * to every request the same way an open project or active agent is.
   */
  pendingImprovements: Array<{
    id: string;
    title: string;
    kind: string;
    status: string;
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

  const recentErrors = Sentinel.getInstance()
    .getUnacknowledged()
    .filter((event) => event.severity === "error" || event.severity === "critical")
    .slice(0, 5)
    .map((event) => ({
      type: event.type,
      severity: event.severity,
      message: event.message,
      source: event.source,
      timestamp: event.timestamp,
    }));

  const pendingImprovements = ImprovementQueue.getInstance()
    .open()
    .slice(0, 5)
    .map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      kind: proposal.kind,
      status: proposal.status,
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
    checkpoints,
    recentErrors,
    pendingImprovements,
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

  // Real, unacknowledged runtime errors — never require the user to
  // report a problem cognition could already see.
  if (ctx.recentErrors.length > 0) {
    const errorLines = ctx.recentErrors.map(
      (e) => `- [${e.source}] ${e.message}`,
    );
    sections.push(`## RECENT RUNTIME ERRORS (unacknowledged)\n${errorLines.join("\n")}`);
  }

  // Her own pending engineering work — visible without being told.
  if (ctx.pendingImprovements.length > 0) {
    const improvementLines = ctx.pendingImprovements.map(
      (p) => `- [${p.status}] ${p.title} (${p.kind})`,
    );
    sections.push(`## PENDING SELF-IMPROVEMENTS\n${improvementLines.join("\n")}`);
  }

  // Recent real activity — what the runtime ACTUALLY did, newest last.
  if (ctx.recentEvents.length > 0) {
    const eventLines = ctx.recentEvents.map((e) => {
      const detail = [e.tool, e.result].filter(Boolean).join(": ");
      return `- ${e.type}${detail ? ` · ${detail}` : ""}`;
    });
    sections.push(`## RECENT EXECUTION EVENTS\n${eventLines.join("\n")}`);
  }

  // Autonomy
  sections.push(`## AUTONOMY LEVEL: ${ctx.autonomyLevel}`);

  return sections.join("\n\n");
}
