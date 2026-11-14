/**
 * ==========================================================
 * LÉLU — DIRECT RESOLVER (tools without a model)
 *
 * Runs a compiled tool plan (creative/kit/DirectCompiler) through
 * the real dispatcher. Two entry points in AIRouter:
 *
 *   1. explicit commands ("/scene forest", "/film tides") — always,
 *      whatever the providers' state;
 *   2. natural-language creative/data requests — only when NO model
 *      provider can answer (none available, or the chain failed and
 *      returned the offline notice). The work is then done anyway
 *      and the reply says plainly that no model was used.
 *
 * Every step is a real dispatchToolCall: same AutonomyGate, same
 * events, same chat cards as a model's tool call. Nothing here
 * calls a model, so nothing here can be billed.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import { compileDirect, DIRECT_COMMANDS, type DirectPlan } from "../creative/kit/DirectCompiler";
import { parseWorkspaceCommand } from "../interface/WorkspaceSteward";

/**
 * "Tile my windows", "put the browser beside the chat", "make this
 * cinematic", "turn this into a research board": organising LÉLU's own
 * environment is deterministic, so it is always executed here, through the
 * real workspace.* tools, and never sent to a model. Explicit by design.
 */
export function workspacePlan(prompt: string): DirectPlan | null {
  const command = parseWorkspaceCommand(prompt);
  if (!command) return null;
  const steps: DirectPlan["steps"] = [];
  if (command.mode || command.open?.length) {
    steps.push({ tool: "workspace.arrange", args: { layout: command.mode ?? "auto", modules: command.open ?? [] }, label: command.summary });
  }
  if (command.stage) steps.push({ tool: "workspace.stage", args: { stage: command.stage }, label: command.summary });
  return steps.length ? { steps, summary: command.summary, explicit: true } : null;
}

export default class DirectResolver {
  /** The plan for this turn, if it has one. Pure. */
  public plan(context: RouterContext): DirectPlan | null {
    const prompt = context.request.prompt ?? "";
    return workspacePlan(prompt) ?? compileDirect(prompt);
  }

  /** Is any model provider able to take the turn right now? */
  public async providersAvailable(context: RouterContext): Promise<boolean> {
    try {
      const available = await context.aiProviders.available();
      return available.length > 0;
    } catch {
      return false;
    }
  }

  public async execute(context: RouterContext, plan: DirectPlan, reason: "command" | "no-provider"): Promise<BrainResult> {
    const { dispatchToolCall, toolNameForModel } = await import("../tools/ToolDispatcher");
    const taskId = String(context.request.timestamp ?? Date.now());
    const lines: string[] = [];
    const ran: Array<{ tool: string; ok: boolean }> = [];
    for (const [i, step] of plan.steps.entries()) {
      const result = await dispatchToolCall(
        { id: `direct-${taskId}-${i}`, name: toolNameForModel(step.tool), arguments: step.args },
        taskId,
        context,
        { path: "direct" },
      );
      ran.push({ tool: step.tool, ok: result.ok });
      lines.push(`${result.ok ? "✓" : "✗"} ${step.label} (${step.tool})\n${result.content.split("\n").map((l) => `  ${l}`).join("\n")}`);
    }
    const okCount = ran.filter((r) => r.ok).length;
    const workspace = plan.steps.every((step) => step.tool.startsWith("workspace."));
    const preface = workspace
      ? `${plan.summary}. I rearranged my own workspace locally — 0 model calls, nothing sent anywhere.`
      : reason === "no-provider"
      ? `No model provider is reachable right now, so I did this directly with my own tools — no model, no paid service: ${plan.summary}.`
      : `Done directly with my own tools (no model involved): ${plan.summary}.`;
    const response: AIResponse = {
      text: [preface, "", ...lines, "", okCount === ran.length ? "Everything above ran and was verified." : `${okCount} of ${ran.length} steps succeeded; the failures are shown with their reasons.`].join("\n"),
      provider: "lelu-direct",
      model: "tools",
      processingTime: Date.now() - context.started,
      metadata: { direct: true, reason, steps: ran, modelCalls: 0 },
    };
    return { handled: true, response };
  }

  /** "/something-unknown" — say which commands exist instead of sending it to a model. */
  public unknownCommand(context: RouterContext): BrainResult {
    const prompt = (context.request.prompt ?? "").trim();
    if (!/^\/(art|diagram|scene|film|chart|research|data|sketch|collection|capabilities|tools|export)\b/i.test(prompt)) return { handled: false };
    return {
      handled: true,
      response: { text: `That command needs more detail. Direct commands: ${DIRECT_COMMANDS.join(", ")}. E.g. “/scene forest”, “/diagram chat -> router -> tools”, “/export <artifact> glb”.`, provider: "lelu-direct", model: "tools", processingTime: 0, metadata: { direct: true } },
    };
  }
}
