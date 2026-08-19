/**
 * ==========================================================
 * LÉLUVERSE
 * MATTER ENGINE
 *
 * Controls physical structure formation.
 *
 * Energy creates matter.
 * Matter creates worlds.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class MatterEngine {


  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    /*
     * Matter stability
     */

    const formation =

      state.energy *

      state.gravity;



    /*
     * Density growth
     */

    state.matter = Math.min(

      1,

      state.matter +

      formation *

      delta *

      0.015,

    );



    /*
     * Gravity emerges from structure
     */

    state.gravity =

      Math.min(

        1,

        (

          state.energy +

          state.matter

        ) *

        0.5,

      );



    /*
     * Physical reality increases
     */

    state.reality = Math.min(

      1,

      state.reality +

      state.matter *

      delta *

      0.01,

    );



    /*
     * Evolution material support
     */

    state.evolutionSystem.growth =

      Math.min(

        1,

        state.evolutionSystem.growth +

        state.matter *

        delta *

        0.005,

      );


  }


}