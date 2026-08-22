/**
 * ==========================================================
 * LÉLUVERSE COSMOS STORE
 *
 * The single source of truth for the Cosmos Map spatial state.
 * Connects to existing runtime singletons:
 *   - AgentStore (agents → agent universes)
 *   - CognitiveLoop (cycle reports → activity)
 *   - AIService (delegation events → activity)
 *   - AgentEventBus (real events → visual activity)
 *
 * NEVER duplicates runtime state. The cosmos is a visualization
 * layer over the existing entities.
 * ==========================================================
 */

import AgentStore from "../../../../core/agents/AgentStore";
import AgentEventBus from "../../../../core/agent/AgentEvents";
import CognitiveLoop from "../../../../core/cognition/CognitiveLoop";
import KvStore from "../../../../core/storage/KvStore";
import type { LeluAgent } from "../../../../core/agents/AgentTypes";
import type {
  CosmosEntity,
  ExecutiveGalaxy,
  AgentUniverse,
  AuroraPathway,
  CosmosCameraState,
  PanelLayout,
  CosmosState,
  ExecutiveType,
  ActivityState,
  VisualDNA,
  SpatialPosition,
  AgentSystem,
} from "./CosmosTypes";
import { EXECUTIVE_DEFS, AGENT_TO_EXECUTIVE } from "./CosmosTypes";

type CosmosListener = (state: CosmosState) => void;

/** Seed positions — spatially distributed, not clustered around LÉLU */
const EXECUTIVE_POSITIONS: Record<ExecutiveType, SpatialPosition> = {
  governor: { x: 0, y: 18, z: -6 },
  caretaker: { x: -18, y: -8, z: 4 },
  engineer: { x: 16, y: -10, z: -3 },
  warden: { x: -10, y: 14, z: -8 },
  sage: { x: 12, y: 10, z: 6 },
  forge: { x: 4, y: -14, z: 8 },
};

const SHAMAN_POSITION: SpatialPosition = { x: 0, y: 6, z: 0 };

/** Persistent layout key */
const LAYOUT_KEY = "lelu.cosmos.layout.v1";
const CAMERA_KEY = "lelu.cosmos.camera.v1";

function defaultCamera(): CosmosCameraState {
  return {
    position: { x: 0, y: 0, z: 18 },
    target: { x: 0, y: 0, z: 0 },
    zoom: 1,
    rotation: 0,
  };
}

function defaultLayout(): PanelLayout {
  return {
    agentTab: { width: 320, expanded: true },
    agentCouncil: { height: 280, expanded: true },
    chat: { width: 380, expanded: false },
    browser: { width: 400, expanded: false },
    memoryGarden: { width: 320, expanded: false },
    sidebar: { width: 80, expanded: true },
  };
}

function readLayout(): PanelLayout {
  try {
    const stored = KvStore.getInstance().get<Partial<PanelLayout>>(LAYOUT_KEY);
    return { ...defaultLayout(), ...(stored ?? {}) };
  } catch {
    return defaultLayout();
  }
}

function readCamera(): CosmosCameraState {
  try {
    const stored = KvStore.getInstance().get<Partial<CosmosCameraState>>(CAMERA_KEY);
    return { ...defaultCamera(), ...(stored ?? {}) };
  } catch {
    return defaultCamera();
  }
}

/** Make a deterministic VisualDNA from an agent's id + executive hue */
function agentVisualDNA(agent: LeluAgent, execHue: number): VisualDNA {
  let hash = 0;
  const str = agent.id + agent.name;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const seed = Math.abs(hash);
  return {
    hue: (execHue + (seed % 40) - 20 + 360) % 360,
    saturation: 0.5 + (seed % 50) / 100,
    brightness: 0.7 + (seed % 30) / 100,
    geometry: (["crystalline", "organic", "geometric", "branching", "pulsing"] as const)[seed % 5],
    mutationSeed: seed,
    particleDensity: 0.3 + (seed % 70) / 100,
    glowIntensity: 0.5 + (seed % 50) / 100,
  };
}

/** Generate orbital params for an agent inside its galaxy */
function agentOrbit(index: number, total: number): CosmosEntity["orbit"] {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return {
    radius: 2.5 + (index % 3) * 1.2,
    speed: 0.15 + (index % 5) * 0.04,
    inclination: 0.2 + (index % 4) * 0.15,
    phase: angle,
    eccentricity: 0.1 + (index % 3) * 0.15,
    driftX: (Math.sin(angle) * 0.001),
    driftY: (Math.cos(angle) * 0.001),
    driftZ: (Math.sin(angle + 1) * 0.0005),
  };
}

function idleActivity(): ActivityState {
  return {
    energy: 0.1,
    type: "idle",
    lastActive: 0,
    growth: 0,
  };
}

export default class CosmosStore {
  private static instance: CosmosStore | null = null;

  private state: CosmosState;
  private listeners = new Set<CosmosListener>();
  private unsubAgentStore: (() => void) | null = null;
  private unsubAgentEvents: (() => void) | null = null;
  private unsubCognitiveLoop: (() => void) | null = null;
  private activityDecayTimer: number | null = null;

  private constructor() {
    this.state = {
      entities: [],
      executiveGalaxies: [],
      agentUniverses: [],
      auroraPathways: [],
      camera: readCamera(),
      panelLayout: readLayout(),
      overview: { visible: false, zoom: 0.15 },
      selectedEntityId: null,
      hoveredEntityId: null,
      leluCore: { x: 0, y: 0, z: 0 },
      shamanCore: { ...SHAMAN_POSITION },
      lastUpdate: Date.now(),
    };

    this.buildHierarchy();
    this.connectRuntime();
    this.startActivityDecay();
  }

  static getInstance(): CosmosStore {
    if (!CosmosStore.instance) {
      CosmosStore.instance = new CosmosStore();
    }
    return CosmosStore.instance;
  }

  getState(): CosmosState {
    return this.state;
  }

  subscribe(listener: CosmosListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.state.lastUpdate = Date.now();
    for (const listener of this.listeners) {
      try {
        listener({ ...this.state });
      } catch (err) {
        console.error("[CosmosStore] listener error", err);
      }
    }
  }

  /* ------------------------------------------------------------------
   * HIERARCHY BUILDER — maps existing runtime entities to cosmos
   * ------------------------------------------------------------------ */

  private buildHierarchy(): void {
    const agents = AgentStore.getInstance().list();
    const execMap = new Map<ExecutiveType, AgentUniverse[]>();

    // Create executive galaxies
    const galaxies: ExecutiveGalaxy[] = [];
    for (const [execType, def] of Object.entries(EXECUTIVE_DEFS)) {
      const et = execType as ExecutiveType;
      const pos = EXECUTIVE_POSITIONS[et];
      const galaxy: ExecutiveGalaxy = {
        id: `exec-${et}`,
        name: def.name,
        level: "executive-galaxy",
        runtimeId: et,
        position: { ...pos },
        orbit: {
          radius: Math.sqrt(pos.x * pos.x + pos.y * pos.y),
          speed: 0.05 + Math.random() * 0.03,
          inclination: 0.1 + Math.random() * 0.2,
          phase: Math.random() * Math.PI * 2,
          eccentricity: 0.2 + Math.random() * 0.3,
          driftX: 0,
          driftY: 0,
          driftZ: 0,
        },
        visualDNA: { ...def.visualDNA },
        activity: { ...idleActivity() },
        scale: 1.2,
        visible: true,
        parentId: null,
        childrenIds: [],
        domain: def.domain,
        morphology: { ...def.morphology },
      };
      galaxies.push(galaxy);
      execMap.set(et, []);
    }

    // Map agents to their executive galaxy
    const universes: AgentUniverse[] = [];
    for (const agent of agents) {
      const execType = AGENT_TO_EXECUTIVE[agent.id] ?? "sage";
      const siblings = execMap.get(execType) ?? [];
      const idx = siblings.length;
      const parentGalaxy = galaxies.find((g) => g.runtimeId === execType);
      if (!parentGalaxy) continue;

      const dna = agentVisualDNA(agent, parentGalaxy.visualDNA.hue);
      const universe: AgentUniverse = {
        id: `agent-${agent.id}`,
        name: agent.name,
        level: "agent-universe",
        runtimeId: agent.id,
        position: {
          x: parentGalaxy.position.x + Math.sin(idx * 1.3) * (3 + idx * 0.8),
          y: parentGalaxy.position.y + Math.cos(idx * 1.7) * (2 + idx * 0.6),
          z: parentGalaxy.position.z + Math.sin(idx * 0.9) * 2,
        },
        orbit: agentOrbit(idx, agents.length),
        visualDNA: dna,
        activity: {
          energy: agent.status === "active" ? 0.2 : 0.05,
          type: "idle",
          lastActive: agent.updatedAt,
          growth: Math.min(1, agent.executions.length / 20),
        },
        scale: 0.6 + agent.capabilities.length * 0.05,
        visible: true,
        parentId: parentGalaxy.id,
        childrenIds: [],
        systems: buildAgentSystems(agent),
        knowledgeCount: agent.knowledge.length,
        toolCount: agent.tools.length,
        memoryConnections: agent.memoryAccess === "read-write" ? 3 : agent.memoryAccess === "read" ? 1 : 0,
        growthStage: agent.executions.length > 20 ? "constellation" :
                     agent.executions.length > 10 ? "system" :
                     agent.executions.length > 5 ? "star" :
                     agent.executions.length > 0 ? "nebula" : "seed",
      };
      universes.push(universe);
      parentGalaxy.childrenIds.push(universe.id);
      siblings.push(universe);
    }

    // Build hierarchy paths
    const entities: CosmosEntity[] = [
      // LÉLU Core
      {
        id: "lelu-core",
        name: "LÉLU",
        level: "lelu-core",
        runtimeId: "lelu",
        position: { x: 0, y: 0, z: 0 },
        orbit: { radius: 0, speed: 0, inclination: 0, phase: 0, eccentricity: 0, driftX: 0, driftY: 0, driftZ: 0 },
        visualDNA: {
          hue: 195,
          saturation: 0.8,
          brightness: 1.0,
          geometry: "crystalline",
          mutationSeed: 0,
          particleDensity: 1.0,
          glowIntensity: 1.0,
        },
        activity: { energy: 0.3, type: "idle", lastActive: Date.now(), growth: 0 },
        scale: 1.8,
        visible: true,
        parentId: null,
        childrenIds: ["shaman"],
      },
      // SHAMAN
      {
        id: "shaman",
        name: "SHAMAN",
        level: "shaman",
        runtimeId: "shaman",
        position: { ...SHAMAN_POSITION },
        orbit: {
          radius: 3,
          speed: 0.08,
          inclination: 0.15,
          phase: 0,
          eccentricity: 0.15,
          driftX: 0,
          driftY: 0,
          driftZ: 0,
        },
        visualDNA: {
          hue: 220,
          saturation: 0.75,
          brightness: 0.9,
          geometry: "pulsing",
          mutationSeed: 1,
          particleDensity: 0.8,
          glowIntensity: 0.9,
        },
        activity: { energy: 0.15, type: "idle", lastActive: Date.now(), growth: 0 },
        scale: 1.4,
        visible: true,
        parentId: "lelu-core",
        childrenIds: galaxies.map((g) => g.id),
      },
      ...galaxies,
      ...universes,
    ];

    // Build aurora pathways
    const pathways: AuroraPathway[] = [];
    // LÉLU ↔ SHAMAN
    pathways.push(makePathway("lelu-core", "shaman", "hierarchy"));
    // SHAMAN ↔ each Executive
    for (const galaxy of galaxies) {
      pathways.push(makePathway("shaman", galaxy.id, "hierarchy"));
      // Executive ↔ its agent universes
      for (const uid of galaxy.childrenIds) {
        pathways.push(makePathway(galaxy.id, uid, "delegation"));
      }
    }

    this.state = {
      ...this.state,
      entities,
      executiveGalaxies: galaxies,
      agentUniverses: universes,
      auroraPathways: pathways,
    };
  }

  /* ------------------------------------------------------------------
   * RUNTIME CONNECTION — real events drive visual activity
   * ------------------------------------------------------------------ */

  private connectRuntime(): void {
    // AgentStore changes → rebuild hierarchy
    this.unsubAgentStore = AgentStore.getInstance().subscribe(() => {
      this.buildHierarchy();
      this.notify();
    });

    // Real agent events → update activity
    this.unsubAgentEvents = AgentEventBus.getInstance().subscribe((event) => {
      this.handleAgentEvent(event);
    });

    // Cognitive loop → overall system activity
    this.unsubCognitiveLoop = CognitiveLoop.getInstance().subscribe((report) => {
      this.updateCognitiveActivity(report);
    });
  }

  private handleAgentEvent(event: import("../../../../core/agent/AgentEvents").AgentEvent): void {
    const { agentUniverses, executiveGalaxies, entities } = this.state;
    let changed = false;

    // Map events to activity types
    let activityType: ActivityState["type"] = "idle";
    let energyDelta = 0.15;
    switch (event.type) {
      case "task_started":
      case "task_planning":
        activityType = "thinking";
        energyDelta = 0.4;
        break;
      case "tool_selected":
      case "tool_started":
        activityType = event.tool === "research" ? "researching" :
                       event.tool === "engineering" || event.tool === "sandbox" ? "coding" :
                       event.tool === "memory" ? "remembering" :
                       event.tool === "sketch" || event.tool === "render" ? "creating" : "thinking";
        energyDelta = 0.5;
        break;
      case "memory_retrieval":
      case "memory_update":
        activityType = "remembering";
        energyDelta = 0.3;
        break;
      case "tool_result":
        energyDelta = 0.2;
        break;
      case "task_completed":
        energyDelta = -0.1;
        break;
      case "task_failed":
        energyDelta = -0.15;
        break;
    }

    // Update SHAMAN activity for any agent event
    const shaman = entities.find((e) => e.id === "shaman");
    if (shaman) {
      shaman.activity.energy = Math.min(1, shaman.activity.energy + energyDelta * 0.5);
      shaman.activity.type = activityType;
      shaman.activity.lastActive = Date.now();
      changed = true;
    }

    // Update executive galaxies and agent universes
    for (const galaxy of executiveGalaxies) {
      const hasActiveChild = galaxy.childrenIds.some((cid) => {
        const agent = agentUniverses.find((u) => u.id === cid);
        return agent && event.taskId && agent.runtimeId;
      });
      if (hasActiveChild) {
        galaxy.activity.energy = Math.min(1, galaxy.activity.energy + energyDelta * 0.7);
        galaxy.activity.type = activityType;
        galaxy.activity.lastActive = Date.now();

        // Morphology mutation on sustained activity
        if (galaxy.morphology.mutationProgress < 1) {
          galaxy.morphology.mutationProgress = Math.min(1, galaxy.morphology.mutationProgress + 0.002);
        }
        changed = true;
      }
    }

    if (changed) {
      this.notify();
    }
  }

  private updateCognitiveActivity(report: import("../../../../core/cognition/CognitiveLoop").CognitiveCycleReport): void {
    const lelu = this.state.entities.find((e) => e.id === "lelu-core");
    if (lelu) {
      const totalActivity = report.observed.agents + report.observed.projects + report.suggestions.length;
      lelu.activity.energy = Math.min(0.8, 0.1 + totalActivity * 0.05);
      lelu.activity.lastActive = report.updatedAt;
    }
  }

  /* ------------------------------------------------------------------
   * ACTIVITY DECAY — calm inactive entities over time
   * ------------------------------------------------------------------ */

  private startActivityDecay(): void {
    this.activityDecayTimer = window.setInterval(() => {
      let changed = false;
      const now = Date.now();

      for (const entity of this.state.entities) {
        if (entity.activity.energy > 0.05) {
          const age = now - entity.activity.lastActive;
          // Decay faster if idle for more than 30s
          const decayRate = age > 30000 ? 0.008 : 0.003;
          entity.activity.energy = Math.max(0.05, entity.activity.energy - decayRate);
          if (entity.activity.energy <= 0.05) {
            entity.activity.type = "idle";
          }
          changed = true;
        }
      }

      if (changed) {
        this.notify();
      }
    }, 1000);
  }

  /* ------------------------------------------------------------------
   * CAMERA & LAYOUT PERSISTENCE
   * ------------------------------------------------------------------ */

  selectEntity(id: string | null): void {
    this.state.selectedEntityId = id;
    this.notify();
  }

  hoverEntity(id: string | null): void {
    this.state.hoveredEntityId = id;
  }

  updateCamera(camera: Partial<CosmosCameraState>): void {
    this.state.camera = { ...this.state.camera, ...camera };
    try {
      KvStore.getInstance().set(CAMERA_KEY, this.state.camera);
    } catch { /* persistence must never break */ }
  }

  updatePanelLayout(layout: Partial<PanelLayout>): void {
    this.state.panelLayout = { ...this.state.panelLayout, ...layout };
    try {
      KvStore.getInstance().set(LAYOUT_KEY, this.state.panelLayout);
    } catch { /* persistence must never break */ }
  }

  toggleOverview(): void {
    this.state.overview.visible = !this.state.overview.visible;
    this.notify();
  }

  togglePanel(key: keyof PanelLayout): void {
    const current = this.state.panelLayout[key];
    this.updatePanelLayout({ [key]: { ...current, expanded: !current.expanded } });
  }

  /* ------------------------------------------------------------------
   * NAVIGATION — smooth camera transitions to entities
   * ------------------------------------------------------------------ */

  navigateToEntity(id: string): void {
    const entity = this.state.entities.find((e) => e.id === id);
    if (!entity) return;

    this.selectEntity(id);
    // Camera transition target — the actual animation happens in the cosmos renderer
    this.state.camera = {
      position: {
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z + 8 / entity.scale,
      },
      target: { ...entity.position },
      zoom: entity.level === "lelu-core" ? 1 : entity.level === "shaman" ? 1.2 :
            entity.level === "executive-galaxy" ? 1.5 : entity.level === "agent-universe" ? 2 : 1,
      rotation: this.state.camera.rotation,
    };
    this.notify();
  }

  /* ------------------------------------------------------------------
   * CLEANUP
   * ------------------------------------------------------------------ */

  destroy(): void {
    if (this.unsubAgentStore) this.unsubAgentStore();
    if (this.unsubAgentEvents) this.unsubAgentEvents();
    if (this.unsubCognitiveLoop) this.unsubCognitiveLoop();
    if (this.activityDecayTimer !== null) window.clearInterval(this.activityDecayTimer);
    CosmosStore.instance = null;
  }
}

/* ------------------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------------------ */

function buildAgentSystems(agent: LeluAgent): AgentSystem[] {
  const systems: AgentSystem[] = [];
  let angle = 0;
  for (const tool of agent.tools) {
    systems.push({
      id: `${agent.id}-sys-${tool}`,
      name: tool,
      type: (tool === "research" || tool === "browse") ? "research" :
            (tool === "engineering" || tool === "sandbox") ? "coding" :
            (tool === "memory") ? "memory" :
            (tool === "sketch" || tool === "render" || tool === "video") ? "creative" :
            (tool === "projects") ? "knowledge" : "tool",
      activity: 0,
      position: {
        x: Math.sin(angle) * 1.5,
        y: Math.cos(angle) * 1.2,
        z: Math.sin(angle * 0.7) * 0.8,
      },
    });
    angle += (Math.PI * 2) / agent.tools.length;
  }
  return systems;
}

function makePathway(fromId: string, toId: string, type: AuroraPathway["type"]): AuroraPathway {
  return {
    id: `path-${fromId}-${toId}`,
    fromId,
    toId,
    type,
    energy: 0.1,
    particles: [],
  };
}
