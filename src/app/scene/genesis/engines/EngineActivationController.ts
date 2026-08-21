/**
 * ==========================================================
 * LÉLUVERSE
 * ENGINE ACTIVATION CONTROLLER
 *
 * Handles smooth engine activation/deactivation during
 * world lifecycle transitions. Prevents jarring on/off
 * switches — engines fade in/out based on dependency
 * readiness and phase requirements.
 *
 * Used by WorldLifecycle during phase transitions.
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";
import {
  ENGINE_DOMAINS,
  type WorldPhaseType,
  getActiveEnginesForPhase,
  areDependenciesMet,
} from "./EngineDomains";
import WorldLifecycle from "./WorldLifecycle";

// ── TYPES ──

export interface EngineActivation {
  engineId: string;
  targetWeight: number;   // 0 = fully off, 1 = fully on
  currentWeight: number;  // interpolated 0-1
  phase: WorldPhaseType;
  activatedAt: number;
  dependenciesMet: boolean;
}

export type ActivationControllerListener = (activations: Map<string, EngineActivation>) => void;

// ── ENGINE ACTIVATION CONTROLLER ──

export default class EngineActivationController {
  private static instance: EngineActivationController | null = null;

  private activations = new Map<string, EngineActivation>();
  private listeners = new Set<ActivationControllerListener>();
  private fadeSpeed = 0.5; // weight change per second

  private constructor() {}

  static getInstance(): EngineActivationController {
    if (!EngineActivationController.instance) {
      EngineActivationController.instance = new EngineActivationController();
    }
    return EngineActivationController.instance;
  }

  // ── PUBLIC API ──

  /** Update activations based on current world phase. Call each frame. */
  update(delta: number, _state: GenesisState): void {
    const lifecycle = WorldLifecycle.getInstance();
    const phase = lifecycle.getPhase();
    const targetEngines = getActiveEnginesForPhase(phase);
    const targetSet = new Set(targetEngines);
    const activeSet = new Set(
      [...this.activations.entries()]
        .filter(([, a]) => a.currentWeight > 0.01)
        .map(([id]) => id),
    );

    // Ensure all target engines have an activation entry
    for (const engineId of targetEngines) {
      if (!this.activations.has(engineId)) {
        const depsMet = areDependenciesMet(engineId, activeSet);
        this.activations.set(engineId, {
          engineId,
          targetWeight: 1,
          currentWeight: 0,
          phase,
          activatedAt: Date.now(),
          dependenciesMet: depsMet,
        });
      } else {
        const activation = this.activations.get(engineId)!;
        activation.targetWeight = 1;
        activation.dependenciesMet = areDependenciesMet(engineId, activeSet);
      }
    }

    // Deactivate engines not in the target set
    for (const [engineId, activation] of this.activations) {
      if (!targetSet.has(engineId)) {
        activation.targetWeight = 0;
      }
    }

    // Interpolate all activations
    for (const activation of this.activations.values()) {
      if (activation.currentWeight < activation.targetWeight) {
        activation.currentWeight = Math.min(
          activation.targetWeight,
          activation.currentWeight + this.fadeSpeed * delta,
        );
      } else if (activation.currentWeight > activation.targetWeight) {
        activation.currentWeight = Math.max(
          activation.targetWeight,
          activation.currentWeight - this.fadeSpeed * delta,
        );
      }
    }

    // Remove fully faded engines
    for (const [engineId, activation] of this.activations) {
      if (activation.currentWeight <= 0 && activation.targetWeight <= 0) {
        this.activations.delete(engineId);
      }
    }

    this.emit();
  }

  /** Get the current weight of an engine (0-1) */
  getEngineWeight(engineId: string): number {
    return this.activations.get(engineId)?.currentWeight ?? 0;
  }

  /** Get all activations */
  getActivations(): Map<string, EngineActivation> {
    return new Map(this.activations);
  }

  /** Check if an engine is fully active */
  isFullyActive(engineId: string): boolean {
    const a = this.activations.get(engineId);
    return a ? a.currentWeight > 0.95 : false;
  }

  /** Check if an engine is fully inactive */
  isFullyInactive(engineId: string): boolean {
    const a = this.activations.get(engineId);
    return !a || a.currentWeight < 0.05;
  }

  /** Get count of active engines per domain */
  getActiveCountPerDomain(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [engineId, activation] of this.activations) {
      if (activation.currentWeight > 0.1) {
        const domain = ENGINE_DOMAINS[engineId] ?? "unknown";
        counts[domain] = (counts[domain] ?? 0) + 1;
      }
    }
    return counts;
  }

  /** Get all engines that are currently fading in */
  getFadingIn(): string[] {
    return [...this.activations.entries()]
      .filter(([, a]) => a.currentWeight > 0.05 && a.currentWeight < a.targetWeight - 0.05)
      .map(([id]) => id);
  }

  /** Get all engines that are currently fading out */
  getFadingOut(): string[] {
    return [...this.activations.entries()]
      .filter(([, a]) => a.currentWeight > 0.05 && a.currentWeight > a.targetWeight + 0.05)
      .map(([id]) => id);
  }

  // ── SUBSCRIPTION ──

  subscribe(listener: ActivationControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = new Map(this.activations);
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* ignore */ }
    }
  }

  // ── CLEANUP ──

  shutdown(): void {
    this.activations.clear();
    this.listeners.clear();
    EngineActivationController.instance = null;
  }
}
