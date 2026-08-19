/**
 * ==========================================================
 * LÉLUVERSE
 * STAR ENGINE
 *
 * Stellar evolution and cosmic energy bridge.
 *
 * Controls:
 * - star formation
 * - stellar light
 * - constellation energy
 * - cosmic influence
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class StarEngine {


  private time = 0;



  update(

    state: GenesisState,

    delta: number,

  ): void {


    if(state.paused)

      return;



    this.time += delta;



    /*
     * Stars require matter and energy
     */

    const formation =

      state.energy *

      state.matter;



    state.celestial.stars =

      Math.min(

        1,

        state.celestial.stars +

        formation *

        delta *

        0.03,

      );



    /*
     * Stellar light output
     */

    state.light = Math.min(

      1,

      state.light +

      state.celestial.stars *

      delta *

      0.02,

    );



    /*
     * Cosmic energy field
     */

    state.celestial.cosmicEnergy =

      Math.min(

        1,

        (

          state.celestial.stars +

          state.light +

          state.gravity

        ) /

        3,

      );



    /*
     * Constellation activation
     */

    state.celestial.constellations =

      Math.min(

        1,

        state.celestial.constellations +

        state.celestial.stars *

        delta *

        0.015,

      );



    /*
     * Astrology star influence
     */

    state.astrology.zodiac =

      (

        Math.sin(

          this.time *

          0.05

        ) + 1

      ) *

      0.5;



    /*
     * Planetary support from stars
     */

    if(

      state.celestial.stars >

      0.2

    ){

      state.life = Math.min(

        1,

        state.life +

        state.celestial.cosmicEnergy *

        delta *

        0.003,

      );

    }


  }


}