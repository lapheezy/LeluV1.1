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
  deriveFollowUp,
  describeCause,
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
  type ObservedFailure,
  type ToolCandidate,
  type ToolIntent,
} from "./Curiosity";
import CuriosityLedger, { isTerminal } from "./CuriosityLedger";
import { createDefaultPorts, type CuriosityPorts, type DispatchResult } from "./CuriosityPorts";

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

  public configure(options: { enabled?: boolean; autoInvestigate?: boolean; budget?: Partial<CuriosityBudget>; capabilityScanIntervalMs?: number }): void {
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
    if (!signal) return null;
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

      if (!this.autoInvestigate) return { ...report, ran: true, reason: "investigation is switched off; only noticing" };
      const next = this.ledger.pursuable(now).find((item) => (item.nextAttemptAt ?? 0) <= now);
      if (!next) return { ...report, ran: true, reason: "nothing worth pursuing right now" };

      const pursued = await this.pursueUnlocked(next.id, budget);
      report.ran = true;
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
    return selectTools(c, [...catalog.values()], this.ledger.constraints(), true)
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
    };
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
    const answering = hits.filter(
      (hit) =>
        memoryAnswers(c.keywords, hit) &&
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
    const evidence = this.interpret(this.ledger.get(c.id) ?? c, intent, result, budget);
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
    const timedOut: DispatchResult & { timedOut?: boolean } = {
      ok: false,
      content: `${candidate.tool} timed out after ${budget.stepTimeoutMs}ms.`,
      timedOut: true,
    };
    const result: DispatchResult & { timedOut?: boolean } = candidate.tool.startsWith("internal:")
      ? this.internalProbe(c, candidate)
      : await deadline<DispatchResult & { timedOut?: boolean }>(this.ports.dispatch(candidate.tool, candidate.args, taskId), timedOut, budget.stepTimeoutMs);

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
  private interpret(c: Curiosity, intent: ToolIntent, result: DispatchResult, budget: CuriosityBudget): CuriosityEvidence[] {
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
    // A direct answer from a tool whose job is to state it.
    return [make(result.content, "supports", intent.tool === "research.web" ? 0.5 : 0.6)];
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
    const learning = await this.remember(c, this.learningFor(c), budget);

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

    const applied = this.apply(this.ledger.get(id) ?? c);
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

  /** Does this change what she does? If so, change it — through existing systems only. */
  private apply(c: Curiosity): string[] {
    const applied: string[] = [];
    if (c.subject?.tool && c.subject.cause && (c.category === "technical" || c.category === "self")) {
      if (["unavailable", "missing-context", "not-permitted", "not-configured", "unknown-tool"].includes(c.subject.cause)) {
        const rule = constraintFromDiagnosis(c.subject.tool, c.subject.cause, c.id, this.ports.now());
        this.ledger.addConstraint(rule);
        applied.push(
          `Future ${rule.scope === "background" ? "background " : ""}investigations will not select ${rule.tool} (${rule.cause}).`,
        );
      }
      if (c.category === "technical" && c.importance >= 0.7 && (c.subject.cause === "unavailable" || c.subject.cause === "not-configured")) {
        const proposal = this.ports.proposeObjective(
          `Restore ${c.subject.tool}: ${describeCause(c.subject.cause)}`,
          `Proposed by curiosity ${c.id}: ${c.learning?.summary ?? c.question} Approve to make it work; nothing has been changed.`,
        );
        applied.push(proposal.created ? `Proposed a REVIEW objective for Heru (${proposal.id}).` : `An open REVIEW proposal already covers this (${proposal.id}).`);
      }
    }
    if (c.relatedObjectiveIds.length > 0) applied.push(`Attached to objective(s) ${c.relatedObjectiveIds.join(", ")}.`);
    return applied;
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
    const status = this.ports.traitStatus(traitId);
    if (!status) return;
    const now = this.ports.now();
    try {
      if (this.ports.sandboxMode() || status === "established") {
        this.ports.stageTraitEvidence(traitId, observation, `Curiosity evidence for ${traitId}: ${c.question}`);
        this.ledger.update(c.id, { personalityEvidence: { traitId, mode: "staged", observation, at: now } });
        this.note(c.id, "reflect", `Evidence for ${traitId} staged for review (${status === "established" ? "established trait" : "sandbox mode"}).`);
      } else {
        this.ports.addTraitEvidence(traitId, observation);
        this.ledger.update(c.id, { personalityEvidence: { traitId, mode: "applied", observation, at: now } });
        this.note(c.id, "reflect", `One evidence item recorded for ${traitId}; PersonalityGuard governs any status change.`);
      }
      this.journal("emergingTraits", `Curiosity evidence for ${traitId}: ${c.question}`);
    } catch {
      // Personality is a layer; its failure never undoes the learning.
    }
  }

  /** "Now that I know this, there is another useful question" — within the depth budget. */
  private followUp(c: Curiosity): void {
    const signal = deriveFollowUp(c);
    if (!signal) return;
    const result = this.notice(signal);
    if (result.curiosity && !result.merged) {
      this.note(c.id, "follow-up", `Opened: ${result.curiosity.question}`);
    }
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
    this.journal("relationshipObservations", `Heru clarified ${subject} (${type}).`);
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
      learning: c.learning ? `${c.learning.type}: ${c.learning.summary} [stored=${c.learning.stored}, retrievable=${c.learning.retrievable}]` : "nothing learned yet",
      applied: c.appliedResult,
      status: c.status,
    };
  }
}
