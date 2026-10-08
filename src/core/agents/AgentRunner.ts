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

import { AgentDepthGuard, BUDGET_LIMITS } from "../memory/CognitiveBudget";
import MemoryOrchestrator from "../memory/MemoryProvider";
import { announce } from "../proactive/InitiationTriggers";

/**
 * How much of an agent's answer becomes a durable memory.
 *
 * §11 is explicit that an agent must not dump its whole working context into
 * LÉLU's permanent memory — that is the agent-shaped version of the OG memory
 * explosion. The execution record in AgentStore keeps the full result for
 * anyone who wants to read it; what crosses into long-term memory is the
 * insight, and only that.
 */
const AGENT_INSIGHT_CHARS = 600;

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

    // BOUNDED AGENT EXECUTION (§9, §11). An agent that delegates can reach
    // back into this method, and nothing previously stopped that descending
    // without end. Depth is counted per chain, so an agent fanning out to
    // many siblings is unaffected — only recursion is refused.
    const chainId = `${agent.id}:${resolvedChain(projectId, agentId)}`;
    if (!AgentDepthGuard.enter(chainId, BUDGET_LIMITS.agentDepth)) {
      return {
        ok: false,
        error:
          `"${agent.name}" stopped before spawning more work: agent depth ${BUDGET_LIMITS.agentDepth} reached. ` +
          "The chain is too deep to continue safely.",
        taskId: String(Date.now()),
      };
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
      // AGENT WORKING MEMORY → RESULT → MEMORY CANDIDATE → CONSOLIDATION (§11).
      // The full result stays in the execution record above. Only a bounded
      // insight is offered to memory, where MemoryEngine's existing
      // deduplication decides whether it is new, reinforces something known,
      // or supersedes it. Offering is best-effort: an agent that did useful
      // work has not failed because memory was busy.
      void this.consolidate(agent.name, task, response.text);

      // LÉLU speaks first only because an agent actually finished (§12). The
      // taskId is the evidence; announce() will not deliver without a real
      // summary, and checks the user's proactive setting before it does.
      announce({
        kind: "agent-finished",
        agentName: agent.name,
        task,
        taskId: taskRecord.id,
        summary: (response.text ?? "").trim(),
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
    } finally {
      AgentDepthGuard.exit(chainId);
    }
  }

  /**
   * Offer what an agent learned to long-term memory.
   *
   * Deliberately lossy: the first AGENT_INSIGHT_CHARS of the result, cut at a
   * sentence boundary. An agent's full output belongs in its execution record,
   * not in the memory LÉLU carries into every future conversation.
   */
  private async consolidate(agentName: string, task: string, result: string): Promise<void> {
    const text = result?.trim() ?? "";
    if (text.length < 40) return; // nothing an agent said that briefly is durable

    let insight = text.slice(0, AGENT_INSIGHT_CHARS);
    if (text.length > AGENT_INSIGHT_CHARS) {
      const cut = insight.lastIndexOf(". ");
      if (cut > 120) insight = insight.slice(0, cut + 1);
    }

    try {
      await MemoryOrchestrator.getInstance().persist({
        prompt: `What did ${agentName} find out about: ${task}?`,
        response: insight,
        category: "agent-insight",
        attribution: `agent ${agentName}`,
        metadata: { agentName, task, truncated: text.length > insight.length },
      });
    } catch (error) {
      console.warn("[AgentRunner] could not consolidate agent insight:", error);
    }
  }
}

/**
 * Identify the chain an agent run belongs to.
 *
 * Runs sharing a project are one chain, because that is how an agent
 * delegating to another agent presents. A run with no project is its own
 * chain, so unrelated ad-hoc runs never exhaust each other's depth.
 */
function resolvedChain(projectId: string | undefined, agentId: string): string {
  return projectId ?? `solo:${agentId}`;
}
