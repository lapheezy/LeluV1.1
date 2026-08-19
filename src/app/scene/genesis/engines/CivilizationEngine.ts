/**
 * ==========================================================
 * LÉLUVERSE
 * CIVILIZATION ENGINE
 *
 * Emergent intelligence systems.
 *
 * Knowledge becomes culture.
 * Culture becomes civilization.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class CivilizationEngine {


  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    /*
     * Civilization requires:
     * intelligence
     * learning
     * existence
     */

    const foundation =

      (

        state.intelligence +

        state.learning +

        state.teaching +

        state.existence

      ) / 4;



    if(

      foundation < 0.35

    )

      return;



    /*
     * Civilization growth
     */

    state.civilizations = Math.min(

      1,

      state.civilizations +

      foundation *

      delta *

      0.01,

    );



    /*
     * Memory preservation
     */

    state.memory.archived = Math.min(

      1,

      state.memory.archived +

      state.civilizations *

      delta *

      0.003,

    );



    /*
     * Reality complexity
     */

    state.reality = Math.min(

      1,

      state.reality +

      state.civilizations *

      delta *

      0.002,

    );



    /*
     * Teaching grows with civilization
     */

    state.teaching = Math.min(

      1,

      state.teaching +

      state.civilizations *

      delta *

      0.005,

    );


  }


}