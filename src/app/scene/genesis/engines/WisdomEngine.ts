/**
 * ==========================================================
 * LÉLUVERSE
 * WISDOM ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class WisdomEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.teaching < 0.25) return;

    state.awareness = Math.min(
      1,
      state.awareness +
      delta * 0.00008,
    );

  }

}