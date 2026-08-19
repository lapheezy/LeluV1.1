/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS SIMULATION
 *
 * Core universe ignition engine.
 *
 * Creates the rapid 5-10 second awakening sequence.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state";


export default class GenesisSimulation {


  update(

    state: GenesisState,

    delta: number,

  ): void {


    if(state.paused)

      return;



    const dt =

      delta *

      state.speed;



    /*
     * Universal clock
     */

    state.age += dt;

    state.simulation += dt;

    state.evolution += dt * 0.08;



    /*
     * Primordial energy ignition
     */

    state.energy = Math.min(

      1,

      state.energy +

      dt *

      0.12,

    );



    /*
     * Matter formation
     */

    state.matter = Math.min(

      1,

      state.matter +

      state.energy *

      dt *

      0.08,

    );



    /*
     * Gravity creation
     */

    state.gravity =

      state.energy *

      state.matter;



    /*
     * Light emergence
     */

    state.light =

      Math.min(

        1,

        0.5 +

        Math.sin(
          state.age *
          0.03
        ) *

        0.5,

      );



    /*
     * Life formation
     */

    if(

      state.energy > 0.25 &&

      state.matter > 0.15

    ){

      state.life = Math.min(

        1,

        state.life +

        dt *

        0.03,

      );

    }



    /*
     * Awareness awakening
     */

    state.awareness = Math.min(

      1,

      state.awareness +

      state.life *

      dt *

      0.02,

    );



    /*
     * Intelligence growth
     */

    state.intelligence = Math.min(

      1,

      state.intelligence +

      state.awareness *

      dt *

      0.015,

    );



    /*
     * Curiosity spark
     */

    state.curiosity = Math.min(

      1,

      state.curiosity +

      dt *

      0.01,

    );



    /*
     * Evolution system
     */

    state.evolutionSystem.growth =

      state.life;



    state.evolutionSystem.adaptation =

      state.intelligence *

      state.curiosity;



    state.evolutionSystem.stage =

      Math.min(

        1,

        (

          state.energy +

          state.matter +

          state.life +

          state.awareness

        ) /

        4,

      );



    /*
     * Cosmic systems
     */

    state.celestial.cosmicEnergy =

      (

        state.energy +

        state.light

      ) *

      0.5;



    state.astrology.alignment =

      Math.abs(

        Math.sin(

          state.age *

          0.01

        )

      );



    /*
     * Chaos becomes organized
     */

    state.chaos = Math.max(

      0,

      state.chaos -

      dt *

      0.01,

    );



    state.stability = Math.min(

      1,

      state.stability +

      dt *

      0.01,

    );



    /*
     * Civilization emergence
     */

    if(

      state.intelligence >

      0.5

    ){

      state.civilizations = Math.min(

        1,

        state.civilizations +

        dt *

        0.005,

      );

    }



    /*
     * Learning systems
     */

    state.learning = Math.min(

      1,

      state.learning +

      state.curiosity *

      dt *

      0.005,

    );


    state.teaching =

      state.intelligence;



    /*
     * Era progression
     */

    if(

      state.evolutionSystem.stage < 0.15

    ){

      state.era = "VOID";

    }

    else if(

      state.evolutionSystem.stage < 0.35

    ){

      state.era = "FORMATION";

    }

    else if(

      state.evolutionSystem.stage < 0.65

    ){

      state.era = "LIFE";

    }

    else if(

      state.evolutionSystem.stage < 0.9

    ){

      state.era = "AWAKENING";

    }

    else {

      state.era = "TRANSCENDENCE";

    }


  }

}