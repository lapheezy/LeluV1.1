/**
 * ==========================================================
 * LÉLU — UI STATE STORE
 *
 * Lightweight observable UI state that the cognitive loop
 * and agents can read. Updated by the React layer whenever
 * significant UI changes happen (tab switches, panel opens,
 * scene changes, avatar state changes).
 *
 * NOT a React state — this is a core singleton that bridges
 * the React UI to the cognition runtime.
 * ==========================================================
 */

import type { ProactiveQuestion } from "../proactive/ProactiveCore";

/** One entry in the real UI action log — see UIActionBus. Never a claim;
 * only ever written by UIActionBus after a real dispatch attempt. */
export interface UIActionLogEntry {
  type: string;
  target: string | null;
  detail: string;
  initiatedBy: "lelu" | "user";
  ok: boolean;
  timestamp: number;
}

export interface UIStateSnapshot {
  activeQuestion: ProactiveQuestion | null;
  activeTab: string | null;
  openPanels: string[];
  /** Unified module presentations — "what is open / minimized / detached" LÉLU's orchestration reads. */
  modulePresentations: Record<string, string>;
  /** AUTO / ASSISTED / MANUAL presentation control. */
  uiControl: "auto" | "assisted" | "manual";
  activeScene: string;
  avatarState: string;
  cameraPosition: { x: number; y: number; zoom: number } | null;
  isChatOpen: boolean;
  isTyping: boolean;
  cosmosExploring: boolean;
  lastInteraction: number;

  /** The most recent real UI action LÉLU (or the user) took, via
   * UIActionBus — null until any action has ever been dispatched. */
  lastAction: UIActionLogEntry | null;
  /** Bounded history of recent real UI actions (newest last). */
  actionHistory: UIActionLogEntry[];
}

type UIStateListener = (state: UIStateSnapshot) => void;

const DEFAULT_STATE: UIStateSnapshot = {
  activeQuestion: null,
  activeTab: null,
  openPanels: [],
  modulePresentations: {},
  uiControl: "manual",
  activeScene: "cosmos",
  avatarState: "idle",
  cameraPosition: null,
  isChatOpen: false,
  isTyping: false,
  cosmosExploring: false,
  lastInteraction: 0,
  lastAction: null,
  actionHistory: [],
};

export default class UIStateStore {
  private static instance: UIStateStore | null = null;
  private state: UIStateSnapshot = { ...DEFAULT_STATE };
  private listeners = new Set<UIStateListener>();

  private constructor() {}

  public static getInstance(): UIStateStore {
    if (!UIStateStore.instance) {
      UIStateStore.instance = new UIStateStore();
    }
    return UIStateStore.instance;
  }

  /** Get the current UI state snapshot. */
  get(): UIStateSnapshot {
    return { ...this.state };
  }

  /** Update one or more fields and notify listeners. */
  update(patch: Partial<UIStateSnapshot>): void {
    this.state = { ...this.state, ...patch, lastInteraction: Date.now() };
    this.notify();
  }

  /** Subscribe to UI state changes. */
  subscribe(listener: UIStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // a broken listener must never crash the UI
      }
    }
  }
}
