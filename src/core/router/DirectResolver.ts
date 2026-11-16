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
  if (command.transform) steps.push({ tool: "workspace.transform", args: { to: command.transform }, label: command.summary });
  if (command.stage) steps.push({ tool: "workspace.stage", args: { stage: command.stage }, label: command.transform ? `Showed it in the ${command.stage} workspace` : command.summary });
  return steps.length ? { steps, summary: command.summary, explicit: true } : null;
}

/**
 * LÉLU's interfaces (M17.1), as explicit commands — deterministic, so they
 * never need a model and run through the real dispatcher like any tool:
 *   /interfaces                 interface.list
 *   /open <interface>           interface.open   ("/open genesis v2")
 *   /open composition <id>      interface.open   (a saved composition)
 *   /close composition          interface.open   { close: true }
 *   /compose <a> + <b> [+ …]    interface.compose { action: create, open: true }
 * Only the slash form is claimed here. "Open her room" in words is a
 * request for the model, which may call the same tools.
 */
export function interfacePlan(prompt: string): DirectPlan | null {
  const p = prompt.trim();
  if (/^\/interfaces\s*$/i.test(p)) return { steps: [{ tool: "interface.list", args: {}, label: "List every interface and composition" }], summary: "List LÉLU's interfaces", explicit: true };
  if (/^\/close\s+composition\s*$/i.test(p)) return { steps: [{ tool: "interface.open", args: { close: true }, label: "Close the composition" }], summary: "Close the composition", explicit: true };
  const comp = /^\/open\s+composition\s+(\S+)\s*$/i.exec(p);
  if (comp) return { steps: [{ tool: "interface.open", args: { composition: comp[1] }, label: `Open composition ${comp[1]}` }], summary: `Open composition ${comp[1]}`, explicit: true };
  const open = /^\/open\s+(.+)$/i.exec(p);
  if (open) return { steps: [{ tool: "interface.open", args: { interface: open[1].trim() }, label: `Open ${open[1].trim()}` }], summary: `Open ${open[1].trim()}`, explicit: true };
  const compose = /^\/compose\s+(.+)$/i.exec(p);
  if (compose) {
    const parts = compose[1].split(/\s*(?:\+|→|->|,|\bthen\b)\s*/i).map((x) => x.trim()).filter(Boolean);
    return { steps: [{ tool: "interface.compose", args: { action: "create", interfaces: parts, open: true }, label: `Compose ${parts.join(" + ")}` }], summary: `Compose ${parts.join(" + ")} into one interface`, explicit: true };
  }
  return null;
}

/**
 * How much of a step's output belongs in the reply.
 *
 * A page reading returns the whole extracted article; echoing it filled the
 * conversation with a wall of Wikipedia prose that pushed the engine and the
 * diagrams out of view (the page itself is already in the activity card).
 * The reply keeps the shape of what was found, not the bulk of it.
 */
/**
 * A page reading reported by what it yielded, not by the page's chrome.
 *
 * The extracted text of an article starts with menus, language lists and
 * tables of contents; quoting it filled the reply with navigation whatever
 * cut was used. The page itself is in the conversation above, so the reply
 * names it and says how much was read.
 */
function pageLine(args: Record<string, unknown> | undefined, result: { ok: boolean; content: string }): string {
  const raw = typeof args?.url === "string" ? args.url : "";
  let host = raw;
  try {
    host = new URL(raw).hostname.replace(/^www\./, "") + new URL(raw).pathname.replace(/_/g, " ");
  } catch {
    /* keep the raw string */
  }
  if (!result.ok) return result.content;
  return `${host} — ${result.content.length.toLocaleString()} characters read, open above`;
}

function readingOf(content: string, max = 420): string {
  if (content.length <= max) return content;
  // A page extract opens with navigation ("Jump to content", menus, the
  // language list). Start at the first real paragraph instead of at the chrome.
  const lines = content.split("\n");
  const firstBody = lines.findIndex((line) => line.trim().length > 90);
  const body = firstBody > 0 ? lines.slice(firstBody).join("\n") : content;
  if (body.length <= max) return body;
  const head = body.slice(0, max);
  const cut = head.lastIndexOf(" ");
  return `${cut > max * 0.6 ? head.slice(0, cut) : head}… (the page is open in the conversation above)`;
}

/**
 * One plan per request, when both direct planners recognise it.
 *
 * The Workspace Steward reads "diagram", "movie" and "3D" as STAGE words
 * ("turn this into a board", "make it cinematic", "go 3D"); the creative kit
 * reads them as things to MAKE ("make an architecture diagram of LÉLU",
 * "make a movie about tides", "make me a 3D forest"). Measured on the merged
 * tree: the stage parser claimed all three and no artifact was made. A stage
 * change wins only when the request points at the conversation itself;
 * window organisation (tile, split, focus…) is never a creative request.
 */
export function directPlanFor(prompt: string): DirectPlan | null {
  const iface = interfacePlan(prompt);
  if (iface) return iface;
  const workspace = workspacePlan(prompt);
  const creative = compileDirect(prompt);
  if (!workspace) return creative;
  if (!creative) return workspace;
  const stageOnly = workspace.steps.every((step) => step.tool === "workspace.stage");
  const aboutTheConversation = /\b(this|it|the (chat|conversation|thread|workspace|view|screen)|our (chat|conversation)|my (chat|conversation|workspace))\b/i.test(prompt);
  return stageOnly && !aboutTheConversation ? creative : workspace;
}

export default class DirectResolver {
  /** The plan for this turn, if it has one. Pure. */
  public plan(context: RouterContext): DirectPlan | null {
    return directPlanFor(context.request.prompt ?? "");
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

  public async execute(context: RouterContext, plan: DirectPlan, reason: "command" | "construction" | "no-provider"): Promise<BrainResult> {
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
      // interface.* results are short, structured lists written for the
      // reply; the page-extract trimmer (readingOf) cut their header and
      // claimed "the page is open above". (M17.1)
      const detail = step.tool === "browser.read" ? pageLine(step.args, result) : step.tool.startsWith("interface.") ? result.content : readingOf(result.content);
      lines.push(`${result.ok ? "✓" : "✗"} ${step.label} (${step.tool})\n${detail.split("\n").map((l) => `  ${l}`).join("\n")}`);
    }
    const okCount = ran.filter((r) => r.ok).length;
    const onScene = plan.steps.every((step) => step.tool.startsWith("cosmos.object."));
    const workspace = plan.steps.every((step) => step.tool.startsWith("workspace."));
    // interface.* summaries are written as the REQUEST ("Open LÉLU's Room"),
    // so the preface can say truthfully whether it happened. (M17.1: a
    // refused "/open a toaster" used to begin "Opened a toaster. Done…".)
    const interfaces = plan.steps.every((step) => step.tool.startsWith("interface."));
    const preface = interfaces
      ? okCount === ran.length
        ? `${plan.summary} — done on this device. 0 model calls, nothing sent anywhere.`
        : `${plan.summary} — could not be done; the reason is below. 0 model calls, nothing sent anywhere.`
      : onScene
      ? `Done locally on the Cosmos scene${reason === "no-provider" ? " (no model provider is reachable, and none was needed)" : " — no model involved"}: ${plan.summary}.`
      : workspace
      ? `${plan.summary}. Done on this device — 0 model calls, nothing sent anywhere.`
      : reason === "no-provider"
      ? `No model provider is reachable right now, so I did this directly with my own tools — no model, no paid service: ${plan.summary}.`
      : reason === "construction"
        ? `Built by my construction engine from the parameters in your sentence — deterministic, so the same words always give the same model: ${plan.summary}.`
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
    if (!/^\/(art|diagram|scene|film|chart|research|data|sketch|collection|build|modify|explain|domains|capabilities|tools|export)\b/i.test(prompt)) return { handled: false };
    return {
      handled: true,
      response: { text: `That command needs more detail. Direct commands: ${DIRECT_COMMANDS.join(", ")}. E.g. “/scene forest”, “/diagram chat -> router -> tools”, “/export <artifact> glb”.`, provider: "lelu-direct", model: "tools", processingTime: 0, metadata: { direct: true } },
    };
  }
}
