/**
 * ==========================================================
 * LÉLUVERSE — WHAT THE PLANET SUBSCRIBES TO
 *
 * The world lifecycle ticks every 100 ms and hands every listener a
 * fresh snapshot of its whole cycle state. A component that copies
 * fields out of that snapshot into React state re-renders at the
 * tick rate — ten times a second — for values that mostly have not
 * changed. For the planet that meant the surface, the clouds, the
 * city lights, the instanced cities, population, vehicles, weather,
 * floating cities, the LOD patch and the country boundaries all
 * re-rendered on the heartbeat of a clock nobody was watching.
 *
 * This is the decision, kept out of the component and kept pure, so
 * the invariant can be tested rather than asserted in a comment:
 *
 *   - a phase is always taken, because it gates whole layers;
 *   - progress is taken ONLY in the phases whose geometry or opacity
 *     actually follows it, and only in ~4% steps;
 *   - when neither moved, the PREVIOUS view is returned by identity,
 *     which is what lets React bail out of the re-render entirely.
 * ==========================================================
 */

import { WorldPhase, type WorldPhaseType } from "../engines/EngineDomains";

/** Phases whose planet geometry or opacity follows phaseProgress. */
export const PROGRESS_PHASES: ReadonlySet<WorldPhaseType> = new Set<WorldPhaseType>([
  WorldPhase.FORMATION,
  WorldPhase.EXPANSION,
  WorldPhase.MIND,
  WorldPhase.SUNSET,
  WorldPhase.COLLAPSE,
  WorldPhase.REBIRTH,
]);

/** How many steps of progress a phase is allowed to draw. */
export const PROGRESS_STEPS = 24;

export interface LifecycleView {
  phase: WorldPhaseType;
  progress: number;
}

/**
 * The next view of the lifecycle for the planet subtree.
 *
 * Returns `current` ITSELF when nothing visible changed: callers rely on
 * that identity to avoid a setState and therefore a re-render.
 */
export function lifecycleView(
  phase: WorldPhaseType,
  phaseProgress: number,
  current: LifecycleView,
): LifecycleView {
  const progress = PROGRESS_PHASES.has(phase)
    ? Math.round(phaseProgress * PROGRESS_STEPS) / PROGRESS_STEPS
    : 0;
  if (current.phase === phase && current.progress === progress) return current;
  return { phase, progress };
}
