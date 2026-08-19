/**
 * ==========================================================
 * LÉLUVERSE
 * SIMULATION ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class SimulationEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.simulation +=
      delta *
      state.speed;

  }

}