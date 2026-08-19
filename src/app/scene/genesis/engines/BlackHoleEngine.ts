/**
 * ==========================================================
 * LÉLUVERSE
 * BLACK HOLE ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class BlackHoleEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (
      state.gravity < 0.8
    ) return;

    state.energy = Math.max(
      0,
      state.energy -
      delta * 0.00005,
    );

  }

}