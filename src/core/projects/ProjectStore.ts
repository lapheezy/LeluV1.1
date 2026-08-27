/**
 * ==========================================================
 * LÉLU
 * PROJECT STORE — the workspace / project system
 *
 * A project organizes real creative work: conversations, files,
 * images, sketches, renders, videos, agents, tasks, references,
 * notes, memories, outputs. Persistent and offline-first via the
 * shared KvStore. Project context is retrievable for cognition
 * (MemoryBridge) and injected into agent delegation.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import AgentEventBus from "../agent/AgentEvents";

export type ProjectItemKind =
  | "conversation"
  | "file"
  | "image"
  | "sketch"
  | "render"
  | "video"
  | "task"
  | "note"
  | "reference"
  | "memory"
  | "output";

export interface ProjectItem {
  id: string;
  kind: ProjectItemKind;
  title: string;
  /** Optional content reference (data URL, note text, external link…). */
  ref?: string;
  /** Optional short text payload (note body, task label, memory excerpt). */
  text?: string;
  /** Optional attached asset ids (sketch/render/video ids). */
  assetIds?: string[];
  createdAt: number;
  updatedAt: number;
}

/** Recurring schedule for autonomous project runs. */
export interface ProjectSchedule {
  frequency: "hourly" | "daily" | "weekly";
  /** Interval in ms derived from frequency. */
  intervalMs: number;
  lastRun?: number;
  nextRun?: number;
}

export interface ProjectCheckpoint {
  status: "active" | "paused" | "waiting_approval" | "waiting_user" | "blocked" | "completed" | "failed";
  summary: string;
  completed: string[];
  pending: string[];
  blockers: string[];
  nextAction: string | null;
  updatedAt: number;
}

export interface LeluProject {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "archived" | "completed";
  /** Agent ids assigned to this project. */
  agentIds: string[];
  items: ProjectItem[];
  /** Research topics this project tracks (used by ProjectRunner). */
  queries?: string[];
  /** Recurring schedule; present when the project runs autonomously. */
  schedule?: ProjectSchedule;
  /** The user's FULL instruction, verbatim — never truncated. */
  originalRequest?: string;
  /** One-line statement of what the project should achieve. */
  objective?: string;
  /** Surrounding context captured at creation (user/self state). */
  context?: string;
  /** Concrete, actionable tasks derived from the request. */
  actionableTasks?: string[];
  /** Priority (P0/P1/P2). */
  priority?: string;
  /** Subsystem this project targets (ui, avatar, memory, news, ...). */
  location?: string;
  /** Ordered execution plan steps. */
  executionPlan?: string[];
  /** Durable task checkpoint; survives reload and project pause/resume. */
  checkpoint?: ProjectCheckpoint;
  createdAt: number;
  updatedAt: number;
}

type ProjectListener = (projects: LeluProject[]) => void;

export const PROJECT_ITEM_LABELS: Record<ProjectItemKind, string> = {
  conversation: "Conversation",
  file: "File",
  image: "Image",
  sketch: "Sketch",
  render: "Render",
  video: "Video",
  task: "Task",
  note: "Note",
  reference: "Reference",
  memory: "Memory",
  output: "Output",
};

export default class ProjectStore {
  private static instance: ProjectStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly events = AgentEventBus.getInstance();
  private readonly listeners = new Set<ProjectListener>();

  private constructor() {
    if (this.list().length === 0) {
      this.seedDefaults();
    }
  }

  public static getInstance(): ProjectStore {
    if (!ProjectStore.instance) {
      ProjectStore.instance = new ProjectStore();
    }
    return ProjectStore.instance;
  }

  private static readonly KEY = "projects.v1";

  public list(): LeluProject[] {
    const projects = this.kv.get<LeluProject[]>(ProjectStore.KEY) ?? [];
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Merge remote records without discarding newer local work. */
  public mergeRemote(projects: LeluProject[]): void {
    const local = this.list();
    const byId = new Map(local.map((project) => [project.id, project]));
    for (const remote of projects) {
      const current = byId.get(remote.id);
      if (!current || remote.updatedAt > current.updatedAt) {
        byId.set(remote.id, remote);
      }
    }
    this.persist([...byId.values()]);
  }

  public subscribe(listener: ProjectListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.list());
      } catch (error) {
        console.error("[Lélu ProjectStore] listener threw (contained)", error);
      }
    }
  }

  private persist(projects: LeluProject[]): void {
    this.kv.set(ProjectStore.KEY, projects);
    this.notify();
  }

  private mutate(mutator: (projects: LeluProject[]) => LeluProject[]): void {
    this.persist(mutator(this.list()));
  }

  /** Seed a couple of starter projects so the Workspace opens populated. */
  private seedDefaults(): void {
    const now = Date.now();
    const starters: LeluProject[] = [
      {
        id: crypto.randomUUID(),
        name: "Jewelry",
        description: "Collection concepts, pendants, renders and reference material.",
        status: "active",
        agentIds: [],
        items: [
          {
            id: crypto.randomUUID(),
            kind: "note",
            title: "Collection direction",
            text: "Ancient Egyptian influence, antique gold, dark gemstones, cinematic candlelit presentation.",
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        name: "Fashion",
        description: "Garment concepts, fabric direction, styling and editorial renders.",
        status: "active",
        agentIds: [],
        items: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
    this.kv.set(ProjectStore.KEY, starters);
  }

  /* --------------------------------- CRUD --------------------------------- */

  public get(id: string): LeluProject | undefined {
    return this.list().find((project) => project.id === id);
  }

  public create(input: { name: string; description?: string }): LeluProject {
    const now = Date.now();
    const project: LeluProject = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? "",
      status: "active",
      agentIds: [],
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    this.mutate((projects) => [...projects, project]);
    this.events.emit({
      type: "tool_result",
      taskId: String(now),
      tool: "projects",
      result: `Project "${project.name}" created`,
    });
    return project;
  }

  public update(id: string, patch: Partial<LeluProject>): LeluProject | undefined {
    let updated: LeluProject | undefined;
    this.mutate((projects) =>
      projects.map((project) => {
        if (project.id !== id) {
          return project;
        }
        updated = { ...project, ...patch, id: project.id, createdAt: project.createdAt, updatedAt: Date.now() };
        return updated;
      }),
    );
    return updated;
  }

  public archive(id: string): void {
    this.update(id, { status: "archived" });
  }

  public pause(id: string): void {
    this.update(id, { status: "paused" });
  }

  public resume(id: string): void {
    this.update(id, { status: "active" });
  }

  /** Persist the current cognitive/task position without duplicating chat history. */
  public checkpoint(id: string, checkpoint: Omit<ProjectCheckpoint, "updatedAt">): LeluProject | undefined {
    return this.update(id, { checkpoint: { ...checkpoint, updatedAt: Date.now() } });
  }

  /** Case-insensitive lookup by (partial) name — "tampa news" → project. */
  public findByName(name: string): LeluProject | undefined {
    const needle = name.trim().toLowerCase();
    if (!needle) {
      return undefined;
    }
    return (
      this.list().find((project) => project.name.toLowerCase() === needle) ??
      this.list().find(
        (project) =>
          project.name.toLowerCase().includes(needle) ||
          needle.includes(project.name.toLowerCase()),
      )
    );
  }

  /** Attach or replace a recurring schedule. Next run = now + interval. */
  public setSchedule(id: string, frequency: ProjectSchedule["frequency"]): ProjectSchedule | undefined {
    const intervals: Record<ProjectSchedule["frequency"], number> = {
      hourly: 60 * 60 * 1000,
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
    };
    const schedule: ProjectSchedule = {
      frequency,
      intervalMs: intervals[frequency],
      nextRun: Date.now() + intervals[frequency],
    };
    this.update(id, { schedule });
    return schedule;
  }

  /** Persist a completed run: output item + schedule bookkeeping. */
  public recordRun(id: string, summary: string, resultCount: number): ProjectItem | undefined {
    const project = this.get(id);
    if (!project) {
      return undefined;
    }
    const item = this.addItem(id, {
      kind: "output",
      title: `Run — ${new Date().toLocaleString()}`,
      text: summary.slice(0, 2000),
      ref: resultCount > 0 ? `${resultCount} result(s)` : undefined,
    });
    if (project.schedule) {
      this.update(id, {
        schedule: {
          ...project.schedule,
          lastRun: Date.now(),
          nextRun: Date.now() + project.schedule.intervalMs,
        },
      });
    }
    return item;
  }

  /** Projects whose schedule is due (active + nextRun <= now). */
  public dueProjects(now = Date.now()): LeluProject[] {
    return this.list().filter(
      (project) =>
        project.status === "active" &&
        project.schedule !== undefined &&
        (project.schedule.nextRun ?? 0) <= now,
    );
  }

  /** Latest persisted run output for a project, if any. */
  public latestRun(id: string): ProjectItem | undefined {
    return this.get(id)?.items.find((item) => item.kind === "output");
  }

  public remove(id: string): void {
    this.mutate((projects) => projects.filter((project) => project.id !== id));
  }

  /* ------------------------------ agents ------------------------------ */

  public assignAgent(projectId: string, agentId: string): void {
    const project = this.get(projectId);
    if (!project) {
      return;
    }
    const agentIds = project.agentIds.includes(agentId)
      ? project.agentIds
      : [...project.agentIds, agentId];
    this.update(projectId, { agentIds });
  }

  public unassignAgent(projectId: string, agentId: string): void {
    const project = this.get(projectId);
    if (!project) {
      return;
    }
    this.update(projectId, { agentIds: project.agentIds.filter((id) => id !== agentId) });
  }

  /* ------------------------------- items ------------------------------- */

  public addItem(
    projectId: string,
    item: Omit<ProjectItem, "id" | "createdAt" | "updatedAt">,
  ): ProjectItem | undefined {
    const project = this.get(projectId);
    if (!project) {
      return undefined;
    }
    const now = Date.now();
    const full: ProjectItem = { ...item, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.update(projectId, { items: [full, ...project.items] });
    return full;
  }

  public addNote(projectId: string, title: string, text: string): ProjectItem | undefined {
    return this.addItem(projectId, { kind: "note", title, text });
  }

  public removeItem(projectId: string, itemId: string): void {
    const project = this.get(projectId);
    if (!project) {
      return;
    }
    this.update(projectId, { items: project.items.filter((item) => item.id !== itemId) });
  }

  /* ----------------------------- cognition ----------------------------- */

  /**
   * Format a project's real content into context text for cognition /
   * agent delegation. Only returns data that actually exists.
   */
  public contextFor(projectId: string): string {
    const project = this.get(projectId);
    if (!project) {
      return "";
    }
    const sections: string[] = [`## Project: ${project.name}`];
    if (project.objective) {
      sections.push(`Objective: ${project.objective}`);
    }
    if (project.description) {
      sections.push(project.description);
    }
    if (project.priority) {
      sections.push(`Priority: ${project.priority}`);
    }
    if (project.location) {
      sections.push(`Targets: ${project.location}`);
    }
    if (project.actionableTasks && project.actionableTasks.length > 0) {
      sections.push(`Tasks:\n${project.actionableTasks.map((task) => `- ${task}`).join("\n")}`);
    }
    if (project.executionPlan && project.executionPlan.length > 0) {
      sections.push(`Plan:\n${project.executionPlan.map((step, index) => `${index + 1}. ${step}`).join("\n")}`);
    }
    if (project.items.length > 0) {
      const lines = project.items.slice(0, 24).map((item) => {
        const label = PROJECT_ITEM_LABELS[item.kind];
        return `- ${label}: ${item.title}${item.text ? ` — ${item.text.slice(0, 140)}` : ""}`;
      });
      sections.push(`Items:\n${lines.join("\n")}`);
    }
    if (project.agentIds.length > 0) {
      sections.push(`Assigned agents: ${project.agentIds.length}`);
    }
    return sections.join("\n");
  }
}
