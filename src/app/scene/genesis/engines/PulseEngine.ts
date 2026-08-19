/**
 * ==========================================================
 * LÉLUVERSE
 * PULSE ENGINE
 *
 * Living heartbeat controller.
 *
 * Generates rhythmic energy pulses for
 * the Genesis core visuals.
 * ==========================================================
 */

import type {
  GenesisState,
} from "../state/GenesisState";

import type {
  GenesisSignals,
} from "./GenesisSignals";


export default class PulseEngine {


  private time = 0;



  update(

    state: GenesisState,

    delta:number,

    signals?: GenesisSignals,

  ):void {


    if(state.paused)

      return;



    /*
     * Active work quickens the heartbeat.
     *
     * Thinking, reasoning and planning are all "the core is
     * doing something right now" — the pulse should visibly
     * speed up rather than tick at the same ambient tempo
     * whether LÉLU is idle or mid-thought.
     */
    const engaged =
      Boolean(signals?.thinking) ||
      Boolean(signals?.reasoningActive) ||
      Boolean(signals?.planningActive);

    const tempo =
      engaged ? 5.5 : 2.5;

    this.time += delta * (engaged ? 1.6 : 1);



    /*
     * Core heartbeat
     */

    const pulse =

      (

        Math.sin(

          this.time *

          tempo

        ) + 1

      ) *

      0.5;



    state.pulse.heartbeat = pulse;
    state.pulse.intensity = engaged ? 0.75 + pulse * 0.25 : pulse;
    state.pulse.frequency = tempo;

    /*
     * Feed visual energy
     */

    state.energy = Math.min(

      1,

      state.energy +

      pulse *

      delta *

      (engaged ? 0.004 : 0.001),

    );



    /*
     * Consciousness pulse
     */

    state.consciousness =

      Math.min(

        1,

        (

          state.awareness +

          pulse

        ) /

        2,

      );



    /*
     * Core evolution response
     */

    state.evolutionSystem.mutation =

      Math.min(

        1,

        state.evolutionSystem.mutation +

        pulse *

        delta *

        0.003,

      );

    /*
     * Provider switch — a visible jolt.
     *
     * Handing the conversation to a different model is a real
     * discontinuity; the core should register it as a brief
     * spike rather than blend it into the ambient hum.
     */
    if (signals?.providerSwitched) {

      state.evolutionSystem.mutation = Math.min(
        1,
        state.evolutionSystem.mutation + 0.15,
      );

    }

    /*
     * Engine trouble — quiet instability, not alarm.
     *
     * A disabled/errored engine shows up as a small, steady
     * drag on stability rather than a dramatic effect — this
     * is diagnostic texture, not a warning siren.
     */
    const errorCount =
      signals?.engineErrorCount ?? 0;

    if (errorCount > 0) {

      state.evolutionSystem.instability = Math.min(
        1,
        state.evolutionSystem.instability +
        delta * 0.01 * errorCount,
      );

    }
    else {

      state.evolutionSystem.instability = Math.max(
        0,
        state.evolutionSystem.instability - delta * 0.02,
      );

    }


  }


}
