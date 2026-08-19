/**
 * ==========================================================
 * LÉLUVERSE
 * BALANCE ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class BalanceEngine {

  update(
    state: GenesisState,
    _delta: number,
  ): void {

    if (state.paused) return;

    const average =

      (state.energy +

       state.matter +

       state.life) / 3;

    state.stability = Math.min(
      1,
      average,
    );

  }

}