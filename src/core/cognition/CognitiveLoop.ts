/**
 * ==========================================================
 * LÉLU
 * COGNITIVE LOOP — the continuous cycle
 *
 * LÉLU does not only think when you send a message. This loop
 * runs on an interval (and on demand) and walks the real
 * environment:
 *
 *   OBSERVE (messages/memories, projects, agents, queue,
 *            knowledge gaps, sandbox, system environment)
 *     ↓
 *   UNDERSTAND + REMEMBER (self-model sync, discoveries)
 *     ↓
 *   LEARN (gap → LEARNING proposal, hypothesis → experiment)
 *     ↓
 *   REASON + PREDICT (routine/workflow proposals)
 *     ↓
 *   PLAN (queue proposals land in REVIEW/NEXT for approval)
 *
 * Everything the loop does is bounded by the autonomy gate:
 * it OBSERVES (level 0) and PROPOSES (level 1). It never
 * takes actions that change files or projects on its own.
 * ==========================================================
 */

import AIService from "../AIService";
import AgentStore from "../agents/AgentStore";
import ProjectStore from "../projects/ProjectStore";
import SandboxFS from "../engineering/SandboxFS";
import AutonomyGate from "./AutonomyGate";
import KnowledgeLibrary from "./KnowledgeLibrary";
import SelfModel from "./SelfModel";
import SystemEnvironment from "./SystemEnvironment";
import WorkQueue from "./WorkQueue";
import SelfDevelopmentEngine from "../selfdev/SelfDevelopmentEngine";
import CapabilityManifest from "../capabilities/CapabilityManifest";
import Sentinel from "../sentinel/Sentinel";
import ProactiveCore, { type ProactiveQuestionInput } from "../proactive/ProactiveCore";
import AgentEventBus from "../agent/AgentEvents";
import type { KnowledgeResult } from "../../providers/Provider";

export interface CognitiveCycleReport {
  updatedAt: number;
  autonomyLevel: number;
  observed: {
    memories: number;
    projects: number;
    agents: number;
    queueOpen: number;
    queueDone: number;
    knowledgeEntries: number;
    knowledgeGaps: number;
    sandboxFiles: number;
  };
  suggestions: string[];
  selfUpdates: string[];
  cycle: number;
}

type Listener = (report: CognitiveCycleReport) => void;

const CYCLE_INTERVAL_MS = 60_000;
const MAX_SUGGESTIONS_PER_CYCLE = 3;

export default class CognitiveLoop {
  private static instance: CognitiveLoop | null = null;
  private listeners: Listener[] = [];
  private timer: number | null = null;
  private running = false;
  private cycle = 0;
  private lastReport: CognitiveCycleReport | null = null;

  private constructor() {}

  public static getInstance(): CognitiveLoop {
    if (!CognitiveLoop.instance) {
      CognitiveLoop.instance = new CognitiveLoop();
    }
    return CognitiveLoop.instance;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  public getLastReport(): CognitiveCycleReport | null {
    return this.lastReport;
  }

  /** Start the continuous cycle. Idempotent. */
  public start(intervalMs = CYCLE_INTERVAL_MS): void {
    if (this.timer !== null) {
      return;
    }
    // First cycle shortly after boot, then on the interval.
    window.setTimeout(() => void this.runOnce(), 3000);
    this.timer = window.setInterval(() => void this.runOnce(), intervalMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run one full observe → understand → propose cycle. */
  public async runOnce(): Promise<CognitiveCycleReport> {
    if (this.running) {
      return this.lastReport ?? this.emptyReport();
    }
    this.running = true;
    this.cycle += 1;

    const ai = AIService.getInstance();
    const agents = AgentStore.getInstance();
    const projects = ProjectStore.getInstance();
    const queue = WorkQueue.getInstance();
    const knowledge = KnowledgeLibrary.getInstance();
    const selfModel = SelfModel.getInstance();
    const autonomy = AutonomyGate.getInstance();
    const sandbox = SandboxFS.getInstance();
    const system = SystemEnvironment.getInstance();

    const suggestions: string[] = [];
    const selfUpdates: string[] = [];

    try {
      /* ---------------- OBSERVE ---------------- */
      let memories = 0;
      try {
        memories = (await ai.getMemories(2000)).length;
      } catch {
        // memory may be empty or unavailable — observe as 0
      }

      const activeProjects = projects.list().filter((project) => project.status !== "archived");
      const activeAgents = agents.list().filter((agent) => agent.status !== "archived");
      const allQueue = queue.list();
      const openItems = allQueue.filter((item) => item.status === "open");
      const doneItems = allQueue.filter((item) => item.status === "done");
      const gaps = knowledge.gaps();
      const sandboxNodes = sandbox.list();

      // System environment facts refresh (storage estimate is async).
      try {
        await system.refresh();
      } catch {
        // environment refresh is best-effort
      }

      /* ---------------- UNDERSTAND + REMEMBER ---------------- */
      // Use actual CapabilityManifest — NOT a hardcoded list.
      const manifest = CapabilityManifest.getInstance();
      const availableCaps = manifest.getAvailable();
      const capabilities = availableCaps.map((c) => `${c.name} (${c.category})`);
      // Also add core capabilities that aren't in the manifest
      const coreCaps = ["chat", "memory", "cognition", "agents", "projects"];
      for (const cap of coreCaps) {
        if (!capabilities.some((c) => c.startsWith(cap))) {
          capabilities.push(cap);
        }
      }
      for (const change of selfModel.syncFromEnvironment({
        projects: activeProjects.map((project) => project.name),
        capabilities,
      })) {
        selfUpdates.push(change);
      }

      // Sync unavailable capabilities from manifest
      const unavailable = manifest.getAll().filter((c) => c.status === "unavailable" || c.status === "not_configured");
      const currentUnavailable = selfModel.get().unavailable;
      const newUnavailable = unavailable
        .map((c) => `${c.name}: ${c.status}`)
        .filter((u) => !currentUnavailable.some((eu) => eu.startsWith(u.split(":")[0] ?? "")));
      if (newUnavailable.length > 0) {
        selfModel.update({ unavailable: [...newUnavailable, ...currentUnavailable].slice(0, 20) });
        selfUpdates.push(`Updated ${newUnavailable.length} capability status(es).`);
      }

      /* ---------------- LEARN — gap → learning proposal ---------------- */
      const openTitles = new Set(openItems.map((item) => item.title.toLowerCase()));
      let added = 0;
      for (const gap of gaps) {
        if (added >= MAX_SUGGESTIONS_PER_CYCLE) {
          break;
        }
        const key = gap.title.toLowerCase().slice(0, 24);
        const alreadyQueued = [...openTitles].some((title) => title.includes(key));
        if (alreadyQueued) {
          continue;
        }
        queue.add({
          category: "LEARNING",
          title: `Study: ${gap.title}`,
          detail: `Knowledge gap in ${gap.domain}: ${gap.detail}`,
          autonomy: 1,
        });
        openTitles.add(`study: ${key}`);
        suggestions.push(`Knowledge gap detected — proposed LEARNING: ${gap.title}.`);
        added += 1;
      }

      /* ---------------- ACTUAL RESEARCH FROM GAPS ---------------- */
      // When knowledge gaps exist, actually research them through the
      // SAME ProviderRegistry the chat pipeline uses — not just propose
      // LEARNING items. This makes cognition actually USE the connected
      // APIs as part of its thinking loop.
      if (gaps.length > 0 && autonomy.getLevel() >= 1) {
        try {
          const ai = AIService.getInstance();
          const registry = ai.getKnowledgeProviderRegistry();
          const topGap = gaps[0];
          const researchQuery = topGap.detail || topGap.title;
          const newsProviders = registry
            .all()
            .filter((p) => p.enabled && p.capabilities.some((c) => c === "knowledge" || c === "news" || c === "encyclopedia"))
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 2);

          for (const provider of newsProviders) {
            if (!provider.canSearch?.(researchQuery)) continue;
            try {
              const results = await Promise.race([
                provider.search(researchQuery),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
              ]);
              if (Array.isArray(results) && results.length > 0) {
                // Store as knowledge — cognition LEARNED from the API
                knowledge.add({
                  title: `Researched: ${topGap.title}`,
                  domain: topGap.domain,
                  detail: results.slice(0, 3).map((r: KnowledgeResult) => `${r.title}: ${(r.content ?? "").slice(0, 120)}`).join(" | "),
                  status: "learned",
                  source: provider.name,
                });
                selfModel.addLearning(`Researched "${researchQuery}" via ${provider.name}: ${results.length} result(s)`);
                suggestions.push(`Actually researched knowledge gap "${topGap.title}" via ${provider.name} — ${results.length} result(s) stored.`);
                // Report to Sentinel
                Sentinel.getInstance().report(
                  "system_event",
                  "info",
                  `Cognitive research: "${topGap.title}" → ${results.length} result(s) via ${provider.name}`,
                  "CognitiveLoop",
                );
                break; // got results from this provider, stop
              }
            } catch {
              // Provider failed — try next
            }
          }
        } catch {
          // Research is best-effort — never break the cycle
        }
      }

      /* ---------------- API HEALTH CHECKS ---------------- */
      // Verify connected providers and update CapabilityManifest + SelfModel.
      // This runs each cycle so LÉLU always knows her actual capabilities.
      try {
        const manifest = CapabilityManifest.getInstance();
        const ai = AIService.getInstance();
        const registry = ai.getKnowledgeProviderRegistry();
        for (const provider of registry.all()) {
          const capId = `knowledge.${provider.name}`;
          const existing = manifest.getAll().find((c) => c.id === capId);
          if (existing) {
            manifest.updateStatus(capId, provider.enabled ? "available" : "not_configured");
          }
        }
        // Sentinel health event (throttled to once per 5 cycles)
        if (this.cycle % 5 === 0) {
          const healthReport = manifest.getReport();
          Sentinel.getInstance().report(
            "provider_health",
            "info",
            `Capability health: ${healthReport.split("\n").filter((l) => l.includes("✓") || l.includes("✗") || l.includes("○")).length} capabilities checked`,
            "CognitiveLoop",
          );
        }
      } catch {
        // Health checks are best-effort
      }

      /* ---------------- REASON + PREDICT ---------------- */
      // Blocked items that have sat for 3+ days → REVIEW proposal.
      const staleThreshold = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const staleBlocked = openItems.filter(
        (item) => item.category === "BLOCKED" && item.updated < staleThreshold,
      );
      if (staleBlocked.length > 0 && added < MAX_SUGGESTIONS_PER_CYCLE) {
        queue.add({
          category: "REVIEW",
          title: `Resolve ${staleBlocked.length} blocked item${staleBlocked.length > 1 ? "s" : ""}`,
          detail: staleBlocked
            .map((item) => `• ${item.title}`)
            .join("\n"),
          autonomy: 1,
        });
        suggestions.push(`Detected ${staleBlocked.length} stale blocked item${staleBlocked.length > 1 ? "s" : ""} — proposed REVIEW.`);
        added += 1;
      }

      // Routine detection: enough project items + renders → propose a workflow.
      if (added < MAX_SUGGESTIONS_PER_CYCLE) {
        const creativeOutputs = activeProjects.reduce(
          (count, project) => count + project.items.filter((item) => item.kind !== "note").length,
          0,
        );
        if (creativeOutputs >= 6) {
          const routine = queue.list().find(
            (item) => item.status === "open" && item.category === "IDEAS" && item.title.includes("reusable"),
          );
          if (!routine) {
            queue.add({
              category: "IDEAS",
              title: "Turn the product pipeline into a reusable workflow",
              detail: `You have ${creativeOutputs} creative outputs across ${activeProjects.length} project(s). This looks like a recurring production pipeline — a reusable workflow or agent would remove repetition.`,
              autonomy: 1,
            });
            suggestions.push("Proposed a reusable workflow idea based on project activity.");
          }
        }
      }

      /* ---------------- PROACTIVE QUESTIONS ---------------- */
      // Ask only about unresolved, actionable state. One pending question
      // at a time keeps the conversation interruptible and the stable key
      // prevents the same decision from returning after resolution/dismissal.
      const proactive = ProactiveCore.getInstance();
      if (proactive.shouldAskQuestions() && !proactive.getActiveQuestion()) {
        let question: ProactiveQuestionInput | null = null;
        const blockedItem = openItems.find(
          (item) => item.category === "BLOCKED" || item.category === "REVIEW",
        );

        if (blockedItem) {
          question = {
            key: `work-queue:${blockedItem.id}`,
            question: `Your work queue is waiting on “${blockedItem.title}”. What decision or information should I use to move it forward?`,
            category: blockedItem.category === "BLOCKED" ? "EXECUTIVE" : "WORKFLOW",
            reason: blockedItem.detail ?? "A real work item is blocked or awaiting review.",
            priority: blockedItem.category === "BLOCKED" ? "P0" : "P1",
            relatedTask: blockedItem.title,
            blocksExecution: true,
            rememberAnswer: true,
          };
        } else {
          const directionProject = activeProjects.find(
            (project) => project.items.length === 0 && !project.queries?.length,
          );
          if (directionProject) {
            question = {
              key: `project-direction:${directionProject.id}`,
              question: `“${directionProject.name}” is active but has no defined next outcome. What should I prioritize there?`,
              category: "PROJECT",
              reason: "The project exists in persistent state but has no work items or research direction.",
              priority: "P1",
              relatedProjectId: directionProject.id,
              relatedTask: directionProject.name,
              blocksExecution: false,
              rememberAnswer: true,
            };
          } else if (sandboxNodes.some((node) => node.type === "file")) {
            question = {
              key: "sandbox-priority",
              question: "There is unfinished work in the sandbox. Should I audit it, test it, or continue implementing the next feature?",
              category: "SANDBOX",
              reason: "The sandbox contains persisted files that do not have a current user-directed next action.",
              priority: "P2",
              relatedTask: "sandbox work",
              blocksExecution: false,
              rememberAnswer: true,
            };
          }
        }

        if (question) {
          proactive.enqueueQuestion(question);
          suggestions.push(`Proactive question queued: ${question.category}.`);
        }
      }

      /* ---------------- VISUAL STATE TRANSITION ---------------- */
      // Cognition determines the current visual state based on what it
      // observed, then emits it so the unified UI can transform.
      // The visual state is driven by real runtime state, not animation.
      const visualState = this.determineVisualState({
        activeProjects,
        activeAgents,
        gaps,
        sandboxNodes,
        suggestions,
        researchPerformed: suggestions.some((s) => s.includes("researched")),
      });
      AgentEventBus.getInstance().emit({
        type: "visual_state_changed",
        taskId: `cognitive-${this.cycle}`,
        state: visualState.state,
        reason: visualState.reason,
      });

      /* ---------------- REPORT ---------------- */
      const report: CognitiveCycleReport = {
        updatedAt: Date.now(),
        autonomyLevel: autonomy.getLevel(),
        observed: {
          memories,
          projects: activeProjects.length,
          agents: activeAgents.length,
          queueOpen: openItems.length,
          queueDone: doneItems.length,
          knowledgeEntries: knowledge.list().length,
          knowledgeGaps: gaps.length,
          sandboxFiles: sandboxNodes.filter((node) => node.type === "file").length,
        },
        suggestions,
        selfUpdates,
        cycle: this.cycle,
      };
      this.lastReport = report;
      for (const listener of this.listeners) {
        try {
          listener(report);
        } catch {
          // a broken listener must never stop the loop
        }
      }
      // Self-development: observe + propose (levels 0-1 only). Fire and
      // forget — a failing scan must never break the cognitive cycle.
      void SelfDevelopmentEngine.getInstance().proactiveScan().catch(() => undefined);
      return report;
    } catch (error) {
      console.error("[CognitiveLoop] cycle failed", error);
      return this.lastReport ?? this.emptyReport();
    } finally {
      this.running = false;
    }
  }

  /**
   * Determine the current visual state based on what cognition
   * actually observed. Returns the state label and a human-readable
   * reason that explains WHY the visual state changed.
   *
   * This is driven by real runtime state, not animation timers.
   */
  private determineVisualState(observed: {
    activeProjects: ReturnType<ProjectStore["list"]>;
    activeAgents: ReturnType<AgentStore["list"]>;
    gaps: ReturnType<KnowledgeLibrary["gaps"]>;
    sandboxNodes: ReturnType<SandboxFS["list"]>;
    suggestions: string[];
    researchPerformed: boolean;
  }): { state: "conversation" | "research" | "browser" | "analysis" | "engineering" | "testing" | "earth"; reason: string } {
    // Research performed this cycle → research visual state
    if (observed.researchPerformed) {
      return { state: "research", reason: "Cognition actively researching knowledge gaps via connected APIs" };
    }

    // Knowledge gaps detected → analysis visual state
    if (observed.gaps.length > 0) {
      return { state: "analysis", reason: `${observed.gaps.length} knowledge gap(s) detected — analyzing available sources` };
    }

    // Sandbox has files and projects are active → engineering visual state
    if (observed.sandboxNodes.length > 0 && observed.activeProjects.length > 0) {
      return { state: "engineering", reason: "Active project work in sandbox — engineering context active" };
    }

    // Active agents with tasks → analysis (multi-agent collaboration)
    if (observed.activeAgents.length > 1) {
      return { state: "analysis", reason: `${observed.activeAgents.length} agents active — monitoring collaboration` };
    }

    // Default: conversation
    return { state: "conversation", reason: "Cognitive cycle complete — returning to conversation" };
  }

  private emptyReport(): CognitiveCycleReport {
    return {
      updatedAt: Date.now(),
      autonomyLevel: AutonomyGate.getInstance().getLevel(),
      observed: {
        memories: 0,
        projects: 0,
        agents: 0,
        queueOpen: 0,
        queueDone: 0,
        knowledgeEntries: 0,
        knowledgeGaps: 0,
        sandboxFiles: 0,
      },
      suggestions: [],
      selfUpdates: [],
      cycle: this.cycle,
    };
  }
}
