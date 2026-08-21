/**
 * ==========================================================
 * LÉLU PROACTIVE ASSISTANCE
 *
 * Moves from USER → COMMAND → LÉLU
 * toward LÉLU observes → determines → asks/acts
 *
 * Permission-controlled:
 *   Level 0: Observes only, never acts
 *   Level 1: Suggests, asks permission
 *   Level 2: Acts on low-risk tasks, asks on high-risk
 *   Level 3: Acts autonomously within defined boundaries
 *
 * Not constantly interrupting — contextual, respectful, useful.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import LeluRuntime from "../runtime/LeluRuntime";
import BackgroundEngine from "../tasks/BackgroundEngine";
import CognitiveLoop from "./CognitiveLoop";
import SelfModel from "./SelfModel";

export type ProactiveLevel = 0 | 1 | 2 | 3;

export interface ProactiveSuggestion {
  id: string;
  type: "reminder" | "suggestion" | "action" | "status";
  title: string;
  detail: string;
  permission: "auto" | "ask";
  riskLevel: number;
  createdAt: number;
  dismissed: boolean;
  accepted: boolean;
}

const KEY = "lelu.proactive.v1";
const SUGGESTIONS_KEY = "lelu.proactive.suggestions.v1";

type ProactiveListener = (suggestion: ProactiveSuggestion) => void;

export default class ProactiveEngine {
  private static instance: ProactiveEngine | null = null;
  private level: ProactiveLevel = 1;
  private suggestions: ProactiveSuggestion[] = [];
  private listeners = new Set<ProactiveListener>();
  private checkTimer: number | null = null;

  private constructor() {
    this.level = this.loadLevel();
    this.suggestions = this.loadSuggestions();
  }

  static getInstance(): ProactiveEngine {
    if (!ProactiveEngine.instance) {
      ProactiveEngine.instance = new ProactiveEngine();
    }
    return ProactiveEngine.instance;
  }

  // ---------- LIFECYCLE ----------

  start(): void {
    if (this.checkTimer !== null) return;
    // Check every 2 minutes
    this.checkTimer = window.setInterval(() => void this.check(), 120_000);
    // Initial check after 10 seconds
    window.setTimeout(() => void this.check(), 10_000);
  }

  stop(): void {
    if (this.checkTimer !== null) {
      window.clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  // ---------- LEVEL CONTROL ----------

  setLevel(level: ProactiveLevel): void {
    this.level = level;
    try { KvStore.getInstance().set(KEY, { level }); } catch { /* best-effort */ }
  }

  getLevel(): ProactiveLevel {
    return this.level;
  }

  // ---------- SUGGESTIONS ----------

  getSuggestions(): ProactiveSuggestion[] {
    return this.suggestions.filter((s) => !s.dismissed);
  }

  acceptSuggestion(id: string): void {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (suggestion) {
      suggestion.accepted = true;
      this.persistSuggestions();
      LeluRuntime.getInstance().recordActivity(`Accepted: ${suggestion.title}`);
    }
  }

  dismissSuggestion(id: string): void {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (suggestion) {
      suggestion.dismissed = true;
      this.persistSuggestions();
    }
  }

  // ---------- CHECK CYCLE ----------

  private async check(): Promise<void> {
    if (this.level === 0) return; // observations only, no suggestions

    const runtime = LeluRuntime.getInstance();
    const bgEngine = BackgroundEngine.getInstance();
    const selfModel = SelfModel.getInstance();
    const loop = CognitiveLoop.getInstance();

    const newSuggestions: ProactiveSuggestion[] = [];

    // 1. Check for stale/paused tasks
    if (this.level >= 1) {
      const staleReminders = bgEngine.checkForStaleTasks();
      for (const reminder of staleReminders) {
        if (!this.hasRecentSuggestion(reminder)) {
          newSuggestions.push(this.createSuggestion(
            "reminder",
            "Paused Task",
            reminder,
            "ask",
            1,
          ));
        }
      }
    }

    // 2. Check cognitive loop for suggestions
    if (this.level >= 1) {
      const report = loop.getLastReport();
      if (report && report.suggestions.length > 0) {
        for (const suggestion of report.suggestions.slice(0, 2)) {
          if (!this.hasRecentSuggestion(suggestion)) {
            newSuggestions.push(this.createSuggestion(
              "suggestion",
              "Cognitive Suggestion",
              suggestion,
              "ask",
              1,
            ));
          }
        }
      }
    }

    // 3. Check for unfinished work
    if (this.level >= 2) {
      const unfinished = selfModel.get().unfinished;
      for (const item of unfinished.slice(0, 1)) {
        if (!this.hasRecentSuggestion(item)) {
          newSuggestions.push(this.createSuggestion(
            "reminder",
            "Unfinished Work",
            `You have unfinished work: ${item}. Want me to continue?`,
            "ask",
            1,
          ));
        }
      }
    }

    // 4. System health status
    if (this.level >= 1) {
      const snapshot = await runtime.getSnapshot();
      const health = snapshot.health;
      if (health.providers === "offline") {
        if (!this.hasRecentSuggestion("providers offline")) {
          newSuggestions.push(this.createSuggestion(
            "status",
            "Providers Offline",
            "All AI providers are currently offline. I'm working with local memory only.",
            "auto",
            0,
          ));
        }
      }
    }

    // Add new suggestions
    if (newSuggestions.length > 0) {
      this.suggestions.unshift(...newSuggestions);
      if (this.suggestions.length > 50) {
        this.suggestions = this.suggestions.slice(0, 50);
      }
      this.persistSuggestions();

      // Emit each new suggestion
      for (const suggestion of newSuggestions) {
        this.emit(suggestion);
      }
    }
  }

  private hasRecentSuggestion(text: string): boolean {
    const recentThreshold = Date.now() - 30 * 60 * 1000; // 30 minutes
    return this.suggestions.some(
      (s) => s.detail.includes(text.slice(0, 40)) && s.createdAt > recentThreshold,
    );
  }

  private createSuggestion(
    type: ProactiveSuggestion["type"],
    title: string,
    detail: string,
    permission: "auto" | "ask",
    riskLevel: number,
  ): ProactiveSuggestion {
    return {
      id: crypto.randomUUID(),
      type,
      title,
      detail,
      permission,
      riskLevel,
      createdAt: Date.now(),
      dismissed: false,
      accepted: false,
    };
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: ProactiveListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(suggestion: ProactiveSuggestion): void {
    for (const listener of this.listeners) {
      try { listener(suggestion); } catch { /* swallow */ }
    }
  }

  // ---------- PERSISTENCE ----------

  private loadLevel(): ProactiveLevel {
    try {
      const data = KvStore.getInstance().get<{ level: ProactiveLevel }>(KEY);
      return data?.level ?? 1;
    } catch { return 1; }
  }

  private loadSuggestions(): ProactiveSuggestion[] {
    try {
      return KvStore.getInstance().get<ProactiveSuggestion[]>(SUGGESTIONS_KEY) ?? [];
    } catch { return []; }
  }

  private persistSuggestions(): void {
    try {
      KvStore.getInstance().set(SUGGESTIONS_KEY, this.suggestions.slice(0, 50));
    } catch { /* best-effort */ }
  }
}
