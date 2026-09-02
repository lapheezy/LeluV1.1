/**
 * ==========================================================
 * LÉLU — UI ACTION BUS
 *
 * The validated action/orchestration layer between cognition
 * and the real UI. This is the piece UIStateStore never had:
 * UIStateStore lets the UI tell cognition what changed
 * (read-only, React → core). This bus lets cognition make the
 * UI actually change (write, core → React) — through a real,
 * bounded action set, never an arbitrary DOM/state mutation.
 *
 * Contract:
 *  - The live UI (GenesisInterface, the one canonical interface
 *    — see the mount guard there) registers real handlers on
 *    mount, and declares exactly which panels/modules it
 *    currently supports. Cognition can never dispatch an action
 *    the mounted UI hasn't declared support for — this is the
 *    "only expose actions the actual UI supports" requirement.
 *  - Every dispatch is validated BEFORE it touches the UI, is
 *    executed through the same functions a user's click would
 *    call (openPanel/openModule/etc. from GenesisCore), and
 *    returns a real ok/detail result — never assumed success.
 *  - Every dispatch (successful or not) is written into
 *    UIStateStore (lastAction/actionHistory) so the rest of
 *    cognition sees the SAME truth this bus produced — no
 *    second, disagreeing source of "what did LÉLU just do".
 *  - No LLM output ever calls this bus directly. A resolver
 *    (e.g. EngineeringResolver) decides an action is warranted
 *    for a concrete reason, dispatches it, and reports the
 *    REAL result back to the user. The model narrates; this
 *    bus is what actually moves the UI.
 * ==========================================================
 */

import UIStateStore from "./UIStateStore";

export type UIActionType =
  | "open_panel"
  | "close_panel"
  | "open_module"
  | "minimize_module"
  | "close_module"
  | "return_to_previous";

export interface UIAction {
  type: UIActionType;
  /** Target panel/module id — required for panel/module actions. */
  target?: string;
  /** Why this action is happening — required for initiatedBy "lelu" so a UI
   * change is never silent about its cognitive reason. */
  reason: string;
  initiatedBy: "lelu" | "user";
}

export interface UIActionResult {
  ok: boolean;
  detail: string;
}

export interface UIActionHandlers {
  /** Exactly the panel ids the mounted UI can currently render — derived
   * from the real MODULE_RENDERERS map, never a hand-maintained guess. */
  supportedPanels: string[];
  openPanel(panel: string): void;
  openModule(id: string): void;
  minimizeModule(id: string): void;
  closeModule(id: string): void;
  /** Current active panel, read live — used to record "previous context"
   * before LÉLU navigates away from it. */
  getActivePanel(): string | null;
}

export default class UIActionBus {
  private static instance: UIActionBus | null = null;

  private handlers: UIActionHandlers | null = null;
  /** The panel that was active immediately before the last open_panel
   * dispatch — tracked regardless of who initiated it, so "go back"
   * behaves like a real back button for either a user command or
   * LÉLU's own self-navigation. */
  private previousPanel: string | null = null;
  private history: Array<UIAction & UIActionResult & { timestamp: number }> = [];
  private static readonly MAX_HISTORY = 30;

  private constructor() {}

  public static getInstance(): UIActionBus {
    if (!UIActionBus.instance) {
      UIActionBus.instance = new UIActionBus();
    }
    return UIActionBus.instance;
  }

  /**
   * Called by the one live GenesisInterface mount. Returns an unregister
   * function for cleanup on unmount, so a torn-down interface can never
   * leave a stale handler cognition would otherwise think was still live.
   */
  public registerHandlers(handlers: UIActionHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  /** Is a real, mounted UI currently reachable to act on? */
  public isConnected(): boolean {
    return this.handlers !== null;
  }

  public getHistory(): Array<UIAction & UIActionResult & { timestamp: number }> {
    return [...this.history];
  }

  /**
   * Dispatch one validated UI action. Always returns a real result —
   * never throws, never silently no-ops without saying so.
   */
  public dispatch(action: UIAction): UIActionResult {
    const result = this.execute(action);

    const entry = { ...action, ...result, timestamp: Date.now() };
    this.history.push(entry);
    if (this.history.length > UIActionBus.MAX_HISTORY) {
      this.history.splice(0, this.history.length - UIActionBus.MAX_HISTORY);
    }

    // Reflect into the shared world model — the same store the rest of
    // cognition already reads via CognitiveContext/StartupDiagnostic.
    UIStateStore.getInstance().update({
      lastAction: {
        type: action.type,
        target: action.target ?? null,
        detail: result.detail,
        initiatedBy: action.initiatedBy,
        ok: result.ok,
        timestamp: entry.timestamp,
      },
      actionHistory: this.history.slice(-10).map((h) => ({
        type: h.type,
        target: h.target ?? null,
        detail: h.detail,
        initiatedBy: h.initiatedBy,
        ok: h.ok,
        timestamp: h.timestamp,
      })),
    });

    return result;
  }

  private execute(action: UIAction): UIActionResult {
    if (!this.handlers) {
      return { ok: false, detail: "No LÉLU interface is currently mounted — there is nothing to act on." };
    }

    switch (action.type) {
      case "open_panel": {
        if (!action.target) return { ok: false, detail: "open_panel requires a target panel." };
        if (!this.handlers.supportedPanels.includes(action.target)) {
          return {
            ok: false,
            detail: `"${action.target}" is not a panel the current interface supports (supported: ${this.handlers.supportedPanels.join(", ")}).`,
          };
        }
        this.previousPanel = this.handlers.getActivePanel();
        this.handlers.openPanel(action.target);
        return { ok: true, detail: `Opened the "${action.target}" panel.` };
      }
      case "close_panel": {
        this.handlers.openPanel("none");
        return { ok: true, detail: "Closed the active panel." };
      }
      case "open_module": {
        if (!action.target) return { ok: false, detail: "open_module requires a target module id." };
        if (!this.handlers.supportedPanels.includes(action.target)) {
          return { ok: false, detail: `"${action.target}" is not a module the current interface supports.` };
        }
        this.handlers.openModule(action.target);
        return { ok: true, detail: `Opened the "${action.target}" module.` };
      }
      case "minimize_module": {
        if (!action.target) return { ok: false, detail: "minimize_module requires a target module id." };
        this.handlers.minimizeModule(action.target);
        return { ok: true, detail: `Minimized the "${action.target}" module.` };
      }
      case "close_module": {
        if (!action.target) return { ok: false, detail: "close_module requires a target module id." };
        this.handlers.closeModule(action.target);
        return { ok: true, detail: `Closed the "${action.target}" module.` };
      }
      case "return_to_previous": {
        if (this.previousPanel === null) {
          return { ok: false, detail: "No previous context recorded to return to." };
        }
        const target = this.previousPanel;
        this.handlers.openPanel(target === "none" ? "none" : target);
        this.previousPanel = null;
        return { ok: true, detail: `Returned to the previous "${target}" context.` };
      }
      default:
        return { ok: false, detail: `Unknown action type "${(action as UIAction).type}".` };
    }
  }
}
