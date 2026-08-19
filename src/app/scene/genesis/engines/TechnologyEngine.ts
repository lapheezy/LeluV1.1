/**
 * ==========================================================
 * LÉLUVERSE
 * TECHNOLOGY ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class TechnologyEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.civilizations < 0.3) return;

    state.teaching = Math.min(
      1,
      state.teaching +
      delta * 0.00008,
    );

  }

}