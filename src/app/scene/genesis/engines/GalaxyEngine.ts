/**
 * ==========================================================
 * LÉLUVERSE
 * GALAXY ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class GalaxyEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (

      state.light < 0.4

    ) return;

    state.existence = Math.min(
      1,
      state.existence +
      delta *
      0.0001,
    );

  }

}