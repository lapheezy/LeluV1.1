/**
 * ==========================================================
 * LÉLUVERSE
 * ATMOSPHERE ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class AtmosphereEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.gravity < 0.3) return;

    state.reality = Math.min(
      1,
      state.reality +
      delta * 0.00008,
    );

  }

}