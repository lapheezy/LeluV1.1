/**
 * ==========================================================
 * LÉLU
 * CREATIVE RESOLVER — the "Create this" route
 * ==========================================================
 *
 * Sits in the AIRouter pipeline before the research/provider fallback.
 * When the prompt is a creative generation request, it routes through
 * the unified CreativeOrchestrator (which performs REAL local actions
 * against RenderEngine / VideoStore / SandboxFS) and attaches the
 * honest capability result to the request context, so the provider
 * responds with knowledge of what actually happened instead of
 * guessing. Offline, it short-circuits with a deterministic report.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import type { AIResponse } from "../../providers/AIProvider";
import CreativeOrchestrator, { type CreativeResult } from "../creative/CreativeOrchestrator";
import AgentEventBus from "../agent/AgentEvents";

export default class CreativeResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt;
    const orchestrator = CreativeOrchestrator.getInstance();
    const capability = orchestrator.classify(prompt);

    if (capability === "text") {
      return { handled: false };
    }

    const result = await orchestrator.route(prompt);

    if (result.capability === "text" || !result.message) {
      return { handled: false };
    }

    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());

    if (result.handled) {
      events.emit({
        type: "tool_selected",
        taskId,
        tool: "creative",
        label: result.capability,
      });
      events.emit({
        type: "tool_started",
        taskId,
        tool: "creative",
        label: result.capability,
      });
    }

    context.logger.info("CreativeResolver", "Creative intent resolved", {
      capability: result.capability,
      status: result.status,
      handled: result.handled,
    });

    // Attach the real capability outcome so the provider (if any)
    // responds over the truth, not an imagined "I generated it".
    context.request.context = [
      context.request.context,
      `## Creative capability (${result.capability})\n${result.message}`,
    ]
      .filter((value) => Boolean(value && value.trim().length > 0))
      .join("\n\n");

    if (result.handled) {
      events.emit({
        type: "tool_result",
        taskId,
        tool: "creative",
        result: result.message.slice(0, 400),
      });
    }

    // Real produced image (e.g. the 3D render snapshot) is broadcast to
    // the chat/workspace so the UI can SHOW the artifact, not just report
    // it in text. The image is the actual output saved to RenderStore.
    if (result.artifact?.output) {
      events.emit({
        type: "creative_artifact",
        taskId,
        image: result.artifact.output,
        label: `${result.capability} render`,
      });
    }

    let providersAvailable = 0;
    try {
      providersAvailable = (await context.aiProviders.available()).length;
    } catch {
      providersAvailable = 0;
    }

    if (providersAvailable > 0) {
      return { handled: false };
    }

    return {
      handled: true,
      response: this.report(context, result),
    };
  }

  private report(context: RouterContext, result: CreativeResult): AIResponse {
    return {
      text: result.message,
      provider: "brain",
      model: "creative-orchestrator",
      processingTime: Date.now() - context.started,
      metadata: {
        source: "CreativeResolver",
        creative: true,
        capability: result.capability,
        status: result.status,
        offline: true,
      },
    };
  }
}
