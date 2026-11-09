/**
 * ==========================================================
 * LÉLU — DAILY REFLECTION
 *
 * Once a day (and on request), LÉLU looks back at what she
 * actually did and lets it change her:
 *
 *   EVIDENCE   task evaluations (TaskEvaluator), tool failures
 *              (ToolStats), and the Brain's own reflection over
 *              long-term memory (ReflectionEngine)
 *   JUDGE      completion rate, tools that failed repeatedly,
 *              capabilities that were missing
 *   REMEMBER   a dated reflection written to long-term memory
 *   DEVELOP    the SelfModel's evidence fields — learning,
 *              limitations, improvements, unavailable — through
 *              its controlled interface (identity is untouched;
 *              PersonalityGuard keeps those changes traceable)
 *   PROPOSE    an ImprovementQueue proposal per recurring failure
 *              or capability gap, status "Proposed"
 *
 * The proposal is where self-improvement stops being automatic.
 * SelfDevelopmentLoop only develops an APPROVED proposal, and
 * only in the sandbox (snapshot → edit → syntax → tests →
 * candidate). Applying a candidate to production is a separate,
 * L5-gated step that is never auto-invoked. Reflection never
 * approves anything.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { emitCognition } from "../agent/AgentEvents";
import ToolStats from "./ToolStats";
import TaskEvaluator, { type CapabilityGap } from "./TaskEvaluator";

export interface ReflectionResult {
  at: number;
  trigger: "scheduled" | "on-request";
  windowStart: number;
  tasks: { total: number; completed: number; failed: number; cancelled: number };
  recurringFailures: Array<{ tool: string; count: number; lastError: string }>;
  gaps: Array<{ capability: string; kind: CapabilityGap["kind"]; count: number }>;
  proposalsCreated: string[];
  selfModelUpdates: string[];
  memoryThemes: string[];
  storedInMemory: boolean;
  summary: string;
}

const LAST_RUN_KEY = "lelu.reflection.last.v1";
const HISTORY_KEY = "lelu.reflection.history.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** A tool is a problem once it fails this often in one window. */
const RECURRING_FAILURES = 2;

export default class DailyReflection {
  private static instance: DailyReflection | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<ReflectionResult> | null = null;

  public static getInstance(): DailyReflection {
    if (!DailyReflection.instance) DailyReflection.instance = new DailyReflection();
    return DailyReflection.instance;
  }

  /** Check hourly; reflect when a day has passed since the last reflection. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runIfDue(), CHECK_EVERY_MS);
    // Never keep a server or test process alive just for this.
    (this.timer as { unref?: () => void }).unref?.();
    void this.runIfDue();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public lastRunAt(): number {
    return KvStore.getInstance().get<number>(LAST_RUN_KEY) ?? 0;
  }

  public async runIfDue(now = Date.now()): Promise<ReflectionResult | null> {
    if (now - this.lastRunAt() < DAY_MS) return null;
    return this.run("scheduled");
  }

  public history(): ReflectionResult[] {
    return KvStore.getInstance().get<ReflectionResult[]>(HISTORY_KEY) ?? [];
  }

  /** Reflect now. Concurrent calls share one run. */
  public run(trigger: ReflectionResult["trigger"]): Promise<ReflectionResult> {
    if (!this.running) {
      this.running = this.reflect(trigger).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async reflect(trigger: ReflectionResult["trigger"]): Promise<ReflectionResult> {
    const now = Date.now();
    const last = this.lastRunAt();
    const windowStart = last > 0 ? last : now - DAY_MS;

    // ---- evidence ----
    const evaluations = TaskEvaluator.getInstance().since(windowStart);
    const tasks = {
      total: evaluations.length,
      completed: evaluations.filter((e) => e.status === "completed").length,
      failed: evaluations.filter((e) => e.status === "failed").length,
      cancelled: evaluations.filter((e) => e.status === "cancelled").length,
    };

    const recurringFailures = ToolStats.getInstance()
      .failuresSince(windowStart)
      .filter((entry) => entry.errors.length >= RECURRING_FAILURES)
      .map((entry) => ({ tool: entry.tool, count: entry.errors.length, lastError: entry.errors[0] }));

    const gapCounts = new Map<string, { capability: string; kind: CapabilityGap["kind"]; count: number }>();
    for (const gap of evaluations.flatMap((e) => e.gaps)) {
      const key = `${gap.kind}:${gap.capability}`;
      const entry = gapCounts.get(key) ?? { capability: gap.capability, kind: gap.kind, count: 0 };
      entry.count += 1;
      gapCounts.set(key, entry);
    }
    const gaps = [...gapCounts.values()];

    let memoryThemes: string[] = [];
    try {
      const { default: AIService } = await import("../AIService");
      const memory = await AIService.getInstance().reflectOnMemory();
      memoryThemes = memory ? [...memory.activeThemes, ...memory.insights].slice(0, 6) : [];
    } catch {
      memoryThemes = [];
    }

    // ---- propose (never approve) ----
    const proposalsCreated: string[] = [];
    try {
      const { default: ImprovementQueue } = await import("../selfdev/ImprovementQueue");
      const queue = ImprovementQueue.getInstance();
      for (const failure of recurringFailures) {
        const title = `Repair ${failure.tool}: failed ${failure.count}× recently`;
        if (queue.hasOpenSimilar(title)) continue;
        const proposal = queue.add({
          title,
          problem: `${failure.tool} failed ${failure.count} times since ${new Date(windowStart).toISOString()}.`,
          observation: `Most recent error: ${failure.lastError}`,
          evidence: `ToolStats recorded ${failure.count} failures in this window.`,
          proposedSolution: `Diagnose ${failure.tool}'s failure in the sandbox and fix the cause, or make it report unavailability before it is offered.`,
          expectedBenefit: "Tasks that depend on this tool stop failing.",
          dependencies: [],
          risk: "Low while confined to the sandbox; production apply needs explicit approval.",
          requiredTools: [failure.tool],
          requiredAgents: [],
          complexity: "medium",
          kind: "Bug",
          capabilityId: failure.tool,
          version: "",
          testPlan: `Reproduce the failure, fix, and run ${failure.tool} successfully in the sandbox.`,
          status: "Proposed",
        });
        proposalsCreated.push(proposal.id);
      }
      for (const gap of gaps) {
        const title = `Add capability ${gap.capability}`;
        if (queue.hasOpenSimilar(title)) continue;
        const proposal = queue.add({
          title,
          problem: `Tasks needed "${gap.capability}" (${gap.kind.replace("-", " ")}) ${gap.count}× and could not continue.`,
          observation: evaluations.flatMap((e) => e.gaps).find((g) => g.capability === gap.capability)?.evidence ?? "",
          evidence: `TaskEvaluator recorded ${gap.count} task failure(s) caused by this gap.`,
          proposedSolution:
            gap.kind === "missing-agent"
              ? `Create or enable an agent named "${gap.capability}".`
              : `Implement "${gap.capability}" as a tool (registerExecutor) or make its dependency available.`,
          expectedBenefit: "Plans that need this capability become executable.",
          dependencies: [],
          risk: "New capability; developed and tested in the sandbox first.",
          requiredTools: [],
          requiredAgents: [],
          complexity: "medium",
          kind: "New Capability",
          capabilityId: gap.capability,
          version: "",
          testPlan: `Run a task that needs "${gap.capability}" end to end in the sandbox.`,
          status: "Proposed",
        });
        proposalsCreated.push(proposal.id);
      }
    } catch (error) {
      console.warn("[DailyReflection] could not record proposals (contained):", error);
    }

    // ---- develop the self-model from evidence ----
    const selfModelUpdates: string[] = [];
    try {
      const { default: SelfModel } = await import("../cognition/SelfModel");
      const self = SelfModel.getInstance();
      if (tasks.total > 0) {
        const line = `Completed ${tasks.completed} of ${tasks.total} multi-step tasks (${new Date(now).toISOString().slice(0, 10)})`;
        self.addLearning(line);
        selfModelUpdates.push(`learning: ${line}`);
      }
      for (const failure of recurringFailures) {
        const line = `${failure.tool} has been failing (${failure.count}× recently)`;
        self.addImprovement(line);
        selfModelUpdates.push(`improvement: ${line}`);
      }
      const unavailable = gaps.filter((g) => g.kind !== "missing-agent").map((g) => g.capability);
      if (unavailable.length) {
        const state = self.get();
        const merged = [...new Set([...state.unavailable, ...unavailable])];
        if (merged.length !== state.unavailable.length) {
          self.update({ unavailable: merged });
          selfModelUpdates.push(`unavailable: ${unavailable.join(", ")}`);
        }
      }
    } catch (error) {
      console.warn("[DailyReflection] self-model update failed (contained):", error);
    }

    // ---- remember ----
    const summary = this.summarise(trigger, tasks, recurringFailures, gaps, proposalsCreated.length, memoryThemes);
    let storedInMemory = false;
    try {
      const { default: AIService } = await import("../AIService");
      storedInMemory = await AIService.getInstance().consolidate("system", `REFLECTION ${new Date(now).toISOString()}: ${summary}`, [
        "reflection",
        "self-evaluation",
        "daily",
      ]);
    } catch {
      storedInMemory = false;
    }

    const result: ReflectionResult = {
      at: now,
      trigger,
      windowStart,
      tasks,
      recurringFailures,
      gaps,
      proposalsCreated,
      selfModelUpdates,
      memoryThemes,
      storedInMemory,
      summary,
    };
    const kv = KvStore.getInstance();
    kv.set(LAST_RUN_KEY, now);
    kv.set(HISTORY_KEY, [result, ...this.history()].slice(0, 30));
    emitCognition("lesson-extracted", `Reflection: ${summary}`, {
      data: { proposals: proposalsCreated.length, recurringFailures: recurringFailures.length, gaps: gaps.length },
    });
    return result;
  }

  private summarise(
    trigger: string,
    tasks: ReflectionResult["tasks"],
    failures: ReflectionResult["recurringFailures"],
    gaps: ReflectionResult["gaps"],
    proposals: number,
    themes: string[],
  ): string {
    const parts = [
      tasks.total
        ? `${tasks.completed}/${tasks.total} tasks completed${tasks.failed ? `, ${tasks.failed} failed` : ""}${tasks.cancelled ? `, ${tasks.cancelled} cancelled` : ""}.`
        : "No multi-step tasks ran in this window.",
      failures.length
        ? `Recurring tool failures: ${failures.map((f) => `${f.tool} (${f.count}×)`).join(", ")}.`
        : "No tool failed repeatedly.",
      gaps.length ? `Missing capabilities: ${gaps.map((g) => g.capability).join(", ")}.` : "",
      proposals ? `${proposals} improvement proposal(s) recorded for your review — none are approved automatically.` : "",
      themes.length ? `Memory themes: ${themes.slice(0, 3).join("; ")}.` : "",
    ];
    return `[${trigger}] ${parts.filter(Boolean).join(" ")}`;
  }
}
