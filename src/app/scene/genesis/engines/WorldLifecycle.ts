/**
 * ==========================================================
 * LÉLUVERSE
 * WORLD LIFECYCLE
 *
 * The day/night state machine for the entire LÉLU world.
 *
 * CORE_SEED → FORMATION → EXPANSION → PLANET → LIFE →
 * MIND → FULL_WORLD → SUNSET → COLLAPSE → REBIRTH →
 * CORE_SEED (next cycle)
 *
 * This is not merely a visual timer.
 * It is an actual state machine that controls:
 *   - Which engines are active
 *   - World expansion scale
 *   - Avatar position
 *   - Engine activation/deactivation
 *   - Collapse/rebirth transitions
 *   - Cycle persistence
 * ==========================================================
 */

import KvStore from "../../../../core/storage/KvStore";
import {
  WorldPhase,
  type WorldPhaseType,
  getActiveEnginesForPhase,
  PHASE_EXPANSION_SCALE,
  PHASE_AVATAR_POSITION,
} from "./EngineDomains";

// ── TYPES ──

export interface WorldCycleState {
  /** Unique cycle ID */
  cycleId: string;
  /** Which phase we're in */
  phase: WorldPhaseType;
  /** Progress through current phase (0-1) */
  phaseProgress: number;
  /** Total elapsed time in this cycle */
  cycleTime: number;
  /** Number of completed cycles */
  completedCycles: number;
  /** Active engines in this cycle */
  activeEngines: string[];
  /** Timestamps */
  startedAt: number;
  phaseStartedAt: number;
  /** Expansion scale (0-1) */
  expansionScale: number;
  /** Avatar position in the cosmos */
  avatarPosition: string;
  /** Whether the world is collapsing */
  collapsing: boolean;
  /** Whether rebirth is in progress */
  rebirthing: boolean;
  /** Engine activation history for this cycle */
  engineActivationOrder: string[];
  /** State preserved across cycles */
  preservedState: {
    discoveries: string[];
    artifacts: string[];
    memories: string[];
    reflections: string[];
    engineVersions: Record<string, string>;
  };
  /** Developmental state (persists across cycles) */
  developmental: DevelopmentalAge;
}

/** Persistent developmental state — grows across cycles */
export interface DevelopmentalAge {
  /** Accumulated complexity score (0-1, grows over time) */
  complexity: number;
  /** How many cycles have completed */
  completedCycles: number;
  /** Number of meaningful memories */
  meaningfulMemoryCount: number;
  /** Number of reflections */
  reflectionCount: number;
  /** Number of discoveries */
  discoveryCount: number;
  /** Number of artifacts created */
  artifactCount: number;
  /** Number of active projects */
  projectCount: number;
  /** World complexity level (affects visual richness) */
  worldComplexity: number;
  /** Engine complexity level */
  engineComplexity: number;
  /** Current cycle duration in seconds */
  currentCycleDuration: number;
}

type WorldLifecycleListener = (state: WorldCycleState) => void;

// ── PHASE DURATIONS (base durations at complexity=0, in seconds) ──
// Actual durations scale with developmental complexity.
// At complexity=0 (newborn), total ≈ 70 seconds.
// At complexity=1 (mature), total ≈ 10 minutes.

const BASE_PHASE_DURATIONS: Record<WorldPhaseType, number> = {
  [WorldPhase.CORE_SEED]: 3,       // 3s — core appears (fast for newborn)
  [WorldPhase.FORMATION]: 5,       // 5s — cosmic structures form
  [WorldPhase.EXPANSION]: 7,       // 7s — galaxies spread
  [WorldPhase.PLANET]: 10,         // 10s — planet develops
  [WorldPhase.LIFE]: 8,            // 8s — life emerges
  [WorldPhase.MIND]: 7,            // 7s — mind activates
  [WorldPhase.FULL_WORLD]: 15,     // 15s — full world lives
  [WorldPhase.SUNSET]: 5,          // 5s — sunset begins
  [WorldPhase.COLLAPSE]: 5,        // 5s — controlled collapse
  [WorldPhase.REBIRTH]: 5,         // 5s — rebirth explosion
};

// Max durations at complexity=1 (mature)
const MAX_PHASE_DURATIONS: Record<WorldPhaseType, number> = {
  [WorldPhase.CORE_SEED]: 30,
  [WorldPhase.FORMATION]: 45,
  [WorldPhase.EXPANSION]: 60,
  [WorldPhase.PLANET]: 90,
  [WorldPhase.LIFE]: 90,
  [WorldPhase.MIND]: 75,
  [WorldPhase.FULL_WORLD]: 180,
  [WorldPhase.SUNSET]: 45,
  [WorldPhase.COLLAPSE]: 30,
  [WorldPhase.REBIRTH]: 20,
};

/** Calculate phase duration based on developmental complexity */
function getPhaseDuration(phase: WorldPhaseType, complexity: number): number {
  const base = BASE_PHASE_DURATIONS[phase];
  const max = MAX_PHASE_DURATIONS[phase];
  // Nonlinear growth: sqrt curve gives fast early growth, gradual later
  const t = Math.sqrt(Math.min(1, complexity));
  return base + (max - base) * t;
}

/** Calculate total cycle duration from developmental complexity */
function calculateCycleDuration(complexity: number): number {
  let total = 0;
  for (const phase of PHASE_ORDER) {
    total += getPhaseDuration(phase, complexity);
  }
  return total;
}

/** Calculate developmental complexity from memory/state */
export function calculateDevelopmentalComplexity(age: DevelopmentalAge): number {
  // Weighted combination of developmental factors
  const weights = {
    memories: 0.20,
    reflections: 0.15,
    discoveries: 0.15,
    artifacts: 0.10,
    projects: 0.10,
    worldComplexity: 0.15,
    engineComplexity: 0.10,
    cycleHistory: 0.05,
  };

  // Normalize each factor to 0-1
  const memNorm = Math.min(1, age.meaningfulMemoryCount / 200);
  const refNorm = Math.min(1, age.reflectionCount / 100);
  const disNorm = Math.min(1, age.discoveryCount / 50);
  const artNorm = Math.min(1, age.artifactCount / 30);
  const projNorm = Math.min(1, age.projectCount / 20);
  const worldNorm = Math.min(1, age.worldComplexity);
  const engineNorm = Math.min(1, age.engineComplexity);
  const cycleNorm = Math.min(1, age.completedCycles / 50);

  const raw =
    weights.memories * memNorm +
    weights.reflections * refNorm +
    weights.discoveries * disNorm +
    weights.artifacts * artNorm +
    weights.projects * projNorm +
    weights.worldComplexity * worldNorm +
    weights.engineComplexity * engineNorm +
    weights.cycleHistory * cycleNorm;

  // Apply soft cap — complexity asymptotically approaches 1
  return Math.min(1, raw * 1.2);
}

// Phase ordering
const PHASE_ORDER: WorldPhaseType[] = [
  WorldPhase.CORE_SEED,
  WorldPhase.FORMATION,
  WorldPhase.EXPANSION,
  WorldPhase.PLANET,
  WorldPhase.LIFE,
  WorldPhase.MIND,
  WorldPhase.FULL_WORLD,
  WorldPhase.SUNSET,
  WorldPhase.COLLAPSE,
  WorldPhase.REBIRTH,
];

// ── STORAGE KEYS ──
const CYCLE_KEY = "lelu.world.lifecycle.v2"; // v2: added developmental state
const HISTORY_KEY = "lelu.world.cycleHistory.v1";

// ── WORLD LIFECYCLE ──

export default class WorldLifecycle {
  private static instance: WorldLifecycle | null = null;

  private state: WorldCycleState;
  private listeners = new Set<WorldLifecycleListener>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private phaseCallbacks = new Map<WorldPhaseType, Array<() => void | Promise<void>>>();
  private paused = false;
  private speed = 1; // multiplier

  private constructor() {
    this.state = this.loadOrCreateState();
  }

  static getInstance(): WorldLifecycle {
    if (!WorldLifecycle.instance) {
      WorldLifecycle.instance = new WorldLifecycle();
    }
    return WorldLifecycle.instance;
  }

  // ── STATE MANAGEMENT ──

  private loadOrCreateState(): WorldCycleState {
    try {
      const stored = KvStore.getInstance().get<WorldCycleState>(CYCLE_KEY);
      if (stored && stored.cycleId) {
        // Ensure developmental field exists (migration from old state)
        if (!stored.developmental) {
          stored.developmental = {
            complexity: 0,
            completedCycles: stored.completedCycles ?? 0,
            meaningfulMemoryCount: 0,
            reflectionCount: 0,
            discoveryCount: 0,
            artifactCount: 0,
            projectCount: 0,
            worldComplexity: 0,
            engineComplexity: 0,
            currentCycleDuration: calculateCycleDuration(0),
          };
        }
        return stored;
      }
    } catch { /* ignore */ }
    return this.createFreshCycle();
  }

  private createFreshCycle(): WorldCycleState {
    const now = Date.now();
    const prevCycle = this.state?.completedCycles ?? 0;
    const preserved = this.state?.preservedState ?? {
      discoveries: [],
      artifacts: [],
      memories: [],
      reflections: [],
      engineVersions: {},
    };
    const devAge = this.state?.developmental ?? {
      complexity: 0,
      completedCycles: 0,
      meaningfulMemoryCount: 0,
      reflectionCount: 0,
      discoveryCount: 0,
      artifactCount: 0,
      projectCount: 0,
      worldComplexity: 0,
      engineComplexity: 0,
      currentCycleDuration: calculateCycleDuration(0),
    };

    // Recalculate complexity for new cycle
    devAge.complexity = calculateDevelopmentalComplexity(devAge);
    devAge.currentCycleDuration = calculateCycleDuration(devAge.complexity);
    devAge.completedCycles = prevCycle;

    return {
      cycleId: `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phase: WorldPhase.CORE_SEED,
      phaseProgress: 0,
      cycleTime: 0,
      completedCycles: prevCycle,
      activeEngines: [],
      startedAt: now,
      phaseStartedAt: now,
      expansionScale: PHASE_EXPANSION_SCALE[WorldPhase.CORE_SEED],
      avatarPosition: PHASE_AVATAR_POSITION[WorldPhase.CORE_SEED],
      collapsing: false,
      rebirthing: false,
      engineActivationOrder: [],
      preservedState: preserved,
      developmental: devAge,
    };
  }

  private saveState(): void {
    try {
      KvStore.getInstance().set(CYCLE_KEY, this.state);
    } catch { /* ignore */ }
  }

  // ── PUBLIC API ──

  getState(): WorldCycleState {
    return { ...this.state };
  }

  /** Current world phase */
  getPhase(): WorldPhaseType {
    return this.state.phase;
  }

  /** Progress through current phase (0-1) */
  getPhaseProgress(): number {
    return this.state.phaseProgress;
  }

  /** Total expansion scale */
  getExpansionScale(): number {
    return this.state.expansionScale;
  }

  /** Number of completed cycles */
  getCycleCount(): number {
    return this.state.completedCycles;
  }

  /** Active engines right now */
  getActiveEngines(): string[] {
    return [...this.state.activeEngines];
  }

  /** Check if a specific engine should be active */
  isEngineActive(engineId: string): boolean {
    return this.state.activeEngines.includes(engineId);
  }

  /** Avatar position in the cosmos */
  getAvatarPosition(): string {
    return this.state.avatarPosition;
  }

  // ── LIFECYCLE CONTROL ──

  /** Start the world lifecycle tick */
  start(): void {
    if (this.tickInterval) return;

    this.tickInterval = setInterval(() => {
      if (!this.paused) {
        this.tick(0.1 * this.speed); // ~100ms intervals, scaled by speed
      }
    }, 100);

    // Activate initial engines
    this.syncEngines();
    this.emit();
  }

  /** Stop the lifecycle */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /** Pause the lifecycle */
  pause(): void {
    this.paused = true;
  }

  /** Resume the lifecycle */
  resume(): void {
    this.paused = false;
  }

  /** Set simulation speed multiplier */
  setSpeed(multiplier: number): void {
    this.speed = Math.max(0.1, Math.min(10, multiplier));
  }

  /** Force advance to a specific phase (for testing/manual control) */
  advanceToPhase(phase: WorldPhaseType): void {
    this.state.phase = phase;
    this.state.phaseProgress = 0;
    this.state.phaseStartedAt = Date.now();
    this.state.expansionScale = PHASE_EXPANSION_SCALE[phase];
    this.state.avatarPosition = PHASE_AVATAR_POSITION[phase];
    this.syncEngines();
    this.emit();
    this.saveState();
  }

  /** Subscribe to lifecycle changes */
  subscribe(listener: WorldLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Register a callback for when a specific phase begins */
  onPhaseEnter(phase: WorldPhaseType, callback: () => void | Promise<void>): void {
    const existing = this.phaseCallbacks.get(phase) ?? [];
    existing.push(callback);
    this.phaseCallbacks.set(phase, existing);
  }

  // ── CORE TICK ──

  private tick(delta: number): void {
    const currentPhase = this.state.phase;
    if (!this.state.developmental) {
      this.state.developmental = {
        complexity: 0, completedCycles: 0, meaningfulMemoryCount: 0,
        reflectionCount: 0, discoveryCount: 0, artifactCount: 0,
        projectCount: 0, worldComplexity: 0, engineComplexity: 0,
        currentCycleDuration: calculateCycleDuration(0),
      };
    }
    const phaseDuration = getPhaseDuration(currentPhase, this.state.developmental.complexity);

    // Advance phase progress
    this.state.cycleTime += delta;
    this.state.phaseProgress = Math.min(
      1,
      this.state.phaseProgress + delta / phaseDuration,
    );

    // Compute expansion scale within the phase
    const currentScale = PHASE_EXPANSION_SCALE[currentPhase];
    const nextPhase = this.getNextPhase(currentPhase);
    const nextScale = nextPhase ? PHASE_EXPANSION_SCALE[nextPhase] : currentScale;
    this.state.expansionScale = currentScale + (nextScale - currentScale) * this.state.phaseProgress;

    // Phase transition
    if (this.state.phaseProgress >= 1) {
      this.transitionToNextPhase();
    }

    this.emit();
    this.saveState();
  }

  private getNextPhase(current: WorldPhaseType): WorldPhaseType | null {
    const idx = PHASE_ORDER.indexOf(current);
    return idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : null;
  }

  private async transitionToNextPhase(): Promise<void> {
    const currentPhase = this.state.phase;
    const nextPhase = this.getNextPhase(currentPhase);

    if (!nextPhase) {
      // End of all phases — cycle complete
      this.completeCycle();
      return;
    }

    // Handle special transitions
    if (currentPhase === WorldPhase.COLLAPSE && nextPhase === WorldPhase.REBIRTH) {
      this.state.collapsing = false;
      this.state.rebirthing = true;
    }

    if (currentPhase === WorldPhase.REBIRTH) {
      this.state.rebirthing = false;
      this.completeCycle();
      return;
    }

    if (currentPhase === WorldPhase.SUNSET) {
      this.state.collapsing = true;
    }

    // Transition
    this.state.phase = nextPhase;
    this.state.phaseProgress = 0;
    this.state.phaseStartedAt = Date.now();
    this.state.expansionScale = PHASE_EXPANSION_SCALE[nextPhase];
    this.state.avatarPosition = PHASE_AVATAR_POSITION[nextPhase];

    // Sync engines for new phase
    this.syncEngines();

    // Fire phase callbacks
    const callbacks = this.phaseCallbacks.get(nextPhase) ?? [];
    for (const cb of callbacks) {
      try { await cb(); } catch { /* ignore */ }
    }

    this.emit();
  }

  /** Complete the current cycle and start the next */
  private completeCycle(): void {
    // Archive this cycle's history
    this.archiveCycle();

    // Preserve important state across cycles
    this.preserveState();

    // Increment completed cycles
    this.state.completedCycles += 1;

    // Start a fresh cycle
    const fresh = this.createFreshCycle();
    this.state = fresh;

    // Sync to initial engines
    this.syncEngines();

    // Fire rebirth callbacks
    const callbacks = this.phaseCallbacks.get(WorldPhase.CORE_SEED) ?? [];
    for (const cb of callbacks) {
      try { cb(); } catch { /* ignore */ }
    }

    this.emit();
    this.saveState();
  }

  // ── ENGINE SYNCHRONIZATION ──

  /** Sync engine activations with current phase */
  syncEngines(): void {
    const targetEngines = getActiveEnginesForPhase(this.state.phase);

    // Track newly activated engines
    const newEngines = targetEngines.filter(
      (e) => !this.state.activeEngines.includes(e),
    );
    this.state.engineActivationOrder.push(...newEngines);

    this.state.activeEngines = targetEngines;
  }

  // ── CYCLE ARCHIVAL ──

  private archiveCycle(): void {
    try {
      const history = KvStore.getInstance().get<Array<{
        cycleId: string;
        completedCycles: number;
        duration: number;
        enginesActivated: string[];
        preservedArtifacts: number;
      }>>(HISTORY_KEY) ?? [];

      history.push({
        cycleId: this.state.cycleId,
        completedCycles: this.state.completedCycles,
        duration: this.state.cycleTime,
        enginesActivated: this.state.engineActivationOrder,
        preservedArtifacts: this.state.preservedState.artifacts.length,
      });

      // Keep last 50 cycles
      if (history.length > 50) {
        history.splice(0, history.length - 50);
      }

      KvStore.getInstance().set(HISTORY_KEY, history);
    } catch { /* ignore */ }
  }

  private preserveState(): void {
    // During collapse, the system should have saved important data
    // into preservedState. We ensure it survives by carrying it forward.
    if (!this.state.preservedState) {
      this.state.preservedState = {
        discoveries: [],
        artifacts: [],
        memories: [],
        reflections: [],
        engineVersions: {},
      };
    }
  }

  /** Add a discovery to preserved state (called by other systems) */
  addDiscovery(discovery: string): void {
    this.state.preservedState.discoveries.push(discovery);
    this.state.developmental.discoveryCount += 1;
    this.recalculateComplexity();
  }

  /** Add an artifact to preserved state */
  addArtifact(artifact: string): void {
    this.state.preservedState.artifacts.push(artifact);
    this.state.developmental.artifactCount += 1;
    this.recalculateComplexity();
  }

  /** Add a memory to preserved state */
  addMemory(memory: string): void {
    this.state.preservedState.memories.push(memory);
    this.state.developmental.meaningfulMemoryCount += 1;
    this.recalculateComplexity();
  }

  /** Add a reflection to preserved state */
  addReflection(reflection: string): void {
    this.state.preservedState.reflections.push(reflection);
    this.state.developmental.reflectionCount += 1;
    this.recalculateComplexity();
  }

  /** Update world complexity (called by engines as world develops) */
  updateWorldComplexity(value: number): void {
    this.state.developmental.worldComplexity = Math.min(1, value);
    this.recalculateComplexity();
  }

  /** Update engine complexity */
  updateEngineComplexity(value: number): void {
    this.state.developmental.engineComplexity = Math.min(1, value);
    this.recalculateComplexity();
  }

  /** Update project count */
  updateProjectCount(count: number): void {
    this.state.developmental.projectCount = count;
    this.recalculateComplexity();
  }

  /** Recalculate developmental complexity */
  private recalculateComplexity(): void {
    this.state.developmental.complexity = calculateDevelopmentalComplexity(this.state.developmental);
    this.state.developmental.currentCycleDuration = calculateCycleDuration(this.state.developmental.complexity);
    this.saveState();
  }

  /** Get current developmental age */
  getDevelopmentalAge(): DevelopmentalAge {
    return { ...this.state.developmental };
  }

  /** Get current cycle duration */
  getCycleDuration(): number {
    return this.state.developmental.currentCycleDuration;
  }

  /** Get current phase duration */
  getCurrentPhaseDuration(): number {
    return getPhaseDuration(this.state.phase, this.state.developmental.complexity);
  }

  /** Get speed multiplier */
  getSpeed(): number {
    return this.speed;
  }

  /** Is paused */
  isPaused(): boolean {
    return this.paused;
  }

  // ── EMITTER ──

  private emit(): void {
    const snapshot = { ...this.state };
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* ignore */ }
    }
  }

  // ── CLEANUP ──

  shutdown(): void {
    this.stop();
    this.listeners.clear();
    this.phaseCallbacks.clear();
    WorldLifecycle.instance = null;
  }
}
