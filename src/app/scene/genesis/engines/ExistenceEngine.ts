/**
 * ==========================================================
 * LÉLUVERSE
 * EXISTENCE ENGINE
 *
 * Persistence layer of Genesis reality.
 *
 * Reality forms.
 * Existence endures.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class ExistenceEngine {


  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    /*
     * Existence coherence
     */

    const coherence =

      (

        state.reality +

        state.stability +

        state.consciousness +

        state.matter

      ) / 4;



    /*
     * Stabilize existence
     */

    state.existence = Math.min(

      1,

      state.existence +

      coherence *

      delta *

      0.01,

    );



    /*
     * Reality feedback
     */

    if(

      state.existence > 0.5

    ){

      state.reality = Math.min(

        1,

        state.reality +

        delta *

        0.002,

      );

    }



    /*
     * Higher dimensions emerge
     */

    if(

      state.existence > 0.8 &&

      state.dimension < 5

    ){

      state.dimension =

        (

          state.dimension + 1

        ) as 1 | 2 | 3 | 4 | 5;

    }



  }


}