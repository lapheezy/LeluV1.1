/**
 * ==========================================================
 * LÉLUVERSE
 * DREAM ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class DreamEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.awareness < 0.5) return;

    state.simulation +=
      delta *
      0.05;

  }

}