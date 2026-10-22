/**
 * ==========================================================
 * LÉLU — HOW PRIORITY IS COMPUTED
 *
 * One implementation, extracted from SelfStudyEngine.prioritize(),
 * which is where it was written and where it already worked. It is
 * moved here rather than copied because there are now two kinds of
 * objective that need it — the questions self-study carries, and the
 * work AgentCognitionRuntime executes — and a second copy of a
 * scoring formula is a second answer to "what matters next".
 *
 * The shape of it, and why each part is there:
 *
 *  · ALWAYS FROM THE BASE. A recomputed priority starts from the
 *    intrinsic importance the objective was created with, never from
 *    last cycle's result. Compounding would mean an objective that
 *    lost the contest once sank forever and was never picked.
 *
 *  · ADJUSTMENTS ARE NAMED AND SIGNED. Each caller passes what is
 *    actually true now — a blocked runtime, a contradiction, a user's
 *    stated project priority. They are named so the reason a thing
 *    won can be read back, not only its score.
 *
 *  · ATTEMPTS LOWER BUT NEVER ZERO. Repeated failure to make progress
 *    pushes work down; it does not delete it.
 *
 *  · AGE NUDGES UPWARD. Anti-starvation: something carried for hours
 *    climbs, so a permanently-high newcomer cannot hold the front of
 *    the queue indefinitely.
 *
 *  · RECENCY FATIGUE. Having just worked this kind of thing counts
 *    against doing it again. Without it a permanently-true condition
 *    (an unreachable runtime, say) keeps re-winning and starves
 *    everything else — thinking in a circle rather than moving.
 *
 * The numbers are the ones self-study has been using; this extraction
 * deliberately changes none of them.
 * ==========================================================
 */

/** Priority is a 1-100 scale. 0 would mean "never", which nothing is. */
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 100;

/** Per failed attempt. Lowers, never zeroes. */
const ATTEMPT_PENALTY = 10;
/** Per hour carried, capped — anti-starvation, not a second clock. */
const AGE_BONUS_PER_HOUR = 1;
const MAX_AGE_BONUS = 10;
/** Per recent cycle that already worked this kind of work. */
const FATIGUE_PENALTY = 18;

const HOUR_MS = 60 * 60 * 1000;

/** Hold a value inside the scale. Exported so callers seeding a base agree with it. */
export function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return MIN_PRIORITY;
  return Math.max(MIN_PRIORITY, Math.min(MAX_PRIORITY, Math.round(value)));
}

/** One named, signed reason a priority moved. */
export interface PriorityAdjustment {
  reason: string;
  delta: number;
}

export interface PriorityInputs {
  /** The intrinsic importance the objective was created with. */
  basePriority: number;
  /** What is true now. Order is irrelevant; they are summed. */
  adjustments?: PriorityAdjustment[];
  /** Attempts already spent without resolving it. */
  attempts?: number;
  /** When it was created, for the age nudge. */
  createdAt?: number;
  /** How many recent cycles already worked this kind of work. */
  recentSameKind?: number;
  /** Override for tests that need a fixed clock. */
  now?: number;
}

/**
 * The priority this objective should carry right now.
 *
 * Pure: same inputs, same answer, no store and no clock of its own
 * beyond `now`.
 */
export function computePriority(inputs: PriorityInputs): number {
  let priority = inputs.basePriority;

  for (const adjustment of inputs.adjustments ?? []) {
    priority += adjustment.delta;
  }

  priority -= (inputs.attempts ?? 0) * ATTEMPT_PENALTY;

  if (inputs.createdAt !== undefined) {
    const age = (inputs.now ?? Date.now()) - inputs.createdAt;
    priority += Math.min(MAX_AGE_BONUS, Math.floor(age / HOUR_MS) * AGE_BONUS_PER_HOUR);
  }

  priority -= FATIGUE_PENALTY * (inputs.recentSameKind ?? 0);

  return Math.max(MIN_PRIORITY, Math.min(MAX_PRIORITY, Math.round(priority)));
}

/* ------------------------------------------------------------------ *
 * SEEDING A BASE
 * ------------------------------------------------------------------ */

/**
 * The intrinsic importance of work in a given queue category.
 *
 * These are the WorkQueue's own categories (see WorkQueue.QUEUE_CATEGORIES)
 * read as importance rather than as filing. NOW outranks NEXT; a BLOCKED
 * item is important precisely because something is stuck behind it;
 * IDEAS are worth carrying and worth carrying last.
 */
const BASE_FOR_CATEGORY: Record<string, number> = {
  NOW: 80,
  BLOCKED: 72,
  REVIEW: 68,
  NEXT: 60,
  PROJECTS: 55,
  EXPERIMENTS: 45,
  LEARNING: 40,
  IDEAS: 30,
};

/**
 * A project's stated priority, as a signed adjustment.
 *
 * Projects carry a free-form string that is "P0".."P4" in practice, so
 * it is parsed tolerantly: anything unrecognised contributes nothing
 * rather than guessing. P2 is treated as the neutral middle, which is
 * what ProjectResolver's own default (P1) sits just above.
 */
export function projectPriorityAdjustment(priority?: string): PriorityAdjustment | null {
  const match = /^\s*P\s*([0-4])\s*$/i.exec(priority ?? "");
  if (!match) return null;
  const level = Number(match[1]);
  const delta = (2 - level) * 8;
  if (delta === 0) return null;
  return { reason: `project priority P${level}`, delta };
}

/**
 * Where a derived piece of work should start on the scale.
 *
 * One place, so cognition and anything else that creates executable
 * work agree about what "important" means.
 */
export function basePriorityForWork(input: {
  category?: string;
  projectPriority?: string;
}): number {
  const base = BASE_FOR_CATEGORY[(input.category ?? "").toUpperCase()] ?? DEFAULT_SEED_PRIORITY;
  const adjustment = projectPriorityAdjustment(input.projectPriority);
  return clampPriority(base + (adjustment?.delta ?? 0));
}

/** Used when the category says nothing — the middle of the scale. */
const DEFAULT_SEED_PRIORITY = 50;
