/**
 * ==========================================================
 * LÉLUVERSE COSMOS MAP
 * TYPES
 *
 * The type system for the spatial cosmos visualization.
 * Every type maps to an existing runtime entity — never
 * creates duplicate state.
 * ==========================================================
 */

/** Hierarchy levels in the cosmos */
export type CosmosLevel =
  | "lelu-core"
  | "shaman"
  | "executive-galaxy"
  | "agent-universe"
  | "agent-system"
  | "capability"
  | "memory-garden";

/** Visual DNA — persistent visual characteristics derived from identity */
export interface VisualDNA {
  /** Primary hue in degrees (0-360) */
  hue: number;
  /** Saturation multiplier (0.3-1.0) */
  saturation: number;
  /** Base brightness */
  brightness: number;
  /** Geometry family */
  geometry: "crystalline" | "organic" | "geometric" | "defensive" | "branching" | "pulsing";
  /** Mutation seed for organic shapes */
  mutationSeed: number;
  /** Particle density multiplier */
  particleDensity: number;
  /** Glow intensity */
  glowIntensity: number;
}

/** 3D spatial position with depth */
export interface SpatialPosition {
  x: number;
  y: number;
  z: number;
}

/** Orbital parameters for organic motion */
export interface OrbitalParams {
  /** Radius of orbit */
  radius: number;
  /** Speed multiplier */
  speed: number;
  /** Orbital inclination in radians */
  inclination: number;
  /** Phase offset */
  phase: number;
  /** Eccentricity (0 = circle, 0.8 = ellipse) */
  eccentricity: number;
  /** Drift per frame */
  driftX: number;
  driftY: number;
  driftZ: number;
}

/** Activity state — driven by real runtime events */
export interface ActivityState {
  /** 0-1 activity level */
  energy: number;
  /** What kind of activity */
  type: "idle" | "thinking" | "researching" | "coding" | "remembering" | "communicating" | "creating" | "learning";
  /** Timestamp of last activity */
  lastActive: number;
  /** Growth level from accumulated work */
  growth: number;
}

/** Cosmos entity — the base for all spatial objects */
export interface CosmosEntity {
  id: string;
  name: string;
  level: CosmosLevel;
  /** Runtime entity ID this maps to (agent id, executive id, etc.) */
  runtimeId: string;
  /** Spatial position in the cosmos */
  position: SpatialPosition;
  /** Orbital parameters */
  orbit: OrbitalParams;
  /** Visual DNA */
  visualDNA: VisualDNA;
  /** Current activity state */
  activity: ActivityState;
  /** Scale multiplier */
  scale: number;
  /** Whether this entity is visible at the current zoom */
  visible: boolean;
  /** Parent entity ID */
  parentId: string | null;
  /** Children entity IDs */
  childrenIds: string[];
}

/** Galaxy-specific data for Executive entities */
export interface ExecutiveGalaxy extends CosmosEntity {
  level: "executive-galaxy";
  /** The executive's governance domain */
  domain: string;
  /** Core morphology state — unique to this galaxy */
  morphology: GalaxyMorphology;
}

/** Galaxy morphology — how the core looks and behaves */
export interface GalaxyMorphology {
  /** Current morphology type */
  type: "ordered" | "protective" | "constructive" | "vigilant" | "knowledge" | "balanced";
  /** Mutation progress 0-1 */
  mutationProgress: number;
  /** Structure count (grows with capability) */
  structures: number;
  /** Ring count */
  rings: number;
  /** Branch complexity */
  branches: number;
  /** Shield strength (for warden) */
  shields: number;
  /** Knowledge depth (for sage) */
  depth: number;
}

/** Agent universe — a miniature cosmos inside a galaxy */
export interface AgentUniverse extends CosmosEntity {
  level: "agent-universe";
  /** Systems inside this universe */
  systems: AgentSystem[];
  /** Knowledge count */
  knowledgeCount: number;
  /** Tool count */
  toolCount: number;
  /** Memory connections */
  memoryConnections: number;
  /** Growth stage */
  growthStage: "seed" | "nebula" | "star" | "system" | "constellation";
}

/** Internal system within an agent universe */
export interface AgentSystem {
  id: string;
  name: string;
  type: "research" | "coding" | "memory" | "tool" | "creative" | "knowledge" | "communication";
  activity: number;
  position: SpatialPosition;
}

/** Communication pathway between two entities */
export interface AuroraPathway {
  id: string;
  fromId: string;
  toId: string;
  /** Pathway type */
  type: "hierarchy" | "communication" | "delegation" | "memory" | "knowledge";
  /** Current energy 0-1 */
  energy: number;
  /** Particle positions along the path */
  particles: SpatialPosition[];
}

/** Camera state for persistence */
export interface CosmosCameraState {
  position: SpatialPosition;
  target: SpatialPosition;
  zoom: number;
  rotation: number;
}

/** Panel layout state for persistence */
export interface PanelLayout {
  agentTab: { width: number; expanded: boolean };
  agentCouncil: { height: number; expanded: boolean };
  chat: { width: number; expanded: boolean };
  browser: { width: number; expanded: boolean };
  memoryGarden: { width: number; expanded: boolean };
  sidebar: { width: number; expanded: boolean };
}

/** Cosmos overview state */
export interface CosmosOverview {
  visible: boolean;
  zoom: number;
}

/** Full cosmos state */
export interface CosmosState {
  entities: CosmosEntity[];
  executiveGalaxies: ExecutiveGalaxy[];
  agentUniverses: AgentUniverse[];
  auroraPathways: AuroraPathway[];
  camera: CosmosCameraState;
  panelLayout: PanelLayout;
  overview: CosmosOverview;
  selectedEntityId: string | null;
  hoveredEntityId: string | null;
  /** LÉLU core position (always center reference) */
  leluCore: SpatialPosition;
  /** Shaman position */
  shamanCore: SpatialPosition;
  /** Timestamp of last update */
  lastUpdate: number;
}

/** Executive type enum */
export type ExecutiveType = "governor" | "caretaker" | "engineer" | "warden" | "sage" | "forge";

/** Map agent template ids to executive types */
export const AGENT_TO_EXECUTIVE: Record<string, ExecutiveType> = {
  designer: "governor",
  artist: "governor",
  renderer: "engineer",
  video: "engineer",
  researcher: "sage",
  jewelry: "governor",
  fashion: "governor",
  marketing: "caretaker",
  builder: "engineer",
  engineer: "engineer",
};

/** Executive definitions with visual DNA */
export const EXECUTIVE_DEFS: Record<ExecutiveType, {
  name: string;
  domain: string;
  visualDNA: VisualDNA;
  morphology: GalaxyMorphology;
}> = {
  governor: {
    name: "Lélu",
    domain: "Central Intelligence · Direction · Cognition · Synthesis",
    visualDNA: {
      hue: 260,
      saturation: 0.7,
      brightness: 0.85,
      geometry: "geometric",
      mutationSeed: 42,
      particleDensity: 0.6,
      glowIntensity: 0.8,
    },
    morphology: {
      type: "ordered",
      mutationProgress: 0.3,
      structures: 6,
      rings: 3,
      branches: 0,
      shields: 0,
      depth: 0,
    },
  },
  caretaker: {
    name: "Caretaker",
    domain: "Life Operations · Health · Wellness · Environment · Continuity · Memory · Recovery",
    visualDNA: {
      hue: 160,
      saturation: 0.6,
      brightness: 0.8,
      geometry: "organic",
      mutationSeed: 17,
      particleDensity: 0.5,
      glowIntensity: 0.7,
    },
    morphology: {
      type: "protective",
      mutationProgress: 0.4,
      structures: 4,
      rings: 5,
      branches: 0,
      shields: 3,
      depth: 0,
    },
  },
  engineer: {
    name: "Engineering & Systems",
    domain: "Construction · Implementation · Integration · Testing · Deployment · Optimization",
    visualDNA: {
      hue: 200,
      saturation: 0.8,
      brightness: 0.9,
      geometry: "crystalline",
      mutationSeed: 73,
      particleDensity: 0.9,
      glowIntensity: 0.9,
    },
    morphology: {
      type: "constructive",
      mutationProgress: 0.5,
      structures: 8,
      rings: 2,
      branches: 0,
      shields: 0,
      depth: 0,
    },
  },
  warden: {
    name: "M.S. Ma'at Sentinel",
    domain: "Defense · Security · Protection · Privacy · Resilience",
    visualDNA: {
      hue: 30,
      saturation: 0.7,
      brightness: 0.75,
      geometry: "defensive",
      mutationSeed: 91,
      particleDensity: 0.4,
      glowIntensity: 0.6,
    },
    morphology: {
      type: "vigilant",
      mutationProgress: 0.2,
      structures: 3,
      rings: 4,
      branches: 0,
      shields: 6,
      depth: 0,
    },
  },
  sage: {
    name: "Architect Executive",
    domain: "Architecture · System Coherence · Knowledge · Long-Term Evolution",
    visualDNA: {
      hue: 280,
      saturation: 0.5,
      brightness: 0.85,
      geometry: "branching",
      mutationSeed: 55,
      particleDensity: 0.7,
      glowIntensity: 0.75,
    },
    morphology: {
      type: "knowledge",
      mutationProgress: 0.6,
      structures: 10,
      rings: 0,
      branches: 12,
      shields: 0,
      depth: 5,
    },
  },
  forge: {
    name: "Agent Forge Executive",
    domain: "Agent Creation · Multiplicity · Specialization · Delegation · Agent Evolution",
    visualDNA: {
      hue: 340,
      saturation: 0.7,
      brightness: 0.8,
      geometry: "geometric",
      mutationSeed: 23,
      particleDensity: 0.8,
      glowIntensity: 0.85,
    },
    morphology: {
      type: "constructive",
      mutationProgress: 0.55,
      structures: 7,
      rings: 3,
      branches: 8,
      shields: 0,
      depth: 0,
    },
  },
};
