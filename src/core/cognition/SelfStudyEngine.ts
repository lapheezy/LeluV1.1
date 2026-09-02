/**
 * ==========================================================
 * LÉLU
 * SELF-STUDY ENGINE — cognition that generates its own next step
 *
 * The shape of the process, and the reason this file exists:
 *
 *   PROJECT MISSION  →  CURRENT STATE  →  KNOWLEDGE GAPS
 *        →  INVESTIGATION  →  LEARNING  →  UPDATED STATE
 *        →  NEW KNOWLEDGE GAPS  →  NEXT INVESTIGATION  →  CONTINUE
 *
 * NOT:  objective queue → exhaustion → stop.
 *
 * The objective ledger (StudyObjectives) is a WORK BUFFER. An
 * empty buffer is not the end of thinking — it is the signal to
 * generate the next objectives from the persistent mission and
 * from everything the last cycle actually discovered. `runCycle()`
 * therefore has no terminating branch: while a mission exists,
 * `nextObjective()` always returns something, and the floor case
 * (re-validating the knowledge that has gone longest unchecked)
 * is renewable by construction.
 *
 * One cycle, in order:
 *   1  observe real state (mission, self-model, knowledge, code,
 *      capabilities, runtime, providers, memory)
 *   2  reconcile — reevaluate existing gaps against what is now known
 *   3  select or GENERATE the next objective
 *   4  retrieve relevant memory
 *   5  route to the existing agent/tool that can answer it
 *   6  execute the investigation against real systems
 *   7  evaluate the evidence (provider chain when available,
 *      deterministic evaluation when not)
 *   8  incorporate into short-term cognitive state
 *      (KnowledgeLibrary + SelfModel)
 *   9  consolidate durable learning into long-term memory (Brain)
 *  10  derive the NEW questions this learning created, prioritize,
 *      and continue
 *
 * Nothing here fabricates internal dialogue and nothing here is a
 * timer that blindly calls a model: every objective is derived from
 * real project state, real discoveries and real unresolved questions,
 * and a cycle only calls a provider when it has evidence to weigh.
 *
 * AUTHORIZATION: studying, analysing, remembering and planning are
 * thinking, and are never gated. The autonomy gate constrains
 * ACTIONS — running workspace commands, writing files, applying
 * candidates — which live in WorkspaceRuntime and the
 * SelfDevelopmentLoop, not here.
 * ==========================================================
 */

import AIService from "../AIService";
import AgentEventBus from "../agent/AgentEvents";
import KvStore from "../storage/KvStore";
import ProjectStore from "../projects/ProjectStore";
import ArchitectureMap from "../selfdev/ArchitectureMap";
import CapabilityRegistry from "../selfdev/CapabilityRegistry";
import SourceAccess from "../selfdev/SourceAccess";
import KnowledgeLibrary, { GAP_STATUSES, type KnowledgeEntry } from "./KnowledgeLibrary";
import SelfModel from "./SelfModel";
import StudyAgentRouter, { type Investigation } from "./StudyAgentRouter";
import StudyObjectives, {
  type StudyDomain,
  type StudyObjective,
  type StudyObjectiveInput,
} from "./StudyObjectives";

/** The persistent source new objectives are generated from. */
export interface CognitiveMission {
  /** LÉLU's own statement of what she is. */
  identity: string;
  /** Long-term objectives from the self-model. */
  longTerm: string[];
  /** Active goals. */
  goals: string[];
  /** Active projects and what each is for. */
  projects: { id: string; name: string; objective: string }[];
  /** True when there is something to pursue — always true in practice. */
  active: boolean;
}

/** What LÉLU currently believes about herself and the project. */
export interface CognitiveState {
  observedAt: number;
  knowledgeEntries: number;
  knowledgeGaps: number;
  verified: number;
  subsystems: number;
  unfinishedSubsystems: string[];
  lackingCapabilities: string[];
  partialCapabilities: string[];
  /** "development-runtime" vs "static-snapshot" — real environmental access. */
  sourceAccess: string;
  runtimeReachable: boolean;
  memories: number;
  openObjectives: number;
}

export interface StudyCycleReport {
  cycle: number;
  startedAt: number;
  finishedAt: number;
  /** The question this cycle worked on. */
  objective: StudyObjective | null;
  /** How the objective was obtained: taken from the buffer, or generated. */
  objectiveSource: "buffer" | "generated" | "none";
  /** Objectives generated this cycle, and by which origin. */
  generated: { question: string; origin: string }[];
  agent: string;
  tool: string;
  /** development-runtime | static-snapshot | none */
  evidenceOrigin: string;
  evidence: string[];
  evaluation: string;
  /** True when the cycle produced knowledge it did not have before. */
  learned: boolean;
  memoryConsolidated: boolean;
  /** New questions this cycle's learning revealed. */
  derived: string[];
  /** Provider actually used to evaluate, or null when none was reachable. */
  provider: string | null;
  providerFallback: boolean;
  state: CognitiveState;
  bufferRemaining: number;
  note?: string;
}

/**
 * The durable trace of the last completed cycle. Persisted so LÉLU's
 * cognitive state can be READ — by the chat route, by the UI, by
 * anything — without running a cycle to produce it, and so it survives
 * a reload. The in-memory report is richer; this is the part that has
 * to outlive the process.
 */
interface PersistedCognitiveTrace {
  cycle: number;
  finishedAt: number;
  objectiveId: string | null;
  question: string | null;
  origin: string | null;
  domain: string | null;
  target?: string;
  createdInCycle: number | null;
  objectiveSource: string;
  agent: string;
  tool: string;
  evidenceOrigin: string;
  evidenceCount: number;
  evaluation: string;
  provider: string | null;
  providerFallback: boolean;
  learned: boolean;
  memoryConsolidated: boolean;
  derived: string[];
  state: CognitiveState;
  note?: string;
}

/**
 * LÉLU's cognitive state, assembled for reading. Every field comes from
 * state her autonomous cycles already produced — nothing here starts a
 * cycle, and nothing here is generated on demand for the reader.
 */
export interface CognitiveStateView {
  /** True when the continuous loop is scheduling its own cycles. */
  running: boolean;
  /** Cycles completed in this process. */
  cycle: number;
  /** Cycle recorded in durable storage (survives reload). */
  persistedCycle: number;
  /** When the last cycle finished, or null if none has yet. */
  lastCycleAt: number | null;
  /** Whether this view came from live memory or durable storage. */
  source: "live" | "persisted" | "none";

  /** What she is currently focused on. */
  focus: {
    question: string;
    origin: string;
    domain: string;
    target?: string;
    /** Which cycle first raised this question. */
    createdInCycle: number | null;
    /** Why this question was selected over the others. */
    whySelected: string;
  } | null;

  /** The investigation that ran (or is running) for that focus. */
  investigation: {
    agent: string;
    tool: string;
    evidenceOrigin: string;
    evidenceCount: number;
    provider: string | null;
    providerFallback: boolean;
    learned: boolean;
    memoryConsolidated: boolean;
    conclusion: string;
  } | null;

  /** What recent cycles actually established. */
  discoveries: string[];
  /** Questions she carries that are not settled. */
  unresolved: string[];
  /** Her current understanding of the project and of herself. */
  understanding: {
    mission: string[];
    knowledgeEntries: number;
    verified: number;
    openGaps: number;
    sourceAccess: string;
    runtimeReachable: boolean;
    agents: string[];
  };
  /** The next question she intends to investigate. */
  nextIntended: { question: string; origin: string; domain: string; whySelected: string } | null;
  /** How many questions are carried in the buffer. */
  carried: number;
}

type Listener = (report: StudyCycleReport) => void;

const TRACE_KEY = "lelu.selfstudy.trace.v1";

/**
 * Pace between cycles. This is NOT "call the model every N ms": each
 * tick performs the real observe → derive → investigate → evaluate
 * work, and schedules the next tick only after the previous one has
 * finished, so cycles never overlap and a slow investigation simply
 * takes as long as it takes.
 */
const DEFAULT_INTERVAL_MS = 45_000;
/** Cheap cycles (no provider, no network) may follow much sooner. */
const FAST_INTERVAL_MS = 8_000;
/** An objective that keeps producing nothing is parked, not retried forever. */
const MAX_ATTEMPTS = 3;
/**
 * Hard ceiling on any single external step (an investigation, a provider
 * evaluation, a memory write). Without it, one call that never settles
 * would leave the cycle permanently in-flight, `running` stuck true, and
 * cognition silently stopped — the exact failure this engine exists to
 * prevent. A step that overruns is reported as a timeout and the cycle
 * carries on with what it has.
 */
const STEP_DEADLINE_MS = 60_000;

/**
 * Resolve `work` or, if it overruns, `fallback`. Never rejects: a step
 * that fails or hangs must degrade into evidence, not into a dead loop.
 */
async function withDeadline<T>(work: Promise<T>, fallback: T, ms = STEP_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export default class SelfStudyEngine {
  private static instance: SelfStudyEngine | null = null;

  private readonly objectives = StudyObjectives.getInstance();
  private readonly router = StudyAgentRouter.getInstance();
  private readonly knowledge = KnowledgeLibrary.getInstance();
  private readonly self = SelfModel.getInstance();

  private readonly listeners = new Set<Listener>();
  private cycle = 0;
  private running = false;
  private continuous = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastReport: StudyCycleReport | null = null;
  private history: StudyCycleReport[] = [];
  /** Domains worked in recent cycles — feeds the attention-fatigue term. */
  private recentDomains: StudyDomain[] = [];

  private constructor() {}

  public static getInstance(): SelfStudyEngine {
    if (!SelfStudyEngine.instance) {
      SelfStudyEngine.instance = new SelfStudyEngine();
    }
    return SelfStudyEngine.instance;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.lastReport) {
      try {
        listener(this.lastReport);
      } catch {
        /* contained */
      }
    }
    return () => this.listeners.delete(listener);
  }

  public getLastReport(): StudyCycleReport | null {
    return this.lastReport;
  }

  public getHistory(limit = 40): StudyCycleReport[] {
    return this.history.slice(-limit);
  }

  public getCycle(): number {
    return this.cycle;
  }

  public isRunning(): boolean {
    return this.continuous;
  }

  /* ------------------------- continuous operation ------------------------- */

  /**
   * Start thinking continuously. Cognition does not wait for chat: the
   * first cycle runs shortly after start and each subsequent cycle is
   * scheduled only once the previous one has finished.
   */
  public start(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (this.continuous) return;
    this.continuous = true;
    this.schedule(1_500, intervalMs);
  }

  public stop(): void {
    this.continuous = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number, intervalMs: number): void {
    if (!this.continuous) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.runCycle()
        .then((report) => {
          // A cycle that used no provider and no network can follow
          // quickly; one that did should pace itself.
          const next = report.provider ? intervalMs : FAST_INTERVAL_MS;
          this.schedule(next, intervalMs);
        })
        .catch(() => {
          // Cognition never dies on a failed cycle — it takes the next one.
          this.schedule(intervalMs, intervalMs);
        });
    }, delayMs);
  }

  /* ------------------------------- mission -------------------------------- */

  /**
   * The persistent source of cognition. It survives cycles, restarts
   * and an empty buffer — which is precisely why the buffer emptying
   * can never mean cognition is finished.
   */
  public mission(): CognitiveMission {
    const self = this.self.get();
    let projects: CognitiveMission["projects"] = [];
    try {
      projects = ProjectStore.getInstance()
        .list()
        .filter((project) => project.status === "active")
        .map((project) => ({
          id: project.id,
          name: project.name,
          objective: project.objective || project.description || project.originalRequest || "",
        }));
    } catch {
      projects = [];
    }

    return {
      identity: self.identity.summary,
      longTerm: self.longTermObjectives,
      goals: self.goals,
      projects,
      // Her identity alone is a standing mission: understand and improve
      // the system she is. There is no state in which this is empty.
      active: true,
    };
  }

  /* ------------------------------- observe -------------------------------- */

  public async observeState(): Promise<CognitiveState> {
    const entries = this.knowledge.list();
    const counts = this.knowledge.statusCounts();
    const architecture = ArchitectureMap.getInstance();
    const capabilities = CapabilityRegistry.getInstance();

    let memories = 0;
    try {
      memories = (await AIService.getInstance().getMemories(2000)).length;
    } catch {
      memories = 0;
    }

    const access = SourceAccess.getInstance();
    const status = await access.status();

    return {
      observedAt: Date.now(),
      knowledgeEntries: entries.length,
      knowledgeGaps: this.knowledge.gaps().length,
      verified: counts.verified + counts.tested,
      subsystems: architecture.list().length,
      unfinishedSubsystems: architecture
        .list()
        .filter((subsystem) => subsystem.status !== "working")
        .map((subsystem) => subsystem.id),
      lackingCapabilities: capabilities.lacking().map((capability) => capability.id),
      partialCapabilities: capabilities.partial().map((capability) => capability.id),
      sourceAccess: status.reachable ? "development-runtime" : "static-snapshot",
      runtimeReachable: status.reachable,
      memories,
      openObjectives: this.objectives.open().length,
    };
  }

  /* -------------------------------- cycle --------------------------------- */

  /**
   * One complete self-study cycle. Never throws, never returns "done" —
   * the only way this stops producing cycles is `stop()`.
   */
  public async runCycle(): Promise<StudyCycleReport> {
    if (this.running) {
      // Cycles never overlap. Every step inside a cycle is bounded by
      // `withDeadline`, so `running` cannot latch on a call that never
      // settles — the previous cycle is genuinely still working.
      const busy = this.lastReport ?? this.emptyReport(this.blankState());
      return { ...busy, note: "A cycle was already in progress; this request returned the previous report." };
    }
    this.running = true;
    this.cycle += 1;
    const startedAt = Date.now();

    try {
      /* 1 — CURRENT STATE ------------------------------------------------ */
      const mission = this.mission();
      const state = await withDeadline(this.observeState(), this.blankState());

      /* 2 — REEVALUATE EXISTING KNOWLEDGE GAPS ---------------------------- */
      const reconciled = this.reconcile();

      /* 3 — SELECT OR GENERATE THE NEXT OBJECTIVE ------------------------- */
      const generatedBefore = this.objectives.open().length;
      const selection = await this.nextObjective(mission, state);
      const generated = this.objectives
        .createdInCycle(this.cycle)
        .map((item) => ({ question: item.question, origin: item.origin }));

      if (!selection) {
        // Structurally unreachable while a mission exists; reported as a
        // real condition rather than silently ending cognition.
        const report = this.emptyReport(state);
        report.note =
          "No objective could be formed this cycle — the mission is empty. Cognition remains running and will regenerate as soon as any mission, project or knowledge state exists.";
        return this.finish(report, startedAt);
      }

      const { objective, source } = selection;
      this.objectives.update(objective.id, {
        status: "investigating",
        attempts: objective.attempts + 1,
      });
      this.recentDomains = [...this.recentDomains, objective.domain].slice(-8);

      /* 4 — RETRIEVE RELEVANT MEMORY -------------------------------------- */
      const memory = await withDeadline(AIService.getInstance().recall(objective.question), []);

      /* 5 + 6 — ROUTE TO AN EXISTING AGENT/TOOL AND INVESTIGATE ----------- */
      AgentEventBus.getInstance().emit({
        type: "task_started",
        taskId: `self-study-${this.cycle}`,
        label: `Self-study: ${objective.question}`,
      });
      const investigation = await withDeadline<Investigation>(this.router.investigate(objective), {
        ok: false,
        agentId: null,
        agentName: this.router.agentFor(objective.domain)?.name ?? "LÉLU (direct)",
        tool: objective.domain,
        origin: "none",
        evidence: [],
        leads: [],
        summary: "The investigation did not finish within its time budget.",
        error: "step-deadline-exceeded",
      });

      /* 7 — EVALUATE THE EVIDENCE ----------------------------------------- */
      const evaluation = await withDeadline(this.evaluate(objective, investigation, memory), {
        text: this.deterministicEvaluation(objective, investigation),
        provider: null,
        fallback: true,
      });

      /* 8 — INCORPORATE INTO SHORT-TERM COGNITIVE STATE ------------------- */
      const learned = this.incorporate(objective, investigation, evaluation.text);

      /* 9 — CONSOLIDATE DURABLE LEARNING INTO LONG-TERM MEMORY ------------ */
      const memoryConsolidated = await withDeadline(
        this.consolidate(objective, investigation, evaluation.text),
        false,
      );

      /* 10 — DERIVE THE NEW QUESTIONS THIS LEARNING CREATED ---------------- */
      const derived = this.derive(
        objective,
        investigation,
        evaluation.text,
        evaluation.provider !== null,
      );

      // Close out this objective honestly.
      if (investigation.ok && investigation.evidence.length > 0) {
        this.objectives.update(objective.id, {
          status: "answered",
          lastEvidence: investigation.summary,
        });
      } else if (objective.attempts + 1 >= MAX_ATTEMPTS) {
        this.objectives.update(objective.id, {
          status: "unresolved",
          lastEvidence: investigation.error ?? investigation.summary,
        });
        // An unresolved question is itself something to understand.
        this.enqueue({
          question: `Why can I not answer “${objective.question}” with the tools I have?`,
          detail: `${objective.attempts + 1} attempt(s) through ${investigation.tool} produced no usable evidence: ${
            investigation.error ?? investigation.summary
          }`,
          origin: "unresolved",
          domain: "capability",
          priority: 70,
          createdInCycle: this.cycle,
          parentId: objective.id,
        });
      } else {
        // Left open for another attempt. Priority is not decremented
        // here — `prioritize()` already accounts for attempts, from the
        // base, so the penalty is applied once rather than compounding.
        this.objectives.update(objective.id, {
          status: "open",
          lastEvidence: investigation.error ?? investigation.summary,
        });
      }

      /* Re-prioritize what remains, from the state we now have. */
      this.prioritize(state);

      AgentEventBus.getInstance().emit({
        type: "task_completed",
        taskId: `self-study-${this.cycle}`,
        label: `Self-study: ${objective.question}`,
      });

      const report: StudyCycleReport = {
        cycle: this.cycle,
        startedAt,
        finishedAt: Date.now(),
        objective,
        objectiveSource: source,
        generated,
        agent: investigation.agentName,
        tool: investigation.tool,
        evidenceOrigin: investigation.origin,
        evidence: investigation.evidence,
        evaluation: evaluation.text,
        learned,
        memoryConsolidated,
        derived,
        provider: evaluation.provider,
        providerFallback: evaluation.fallback,
        state: { ...state, openObjectives: this.objectives.open().length },
        bufferRemaining: this.objectives.open().length,
        note:
          reconciled.length > 0
            ? `Reevaluated ${reconciled.length} existing gap(s): ${reconciled.slice(0, 3).join("; ")}`
            : generatedBefore === 0
              ? "Buffer was empty at the start of this cycle — objectives were regenerated from the mission and current state."
              : undefined,
      };
      return this.finish(report, startedAt);
    } catch (error) {
      // A failed cycle is a fact, not a stop condition.
      const report = this.emptyReport(await this.observeState().catch(() => this.blankState()));
      report.note = `Cycle failed and was contained: ${error instanceof Error ? error.message : String(error)}. Cognition continues with the next cycle.`;
      return this.finish(report, startedAt);
    } finally {
      this.running = false;
    }
  }

  private finish(report: StudyCycleReport, startedAt: number): StudyCycleReport {
    report.startedAt = startedAt;
    report.finishedAt = Date.now();
    this.lastReport = report;
    this.history = [...this.history, report].slice(-120);
    this.persistTrace(report);
    for (const listener of this.listeners) {
      try {
        listener(report);
      } catch {
        /* a broken listener never stops cognition */
      }
    }
    return report;
  }

  /** Write the durable trace so the state can be READ without a cycle. */
  private persistTrace(report: StudyCycleReport): void {
    const trace: PersistedCognitiveTrace = {
      cycle: report.cycle,
      finishedAt: report.finishedAt,
      objectiveId: report.objective?.id ?? null,
      question: report.objective?.question ?? null,
      origin: report.objective?.origin ?? null,
      domain: report.objective?.domain ?? null,
      target: report.objective?.target,
      createdInCycle: report.objective?.createdInCycle ?? null,
      objectiveSource: report.objectiveSource,
      agent: report.agent,
      tool: report.tool,
      evidenceOrigin: report.evidenceOrigin,
      evidenceCount: report.evidence.length,
      evaluation: report.evaluation,
      provider: report.provider,
      providerFallback: report.providerFallback,
      learned: report.learned,
      memoryConsolidated: report.memoryConsolidated,
      derived: report.derived,
      state: report.state,
      note: report.note,
    };
    try {
      KvStore.getInstance().set(TRACE_KEY, trace);
    } catch {
      // Durability is best-effort; the live report is still available.
    }
  }

  private readTrace(): PersistedCognitiveTrace | null {
    try {
      return KvStore.getInstance().get<PersistedCognitiveTrace>(TRACE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  /* --------------------------- READING THE STATE --------------------------- */

  /**
   * Read LÉLU's current cognitive state.
   *
   * THIS IS A PURE READ. It never runs a cycle, never starts the loop,
   * never calls a provider and never mutates anything. The chat route
   * and the UI both use it, so asking her what she is thinking about
   * REPORTS cognition rather than causing it — and the answer is the
   * same whether or not a user has recently sent a message.
   *
   * It prefers the live in-process report and falls back to the durable
   * trace, so the state is still readable immediately after a reload,
   * before the reloaded loop has completed its first cycle.
   */
  public getCognitiveState(): CognitiveStateView {
    const live = this.lastReport;
    const trace = this.readTrace();
    const open = this.objectives.open();
    const mission = this.mission();

    const source: CognitiveStateView["source"] = live ? "live" : trace ? "persisted" : "none";

    const question = live?.objective?.question ?? trace?.question ?? null;
    const origin = live?.objective?.origin ?? trace?.origin ?? null;
    const domain = live?.objective?.domain ?? trace?.domain ?? null;
    const target = live?.objective?.target ?? trace?.target;
    const createdInCycle = live?.objective?.createdInCycle ?? trace?.createdInCycle ?? null;

    const focus =
      question && origin && domain
        ? {
            question,
            origin,
            domain,
            target,
            createdInCycle,
            whySelected: this.explainSelection(origin, domain, createdInCycle, live?.objectiveSource ?? trace?.objectiveSource),
          }
        : null;

    const investigation =
      live || trace
        ? {
            agent: live?.agent ?? trace?.agent ?? "—",
            tool: live?.tool ?? trace?.tool ?? "—",
            evidenceOrigin: live?.evidenceOrigin ?? trace?.evidenceOrigin ?? "none",
            evidenceCount: live?.evidence.length ?? trace?.evidenceCount ?? 0,
            provider: live?.provider ?? trace?.provider ?? null,
            providerFallback: live?.providerFallback ?? trace?.providerFallback ?? false,
            learned: live?.learned ?? trace?.learned ?? false,
            memoryConsolidated: live?.memoryConsolidated ?? trace?.memoryConsolidated ?? false,
            conclusion: this.answerLine(live?.evaluation ?? trace?.evaluation ?? ""),
          }
        : null;

    // Discoveries: what recent cycles actually established, from the
    // knowledge library entries self-study itself wrote.
    const discoveries = this.knowledge
      .list()
      .filter((entry) => (entry.source ?? "").startsWith("self-study:") || (entry.source ?? "").startsWith("source:"))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
      .map((entry) => `${entry.title} [${entry.status}] — ${this.answerLine(entry.detail)}`);

    // Unresolved: questions she is carrying that are not settled.
    const unresolved = [
      ...this.objectives
        .list()
        .filter((item) => item.status === "unresolved")
        .map((item) => `${item.question} (unresolved: ${item.lastEvidence ?? "no usable evidence"})`),
      ...open
        .filter((item) => item.attempts > 0)
        .map((item) => `${item.question} (attempted ${item.attempts}×, still open)`),
      ...this.knowledge.gaps().map((gap) => `${gap.title} (knowledge status: ${gap.status})`),
    ].slice(0, 8);

    const next = open.find((item) => item.id !== (live?.objective?.id ?? trace?.objectiveId));
    const state = live?.state ?? trace?.state ?? this.blankState();

    return {
      running: this.continuous,
      cycle: this.cycle,
      persistedCycle: trace?.cycle ?? 0,
      lastCycleAt: live?.finishedAt ?? trace?.finishedAt ?? null,
      source,
      focus,
      investigation,
      discoveries,
      unresolved,
      understanding: {
        mission: [
          ...mission.longTerm,
          ...mission.goals,
          ...mission.projects.map((project) => `${project.name}: ${project.objective}`),
        ].filter((item) => item.trim().length > 0),
        knowledgeEntries: state.knowledgeEntries,
        verified: state.verified,
        openGaps: state.knowledgeGaps,
        sourceAccess: state.sourceAccess,
        runtimeReachable: state.runtimeReachable,
        agents: this.agentsInPlay(),
      },
      nextIntended: next
        ? {
            question: next.question,
            origin: next.origin,
            domain: next.domain,
            whySelected: this.explainSelection(next.origin, next.domain, next.createdInCycle, "buffer"),
          }
        : null,
      carried: open.length,
    };
  }

  /** Plain-language reason a question was chosen — from its provenance. */
  private explainSelection(
    origin: string,
    domain: string,
    createdInCycle: number | null,
    objectiveSource?: string,
  ): string {
    const provenance: Record<string, string> = {
      "knowledge-gap": "an entry in my knowledge library is still untrusted, so I cannot rely on it",
      mission: "it is something my standing mission depends on that I do not yet understand",
      "self-model": "my own model of myself records this as unfinished or hypothetical",
      architecture: "a subsystem or capability is incomplete and I cannot describe it from evidence",
      discovery: "a previous investigation surfaced it",
      contradiction: "evidence contradicted what I believed, and a failure outranks curiosity",
      unresolved: "an earlier attempt produced no usable evidence",
      revalidation: "it is the belief that has gone longest without being re-checked",
    };
    const why = provenance[origin] ?? "it was the highest-priority open question";
    const from =
      createdInCycle && createdInCycle > 0 ? ` It was raised in cycle ${createdInCycle}.` : "";
    const how =
      objectiveSource === "generated"
        ? " The buffer was empty, so it was generated from my mission and current state rather than taken from a queue."
        : "";
    return `Selected because ${why} (${domain} question).${from}${how}`;
  }

  /** The ANSWER line of an evaluation, without exposing raw reasoning. */
  private answerLine(evaluation: string): string {
    const line = evaluation.split("\n").find((item) => /^ANSWER\s*:/i.test(item.trim()));
    const text = (line ? line.replace(/^ANSWER\s*:/i, "") : evaluation.split("\n")[0] ?? "").trim();
    return text.length > 400 ? `${text.slice(0, 399)}…` : text;
  }

  /** Agents that actually took part in recent cycles. */
  private agentsInPlay(): string[] {
    const names = new Set<string>();
    for (const report of this.history.slice(-12)) {
      if (report.agent && report.agent !== "—") names.add(`${report.agent} (${report.tool})`);
    }
    if (names.size === 0) {
      const trace = this.readTrace();
      if (trace?.agent && trace.agent !== "—") names.add(`${trace.agent} (${trace.tool})`);
    }
    return [...names];
  }

  /* ------------------------------ reconcile ------------------------------- */

  /**
   * Reevaluate existing knowledge gaps against what is now known. This
   * is the step whose absence made the old loop re-research the same
   * top gap forever: an investigated gap that produced evidence is
   * promoted out of "gap" status, and a verified belief whose evidence
   * has gone stale is pulled back for revalidation.
   */
  private reconcile(): string[] {
    const changes: string[] = [];
    const answered = this.objectives
      .resolved()
      .filter((item) => item.status === "answered" && item.knowledgeId);

    for (const objective of answered) {
      const entry = this.knowledge.get(objective.knowledgeId as string);
      if (!entry) continue;
      if (!GAP_STATUSES.includes(entry.status)) continue;
      // Investigated, evidence recorded → it is no longer an open gap.
      this.knowledge.update(entry.id, {
        status: "learned",
        detail: `${entry.detail}\n\nInvestigated (cycle ${objective.createdInCycle}): ${objective.lastEvidence ?? "evidence recorded"}`,
        source: `self-study:${objective.id}`,
      });
      changes.push(`“${entry.title}” unverified → learned`);
    }

    return changes;
  }

  /* --------------------------- objective supply --------------------------- */

  /**
   * The anti-termination core. Take from the buffer; when the buffer is
   * empty, GENERATE from the mission and the current state and take from
   * that. The buffer emptying is a refill trigger, never a stop.
   */
  private async nextObjective(
    mission: CognitiveMission,
    state: CognitiveState,
  ): Promise<{ objective: StudyObjective; source: "buffer" | "generated" } | null> {
    const buffered = this.objectives.open();
    if (buffered.length > 0) {
      // Still top up in the background so the buffer is never the limit.
      if (buffered.length < 3) {
        this.generate(mission, state);
      }
      return { objective: buffered[0], source: "buffer" };
    }

    this.generate(mission, state);
    const refilled = this.objectives.open();
    if (refilled.length > 0) {
      return { objective: refilled[0], source: "generated" };
    }
    return null;
  }

  /**
   * Generate the next objectives from REAL sources, in priority order.
   * Every branch is grounded in actual state; the final branch is
   * renewable by construction, so this never returns nothing while
   * LÉLU has any knowledge, code, capability or mission at all.
   */
  public generate(mission: CognitiveMission, state: CognitiveState): StudyObjective[] {
    const created: StudyObjective[] = [];
    const add = (input: StudyObjectiveInput): void => {
      const objective = this.enqueue(input);
      if (objective) created.push(objective);
    };

    /* a. Untrusted knowledge — the classic gap. */
    for (const gap of this.knowledge.gaps().slice(0, 4)) {
      const route = this.routeForKnowledge(gap);
      add({
        question: `What do I actually know about ${gap.title}, and is it true?`,
        detail: `KnowledgeLibrary entry “${gap.title}” (${gap.domain}) is ${gap.status}: ${gap.detail}`,
        origin: "knowledge-gap",
        domain: route.domain,
        priority: 80,
        createdInCycle: this.cycle,
        knowledgeId: gap.id,
        target: route.target,
      });
    }

    /* b. Environmental access — she cannot study what she cannot read. */
    if (!state.runtimeReachable) {
      add({
        question: "Why is the development runtime unreachable, and what can I still verify from the build-time snapshot?",
        detail:
          "Source reads are falling back to the STATIC SNAPSHOT. Establish exactly which self-inspection is still trustworthy and which conclusions must be marked build-time only.",
        origin: "self-model",
        domain: "runtime",
        priority: 90,
        createdInCycle: this.cycle,
        target: "engineering-runtime",
      });
    }

    /* c. Her own model of herself: what she has marked unfinished.
       Entries that are themselves records of an unanswered question are
       skipped — re-asking a question by quoting it is self-reference,
       and the "unresolved" objective raised at the end of a failed cycle
       already covers that case properly. */
    const self = this.self.get();
    const selfItems = [...self.unfinished, ...self.hypotheses].filter(
      (item) => !item.startsWith("Unresolved:") && !item.includes("?"),
    );
    for (const item of selfItems.slice(0, 3)) {
      add({
        question: `What is the current state of “${item}”?`,
        detail: "Taken from my own self-model — recorded as unfinished or hypothetical, so it is not yet knowledge.",
        origin: "self-model",
        domain: "architecture",
        priority: 65,
        createdInCycle: this.cycle,
        target: item,
      });
    }

    /* d. Subsystems she cannot yet describe from evidence. */
    for (const subsystemId of state.unfinishedSubsystems.slice(0, 3)) {
      const subsystem = ArchitectureMap.getInstance().get(subsystemId);
      if (!subsystem) continue;
      add({
        question: `What exactly is incomplete in the ${subsystem.name} subsystem?`,
        detail: `ArchitectureMap reports ${subsystem.id} as “${subsystem.status}” across ${subsystem.files.length} file(s). Establish what is missing from the real source.`,
        origin: "architecture",
        domain: "architecture",
        priority: 60,
        createdInCycle: this.cycle,
        target: subsystem.id,
      });
    }

    /* e. Capabilities she does not have, or only partly has. */
    for (const capabilityId of [...state.lackingCapabilities, ...state.partialCapabilities].slice(0, 3)) {
      const capability = CapabilityRegistry.getInstance().get(capabilityId);
      if (!capability) continue;
      add({
        question: `What is genuinely missing before “${capability.name}” works?`,
        detail: `CapabilityRegistry status: ${capability.status}. Limitations: ${capability.limitations.join("; ") || "none recorded"}.`,
        origin: "architecture",
        domain: "capability",
        priority: 55,
        createdInCycle: this.cycle,
        target: capability.id,
      });
    }

    /* f. The mission itself — the persistent generator. */
    const missionItems = [
      ...mission.longTerm,
      ...mission.goals,
      ...mission.projects.map((project) => `${project.name}: ${project.objective}`),
    ].filter((item) => item.trim().length > 0);

    for (const item of missionItems.slice(0, 3)) {
      add({
        question: `What do I still not understand that “${item}” depends on?`,
        detail: "Derived from the persistent mission — the standing source of cognitive objectives.",
        origin: "mission",
        domain: "architecture",
        priority: 50,
        createdInCycle: this.cycle,
        target: item,
      });
    }

    /* g. Source she has never actually read. */
    if (created.length === 0) {
      const unread = this.nextUnreadSource();
      if (unread) {
        add({
          question: `What does ${unread} actually do?`,
          detail: "A real source file in my own codebase that I have no recorded reading of.",
          origin: "architecture",
          domain: "source",
          priority: 45,
          createdInCycle: this.cycle,
          target: unread,
        });
      }
    }

    /* h. THE FLOOR — renewable by construction.
       Everything verified means the oldest verified belief is the one
       most likely to have drifted from the code. Re-checking it is real
       cognitive work, it produces real evidence, and it can never run
       out. This is why the buffer emptying is not an end state. */
    if (created.length === 0) {
      const oldest = this.oldestCheckedEntry();
      if (oldest) {
        const route = this.routeForKnowledge(oldest);
        add({
          question: `Is what I believe about ${oldest.title} still true?`,
          detail: `Last checked ${new Date(oldest.updatedAt).toISOString()} (status ${oldest.status}). Beliefs about a codebase that keeps changing decay; re-verify against current state.`,
          origin: "revalidation",
          domain: route.domain,
          priority: 35,
          createdInCycle: this.cycle,
          knowledgeId: oldest.id,
          target: route.target,
        });
      } else {
        // No knowledge at all yet: begin from her own architecture.
        add({
          question: "What is this system made of?",
          detail: "No knowledge is recorded yet — start from the architecture map and the real source.",
          origin: "mission",
          domain: "architecture",
          priority: 40,
          createdInCycle: this.cycle,
        });
      }
    }

    return created;
  }

  private enqueue(input: StudyObjectiveInput): StudyObjective | null {
    return this.objectives.add(input);
  }

  /**
   * Which investigation actually answers this knowledge entry, and what
   * it should be pointed at. The target is only ever a real handle the
   * chosen tool can use — a file path for source reads, a subsystem or
   * capability id for inspection, a query for research. Handing a
   * source read a prose title would guarantee a failed investigation and
   * leave the gap open forever, which is precisely the bug this
   * replaces.
   */
  private routeForKnowledge(entry: KnowledgeEntry): { domain: StudyDomain; target?: string } {
    // An entry recorded FROM a file is re-verified against that file.
    if (entry.source?.startsWith("source:")) {
      return { domain: "source", target: entry.source.slice("source:".length) };
    }

    if (entry.domain === "selfdev" || entry.domain === "software" || entry.domain === "computing") {
      // Something about her own system: answer it from her own system.
      const subsystem = ArchitectureMap.getInstance()
        .list()
        .find(
          (item) =>
            entry.title.toLowerCase().includes(item.name.toLowerCase()) ||
            entry.detail.toLowerCase().includes(item.id.toLowerCase()),
        );
      if (subsystem) return { domain: "architecture", target: subsystem.id };

      const capability = CapabilityRegistry.getInstance()
        .list()
        .find((item) => entry.title.toLowerCase().includes(item.name.toLowerCase()));
      if (capability) return { domain: "capability", target: capability.id };

      // No specific handle — inspect the architecture as a whole.
      return { domain: "architecture" };
    }

    // Everything else is a question about the world: research it, using
    // the entry's own text as the query.
    return { domain: "research", target: `${entry.title} ${entry.detail}`.slice(0, 200) };
  }

  /** A real source path with no recorded reading, if there is one. */
  private nextUnreadSource(): string | null {
    const read = new Set(
      this.knowledge
        .list()
        .map((entry) => entry.source ?? "")
        .filter((source) => source.startsWith("source:"))
        .map((source) => source.slice("source:".length)),
    );
    const candidates = SourceAccess.getInstance()
      .snapshotPaths("/src/core/")
      .map((path) => path.replace(/^\//, ""));
    for (const path of candidates) {
      if (!read.has(path)) return path;
    }
    return null;
  }

  /** The belief that has gone longest without being checked. */
  private oldestCheckedEntry(): KnowledgeEntry | null {
    const entries = this.knowledge.list();
    if (entries.length === 0) return null;
    return entries.reduce((oldest, entry) => (entry.updatedAt < oldest.updatedAt ? entry : oldest));
  }

  /* ------------------------------- evaluate ------------------------------- */

  /**
   * Weigh the evidence. The provider chain is a cognitive RESOURCE: when
   * it answers, its reading is used; when every provider fails, the
   * deterministic evaluation below is used and the cycle carries on with
   * its state intact. Cognition is never the provider.
   */
  private async evaluate(
    objective: StudyObjective,
    investigation: Investigation,
    memory: { prompt: string; response: string; confidence: number }[],
  ): Promise<{ text: string; provider: string | null; fallback: boolean }> {
    const deterministic = this.deterministicEvaluation(objective, investigation);

    if (investigation.evidence.length === 0) {
      return { text: deterministic, provider: null, fallback: false };
    }

    const prompt = [
      `QUESTION I AM INVESTIGATING: ${objective.question}`,
      `WHY IT MATTERS: ${objective.detail}`,
      "",
      `INVESTIGATION (${investigation.tool}, evidence from ${
        investigation.origin === "development-runtime"
          ? "the REAL DEVELOPMENT RUNTIME"
          : investigation.origin === "static-snapshot"
            ? "a BUILD-TIME STATIC SNAPSHOT"
            : "internal state"
      }):`,
      ...investigation.evidence.map((line) => `- ${line}`),
      "",
      memory.length > 0
        ? `WHAT I ALREADY REMEMBERED:\n${memory.slice(0, 4).map((item) => `- ${item.response.slice(0, 200)}`).join("\n")}`
        : "I had no relevant memory of this before now.",
      "",
      "Answer in three short labelled parts, grounded ONLY in the evidence above:",
      "ANSWER: what the evidence actually establishes.",
      "CONFIDENCE: verified | tested | learned | inferred | unverified — and why.",
      "NEXT: the single most important question this answer creates. One line.",
    ].join("\n");

    try {
      const response = await AIService.getInstance().reason(prompt, {
        system:
          "You are LÉLU reasoning about your own system. Use only the evidence given. Never invent files, APIs or results. If the evidence is insufficient, say so plainly and name what would settle it.",
        temperature: 0.2,
        maxTokens: 700,
      });

      const succeeded =
        response.metadata?.success !== false &&
        response.provider !== "offline" &&
        response.text.trim().length > 0;

      if (succeeded) {
        return { text: response.text.trim(), provider: response.provider, fallback: false };
      }

      // Every authorized provider was tried and none answered. The
      // cognitive operation continues on the evidence it already holds.
      return {
        text: `${deterministic}\n\n(No AI provider was reachable for this evaluation — the evidence above was evaluated deterministically. Cognitive state preserved; the provider chain will be retried next cycle.)`,
        provider: null,
        fallback: true,
      };
    } catch {
      return {
        text: `${deterministic}\n\n(The provider chain raised an error during evaluation; the evidence was evaluated deterministically and cognition continued.)`,
        provider: null,
        fallback: true,
      };
    }
  }

  /** Evidence-only evaluation — always available, no provider needed. */
  private deterministicEvaluation(objective: StudyObjective, investigation: Investigation): string {
    if (!investigation.ok || investigation.evidence.length === 0) {
      return [
        `ANSWER: ${investigation.summary}`,
        `CONFIDENCE: unverified — ${investigation.error ?? "the investigation produced no usable evidence"}.`,
        `NEXT: find a tool that can answer “${objective.question}”.`,
      ].join("\n");
    }

    const sourceLabel =
      investigation.origin === "development-runtime"
        ? "verified against the real development runtime"
        : investigation.origin === "static-snapshot"
          ? "read from the build-time snapshot, so it reflects the last build rather than the working tree"
          : "read from internal runtime state";

    return [
      `ANSWER: ${investigation.summary} ${investigation.evidence.slice(0, 4).join(" ")}`,
      `CONFIDENCE: ${investigation.origin === "development-runtime" ? "tested" : "learned"} — ${sourceLabel}.`,
      `NEXT: ${
        investigation.leads.length > 0
          ? `follow up on ${investigation.leads[0]}.`
          : `establish what “${objective.question}” still leaves open.`
      }`,
    ].join("\n");
  }

  /* ------------------------ incorporate + consolidate ---------------------- */

  /** Update the short-term cognitive state: knowledge + self-model. */
  private incorporate(
    objective: StudyObjective,
    investigation: Investigation,
    evaluation: string,
  ): boolean {
    if (!investigation.ok || investigation.evidence.length === 0) {
      this.self.addUnfinished(`Unresolved: ${objective.question}`);
      return false;
    }

    const status =
      investigation.origin === "development-runtime"
        ? "tested"
        : investigation.origin === "static-snapshot"
          ? "learned"
          : "inferred";

    if (objective.knowledgeId && this.knowledge.get(objective.knowledgeId)) {
      // Settle the entry that raised the question, rather than piling a
      // parallel entry beside it and leaving the gap open forever.
      const existing = this.knowledge.get(objective.knowledgeId) as KnowledgeEntry;
      this.knowledge.update(existing.id, {
        status,
        detail: `${evaluation}\n\nEvidence (${investigation.tool}, ${investigation.origin}):\n${investigation.evidence.slice(0, 6).join("\n")}`,
        source: objective.target && investigation.tool === "source-read" ? `source:${objective.target}` : `self-study:${investigation.tool}`,
      });
    } else {
      this.knowledge.add({
        domain: objective.domain === "research" ? "ai" : "selfdev",
        title: objective.question.replace(/\?$/, ""),
        detail: `${evaluation}\n\nEvidence (${investigation.tool}, ${investigation.origin}):\n${investigation.evidence.slice(0, 6).join("\n")}`,
        status,
        source:
          objective.target && investigation.tool === "source-read"
            ? `source:${objective.target}`
            : `self-study:${investigation.tool}`,
      });
    }

    this.self.addLearning(
      `Cycle ${this.cycle} — ${objective.question} → ${investigation.summary} (${investigation.agentName}/${investigation.tool}, ${investigation.origin})`,
    );
    if (investigation.origin === "development-runtime") {
      this.self.recordDiscovery(`${objective.question} — ${investigation.summary}`);
    }
    return true;
  }

  /**
   * Write the durable learning into long-term memory through the EXISTING
   * Brain, so the next cycle's recall can find it. No second memory system.
   */
  private async consolidate(
    objective: StudyObjective,
    investigation: Investigation,
    evaluation: string,
  ): Promise<boolean> {
    if (!investigation.ok || investigation.evidence.length === 0) {
      return false;
    }
    const kind = objective.domain === "research" ? "knowledge" : "system";
    const summary = [
      `Self-study cycle ${this.cycle}: ${objective.question}`,
      evaluation.split("\n").slice(0, 3).join(" "),
      `(via ${investigation.agentName} / ${investigation.tool}, evidence ${investigation.origin})`,
    ].join(" ");
    const keywords = [
      objective.domain,
      objective.origin,
      investigation.tool,
      ...(objective.target ? [objective.target] : []),
      ...objective.question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4).slice(0, 6),
    ];
    return AIService.getInstance().consolidate(kind, summary, keywords);
  }

  /* -------------------------------- derive -------------------------------- */

  /**
   * The questions this learning created. This is what makes cycle 12
   * exist because of cycle 11 rather than because something pre-queued it.
   */
  private derive(
    objective: StudyObjective,
    investigation: Investigation,
    evaluation: string,
    providerEvaluated: boolean,
  ): string[] {
    const derived: string[] = [];
    const push = (input: StudyObjectiveInput): void => {
      // A question that quotes the question that produced it is not a
      // new question — it is the loop talking to itself. Reject it.
      if (this.isSelfReferential(input.question, objective.question)) return;
      const created = this.enqueue(input);
      if (created) derived.push(created.question);
    };

    /* The model's own NEXT line — but only when a PROVIDER actually
       produced it. The deterministic fallback's NEXT is a placeholder
       phrased from the question itself; promoting that to an objective
       would manufacture questions instead of discovering them. */
    if (providerEvaluated) {
      const nextLine = evaluation.split("\n").find((line) => /^NEXT\s*:/i.test(line.trim()));
      const question = nextLine?.replace(/^NEXT\s*:/i, "").trim() ?? "";
      if (question.length > 12 && question.length < 220) {
        push({
          question: question.endsWith("?") ? question : `${question}?`,
          detail: `Raised by the evaluation of “${objective.question}” in cycle ${this.cycle}.`,
          origin: "discovery",
          domain: objective.domain,
          priority: 75,
          createdInCycle: this.cycle,
          parentId: objective.id,
        });
      }
    }

    /* Concrete leads the tool itself surfaced — files, subsystems, findings.
       These are the reliable source of genuinely new questions: they name
       something real that the investigation touched. */
    for (const lead of investigation.leads.slice(0, 2)) {
      const isPath = lead.includes("/");
      push({
        question: isPath
          ? `What does ${lead} contribute to ${objective.target ?? "this subsystem"}?`
          : `What is the state of ${lead}?`,
        detail: `Surfaced while investigating “${objective.question}” with ${investigation.tool} in cycle ${this.cycle}.`,
        origin: "discovery",
        domain: isPath ? "source" : this.domainForLead(lead),
        priority: 62,
        createdInCycle: this.cycle,
        parentId: objective.id,
        target: lead,
      });
    }

    /* Evidence of a failure. Keyed by the FAILURE ITSELF, not by the
       question that surfaced it: the same broken thing found again is
       the same question, so it dedupes instead of nesting. */
    const failureLine = investigation.evidence.find((line) =>
      /\b(fail|failed|failing|error|unreachable|missing|not implemented|cannot)\b/i.test(line),
    );
    if (failureLine) {
      const signature = this.failureSignature(failureLine);
      push({
        question: `What is causing this failure: ${signature}?`,
        detail: `Observed while investigating “${objective.question}” with ${investigation.tool}: ${failureLine.slice(0, 240)}`,
        origin: "contradiction",
        domain: objective.domain === "research" ? "runtime" : objective.domain,
        priority: 85,
        createdInCycle: this.cycle,
        parentId: objective.id,
        // The signature is the identity of this failure — the same
        // failure never becomes a second objective.
        target: signature,
      });
    }

    /* A snapshot-only answer is genuinely weaker — say so and plan to
       redo it, keyed to the thing read rather than to the question. */
    if (investigation.origin === "static-snapshot" && objective.target) {
      push({
        question: `Does the live workspace still match the build-time snapshot for ${objective.target}?`,
        detail:
          "This answer came from the STATIC SNAPSHOT, not the development runtime, so it may be behind the working tree. Re-verify when the runtime is reachable.",
        origin: "revalidation",
        domain: objective.domain,
        priority: 40,
        createdInCycle: this.cycle,
        parentId: objective.id,
        target: objective.target,
      });
    }

    return derived;
  }

  /**
   * Would this "new" question just be restating the one that produced
   * it? Nested self-quotation is the failure mode that turns a
   * continuous loop into an echo chamber, so it is rejected outright.
   */
  private isSelfReferential(candidate: string, parent: string): boolean {
    const normalize = (text: string): string =>
      text.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
    const child = normalize(candidate);
    const source = normalize(parent);
    if (child.includes(source) || source.includes(child)) return true;
    // Also catch a chain that has already nested: quoted text inside a
    // question that is itself a question.
    return (candidate.match(/\?/g) ?? []).length > 1;
  }

  /** A stable identity for an observed failure, independent of wording. */
  private failureSignature(line: string): string {
    return line
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "")
      .replace(/\b\d+\b/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 110);
  }

  private domainForLead(lead: string): StudyDomain {
    if (/provider|runtime|network/i.test(lead)) return "runtime";
    if (/test/i.test(lead)) return "testing";
    if (/memory/i.test(lead)) return "memory";
    if (CapabilityRegistry.getInstance().get(lead)) return "capability";
    if (ArchitectureMap.getInstance().get(lead)) return "architecture";
    return "architecture";
  }

  /* ------------------------------ prioritize ------------------------------ */

  /**
   * Recompute priority from current state, so what matters next follows
   * from what is actually true now rather than from insertion order.
   */
  private prioritize(state: CognitiveState): void {
    // How many of the last few cycles already worked each domain. A
    // permanently-true condition (an unreachable runtime, say) would
    // otherwise keep re-winning the priority contest forever and starve
    // every other question — thinking in a circle rather than moving.
    const recentDomains = this.recentDomains.slice(-4);

    for (const objective of this.objectives.open()) {
      // Always from the intrinsic base, never from last cycle's result:
      // adjustments must not compound, or a question that lost the
      // contest once would sink forever and never be investigated.
      let priority = objective.basePriority ?? objective.priority;

      // A blocked environment blocks everything downstream of it.
      if (objective.domain === "runtime" && !state.runtimeReachable) priority += 20;
      // Contradictions and failures outrank curiosity.
      if (objective.origin === "contradiction") priority += 15;
      // Questions created by real discoveries beat pre-seeded ones.
      if (objective.origin === "discovery") priority += 8;
      // Snapshot-only re-verification waits until the runtime is back.
      if (objective.origin === "revalidation" && !state.runtimeReachable) priority -= 15;
      // Repeated failure to answer lowers, but never zeroes, a question.
      priority -= objective.attempts * 10;
      // Age nudges long-carried questions upward so nothing starves.
      priority += Math.min(10, Math.floor((Date.now() - objective.createdAt) / (60 * 60 * 1000)));
      // Recency fatigue: attention moves on instead of grinding the same
      // kind of question cycle after cycle.
      priority -= 18 * recentDomains.filter((domain) => domain === objective.domain).length;

      const clamped = Math.max(1, Math.min(100, Math.round(priority)));
      if (clamped !== objective.priority) {
        this.objectives.update(objective.id, { priority: clamped });
      }
    }
  }

  /* -------------------------------- helpers ------------------------------- */

  private blankState(): CognitiveState {
    return {
      observedAt: Date.now(),
      knowledgeEntries: 0,
      knowledgeGaps: 0,
      verified: 0,
      subsystems: 0,
      unfinishedSubsystems: [],
      lackingCapabilities: [],
      partialCapabilities: [],
      sourceAccess: "static-snapshot",
      runtimeReachable: false,
      memories: 0,
      openObjectives: 0,
    };
  }

  private emptyReport(state: CognitiveState): StudyCycleReport {
    return {
      cycle: this.cycle,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      objective: null,
      objectiveSource: "none",
      generated: [],
      agent: "—",
      tool: "—",
      evidenceOrigin: "none",
      evidence: [],
      evaluation: "",
      learned: false,
      memoryConsolidated: false,
      derived: [],
      provider: null,
      providerFallback: false,
      state,
      bufferRemaining: this.objectives.open().length,
    };
  }
}
