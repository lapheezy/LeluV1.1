/**
 * ==========================================================
 * LÉLUVERSE
 * GRAVITY ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class GravityEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.gravity = Math.min(
      1,
      state.gravity +
      state.matter *
      delta *
      0.0002,
    );

  }

}