/**
 * ==========================================================
 * LÉLUVERSE
 * QUANTUM ENGINE
 *
 * Controls invisible probability fields.
 *
 * Energy creates the universe.
 * Quantum decides how it evolves.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class QuantumEngine {


  private time = 0;



  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    this.time += delta;



    /*
     * Quantum fluctuation
     */

    const fluctuation =

      (

        Math.sin(

          this.time *

          1.7

        ) +

        Math.cos(

          this.time *

          0.8

        )

      ) *

      0.5;



    /*
     * Probability field
     */

    const quantumLevel =

      Math.abs(

        fluctuation

      );



    /*
     * Reality instability
     */

    state.reality = Math.min(

      1,

      state.reality +

      quantumLevel *

      delta *

      0.005,

    );



    /*
     * Core energy pulse
     */

    state.energy = Math.min(

      1,

      state.energy +

      quantumLevel *

      delta *

      0.003,

    );



    /*
     * Chaos naturally settles
     */

    state.chaos = Math.max(

      0,

      state.chaos -

      quantumLevel *

      delta *

      0.002,

    );



    /*
     * Evolution mutation influence
     */

    state.evolutionSystem.mutation = Math.min(

      1,

      state.evolutionSystem.mutation +

      quantumLevel *

      delta *

      0.01,

    );


  }


}