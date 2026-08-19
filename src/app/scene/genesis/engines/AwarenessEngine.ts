/**
 * ==========================================================
 * LÉLUVERSE
 * AWARENESS ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";
import type { GenesisSignals } from "./GenesisSignals";

export default class AwarenessEngine {

  update(
    state: GenesisState,
    delta: number,
    signals?: GenesisSignals,
  ): void {

    if (state.paused) return;

    /*
     * Ambient drift — the permanent low heartbeat that keeps
     * the core feeling alive even when nothing is happening.
     */
    state.awareness = Math.min(
      1,
      state.awareness +
      state.consciousness *
      delta *
      0.0002,
    );

    /*
     * Real attention.
     *
     * Thinking and listening mean LÉLU is actually paying
     * attention to something right now — awareness should
     * rise faster than the ambient drift while that's
     * happening, and relax back down once it stops.
     */
    const attending =
      Boolean(signals?.thinking) ||
      Boolean(signals?.listening);

    if (attending) {
      state.awareness = Math.min(
        1,
        state.awareness + delta * 0.05,
      );
    }
    else {
      state.awareness = Math.max(
        0,
        state.awareness - delta * 0.01,
      );
    }

  }

}
