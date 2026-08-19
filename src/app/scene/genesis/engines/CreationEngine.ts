/**
 * ==========================================================
 * LÉLUVERSE
 * CREATION ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class CreationEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.existence < 0.5) return;

    state.reality = Math.min(
      1,
      state.reality +
      delta * 0.0001,
    );

  }

}