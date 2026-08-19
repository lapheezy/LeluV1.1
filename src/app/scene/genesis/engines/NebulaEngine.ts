/**
 * ==========================================================
 * LÉLUVERSE
 * NEBULA ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class NebulaEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.energy < 0.25) return;

    state.matter = Math.min(
      1,
      state.matter +
      delta * 0.00012,
    );

  }

}