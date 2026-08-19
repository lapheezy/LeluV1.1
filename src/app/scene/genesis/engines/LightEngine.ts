/**
 * ==========================================================
 * LÉLUVERSE
 * LIGHT ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class LightEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.light = Math.min(
      1,
      state.light +
      state.energy *
      delta *
      0.0002,
    );

  }

}