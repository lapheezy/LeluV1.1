/**
 * ==========================================================
 * LÉLUVERSE
 * TIMELINE ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class TimelineEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.age +=
      delta *
      state.speed;

  }

}