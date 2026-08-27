/**
 * ==========================================================
 * LÉLU RUNTIME — THE SINGLE SOURCE OF TRUTH
 *
 * One central runtime that knows the entire system state.
 * Every subsystem feeds into this; every output flows through it.
 * No competing versions of LÉLU's state.
 *
 * Hierarchy:
 *   LÉLU Runtime
 *     ├── Self Model (identity, state, capabilities)
 *     ├── Cognition (reasoning, planning, knowledge)
 *     ├── Memory (short-term, working, long-term, user)
 *     ├── Conversation (current thread, topic)
 *     ├── Goal State (active goals, objectives)
 *     ├── Task Engine (persistent multi-step tasks)
 *     ├── Tool Registry (all capabilities)
 *     ├── Provider Registry (AI providers + fallbacks)
 *     ├── UI Controller (interfaces, cosmos, avatar location)
 *     ├── Spatial State (cosmos positions, camera)
 *     ├── Voice State (listening, speaking, phase)
 *     └── System Health (all subsystem status)
 * ==========================================================
 */

import AIService from "../AIService";
import CognitiveLoop from "../cognition/CognitiveLoop";
import SelfModel from "../cognition/SelfModel";
import WorkQueue from "../cognition/WorkQueue";
import AgentStore from "../agents/AgentStore";
import ProjectStore from "../projects/ProjectStore";
import KvStore from "../storage/KvStore";
import WorldLifecycle from "../../app/scene/genesis/engines/WorldLifecycle";
import AgentEventBus, { type AgentEvent } from "../agent/AgentEvents";
import CapabilityManifest from "../capabilities/CapabilityManifest";

// ---------- TYPES ----------

export type SubsystemStatus = "online" | "degraded" | "offline" | "initializing";

export interface RuntimeHealth {
  cognition: SubsystemStatus;
  memory: SubsystemStatus;
  providers: SubsystemStatus;
  ui: SubsystemStatus;
  voice: SubsystemStatus;
  cosmos: SubsystemStatus;
  tasks: SubsystemStatus;
  engines: SubsystemStatus;
  world: SubsystemStatus;
  overall: SubsystemStatus;
  lastCheck: number;
}

export interface RuntimeLocation {
  galaxy: string;
  system: string;
  interface: string;
}

export interface RuntimeGoal {
  id: string;
  description: string;
  status: "active" | "completed" | "paused" | "failed";
  priority: number;
  startedAt: number;
  updatedAt: number;
  steps: string[];
  currentStep: number;
}

export interface RuntimeSnapshot {
  self: ReturnType<SelfModel["get"]>;
  health: RuntimeHealth;
  location: RuntimeLocation;
  activeGoal: RuntimeGoal | null;
  taskCount: number;
  openTaskCount: number;
  agentCount: number;
  projectCount: number;
  memoryCount: number;
  providerNames: string[];
  activeProvider: string | null;
  conversationTopic: string | null;
  recentActivity: string[];
  worldPhase: string;
  worldCycleCount: number;
  activeEngines: number;
  timestamp: number;
}

type RuntimeListener = (snapshot: RuntimeSnapshot) => void;

// ---------- CONSTANTS ----------

const HEALTH_KEY = "lelu.runtime.health.v1";
const LOCATION_KEY = "lelu.runtime.location.v1";
const GOALS_KEY = "lelu.runtime.goals.v1";
const ACTIVITY_KEY = "lelu.runtime.activity.v1";

// ---------- RUNTIME ----------

export default class LeluRuntime {
  private static instance: LeluRuntime | null = null;

  private health: RuntimeHealth;
  private location: RuntimeLocation;
  private activeGoal: RuntimeGoal | null = null;
  private goals: RuntimeGoal[] = [];
  private recentActivity: string[] = [];
  private listeners = new Set<RuntimeListener>();
  private healthCheckTimer: number | null = null;
  private initialized = false;
  private cognitiveLoopStarted = false;
  private eventUnsubscribe: (() => void) | null = null;

  private constructor() {
    this.health = this.loadHealth();
    this.location = this.loadLocation();
    this.goals = this.loadGoals();
    this.recentActivity = this.loadActivity();
  }

  static getInstance(): LeluRuntime {
    if (!LeluRuntime.instance) {
      LeluRuntime.instance = new LeluRuntime();
    }
    return LeluRuntime.instance;
  }

  // ---------- INITIALIZATION ----------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Run initial health check
    await this.checkHealth();

    // Start periodic health monitoring (every 30s)
    this.healthCheckTimer = window.setInterval(
      () => void this.checkHealth(),
      30_000,
    );

    // This runtime owns the background cognitive loop. Starting it here
    // keeps lifecycle ownership out of React and makes startup idempotent.
    if (!this.cognitiveLoopStarted) {
      CognitiveLoop.getInstance().start();
      this.cognitiveLoopStarted = true;
    }
    if (!this.eventUnsubscribe) {
      this.eventUnsubscribe = AgentEventBus.getInstance().subscribe((event) => this.observeEvent(event));
    }

    this.initialized = true;
    this.recordActivity("Runtime initialized");
    this.notify();
  }

  shutdown(): void {
    if (this.healthCheckTimer !== null) {
      window.clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    CognitiveLoop.getInstance().stop();
    this.cognitiveLoopStarted = false;
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = null;
    this.initialized = false;
  }

  // ---------- HEALTH ----------

  async checkHealth(): Promise<RuntimeHealth> {
    const ai = AIService.getInstance();

    const providersOk = ai.ready();
    const memories = await ai.getMemories(1).catch(() => []);

    const worldLifecycle = WorldLifecycle.getInstance();
    const worldPhase = worldLifecycle.getPhase();
    const engineCount = worldLifecycle.getActiveEngines().length;

    this.health = {
      cognition: CognitiveLoop.getInstance().getLastReport() ? "online" : "initializing",
      memory: memories.length >= 0 ? "online" : "offline",
      providers: providersOk ? "online" : "offline",
      ui: "online",
      voice: "online",
      cosmos: "online",
      tasks: "online",
      engines: engineCount > 0 ? "online" : "initializing",
      world: worldPhase ? "online" : "initializing",
      overall: "online",
      lastCheck: Date.now(),
    };

    // Determine overall status
    const statuses = [
      this.health.cognition,
      this.health.memory,
      this.health.providers,
    ];
    if (statuses.every((s) => s === "online")) {
      this.health.overall = "online";
    } else if (statuses.some((s) => s === "offline")) {
      this.health.overall = "degraded";
    }

    this.persistHealth();
    this.notify();
    return this.health;
  }

  private observeEvent(event: AgentEvent): void {
    if (event.type === "tool_result" && event.status !== "error") {
      const capability = event.tool === "projects" ? "task-engine" : event.tool;
      if (capability && CapabilityManifest.getInstance().get(capability)) {
        CapabilityManifest.getInstance().markUsed(capability);
      }
    }
    if (event.type === "execution_phase") {
      this.recordActivity(event.label);
    } else if (event.type === "tool_started") {
      this.recordActivity(`Using ${event.tool}`);
    } else if (event.type === "tool_failed") {
      this.recordActivity(`${event.tool} failed: ${event.error ?? "unknown error"}`);
    }
  }

  // ---------- LOCATION ----------

  setLocation(galaxy: string, system: string, iface: string): void {
    this.location = { galaxy, system, interface: iface };
    this.persistLocation();
    this.recordActivity(`Moved to ${galaxy} → ${system}`);
    this.notify();
  }

  getLocation(): RuntimeLocation {
    return { ...this.location };
  }

  // ---------- GOALS ----------

  setGoal(description: string, priority = 1, steps: string[] = []): RuntimeGoal {
    const goal: RuntimeGoal = {
      id: crypto.randomUUID(),
      description,
      status: "active",
      priority,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      steps,
      currentStep: 0,
    };
    this.activeGoal = goal;
    this.goals.unshift(goal);
    this.persistGoals();
    this.recordActivity(`New goal: ${description}`);
    this.notify();
    return goal;
  }

  completeGoal(goalId: string): void {
    const goal = this.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.status = "completed";
      goal.updatedAt = Date.now();
      if (this.activeGoal?.id === goalId) {
        this.activeGoal = null;
      }
      this.persistGoals();
      this.recordActivity(`Goal completed: ${goal.description}`);
      this.notify();
    }
  }

  advanceGoal(goalId: string): void {
    const goal = this.goals.find((g) => g.id === goalId);
    if (goal && goal.currentStep < goal.steps.length - 1) {
      goal.currentStep += 1;
      goal.updatedAt = Date.now();
      this.persistGoals();
      this.notify();
    }
  }

  // ---------- ACTIVITY ----------

  recordActivity(activity: string): void {
    const entry = `[${new Date().toLocaleTimeString()}] ${activity}`;
    this.recentActivity.unshift(entry);
    if (this.recentActivity.length > 50) {
      this.recentActivity = this.recentActivity.slice(0, 50);
    }
    this.persistActivity();

    // Emit on the runtime's own listener set so UI layers can react
    this.notify();
  }

  // ---------- SNAPSHOT ----------

  async getSnapshot(): Promise<RuntimeSnapshot> {
    return {
      self: SelfModel.getInstance().get(),
      health: this.health,
      location: this.location,
      activeGoal: this.activeGoal,
      taskCount: WorkQueue.getInstance().list().length,
      openTaskCount: WorkQueue.getInstance().list().filter((i) => i.status === "open").length,
      agentCount: AgentStore.getInstance().list().length,
      projectCount: ProjectStore.getInstance().list().length,
      memoryCount: (await AIService.getInstance().getMemories(1).catch(() => [])).length,
      providerNames: AIService.getInstance().getProviders().ai.map((p) => p.name),
      activeProvider: AIService.getInstance().getProviders().ai.find((p: any) => p.active)?.name ?? null,
      conversationTopic: null,
      worldPhase: WorldLifecycle.getInstance().getPhase(),
      worldCycleCount: WorldLifecycle.getInstance().getCycleCount(),
      activeEngines: WorldLifecycle.getInstance().getActiveEngines().length,
      recentActivity: [...this.recentActivity],
      timestamp: Date.now(),
    };
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = {
      self: SelfModel.getInstance().get(),
      health: this.health,
      location: this.location,
      activeGoal: this.activeGoal,
      taskCount: WorkQueue.getInstance().list().length,
      openTaskCount: WorkQueue.getInstance().list().filter((i) => i.status === "open").length,
      agentCount: AgentStore.getInstance().list().length,
      projectCount: ProjectStore.getInstance().list().length,
      memoryCount: 0,
      providerNames: [],
      activeProvider: null,
      conversationTopic: null,
      worldPhase: WorldLifecycle.getInstance().getPhase(),
      worldCycleCount: WorldLifecycle.getInstance().getCycleCount(),
      activeEngines: WorldLifecycle.getInstance().getActiveEngines().length,
      recentActivity: [...this.recentActivity],
      timestamp: Date.now(),
    } satisfies RuntimeSnapshot;

    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[LeluRuntime] Listener error:", err);
      }
    }
  }

  // ---------- PERSISTENCE ----------

  private loadHealth(): RuntimeHealth {
    try {
      const stored = KvStore.getInstance().get<Partial<RuntimeHealth>>(HEALTH_KEY);
      return {
        cognition: "initializing",
        memory: "initializing",
        providers: "initializing",
        ui: "online",
        voice: "online",
        cosmos: "online",
        tasks: "online",
        engines: "initializing",
        world: "initializing",
        overall: "initializing",
        lastCheck: 0,
        ...(stored ?? {}),
      };
    } catch {
      return {
        cognition: "initializing",
        memory: "initializing",
        providers: "initializing",
        ui: "online",
        voice: "online",
        cosmos: "online",
        tasks: "online",
        engines: "initializing",
        world: "initializing",
        overall: "initializing",
        lastCheck: 0,
      };
    }
  }

  private loadLocation(): RuntimeLocation {
    try {
      return KvStore.getInstance().get<RuntimeLocation>(LOCATION_KEY) ?? {
        galaxy: "genesis",
        system: "core",
        interface: "main",
      };
    } catch {
      return { galaxy: "genesis", system: "core", interface: "main" };
    }
  }

  private loadGoals(): RuntimeGoal[] {
    try {
      return KvStore.getInstance().get<RuntimeGoal[]>(GOALS_KEY) ?? [];
    } catch {
      return [];
    }
  }

  private loadActivity(): string[] {
    try {
      return KvStore.getInstance().get<string[]>(ACTIVITY_KEY) ?? [];
    } catch {
      return [];
    }
  }

  private persistHealth(): void {
    try { KvStore.getInstance().set(HEALTH_KEY, this.health); } catch { /* best-effort */ }
  }

  private persistLocation(): void {
    try { KvStore.getInstance().set(LOCATION_KEY, this.location); } catch { /* best-effort */ }
  }

  private persistGoals(): void {
    try { KvStore.getInstance().set(GOALS_KEY, this.goals.slice(0, 100)); } catch { /* best-effort */ }
  }

  private persistActivity(): void {
    try { KvStore.getInstance().set(ACTIVITY_KEY, this.recentActivity); } catch { /* best-effort */ }
  }
}
