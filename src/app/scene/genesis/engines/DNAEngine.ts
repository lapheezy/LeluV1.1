/**
 * ==========================================================
 * LÉLUVERSE
 * DNA ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class DNAEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.life < 0.5) return;

    state.learning = Math.min(
      1,
      state.learning +
      delta * 0.0001,
    );

  }

}