/**
 * ==========================================================
 * LÉLUVERSE
 * INTERACTION ENGINE
 *
 * Converts live interface/navigation events into small, bounded
 * changes in the canonical Genesis simulation state. Rendering
 * remains owned by GenesisRenderer; this engine only records
 * interaction pressure for the existing evolution channels.
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";
import type { GenesisSignals } from "./GenesisSignals";

export default class InteractionEngine {
  readonly id = "interaction";
  readonly priority = 15;

  private interactionEnergy = 0;

  handleEvent(
    event: string,
    payload: unknown,
    state?: GenesisState,
  ): void {
    if (!state) {
      return;
    }

    const data = payload as {
      kind?: string;
      target?: { type?: string };
    } | undefined;

    const kind = data?.kind ?? event;
    const amount = kind === "destination" || data?.target?.type === "core"
      ? 0.12
      : kind === "workspace" || event.includes("workspace")
        ? 0.08
        : 0.04;

    this.interactionEnergy = Math.min(
      1,
      this.interactionEnergy + amount,
    );

    state.curiosity = Math.min(
      1,
      state.curiosity + amount * 0.08,
    );
    state.evolutionSystem.mutation = Math.min(
      1,
      state.evolutionSystem.mutation + amount * 0.04,
    );
    state.pulse.intensity = Math.min(
      1,
      Math.max(state.pulse.intensity, 0.35 + this.interactionEnergy * 0.35),
    );
  }

  update(
    state: GenesisState,
    delta: number,
    _signals?: GenesisSignals,
  ): void {
    if (state.paused) {
      return;
    }

    this.interactionEnergy = Math.max(
      0,
      this.interactionEnergy - delta * 0.18,
    );

    state.pulse.intensity = Math.max(
      state.pulse.heartbeat,
      state.pulse.intensity - delta * 0.12,
    );
  }
}
