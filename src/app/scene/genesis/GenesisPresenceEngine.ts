/**
 * ==========================================================
 * LÉLU
 * GENESIS PRESENCE ENGINE v2 — World-Aware Autonomous Living
 *
 * Drives autonomous attention, exploration, and UI interaction.
 *
 * Key upgrades from v1:
 *   - Queries WorldRegistry instead of hardcoded lists
 *   - Multi-scale: short-range (nearby UI), medium (inter-panel),
 *     long-range (cosmos)
 *   - Coverage tracking prevents Core fixation
 *   - Respects global selfExplorationEnabled flag
 *   - Natural varied behavior: inspect → travel → pause → change
 *
 * Priority:
 *   USER ACTION > ACTIVE CONVERSATION > SELF EXPLORATION ON >
 *   AUTONOMOUS ACTION > IDLE
 *
 * Offline-first: no external API dependency.
 * ==========================================================
 */

import WorldRegistry, { type WorldDestination } from "./WorldRegistry";

export type PresenceState =
  | "IDLE"
  | "OBSERVING"
  | "LISTENING"
  | "THINKING"
  | "EXPLORING"
  | "NAVIGATING"
  | "RESEARCHING"
  | "WORKING"
  | "CREATING"
  | "INTERACTING"
  | "RETURNING"
  | "PAUSED";

export interface PresenceContext {
  state: PresenceState;
  stateSince: number;
  lastAction: string;
  repeatCount: number;
  visited: string[];
  userActive: boolean;
  lastUserInteraction: number;
  conversationActive: boolean;
  ticksSinceLastAction: number;
  selfExplorationEnabled: boolean;
  /** Current exploration scale being used */
  currentScale: "short" | "medium" | "long" | null;
}

export interface PresenceActions {
  openPanel: (panel: string) => void;
  selectDestination: (dest: string) => void;
  focusWorkspace: (ws: string) => void;
  setMode: (mode: string) => void;
  /** Emit an explorer card instead of opening full panel */
  onDiscover: (panelId: string, label: string, icon: string, reasoning: string) => void;
}

export default class GenesisPresenceEngine {
  private static instance: GenesisPresenceEngine | null = null;

  private ctx: PresenceContext = {
    state: "IDLE",
    stateSince: Date.now(),
    lastAction: "",
    repeatCount: 0,
    visited: [],
    userActive: false,
    lastUserInteraction: 0,
    conversationActive: false,
    ticksSinceLastAction: 0,
    selfExplorationEnabled: true,
    currentScale: null,
  };

  private actions: PresenceActions | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(ctx: PresenceContext) => void>();
  private _running = false;
  private world = WorldRegistry.getInstance();

  /* Timing constants */
  private static readonly IDLE_BEFORE_EXPLORE = 10000;   // ms
  private static readonly MIN_ACTION_INTERVAL = 7000;     // ms
  private static readonly POST_USER_COOLDOWN = 14000;     // ms
  private static readonly TICK_MS = 2800;
  private static readonly SCALE_CYCLE: Array<"short" | "medium" | "long"> = ["short", "medium", "long", "medium"];

  private scaleIndex = 0;
  private pauseUntil = 0;

  private constructor() {}

  public static getInstance(): GenesisPresenceEngine {
    if (!GenesisPresenceEngine.instance) {
      GenesisPresenceEngine.instance = new GenesisPresenceEngine();
    }
    return GenesisPresenceEngine.instance;
  }

  public subscribe(fn: (ctx: PresenceContext) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public get running(): boolean {
    return this._running;
  }

  public get context(): PresenceContext {
    return { ...this.ctx };
  }

  public connect(actions: PresenceActions): void {
    this.actions = actions;
  }

  /** Set global self-exploration toggle. */
  public setSelfExploration(enabled: boolean): void {
    this.setContext({ selfExplorationEnabled: enabled });
    if (!enabled) {
      this.setContext({ state: "PAUSED", currentScale: null });
    } else if (this.ctx.state === "PAUSED") {
      this.setContext({ state: "IDLE", stateSince: Date.now() });
    }
  }

  public start(): void {
    if (this._running) return;
    this._running = true;
    this.intervalId = setInterval(() => this.tick(), GenesisPresenceEngine.TICK_MS);
    this.tick();

    // Listen for user-camera interaction so autonomous
    // camera movement never fights manual exploration.
    if (typeof window !== "undefined") {
      window.addEventListener("genesis-user-camera-start", this.onUserCameraStart);
      window.addEventListener("genesis-user-camera-end", this.onUserCameraEnd);
    }
  }

  public pause(): void {
    this.setContext({ state: "PAUSED" });
  }

  public resume(): void {
    this.setContext({ state: "IDLE", stateSince: Date.now() });
  }

  public noteUserActivity(): void {
    this.setContext({
      userActive: true,
      lastUserInteraction: Date.now(),
      ticksSinceLastAction: 0,
    });
  }

  public noteUserIdle(): void {
    this.setContext({ userActive: false });
  }

  public noteConversation(active: boolean): void {
    this.setContext({ conversationActive: active });
  }

  public stop(): void {
    this._running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("genesis-user-camera-start", this.onUserCameraStart);
      window.removeEventListener("genesis-user-camera-end", this.onUserCameraEnd);
    }
  }

  /* ================================================================
   * Internal evaluation loop
   * ================================================================ */

  private tick(): void {
    if (!this._running || !this.actions) return;

    this.world.tick();
    this.setContext({ ticksSinceLastAction: this.ctx.ticksSinceLastAction + 1 });

    // --- Gate: Self Exploration OFF → no autonomous actions ---
    if (!this.ctx.selfExplorationEnabled) {
      if (this.ctx.state !== "PAUSED" && this.ctx.state !== "IDLE") {
        this.setContext({ state: "IDLE" });
      }
      return;
    }

    // --- Gate: User active → yield ---
    if (this.ctx.userActive) return;

    // --- Gate: Conversation active → observe only ---
    if (this.ctx.conversationActive) {
      if (this.ctx.state !== "OBSERVING" && this.ctx.state !== "IDLE") {
        this.setContext({ state: "OBSERVING" });
      }
      return;
    }

    // --- Gate: Post-user cooldown ---
    const sinceUser = Date.now() - this.ctx.lastUserInteraction;
    if (this.ctx.lastUserInteraction > 0 &&
        sinceUser < GenesisPresenceEngine.POST_USER_COOLDOWN) {
      return;
    }

    // --- Gate: Minimum idle before first action ---
    if (this.ctx.ticksSinceLastAction <
        GenesisPresenceEngine.IDLE_BEFORE_EXPLORE / GenesisPresenceEngine.TICK_MS) {
      return;
    }

    // --- Gate: Pause period ---
    if (Date.now() < this.pauseUntil) return;

    // --- Gate: Minimum action interval ---
    const sinceAction = Date.now() - this.ctx.stateSince;
    if (sinceAction < GenesisPresenceEngine.MIN_ACTION_INTERVAL &&
        this.ctx.state !== "IDLE") {
      return;
    }

    // --- Execute ---
    this.chooseAndExecute();
  }

  private setContext(patch: Partial<PresenceContext>): void {
    this.ctx = { ...this.ctx, ...patch };
    for (const fn of this.listeners) {
      try { fn(this.ctx); } catch { /* contained */ }
    }
  }

  private onUserCameraStart = (): void => {
    this.setContext({
      userActive: true,
      lastUserInteraction: Date.now(),
      ticksSinceLastAction: 0,
    });
  };

  private onUserCameraEnd = (): void => {
    this.setContext({ userActive: false });
  };

  /* ================================================================
   * Action selection — world-aware with multi-scale cycling
   * ================================================================ */

  private chooseAndExecute(): void {
    // Cycle through scales to prevent getting stuck in one range
    const scale = GenesisPresenceEngine.SCALE_CYCLE[this.scaleIndex % GenesisPresenceEngine.SCALE_CYCLE.length]!;
    this.scaleIndex++;

    let selected: WorldDestination | null = null;

    // 30% chance: pick from the specific scale
    if (Math.random() < 0.3) {
      selected = this.world.selectAttention(scale);
    } else {
      selected = this.world.selectAttention("all");
    }

    if (!selected) return;

    // Mark visited and set state based on destination kind
    this.world.markVisited(selected.key);

    const chosen = selected.key;

    switch (selected.kind) {
      case "panel":
      case "tab":
      case "workspace": {
        const panelId = this.extractPanelId(chosen);
        const icon = iconForPanel(panelId);
        const reasoning = pickReasoning(panelId);
        this.setContext({ state: "RESEARCHING", stateSince: Date.now(), currentScale: selected.scale });
        // Register as cosmos entity (planet/star) AND navigate camera there
        this.actions!.onDiscover(panelId, selected.label, icon, reasoning);
        // Also navigate the camera to focus on what she's reviewing
        this.actions!.selectDestination(selected.label);
        break;
      }

      case "cosmos":
      case "environment":
        this.setContext({ state: "EXPLORING", stateSince: Date.now(), currentScale: selected.scale });
        this.actions!.selectDestination(selected.label);
        break;

      case "agent":
      case "simulation":
      case "visualization":
        this.setContext({ state: "OBSERVING", stateSince: Date.now(), currentScale: selected.scale });
        this.actions!.focusWorkspace(chosen);
        break;

      default:
        this.setContext({ state: "EXPLORING", stateSince: Date.now(), currentScale: selected.scale });
        this.actions!.selectDestination(selected.label);
        break;
    }

    // Track for anti-loop
    if (this.ctx.lastAction === chosen) {
      this.setContext({ repeatCount: this.ctx.repeatCount + 1 });
    } else {
      this.setContext({ repeatCount: 1 });
    }

    this.setContext({ lastAction: chosen });

    if (chosen && !this.ctx.visited.includes(chosen)) {
      this.setContext({ visited: [...this.ctx.visited.slice(-12), chosen] });
    }

    // Occasional pause: 15% chance to wait an extra cycle
    if (Math.random() < 0.15) {
      this.pauseUntil = Date.now() + 4000 + Math.random() * 6000;
    }
  }

  /** Extract a genesis panel ID from a WorldRegistry key like "panel-chat" */
  private extractPanelId(key: string): string {
    if (key.startsWith("panel-")) return key.slice(6);
    if (key.startsWith("workspace-")) return key.slice(10);
    return key;
  }
}

/** Icon map shared with GenesisExplorerCards. */
function iconForPanel(panelId: string): string {
  const map: Record<string, string> = {
    chat: "◎", cosmos: "✦", history: "≡", workspaces: "▦",
    genesisv2: "⬡", sketch: "✎", render: "◍", video: "▶",
    avatar: "◉", reasoning: "✦", cognition: "◬", engineering: "⌘",
    evolution: "⬖", agents: "◈", memory: "◐", providers: "⌁",
    settings: "⚙", device: "◮", diagnostics: "●", logs: "▤",
    browser: "◫", knowledge: "◬",
  };
  return map[panelId] ?? "◉";
}

function pickReasoning(panelId: string): string {
  const templates: Record<string, string[]> = {
    memory: ["Checking recent memories", "Reviewing history", "Consolidating knowledge", "Recalling context"],
    reasoning: ["Evaluating hypotheses", "Running inference", "Validating reasoning"],
    agents: ["Observing agent activity", "Checking agent status", "Coordinating agents"],
    cognition: ["Reviewing cognitive state", "Assessing attention", "Monitoring thought cycles"],
    engineering: ["Inspecting workspace", "Checking build status", "Reviewing code"],
    diagnostics: ["Running diagnostics", "Checking engine health", "Monitoring performance"],
    projects: ["Reviewing projects", "Checking milestones", "Organizing workspace"],
    providers: ["Checking API health", "Verifying providers", "Monitoring fallbacks"],
    cosmos: ["Navigating the universe", "Exploring celestial bodies", "Tracing star systems", "Surveying regions"],
    sketch: ["Opening sketchpad", "Reviewing visual drafts"],
    render: ["Checking render pipeline", "Previewing output"],
    avatar: ["Adjusting presence", "Checking avatar state"],
    video: ["Opening video workspace", "Reviewing media"],
    knowledge: ["Searching knowledge graph", "Exploring info nodes"],
    evolution: ["Tracking evolution", "Reviewing capability growth"],
    genesisv2: ["Entering Genesis v2", "Opening transformation lab"],
    history: ["Reviewing history", "Checking past conversations"],
    logs: ["Checking system logs", "Reviewing runtime events"],
    chat: ["Opening conversation", "Preparing chat workspace"],
    settings: ["Checking configuration", "Reviewing settings"],
  };
  const list = templates[panelId];
  if (!list || list.length === 0) return "Exploring...";
  return list[Math.floor(Math.random() * list.length)]!;
}