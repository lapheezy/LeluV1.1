/**
 * ==========================================================
 * LÉLU — COGNITIVE TRACE
 *
 * Per-turn observability that answers ONE question honestly:
 * did cognition actually participate in this turn, or did the
 * message go straight to a provider?
 *
 * This is NOT a second logger, event bus, or cognition system.
 * The three existing observability layers each answer something
 * different and none of them answer this:
 *
 *   - ExecutionLogger  → flat per-stage success/failure lines
 *     (AIRuntime/AICore/resolvers), with no turn grouping and no
 *     record of WHAT memory was retrieved or whether it reached
 *     the model.
 *   - AgentEventBus    → typed events for the live UI activity
 *     feed (tools, files, browser, providers). Turn-scoped by
 *     taskId, but deliberately UI-shaped, not evidence-shaped.
 *   - Sentinel         → errors/warnings only.
 *
 * A cognitive trace is an ORDERED, per-turn evidence chain:
 *
 *   INPUT → MEMORY RETRIEVAL → SELF CONTEXT → USER CONTEXT
 *   → TASK/GOAL CONTEXT → MODEL ROUTE → TOOL CALL → RESULT
 *   → RESPONSE → MEMORY WRITE
 *
 * Each stage records real measured values (how many memories
 * were recalled, how many characters of context were actually
 * injected into the request, which provider answered, what was
 * written back) so a test — or a developer — can PROVE the
 * cycle ran instead of trusting that it did.
 *
 * Development-only by default: `enabled` is false unless the
 * runtime is a dev build or something explicitly turns it on
 * (verification scripts do). When disabled every method is a
 * cheap no-op, so production turns carry no overhead.
 * ==========================================================
 */

export type CognitiveStage =
  | "INPUT"
  | "MEMORY_RETRIEVAL"
  | "SELF_CONTEXT"
  | "USER_CONTEXT"
  | "TASK_CONTEXT"
  | "CONTEXT_INJECTION"
  | "MODEL_ROUTE"
  | "PROVIDER_ATTEMPT"
  | "PROVIDER_FALLBACK"
  | "TOOL_CALL"
  | "RESULT"
  | "RESPONSE"
  | "MEMORY_WRITE";

export interface CognitiveTraceEntry {
  stage: CognitiveStage;
  /** One-line human summary of what actually happened. */
  detail: string;
  /** Real measured values for this stage — never estimates. */
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface CognitiveTurn {
  taskId: string;
  prompt: string;
  startedAt: number;
  finishedAt: number | null;
  entries: CognitiveTraceEntry[];
}

/** How many completed turns to retain (dev inspection only). */
const MAX_TURNS = 20;

export default class CognitiveTrace {
  private static instance: CognitiveTrace | null = null;

  private turns: CognitiveTurn[] = [];
  private active: CognitiveTurn | null = null;
  private _enabled: boolean;
  /** Change notification for a live UI. Same store-with-subscribers
   *  pattern UIStateStore/ImprovementQueue/MultiChatStore already use —
   *  NOT a second event bus: it carries no event types of its own and
   *  only signals "this trace changed, re-read it". */
  private listeners = new Set<() => void>();

  private constructor() {
    // Dev builds trace by default; production does not. Guarded because
    // `import.meta.env` does not exist under a plain bun/node run (the
    // verification scripts), which enable it explicitly instead.
    let dev = false;
    try {
      dev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
    } catch {
      dev = false;
    }
    this._enabled = dev;
  }

  public static getInstance(): CognitiveTrace {
    if (!CognitiveTrace.instance) {
      CognitiveTrace.instance = new CognitiveTrace();
    }
    return CognitiveTrace.instance;
  }

  public get enabled(): boolean {
    return this._enabled;
  }

  /** Verification scripts and the dev UI turn this on explicitly. */
  public setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.notify();
  }

  /** Subscribe to trace changes (returns an unsubscribe function). */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // a broken listener must never break cognition
      }
    }
  }

  /**
   * Begin a turn. Any unfinished previous turn is closed first so a
   * thrown error mid-pipeline can never leave a turn open forever.
   */
  public begin(taskId: string, prompt: string): void {
    if (!this._enabled) return;
    if (this.active) this.end();
    this.active = {
      taskId,
      prompt,
      startedAt: Date.now(),
      finishedAt: null,
      entries: [],
    };
    this.record("INPUT", prompt.length > 120 ? `${prompt.slice(0, 119)}…` : prompt, {
      promptLength: prompt.length,
    });
    this.notify();
  }

  /** Record one real stage of the current turn. */
  public record(stage: CognitiveStage, detail: string, data?: Record<string, unknown>): void {
    if (!this._enabled || !this.active) return;
    this.active.entries.push({ stage, detail, data, timestamp: Date.now() });
    this.notify();
  }

  public end(): void {
    if (!this._enabled || !this.active) return;
    this.active.finishedAt = Date.now();
    this.turns.push(this.active);
    if (this.turns.length > MAX_TURNS) {
      this.turns.splice(0, this.turns.length - MAX_TURNS);
    }
    this.active = null;
    this.notify();
  }

  /** The turn currently being traced (null between turns). */
  public current(): CognitiveTurn | null {
    return this.active;
  }

  /** Completed turns, oldest first. */
  public history(): CognitiveTurn[] {
    return [...this.turns];
  }

  /** The most recently COMPLETED turn — what a test asserts against. */
  public lastTurn(): CognitiveTurn | null {
    return this.turns.length > 0 ? this.turns[this.turns.length - 1] : null;
  }

  public clear(): void {
    this.turns = [];
    this.active = null;
    this.notify();
  }

  /** True when the given turn actually reached this stage. */
  public static reached(turn: CognitiveTurn | null, stage: CognitiveStage): boolean {
    return Boolean(turn?.entries.some((entry) => entry.stage === stage));
  }

  /** Every entry recorded for one stage of a turn. */
  public static entriesFor(turn: CognitiveTurn | null, stage: CognitiveStage): CognitiveTraceEntry[] {
    return (turn?.entries ?? []).filter((entry) => entry.stage === stage);
  }

  /** Readable evidence chain, for a dev console or a failing test. */
  public static format(turn: CognitiveTurn | null): string {
    if (!turn) return "(no traced turn)";
    const lines = turn.entries.map((entry) => {
      const offset = entry.timestamp - turn.startedAt;
      const data = entry.data && Object.keys(entry.data).length > 0
        ? ` ${JSON.stringify(entry.data)}`
        : "";
      return `  +${String(offset).padStart(5)}ms  ${entry.stage.padEnd(18)} ${entry.detail}${data}`;
    });
    const duration = turn.finishedAt ? `${turn.finishedAt - turn.startedAt}ms` : "in flight";
    return [`TURN ${turn.taskId} (${duration})`, ...lines].join("\n");
  }
}
