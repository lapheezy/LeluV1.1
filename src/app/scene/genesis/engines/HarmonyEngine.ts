/**
 * ==========================================================
 * LÉLUVERSE
 * HARMONY ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class HarmonyEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.stability = Math.min(
      1,
      state.stability +
      delta *
      0.00015,
    );

    state.chaos = Math.max(
      0,
      state.chaos -
      delta *
      0.0001,
    );

  }

}