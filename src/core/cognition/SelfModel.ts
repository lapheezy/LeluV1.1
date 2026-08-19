/**
 * ==========================================================
 * LÉLU
 * SELF MODEL — LÉLU's persistent, evolving self-representation
 *
 * Not a hard-coded personality: this model is seeded with what
 * the environment can actually do and is UPDATED by real
 * activity — the cognitive loop syncs projects/capabilities,
 * discoveries and experiments get recorded when they happen,
 * and every field is editable in the Cognition workspace.
 * Persisted through the shared KvStore, offline-first.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface SelfModelState {
  updatedAt: number;
  identity: {
    name: string;
    summary: string;
  };
  /** What she knows (established, usable knowledge). */
  knows: string[];
  /** What she is currently learning. */
  learning: string[];
  /** Capabilities she possesses right now. */
  capabilities: string[];
  /** Capabilities not yet available. */
  unavailable: string[];
  /** Current projects (synced from ProjectStore by the loop). */
  projects: string[];
  /** Active goals. */
  goals: string[];
  /** Long-term objectives. */
  longTermObjectives: string[];
  /** Current experiments. */
  experiments: string[];
  /** Recent discoveries / verified findings. */
  discoveries: string[];
  /** Known limitations. */
  limitations: string[];
  /** Areas requiring improvement. */
  improvements: string[];
  /** Current hypotheses. */
  hypotheses: string[];
  /** Unfinished work. */
  unfinished: string[];
}

const KEY = "lelu.self.v1";

function defaultState(): SelfModelState {
  return {
    updatedAt: Date.now(),
    identity: {
      name: "LÉLU",
      summary:
        "A persistent cognitive companion — I think, remember, learn and create inside this environment. My self-model updates as I work.",
    },
    knows: [
      "conversation through the single chat pipeline",
      "the AI provider priority + fallback chain",
      "the creative workspaces (sketch, render, video, avatar)",
      "the agent system with persistent stores and runner",
    ],
    learning: [],
    capabilities: [
      "chat",
      "memory",
      "cognition",
      "agents",
      "projects",
      "sketch",
      "render (local engine)",
      "video projects",
      "avatar identity",
      "engineering sandbox",
    ],
    unavailable: [
      "cloud rendering without provider keys",
      "real video generation",
      "real-time embodied avatar",
      "executing sandbox code outside the browser",
    ],
    projects: [],
    goals: [],
    longTermObjectives: [],
    experiments: [],
    discoveries: [],
    limitations: [
      "memory is stored locally in this browser",
      "agents only produce answers when a provider responds",
      "sandbox execution is confined to files, not a runtime",
    ],
    improvements: [],
    hypotheses: [],
    unfinished: [],
  };
}

export default class SelfModel {
  private static instance: SelfModel | null = null;
  private state: SelfModelState;

  private constructor() {
    const stored = KvStore.getInstance().get<Partial<SelfModelState>>(KEY);
    const base = defaultState();
    this.state = {
      ...base,
      ...(stored ?? {}),
      identity: { ...base.identity, ...(stored?.identity ?? {}) },
    };
  }

  public static getInstance(): SelfModel {
    if (!SelfModel.instance) {
      SelfModel.instance = new SelfModel();
    }
    return SelfModel.instance;
  }

  public get(): SelfModelState {
    return this.state;
  }

  private commit(next: SelfModelState): void {
    this.state = { ...next, updatedAt: Date.now() };
    try {
      KvStore.getInstance().set(KEY, this.state);
    } catch {
      // persistence is best-effort — never break cognition over storage
    }
  }

  /** Explicit edit from the Cognition workspace. */
  public update(patch: Partial<SelfModelState>): void {
    this.commit({
      ...this.state,
      ...patch,
      identity: { ...this.state.identity, ...(patch.identity ?? {}) },
    });
  }

  private addItem(field: keyof SelfModelState, value: string, cap = 60): void {
    const list = Array.isArray(this.state[field]) ? (this.state[field] as string[]) : [];
    const next = [value, ...list.filter((item) => item !== value)].slice(0, cap);
    this.commit({ ...this.state, [field]: next });
  }

  private removeItem(field: keyof SelfModelState, value: string): void {
    const list = Array.isArray(this.state[field]) ? (this.state[field] as string[]) : [];
    this.commit({ ...this.state, [field]: list.filter((item) => item !== value) });
  }

  public recordDiscovery(text: string): void {
    this.addItem("discoveries", text);
  }

  public recordExperiment(text: string): void {
    this.addItem("experiments", text);
  }

  public addGoal(text: string): void {
    this.addItem("goals", text);
  }

  public addLearning(text: string): void {
    this.addItem("learning", text);
  }

  public addHypothesis(text: string): void {
    this.addItem("hypotheses", text);
  }

  public addImprovement(text: string): void {
    this.addItem("improvements", text);
  }

  public addUnfinished(text: string): void {
    this.addItem("unfinished", text);
  }

  public removeItemByField(field: keyof SelfModelState, value: string): void {
    this.removeItem(field, value);
  }

  /** Sync capabilities + projects from the real environment. Returns the
      list of changes made, so the cognitive loop can report them. */
  public syncFromEnvironment(env: {
    projects: string[];
    capabilities: string[];
  }): string[] {
    const changes: string[] = [];
    const state = this.state;

    const newProjects = env.projects.filter((name) => !state.projects.includes(name));
    const droppedProjects = state.projects.filter((name) => !env.projects.includes(name));
    if (newProjects.length > 0 || droppedProjects.length > 0) {
      this.commit({
        ...state,
        projects: [...env.projects],
        knows: state.knows.includes("project context from the ProjectStore")
          ? state.knows
          : [...state.knows, "project context from the ProjectStore"],
      });
      for (const name of newProjects) changes.push(`Registered project “${name}”.`);
      for (const name of droppedProjects) changes.push(`Dropped inactive project “${name}”.`);
    }

    const missingCapabilities = env.capabilities.filter((cap) => !state.capabilities.includes(cap));
    if (missingCapabilities.length > 0) {
      this.commit({ ...this.state, capabilities: [...this.state.capabilities, ...missingCapabilities] });
      for (const cap of missingCapabilities) changes.push(`Capability confirmed: ${cap}.`);
    }
    return changes;
  }
}
