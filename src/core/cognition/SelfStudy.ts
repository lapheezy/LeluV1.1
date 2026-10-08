/**
 * ==========================================================
 * LÉLU
 * SELF STUDY — the autonomous self-cognition cycle
 *
 * The CognitiveLoop already ran on an interval before this file
 * existed, but it studied the OUTSIDE: it counted memories and
 * projects, and it researched knowledge gaps through the news
 * and encyclopedia providers. It never once read her own source,
 * never consulted the architecture map, and never delegated to
 * an agent. Agents sat in a registry waiting for someone to
 * click them.
 *
 * This is the cycle that studies HERSELF, and it is a state
 * machine over real state — not generated "thinking" text:
 *
 *   MISSION      ProjectMission (why any of this matters)
 *   SELF STATE   ArchitectureMap + SelfModel + AutonomyGate
 *   OBSERVE      which subsystems exist, which are partial
 *   REFLECT      what KnowledgeLibrary already holds about them
 *   GAP          subsystems with no verified self-knowledge
 *   OBJECTIVE    the highest mission-weighted gap
 *   PLAN         the real source files that answer it
 *   SELECT       an executive agent chosen by question shape
 *   EXECUTE      SelfCode reads the REAL file; AgentRunner runs
 *   EVALUATE     compare the finding against what she believed
 *   LEARN        form a conclusion, detect contradiction
 *   CONSOLIDATE  KnowledgeLibrary + SelfModel + PatternMemory
 *   REASSESS     recompute gaps, name the next objective
 *
 * Every phase emits on the ONE AgentEventBus, so the trace, the
 * UI activity feed and the runtime all see the same cycle.
 *
 * AUTHORIZATION. Cognition is separated from execution on
 * purpose. Everything this file does is READ-ONLY: reading
 * source, reading the architecture map, asking an agent to
 * reason. Nothing here writes a source file, and it never asks
 * for permission to think. When a cycle concludes that
 * something should CHANGE, it records a proposal and stops —
 * `pendingAuthorization` is how the UI shows what is waiting on
 * the user. The AutonomyGate decides; SelfStudy only asks.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import AgentRunner from "../agents/AgentRunner";
import AgentStore from "../agents/AgentStore";
import { EXECUTIVE_AGENT_FOR_INTENT } from "../agents/AgentTemplates";
import ArchitectureMap, { type ArchitectureSubsystem } from "../selfdev/ArchitectureMap";
import SelfCode from "../selfdev/SelfCode";
import AutonomyGate from "./AutonomyGate";
import KnowledgeLibrary from "./KnowledgeLibrary";
import ProjectMission from "./ProjectMission";
import SelfModel from "./SelfModel";

/** The phases of one cycle, in the order they run. */
export const SELF_STUDY_PHASES = [
  "mission",
  "self-state",
  "observe",
  "reflect",
  "gap",
  "objective",
  "plan",
  "select-agent",
  "execute",
  "evaluate",
  "learn",
  "consolidate",
  "reassess",
] as const;

export type SelfStudyPhase = (typeof SELF_STUDY_PHASES)[number];

/** Something LÉLU does not yet reliably know about her own system. */
export interface SelfKnowledgeGap {
  /** Stable across cycles so attempts accumulate: the subsystem id. */
  id: string;
  subsystem: string;
  subsystemId: string;
  question: string;
  reason: string;
  /** Mission-weighted priority — see ProjectMission.relevanceOf. */
  priority: number;
  missionReasons: string[];
  attempts: number;
  lastAttemptAt: number | null;
  status: "open" | "resolved" | "failed";
}

/** A single piece of real evidence gathered during a cycle. */
export interface SelfStudyEvidence {
  kind: "architecture" | "source" | "agent" | "memory";
  label: string;
  detail: string;
}

/** A change LÉLU concluded is worth making, waiting on the user. */
export interface SelfStudyProposal {
  id: string;
  objective: string;
  proposal: string;
  /** The AutonomyGate level this would require. */
  requiresLevel: number;
  createdAt: number;
}

export interface SelfStudyCycleRecord {
  cycle: number;
  startedAt: number;
  finishedAt: number;
  /** How far the machine actually got. */
  reachedPhase: SelfStudyPhase;
  ok: boolean;
  error: string | null;

  missionSummary: string;
  autonomyLevel: number;

  gapsOpen: number;
  objective: string | null;
  gapId: string | null;
  subsystem: string | null;
  missionReasons: string[];

  filesPlanned: string[];
  agent: string | null;
  agentSkippedReason: string | null;

  evidence: SelfStudyEvidence[];
  conclusion: string | null;
  contradiction: string | null;

  memoryWrites: string[];
  proposal: SelfStudyProposal | null;
  nextObjective: string | null;
}

/** Short-term working state for the cycle currently running. */
export interface SelfStudyWorkingState {
  phase: SelfStudyPhase | "idle";
  objective: string | null;
  subsystem: string | null;
  agent: string | null;
  evidenceCount: number;
  startedAt: number | null;
}

/** How many source files one cycle will read. Attention is bounded. */
const FILES_PER_CYCLE = 2;
/** How much of a file reaches the agent. Whole files blow the context. */
const SOURCE_EXCERPT_CHARS = 2400;
/** A gap that has failed this many times stops being retried forever. */
const MAX_GAP_ATTEMPTS = 3;
/** Agent delegation needs Suggest; reading her own code needs only Observe. */
const LEVEL_READ = 0;
const LEVEL_DELEGATE = 1;

export default class SelfStudy {
  private static instance: SelfStudy | null = null;

  private cycle = 0;
  private gaps = new Map<string, SelfKnowledgeGap>();
  private history: SelfStudyCycleRecord[] = [];
  private proposals: SelfStudyProposal[] = [];
  private working: SelfStudyWorkingState = {
    phase: "idle",
    objective: null,
    subsystem: null,
    agent: null,
    evidenceCount: 0,
    startedAt: null,
  };
  private running = false;
  private readonly listeners = new Set<(record: SelfStudyCycleRecord) => void>();

  private constructor() {}

  public static getInstance(): SelfStudy {
    if (!SelfStudy.instance) {
      SelfStudy.instance = new SelfStudy();
    }
    return SelfStudy.instance;
  }

  public subscribe(listener: (record: SelfStudyCycleRecord) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Short-term cognitive state — what she is doing RIGHT NOW. */
  public getWorkingState(): SelfStudyWorkingState {
    return { ...this.working };
  }

  public getGaps(): SelfKnowledgeGap[] {
    return [...this.gaps.values()].sort((a, b) => b.priority - a.priority);
  }

  public getHistory(): SelfStudyCycleRecord[] {
    return [...this.history];
  }

  public getLastCycle(): SelfStudyCycleRecord | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  /** Proposals waiting on the user's authorization. */
  public pendingAuthorization(): SelfStudyProposal[] {
    return [...this.proposals];
  }

  public clearProposal(id: string): void {
    this.proposals = this.proposals.filter((proposal) => proposal.id !== id);
  }

  /* ==================================================================== */
  /* THE CYCLE                                                            */
  /* ==================================================================== */

  /**
   * Run one complete self-study cycle.
   *
   * Returns a record of what actually happened rather than throwing:
   * a cognitive cycle that dies takes the next one with it, and the
   * whole point is that this keeps running without a user message.
   */
  public async runCycle(): Promise<SelfStudyCycleRecord> {
    if (this.running) {
      return (
        this.getLastCycle() ?? this.emptyRecord("observe", "a cycle was already running")
      );
    }
    this.running = true;
    this.cycle += 1;

    const startedAt = Date.now();
    const taskId = `selfstudy-${this.cycle}`;
    const events = AgentEventBus.getInstance();
    const mission = ProjectMission.getInstance();
    const autonomy = AutonomyGate.getInstance();

    const evidence: SelfStudyEvidence[] = [];
    const memoryWrites: string[] = [];
    let reached: SelfStudyPhase = "mission";
    let objectiveGap: SelfKnowledgeGap | null = null;
    let filesPlanned: string[] = [];
    let agentName: string | null = null;
    let agentSkippedReason: string | null = null;
    let conclusion: string | null = null;
    let contradiction: string | null = null;
    let proposal: SelfStudyProposal | null = null;
    let nextObjective: string | null = null;
    let error: string | null = null;

    this.working = {
      phase: "mission",
      objective: null,
      subsystem: null,
      agent: null,
      evidenceCount: 0,
      startedAt,
    };

    events.emit({ type: "task_started", taskId, label: `Self-study cycle ${this.cycle}` });

    try {
      /* -------------------- MISSION -------------------- */
      const missionState = mission.get();
      reached = this.enterPhase("self-state", taskId);

      /* -------------------- SELF STATE + OBSERVE -------------------- */
      const architecture = ArchitectureMap.getInstance();
      const subsystems = architecture.list();
      evidence.push({
        kind: "architecture",
        label: "architecture map",
        detail: `${subsystems.length} subsystems, ${architecture.countFiles()} source files`,
      });
      reached = this.enterPhase("observe", taskId);

      /* -------------------- REFLECT + GAP -------------------- */
      reached = this.enterPhase("reflect", taskId);
      this.refreshGaps(subsystems);
      reached = this.enterPhase("gap", taskId);

      /* -------------------- OBJECTIVE -------------------- */
      objectiveGap = this.selectObjective();
      if (!objectiveGap) {
        // Nothing left to study is a real, reportable state — not a
        // failure, and not a reason to invent busywork.
        const record = this.finish({
          cycle: this.cycle,
          startedAt,
          reachedPhase: "objective",
          ok: true,
          error: null,
          missionSummary: missionState.northStar.slice(0, 160),
          autonomyLevel: autonomy.getLevel(),
          gapsOpen: 0,
          objective: null,
          gapId: null,
          subsystem: null,
          missionReasons: [],
          filesPlanned: [],
          agent: null,
          agentSkippedReason: "no open knowledge gap — every subsystem has verified self-knowledge",
          evidence,
          conclusion: "All mapped subsystems already have verified self-knowledge.",
          contradiction: null,
          memoryWrites: [],
          proposal: null,
          nextObjective: null,
        });
        events.emit({ type: "task_completed", taskId, label: "Self-study: nothing left to study" });
        return record;
      }

      objectiveGap.attempts += 1;
      objectiveGap.lastAttemptAt = Date.now();
      this.working.objective = objectiveGap.question;
      this.working.subsystem = objectiveGap.subsystem;
      reached = this.enterPhase("plan", taskId);

      /* -------------------- PLAN -------------------- */
      const subsystem = subsystems.find((item) => item.id === objectiveGap!.subsystemId);
      filesPlanned = (subsystem?.files ?? []).slice(0, FILES_PER_CYCLE);
      events.emit({
        type: "task_planning",
        taskId,
        plan: `Study ${objectiveGap.subsystem} via ${filesPlanned.length} source file(s)`,
      });

      /* -------------------- SELECT AGENT -------------------- */
      reached = this.enterPhase("select-agent", taskId);
      const intent = this.intentFor(subsystem);
      const store = AgentStore.getInstance();
      // Create the executive agents if this install has never had them.
      // "Execute the ones that aren't" — cognition should not stall
      // because an agent was never clicked into existence.
      store.ensureExecutiveAgents();
      const agent = store.executiveAgentByTemplate(EXECUTIVE_AGENT_FOR_INTENT[intent]);
      agentName = agent?.name ?? null;
      this.working.agent = agentName;
      if (agent) {
        events.emit({ type: "tool_selected", taskId, tool: agent.name, label: `intent: ${intent}` });
      }

      /* -------------------- EXECUTE -------------------- */
      reached = this.enterPhase("execute", taskId);

      // Reading her own source is an Observe-level act. It is the
      // foundation of self-knowledge and is never gated above L0.
      // The actual code, kept out of the cycle record: the record is
      // persisted and rendered, and whole source files would bury it.
      // The agent still reasons over real code, not a line count.
      const excerpts: Array<{ path: string; excerpt: string }> = [];
      if (autonomy.can(LEVEL_READ)) {
        const selfCode = SelfCode.getInstance();
        for (const path of filesPlanned) {
          const content = await selfCode.readCoreSource(path);
          if (content === null) {
            evidence.push({ kind: "source", label: path, detail: "unreadable from this runtime" });
            continue;
          }
          events.emit({ type: "file_opened", taskId, path });
          evidence.push({
            kind: "source",
            label: path,
            detail: this.summarizeSource(path, content),
          });
          excerpts.push({ path, excerpt: content.slice(0, SOURCE_EXCERPT_CHARS) });
        }
      }

      // Delegating to an agent is a Suggest-level act (L1): it spends a
      // provider call and produces a recommendation.
      const readEvidence = evidence.filter((item) => item.kind === "source" && !item.detail.startsWith("unreadable"));
      if (!agent) {
        agentSkippedReason = "no executive agent available in this runtime";
      } else if (!autonomy.can(LEVEL_DELEGATE)) {
        agentSkippedReason = `autonomy level ${autonomy.getLevel()} is below Suggest (L${LEVEL_DELEGATE}) — reasoning from source only`;
      } else if (readEvidence.length === 0) {
        agentSkippedReason = "no source was readable — nothing to reason about";
      } else {
        const objectiveText = this.buildAgentObjective(objectiveGap, readEvidence, excerpts);
        const result = await AgentRunner.getInstance().run(agent.id, objectiveText, undefined, taskId);
        // `ok` only means the runner did not throw. When every provider
        // in the chain fails, AIService still resolves — with the error
        // text as the message body and "error" as the provider. Taking
        // that at face value stored "indexedDB is not defined" in the
        // KnowledgeLibrary as a durable fact about her architecture.
        // A failed provider call is an absence of evidence, not evidence.
        const response = result.ok ? result.response : undefined;
        if (response && response.provider !== "error" && response.provider !== "offline") {
          evidence.push({
            kind: "agent",
            label: `${agent.name} (${response.provider})`,
            detail: response.text.slice(0, 1200),
          });
        } else if (response) {
          agentSkippedReason = `${agent.name} reached no provider (${response.provider}): ${response.text.slice(0, 120)}`;
        } else {
          agentSkippedReason = result.error ?? "agent run failed";
        }
      }
      this.working.evidenceCount = evidence.length;

      /* -------------------- EVALUATE -------------------- */
      reached = this.enterPhase("evaluate", taskId);
      const knowledge = KnowledgeLibrary.getInstance();
      const priorEntries = knowledge.search(objectiveGap.subsystem);
      if (priorEntries.length > 0) {
        evidence.push({
          kind: "memory",
          label: "prior knowledge",
          detail: `${priorEntries.length} existing entry(ies) about ${objectiveGap.subsystem}`,
        });
      }
      contradiction = this.detectContradiction(objectiveGap, evidence, priorEntries);

      /* -------------------- LEARN -------------------- */
      reached = this.enterPhase("learn", taskId);
      conclusion = this.formConclusion(objectiveGap, evidence, agentSkippedReason);

      /* -------------------- CONSOLIDATE -------------------- */
      reached = this.enterPhase("consolidate", taskId);
      const durable = this.isDurable(evidence);
      if (durable) {
        knowledge.add({
          domain: "selfdev",
          title: `Self-study: ${objectiveGap.subsystem}`,
          detail: conclusion,
          // "tested" would claim she ran it. She read it and reasoned
          // about it, which is "learned" — the honest status.
          status: "learned",
          source: agentName ? `SelfStudy + ${agentName}` : "SelfStudy (source reading)",
        });
        memoryWrites.push(`KnowledgeLibrary/selfdev: ${objectiveGap.subsystem}`);

        const selfModel = SelfModel.getInstance();
        selfModel.recordDiscovery(`${objectiveGap.subsystem}: ${conclusion.slice(0, 180)}`);
        memoryWrites.push("SelfModel/discoveries");
        events.emit({ type: "memory_update", taskId, category: "selfdev" });

        objectiveGap.status = "resolved";
      } else if (objectiveGap.attempts >= MAX_GAP_ATTEMPTS) {
        // A question she has failed to answer three times is recorded
        // as a limitation rather than retried forever.
        objectiveGap.status = "failed";
        SelfModel.getInstance().addUnfinished(
          `Could not establish self-knowledge of ${objectiveGap.subsystem} after ${objectiveGap.attempts} attempts.`,
        );
        memoryWrites.push("SelfModel/unfinished");
      }

      if (contradiction) {
        SelfModel.getInstance().addHypothesis(
          `Contradiction about ${objectiveGap.subsystem}: ${contradiction.slice(0, 180)}`,
        );
        memoryWrites.push("SelfModel/hypotheses");
      }

      proposal = this.deriveProposal(objectiveGap, subsystem);
      if (proposal) {
        this.proposals = [proposal, ...this.proposals].slice(0, 20);
      }

      /* -------------------- REASSESS -------------------- */
      reached = this.enterPhase("reassess", taskId);
      this.refreshGaps(subsystems);
      nextObjective = this.selectObjective()?.question ?? null;

      events.emit({ type: "task_completed", taskId, label: `Self-study: ${objectiveGap.subsystem}` });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      events.emit({ type: "task_failed", taskId, label: `Self-study cycle ${this.cycle}`, error });
    } finally {
      this.running = false;
      this.working = {
        phase: "idle",
        objective: null,
        subsystem: null,
        agent: null,
        evidenceCount: 0,
        startedAt: null,
      };
    }

    return this.finish({
      cycle: this.cycle,
      startedAt,
      reachedPhase: reached,
      ok: error === null,
      error,
      missionSummary: ProjectMission.getInstance().get().northStar.slice(0, 160),
      autonomyLevel: autonomy.getLevel(),
      gapsOpen: this.openGaps().length,
      objective: objectiveGap?.question ?? null,
      gapId: objectiveGap?.id ?? null,
      subsystem: objectiveGap?.subsystem ?? null,
      missionReasons: objectiveGap?.missionReasons ?? [],
      filesPlanned,
      agent: agentName,
      agentSkippedReason,
      evidence,
      conclusion,
      contradiction,
      memoryWrites,
      proposal,
      nextObjective,
    });
  }

  /* ==================================================================== */
  /* PHASES                                                               */
  /* ==================================================================== */

  private enterPhase(phase: SelfStudyPhase, taskId: string): SelfStudyPhase {
    this.working.phase = phase;
    AgentEventBus.getInstance().emit({
      type: "cognitive_sync",
      taskId,
      source: "SelfStudy",
      detail: phase,
    });
    return phase;
  }

  /**
   * Derive gaps from the REAL architecture map against what the
   * KnowledgeLibrary actually holds.
   *
   * A subsystem is a gap when no `selfdev` entry names it with a
   * trustworthy status. This is why the gaps are hers rather than
   * seeded: they are computed from the difference between the system
   * that exists and the knowledge she has verified about it.
   */
  private refreshGaps(subsystems: ArchitectureSubsystem[]): void {
    const knowledge = KnowledgeLibrary.getInstance();
    const mission = ProjectMission.getInstance();
    const selfEntries = knowledge.listByDomain("selfdev");

    for (const subsystem of subsystems) {
      const existing = this.gaps.get(subsystem.id);
      if (existing && existing.status === "failed") continue;

      const understood = selfEntries.some(
        (entry) =>
          (entry.status === "learned" || entry.status === "verified" || entry.status === "tested") &&
          (entry.title.toLowerCase().includes(subsystem.name.toLowerCase()) ||
            entry.detail.toLowerCase().includes(subsystem.name.toLowerCase())),
      );

      if (understood) {
        if (existing) existing.status = "resolved";
        continue;
      }

      // Mission relevance is computed over the subsystem's name,
      // description AND its file paths, so a match can come from what
      // it is called or from where it lives.
      const relevance = mission.relevanceOf(
        `${subsystem.name} ${subsystem.description} ${subsystem.id} ${subsystem.files.join(" ")}`,
      );
      // A subsystem that is not fully working is more urgent than one
      // that is — "repair before extend" made numeric.
      const statusBoost = subsystem.status === "working" ? 0 : 2;

      if (existing) {
        existing.priority = relevance.score + statusBoost;
        existing.missionReasons = relevance.reasons;
        existing.status = "open";
        continue;
      }

      this.gaps.set(subsystem.id, {
        id: subsystem.id,
        subsystem: subsystem.name,
        subsystemId: subsystem.id,
        question: `How does ${subsystem.name} actually work, and is it whole?`,
        reason:
          `No verified self-knowledge exists for this subsystem (status: ${subsystem.status}, ` +
          `${subsystem.files.length} source file(s)).`,
        priority: relevance.score + statusBoost,
        missionReasons: relevance.reasons,
        attempts: 0,
        lastAttemptAt: null,
        status: "open",
      });
    }
  }

  private openGaps(): SelfKnowledgeGap[] {
    return [...this.gaps.values()].filter((gap) => gap.status === "open");
  }

  /**
   * The highest mission-weighted open gap, preferring the one tried
   * least. Without the attempt tie-break a gap that keeps failing
   * would monopolise every cycle and she would never study anything
   * else — the loop would look busy while learning nothing.
   */
  private selectObjective(): SelfKnowledgeGap | null {
    const open = this.openGaps().filter((gap) => gap.attempts < MAX_GAP_ATTEMPTS);
    if (open.length === 0) return null;
    return open.sort((a, b) => a.attempts - b.attempts || b.priority - a.priority)[0];
  }

  /** Which executive agent suits this subsystem's question. */
  private intentFor(
    subsystem: ArchitectureSubsystem | undefined,
  ): keyof typeof EXECUTIVE_AGENT_FOR_INTENT {
    if (!subsystem) return "explore";
    // A subsystem that is not working is a risk question; a foundation
    // is a feasibility question; anything load-bearing for others is a
    // routing question. The mapping is deliberately mechanical.
    if (subsystem.status === "partial" || subsystem.status === "provider-dependent") return "risk";
    if (subsystem.status === "foundation") return "feasibility";
    if (subsystem.dependsOn.length > 2) return "route";
    return "explore";
  }

  /** Real source, compressed to what is worth reasoning about. */
  private summarizeSource(path: string, content: string): string {
    const lines = content.split("\n");
    const exports = lines.filter((line) => /^\s*(export|public|private)\s/.test(line)).length;
    const todos = lines.filter((line) => /TODO|FIXME|HACK/.test(line)).length;
    return `${lines.length} lines, ${exports} declarations${todos > 0 ? `, ${todos} TODO/FIXME` : ""} — ${path}`;
  }

  private buildAgentObjective(
    gap: SelfKnowledgeGap,
    sourceEvidence: SelfStudyEvidence[],
    excerpts: Array<{ path: string; excerpt: string }>,
  ): string {
    const mission = ProjectMission.getInstance();
    return [
      mission.briefing(),
      "",
      `SELF-STUDY QUESTION: ${gap.question}`,
      `WHY IT MATTERS: ${gap.missionReasons.join("; ") || "general architectural understanding"}`,
      `SOURCE FILES INSPECTED: ${excerpts.map((item) => item.path).join(", ") || "none"}`,
      "OBSERVED:",
      ...sourceEvidence.map((item) => `- ${item.detail}`),
      "",
      "ACTUAL SOURCE:",
      ...excerpts.map((item) => `--- ${item.path} ---\n${item.excerpt}`),
      "",
      "Answer in three parts: (1) what this subsystem does, (2) what is incomplete or uncertain about it,",
      "(3) the single most valuable thing to investigate next. Distinguish what the evidence shows from",
      "what you are inferring. Do not propose writing code — this is a study pass.",
    ].join("\n");
  }

  /**
   * A contradiction is new evidence that disagrees with a stored
   * belief. Detected structurally rather than by asking a model to
   * introspect: if she previously recorded a subsystem as unavailable
   * or missing and now reads real, substantial source for it, those
   * two things cannot both be true.
   */
  private detectContradiction(
    gap: SelfKnowledgeGap,
    evidence: SelfStudyEvidence[],
    prior: ReturnType<KnowledgeLibrary["search"]>,
  ): string | null {
    const readReal = evidence.some(
      (item) => item.kind === "source" && !item.detail.startsWith("unreadable"),
    );
    if (!readReal) return null;

    const claimedMissing = prior.find((entry) =>
      /\b(missing|unavailable|not implemented|does not exist|stub)\b/i.test(entry.detail),
    );
    if (claimedMissing) {
      return `Stored knowledge says ${gap.subsystem} is missing or unimplemented ("${claimedMissing.detail.slice(0, 90)}"), but real source was just read for it.`;
    }

    const selfModel = SelfModel.getInstance().get();
    const claimedUnavailable = selfModel.unavailable.find((item) =>
      item.toLowerCase().includes(gap.subsystem.toLowerCase()),
    );
    if (claimedUnavailable) {
      return `Self-model lists "${claimedUnavailable}" as unavailable, but ${gap.subsystem} has readable source.`;
    }
    return null;
  }

  private formConclusion(
    gap: SelfKnowledgeGap,
    evidence: SelfStudyEvidence[],
    agentSkippedReason: string | null,
  ): string {
    const agentFinding = evidence.find((item) => item.kind === "agent");
    if (agentFinding) {
      return agentFinding.detail;
    }
    const sources = evidence.filter(
      (item) => item.kind === "source" && !item.detail.startsWith("unreadable"),
    );
    if (sources.length > 0) {
      // Honest downgrade: source was read but nothing reasoned over it.
      return (
        `Read ${sources.length} source file(s) for ${gap.subsystem}: ${sources.map((item) => item.detail).join("; ")}.` +
        (agentSkippedReason ? ` No agent analysis (${agentSkippedReason}).` : "")
      );
    }
    return `No evidence could be gathered for ${gap.subsystem}${agentSkippedReason ? ` (${agentSkippedReason})` : ""}.`;
  }

  /** Durable knowledge means real evidence, not an empty pass. */
  private isDurable(evidence: SelfStudyEvidence[]): boolean {
    return evidence.some(
      (item) =>
        (item.kind === "source" && !item.detail.startsWith("unreadable")) || item.kind === "agent",
    );
  }

  /**
   * Turn a finding into a proposal when the subsystem is not whole.
   * This is where cognition STOPS and authorization begins: the
   * proposal is recorded and surfaced, never executed.
   */
  private deriveProposal(
    gap: SelfKnowledgeGap,
    subsystem: ArchitectureSubsystem | undefined,
  ): SelfStudyProposal | null {
    if (!subsystem || subsystem.status === "working") return null;
    return {
      id: `${gap.id}-${Date.now()}`,
      objective: gap.question,
      proposal: `${subsystem.name} is "${subsystem.status}". Investigate completing it — ${subsystem.description}`,
      // Modifying production code is L5 in the gate's own scale.
      requiresLevel: 5,
      createdAt: Date.now(),
    };
  }

  /* ==================================================================== */

  private finish(input: Omit<SelfStudyCycleRecord, "finishedAt">): SelfStudyCycleRecord {
    const record: SelfStudyCycleRecord = { ...input, finishedAt: Date.now() };
    this.history = [...this.history, record].slice(-50);
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // a broken listener must never stop cognition
      }
    }
    return record;
  }

  private emptyRecord(reached: SelfStudyPhase, note: string): SelfStudyCycleRecord {
    const now = Date.now();
    return {
      cycle: this.cycle,
      startedAt: now,
      finishedAt: now,
      reachedPhase: reached,
      ok: false,
      error: note,
      missionSummary: "",
      autonomyLevel: AutonomyGate.getInstance().getLevel(),
      gapsOpen: this.openGaps().length,
      objective: null,
      gapId: null,
      subsystem: null,
      missionReasons: [],
      filesPlanned: [],
      agent: null,
      agentSkippedReason: note,
      evidence: [],
      conclusion: null,
      contradiction: null,
      memoryWrites: [],
      proposal: null,
      nextObjective: null,
    };
  }
}
