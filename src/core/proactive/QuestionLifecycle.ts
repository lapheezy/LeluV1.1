/**
 * ==========================================================
 * LÉLU — PROACTIVE QUESTION LIFECYCLE
 *
 * What a suggestion is allowed to do between "noticed" and "resolved".
 *
 * The failure this exists to end: a question was either pending or it
 * was not. Ignoring one left it pending, so it came back on the next
 * cycle, every cycle, forever — and because the card never cleared on
 * dismiss, dismissing it looked broken too. The user saw the same
 * sentence about the same project indefinitely.
 *
 * So a question now carries the three things that decision needs:
 *
 *   STATE     where it is in its life
 *   EVIDENCE  the state of the world that justified it
 *   HISTORY   how the user has responded to it so far
 *
 * EVIDENCE is the important one. A question is not re-asked because a
 * cycle ran; it is re-asked only when the situation that produced it has
 * genuinely changed. Everything else — reload, StrictMode double-mount,
 * Supabase reconnect, a cognitive-loop restart — reproduces the same
 * evidence and is therefore a no-op by construction, rather than by a
 * timestamp guard that eventually expires.
 *
 * This module is pure. It holds no state, touches no store and renders
 * nothing: ProactiveCore owns the records, and this decides.
 * ==========================================================
 */

/**
 * GENERATED  cognition noticed something. Not yet shown.
 * ELIGIBLE   worth surfacing, waiting for a slot.
 * SURFACED   shown to the user, awaiting a response.
 * ENGAGED    the user opened it; it now lives in a workstream.
 * DEFERRED   "not now" — returns only on new evidence.
 * DISMISSED  "no" — returns only on new evidence, and reluctantly.
 * PARKED     surfaced repeatedly and ignored; deprioritised, silent.
 * SUPERSEDED evolved into a better question, or absorbed by another.
 * RESOLVED   answered, or the underlying condition went away.
 */
export type QuestionState =
  | "generated"
  | "eligible"
  | "surfaced"
  | "engaged"
  | "deferred"
  | "dismissed"
  | "parked"
  | "superseded"
  | "resolved";

/** States from which a question will never be shown again as-is. */
const TERMINAL: ReadonlySet<QuestionState> = new Set<QuestionState>([
  "resolved",
  "superseded",
]);

/** States the user has explicitly or implicitly closed. */
const SUPPRESSED: ReadonlySet<QuestionState> = new Set<QuestionState>([
  "deferred",
  "dismissed",
  "parked",
]);

export interface QuestionLifecycle {
  state: QuestionState;
  /**
   * Fingerprint of the world-state that justified this question.
   * Two cycles that observe the same situation produce the same value,
   * which is what makes a repeated cycle idempotent.
   */
  evidence: string;
  /** How many times the user has actually been shown this. */
  surfacedCount: number;
  lastSurfacedAt: number;
  /** Surfaced, then neither engaged with nor closed. */
  ignoredCount: number;
  /** Explicit "not now" count — stronger signal than ignoring. */
  deferredCount: number;
  /** Conversation this became, once engaged. */
  workstreamId?: string;
  /** Why it left the surface, for the record and for the UI. */
  note?: string;
}

/** How many times a question may be shown and ignored before it parks. */
export const IGNORE_LIMIT = 3;

/** A question's first lifecycle, at the moment cognition generates it. */
export function newLifecycle(evidence: string): QuestionLifecycle {
  return {
    state: "generated",
    evidence,
    surfacedCount: 0,
    lastSurfacedAt: 0,
    ignoredCount: 0,
    deferredCount: 0,
  };
}

/**
 * May this question be shown right now?
 *
 * Deliberately ignores elapsed time. "Ask again in an hour" is how the
 * original spam happened: nothing about the situation changed, only the
 * clock. New evidence is the only thing that reopens a closed question,
 * and `evolve` is what applies it.
 */
export function canSurface(lifecycle: QuestionLifecycle): boolean {
  if (TERMINAL.has(lifecycle.state)) return false;
  if (SUPPRESSED.has(lifecycle.state)) return false;
  // Already on screen — showing it again is the same showing.
  if (lifecycle.state === "surfaced") return true;
  // Engaged questions belong to their workstream, not the global surface.
  if (lifecycle.state === "engaged") return false;
  return true;
}

/**
 * Should a question that already exists be reconsidered, given what
 * cognition observes now?
 *
 * A closed question reopens only when the evidence differs — the
 * situation materially moved. A dismissal is respected harder than a
 * deferral: the user said no to the question as asked, so it takes a
 * genuinely different observation to ask anything like it again.
 */
export function shouldReconsider(
  lifecycle: QuestionLifecycle,
  evidence: string,
): boolean {
  if (TERMINAL.has(lifecycle.state)) return false;
  if (lifecycle.evidence === evidence) return false;
  if (lifecycle.state === "engaged") return false;
  // Parked questions are the ignored ones: new evidence may make them
  // worth one more attempt, since the user never actually said no.
  return true;
}

/** Record that the user was shown this. */
export function markSurfaced(
  lifecycle: QuestionLifecycle,
  now: number,
): QuestionLifecycle {
  return {
    ...lifecycle,
    state: "surfaced",
    surfacedCount: lifecycle.surfacedCount + 1,
    lastSurfacedAt: now,
  };
}

/**
 * The user moved on without answering.
 *
 * Ignoring is information, so it accumulates — and past the limit the
 * question parks itself instead of continuing to ask. That is the
 * conclusion "this is currently low priority", reached from behaviour
 * rather than from a rule about any particular topic.
 */
export function markIgnored(lifecycle: QuestionLifecycle): QuestionLifecycle {
  const ignoredCount = lifecycle.ignoredCount + 1;
  if (ignoredCount >= IGNORE_LIMIT) {
    return {
      ...lifecycle,
      state: "parked",
      ignoredCount,
      note: `Surfaced ${lifecycle.surfacedCount} time(s) without engagement — treated as low priority.`,
    };
  }
  return { ...lifecycle, state: "eligible", ignoredCount };
}

export function markDeferred(
  lifecycle: QuestionLifecycle,
  note?: string,
): QuestionLifecycle {
  return {
    ...lifecycle,
    state: "deferred",
    deferredCount: lifecycle.deferredCount + 1,
    note: note ?? "Deferred by the user; waiting for the situation to change.",
  };
}

export function markDismissed(
  lifecycle: QuestionLifecycle,
  note?: string,
): QuestionLifecycle {
  return {
    ...lifecycle,
    state: "dismissed",
    note: note ?? "Dismissed by the user.",
  };
}

export function markEngaged(
  lifecycle: QuestionLifecycle,
  workstreamId: string,
): QuestionLifecycle {
  return {
    ...lifecycle,
    state: "engaged",
    workstreamId,
    note: "The user opened this; it now belongs to its workstream.",
  };
}

export function markResolved(
  lifecycle: QuestionLifecycle,
  note?: string,
): QuestionLifecycle {
  return { ...lifecycle, state: "resolved", note: note ?? lifecycle.note };
}

export function markSuperseded(
  lifecycle: QuestionLifecycle,
  note: string,
): QuestionLifecycle {
  return { ...lifecycle, state: "superseded", note };
}

/**
 * Apply new evidence to an existing question.
 *
 * The question returns to `eligible` — it may be asked again — but its
 * history is kept, so a suggestion the user has ignored twice does not
 * get a fresh three attempts every time the evidence shifts slightly.
 */
export function evolve(
  lifecycle: QuestionLifecycle,
  evidence: string,
): QuestionLifecycle {
  return {
    ...lifecycle,
    state: "eligible",
    evidence,
    note: "Re-opened: the situation behind it changed.",
  };
}

/**
 * Priority after the user's behaviour is taken into account.
 *
 * Something ignored or deferred is demoted, so it ranks below anything
 * fresh without being deleted. It drops to the back of the queue rather
 * than out of existence.
 */
export function effectivePriorityOffset(lifecycle: QuestionLifecycle): number {
  return lifecycle.ignoredCount + lifecycle.deferredCount * 2;
}

/** Is this question's home a workstream rather than the global surface? */
export function isWorkstreamOwned(lifecycle: QuestionLifecycle): boolean {
  return lifecycle.state === "engaged" && Boolean(lifecycle.workstreamId);
}

const STATES: ReadonlySet<string> = new Set<QuestionState>([
  "generated",
  "eligible",
  "surfaced",
  "engaged",
  "deferred",
  "dismissed",
  "parked",
  "superseded",
  "resolved",
]);

/**
 * Read a lifecycle that came back from storage.
 *
 * Validated rather than cast: this value arrives from a jsonb column and
 * from another device's sync, so a malformed or partial object must
 * degrade to "no lifecycle recorded" — which the caller then derives
 * from the coarse status — instead of producing a record whose `state`
 * is a string nothing matches and which therefore never surfaces again.
 */
export function parseLifecycle(value: unknown): QuestionLifecycle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.state !== "string" || !STATES.has(raw.state)) return null;

  const count = (key: string): number => {
    const found = raw[key];
    return typeof found === "number" && Number.isFinite(found) && found >= 0 ? found : 0;
  };

  return {
    state: raw.state as QuestionState,
    evidence: typeof raw.evidence === "string" ? raw.evidence : "",
    surfacedCount: count("surfacedCount"),
    lastSurfacedAt: count("lastSurfacedAt"),
    ignoredCount: count("ignoredCount"),
    deferredCount: count("deferredCount"),
    ...(typeof raw.workstreamId === "string" && raw.workstreamId
      ? { workstreamId: raw.workstreamId }
      : {}),
    ...(typeof raw.note === "string" && raw.note ? { note: raw.note } : {}),
  };
}
