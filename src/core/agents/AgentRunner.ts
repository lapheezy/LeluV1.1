/**
 * ==========================================================
 * LÉLU
 * AGENT RUNNER — executes configured agents
 *
 * The orchestration entry point for the Agents workspace and
 * for LÉLU's delegation. Resolves the agent, records the task
 * lifecycle + execution history in the AgentStore, and runs
 * the actual work through AIService.delegate — the ONE runtime,
 * provider chain, and memory path. No second AI system.
 * ==========================================================
 */

import AIService from "../AIService";
import AgentEventBus from "../agent/AgentEvents";
import AgentStore from "./AgentStore";
import ProjectStore from "../projects/ProjectStore";
import type { AIResponse } from "../../providers/AIProvider";

export interface AgentRunResult {
  ok: boolean;
  response?: AIResponse;
  error?: string;
  taskId: string;
  executionId?: string;
}

export default class AgentRunner {
  private static instance: AgentRunner | null = null;

  private readonly store = AgentStore.getInstance();
  private readonly ai = AIService.getInstance();
  private readonly projects = ProjectStore.getInstance();

  private constructor() {}

  public static getInstance(): AgentRunner {
    if (!AgentRunner.instance) {
      AgentRunner.instance = new AgentRunner();
    }
    return AgentRunner.instance;
  }

  /**
   * Run an agent task. `projectId` (or the agent's assigned project)
   * is injected into the request as project context so the agent
   * works with real project information when it is relevant.
   */
  public async run(
    agentId: string,
    task: string,
    projectId?: string,
    /**
     * The cognitive turn this run belongs to, when it was started from
     * one. Passing it attributes the agent's work to that turn in the
     * cognitive trace; omitting it (a standalone run from the Agents
     * panel) gives the run its own id so it is never folded into an
     * unrelated turn's evidence chain.
     */
    parentTaskId?: string,
  ): Promise<AgentRunResult> {
    const events = AgentEventBus.getInstance();
    const agent = this.store.get(agentId);
    if (!agent) {
      return { ok: false, error: "Agent not found.", taskId: String(Date.now()) };
    }
    if (!agent.enabled || agent.status === "archived") {
      return { ok: false, error: `Agent "${agent.name}" is not enabled.`, taskId: String(Date.now()) };
    }

    const resolvedProject = projectId ?? agent.projectId ?? undefined;
    const projectContext = resolvedProject ? this.projects.contextFor(resolvedProject) : undefined;

    const taskRecord = this.store.recordTask(agentId, {
      label: task,
      status: "running",
      projectId: resolvedProject,
    });

    // Every agent run announces itself on the ONE bus from here, so the
    // runtime, the cognitive trace and the UI activity feed all see the
    // same thing. Previously this method emitted nothing at all: a run
    // started from the Agents panel was invisible to the rest of LÉLU —
    // it wrote to AgentStore and no other subsystem ever knew.
    const eventTaskId = parentTaskId ?? taskRecord.id;
    const startedAt = Date.now();
    events.emit({
      type: "agent_started",
      taskId: eventTaskId,
      agent: agent.name,
      objective: task,
    });

    try {
      const response = await this.ai.delegate(agent, task, projectContext);
      const execution = this.store.recordExecution(agentId, {
        taskId: taskRecord.id,
        prompt: task,
        provider: response.provider,
        model: response.model,
        offline: response.provider === "offline",
        result: response.text,
        processingTime: response.processingTime,
      });
      this.store.updateTask(agentId, taskRecord.id, {
        status: "complete",
        completedAt: Date.now(),
        executionId: execution.id,
      });
      // The agent's result RETURNS to the runtime here, rather than
      // stopping at the caller — the orchestrator decides what happens
      // next from the same event stream everything else uses.
      events.emit({
        type: "agent_completed",
        taskId: eventTaskId,
        agent: agent.name,
        objective: task,
        provider: response.provider,
        durationMs: Date.now() - startedAt,
        resultPreview: response.text.slice(0, 160),
      });
      return { ok: true, response, taskId: taskRecord.id, executionId: execution.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateTask(agentId, taskRecord.id, {
        status: "failed",
        completedAt: Date.now(),
        error: message,
      });
      // A failure is an event too — never a silent death.
      events.emit({
        type: "agent_failed",
        taskId: eventTaskId,
        agent: agent.name,
        objective: task,
        error: message,
      });
      return { ok: false, error: message, taskId: taskRecord.id };
    }
  }
}
