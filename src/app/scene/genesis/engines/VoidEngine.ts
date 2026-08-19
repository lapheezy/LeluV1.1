/**
 * ==========================================================
 * LÉLUVERSE
 * VOID ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class VoidEngine {

  update(
    state: GenesisState,
    _delta: number,
  ): void {

    if (state.paused) return;

    if (state.age > 1) return;

    state.chaos = 1;

    state.energy = 0;

    state.matter = 0;

  }

}