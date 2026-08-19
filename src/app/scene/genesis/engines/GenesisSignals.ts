/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS SIGNALS
 *
 * Live activity signals derived from the interface layer
 * every frame — chat, cognition, provider identity, engine
 * health — so Genesis engines can react to what LÉLU is
 * actually doing right now, not just tick an ambient
 * simulation that never hears from the rest of the app.
 *
 * Ephemeral by design: never persisted into GenesisState,
 * always recomputed from the current GenesisUIState. Engines
 * read these the same frame they're produced.
 * ==========================================================
 */

export interface GenesisSignals {

  thinking: boolean;

  speaking: boolean;

  listening: boolean;

  reasoningActive: boolean;

  planningActive: boolean;

  providerSwitched: boolean;

  engineErrorCount: number;

}

export const idleGenesisSignals: GenesisSignals = {

  thinking: false,

  speaking: false,

  listening: false,

  reasoningActive: false,

  planningActive: false,

  providerSwitched: false,

  engineErrorCount: 0,

};
