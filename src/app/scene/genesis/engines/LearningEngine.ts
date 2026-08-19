/**
 * ==========================================================
 * LÉLUVERSE
 * LEARNING ENGINE
 *
 * Converts curiosity and memory into knowledge growth.
 *
 * Consciousness discovers.
 * Learning organizes.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class LearningEngine {


  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    /*
     * Learning comes from:
     * curiosity + memory + awareness
     */

    const learningForce =

      (

        state.curiosity +

        state.memory.importance +

        state.awareness

      ) / 3;



    state.learning = Math.min(

      1,

      state.learning +

      learningForce *

      delta *

      0.01,

    );



    /*
     * Long term memory growth
     */

    state.memory.longTerm = Math.min(

      1,

      state.memory.longTerm +

      state.learning *

      delta *

      0.005,

    );



    /*
     * Teaching ability
     */

    state.teaching =

      (

        state.learning +

        state.intelligence

      ) / 2;



  }


}