/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS STATE
 *
 * Central living state of the Genesis universe.
 * ==========================================================
 */

export const GenesisMode = {

  DORMANT: "DORMANT",

  AWAKENING: "AWAKENING",

  CHAOS: "CHAOS",

  FORMING: "FORMING",

  STABLE: "STABLE",

  LEARNING: "LEARNING",

  DREAMING: "DREAMING",

  SIMULATING: "SIMULATING",

  TEACHING: "TEACHING",

  CREATING: "CREATING",

  EVOLVING: "EVOLVING",

  TRANSCENDING: "TRANSCENDING",

} as const;

export type GenesisMode =
  typeof GenesisMode[keyof typeof GenesisMode];

export const GenesisVisualMode = {

  GENESIS: "GENESIS",

  NATURE: "NATURE",

  COSMOS: "COSMOS",

  DREAM: "DREAM",

  ENGINEERING: "ENGINEERING",

  MEDITATION: "MEDITATION",

  SANDBOX: "SANDBOX",

} as const;

export type GenesisVisualMode =
  typeof GenesisVisualMode[keyof typeof GenesisVisualMode];

export interface AstrologyState {

  zodiac: number;

  planetaryEnergy: number;

  retrograde: number;

  alignment: number;

  transit: number;

}

export interface CelestialState {

  stars: number;

  constellations: number;

  planets: number;

  cosmicEnergy: number;

}

export interface OceanState {

  tide: number;

  current: number;

  wave: number;

  tsunami: number;

  stormSurge: number;

  stability: number;

}

export interface EvolutionState {

  stage: number;

  mutation: number;

  growth: number;

  adaptation: number;

  colorShift: number;

  formChange: number;

  plasma: number;

  instability: number;

  emergence: number;

}

export interface MemoryState {

  shortTerm: number;

  longTerm: number;

  archived: number;

  importance: number;

}

export interface TimelineState {

  year: number;

  events: number;

  acceleration: number;

}

export interface PulseState {

  heartbeat: number;

  intensity: number;

  frequency: number;

}

/**
 * The ONE Core's transformation state, published by the EngineBus.
 * The Genesis v2 lab requests a target environment morphology;
 * the EngineBus animates the real Core toward it (progress 0→1),
 * keeps the auto evolution cycle advancing underneath, and records
 * completed transformations. There is never a second Core — this is
 * just the control surface for the one that already exists.
 */
export interface CoreTransformState {
  /** Requested environment morphology; null = automatic evolution cycle. */
  request: string | null;
  /** 0..1 progress of the current lab-driven morph toward the request. */
  progress: number;
  /** True while a lab-driven morph is visibly in progress. */
  transforming: boolean;
  /** Completed transformations, newest first. */
  history: { from: string; to: string; at: number }[];
}

export interface GenesisState {

  age: number;

  evolution: number;

  chaos: number;

  stability: number;

  curiosity: number;

  intelligence: number;

  awareness: number;

  energy: number;

  matter: number;

  gravity: number;

  light: number;

  life: number;

  civilizations: number;

  simulation: number;

  teaching: number;

  learning: number;

  existence: number;

  reality: number;

  consciousness: number;

  astrology: AstrologyState;

  celestial: CelestialState;

  ocean: OceanState;

  evolutionSystem: EvolutionState;

  memory: MemoryState;

  timeline: TimelineState;

  pulse: PulseState;

  /** Named external morphology of the ONE Core (EngineBus cycle). */
  morphology: string;

  /** 0..1 progress through the current morphology window. */
  morphologyProgress: number;

  /** Lab-driven transformation state (see CoreTransformState). */
  coreTransform: CoreTransformState;

  era?: string;

  dimension: 1 | 2 | 3 | 4 | 5;

  speed: number;

  paused: boolean;

  mode: GenesisMode;

  visualMode: GenesisVisualMode;

}

export const defaultGenesisState: GenesisState = {

  age: 0,

  evolution: 0,

  chaos: 1,

  stability: 0,

  curiosity: 0,

  intelligence: 0,

  awareness: 0,

  energy: 0,

  matter: 0,

  gravity: 0,

  light: 0,

  life: 0,

  civilizations: 0,

  simulation: 0,

  teaching: 0,

  learning: 0,

  existence: 0,

  reality: 0,

  consciousness: 0,

  astrology: {

    zodiac: 0,

    planetaryEnergy: 0,

    retrograde: 0,

    alignment: 0,

    transit: 0,

  },

  celestial: {

    stars: 0,

    constellations: 0,

    planets: 0,

    cosmicEnergy: 0,

  },

  ocean: {

    tide: 0.5,

    current: 0.4,

    wave: 0.2,

    tsunami: 0,

    stormSurge: 0,

    stability: 0.8,

  },
    evolutionSystem: {

    stage: 0,

    mutation: 0,

    growth: 0,

    adaptation: 0,

    colorShift: 0,

    formChange: 0,

    plasma: 0.2,

    instability: 0,

    emergence: 0,

  },

  memory: {

    shortTerm: 0,

    longTerm: 0,

    archived: 0,

    importance: 0,

  },

  timeline: {

    year: 0,

    events: 0,

    acceleration: 1,

  },

  pulse: {

    heartbeat: 0,

    intensity: 0,

    frequency: 1,

  },

  morphology: "PLASMA",

  morphologyProgress: 0,

  coreTransform: {

    request: null,

    progress: 0,

    transforming: false,

    history: [],

  },

  era: "VOID",

  dimension: 1,

  speed: 120,

  paused: false,

  mode: GenesisMode.DORMANT,

  visualMode: GenesisVisualMode.GENESIS,

};