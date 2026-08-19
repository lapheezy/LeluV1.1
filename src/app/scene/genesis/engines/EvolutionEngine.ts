/**
 * ==========================================================
 * LÉLUVERSE
 * EVOLUTION ENGINE
 *
 * Controls mutation, stages, and consciousness states.
 *
 * Simulation creates.
 * Evolution transforms.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";

import {
  GenesisMode,
} from "../state";

import {
  GenesisEra,
} from "../timeline";


export type EvolutionPhase =
  | "Void"
  | "Emerging"
  | "Awakening"
  | "Transcending";



export default class EvolutionEngine {


  update(

    state: GenesisState,

    delta:number,

  ):void {


    if(state.paused)

      return;



    const dt =

      delta *

      state.speed;



    /*
     * Evolution pressure
     */

    const complexity =

      (

        state.energy +

        state.matter +

        state.life +

        state.awareness +

        state.intelligence +

        state.learning

      ) / 6;



    /*
     * Mutation growth
     */

    state.evolutionSystem.mutation =

      Math.min(

        1,

        state.evolutionSystem.mutation +

        dt *

        0.008 *

        complexity,

      );



    state.evolutionSystem.stage =

      Math.min(

        1,

        complexity +

        state.evolutionSystem.mutation *

        0.25,

      );



    /*
     * Adaptation
     */

    state.evolutionSystem.adaptation =

      Math.min(

        1,

        (

          state.curiosity +

          state.learning +

          state.awareness

        ) / 3,

      );



    /*
     * Civilization growth

     */

    if(

      state.intelligence > 0.5

    ){

      state.civilizations = Math.min(

        1,

        state.civilizations +

        dt *

        0.002,

      );

    }



    /*
     * Memory evolution

     */

    state.memory.importance =

      Math.min(

        1,

        (

          state.awareness +

          state.learning

        ) / 2,

      );    /*
     * Publish the visual evolution channels consumed by the active
     * core, mutation field, and shell renderers. These remain derived
     * from the canonical Genesis state; no second visual state machine
     * is introduced.
     */
    const visualStage =
      state.evolutionSystem.stage;

    /*
     * The bootstrap intentionally reaches its milestone values quickly
     * (GenesisState.speed defaults to 120). Keep those canonical values,
     * but let the visual channels breathe after they reach a milestone.
     * This is still derived from the single Genesis state: it prevents a
     * completed awakening from turning every shell and shader into a frozen
     * frame without introducing another animation/state system.
     */
    const visualCycle =
      0.5 +
      0.5 * Math.sin(
        state.age * 0.18 +
        state.evolutionSystem.mutation * 4.0,
      );

    state.evolutionSystem.colorShift = Math.min(
      1,
      visualStage * 0.55 +
      state.evolutionSystem.mutation * 0.15 +
      visualCycle * 0.30,
    );

    state.evolutionSystem.formChange = Math.min(
      1,
      visualStage * 0.45 +
      state.evolutionSystem.adaptation * 0.30 +
      visualCycle * 0.25,
    );

    state.evolutionSystem.plasma = Math.min(
      1,
      state.energy * 0.35 +
      state.consciousness * 0.25 +
      visualStage * 0.20 +
      visualCycle * 0.20,
    );

    state.evolutionSystem.emergence = Math.min(
      1,
      Math.max(state.life, state.awareness) *
      (0.50 + visualStage * 0.35) +
      visualCycle * 0.15,
    );

    state.evolutionSystem.instability = Math.min(
      1,
      state.chaos * 0.35 +
      (1 - state.stability) * 0.25 +
      state.evolutionSystem.mutation * 0.20 +
      (1 - visualCycle) * 0.20,
    );

    this.updateEra(state);
    this.updateMode(state);



  }





  private updateEra(

    state:GenesisState,

  ):void {


    const stage =

      state.evolutionSystem.stage;



    if(stage < 0.1){

      state.era =
        GenesisEra.VOID;

    }

    else if(stage < 0.25){

      state.era =
        GenesisEra.QUANTUM;

    }

    else if(stage < 0.45){

      state.era =
        GenesisEra.ENERGY;

    }

    else if(stage < 0.65){

      state.era =
        GenesisEra.MATTER;

    }

    else if(stage < 0.8){

      state.era =
        GenesisEra.STARS;

    }

    else if(stage < 0.9){

      state.era =
        GenesisEra.PLANETS;

    }

    else {

      state.era =
        GenesisEra.CIVILIZATIONS;

    }


  }





  private updateMode(

    state:GenesisState,

  ):void {


    if(

      state.awareness > 0.9

    ){

      state.mode =
        GenesisMode.TRANSCENDING;

    }

    else if(

      state.awareness > 0.65

    ){

      state.mode =
        GenesisMode.EVOLVING;

    }

    else if(

      state.intelligence > 0.45

    ){

      state.mode =
        GenesisMode.CREATING;

    }

    else if(

      state.life > 0.25

    ){

      state.mode =
        GenesisMode.LEARNING;

    }

    else if(

      state.energy > 0.1

    ){

      state.mode =
        GenesisMode.FORMING;

    }

    else {

      state.mode =
        GenesisMode.CHAOS;

    }


  }


}