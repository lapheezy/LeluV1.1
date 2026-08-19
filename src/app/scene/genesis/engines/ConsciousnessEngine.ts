/**
 * ==========================================================
 * LÉLUVERSE
 * CONSCIOUSNESS ENGINE
 *
 * Living cognition layer.
 *
 * Converts life and experience into awareness.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";

import type {
  GenesisSignals,
} from "./GenesisSignals";


export default class ConsciousnessEngine {


  update(

    state: GenesisState,

    delta:number,

    signals?: GenesisSignals,

  ):void {


    if(state.paused)

      return;



    if(state.life <= 0)

      return;



    /*
     * Awareness emerges from life
     */

    const awarenessGrowth =

      state.life *

      state.memory.importance;



    state.awareness = Math.min(

      1,

      state.awareness +

      awarenessGrowth *

      delta *

      0.01,

    );



    /*
     * Intelligence emerges from awareness — reasoning in
     * progress accelerates this beyond the ambient rate,
     * since active reasoning is exactly intelligence at work.
     */

    const reasoningBoost =
      signals?.reasoningActive ? 2 : 1;

    state.intelligence = Math.min(

      1,

      state.intelligence +

      state.awareness *

      delta *

      0.008 *

      reasoningBoost,

    );



    /*
     * Curiosity drives exploration
     */

    state.curiosity = Math.min(

      1,

      state.curiosity +

      (

        state.intelligence +

        state.awareness

      ) *

      delta *

      0.004,

    );



    /*
     * Learning synchronization
     */

    state.learning = Math.min(

      1,

      state.learning +

      state.curiosity *

      delta *

      0.006,

    );



    /*
     * Consciousness field — speaking is LÉLU actively
     * expressing itself, so it should read as a clear rise
     * in the field rather than the same slow ambient blend.
     */

    const baseline =

      (

        state.awareness +

        state.intelligence +

        state.learning

      ) / 3;

    state.consciousness = Math.min(

      1,

      signals?.speaking
        ? Math.max(state.consciousness, baseline) + delta * 0.08
        : baseline,

    );



    /*
     * Teaching ability
     */

    state.teaching =

      state.intelligence;



  }


}
