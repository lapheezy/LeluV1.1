/**
 * ==========================================================
 * LÉLU UI ORCHESTRATOR — Cognition → Interface bridge
 *
 * Allows LÉLU's cognition to control the UI:
 *   - Navigate to panels/interfaces
 *   - Open/close/focus/minimize interfaces
 *   - Move the avatar
 *   - Create/move spatial nodes
 *   - Expand/collapse regions
 *   - Set cosmic focus target
 *
 * This bridges the runtime (LeluRuntime) with the Genesis UI
 * (GenesisCore state, CosmosStore, VisualEngine).
 * ==========================================================
 */

import LeluRuntime from "../runtime/LeluRuntime";

// ---------- TYPES ----------

export type UIPanel =
  | "chat"
  | "memory"
  | "agents"
  | "providers"
  | "reasoning"
  | "knowledge"
  | "device"
  | "diagnostics"
  | "logs"
  | "browser"
  | "sketch"
  | "render"
  | "video"
  | "avatar"
  | "projects"
  | "settings"
  | "cognition"
  | "engineering"
  | "evolution"
  | "history"
  | "workspaces"
  | "genesisv2"
  | "visual"
  | "none";

export interface UICommand {
  type: "openPanel" | "closePanel" | "navigateTo" | "focusEntity" | "setCosmicFocus" | "expandRegion" | "collapseRegion";
  target: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

type UICommandListener = (command: UICommand) => void;

// ---------- UI ORCHESTRATOR ----------

export default class UIOrchestrator {
  private static instance: UIOrchestrator | null = null;
  private commandHistory: UICommand[] = [];
  private listeners = new Set<UICommandListener>();
  private initialized = false;

  private constructor() {}

  static getInstance(): UIOrchestrator {
    if (!UIOrchestrator.instance) {
      UIOrchestrator.instance = new UIOrchestrator();
    }
    return UIOrchestrator.instance;
  }

  // ---------- INITIALIZATION ----------

  initialize(): void {
    if (this.initialized) return;
    // DO NOT subscribe to LeluRuntime here — doing so creates
    // an infinite recursion: snapshot → setCosmicFocus → emitCommand
    // → recordActivity → notify → setState → new snapshot → repeat.
    // UIOrchestrator only responds to explicit cognition commands.
    this.initialized = true;
  }

  // ---------- PANEL CONTROL ----------

  /**
   * Open a specific panel — dispatched through the REAL live surface
   * channel (`genesis-show-surface`), which GenesisSurfaceController
   * consumes to drive GenesisCore's actual openPanel state. This is
   * the same verified path the ExplorationController uses, so a
   * cognition-issued "open workspace" genuinely opens the surface.
   */
  openPanel(panel: UIPanel): void {
    this.emitCommand({
      type: "openPanel",
      target: panel,
      timestamp: Date.now(),
    });

    // Update runtime location
    const runtime = LeluRuntime.getInstance();
    runtime.setLocation(
      panel === "chat" || panel === "none" ? "genesis" : panel,
      panel,
      panel,
    );
  }

  /** Close the current panel. */
  closePanel(): void {
    this.emitCommand({
      type: "closePanel",
      target: "none",
      timestamp: Date.now(),
    });
  }

  /** Open panel based on intent classification. */
  openForIntent(intent: string): void {
    const panelMap: Record<string, UIPanel> = {
      chat: "chat",
      memory: "memory",
      research: "knowledge",
      engineering: "engineering",
      planning: "cognition",
      navigation: "chat",
      device: "device",
      creative: "sketch",
      identity: "avatar",
      agents: "agents",
    };

    const panel = panelMap[intent] ?? "chat";
    this.openPanel(panel);
  }

  // ---------- COSMOS CONTROL ----------

  /** Navigate the cosmos to a specific entity/galaxy. */
  navigateToEntity(entityId: string): void {
    this.emitCommand({
      type: "navigateTo",
      target: entityId,
      timestamp: Date.now(),
    });
  }

  /** Set the cosmic focus — camera target. */
  setCosmicFocus(target: string): void {
    this.emitCommand({
      type: "setCosmicFocus",
      target,
      timestamp: Date.now(),
    });
  }

  /** Focus on a specific entity in the cosmos. */
  focusEntity(entityId: string): void {
    this.emitCommand({
      type: "focusEntity",
      target: entityId,
      timestamp: Date.now(),
    });
  }

  /** Expand a region (galaxy, system, etc.). */
  expandRegion(regionId: string): void {
    this.emitCommand({
      type: "expandRegion",
      target: regionId,
      timestamp: Date.now(),
    });
  }

  /** Collapse a region. */
  collapseRegion(regionId: string): void {
    this.emitCommand({
      type: "collapseRegion",
      target: regionId,
      timestamp: Date.now(),
    });
  }

  // ---------- AUTOMATIC INTERFACE SELECTION ----------

  /**
   * Given a user request, determine the appropriate interface
   * transitions and execute them. This is how LÉLU automatically
   * navigates to the right interface.
   */
  async autoNavigate(request: string): Promise<void> {
    const lower = request.toLowerCase();

    // Code/engineering → engineering panel
    if (/\b(code|debug|fix|build|deploy|engineering|bug|error|compile)\b/.test(lower)) {
      this.openPanel("engineering");
      return;
    }

    // Memory/recall → memory panel
    if (/\b(remember|memory|recall|forgot|what do you know)\b/.test(lower)) {
      this.openPanel("memory");
      return;
    }

    // Research → knowledge panel
    if (/\b(search|find|look up|research|who is|what is|where is)\b/.test(lower)) {
      this.openPanel("knowledge");
      return;
    }

    // Planning → cognition panel
    if (/\b(plan|organize|schedule|task|project|strategy)\b/.test(lower)) {
      this.openPanel("cognition");
      return;
    }

    // Device → device panel
    if (/\b(photo|camera|record|voice|speak|microphone)\b/.test(lower)) {
      this.openPanel("device");
      return;
    }

    // Creative → sketch panel
    if (/\b(draw|sketch|design|create|art|visual)\b/.test(lower)) {
      this.openPanel("sketch");
      return;
    }

    // Navigation → cosmos
    if (/\b(navigate|go to|open|show|cosmos|galaxy|universe)\b/.test(lower)) {
      // Extract target
      const target = this.extractNavigationTarget(lower);
      if (target) {
        this.navigateToEntity(target);
        return;
      }
    }

    // Default: stay in chat
  }

  private extractNavigationTarget(lower: string): string | null {
    const patterns = [
      { pattern: /go to (?:the )?(\w+)/, group: 1 },
      { pattern: /navigate to (\w+)/, group: 1 },
      { pattern: /open (?:the )?(\w+)/, group: 1 },
      { pattern: /show (?:me )?(?:the )?(\w+)/, group: 1 },
    ];

    for (const { pattern, group } of patterns) {
      const match = lower.match(pattern);
      if (match) {
        return match[group] ?? null;
      }
    }
    return null;
  }

  // ---------- COMMAND HISTORY ----------

  getHistory(): UICommand[] {
    return [...this.commandHistory];
  }

  getLastCommand(): UICommand | null {
    return this.commandHistory[0] ?? null;
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: UICommandListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emitCommand(command: UICommand): void {
    this.commandHistory.unshift(command);
    if (this.commandHistory.length > 100) {
      this.commandHistory = this.commandHistory.slice(0, 100);
    }

    // Panel opens/closes go through the real live surface channel that
    // GenesisSurfaceController actually listens to. NEVER cast untyped
    // command objects onto AgentEventBus — fake-typed events polluted
    // the cognition event history and no consumer ever read them.
    if (command.type === "openPanel" && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("genesis-show-surface", {
          detail: { panel: command.target },
        }),
      );
    }
    if (command.type === "closePanel" && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("genesis-show-surface", { detail: { panel: "none" } }),
      );
    }

    // Notify direct listeners
    for (const listener of this.listeners) {
      try { listener(command); } catch { /* swallow */ }
    }

    LeluRuntime.getInstance().recordActivity(`UI: ${command.type} → ${command.target}`);
  }
}
