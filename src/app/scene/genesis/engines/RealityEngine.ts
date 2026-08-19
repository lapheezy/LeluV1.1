/**
 * ==========================================================
 * LÉLUVERSE
 * REALITY ENGINE
 *
 * Converts possibility into stable existence.
 *
 * Controls:
 * - reality formation
 * - dimensional stability
 * - existence coherence
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class RealityEngine {


  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    /*
     * Reality emerges from
     * matter + awareness + stability
     */

    const coherence =

      (

        state.matter +

        state.awareness +

        state.stability

      ) / 3;



    state.reality = Math.min(

      1,

      state.reality +

      coherence *

      delta *

      0.01,

    );



    /*
     * Existence follows reality
     */

    state.existence = Math.min(

      1,

      state.existence +

      state.reality *

      delta *

      0.008,

    );



    /*
     * Dimension expansion
     */

    if(

      state.reality > 0.75 &&

      state.dimension < 5

    ){

      state.dimension =

        (state.dimension + 1) as 1 | 2 | 3 | 4 | 5;

    }



  }


}