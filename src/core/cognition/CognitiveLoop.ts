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
      const capabilities = [
        "chat",
        "memory",
        "cognition",
        "agents",
        "projects",
        "sketch",
        "render (local engine)",
        "video projects",
        "avatar identity",
        "engineering sandbox",
      ];
      for (const change of selfModel.syncFromEnvironment({
        projects: activeProjects.map((project) => project.name),
        capabilities,
      })) {
        selfUpdates.push(change);
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
