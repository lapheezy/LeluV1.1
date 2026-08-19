/**
 * ==========================================================
 * LÉLUVERSE
 * KNOWLEDGE ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class KnowledgeEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.teaching = Math.min(
      1,
      state.teaching +
      state.learning *
      delta *
      0.00015,
    );

  }

}