/**
 * ==========================================================
 * LÉLUVERSE
 * STATE MACHINE
 * ==========================================================
 */

import {
  GenesisMode,
  type GenesisState,
} from "./GenesisState";

export default class GenesisStateMachine {

  private state: GenesisMode =
    GenesisMode.DORMANT;

  get current(): GenesisMode {
    return this.state;
  }

  set(state: GenesisMode): void {
    this.state = state;
  }

  is(state: GenesisMode): boolean {
    return this.state === state;
  }

  /**
   * Derive the universe mode from the canonical Genesis state. The
   * simulation owns the measurements; this class owns the mode transition.
   */
  sync(state: GenesisState): GenesisMode {
    if (state.awareness > 0.9) {
      this.state = GenesisMode.TRANSCENDING;
    } else if (state.awareness > 0.65) {
      this.state = GenesisMode.EVOLVING;
    } else if (state.intelligence > 0.45) {
      this.state = GenesisMode.CREATING;
    } else if (state.life > 0.25) {
      this.state = GenesisMode.LEARNING;
    } else if (state.energy > 0.1) {
      this.state = GenesisMode.FORMING;
    } else {
      this.state = GenesisMode.CHAOS;
    }

    state.mode = this.state;
    return this.state;
  }

  reset(): void {
    this.state = GenesisMode.DORMANT;
  }

}