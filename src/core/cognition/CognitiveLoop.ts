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
import { withDeadline } from "./SelfStudyEngine";
import CapabilityManifest from "../capabilities/CapabilityManifest";
import Sentinel from "../sentinel/Sentinel";
import ProactiveCore, { type ProactiveQuestionInput } from "../proactive/ProactiveCore";
import AgentEventBus from "../agent/AgentEvents";
import SelfStudyEngine from "./SelfStudyEngine";

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
  /**
   * The continuous self-study process. `carried` is the size of the
   * WORK BUFFER — it reaching zero is a refill trigger, never the end
   * of cognition, so this is reported separately from the loop's own
   * observation counts.
   */
  selfStudy: {
    running: boolean;
    cycle: number;
    question: string | null;
    agent: string | null;
    tool: string | null;
    /** development-runtime | static-snapshot | none */
    evidenceOrigin: string | null;
    provider: string | null;
    derived: number;
    carried: number;
  };
}

type Listener = (report: CognitiveCycleReport) => void;

const CYCLE_INTERVAL_MS = 60_000;
/** Coalesce a burst of project writes into one cycle. */
const NUDGE_DEBOUNCE_MS = 2_000;
/** Floor between cycles, so a nudge can never become a spin. */
const MIN_CYCLE_GAP_MS = 15_000;
const MAX_SUGGESTIONS_PER_CYCLE = 3;

export default class CognitiveLoop {
  private static instance: CognitiveLoop | null = null;
  private listeners: Listener[] = [];
  private timer: number | null = null;
  private bootTimer: number | null = null;
  private nudgeTimer: number | null = null;
  private unsubscribeProjects: (() => void) | null = null;
  private running = false;
  private cycle = 0;
  private lastCycleAt = 0;
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
    // First cycle shortly after boot, then on the interval. The boot
    // timeout is TRACKED: an untracked one survives stop(), so a loop
    // the interface has torn down still runs a cycle three seconds
    // later — and StrictMode's mount/unmount/mount leaves an orphan.
    this.bootTimer = window.setTimeout(() => {
      this.bootTimer = null;
      void this.runOnce();
    }, 3000);
    this.timer = window.setInterval(() => void this.runOnce(), intervalMs);

    // Observe state changes, not just the clock.
    //
    // The loop was purely timer-driven, so a project created by the user
    // — or by Orchestrator.persistCheckpoint() mid-conversation — sat
    // unobserved for up to a full CYCLE_INTERVAL_MS. Cognition looked
    // broken because it was late: the derivation below runs correctly,
    // but only on the next tick, which is why a project seeded just
    // after a cycle produced nothing for the following minute.
    // ProjectStore already publishes changes; subscribe to what exists.
    this.unsubscribeProjects = ProjectStore.getInstance().subscribe(() => this.nudge());
  }

  public stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.bootTimer !== null) {
      window.clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.nudgeTimer !== null) {
      window.clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    this.unsubscribeProjects?.();
    this.unsubscribeProjects = null;
  }

  /**
   * Bring the next cycle forward because observable state changed.
   *
   * Rate-limited rather than immediate: a cycle itself can touch project
   * state, so an unguarded nudge is a feedback loop. At most one is
   * pending, and none runs within MIN_CYCLE_GAP_MS of the last cycle —
   * a change during that window waits out the remainder instead of
   * being dropped.
   */
  private nudge(): void {
    if (this.timer === null || this.nudgeTimer !== null) {
      return;
    }
    const since = Date.now() - this.lastCycleAt;
    const delay = Math.max(NUDGE_DEBOUNCE_MS, MIN_CYCLE_GAP_MS - since);
    this.nudgeTimer = window.setTimeout(() => {
      this.nudgeTimer = null;
      void this.runOnce();
    }, delay);
  }

  /** Run one full observe → understand → propose cycle. */
  public async runOnce(): Promise<CognitiveCycleReport> {
    // USER COMMUNICATION HAS PRIORITY. This loop proposes work and can
    // queue a proactive question; doing that while the user is mid-turn
    // is exactly how an autonomous update lands on top of a reply.
    // Observation resumes on the next tick.
    if (AIService.getInstance().isUserTurnActive()) {
      return this.lastReport ?? this.emptyReport();
    }
    if (this.running) {
      return this.lastReport ?? this.emptyReport();
    }
    this.running = true;
    this.cycle += 1;
    this.lastCycleAt = Date.now();

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
      // Every await in this cycle is deadline-bounded.
      //
      // `this.running` is cleared in a `finally`, which handles a THROW
      // but not a HANG: a promise that never settles never reaches the
      // finally, so the flag latches true and every later tick returns
      // early. The loop then dies silently — no error, no cycle, and
      // nothing downstream of the hang ever runs again. SelfStudyEngine
      // already guards its steps this way; this loop did not.
      let memories = 0;
      try {
        memories = (await withDeadline(ai.getMemories(2000), [])).length;
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
        await withDeadline(system.refresh(), undefined);
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

      /* ---------------- SELF-STUDY (continuous cognition) ---------------- */
      // Investigating a gap is NOT this loop's job any more. It used to
      // fire a single knowledge-provider search at gaps[0] every cycle
      // and never update that gap's status, so the same top gap was
      // re-researched forever while the queue itself just drained.
      //
      // SelfStudyEngine owns that work now: it selects or GENERATES the
      // objective, routes it to the agent/tool that can actually answer
      // it, evaluates the evidence through the full provider chain,
      // consolidates the learning into memory, and derives the next
      // question. This loop only reports what that process is doing.
      //
      // Studying is thinking, so it is not gated by the autonomy level —
      // the gate constrains ACTIONS (workspace commands, file writes,
      // applying candidates), which live elsewhere.
      const study = SelfStudyEngine.getInstance();
      const studyReport = study.getLastReport();
      if (studyReport?.objective) {
        suggestions.push(
          `Self-study cycle ${studyReport.cycle}: “${studyReport.objective.question}” via ${studyReport.agent}/${studyReport.tool} (${studyReport.evidenceOrigin}) — ${studyReport.derived.length} new question(s) generated.`,
        );
        Sentinel.getInstance().report(
          "system_event",
          "info",
          `Self-study cycle ${studyReport.cycle} — ${studyReport.objective.question} → ${studyReport.derived.length} derived question(s), ${studyReport.bufferRemaining} carried.`,
          "SelfStudyEngine",
        );
      }
      if (!study.isRunning()) {
        // Cognition must not depend on anything having started it from
        // the UI. If the continuous loop is not running, start it.
        study.start();
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

      /* ------------- DERIVE THE NEXT OBJECTIVE FIRST ------------- */
      // A project that already states what it is for does not need the
      // user to restate it. Where the project carries real intent — the
      // user's original request, a stated objective, or research queries
      // — cognition derives the next objective from THAT and queues it
      // through the existing WorkQueue, instead of interrupting to ask
      // "what should I prioritize there?". Asking is only correct when
      // there is genuinely nothing to derive from.
      for (const project of activeProjects) {
        const intent =
          project.objective?.trim() ||
          project.originalRequest?.trim() ||
          (project.queries?.length ? `Research: ${project.queries.join(", ")}` : "");

        // No stated intent, or work already queued for it — nothing to do.
        if (!intent) continue;
        if (project.items.length > 0) continue;
        const alreadyQueued = openItems.some(
          (item) => item.detail?.includes(`project:${project.id}`),
        );
        if (alreadyQueued) continue;

        const nextObjective =
          project.checkpoint?.nextAction?.trim() ||
          `Advance “${project.name}”: ${intent.slice(0, 160)}`;

        queue.add({
          category: "NEXT",
          title: nextObjective,
          // The project id is recorded so the same objective is not
          // queued again on the next tick, and so anything acting on the
          // item can trace it back to the state it came from.
          detail:
            `Derived from persistent project state (project:${project.id}). ` +
            `The project states its intent but has no open work item.`,
          autonomy: 2,
        });

        suggestions.push(`Derived a next objective for “${project.name}” from its own stated intent.`);
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
          // Never ask the user to give direction to a project LÉLU
          // invented for her own bookkeeping.
          //
          // Orchestrator.persistCheckpoint() auto-creates a category
          // project ("General", "Engineering") on ordinary chat turns and
          // checkpoints it with pending:[] / nextAction:null hardcoded —
          // so an auto-created project is STRUCTURALLY guaranteed to have
          // zero items, which structurally guarantees this question. The
          // user then sees "Engineering is active but has no defined next
          // outcome" about a project they never created, generated one
          // turn after LÉLU created it empty. A project the USER made and
          // left empty is worth asking about; this is not.
          const directionProject = activeProjects.find(
            (project) =>
              project.items.length === 0 &&
              !project.queries?.length &&
              !(project.description ?? "").startsWith("Auto-created for") &&
              // ...and nothing to derive an objective from. If the project
              // states an objective or carries the user's original
              // request, the loop above already turned that into queued
              // work, so asking would be asking for what she was given.
              !project.objective?.trim() &&
              !project.originalRequest?.trim(),
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
        selfStudy: this.selfStudySnapshot(),
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
      selfStudy: this.selfStudySnapshot(),
    };
  }

  /** Read-only view of the continuous self-study process. */
  private selfStudySnapshot(): CognitiveCycleReport["selfStudy"] {
    const study = SelfStudyEngine.getInstance();
    const report = study.getLastReport();
    return {
      running: study.isRunning(),
      cycle: study.getCycle(),
      question: report?.objective?.question ?? null,
      agent: report?.agent ?? null,
      tool: report?.tool ?? null,
      evidenceOrigin: report?.evidenceOrigin ?? null,
      provider: report?.provider ?? null,
      derived: report?.derived.length ?? 0,
      carried: report?.bufferRemaining ?? 0,
    };
  }
}
