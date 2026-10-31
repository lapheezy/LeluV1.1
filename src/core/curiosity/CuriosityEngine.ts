/**
 * ==========================================================
 * LÉLU — CURIOSITY ENGINE
 *
 * A capability of LÉLU CORE, not a second brain. It decides
 * what is worth wondering about and how to find out, and then
 * uses the systems that already exist to do it (see
 * CuriosityPorts). Its judgement lives in Curiosity.ts as pure
 * functions; this file sequences them and records the result.
 *
 *   NOTICE → QUESTION → ASSESS → RETRIEVE / INVESTIGATE / ASK
 *     → EVIDENCE → VERIFY → LEARN → REMEMBER → APPLY
 *     → REFLECT → DEVELOP → (bounded) NEXT QUESTION
 *
 * Bounds that always hold:
 *   • one curiosity pursued per tick, never during a user turn
 *   • per pursuit: maxToolSteps, an overall deadline, a per-step
 *     deadline, a depth limit on follow-up chains
 *   • every tool goes through the dispatcher's own permission
 *     check, AND curiosity's narrower policy (READ/ANALYZE and
 *     read-only research only; everything else is a proposal)
 *   • nothing is "learned" unless memory accepted it and a
 *     recall immediately afterwards returns it
 *   • personality receives one evidence item per curiosity, and
 *     PersonalityGuard still decides any status change
 * ==========================================================
 */

import {
  classifyAction,
  classifyAnswer,
  classifyFailure,
  constraintFromDiagnosis,
  contentWords,
  curiosityKey,
  curiosityPermission,
  DAY_MS,
  DEFAULT_BUDGET,
  deriveFollowUps,
  describeCause,
  discoverAlternatives,
  capabilityStates,
  causeConsistentWithRegistry,
  distinctSources,
  failureKind,
  HYPOTHESIS_CAUSES,
  isGroundedQuote,
  parseModelJson,
  relevantByRule,
  REVISIT_MIN_INTERVAL_MS,
  revalidationPolicyFor,
  revalidationTrigger,
  tendencyBoost,
  toolFingerprint,
  VERIFY_PROBES,
  detectConversationAmbiguity,
  detectOwnFailurePatterns,
  detectRepeatedFailures,
  detectUnconnectedCapabilities,
  dominantCause,
  formulateHostQuestion,
  hostQuestionCheck,
  isRecordedClarification,
  MAX_ATTEMPTS,
  memoryAnswers,
  NEAR_DUPLICATE,
  nextStep,
  parseRecall,
  QUEUE_THRESHOLD,
  recallQuery,
  scorePriority,
  selectTools,
  similarity,
  tierFor,
  trivialityReason,
  ttlFor,
  verifyEvidence,
  type CatalogTool,
  type Curiosity,
  type CuriosityBudget,
  type CuriosityEvidence,
  type CuriosityLearning,
  type CuriositySignal,
  type CuriosityStatus,
  type CapabilityStateRow,
  type LearnedStrategy,
  type ObservedFailure,
  type ReevaluationTrigger,
  type FailureCause,
  type ToolCandidate,
  type ToolIntent,
} from "./Curiosity";
import CuriosityLedger, { isTerminal } from "./CuriosityLedger";
import { createDefaultPorts, SELF_MODEL_PREFIX, type CuriosityPorts, type DispatchResult } from "./CuriosityPorts";

const TASK_PREFIX = "curiosity-";
const HOST_KEY_PREFIX = "curiosity:";
const MAX_FAILURE_WINDOW = 50;
const RETRY_BACKOFF_MS = 30 * 60 * 1000;

export interface NoticeResult {
  curiosity: Curiosity | null;
  merged: boolean;
  reason?: string;
}

export interface CuriosityTickReport {
  ran: boolean;
  reason?: string;
  noticed: string[];
  expired: number;
  pursued?: { id: string; question: string; status: CuriosityStatus; verdict?: string };
  revisited?: { id: string; question: string; trigger: ReevaluationTrigger; outcome: string };
}

export interface CuriosityExplanation {
  detected: string;
  question: string;
  why: string;
  potentialAction: string;
  tools: string[];
  permissions: string[];
  evidence: string[];
  confidence: string;
  learning: string;
  applied: string[];
  status: CuriosityStatus;
  route: string;
  personalityImpact: string;
  reevaluations: string[];
}

async function deadline<T>(work: Promise<T>, fallback: T, ms: number): Promise<T> {
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

const INTERNAL_TOOL: Record<string, CatalogTool> = {
  "internal:tool-registry": { id: "internal:tool-registry", available: true, riskLevel: 0, permissions: ["READ"], executable: true },
  "internal:curiosity-ledger": { id: "internal:curiosity-ledger", available: true, riskLevel: 0, permissions: ["READ"], executable: true },
};

export default class CuriosityEngine {
  private static instance: CuriosityEngine | null = null;

  private readonly ledger = CuriosityLedger.getInstance();
  private ports: CuriosityPorts;
  private failures: ObservedFailure[] = [];
  private detachers: Array<() => void> = [];
  private busy = false;
  private budget: CuriosityBudget = { ...DEFAULT_BUDGET };
  private enabled = true;
  private autoInvestigate = true;
  private capabilityScanIntervalMs = DAY_MS;
  /** How often, at most, the environment is re-probed while a learned constraint is in force. */
  private environmentCheckIntervalMs = 10 * 60 * 1000;
  private lastEnvironmentCheck = 0;
  private successes: Array<{ tool: string; taskId: string; at: number }> = [];
  /** Tools a later investigation wanted but a constraint excluded — the finding is relevant again. */
  private wanted = new Map<string, number>();
  private revisitRequests = new Set<string>();
  private discoveryNoted = new Set<string>();
  /** Model calls are a budget, not a habit: at most this many per tick. */
  private maxModelCallsPerTick = 2;
  private modelCalls = 0;
  /** Recent requests the rules found nothing in, for one background model look each. */
  private conversationBuffer: Array<{ text: string; conversationId?: string; at: number; analysed: boolean }> = [];
  private codeFingerprints = new Map<string, string>();
  /** How model assistance has actually been used — every proposal is validated, and rejections are counted. */
  private modelUsage = { calls: 0, accepted: 0, rejected: 0, unavailable: 0 };

  private constructor(ports?: CuriosityPorts) {
    this.ports = ports ?? createDefaultPorts();
  }

  public static getInstance(): CuriosityEngine {
    if (!CuriosityEngine.instance) CuriosityEngine.instance = new CuriosityEngine();
    return CuriosityEngine.instance;
  }

  /** Test seam: a fresh engine, optionally on injected ports, over a fresh ledger. */
  public static reset(ports?: CuriosityPorts): CuriosityEngine {
    CuriosityEngine.instance?.detach();
    CuriosityLedger.reset();
    CuriosityEngine.instance = new CuriosityEngine(ports);
    return CuriosityEngine.instance;
  }

  public configure(options: { enabled?: boolean; autoInvestigate?: boolean; budget?: Partial<CuriosityBudget>; capabilityScanIntervalMs?: number; environmentCheckIntervalMs?: number; maxModelCallsPerTick?: number }): void {
    if (options.environmentCheckIntervalMs !== undefined) this.environmentCheckIntervalMs = options.environmentCheckIntervalMs;
    if (options.maxModelCallsPerTick !== undefined) this.maxModelCallsPerTick = options.maxModelCallsPerTick;
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.autoInvestigate !== undefined) this.autoInvestigate = options.autoInvestigate;
    if (options.budget) this.budget = { ...this.budget, ...options.budget };
    if (options.capabilityScanIntervalMs !== undefined) this.capabilityScanIntervalMs = options.capabilityScanIntervalMs;
  }

  public getLedger(): CuriosityLedger {
    return this.ledger;
  }

  /* ----------------------------- observers ----------------------------- */

  /** Idempotent. Listens to the existing event bus and question channel. */
  public attachObservers(): void {
    if (this.detachers.length > 0) return;
    try {
      this.detachers.push(
        this.ports.onToolFailure((failure) => {
          // Her own investigations are judged from her own records, not
          // fed back in as fresh observations — that would be a loop.
          if (failure.taskId.startsWith(TASK_PREFIX)) return;
          this.failures = [...this.failures, failure].slice(-MAX_FAILURE_WINDOW);
        }),
      );
      if (this.ports.onToolSuccess) {
        this.detachers.push(
          this.ports.onToolSuccess((success) => {
            if (success.taskId.startsWith(TASK_PREFIX)) return;
            this.successes = [...this.successes, success].slice(-MAX_FAILURE_WINDOW);
          }),
        );
      }
      this.detachers.push(
        this.ports.onHostChange((change) => {
          if (!change.key.startsWith(HOST_KEY_PREFIX)) return;
          const curiosity = this.ledger.list().find((item) => item.hostQuestion?.key === change.key && item.status === "asking");
          if (!curiosity) return;
          if (change.status === "resolved" && change.response) {
            void this.receiveHostAnswer(curiosity.id, change.response);
          } else if (change.status === "dismissed") {
            this.transition(curiosity.id, "dismissed", "Heru dismissed the question.");
          } else if (change.lifecycleState === "parked") {
            this.transition(curiosity.id, "blocked", "Heru hasn't engaged with the question; it is parked until the situation changes.", {
              blockedReason: "question parked by the proactive lifecycle",
            });
          }
        }),
      );
    } catch {
      // Observers are best-effort: curiosity must never break the bus or the chat.
    }
  }

  public detach(): void {
    for (const detach of this.detachers) {
      try {
        detach();
      } catch {
        /* contained */
      }
    }
    this.detachers = [];
  }

  /* ------------------------------- NOTICE ------------------------------ */

  /**
   * Turn a signal into a curiosity — or decline to. Trivial signals are
   * not recorded; low-value ones are kept dormant; duplicates are
   * consolidated; a resolved question re-opens only when the situation
   * that raised it has changed.
   */
  public notice(signal: CuriositySignal): NoticeResult {
    const trivial = trivialityReason(signal);
    if (trivial) return { curiosity: null, merged: false, reason: trivial };

    const now = this.ports.now();
    const priority = scorePriority(signal);
    const tier = tierFor(signal);
    const key = curiosityKey(signal.category, signal.question, signal.subject?.tool ?? signal.subject?.phrase);
    const existing = this.ledger.byKey(key) ?? this.ledger.findSimilar(signal.category, signal.question);

    if (existing) {
      const sameSituation = existing.evidenceFingerprint === signal.evidenceFingerprint;
      if ((existing.status === "resolved" || existing.status === "dismissed") && sameSituation) {
        // Meeting the same question again is a reason to ask whether the
        // old answer still holds — when it is the kind that can go stale.
        const learning = existing.learning;
        if (
          existing.status === "resolved" &&
          learning?.revalidation &&
          learning.revalidation !== "stable" &&
          now - Math.max(learning.verifiedAt ?? 0, existing.lastReevaluationAt ?? 0) >= REVISIT_MIN_INTERVAL_MS
        ) {
          this.revisitRequests.add(existing.id);
          return { curiosity: existing, merged: true, reason: "already known — revisit requested" };
        }
        return { curiosity: existing, merged: true, reason: existing.status === "resolved" ? "already known" : "already dismissed" };
      }
      const reopen = isTerminal(existing.status) || (existing.status === "blocked" && !sameSituation);
      const newEvidence = this.evidenceFrom(signal, now).filter(
        (item) => !existing.evidence.some((have) => have.claim === item.claim),
      );
      const newConversation = Boolean(signal.conversationId && !existing.relatedConversationIds.includes(signal.conversationId));
      if (!reopen && sameSituation && newEvidence.length === 0 && !newConversation) {
        // The same situation observed again by a later cycle: nothing new to record.
        return { curiosity: existing, merged: true, reason: "already carried" };
      }
      const updated = this.ledger.update(existing.id, {
        occurrences: existing.occurrences + 1,
        priority: Math.max(existing.priority, priority),
        evidence: [...existing.evidence, ...newEvidence],
        evidenceFingerprint: signal.evidenceFingerprint,
        relatedConversationIds: signal.conversationId
          ? [...new Set([...existing.relatedConversationIds, signal.conversationId])]
          : existing.relatedConversationIds,
        ...(reopen
          ? {
              status: priority < QUEUE_THRESHOLD ? "identified" : "queued",
              attempts: 0,
              nextAttemptAt: undefined,
              expiresAt: now + ttlFor(tier),
              trail: [...existing.trail, { at: now, step: "reopened", detail: "The situation behind it changed." }],
            }
          : {
              trail: [...existing.trail, { at: now, step: "consolidated", detail: "Noticed again; merged rather than carried twice." }],
            }),
      });
      return { curiosity: updated ?? existing, merged: true, reason: reopen ? "reopened on new evidence" : "consolidated" };
    }

    const depth = signal.depth ?? 0;
    const id = crypto.randomUUID();
    const curiosity: Curiosity = {
      id,
      key,
      createdAt: now,
      updatedAt: now,
      question: signal.question,
      unknown: signal.unknown,
      context: signal.context,
      category: signal.category,
      source: signal.source,
      importance: signal.importance,
      uncertainty: signal.uncertainty,
      relevance: signal.relevance,
      expectedBenefit: signal.expectedBenefit,
      priority,
      tier,
      status: priority < QUEUE_THRESHOLD ? "identified" : "queued",
      keywords: (signal.keywords?.length ? signal.keywords : contentWords(signal.question)).slice(0, 6),
      subject: signal.subject,
      evidenceFingerprint: signal.evidenceFingerprint,
      occurrences: 1,
      attempts: 0,
      depth,
      rootId: signal.rootId ?? id,
      parentId: signal.parentId,
      relatedMemoryIds: [],
      relatedConversationIds: signal.conversationId ? [signal.conversationId] : [],
      relatedObjectiveIds: signal.objectiveId ? [signal.objectiveId] : [],
      proposedActions: [],
      evidence: this.evidenceFrom(signal, now),
      appliedResult: [],
      trail: [
        {
          at: now,
          step: "noticed",
          detail: `From ${signal.source}; priority ${priority.toFixed(2)}, tier ${tier}${priority < QUEUE_THRESHOLD ? " — dormant" : ""}.`,
        },
      ],
      expiresAt: now + ttlFor(tier),
      hostQuestionPreset: signal.hostQuestion,
    };
    this.ledger.insert(curiosity);
    this.journal("questions", `Curious: ${curiosity.question}`);
    return { curiosity, merged: false };
  }

  private evidenceFrom(signal: CuriositySignal, now: number): CuriosityEvidence[] {
    return (signal.initialEvidence ?? []).map((item) => ({ ...item, id: crypto.randomUUID(), at: now }));
  }

  /** Called on every genuine user message. Cheap, synchronous, contained. */
  public observeConversation(message: string, conversationId?: string): NoticeResult | null {
    if (!this.enabled) return null;
    this.attachObservers();
    const signal = detectConversationAmbiguity(message);
    if (!signal) {
      // Nothing the rules recognise. Kept (bounded) for ONE background
      // model look at the next idle tick — never on Heru's response path.
      const text = message.trim();
      if (text.length >= 30 && text.length <= 800) {
        this.conversationBuffer = [...this.conversationBuffer, { text, conversationId, at: this.ports.now(), analysed: false }].slice(-5);
      }
      return null;
    }
    return this.notice({ ...signal, conversationId });
  }

  /* -------------------------------- TICK ------------------------------- */

  /**
   * One bounded step of curiosity, at the CognitiveLoop's existing
   * lifecycle point. Detect from what has been observed, then pursue at
   * most ONE curiosity. Heru's turn always comes first.
   */
  public async tick(budget: CuriosityBudget = this.budget): Promise<CuriosityTickReport> {
    const report: CuriosityTickReport = { ran: false, noticed: [], expired: 0 };
    if (!this.enabled) return { ...report, reason: "curiosity is switched off" };
    if (this.busy) return { ...report, reason: "a curiosity is already being pursued" };
    this.busy = true;
    this.modelCalls = 0;
    try {
      await this.ports.prepare();
      this.attachObservers();
      if (this.ports.userTurnActive()) return { ...report, reason: "a user turn is active — Heru's conversation takes priority" };

      const now = this.ports.now();
      report.expired = this.ledger.expire(now).length;
      this.reaffirmQuestions();

      const signals: CuriositySignal[] = [
        ...detectRepeatedFailures(this.failures, undefined, now),
        ...detectOwnFailurePatterns(this.ledger.list(), now),
      ];
      if (now - this.ledger.lastCapabilityScanAt() >= this.capabilityScanIntervalMs) {
        this.ledger.markCapabilityScan(now);
        const gap = detectUnconnectedCapabilities(this.ports.catalog());
        if (gap) signals.push(gap);
      }
      for (const signal of signals) {
        const result = this.notice(signal);
        if (result.curiosity && !result.merged) report.noticed.push(result.curiosity.question);
      }

      // Noticing, not investigating: a bounded background look at what Heru said.
      const ambiguity = await this.analyseConversation(budget);
      if (ambiguity) report.noticed.push(ambiguity);

      if (!this.autoInvestigate) return { ...report, ran: true, reason: "investigation is switched off; only noticing" };

      // Bounded environment check: only while a learned constraint is in
      // force, and at most once per interval.
      const codeDependents = this.ledger
        .list()
        .filter((c) => c.status === "resolved" && c.learning?.dependency?.code && !c.learning.supersededAt)
        .map((c) => c.learning!.dependency!.tool!)
        .filter(Boolean);
      if ((this.ledger.constraints().length > 0 || codeDependents.length > 0) && now - this.lastEnvironmentCheck >= this.environmentCheckIntervalMs) {
        this.lastEnvironmentCheck = now;
        if (this.ports.refreshCapabilities && this.ledger.constraints().length > 0) {
          await deadline(this.ports.refreshCapabilities(), undefined, budget.stepTimeoutMs);
        }
        // Relevant code changes: re-read each finding's implementation.
        if (this.ports.sourceFingerprint) {
          const catalog = this.catalogMap();
          for (const tool of [...new Set(codeDependents)].slice(0, 6)) {
            const code = await deadline(this.ports.sourceFingerprint(tool, catalog.get(tool)?.executionRoute), undefined, budget.stepTimeoutMs);
            if (code) this.codeFingerprints.set(tool, code);
          }
        }
      }


      // ONE action per tick: rank pursuit and re-evaluation together.
      const tendencies = this.ports.traitTendencies?.() ?? [];
      type Action = { kind: "pursue" | "revisit"; c: Curiosity; tier: number; score: number; traits: string[]; trigger?: ReevaluationTrigger };
      const actions: Action[] = [];
      for (const c of this.ledger.pursuable(now)) {
        if ((c.nextAttemptAt ?? 0) > now) continue;
        const { boost, traits } = tendencyBoost(c, tendencies);
        actions.push({ kind: "pursue", c, tier: c.tier, score: c.priority * boost, traits });
      }
      for (const { c, trigger } of this.revalidationCandidates(now)) {
        const urgent = trigger === "environment-changed" || trigger === "new-evidence";
        const { boost, traits } = tendencyBoost({ ...c, status: "revisiting" }, tendencies);
        actions.push({ kind: "revisit", c, tier: urgent ? Math.min(c.tier, 2) : Math.max(c.tier, 6), score: c.priority * (urgent ? 1.2 : 1) * boost, traits, trigger });
      }
      actions.sort((a, b) => a.tier - b.tier || b.score - a.score || a.c.createdAt - b.c.createdAt);
      const next = actions[0];
      if (!next) return { ...report, ran: true, reason: "nothing worth pursuing right now" };
      if (next.traits.length > 0) this.note(next.c.id, "tendency", `Ranked with developing tendency: ${next.traits.join(", ")}.`);

      report.ran = true;
      if (next.kind === "revisit" && next.trigger) {
        const revisited = await this.revisitUnlocked(next.c.id, next.trigger, budget);
        const last = revisited?.reevaluations?.at(-1);
        report.revisited = { id: next.c.id, question: next.c.question, trigger: next.trigger, outcome: last?.outcome ?? "inconclusive" };
        return report;
      }
      const pursued = await this.pursueUnlocked(next.c.id, budget);
      if (pursued) {
        report.pursued = { id: pursued.id, question: pursued.question, status: pursued.status, verdict: pursued.verification?.verdict };
      }
      return report;
    } finally {
      this.busy = false;
    }
  }

  /** A question already put to Heru must stay affirmed across reloads (ProactiveCore re-derivation). */
  private reaffirmQuestions(): void {
    if (!this.ports.hostEnabled()) return;
    for (const curiosity of this.ledger.active()) {
      if (curiosity.status !== "asking" || !curiosity.hostQuestion) continue;
      this.ports.askHost(this.hostInput(curiosity, curiosity.hostQuestion.text));
    }
  }

  /* ------------------------------- PURSUE ------------------------------ */

  public async pursue(id: string, budget: CuriosityBudget = this.budget): Promise<Curiosity | undefined> {
    if (this.busy) return this.ledger.get(id);
    this.busy = true;
    this.modelCalls = 0;
    try {
      await this.ports.prepare();
      this.attachObservers();
      return await this.pursueUnlocked(id, budget);
    } finally {
      this.busy = false;
    }
  }

  private async pursueUnlocked(id: string, budget: CuriosityBudget): Promise<Curiosity | undefined> {
    const start = this.ledger.get(id);
    if (!start || isTerminal(start.status) || start.status === "asking") return start;

    if (start.depth >= budget.maxDepth && !start.continuationGranted) {
      return this.transition(id, "blocked", `Chain depth ${start.depth} reached the limit of ${budget.maxDepth}; paused, awaiting continuation.`, {
        blockedReason: "depth-limit: awaiting continuation",
      });
    }

    const startedAt = this.ports.now();
    const finishBy = startedAt + budget.timeoutMs;
    const attempts = start.attempts + 1;
    this.ledger.update(id, {
      attempts,
      trail: [
        ...start.trail,
        { at: startedAt, step: "assess", detail: `Attempt ${attempts}: importance ${start.importance}, uncertainty ${start.uncertainty}, priority ${start.priority}.` },
      ],
    });

    let memoryTried = false;
    let memoryAnswered = false;
    let hypothesized = false;
    let toolSteps = 0;
    const tried = new Set<string>();
    const blockedRecorded = new Set<string>();

    for (let guard = 0; guard < budget.maxToolSteps + 4; guard += 1) {
      const c = this.ledger.get(id);
      if (!c) return undefined;
      const verification = verifyEvidence(c.evidence);
      const candidates = this.candidatesFor(c);
      const fresh = candidates.filter((candidate) => !tried.has(this.signature(candidate.candidate)));
      const runnable = fresh.filter((candidate) => candidate.permission === "auto" && candidate.permitted);

      for (const blocked of fresh.filter((candidate) => !(candidate.permission === "auto" && candidate.permitted))) {
        const sig = this.signature(blocked.candidate);
        if (blockedRecorded.has(sig)) continue;
        blockedRecorded.add(sig);
        this.recordBlocked(c, blocked);
      }

      // An unexplained failure: once the cheap evidence is in, a bounded
      // model look may propose a cause — used only if the registry agrees.
      if (!hypothesized && memoryTried && runnable.length === 0 && c.subject?.tool && c.subject.cause === "error" && verification.verdict !== "verified") {
        hypothesized = true;
        if (await this.hypothesizeCause(c, budget)) continue;
      }

      const alreadyKnown = this.alreadyKnown(c);
      const asked = this.ledger.list().some((other) => other.id !== c.id && other.hostQuestion && other.key === c.key);
      const host = hostQuestionCheck({
        untriedPermittedTools: runnable.length,
        memoryAnswered,
        alreadyAsked: Boolean(c.hostQuestion) || asked,
        hostChannelOpen: this.ports.hostEnabled(),
        hostBusy: this.ports.hostBusy(`${HOST_KEY_PREFIX}${c.key}`),
        importance: c.importance,
        tier: c.tier,
      });
      const needsHost =
        c.category === "host" ||
        verification.verdict === "conflict" ||
        (c.importance >= 0.7 && memoryTried && runnable.length === 0 && verification.verdict !== "verified");

      const step = nextStep({
        alreadyKnown,
        memoryTried,
        verdict: verification.verdict,
        untriedTools: runnable.length,
        toolStepsLeft: budget.maxToolSteps - toolSteps,
        timedOut: this.ports.now() >= finishBy,
        needsHost,
        hostAsk: host.ask,
        attempts,
        importance: c.importance,
      });

      switch (step) {
        case "stop-known":
          return this.transition(id, "resolved", "Already known from an earlier resolved curiosity — stopped.", {
            resolvedAt: this.ports.now(),
          });

        case "retrieve": {
          memoryTried = true;
          memoryAnswered = await this.retrieve(c, budget);
          continue;
        }

        case "investigate": {
          const choice = runnable[0];
          tried.add(this.signature(choice.candidate));
          toolSteps += 1;
          this.transition(id, "investigating", `Using ${choice.candidate.tool}: ${choice.candidate.reason}`);
          await this.investigate(c, choice, budget);
          this.transition(id, "verifying", verifyEvidence(this.ledger.get(id)?.evidence ?? []).note);
          continue;
        }

        case "learn":
          return this.learnApplyReflect(id, verification, budget);

        case "ask":
          this.ledger.update(id, { verification });
          return this.ask(this.ledger.get(id) ?? c);

        case "dismiss":
          return this.transition(id, "dismissed", `After ${attempts} attempt(s) there is still not enough evidence, and it is not important enough to keep carrying.`, {
            verification,
          });

        case "defer":
        default: {
          const permissionBlocked =
            candidates.length > 0 && candidates.every((candidate) => !(candidate.permission === "auto" && candidate.permitted));
          if (attempts >= MAX_ATTEMPTS || (permissionBlocked && !needsHost)) {
            const reason = permissionBlocked
              ? `Every tool that could answer this needs a permission curiosity does not have (${candidates.map((x) => x.candidate.tool).join(", ")}).`
              : `Not enough evidence after ${attempts} attempt(s); waiting for new evidence or for Heru.`;
            return this.transition(id, "blocked", reason, { verification, blockedReason: reason });
          }
          const why = !host.ask && needsHost ? `Would ask Heru, but: ${host.reasons.join("; ")}.` : verification.note;
          return this.transition(id, "queued", `Deferred: ${why}`, {
            verification,
            nextAttemptAt: this.ports.now() + RETRY_BACKOFF_MS * attempts,
          });
        }
      }
    }
    return this.transition(id, "queued", "Step guard reached; deferred.", {
      nextAttemptAt: this.ports.now() + RETRY_BACKOFF_MS * attempts,
    });
  }

  private signature(candidate: ToolCandidate): string {
    return `${candidate.tool}:${JSON.stringify(candidate.args)}`;
  }

  private alreadyKnown(c: Curiosity): boolean {
    return this.ledger
      .list()
      .some(
        (other) =>
          other.id !== c.id &&
          other.status === "resolved" &&
          other.category === c.category &&
          Boolean(other.learning?.retrievable || other.learning?.fromExistingMemory) &&
          (other.key === c.key || similarity(other.question, c.question) >= NEAR_DUPLICATE),
      );
  }

  private catalogMap(): Map<string, CatalogTool> {
    return new Map([...this.ports.catalog().map((tool) => [tool.id, tool] as const), ...Object.entries(INTERNAL_TOOL)]);
  }

  private candidatesFor(c: Curiosity): Array<{ candidate: ToolCandidate; tool: CatalogTool; permission: ReturnType<typeof curiosityPermission>; permitted: boolean }> {
    const catalog = this.catalogMap();
    const constraints = this.ledger.constraints();
    const base = selectTools(c, [...catalog.values()], constraints, true);
    const sig = (candidate: { tool: string; args: Record<string, unknown> }) => `${candidate.tool}:${JSON.stringify(candidate.args)}`;
    const kept = new Set(base.map(sig));

    // The capabilities this curiosity cannot use as it stands. Permission
    // refusals are deliberately NOT here: an alternative must never be a
    // way around a "no" — that goes to Heru as a proposal instead.
    const blocked: Array<{ tool: string; args: Record<string, unknown>; why: string }> = [];
    for (const candidate of selectTools(c, [...catalog.values()], [], true)) {
      if (candidate.tool.startsWith("internal:")) continue;
      const rule = constraints.find((item) => item.tool === candidate.tool);
      if (!kept.has(sig(candidate)) && rule && failureKind(rule.cause) !== "permission") {
        this.wanted.set(candidate.tool, this.ports.now());
        blocked.push({ tool: candidate.tool, args: candidate.args, why: `known not to work here: ${rule.reason}` });
      } else if (kept.has(sig(candidate)) && catalog.get(candidate.tool) && !catalog.get(candidate.tool)!.available) {
        blocked.push({ tool: candidate.tool, args: candidate.args, why: "not available in this runtime" });
      }
    }
    for (const intent of c.proposedActions) {
      const kind = failureKind(intent.cause);
      if (intent.outcome === "failed" && !intent.alternativeFor && (kind === "availability" || kind === "environment") && !blocked.some((item) => item.tool === intent.tool)) {
        blocked.push({ tool: intent.tool, args: intent.args, why: `it just failed (${intent.cause})` });
      }
    }
    if (c.subject?.alternativeFor) blocked.push({ tool: c.subject.alternativeFor, args: {}, why: "this question asks what can stand in for it" });

    const alternatives: ToolCandidate[] = [];
    for (const need of blocked) {
      const preferred = catalog.get(need.tool);
      if (!preferred) continue;
      const found = discoverAlternatives({
        preferred,
        args: need.args,
        catalog: [...catalog.values()],
        permitted: (id) => this.ports.permitted(id),
        constraints,
        background: true,
        strategies: this.ledger.strategies(),
        parameters: (id) => this.ports.toolParameters?.(id),
        reliability: (id) => this.reliability(id),
      });
      const noteKey = `${c.id}:${need.tool}`;
      if (!this.discoveryNoted.has(noteKey)) {
        this.discoveryNoted.add(noteKey);
        const rejected = found.rejected.map((item) => `${item.tool} (${item.reason})`).join("; ");
        this.note(
          c.id,
          "discovery",
          found.options.length > 0
            ? `${need.tool} cannot be used (${need.why}). Compared ${found.options.length + found.rejected.length} existing capabilities; chose ${found.options[0].tool} — ${found.options[0].why}.${rejected ? ` Rejected: ${rejected}.` : ""}`
            : `${need.tool} cannot be used (${need.why}), and no existing authorized capability provides the same thing.${rejected ? ` Considered: ${rejected}.` : ""}`,
        );
      }
      const best = found.options[0];
      if (!best) continue;
      alternatives.push({
        tool: best.tool,
        args: best.args,
        objective: c.question,
        reason: `Capability discovery: ${need.tool} cannot be used (${need.why}); ${best.tool} can stand in — ${best.why}.`,
        expectedEvidence: `what ${need.tool} would have provided`,
        alternativeFor: need.tool,
        coverage: best.coverage,
        missingInputs: best.missingInputs,
      });
    }
    const all = [...base];
    for (const alternative of alternatives) if (!all.some((item) => sig(item) === sig(alternative))) all.push(alternative);
    return all
      .map((candidate) => {
        const tool = catalog.get(candidate.tool);
        if (!tool) return null;
        const internal = candidate.tool.startsWith("internal:");
        return {
          candidate,
          tool,
          permission: curiosityPermission(tool),
          permitted: internal ? true : this.ports.permitted(candidate.tool),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  private recordBlocked(
    c: Curiosity,
    blocked: { candidate: ToolCandidate; tool: CatalogTool; permission: ReturnType<typeof curiosityPermission>; permitted: boolean },
  ): void {
    const reason =
      blocked.permission === "never"
        ? "Curiosity may never invoke this tool; it changes the real project."
        : blocked.permission === "proposal"
          ? `A ${classifyAction(blocked.tool)} action needs a proposal and Heru's approval before curiosity may use it.`
          : !blocked.tool.available
            ? `${blocked.tool.id} is not available in this runtime.`
            : `${blocked.tool.id} is not permitted by the dispatcher at the current autonomy level or authorization.`;
    const intent = this.makeIntent(c, blocked.candidate, blocked.tool, blocked.permission, blocked.permitted);
    intent.outcome = "blocked";
    intent.blockedReason = reason;
    intent.cause = classifyFailure(reason);
    const now = this.ports.now();
    intent.finishedAt = now;
    const current = this.ledger.get(c.id) ?? c;
    this.ledger.update(c.id, {
      proposedActions: [...current.proposedActions, intent],
      trail: [...current.trail, { at: now, step: "permission", detail: `Blocked ${blocked.candidate.tool}: ${reason}` }],
    });
  }

  private makeIntent(
    c: Curiosity,
    candidate: ToolCandidate,
    tool: CatalogTool,
    permission: ReturnType<typeof curiosityPermission>,
    permitted: boolean,
  ): ToolIntent {
    return {
      id: crypto.randomUUID(),
      curiosityId: c.id,
      tool: candidate.tool,
      actionClass: classifyAction(tool),
      objective: candidate.objective,
      reason: candidate.reason,
      expectedEvidence: candidate.expectedEvidence,
      args: candidate.args,
      permission,
      permitted,
      ...(candidate.alternativeFor ? { alternativeFor: candidate.alternativeFor, coverage: candidate.coverage, missingInputs: candidate.missingInputs } : {}),
    };
  }

  /** How her own use of a tool has gone, from her records. */
  private reliability(tool: string): { ok: number; failed: number } {
    let ok = 0;
    let failed = 0;
    for (const c of this.ledger.list()) {
      for (const intent of c.proposedActions) {
        if (intent.tool !== tool) continue;
        if (intent.outcome === "ok") ok += 1;
        else if (intent.outcome === "failed" || intent.outcome === "timeout") failed += 1;
      }
    }
    return { ok, failed };
  }

  /* ------------------------------ RETRIEVE ----------------------------- */

  private async retrieve(c: Curiosity, budget: CuriosityBudget): Promise<boolean> {
    this.transition(c.id, "retrieving", "Checking memory before using any tool or asking Heru.");
    const query = recallQuery([...c.keywords, ...(c.subject?.tool ? [c.subject.tool] : [])]) || c.question;
    const catalog = this.catalogMap();
    const tool = catalog.get("memory.recall");
    if (!tool) {
      this.note(c.id, "retrieve", "memory.recall is not registered; memory could not be consulted.");
      return false;
    }
    const permission = curiosityPermission(tool);
    const permitted = this.ports.permitted("memory.recall");
    const candidate: ToolCandidate = {
      tool: "memory.recall",
      args: { query },
      objective: c.question,
      reason: "Memory first: I should not investigate or ask what I already know.",
      expectedEvidence: "a stored memory that covers this question's key terms",
    };
    if (!(permission === "auto" && permitted)) {
      this.recordBlocked(c, { candidate, tool, permission, permitted });
      return false;
    }
    const { result } = await this.runIntent(c, candidate, tool, permission, permitted, budget);
    const hits = result.ok ? parseRecall(result.content) : [];
    // The statement that RAISED a question cannot answer it. The Brain
    // stores Heru's own message, so without this a curiosity about what
    // he meant would be "answered" by the sentence it was about.
    // For what Heru MEANT, only a recorded clarification counts: a memory
    // restating the request ("Heru wants her more autonomous") is the
    // question again, not its answer.
    const source = c.context.trim().slice(0, 40).toLowerCase();
    // A diagnosis is answered only by a recorded diagnosis OF THAT TOOL — a
    // memory that merely mentions the tool (e.g. in a list of related ones)
    // says nothing about why it fails.
    const diagnosedTool = c.subject?.tool && c.subject.cause ? c.subject.tool : null;
    const answering = hits.filter(
      (hit) =>
        memoryAnswers(c.keywords, hit) &&
        (!diagnosedTool || hit.text.includes(`${diagnosedTool} fails because`) || hit.text.includes(`${diagnosedTool} is usable again`)) &&
        !(source.length >= 20 && hit.text.toLowerCase().includes(source)) &&
        (c.category !== "host" || isRecordedClarification(hit.text)),
    );
    if (answering.length === 0) {
      this.note(c.id, "retrieve", hits.length > 0 ? `${hits.length} memory hit(s), none covering this question.` : "Memory holds nothing on this.");
      return false;
    }
    const current = this.ledger.get(c.id) ?? c;
    const evidence: CuriosityEvidence[] = answering.slice(0, 2).map((hit) => ({
      id: crypto.randomUUID(),
      source: "memory",
      tool: "memory.recall",
      claim: hit.text.slice(0, budget.maxEvidenceChars),
      stance: "supports",
      weight: Math.min(0.75, 0.3 + 0.4 * hit.confidence),
      at: this.ports.now(),
    }));
    this.ledger.update(c.id, { evidence: [...current.evidence, ...evidence] });
    this.note(c.id, "retrieve", `Memory covers it (${answering.length} hit(s)).`);
    return true;
  }

  /* ----------------------------- INVESTIGATE --------------------------- */

  private async investigate(
    c: Curiosity,
    choice: { candidate: ToolCandidate; tool: CatalogTool; permission: ReturnType<typeof curiosityPermission>; permitted: boolean },
    budget: CuriosityBudget,
  ): Promise<void> {
    const { intent, result } = await this.runIntent(c, choice.candidate, choice.tool, choice.permission, choice.permitted, budget);
    const evidence = await this.interpret(this.ledger.get(c.id) ?? c, intent, result, budget);
    const current = this.ledger.get(c.id) ?? c;
    this.ledger.update(c.id, { evidence: [...current.evidence, ...evidence] });
  }

  private async runIntent(
    c: Curiosity,
    candidate: ToolCandidate,
    tool: CatalogTool,
    permission: ReturnType<typeof curiosityPermission>,
    permitted: boolean,
    budget: CuriosityBudget,
  ): Promise<{ intent: ToolIntent; result: DispatchResult & { timedOut?: boolean } }> {
    const intent = this.makeIntent(c, candidate, tool, permission, permitted);
    intent.startedAt = this.ports.now();
    const taskId = `${TASK_PREFIX}${c.id.slice(0, 8)}-${(this.ledger.get(c.id)?.proposedActions.length ?? 0) + 1}`;
    // Research waits on real providers over the network: it gets up to half
    // the tick's whole budget, never more.
    const stepMs = /^research\./.test(tool.id) || /research/i.test(tool.category ?? "") ? Math.max(budget.stepTimeoutMs, Math.floor(budget.timeoutMs / 2)) : budget.stepTimeoutMs;
    const timedOut: DispatchResult & { timedOut?: boolean } = {
      ok: false,
      content: `${candidate.tool} timed out after ${stepMs}ms.`,
      timedOut: true,
    };
    const result: DispatchResult & { timedOut?: boolean } = candidate.tool.startsWith("internal:")
      ? this.internalProbe(c, candidate)
      : await deadline<DispatchResult & { timedOut?: boolean }>(this.ports.dispatch(candidate.tool, candidate.args, taskId), timedOut, stepMs);

    intent.finishedAt = this.ports.now();
    intent.outcome = result.ok ? "ok" : result.timedOut ? "timeout" : "failed";
    intent.resultSummary = result.content.slice(0, budget.maxEvidenceChars);
    if (!result.ok) intent.cause = result.timedOut ? "timeout" : classifyFailure(result.content);

    const current = this.ledger.get(c.id) ?? c;
    this.ledger.update(c.id, {
      proposedActions: [...current.proposedActions, intent],
      trail: [
        ...current.trail,
        { at: intent.finishedAt, step: "tool", detail: `${candidate.tool} → ${intent.outcome}: ${result.content.slice(0, 160)}` },
      ],
    });
    return { intent, result };
  }

  /** Read-only inspection of LÉLU's own in-process state. Never dispatched; no side effects. */
  private internalProbe(c: Curiosity, candidate: ToolCandidate): DispatchResult {
    const catalog = this.catalogMap();
    if (candidate.tool === "internal:tool-registry") {
      if (typeof candidate.args.relatedTo === "string") {
        const subject = catalog.get(candidate.args.relatedTo);
        if (!subject) return { ok: false, content: `No registered capability named ${candidate.args.relatedTo}.` };
        const route = (subject.executionRoute ?? "").split(".")[0];
        const related = [...catalog.values()].filter(
          (tool) =>
            tool.id !== subject.id &&
            !tool.id.startsWith("internal:") &&
            ((route && (tool.executionRoute ?? "").split(".")[0] === route) || (subject.dependency && tool.dependency === subject.dependency)),
        );
        return {
          ok: true,
          content:
            related.length === 0
              ? `No other registered capability shares ${subject.id}'s execution route (${subject.executionRoute ?? "undocumented"}) or dependency.`
              : `Capabilities sharing ${subject.id}'s route/dependency: ${related.map((tool) => `${tool.id} (available=${tool.available})`).join(", ")}.`,
          data: { related: related.map((tool) => tool.id) },
        };
      }
      const ids = Array.isArray(candidate.args.tools) ? candidate.args.tools.map(String) : [];
      const rows = ids.map((id) => {
        const tool = catalog.get(id);
        if (!tool) return { id, known: false };
        return {
          id,
          known: true,
          available: tool.available,
          permitted: this.ports.permitted(id),
          executable: tool.executable,
          route: tool.executionRoute ?? "undocumented",
        };
      });
      return {
        ok: rows.length > 0,
        content: rows
          .map((row) =>
            row.known
              ? `${row.id}: available=${row.available}, permitted=${row.permitted}, executable=${row.executable}, route=${row.route}`
              : `${row.id}: not registered`,
          )
          .join("\n") || "No tools named.",
        data: { rows },
      };
    }
    if (candidate.tool === "internal:curiosity-ledger") {
      const tool = String(candidate.args.tool ?? "");
      const uses = this.ledger
        .list()
        .filter((other) => other.id !== c.id)
        .flatMap((other) => other.proposedActions.filter((intent) => intent.tool === tool).map((intent) => ({ other, intent })));
      if (uses.length === 0) return { ok: false, content: `I have no recorded investigation that used ${tool}.` };
      return {
        ok: true,
        content: uses
          .map(({ other, intent }) => `“${other.question}” → ${intent.outcome}${intent.cause ? ` (${intent.cause})` : ""}: ${intent.resultSummary?.slice(0, 160) ?? ""}`)
          .join("\n"),
        data: { causes: uses.map(({ intent }) => intent.cause ?? null), outcomes: uses.map(({ intent }) => intent.outcome ?? null) },
      };
    }
    return { ok: false, content: `Unknown internal probe ${candidate.tool}.` };
  }

  /**
   * What a result actually says about THIS question. A failed tool is
   * recorded but is never evidence for anything; a result that only
   * describes state supports a diagnosis when it confirms the
   * hypothesised cause, and contradicts it when it rules it out.
   */
  private async interpret(c: Curiosity, intent: ToolIntent, result: DispatchResult, budget: CuriosityBudget): Promise<CuriosityEvidence[]> {
    const now = this.ports.now();
    const make = (claim: string, stance: CuriosityEvidence["stance"], weight: number, source: CuriosityEvidence["source"] = "tool"): CuriosityEvidence => ({
      id: crypto.randomUUID(),
      source,
      tool: intent.tool,
      intentId: intent.id,
      claim: claim.slice(0, budget.maxEvidenceChars),
      stance,
      weight,
      at: now,
    });
    if (!result.ok) return [make(`${intent.tool} could not run: ${result.content}`, "inconclusive", 0)];

    const cause = c.subject?.cause;
    if (intent.tool === "internal:tool-registry") {
      const data = result.data as { rows?: Array<{ id: string; known: boolean; available?: boolean; permitted?: boolean; executable?: boolean }>; related?: string[] } | undefined;
      if (data?.related) return [make(result.content, "supports", 0.6, "internal")];
      if (c.category === "capability" && !cause) {
        const rows = data?.rows ?? [];
        const confirmed = rows.filter((row) => row.known && row.available && !row.executable);
        return [make(result.content, confirmed.length > 0 ? "supports" : "contradicts", 0.6, "internal")];
      }
      const row = data?.rows?.[0];
      if (!row || !cause) return [make(result.content, "inconclusive", 0, "internal")];
      let stance: CuriosityEvidence["stance"] = "inconclusive";
      if (!row.known) stance = cause === "unknown-tool" ? "supports" : "contradicts";
      else if (cause === "unavailable") stance = row.available ? "contradicts" : "supports";
      else if (cause === "not-permitted") stance = row.available && !row.permitted ? "supports" : row.permitted ? "contradicts" : "inconclusive";
      else if (cause === "missing-context") stance = row.available && row.permitted && row.executable ? "supports" : "contradicts";
      return [make(`Registry: ${result.content}`, stance, stance === "supports" ? (cause === "missing-context" ? 0.4 : 0.5) : 0.5, "internal")];
    }
    if (intent.tool === "internal:curiosity-ledger") {
      const data = result.data as { causes?: Array<string | null> } | undefined;
      const causes = (data?.causes ?? []).filter((item): item is NonNullable<typeof item> => Boolean(item)) as Parameters<typeof dominantCause>[0];
      const dominant = dominantCause(causes);
      const stance = dominant && cause && dominant.cause === cause && dominant.count >= 2 ? "supports" : dominant ? "contradicts" : "inconclusive";
      return [make(`My own records: ${result.content}`, stance, 0.5, "internal")];
    }
    if (intent.tool === "system.config") {
      const data = result.data as { configured?: string[]; missing?: Record<string, unknown> } | undefined;
      const missing = Object.keys(data?.missing ?? {});
      if (cause === "not-configured") {
        return [make(`Configuration: missing ${missing.join(", ") || "nothing"}.`, missing.length > 0 ? "supports" : "contradicts", 0.5)];
      }
      return [make(`Configuration: configured ${(data?.configured ?? []).join(", ") || "none"}; missing ${missing.join(", ") || "none"}.`, "inconclusive", 0)];
    }
    // A direct answer from a tool whose job is to state it. Research and
    // stand-ins for a real request are checked for whether they actually
    // answer the question — by the model when one is reachable (its claim
    // must quote the output verbatim), otherwise by rule.
    const needsRelevance = intent.tool === "research.web" || Boolean(intent.alternativeFor && c.subject?.preferred);
    if (!needsRelevance) return [make(result.content, "supports", 0.6)];
    const judged = await this.judgeRelevance(c.question, intent.tool, result.content, budget);
    if (judged.answers === false) return [make(`Does not answer the question (${judged.by}): ${judged.reason}`, "inconclusive", 0)];
    // Research: independent sources corroborate; a single source counts as
    // verified only when it states the answer explicitly (a grounded quote).
    const weight = intent.tool === "research.web" ? (distinctSources(result.data) >= 2 || judged.quote ? 0.6 : 0.45) : 0.6;
    return [make(judged.quote ? `${judged.quote} [grounded quote, judged by ${judged.by}]` : result.content, "supports", weight)];
  }

  /** Does this output answer the question? A model proposal, validated by quote; else a rule. */
  private async judgeRelevance(
    question: string,
    tool: string,
    output: string,
    budget: CuriosityBudget,
  ): Promise<{ answers: boolean; quote?: string; reason: string; by: "model" | "rule" }> {
    if (this.ports.reason && this.modelCalls < this.maxModelCallsPerTick) {
      this.modelCalls += 1;
      const reply = await deadline(
        this.ports.reason(
          [
            `QUESTION: ${question}`,
            `TOOL: ${tool}`,
            "OUTPUT:",
            output.slice(0, 3000),
            "",
            'Reply with JSON only: {"answers": true|false, "quote": "<the exact words from OUTPUT that answer it, or empty>", "reason": "<one short sentence>"}',
          ].join("\n"),
          "You check whether a tool's output answers a question. Use ONLY the output. Never add facts. Reply with JSON only.",
        ),
        null,
        budget.stepTimeoutMs,
      );
      this.modelUsage.calls += 1;
      if (!reply) this.modelUsage.unavailable += 1;
      const json = reply ? parseModelJson(reply) : null;
      if (json && typeof json.answers === "boolean") {
        const reason = typeof json.reason === "string" ? json.reason.slice(0, 200) : "";
        if (json.answers === false) {
          this.modelUsage.accepted += 1;
          return { answers: false, reason: reason || "the model found no answer in the output", by: "model" };
        }
        if (isGroundedQuote(output, json.quote)) {
          this.modelUsage.accepted += 1;
          return { answers: true, quote: String(json.quote).trim(), reason, by: "model" };
        }
        // A claimed answer that does not quote the output is not accepted; fall through to the rule.
      }
      if (reply) this.modelUsage.rejected += 1;
    }
    const answers = relevantByRule(question, output);
    return { answers, reason: answers ? "the output addresses the question's key terms" : "the output does not mention what was asked", by: "rule" };
  }

  /** Propose a cause for an unexplained failure; accept it only if the registry is consistent with it. */
  private async hypothesizeCause(c: Curiosity, budget: CuriosityBudget): Promise<boolean> {
    const tool = c.subject?.tool;
    if (!tool || !this.ports.reason || this.modelCalls >= this.maxModelCallsPerTick) return false;
    this.modelCalls += 1;
    const row = this.catalogMap().get(tool);
    const permitted = this.ports.permitted(tool);
    const reply = await deadline(
      this.ports.reason(
        [
          `TOOL: ${tool}`,
          `REGISTRY: available=${row?.available ?? false}, permitted=${permitted}, executable=${row?.executable ?? false}`,
          "FAILURES:",
          c.context.slice(0, 1500),
          "",
          `Which cause best explains these failures? One of: ${HYPOTHESIS_CAUSES.join(", ")}.`,
          'Reply with JSON only: {"cause": "<one of the above>", "because": "<one short sentence quoting the failures>"}',
        ].join("\n"),
        "You diagnose tool failures from the evidence given. Never invent details. Reply with JSON only.",
      ),
      null,
      budget.stepTimeoutMs,
    );
    this.modelUsage.calls += 1;
    if (!reply) this.modelUsage.unavailable += 1;
    const json = reply ? parseModelJson(reply) : null;
    const cause = json?.cause as FailureCause | undefined;
    if (!cause || !HYPOTHESIS_CAUSES.includes(cause) || !causeConsistentWithRegistry(cause, row, permitted)) {
      if (reply) this.modelUsage.rejected += 1;
      this.note(c.id, "hypothesis", reply ? `A proposed cause (${String(json?.cause ?? "unparseable")}) was rejected: it does not fit the registry state.` : "No model was reachable to propose a cause.");
      return false;
    }
    const current = this.ledger.get(c.id) ?? c;
    const because = typeof json?.because === "string" ? json.because.slice(0, 200) : "";
    this.ledger.update(c.id, {
      subject: { ...current.subject, cause },
      evidence: [
        ...current.evidence,
        {
          id: crypto.randomUUID(),
          source: "internal",
          tool: "model-hypothesis",
          claim: `Hypothesis ${cause}, consistent with the registry (available=${row?.available}, permitted=${permitted}): ${because}`,
          stance: "supports",
          weight: 0.35,
          at: this.ports.now(),
        },
      ],
    });
    this.modelUsage.accepted += 1;
    this.note(c.id, "hypothesis", `Proposed cause “${cause}” accepted: it is consistent with the registry.`);
    return true;
  }

  /** One background model look at a request the rules found nothing in. Validated before anything is noticed. */
  private async analyseConversation(budget: CuriosityBudget): Promise<string | null> {
    if (!this.ports.reason || this.modelCalls >= this.maxModelCallsPerTick) return null;
    const item = this.conversationBuffer.find((entry) => !entry.analysed);
    if (!item) return null;
    item.analysed = true;
    this.modelCalls += 1;
    const reply = await deadline(
      this.ports.reason(
        [
          `HERU SAID: ${item.text}`,
          "",
          "Is there an ambiguity here that would change what LÉLU should actually do — something only Heru can settle?",
          'Reply with JSON only: {"ambiguous": true|false, "phrase": "<the exact ambiguous words he used>", "question": "<one short question LÉLU could ask him>"}',
        ].join("\n"),
        "You find genuine ambiguity in a request. Most requests are clear — say so. Quote his exact words. Reply with JSON only.",
      ),
      null,
      budget.stepTimeoutMs,
    );
    this.modelUsage.calls += 1;
    if (!reply) this.modelUsage.unavailable += 1;
    const json = reply ? parseModelJson(reply) : null;
    if (!json || json.ambiguous !== true) {
      if (json) this.modelUsage.accepted += 1;
      else if (reply) this.modelUsage.rejected += 1;
      return null;
    }
    const question = typeof json.question === "string" ? json.question.trim() : "";
    if (!isGroundedQuote(item.text, json.phrase, 3, 80) || !question.endsWith("?") || question.length < 10 || question.length > 220) {
      this.modelUsage.rejected += 1;
      return null;
    }
    this.modelUsage.accepted += 1;
    const phrase = String(json.phrase).trim();
    const result = this.notice({
      question: `What does Heru mean by “${phrase}” here?`,
      unknown: `The concrete meaning of “${phrase}” in Heru's request.`,
      context: item.text.slice(0, 160),
      category: "host",
      source: "conversation",
      importance: 0.65,
      uncertainty: 0.8,
      relevance: 0.85,
      expectedBenefit: 0.75,
      informsDecision: true,
      keywords: contentWords(phrase).slice(0, 4),
      subject: { phrase },
      evidenceFingerprint: `phrase:${phrase.toLowerCase()}`,
      hostQuestion: question,
      conversationId: item.conversationId,
    });
    return result.curiosity && !result.merged ? result.curiosity.question : null;
  }

  /* -------------------- LEARN → REMEMBER → APPLY → REFLECT -------------------- */

  private learningFor(c: Curiosity): Omit<CuriosityLearning, "stored" | "retrievable"> {
    const verification = verifyEvidence(c.evidence);
    const supports = c.evidence.filter((item) => item.stance === "supports");
    const remembered = supports.find((item) => item.source === "memory");
    const layer: CuriosityLearning["layer"] = c.category === "self" || c.category === "capability" || c.category === "technical" ? "system" : "knowledge";
    const keywords = [...new Set([...c.keywords, ...(c.subject?.tool ? [c.subject.tool] : [])])].slice(0, 6);
    const diagnosis = Boolean(c.subject?.tool && c.subject.cause && (c.category === "technical" || c.category === "self"));

    // Memory already states it: use what she knows rather than write a near-copy.
    if (remembered) {
      return { type: diagnosis ? (c.category === "self" ? "self-knowledge" : "constraint") : "fact", summary: remembered.claim, keywords, layer, fromExistingMemory: true };
    }
    if (diagnosis && c.subject?.tool && c.subject.cause) {
      const sources = verification.sources.join(", ");
      return c.category === "self"
        ? {
            type: "self-knowledge",
            summary: `My investigations that used ${c.subject.tool} fail because ${describeCause(c.subject.cause)}; choosing it for a background investigation was a wrong assumption (verified from ${sources}).`,
            keywords,
            layer,
          }
        : {
            type: "constraint",
            summary: `${c.subject.tool} fails because ${describeCause(c.subject.cause)} (verified from ${sources}).`,
            keywords,
            layer,
          };
    }
    const claim = supports.map((item) => item.claim).join(" ").slice(0, 400);
    const stoodIn = c.proposedActions.find((intent) => intent.alternativeFor && intent.outcome === "ok");
    if (stoodIn && c.subject?.alternativeFor) {
      return {
        type: "capability",
        summary: `${stoodIn.tool} can stand in when ${stoodIn.alternativeFor} cannot be used — ${stoodIn.reason.split("can stand in — ")[1] ?? "same capability"} It responded (${(stoodIn.resultSummary ?? "").slice(0, 120)}), but has not yet answered a real request in ${stoodIn.alternativeFor}'s place.`,
        keywords: [...new Set([...keywords, stoodIn.tool, c.subject.alternativeFor])].slice(0, 6),
        layer: "system",
      };
    }
    if (c.category === "capability") {
      return { type: c.subject?.cause ? "technical-knowledge" : "capability", summary: `${c.question} — ${claim}`, keywords, layer };
    }
    return { type: c.category === "technical" || c.category === "project" ? "technical-knowledge" : "fact", summary: `${c.question} — ${claim}`, keywords, layer };
  }

  /** Learning is only claimed when memory accepted it AND returns it. */
  private async remember(c: Curiosity, draft: Omit<CuriosityLearning, "stored" | "retrievable">, budget: CuriosityBudget): Promise<CuriosityLearning> {
    if (draft.fromExistingMemory) return { ...draft, stored: true, retrievable: true };
    const storeKeywords = [...new Set([...draft.keywords, ...recallQuery(draft.keywords).split(" ").filter(Boolean)])];
    const stored = await deadline(this.ports.consolidate(draft.layer, draft.summary, storeKeywords), false, budget.stepTimeoutMs);
    if (!stored) return { ...draft, stored: false, retrievable: false };
    const query = recallQuery([...draft.keywords, ...contentWords(draft.summary).slice(0, 4)]) || draft.summary.slice(0, 80);
    const check = await deadline(
      this.ports.dispatch("memory.recall", { query }, `${TASK_PREFIX}${c.id.slice(0, 8)}-recall`),
      { ok: false, content: "recall timed out" },
      budget.stepTimeoutMs,
    );
    const hits = check.ok ? parseRecall(check.content) : [];
    const retrievable = hits.some((hit) => hit.text.includes(draft.summary.slice(0, 48)) || similarity(hit.text, draft.summary) >= 0.6);
    return { ...draft, stored, retrievable };
  }

  private async learnApplyReflect(id: string, verification: ReturnType<typeof verifyEvidence>, budget: CuriosityBudget): Promise<Curiosity | undefined> {
    const c = this.ledger.get(id);
    if (!c) return undefined;
    this.ledger.update(id, { verification });
    const learning = await this.withRevalidation(c, await this.remember(c, this.learningFor(c), budget));

    if (!learning.retrievable) {
      return this.transition(
        id,
        "blocked",
        learning.stored
          ? "Verified, and memory accepted the write, but a recall did not return it — not claimed as learned."
          : "Verified, but memory did not accept the learning — not claimed as learned.",
        { learning, blockedReason: "learning not retrievable" },
      );
    }
    this.transition(id, "learned", `${learning.type}: ${learning.summary}`, { learning, answer: learning.summary });
    this.journal("lessons", `Curiosity — ${learning.summary}`);

    const applied = await this.apply(this.ledger.get(id) ?? c, budget);
    if (applied.length > 0) {
      this.transition(id, "applied", applied.join(" "), { appliedResult: applied });
    } else {
      this.note(id, "apply", "No behaviour change follows from this; it is remembered as context only.");
    }

    this.reflect(this.ledger.get(id) ?? c);
    const resolved = this.transition(id, "resolved", "Resolved.", { resolvedAt: this.ports.now() });
    this.followUp(resolved ?? c);
    return this.ledger.get(id);
  }

  /** Revalidation metadata: when it was verified, whether it can go stale, and what it depends on. */
  private async withRevalidation(c: Curiosity, learning: CuriosityLearning): Promise<CuriosityLearning> {
    const { policy, afterMs } = revalidationPolicyFor(c, learning);
    const tool = c.subject?.tool ?? c.subject?.alternativeFor ?? c.subject?.preferred?.tool;
    const catalog = this.catalogMap();
    let code: string | undefined;
    if (tool && policy !== "stable" && this.ports.sourceFingerprint) {
      code = await deadline(this.ports.sourceFingerprint(tool, catalog.get(tool)?.executionRoute), undefined, this.budget.stepTimeoutMs);
      if (code) this.codeFingerprints.set(tool, code);
    }
    return {
      ...learning,
      verifiedAt: this.ports.now(),
      revalidation: policy,
      ...(afterMs !== undefined ? { revalidateAfterMs: afterMs } : {}),
      ...(tool ? { dependency: { tool, fingerprint: toolFingerprint(catalog.get(tool), this.ports.permitted(tool)), ...(code ? { code } : {}) } } : {}),
    };
  }

  /** Does this change what she does? If so, change it — through existing systems only. */
  private async apply(c: Curiosity, budget: CuriosityBudget): Promise<string[]> {
    const applied: string[] = [];
    if (c.subject?.tool && c.subject.cause && (c.category === "technical" || c.category === "self")) {
      const kind = failureKind(c.subject.cause);
      if (kind === "availability" || kind === "environment" || kind === "permission" || c.subject.cause === "unknown-tool") {
        const rule = constraintFromDiagnosis(c.subject.tool, c.subject.cause, c.id, this.ports.now());
        this.ledger.addConstraint(rule);
        applied.push(
          `Future ${rule.scope === "background" ? "background " : ""}investigations will not select ${rule.tool} (${rule.cause}) until its state changes.`,
        );
      }
      const proposalTitle =
        c.category === "technical" && c.importance >= 0.7 && (c.subject.cause === "unavailable" || c.subject.cause === "not-configured")
          ? `Restore ${c.subject.tool}: ${describeCause(c.subject.cause)}`
          : kind === "permission" && c.importance >= 0.6
            ? `Approve ${c.subject.tool}? ${describeCause(c.subject.cause)}`
            : null;
      if (proposalTitle) {
        // Never a way around the "no": a permission failure becomes a request, not a retry.
        const proposal = this.ports.proposeObjective(
          proposalTitle,
          `Proposed by curiosity ${c.id}: ${c.learning?.summary ?? c.question} Approve to make it work; nothing has been changed.`,
        );
        applied.push(proposal.created ? `Proposed a REVIEW objective for Heru (${proposal.id}).` : `An open REVIEW proposal already covers this (${proposal.id}).`);
        if (proposal.created) this.journal("tomorrowFocus", `Proposed: ${proposalTitle}`);
      }
    }
    // A capability that stood in for another becomes a learned strategy.
    if (c.verification?.verdict === "verified" || verifyEvidence(c.evidence).verdict === "verified") {
      for (const intent of c.proposedActions) {
        if (!intent.alternativeFor || intent.outcome !== "ok") continue;
        // Verified on a REAL request's inputs → current. Merely shown to
        // work (no request behind it) → candidate, not yet trusted as a substitute.
        const onRealInputs = Boolean(c.subject?.preferred) && Object.keys(intent.args).length > 0;
        const strategy: LearnedStrategy = {
          id: crypto.randomUUID(),
          forTool: intent.alternativeFor,
          alternative: intent.tool,
          need: intent.expectedEvidence,
          carriedArgs: Object.keys(intent.args),
          reason: `${intent.tool} answered when ${intent.alternativeFor} could not be used`,
          verifiedAt: this.ports.now(),
          learnedFrom: c.id,
          status: onRealInputs ? "current" : "candidate",
          coverage: intent.coverage,
          missingInputs: intent.missingInputs,
        };
        this.ledger.addStrategy(strategy);
        const scope = `${strategy.coverage === "partial" ? `partial — it does not take ${strategy.missingInputs?.join(", ")}` : "covers every input"}; ${onRealInputs ? "verified on a real request" : "not yet verified on a real request"}`;
        applied.push(`Learned strategy (${strategy.status}): when ${strategy.forTool} cannot be used, ${strategy.alternative} stands in — ${scope}.`);
        this.journal("lessons", `Strategy: when ${strategy.forTool} cannot be used, ${strategy.alternative} can stand in (${scope}).`);
        if (!c.subject?.alternativeFor) {
          // The answer itself was stored above; the strategy is its own memory.
          await deadline(
            this.ports.consolidate("system", `Strategy: when ${strategy.forTool} cannot be used, ${strategy.alternative} can stand in (${scope}).`, [strategy.forTool, strategy.alternative, "strategy"]),
            false,
            budget.stepTimeoutMs,
          );
        }
      }
    }
    if (c.relatedObjectiveIds.length > 0) applied.push(`Attached to objective(s) ${c.relatedObjectiveIds.join(", ")}.`);
    this.syncSelfModel();
    return applied;
  }

  /** What she knows about her own capabilities, from verified state only. */
  public capabilityStates(): CapabilityStateRow[] {
    return capabilityStates({
      catalog: this.ports.catalog(),
      permitted: (id) => this.ports.permitted(id),
      constraints: this.ledger.constraints(),
      curiosities: this.ledger.list(),
      now: this.ports.now(),
    });
  }

  public modelStats(): { calls: number; accepted: number; rejected: number; unavailable: number } {
    return { ...this.modelUsage };
  }

  public strategies(): LearnedStrategy[] {
    return this.ledger.strategies();
  }

  private syncSelfModel(): void {
    if (!this.ports.syncSelfModel) return;
    try {
      const limitations = this.ledger.constraints().map((rule) => `${SELF_MODEL_PREFIX}${rule.tool}: ${rule.reason}${rule.scope === "background" ? " (outside a live conversation)" : ""}`);
      const discoveries = this.ledger
        .strategies()
        .filter((item) => item.status !== "superseded")
        .map((item) => `${SELF_MODEL_PREFIX}strategy (${item.status}): when ${item.forTool} cannot be used, ${item.alternative} stands in${item.coverage === "partial" ? ` — without ${item.missingInputs?.join(", ")}` : ""}.`);
      this.ports.syncSelfModel(limitations, discoveries);
    } catch {
      // The self-model is a view; failing to refresh it never undoes a finding.
    }
  }

  /* ----------------------------- RE-EVALUATION ----------------------------- */

  /** Resolved findings whose truth may have changed, with the reason. Pure checks; no tool runs here. */
  private revalidationCandidates(now: number): Array<{ c: Curiosity; trigger: ReevaluationTrigger }> {
    const catalog = this.catalogMap();
    const out: Array<{ c: Curiosity; trigger: ReevaluationTrigger }> = [];
    for (const c of this.ledger.list()) {
      const trigger = revalidationTrigger(c, {
        now,
        currentFingerprint: (tool) => toolFingerprint(catalog.get(tool), this.ports.permitted(tool)),
        currentCodeFingerprint: (tool) => this.codeFingerprints.get(tool),
        succeededSince: (tool, since) => this.successes.some((item) => item.tool === tool && item.at > since),
        wanted: (tool) => (this.wanted.get(tool) ?? 0) > Math.max(c.learning?.verifiedAt ?? 0, c.lastReevaluationAt ?? 0),
        revisitRequested: this.revisitRequests.has(c.id),
      });
      if (trigger) out.push({ c, trigger });
    }
    return out;
  }

  public async revalidate(id: string, trigger: ReevaluationTrigger, budget: CuriosityBudget = this.budget): Promise<Curiosity | undefined> {
    if (this.busy) return this.ledger.get(id);
    this.busy = true;
    try {
      await this.ports.prepare();
      return await this.revisitUnlocked(id, trigger, budget);
    } finally {
      this.busy = false;
    }
  }

  /**
   * "I learned X. Is X still true?" — ONE bounded check, never a retry
   * loop. Recovered → the old finding is superseded (kept in history), the
   * constraint lifted, the new state learned. Not recovered → confirmed,
   * re-dated, and left alone until the next trigger.
   */
  private async revisitUnlocked(id: string, trigger: ReevaluationTrigger, budget: CuriosityBudget): Promise<Curiosity | undefined> {
    const c = this.ledger.get(id);
    const learning = c?.learning;
    if (!c || !learning) return c;
    this.revisitRequests.delete(id);
    const tool = learning.dependency?.tool;
    const before = learning.summary;
    const reasons: Record<ReevaluationTrigger, string> = {
      "environment-changed": "the state this finding depends on has changed",
      "code-changed": "the code that implements it has changed",
      "time-sensitive": "this kind of finding can drift with time",
      "new-evidence": "the tool has since worked in a conversation",
      "relevant-again": "a newer question needed the tool it rules out",
      revisited: "I met the same question again",
    };
    this.transition(id, "revisiting", `Re-evaluating “${before.slice(0, 120)}” because ${reasons[trigger]}.`);
    const now = this.ports.now();
    const finish = (patch: Partial<Curiosity>, outcome: "confirmed" | "superseded" | "inconclusive", after: string, fingerprint?: string) => {
      const current = this.ledger.get(id) ?? c;
      return this.transition(id, "resolved", `Re-evaluation ${outcome}: ${after}`, {
        ...patch,
        lastReevaluationAt: now,
        reevaluations: [...(current.reevaluations ?? []), { at: now, trigger, before, after, outcome, fingerprint }],
      });
    };

    if (!tool) {
      return finish({}, "inconclusive", "This finding names no capability I can re-check directly.");
    }
    if (trigger !== "environment-changed" && this.ports.refreshCapabilities) {
      await deadline(this.ports.refreshCapabilities(), undefined, budget.stepTimeoutMs);
    }
    const catalog = this.catalogMap();
    const row = catalog.get(tool);
    const permitted = this.ports.permitted(tool);
    const fingerprint = toolFingerprint(row, permitted);
    const cause = c.subject?.cause;

    let recovered = false;
    let evidence = `registry: available=${row?.available ?? false}, permitted=${permitted}, executable=${row?.executable ?? false}`;
    if (row && row.available && permitted && row.executable) {
      const probe = VERIFY_PROBES[tool];
      if (probe) {
        const candidate: ToolCandidate = {
          tool,
          args: probe,
          objective: `Is ${tool} usable again?`,
          reason: `Re-evaluating “${before.slice(0, 80)}” (${trigger}): one read-only call proves it either way.`,
          expectedEvidence: "a successful read-only call",
        };
        const { intent, result } = await this.runIntent(this.ledger.get(id) ?? c, candidate, row, curiosityPermission(row), permitted, budget);
        recovered = result.ok;
        evidence = recovered ? `a read-only ${tool} call succeeded: ${result.content.slice(0, 120)}` : `${tool} still fails (${intent.cause}): ${result.content.slice(0, 120)}`;
      } else {
        // No safe probe exists for this tool; the cause was availability or
        // permission and the registry — recomputed from a live probe — now
        // says both are satisfied.
        recovered = cause === "unavailable" || cause === "not-permitted" || cause === "not-configured";
        if (recovered) evidence = `the registry, refreshed from a live probe, now reports it available and permitted (${evidence})`;
      }
    }

    const code = this.codeFingerprints.get(tool) ?? learning.dependency?.code;
    const marker = trigger === "code-changed" && code ? `code:${code}` : fingerprint;
    if (!recovered) {
      const after = `${tool} still cannot be used (${evidence}).`;
      this.journal("experiences", `Re-checked: ${tool} — still not usable.`);
      return finish({ learning: { ...learning, verifiedAt: now, dependency: { tool, fingerprint, ...(code ? { code } : {}) } } }, "confirmed", after, marker);
    }

    // Self-correction: the old conclusion is superseded, not erased.
    const superseded = { ...learning, supersededAt: now, supersededBy: `re-evaluation (${trigger})` };
    this.ledger.removeConstraint(tool);
    const draft: Omit<CuriosityLearning, "stored" | "retrievable"> = {
      type: c.category === "self" ? "self-knowledge" : "technical-knowledge",
      summary: `${tool} is usable again — ${evidence}. Earlier finding superseded: “${before.slice(0, 160)}”`,
      keywords: learning.keywords,
      layer: learning.layer,
    };
    const fresh = await this.withRevalidation(c, await this.remember(c, draft, budget));
    this.journal("lessons", `Assumption changed: ${tool} was not usable; it is verified usable again.`);
    this.syncSelfModel();
    // Re-checking before trusting an old conclusion, and correcting it, is
    // her own behaviour: one unit per corrected finding.
    this.recordEvidence(c, "patience", `Re-checked “${before.slice(0, 80)}” and corrected it (${trigger}).`, `${c.id}:correction:${now}`);
    return finish(
      { learning: fresh, answer: fresh.summary, supersededLearnings: [...(c.supersededLearnings ?? []), superseded] },
      "superseded",
      `${tool} is eligible again (${evidence}).`,
      marker,
    );
  }

  /**
   * One piece of developmental evidence per inquiry CHAIN — a follow-up
   * born of the same incident is not independent evidence. PersonalityGuard
   * decides what any of it changes.
   */
  private reflect(c: Curiosity): void {
    if (c.personalityEvidence || c.category === "host" || !c.learning?.retrievable) return;
    if (this.ledger.list().some((other) => other.id !== c.id && other.rootId === c.rootId && other.personalityEvidence)) {
      this.note(c.id, "reflect", "This chain already contributed its one evidence item; none added.");
      return;
    }
    const traitId =
      c.source === "execution" || c.source === "self" || c.category === "self"
        ? "pattern-recognition"
        : (c.verification?.sources.length ?? 0) >= 2
          ? "synthesis"
          : "curiosity";
    const observation = `Curiosity “${c.question}” resolved by investigation (${c.verification?.sources.join(", ") ?? "evidence"}).`;
    const mode = this.recordEvidence(c, traitId, observation, c.rootId);
    if (mode) this.ledger.update(c.id, { personalityEvidence: { traitId, mode, observation, at: this.ports.now() } });
  }

  /** One evidence unit, routed through the daily record — or staged when Sandbox Mode / an established trait requires approval. */
  private recordEvidence(c: Curiosity, traitId: string, observation: string, unitId: string): "applied" | "staged" | null {
    const status = this.ports.traitStatus(traitId);
    if (!status) return null;
    try {
      if (this.ports.sandboxMode() || status === "established") {
        this.ports.stageTraitEvidence(traitId, observation, `Curiosity evidence for ${traitId}: ${c.question}`);
        this.note(c.id, "reflect", `Evidence for ${traitId} staged for review (${status === "established" ? "established trait" : "sandbox mode"}).`);
        this.journal("emergingTraits", `Curiosity evidence for ${traitId}: ${c.question}`);
        return "staged";
      }
      this.ports.addTraitEvidence(traitId, observation, unitId);
      this.note(c.id, "reflect", `One evidence unit for ${traitId} recorded for daily reflection; PersonalityGuard governs any status change.`);
      this.journal("emergingTraits", `Curiosity evidence for ${traitId}: ${c.question}`);
      return "applied";
    } catch {
      // Personality is a layer; its failure never undoes the learning.
      return null;
    }
  }

  /** "Now that I know this, there is another useful question" — within the depth budget. */
  private followUp(c: Curiosity): void {
    for (const signal of deriveFollowUps(c)) {
      // "What else can stand in?" is only worth asking if something might.
      if (signal.subject?.alternativeFor && !this.hasPlausibleAlternative(signal.subject.alternativeFor)) {
        this.note(c.id, "follow-up", `No existing authorized capability could stand in for ${signal.subject.alternativeFor}; not opening that question.`);
        continue;
      }
      const result = this.notice(signal);
      if (result.curiosity && !result.merged) {
        this.note(c.id, "follow-up", `Opened: ${result.curiosity.question}`);
      }
    }
  }

  private hasPlausibleAlternative(tool: string): boolean {
    const catalog = this.catalogMap();
    const preferred = catalog.get(tool);
    if (!preferred) return false;
    return (
      discoverAlternatives({
        preferred,
        args: {},
        catalog: [...catalog.values()],
        permitted: (id) => this.ports.permitted(id),
        constraints: this.ledger.constraints(),
        background: true,
        strategies: this.ledger.strategies(),
        parameters: (id) => this.ports.toolParameters?.(id),
      }).options.length > 0
    );
  }

  /** Grant one record permission to continue past the chain's depth limit. */
  public resume(id: string): Curiosity | undefined {
    const c = this.ledger.get(id);
    if (!c || c.status !== "blocked") return c;
    return this.transition(id, "queued", "Continuation granted.", { continuationGranted: true, blockedReason: undefined, nextAttemptAt: undefined });
  }

  /* --------------------------------- ASK -------------------------------- */

  private hostInput(c: Curiosity, text: string) {
    return {
      key: `${HOST_KEY_PREFIX}${c.key}`,
      question: text,
      category: c.category,
      reason: c.unknown,
      tier: c.tier,
      evidence: c.evidenceFingerprint,
      conversationId: c.relatedConversationIds[0],
      objectiveId: c.relatedObjectiveIds[0],
    };
  }

  private ask(c: Curiosity): Curiosity | undefined {
    const text = formulateHostQuestion(c, c.hostQuestionPreset);
    const proactiveId = this.ports.askHost(this.hostInput(c, text));
    if (!proactiveId) {
      return this.transition(c.id, "queued", "The question channel did not accept the question; deferred.", {
        nextAttemptAt: this.ports.now() + RETRY_BACKOFF_MS,
      });
    }
    this.journal("questions", `Asked Heru: ${text}`);
    return this.transition(c.id, "asking", `Asked Heru: ${text}`, {
      hostQuestion: { key: `${HOST_KEY_PREFIX}${c.key}`, text, proactiveId, askedAt: this.ports.now() },
    });
  }

  /**
   * answer → interpretation → classification → memory → context.
   * The answer is knowledge about what Heru meant, not identity: it is
   * never written into LÉLU's traits or values.
   */
  public async receiveHostAnswer(id: string, response: string, budget: CuriosityBudget = this.budget): Promise<Curiosity | undefined> {
    const c = this.ledger.get(id);
    if (!c || isTerminal(c.status)) return c;
    await this.ports.prepare();
    const now = this.ports.now();
    const answer = response.trim().slice(0, 1000);
    const type = classifyAnswer(answer);
    const subject = c.subject?.phrase ? `“${c.subject.phrase}”` : `“${c.question}”`;
    const evidence: CuriosityEvidence = {
      id: crypto.randomUUID(),
      source: "host",
      claim: answer,
      stance: "supports",
      weight: 0.8,
      at: now,
    };
    const verification = verifyEvidence([...c.evidence, evidence]);
    this.ledger.update(id, {
      evidence: [...c.evidence, evidence],
      verification,
      answer,
      hostQuestion: c.hostQuestion ? { ...c.hostQuestion, answer, answeredAt: now, interpretation: `${type}: ${answer.slice(0, 200)}` } : undefined,
    });
    this.note(id, "answer", `Heru answered (${type}).`);

    const learning = await this.remember(
      c,
      {
        type,
        summary: `Heru clarified ${subject}: ${answer}`,
        keywords: [...new Set([...c.keywords, ...contentWords(answer).slice(0, 3)])].slice(0, 6),
        layer: "knowledge",
      },
      budget,
    );
    if (!learning.retrievable) {
      return this.transition(id, "blocked", "Heru's answer is recorded on the question, but memory did not return it — not claimed as learned.", {
        learning,
        blockedReason: "answer not retrievable from memory",
      });
    }
    this.transition(id, "learned", `${type}: ${learning.summary}`, { learning });
    this.journal("meaningfulInteractions", `Heru clarified ${subject} (${type}).`);
    const applied = [
      `Stored as retrievable context; future turns about ${learning.keywords.join(", ")} will recall it.`,
      ...(c.relatedObjectiveIds.length > 0 ? [`The asking objective (${c.relatedObjectiveIds[0]}) is revived by the question channel.`] : []),
    ];
    this.transition(id, "applied", applied.join(" "), { appliedResult: applied });
    return this.transition(id, "resolved", "Resolved by Heru's answer.", { resolvedAt: this.ports.now() });
  }

  /* ------------------------------ records ------------------------------ */

  private transition(id: string, status: CuriosityStatus, detail: string, patch: Partial<Curiosity> = {}): Curiosity | undefined {
    const current = this.ledger.get(id);
    if (!current) return undefined;
    const updated = this.ledger.update(id, {
      ...patch,
      status,
      trail: [...current.trail, { at: this.ports.now(), step: status, detail }],
    });
    if (status === "blocked" && current.status !== "blocked") this.journal("questions", `Unresolved: ${current.question} — ${detail}`);
    if (status === "investigating" && current.status !== "investigating") this.journal("experiences", `Curiosity — looked into: ${current.question}`);
    return updated;
  }

  private note(id: string, step: string, detail: string): void {
    const current = this.ledger.get(id);
    if (!current) return;
    this.ledger.update(id, { trail: [...current.trail, { at: this.ports.now(), step, detail }] });
  }

  private journal(field: Parameters<CuriosityPorts["journal"]>[0], text: string): void {
    try {
      this.ports.journal(field, text.slice(0, 280));
    } catch {
      // The journal is a record, never a dependency.
    }
  }

  /** The Sandbox Mode view of one curiosity: everything it did, and why. */
  public explain(id: string): CuriosityExplanation | null {
    const c = this.ledger.get(id);
    if (!c) return null;
    const verification = c.verification ?? verifyEvidence(c.evidence);
    return {
      detected: `${c.source} → ${c.category} (tier ${c.tier}, priority ${c.priority.toFixed(2)})`,
      question: c.question,
      why: c.unknown,
      potentialAction:
        c.hostQuestion?.text ??
        (c.proposedActions.length > 0 ? c.proposedActions.map((intent) => `${intent.actionClass} ${intent.tool}`).join(", ") : "retrieve from memory first"),
      tools: c.proposedActions.map(
        (intent) =>
          `${intent.tool} → ${intent.outcome ?? "pending"}${intent.blockedReason ? ` (${intent.blockedReason})` : intent.cause ? ` (${intent.cause})` : ""}`,
      ),
      permissions: c.proposedActions.map((intent) => `${intent.tool}: ${intent.permission}${intent.permitted ? "" : ", not permitted by dispatcher"}`),
      evidence: c.evidence.map((item) => `[${item.stance} ${item.weight.toFixed(2)}] ${item.source}${item.tool ? `/${item.tool}` : ""}: ${item.claim.slice(0, 160)}`),
      confidence: `${verification.verdict} (${verification.confidence.toFixed(2)}) — ${verification.note}`,
      learning: c.learning ? `${c.learning.type}: ${c.learning.summary} [stored=${c.learning.stored}, retrievable=${c.learning.retrievable}${c.learning.revalidation ? `, ${c.learning.revalidation}` : ""}]` : "nothing learned yet",
      applied: c.appliedResult,
      status: c.status,
      route: [...new Set(c.trail.map((step) => step.step).filter((step) => !["assess", "consolidated"].includes(step)))].join(" → "),
      personalityImpact: c.personalityEvidence
        ? `${c.personalityEvidence.mode === "staged" ? "Staged for approval" : "One unit for daily reflection"}: ${c.personalityEvidence.traitId}`
        : c.category === "host"
          ? "None — what Heru meant is knowledge, not identity."
          : this.ledger.list().some((other) => other.id !== c.id && other.rootId === c.rootId && other.personalityEvidence)
            ? "None — this line of inquiry already contributed its one unit."
            : "None yet.",
      reevaluations: [
        ...(c.reevaluations ?? []).map((item) => `${item.outcome} (${item.trigger}): ${item.after}`),
        ...(c.supersededLearnings ?? []).map((item) => `superseded: ${item.summary.slice(0, 140)}`),
      ],
    };
  }
}
