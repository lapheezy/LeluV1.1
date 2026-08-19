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
  ): Promise<AgentRunResult> {
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
      return { ok: true, response, taskId: taskRecord.id, executionId: execution.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateTask(agentId, taskRecord.id, {
        status: "failed",
        completedAt: Date.now(),
        error: message,
      });
      return { ok: false, error: message, taskId: taskRecord.id };
    }
  }
}
