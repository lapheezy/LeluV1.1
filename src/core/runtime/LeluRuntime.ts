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
  /** The concrete next step of the active goal, or null. */
  nextAction: string | null;
  taskCount: number;
  openTaskCount: number;
  agentCount: number;
  projectCount: number;
  memoryCount: number;
  providerNames: string[];
  activeProvider: string | null;
  /**
   * When memoryCount/providerNames/activeProvider were last really
   * measured. 0 means never — the caller can tell "no memories" apart
   * from "not measured yet" instead of trusting a zero.
   */
  statsMeasuredAt: number;
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
  /** Current conversation subject, fed by the runtime's own observers. */
  private conversationTopic: string | null = null;
  private recentActivity: string[] = [];
  private listeners = new Set<RuntimeListener>();
  private healthCheckTimer: number | null = null;
  private initialized = false;
  private cognitiveLoopStarted = false;
  private eventUnsubscribe: (() => void) | null = null;

  /**
   * The fields a snapshot can only learn by asking another subsystem
   * (memory count, provider list). They are refreshed whenever anything
   * awaits — getSnapshot() and checkHealth() — and reused by the
   * synchronous push in notify().
   *
   * This exists because notify() used to hardcode `memoryCount: 0`,
   * `providerNames: []`, `activeProvider: null`. Every UI subscriber was
   * therefore shown invented state on every change, while getSnapshot()
   * returned the truth — two different answers from one runtime that is
   * supposed to be the single source of truth. A last-known-real value
   * is honest; a hardcoded zero is not.
   */
  private liveStats = {
    memoryCount: 0,
    providerNames: [] as string[],
    activeProvider: null as string | null,
    /** 0 until the first real refresh, so "never measured" is visible. */
    measuredAt: 0,
  };

  private constructor() {
    this.health = this.loadHealth();
    this.location = this.loadLocation();
    this.goals = this.loadGoals();
    this.recentActivity = this.loadActivity();
    // Restoring the goal LIST without restoring which one is active left
    // LÉLU with no current goal after every reload: the plan was still on
    // disk, but nothing pointed at it, so "what am I working on?" and
    // "what is my next action?" both came back empty. Goal continuity
    // across a restart depends on this line.
    this.activeGoal = this.restoreActiveGoal();
  }

  /**
   * The goal LÉLU should resume on boot: the highest-priority active one,
   * most recently updated. A completed, paused or failed goal is never
   * resurrected.
   */
  private restoreActiveGoal(): RuntimeGoal | null {
    const active = this.goals.filter((goal) => goal.status === "active");
    if (active.length === 0) return null;
    return active.sort(
      (a, b) => a.priority - b.priority || b.updatedAt - a.updatedAt,
    )[0];
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
    } else if (event.type === "task_started") {
      // A user turn. This was the largest hole in the runtime: chat
      // emitted task_started/task_completed on the ONE event bus, but
      // only tool events were observed here — so the thing LÉLU spends
      // most of her existence doing never registered in her own state.
      this.recordActivity(`Asked: ${LeluRuntime.short(event.label)}`);
    } else if (event.type === "task_completed") {
      this.recordActivity(`Answered: ${LeluRuntime.short(event.label)}`);
    } else if (event.type === "task_failed") {
      this.recordActivity(
        `Failed: ${LeluRuntime.short(event.label)} — ${event.error ?? "unknown error"}`,
      );
    } else if (event.type === "memory_update") {
      this.recordActivity(`Remembered something (${event.category})`);
    } else if (event.type === "provider_selected") {
      // Keeps activeProvider true between the async refreshes, so the UI
      // shows who actually answered rather than a stale name.
      this.liveStats.activeProvider = event.provider;
    } else if (event.type === "browser_result") {
      this.recordActivity(
        event.status === "read"
          ? `Read ${event.url}`
          : `Could not read ${event.url} (${event.status})`,
      );
    }
  }

  /** Keep one activity line readable. */
  private static short(text: string, limit = 80): string {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
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
    await this.refreshLiveStats();
    return this.buildSnapshot();
  }

  /**
   * The next concrete action of the active goal — what LÉLU should do
   * now. Null when there is no active goal or its plan is exhausted.
   */
  nextAction(): string | null {
    const goal = this.activeGoal;
    if (!goal || goal.status !== "active") return null;
    return goal.steps[goal.currentStep] ?? null;
  }

  /** The goal LÉLU is currently working toward, if any. */
  getActiveGoal(): RuntimeGoal | null {
    return this.activeGoal ? { ...this.activeGoal } : null;
  }

  /** Every persisted goal, newest first. */
  getGoals(): RuntimeGoal[] {
    return this.goals.map((goal) => ({ ...goal }));
  }

  /** Re-measure the fields that require asking another subsystem. */
  private async refreshLiveStats(): Promise<void> {
    const ai = AIService.getInstance();
    const providers = ai.getProviders().ai;
    // The provider that LAST SUCCEEDED, from the registry that records it
    // (AIProviderRegistry.markSuccess → getActiveProvider). The previous
    // code searched the provider LIST for a `.active` field, behind an
    // `any` cast — that list has no such field, so activeProvider was
    // permanently null in the pulled snapshot as well as the pushed one.
    let activeProvider: string | null = this.liveStats.activeProvider;
    try {
      activeProvider = (await ai.getApiStatus()).activeProvider;
    } catch {
      // Keep the last value the provider_selected event gave us rather
      // than replacing a real name with a guess.
    }
    this.liveStats = {
      memoryCount: (await ai.getMemories(2000).catch(() => [])).length,
      providerNames: providers.map((provider) => provider.name),
      activeProvider,
      measuredAt: Date.now(),
    };
  }

  /**
   * ONE snapshot builder. getSnapshot() and notify() both use it, so the
   * pushed state and the pulled state cannot diverge — which is exactly
   * what happened when notify() built its own object literal with
   * hardcoded zeros in it.
   */
  private buildSnapshot(): RuntimeSnapshot {
    const queue = WorkQueue.getInstance().list();
    const world = WorldLifecycle.getInstance();
    return {
      self: SelfModel.getInstance().get(),
      health: this.health,
      location: this.location,
      activeGoal: this.activeGoal,
      nextAction: this.nextAction(),
      taskCount: queue.length,
      openTaskCount: queue.filter((item) => item.status === "open").length,
      agentCount: AgentStore.getInstance().list().length,
      projectCount: ProjectStore.getInstance().list().length,
      memoryCount: this.liveStats.memoryCount,
      providerNames: [...this.liveStats.providerNames],
      activeProvider: this.liveStats.activeProvider,
      statsMeasuredAt: this.liveStats.measuredAt,
      conversationTopic: this.conversationTopic,
      worldPhase: world.getPhase(),
      worldCycleCount: world.getCycleCount(),
      activeEngines: world.getActiveEngines().length,
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
    const snapshot = this.buildSnapshot();

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
