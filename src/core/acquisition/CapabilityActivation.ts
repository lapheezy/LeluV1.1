/**
 * ==========================================================
 * LÉLU — CAPABILITY ACTIVATION
 *
 * The durable answer to "is this capability switched on?".
 *
 * The marketplace is not allowed to be a UI toggle: deactivating
 * an acquired capability disables the tools that actually execute
 * it, so `toolPermitted()` stops offering them and the dispatcher
 * refuses them. Reactivating restores exactly the tools the
 * capability registered.
 *
 * Removal is separate: a removed capability stays removed even if
 * a stale registry entry is re-added, until it is explicitly
 * restored.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface ActivationState {
  disabledCapabilities: string[];
  disabledTools: string[];
  removedCapabilities: string[];
  updatedAt: number;
}

const KEY = "lelu.acquisition.activation.v1";

const EMPTY: ActivationState = {
  disabledCapabilities: [],
  disabledTools: [],
  removedCapabilities: [],
  updatedAt: 0,
};

export default class CapabilityActivation {
  private static instance: CapabilityActivation | null = null;

  static getInstance(): CapabilityActivation {
    if (!CapabilityActivation.instance) CapabilityActivation.instance = new CapabilityActivation();
    return CapabilityActivation.instance;
  }

  static resetForTests(): void {
    CapabilityActivation.instance = null;
  }

  state(): ActivationState {
    try {
      const stored = KvStore.getInstance().get<ActivationState>(KEY);
      if (stored && Array.isArray(stored.disabledCapabilities)) {
        return {
          disabledCapabilities: stored.disabledCapabilities,
          disabledTools: Array.isArray(stored.disabledTools) ? stored.disabledTools : [],
          removedCapabilities: Array.isArray(stored.removedCapabilities) ? stored.removedCapabilities : [],
          updatedAt: stored.updatedAt ?? 0,
        };
      }
    } catch {
      /* storage unavailable — everything defaults to enabled */
    }
    return { ...EMPTY };
  }

  private save(state: ActivationState): void {
    try {
      KvStore.getInstance().set(KEY, { ...state, updatedAt: Date.now() });
    } catch {
      /* best effort; the in-memory answer below is still honest */
    }
  }

  isCapabilityActive(capabilityId: string): boolean {
    return !this.state().disabledCapabilities.includes(capabilityId) && !this.isRemoved(capabilityId);
  }

  isRemoved(capabilityId: string): boolean {
    return this.state().removedCapabilities.includes(capabilityId);
  }

  /** Is a tool's capability switched on? Tools not bound to a capability stay on. */
  isToolEnabled(toolId: string): boolean {
    return !this.state().disabledTools.includes(toolId);
  }

  setCapability(capabilityId: string, active: boolean, tools: readonly string[]): ActivationState {
    const state = this.state();
    const disabledCapabilities = new Set(state.disabledCapabilities);
    const disabledTools = new Set(state.disabledTools);
    if (active) {
      disabledCapabilities.delete(capabilityId);
      for (const tool of tools) disabledTools.delete(tool);
    } else {
      disabledCapabilities.add(capabilityId);
      for (const tool of tools) disabledTools.add(tool);
    }
    const next: ActivationState = {
      ...state,
      disabledCapabilities: [...disabledCapabilities],
      disabledTools: [...disabledTools],
      updatedAt: Date.now(),
    };
    this.save(next);
    return next;
  }

  markRemoved(capabilityId: string, tools: readonly string[]): ActivationState {
    const state = this.setCapability(capabilityId, false, tools);
    const removed = new Set(state.removedCapabilities);
    removed.add(capabilityId);
    const next: ActivationState = {
      ...state,
      removedCapabilities: [...removed],
      updatedAt: Date.now(),
    };
    this.save(next);
    return next;
  }

  restore(capabilityId: string): ActivationState {
    const state = this.state();
    const removed = state.removedCapabilities.filter((id) => id !== capabilityId);
    const next: ActivationState = { ...state, removedCapabilities: removed, updatedAt: Date.now() };
    this.save(next);
    return next;
  }

  reset(): void {
    this.save({ ...EMPTY, updatedAt: Date.now() });
  }
}
