/**
 * ==========================================================
 * LÉLUVERSE
 * ENGINE DOMAINS
 *
 * Classifies all existing engines into domains and maps
 * their dependency graph. Used by WorldLifecycle to
 * activate/deactivate engines per phase.
 *
 * DO NOT duplicate engines — map the EXISTING ones.
 * ==========================================================
 */

// ── DOMAIN DEFINITIONS ──

export const EngineDomain = {
  /** Core → Cosmos → Galaxy → Planet formation */
  WORLD: "world",
  /** Avatar, Species, DNA, Civilization, Life systems */
  LIFE: "life",
  /** Consciousness, Awareness, Curiosity, Learning, Wisdom */
  MIND: "mind",
  /** Memory, Knowledge, Timeline, Evolution tracking */
  KNOWLEDGE: "knowledge",
  /** Galaxy, Star, Nebula, BlackHole, Void, Quantum */
  UNIVERSAL: "universal",
  /** Creation, Dream, Reality, Existence */
  EXPRESSION: "expression",
  /** Interaction, Pulse, Harmony, Balance */
  INTERACTION: "interaction",
  /** Simulation, Technology, Engineering */
  ENGINEERING: "engineering",
  /** Entropy, Growth, Expansion, Gravity, Matter, Light, Particle, Atmosphere, Ocean */
  COSMIC: "cosmic",
  /** Genesis simulation (meta) */
  META: "meta",
} as const;

export type EngineDomainType = typeof EngineDomain[keyof typeof EngineDomain];

// ── ENGINE → DOMAIN MAP ──

export const ENGINE_DOMAINS: Record<string, EngineDomainType> = {
  // COSMIC domain — fundamental forces & matter
  VoidEngine: EngineDomain.COSMIC,
  QuantumEngine: EngineDomain.COSMIC,
  ExpansionEngine: EngineDomain.COSMIC,
  EntropyEngine: EngineDomain.COSMIC,
  HarmonyEngine: EngineDomain.COSMIC,
  BalanceEngine: EngineDomain.COSMIC,
  GravityEngine: EngineDomain.COSMIC,
  MatterEngine: EngineDomain.COSMIC,
  ParticleEngine: EngineDomain.COSMIC,
  LightEngine: EngineDomain.COSMIC,
  PulseEngine: EngineDomain.COSMIC,
  OceanEngine: EngineDomain.COSMIC,
  AtmosphereEngine: EngineDomain.COSMIC,

  // UNIVERSAL domain — cosmic structures
  StarEngine: EngineDomain.UNIVERSAL,
  GalaxyEngine: EngineDomain.UNIVERSAL,
  NebulaEngine: EngineDomain.UNIVERSAL,
  BlackHoleEngine: EngineDomain.UNIVERSAL,

  // WORLD domain — planetary/geography
  PlanetEngine: EngineDomain.WORLD,
  GrowthEngine: EngineDomain.WORLD,

  // LIFE domain — biological/civilization
  DNAEngine: EngineDomain.LIFE,
  SpeciesEngine: EngineDomain.LIFE,
  CivilizationEngine: EngineDomain.LIFE,
  TechnologyEngine: EngineDomain.LIFE,

  // MIND domain — cognition/experience
  ConsciousnessEngine: EngineDomain.MIND,
  AwarenessEngine: EngineDomain.MIND,
  CuriosityEngine: EngineDomain.MIND,
  LearningEngine: EngineDomain.MIND,
  WisdomEngine: EngineDomain.MIND,

  // KNOWLEDGE domain — memory/tracking
  MemoryEngine: EngineDomain.KNOWLEDGE,
  MemoryEvolutionEngine: EngineDomain.KNOWLEDGE,
  TimelineEngine: EngineDomain.KNOWLEDGE,
  EvolutionEngine: EngineDomain.KNOWLEDGE,

  // EXPRESSION domain — creation/dreams
  CreationEngine: EngineDomain.EXPRESSION,
  DreamEngine: EngineDomain.EXPRESSION,
  RealityEngine: EngineDomain.EXPRESSION,
  ExistenceEngine: EngineDomain.EXPRESSION,

  // INTERACTION domain — engagement
  InteractionEngine: EngineDomain.INTERACTION,

  // ENGINEERING domain — simulation/construction
  SimulationEngine: EngineDomain.ENGINEERING,

  // META — simulation orchestrator
  GenesisSimulation: EngineDomain.META,

  // NEW ENGINES — Infinite Cosmos Expansion
  // WORLD domain — structures & environment
  FloatingCityEngine: EngineDomain.WORLD,
  VehicleEngine: EngineDomain.WORLD,
  WeatherEngine: EngineDomain.WORLD,
  StormEngine: EngineDomain.WORLD,
  TsunamiEngine: EngineDomain.WORLD,
  WaveEngine: EngineDomain.COSMIC,

  // UNIVERSAL domain — zodiac & astronomy
  ZodiacEngine: EngineDomain.UNIVERSAL,
  HouseEngine: EngineDomain.UNIVERSAL,
  EphemerisEngine: EngineDomain.UNIVERSAL,
  TransitEngine: EngineDomain.UNIVERSAL,
  AspectEngine: EngineDomain.UNIVERSAL,
  NatalChartEngine: EngineDomain.UNIVERSAL,
  TimeEngine: EngineDomain.UNIVERSAL,
  ObservatoryEngine: EngineDomain.UNIVERSAL,
};

// ── DEPENDENCY GRAPH ──
// Key = engine name, Value = engines it DEPENDS ON
// If A depends on B, B must be active before A.

export const ENGINE_DEPENDENCIES: Record<string, string[]> = {
  // Cosmic foundations depend on nothing (or each other)
  VoidEngine: [],
  QuantumEngine: ["VoidEngine"],
  ExpansionEngine: ["VoidEngine"],
  EntropyEngine: ["VoidEngine"],
  HarmonyEngine: ["BalanceEngine"],
  BalanceEngine: ["VoidEngine"],
  GravityEngine: ["MatterEngine", "ExpansionEngine"],
  MatterEngine: ["QuantumEngine"],
  ParticleEngine: ["QuantumEngine"],
  LightEngine: ["ParticleEngine"],
  PulseEngine: ["GravityEngine"],
  OceanEngine: ["MatterEngine", "LightEngine"],
  AtmosphereEngine: ["OceanEngine", "LightEngine"],

  // Universal depends on cosmic
  StarEngine: ["LightEngine", "GravityEngine", "MatterEngine"],
  GalaxyEngine: ["StarEngine", "GravityEngine"],
  NebulaEngine: ["StarEngine", "MatterEngine"],
  BlackHoleEngine: ["StarEngine", "GravityEngine", "EntropyEngine"],

  // World depends on universal
  PlanetEngine: ["GravityEngine", "MatterEngine", "LightEngine"],
  GrowthEngine: ["PlanetEngine", "LightEngine"],

  // Life depends on world
  DNAEngine: ["GrowthEngine", "MatterEngine"],
  SpeciesEngine: ["DNAEngine", "GrowthEngine"],
  CivilizationEngine: ["SpeciesEngine"],
  TechnologyEngine: ["CivilizationEngine"],

  // Mind depends on life
  ConsciousnessEngine: ["AwarenessEngine", "MemoryEngine"],
  AwarenessEngine: ["SpeciesEngine"],
  CuriosityEngine: ["ConsciousnessEngine"],
  LearningEngine: ["CuriosityEngine", "MemoryEngine"],
  WisdomEngine: ["LearningEngine", "MemoryEngine"],

  // Knowledge depends on mind + life
  MemoryEngine: ["ConsciousnessEngine"],
  MemoryEvolutionEngine: ["MemoryEngine", "EvolutionEngine"],
  TimelineEngine: ["CivilizationEngine", "MemoryEngine"],
  EvolutionEngine: ["DNAEngine", "GrowthEngine"],

  // Expression depends on mind
  CreationEngine: ["ConsciousnessEngine", "RealityEngine"],
  DreamEngine: ["ConsciousnessEngine"],
  RealityEngine: ["ConsciousnessEngine"],
  ExistenceEngine: ["RealityEngine", "AwarenessEngine"],

  // Interaction depends on consciousness
  InteractionEngine: ["ConsciousnessEngine", "CivilizationEngine"],

  // Engineering depends on technology
  SimulationEngine: ["TechnologyEngine", "RealityEngine"],

  // Meta depends on everything
  GenesisSimulation: ["EvolutionEngine", "ConsciousnessEngine", "CivilizationEngine"],

  // NEW ENGINES — Infinite Cosmos Expansion
  FloatingCityEngine: ["PlanetEngine", "MatterEngine"],
  VehicleEngine: ["FloatingCityEngine", "CivilizationEngine"],
  WeatherEngine: ["AtmosphereEngine", "OceanEngine"],
  StormEngine: ["WeatherEngine", "AtmosphereEngine"],
  TsunamiEngine: ["OceanEngine", "GravityEngine"],
  WaveEngine: ["OceanEngine"],

  ZodiacEngine: ["StarEngine", "GravityEngine"],
  HouseEngine: ["ZodiacEngine"],
  EphemerisEngine: ["ZodiacEngine"],
  TransitEngine: ["EphemerisEngine"],
  AspectEngine: ["TransitEngine"],
  NatalChartEngine: ["EphemerisEngine", "HouseEngine"],
  TimeEngine: ["EvolutionEngine"],
  ObservatoryEngine: ["ZodiacEngine", "TransitEngine"],
};

// ── WORLD LIFECYCLE PHASES ──
// Which engines activate at which phase

export const WorldPhase = {
  /** Core seed — only cosmic foundations */
  CORE_SEED: "core_seed",
  /** First expansion — cosmic structures emerge */
  FORMATION: "formation",
  /** Galaxies spread, stars form */
  EXPANSION: "expansion",
  /** Planet forms, geography develops */
  PLANET: "planet",
  /** Life emerges, DNA → civilization */
  LIFE: "life",
  /** Mind systems activate */
  MIND: "mind",
  /** All systems at full power */
  FULL_WORLD: "full_world",
  /** Sunset — systems begin withdrawing */
  SUNSET: "sunset",
  /** Controlled collapse */
  COLLAPSE: "collapse",
  /** Convergence to core */
  REBIRTH: "rebirth",
} as const;

export type WorldPhaseType = typeof WorldPhase[keyof typeof WorldPhase];

// Phase → which engine domains activate
export const PHASE_DOMAIN_ACTIVATION: Record<WorldPhaseType, EngineDomainType[]> = {
  [WorldPhase.CORE_SEED]: [],
  [WorldPhase.FORMATION]: [EngineDomain.COSMIC],
  [WorldPhase.EXPANSION]: [EngineDomain.COSMIC, EngineDomain.UNIVERSAL],
  [WorldPhase.PLANET]: [EngineDomain.COSMIC, EngineDomain.UNIVERSAL, EngineDomain.WORLD],
  [WorldPhase.LIFE]: [EngineDomain.COSMIC, EngineDomain.UNIVERSAL, EngineDomain.WORLD, EngineDomain.LIFE],
  [WorldPhase.MIND]: [EngineDomain.COSMIC, EngineDomain.UNIVERSAL, EngineDomain.WORLD, EngineDomain.LIFE, EngineDomain.MIND, EngineDomain.KNOWLEDGE],
  // Zodiac Observatory persists across all phases (persistent cosmic layer)
  [WorldPhase.FULL_WORLD]: [
    EngineDomain.COSMIC, EngineDomain.UNIVERSAL, EngineDomain.WORLD,
    EngineDomain.LIFE, EngineDomain.MIND, EngineDomain.KNOWLEDGE,
    EngineDomain.EXPRESSION, EngineDomain.INTERACTION, EngineDomain.ENGINEERING, EngineDomain.META,
  ],
  [WorldPhase.SUNSET]: [EngineDomain.COSMIC], // Cosmic always stays
  [WorldPhase.COLLAPSE]: [], // Nothing active during collapse
  [WorldPhase.REBIRTH]: [], // Nothing active during rebirth
};

// Phase → visual expansion scale (for cosmos rendering)
export const PHASE_EXPANSION_SCALE: Record<WorldPhaseType, number> = {
  [WorldPhase.CORE_SEED]: 0.05,
  [WorldPhase.FORMATION]: 0.15,
  [WorldPhase.EXPANSION]: 0.4,
  [WorldPhase.PLANET]: 0.6,
  [WorldPhase.LIFE]: 0.75,
  [WorldPhase.MIND]: 0.85,
  [WorldPhase.FULL_WORLD]: 1.0,
  [WorldPhase.SUNSET]: 0.7,
  [WorldPhase.COLLAPSE]: 0.2,
  [WorldPhase.REBIRTH]: 0.05,
};

// Phase → LÉLU avatar position description
export const PHASE_AVATAR_POSITION: Record<WorldPhaseType, string> = {
  [WorldPhase.CORE_SEED]: "core",
  [WorldPhase.FORMATION]: "core",
  [WorldPhase.EXPANSION]: "cosmos",
  [WorldPhase.PLANET]: "planet",
  [WorldPhase.LIFE]: "world",
  [WorldPhase.MIND]: "world",
  [WorldPhase.FULL_WORLD]: "world",
  [WorldPhase.SUNSET]: "planet",
  [WorldPhase.COLLAPSE]: "core",
  [WorldPhase.REBIRTH]: "core",
};

// ── HELPER FUNCTIONS ──

/** Get all engines that should be active for a given phase */
export function getActiveEnginesForPhase(phase: WorldPhaseType): string[] {
  const domains = PHASE_DOMAIN_ACTIVATION[phase];
  const domainSet = new Set(domains);
  return Object.entries(ENGINE_DOMAINS)
    .filter(([, domain]) => domainSet.has(domain))
    .map(([engine]) => engine);
}

/** Check if an engine is ready (all dependencies met) */
export function areDependenciesMet(
  engineId: string,
  activeEngines: Set<string>,
): boolean {
  const deps = ENGINE_DEPENDENCIES[engineId] ?? [];
  return deps.every((dep) => activeEngines.has(dep));
}

/** Get the domain for an engine */
export function getEngineDomain(engineId: string): EngineDomainType | undefined {
  return ENGINE_DOMAINS[engineId];
}

/** Count how many engines are active per domain */
export function countActivePerDomain(activeEngines: Set<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [engine, domain] of Object.entries(ENGINE_DOMAINS)) {
    if (activeEngines.has(engine)) {
      counts[domain] = (counts[domain] ?? 0) + 1;
    }
  }
  return counts;
}
