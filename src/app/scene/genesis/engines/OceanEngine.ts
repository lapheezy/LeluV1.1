/**
 * ==========================================================
 * LÉLUVERSE
 * OCEAN ENGINE
 *
 * Living planetary ocean simulation.
 *
 * Controls:
 * • tides
 * • currents
 * • waves
 * • storms
 * • tsunami events
 * • stability
 * • life interaction
 *
 * Drives:
 * GenesisState.ocean
 *
 * ==========================================================
 */

import type {
  GenesisEngine,
} from "./EngineRegistry";

import type {
  GenesisState,
} from "../state/GenesisState";

export default class OceanEngine
  implements GenesisEngine {

  readonly id = "OceanEngine";

  readonly priority = 40;

  enabled = true;

  private time = 0;

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) {
      return;
    }

    this.time += delta;

    const ocean =
      state.ocean;

    const life =
      state.life;

    const energy =
      state.energy;

    const awareness =
      state.awareness;

    const evolution =
      state.evolution;

    const chaos =
      state.chaos;

    /*
     * ======================================================
     * TIDES
     * ======================================================
     */

    ocean.tide =

      0.5 +

      Math.sin(
        this.time * 0.05,
      ) * 0.25 +

      awareness * 0.15;

    /*
     * ======================================================
     * CURRENTS
     * ======================================================
     */

    ocean.current =

      0.4 +

      Math.sin(
        this.time * 0.12,
      ) * 0.20 +

      awareness * 0.15 +

      energy * 0.10;

    /*
     * ======================================================
     * WAVES
     * ======================================================
     */

    ocean.wave =

      Math.min(

        1,

        Math.abs(

          Math.sin(
            this.time * 0.40,
          )

        ) *

        (

          0.30 +

          life * 0.50 +

          energy * 0.20

        ),

      );

    /*
     * ======================================================
     * STORM SURGE
     * ======================================================
     */

    ocean.stormSurge =

      Math.min(

        1,

        ocean.wave * 0.50 +

        chaos * 0.25 +

        energy * 0.20,

      );

    /*
     * ======================================================
     * TSUNAMI
     * ======================================================
     */

    ocean.tsunami =

      Math.max(

        0,

        Math.sin(
          this.time * 0.01,
        ) *

        (

          chaos * 0.20 +

          evolution * 0.15

        ),

      );

    /*
     * ======================================================
     * STABILITY
     * ======================================================
     */

    ocean.stability =

      Math.max(

        0,

        Math.min(

          1,

          1 -

          (

            ocean.stormSurge * 0.45 +

            ocean.tsunami * 0.55

          ),

        ),

      );

    /*
     * ======================================================
     * OCEAN SUPPORTS LIFE
     * ======================================================
     */

    if (

      life > 0.2

    ) {

      state.life =

        Math.min(

          1,

          state.life +

          ocean.stability *

          delta *

          0.002,

        );

    }

  }

}