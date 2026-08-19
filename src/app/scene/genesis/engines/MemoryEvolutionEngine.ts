/**
 * ==========================================================
 * LÉLUVERSE
 * MEMORY EVOLUTION ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class MemoryEvolutionEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.learning < 0.2) return;

    state.learning = Math.min(
      1,
      state.learning +
      delta * 0.00005,
    );

  }

}