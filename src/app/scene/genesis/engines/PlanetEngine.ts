/**
 * ==========================================================
 * LÉLUVERSE
 * PLANET ENGINE
 *
 * Planetary evolution and astrology bridge.
 *
 * Controls:
 * - planetary energy
 * - orbital cycles
 * - zodiac alignment
 * - retrograde influence
 * - planetary life influence
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";


export default class PlanetEngine {


  private time = 0;



  update(

    state: GenesisState,

    delta: number,

  ): void {


    if(state.paused)

      return;



    this.time += delta;



    const gravity =
      state.gravity;



    /*
     * Planet formation begins
     */

    state.celestial.planets =

      Math.min(

        1,

        state.celestial.planets +

        gravity *

        delta *

        0.02,

      );



    /*
     * Planetary energy field
     */

    state.astrology.planetaryEnergy =

      Math.min(

        1,

        (

          state.celestial.planets +

          state.gravity +

          state.light

        ) / 3,

      );



    /*
     * Zodiac alignment cycle
     */

    state.astrology.alignment =

      (

        Math.sin(

          this.time *

          0.15

        ) + 1

      ) *

      0.5;



    /*
     * Transit movement
     */

    state.astrology.transit =

      (

        Math.cos(

          this.time *

          0.08

        ) + 1

      ) *

      0.5;



    /*
     * Retrograde events
     */

    state.astrology.retrograde =

      Math.max(

        0,

        Math.sin(

          this.time *

          0.03

        )

      );



    /*
     * Planetary influence on life
     */

    if(

      state.celestial.planets >

      0.2

    ){

      state.life = Math.min(

        1,

        state.life +

        state.astrology.planetaryEnergy *

        delta *

        0.005,

      );

    }


  }


}