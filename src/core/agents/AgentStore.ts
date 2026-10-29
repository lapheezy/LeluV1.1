/**
 * ==========================================================
 * LÉLU
 * AGENT STORE — persistent agent workspace
 *
 * Full CRUD over the shared KvStore (localStorage + fallbacks,
 * offline-first): create, edit, duplicate, archive, enable/
 * pause, assign tools/memory/projects/providers, run tasks and
 * inspect execution history. Emits real AgentEventBus events so
 * the workspace surface and LÉLU's cognition see agent activity
 * through the same channel as everything else.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import AgentEventBus from "../agent/AgentEvents";
import {
  AGENT_TEMPLATES,
  SCIENTIFIC_AGENT_TEMPLATES,
  EXECUTIVE_AGENT_TEMPLATES,
  agentFromTemplate,
  type AgentTemplate,
} from "./AgentTemplates";
import { isExecutiveId, templateIdOf } from "./ExecutiveOwnership";
import type { ExecutiveId } from "../executive/ExecutiveBoard";
import type { AgentTask, AgentTaskStatus, AgentExecution, LeluAgent, AgentStatus, DelegatorId } from "./AgentTypes";

/** One row of the delegation ledger: a task, and the agent that owns it. */
export interface DelegationEntry {
  agentId: string;
  agentName: string;
  task: AgentTask;
}

export const INTERRUPTED_REASON =
  "The app stopped before it finished (reload, crash or closed tab). Nothing is running it now; resume it to continue.";

type AgentListener = (agents: LeluAgent[]) => void;

export default class AgentStore {
  private static instance: AgentStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly events = AgentEventBus.getInstance();
  private readonly listeners = new Set<AgentListener>();

  private constructor() {
    if (this.list().length === 0) {
      this.seedTemplates();
    }
    // A fresh store means a fresh process: no run from before it can still
    // be in flight. Anything persisted as "running" is a claim nothing backs.
    this.markInterruptedTasks();
    this.backfillTemplateIds();
  }

  /**
   * Give every agent created before `templateId` existed its template, by
   * name — once, persisted. Ownership (ExecutiveOwnership) and the Cosmos
   * then resolve from that stable id instead of the per-install UUID.
   * Agents with no matching template are left as they are.
   */
  private backfillTemplateIds(): void {
    let changed = false;
    const next = this.list().map((agent) => {
      if (agent.templateId) return agent;
      const templateId = templateIdOf(agent);
      if (!templateId) return agent;
      changed = true;
      return { ...agent, templateId };
    });
    if (changed) this.kv.set(AgentStore.KEY, next);
  }

  /** Make an executive the explicit owner of an agent (persisted). */
  public assignExecutive(agentId: string, executive: ExecutiveId): LeluAgent | undefined {
    if (!isExecutiveId(executive)) {
      throw new Error(`"${String(executive)}" is not an executive on the board.`);
    }
    return this.update(agentId, { executive });
  }

  /** Test-only: drop the singleton to simulate a restart over the same storage. */
  public static resetForTests(): void {
    AgentStore.instance = null;
  }

  /**
   * Turn every persisted "running" task into "interrupted", with the reason.
   * Called once per process (constructor). Returns how many were changed.
   */
  private markInterruptedTasks(): number {
    const now = Date.now();
    let changed = 0;
    const agents = this.list();
    const next = agents.map((agent) => {
      if (!agent.tasks.some((task) => task.status === "running")) return agent;
      return {
        ...agent,
        updatedAt: now,
        tasks: agent.tasks.map((task) => {
          if (task.status !== "running") return task;
          changed += 1;
          return { ...task, status: "interrupted" as const, completedAt: now, error: INTERRUPTED_REASON };
        }),
      };
    });
    if (changed > 0) {
      this.kv.set(AgentStore.KEY, next);
    }
    return changed;
  }

  public static getInstance(): AgentStore {
    if (!AgentStore.instance) {
      AgentStore.instance = new AgentStore();
    }
    return AgentStore.instance;
  }

  /* ------------------------------ persistence ------------------------------ */

  private static readonly KEY = "agents.v1";

  public list(): LeluAgent[] {
    const agents = this.kv.get<LeluAgent[]>(AgentStore.KEY) ?? [];
    return agents.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Merge remote records without discarding newer local work. */
  public mergeRemote(agents: LeluAgent[]): void {
    const local = this.list();
    const byId = new Map(local.map((agent) => [agent.id, agent]));
    for (const remote of agents) {
      const current = byId.get(remote.id);
      if (!current || remote.updatedAt > current.updatedAt) {
        byId.set(remote.id, remote);
      }
    }
    this.persist([...byId.values()]);
  }

  private persist(agents: LeluAgent[]): void {
    this.kv.set(AgentStore.KEY, agents);
    this.notify();
  }

  private mutate(mutator: (agents: LeluAgent[]) => LeluAgent[]): void {
    const agents = mutator(this.list());
    this.persist(agents);
  }

  /* -------------------------------- events -------------------------------- */

  public subscribe(listener: AgentListener): () => void {
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
        console.error("[Lélu AgentStore] listener threw (contained)", error);
      }
    }
  }

  /* ----------------------------- seeded agents ----------------------------- */

  /** Seed one agent per template so the workspace starts populated. */
  private seedTemplates(): void {
    const seeded = AGENT_TEMPLATES.map((template) => agentFromTemplate(template));
    this.kv.set(AgentStore.KEY, seeded);
  }

  public templates(): AgentTemplate[] {
    return AGENT_TEMPLATES;
  }

  /* --------------------------------- CRUD --------------------------------- */

  public get(id: string): LeluAgent | undefined {
    return this.list().find((agent) => agent.id === id);
  }

  public create(input: Partial<LeluAgent> & { name: string }): LeluAgent {
    const now = Date.now();
    const agent: LeluAgent = {
      id: crypto.randomUUID(),
      name: input.name,
      role: input.role ?? "",
      description: input.description ?? "",
      instructions: input.instructions ?? "",
      personality: input.personality ?? "",
      capabilities: input.capabilities ?? [],
      tools: input.tools ?? ["chat"],
      memoryAccess: input.memoryAccess ?? "none",
      knowledge: input.knowledge ?? [],
      provider: input.provider ?? null,
      fallbackProvider: input.fallbackProvider ?? null,
      projectId: input.projectId ?? null,
      status: input.status ?? "active",
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      tasks: [],
      executions: [],
      permissions: input.permissions ?? {
        canBrowse: false,
        canUseTools: true,
        canWriteMemory: false,
        canAccessProjects: false,
      },
    };
    this.mutate((agents) => [...agents, agent]);
    this.events.emit({
      type: "tool_result",
      taskId: String(now),
      tool: "agents",
      result: `Agent "${agent.name}" created`,
    });
    return agent;
  }

  /** Create from a template. */
  public createFromTemplate(templateId: string): LeluAgent {
    const template = AGENT_TEMPLATES.find((item) => item.id === templateId);
    const agent = agentFromTemplate(template ?? AGENT_TEMPLATES[0]);
    this.mutate((agents) => [...agents, agent]);
    return agent;
  }

  /**
   * Make sure the five executive agents from the mission's vision log
   * exist, and return them.
   *
   * Idempotent by NAME rather than by id, because agent ids are
   * generated per-install: matching on id would create a duplicate set
   * on every call. Agents the user has since renamed are deliberately
   * not resurrected — this creates what is missing, it does not enforce
   * a roster.
   *
   * Called by SelfStudy before it delegates, so cognition never fails
   * merely because an agent had not been created yet.
   */
  public ensureExecutiveAgents(): LeluAgent[] {
    const existing = this.list();
    const byName = new Map(existing.map((agent) => [agent.name.toLowerCase(), agent]));
    const created: LeluAgent[] = [];

    for (const template of EXECUTIVE_AGENT_TEMPLATES) {
      if (byName.has(template.name.toLowerCase())) continue;
      created.push(agentFromTemplate(template));
    }

    if (created.length > 0) {
      this.mutate((agents) => [...agents, ...created]);
    }

    const all = this.list();
    return EXECUTIVE_AGENT_TEMPLATES.map((template) =>
      all.find((agent) => agent.name.toLowerCase() === template.name.toLowerCase()),
    ).filter((agent): agent is LeluAgent => agent !== undefined);
  }

  /** The executive agent for a template id, if it has been created. */
  public executiveAgentByTemplate(templateId: string): LeluAgent | undefined {
    const template = EXECUTIVE_AGENT_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return undefined;
    return this.list().find((agent) => agent.name.toLowerCase() === template.name.toLowerCase());
  }

  /** On-demand scientific specialists (Caretaker health/bioengineering).
   *  Not auto-seeded — Agent Forge creates them only when needed. */
  public scientificTemplates(): AgentTemplate[] {
    return SCIENTIFIC_AGENT_TEMPLATES;
  }

  /** Forge a scientific specialist on demand. */
  public createScientificSpecialist(templateId: string): LeluAgent {
    const template =
      SCIENTIFIC_AGENT_TEMPLATES.find((item) => item.id === templateId) ??
      SCIENTIFIC_AGENT_TEMPLATES[0];
    const agent = agentFromTemplate(template);
    this.mutate((agents) => [...agents, agent]);
    this.events.emit({
      type: "tool_result",
      taskId: String(Date.now()),
      tool: "agent-forge",
      result: `Scientific specialist "${agent.name}" forged`,
    });
    return agent;
  }

  public update(id: string, patch: Partial<LeluAgent>): LeluAgent | undefined {
    let updated: LeluAgent | undefined;
    this.mutate((agents) =>
      agents.map((agent) => {
        if (agent.id !== id) {
          return agent;
        }
        updated = { ...agent, ...patch, id: agent.id, createdAt: agent.createdAt, updatedAt: Date.now() };
        return updated;
      }),
    );
    return updated;
  }

  /** Duplicate an agent (fresh id, fresh history). */
  public duplicate(id: string): LeluAgent | undefined {
    const source = this.get(id);
    if (!source) {
      return undefined;
    }
    const now = Date.now();
    const copy: LeluAgent = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name} Copy`,
      createdAt: now,
      updatedAt: now,
      tasks: [],
      executions: [],
    };
    this.mutate((agents) => [...agents, copy]);
    return copy;
  }

  /** Archive (soft delete — kept in storage, excluded from active lists). */
  public archive(id: string): void {
    this.update(id, { status: "archived", enabled: false });
  }

  /** Permanent delete. */
  public remove(id: string): void {
    this.mutate((agents) => agents.filter((agent) => agent.id !== id));
  }

  public setStatus(id: string, status: AgentStatus): void {
    this.update(id, { status, enabled: status === "active" ? true : this.get(id)?.enabled ?? false });
  }

  public setEnabled(id: string, enabled: boolean): void {
    this.update(id, { enabled, status: enabled ? "active" : "paused" });
  }

  /* ------------------------------ task history ----------------------------- */

  public recordTask(
    agentId: string,
    task: Omit<AgentTask, "id" | "createdAt">,
  ): AgentTask {
    const now = Date.now();
    const full: AgentTask = { ...task, id: crypto.randomUUID(), createdAt: now };
    this.mutate((agents) =>
      agents.map((agent) =>
        agent.id === agentId ? { ...agent, updatedAt: now, tasks: [full, ...agent.tasks].slice(0, 100) } : agent,
      ),
    );
    return full;
  }

  public updateTask(agentId: string, taskId: string, patch: Partial<AgentTask>): void {
    this.mutate((agents) =>
      agents.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              updatedAt: Date.now(),
              tasks: agent.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
            }
          : agent,
      ),
    );
  }

  public recordExecution(agentId: string, execution: Omit<AgentExecution, "id" | "createdAt">): AgentExecution {
    const now = Date.now();
    const full: AgentExecution = { ...execution, id: crypto.randomUUID(), createdAt: now };
    this.mutate((agents) =>
      agents.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              updatedAt: now,
              executions: [full, ...agent.executions].slice(0, 60),
            }
          : agent,
      ),
    );
    return full;
  }

  /* ------------------------------ runnable set ----------------------------- */

  /** Agents available for delegation: enabled + not archived. */
  public runnable(): LeluAgent[] {
    return this.list().filter((agent) => agent.enabled && agent.status !== "archived");
  }

  /* ---------------------------- delegation ledger ---------------------------- */

  /**
   * Every delegated task across all agents, newest first — read from the
   * same persisted task records, not a second store.
   */
  public delegations(filter: { status?: AgentTaskStatus; delegatedBy?: DelegatorId; agentId?: string } = {}): DelegationEntry[] {
    const entries: DelegationEntry[] = [];
    for (const agent of this.list()) {
      if (filter.agentId && agent.id !== filter.agentId) continue;
      for (const task of agent.tasks) {
        if (filter.status && task.status !== filter.status) continue;
        if (filter.delegatedBy && task.delegatedBy !== filter.delegatedBy) continue;
        entries.push({ agentId: agent.id, agentName: agent.name, task });
      }
    }
    return entries.sort((a, b) => b.task.createdAt - a.task.createdAt);
  }

  /** Agents assigned to a project. */
  public forProject(projectId: string): LeluAgent[] {
    return this.list().filter((agent) => agent.projectId === projectId);
  }
}
