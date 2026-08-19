/**
 * ==========================================================
 * LÉLUVERSE
 * CURIOSITY ENGINE
 *
 * Exploration and discovery pressure.
 *
 * Consciousness creates curiosity.
 * Curiosity creates evolution.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class CuriosityEngine {


  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    if(

      state.curiosity <= 0

    )

      return;



    /*
     * Curiosity drives exploration
     */

    const exploration =

      state.curiosity *

      state.learning;



    /*
     * Increase evolution adaptation
     */

    state.evolutionSystem.adaptation = Math.min(

      1,

      state.evolutionSystem.adaptation +

      exploration *

      delta *

      0.01,

    );



    /*
     * Curiosity improves learning efficiency
     */

    state.learning = Math.min(

      1,

      state.learning +

      state.curiosity *

      delta *

      0.004,

    );



    /*
     * Curiosity feeds simulation complexity
     */

    state.simulation +=

      state.curiosity *

      delta *

      0.05;


  }


}