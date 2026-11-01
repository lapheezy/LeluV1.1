/**
 * ==========================================================
 * LÉLU — TASK PLANNER
 *
 * Turns a request into an EXECUTABLE plan: steps that name a
 * real tool with arguments, a real agent with an instruction,
 * or a reasoning prompt — with dependencies and checks.
 *
 * The model proposes; this module disposes. Every plan, whether
 * a model wrote it or a caller supplied it, is validated against
 * the live capability catalog before anything runs:
 *
 *   • every tool must exist, have an executor, be available,
 *     and be permitted or approvable right now;
 *   • every agent must be runnable;
 *   • dependencies may only point backwards (no cycles, no
 *     dangling ids), and `{{steps.X.output}}` may only reference
 *     a step that runs first;
 *   • at most MAX_STEPS steps.
 *
 * An invalid model plan gets ONE repair round with the exact
 * errors. A plan that is still invalid is refused with reasons —
 * it is never "mostly run".
 *
 * Lessons from earlier tasks (ObjectiveLearning.guidanceFor) are
 * put in front of the model, so what failed last time shapes
 * this plan.
 * ==========================================================
 */

import type { StepAction, StepVerification } from "../tasks/TaskEngine";
import TaskEngine, { type Task } from "../tasks/TaskEngine";
import { describeCapabilities, listCapabilities, usableCapabilities, type Capability } from "./CapabilityCatalog";

export const MAX_STEPS = 12;

/** A step as a model or caller writes it. Exactly one of tool / agent / prompt. */
export interface PlanStepInput {
  id?: string;
  title: string;
  tool?: string;
  args?: Record<string, unknown>;
  agent?: string;
  instruction?: string;
  prompt?: string;
  dependsOn?: string[];
  verify?: StepVerification;
  maxAttempts?: number;
}

export interface ValidatedStep {
  id: string;
  title: string;
  description: string;
  action: StepAction;
  dependsOn?: string[];
  verify?: StepVerification;
  maxAttempts?: number;
}

export interface PlanValidation {
  ok: boolean;
  errors: string[];
  steps: ValidatedStep[];
  /** Tools in the plan that will stop for a human decision. */
  approvalsNeeded: string[];
}

const VERIFY_OPERATORS = new Set(["not-empty", "contains", "not-contains", "equals"]);
const REFERENCE = /\{\{\s*steps\.([A-Za-z0-9_-]+)\.output\s*\}\}/g;

export function validatePlan(steps: PlanStepInput[], capabilities: Capability[] = listCapabilities()): PlanValidation {
  const errors: string[] = [];
  const out: ValidatedStep[] = [];
  const approvalsNeeded: string[] = [];

  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, errors: ["the plan has no steps"], steps: [], approvalsNeeded };
  }
  if (steps.length > MAX_STEPS) errors.push(`the plan has ${steps.length} steps; the limit is ${MAX_STEPS}`);

  const tools = new Map(capabilities.filter((c) => c.kind === "tool").map((c) => [c.id, c]));
  const agents = capabilities.filter((c) => c.kind === "agent");
  const seen = new Set<string>();

  steps.slice(0, MAX_STEPS).forEach((raw, index) => {
    const label = `step ${index + 1}`;
    const id = (typeof raw?.id === "string" && raw.id.trim()) || `s${index + 1}`;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) errors.push(`${label}: id "${id}" may only use letters, digits, _ and -`);
    if (seen.has(id)) errors.push(`${label}: duplicate id "${id}"`);
    const title = typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim() : `Step ${index + 1}`;

    const kinds = [raw?.tool, raw?.agent, raw?.prompt].filter((value) => typeof value === "string" && value.trim());
    if (kinds.length !== 1) {
      errors.push(`${label} ("${title}"): give exactly one of tool, agent or prompt`);
      seen.add(id);
      return;
    }

    let action: StepAction | undefined;
    if (raw.tool) {
      const tool = tools.get(raw.tool.trim());
      if (!tool) errors.push(`${label}: there is no tool "${raw.tool}"`);
      else if (!tool.executable) errors.push(`${label}: "${tool.id}" ${tool.blockedReason ?? "cannot be executed"}`);
      else if (!tool.available) errors.push(`${label}: "${tool.id}" is unavailable (${tool.blockedReason ?? "dependency missing"})`);
      else if (!tool.permitted && !tool.requiresApproval) errors.push(`${label}: "${tool.id}" is ${tool.blockedReason ?? "not permitted"}`);
      if (raw.args !== undefined && (typeof raw.args !== "object" || raw.args === null || Array.isArray(raw.args))) {
        errors.push(`${label}: args must be an object`);
      }
      if (tool?.requiresApproval) approvalsNeeded.push(tool.id);
      action = { kind: "tool", tool: raw.tool.trim(), args: (raw.args as Record<string, unknown>) ?? {} };
    } else if (raw.agent) {
      const wanted = raw.agent.replace(/^agent:/, "").trim().toLowerCase();
      const agent = agents.find((c) => c.id.slice("agent:".length).toLowerCase() === wanted || c.name.toLowerCase() === wanted);
      if (!agent) errors.push(`${label}: there is no runnable agent "${raw.agent}"`);
      if (!raw.instruction?.trim()) errors.push(`${label}: an agent step needs an instruction`);
      action = { kind: "agent", agent: agent?.name ?? raw.agent, instruction: raw.instruction ?? "" };
    } else {
      action = { kind: "reason", prompt: raw.prompt!.trim() };
    }

    const dependsOn = Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : undefined;
    for (const dep of dependsOn ?? []) {
      if (!seen.has(dep)) errors.push(`${label}: depends on "${dep}", which is not an earlier step`);
    }
    // A reference must point at a step guaranteed to have run first: the
    // transitive closure of this step's dependencies (default: the step
    // before it, which is also what the executor uses).
    const runsBefore = new Set<string>();
    const visit = (stepId: string): void => {
      if (runsBefore.has(stepId)) return;
      runsBefore.add(stepId);
      const at = out.findIndex((s) => s.id === stepId);
      if (at < 0) return;
      for (const dep of out[at].dependsOn ?? (at > 0 ? [out[at - 1].id] : [])) visit(dep);
    };
    for (const dep of dependsOn ?? (out.length ? [out[out.length - 1].id] : [])) visit(dep);
    for (const match of JSON.stringify(action).matchAll(REFERENCE)) {
      if (!runsBefore.has(match[1])) {
        errors.push(`${label}: references {{steps.${match[1]}.output}} but "${match[1]}" is not a step it depends on`);
      }
    }

    if (raw.verify && !VERIFY_OPERATORS.has(raw.verify.operator)) {
      errors.push(`${label}: verify.operator must be one of ${[...VERIFY_OPERATORS].join(", ")}`);
    }

    seen.add(id);
    out.push({
      id,
      title,
      description: action.kind === "tool" ? `Run ${action.tool}` : action.kind === "agent" ? `Delegate to ${action.agent}` : "Reason",
      action,
      ...(dependsOn ? { dependsOn } : {}),
      ...(raw.verify ? { verify: raw.verify } : {}),
      ...(raw.maxAttempts ? { maxAttempts: Math.min(Math.max(Math.floor(raw.maxAttempts), 1), 5) } : {}),
    });
  });

  return { ok: errors.length === 0, errors, steps: out, approvalsNeeded: [...new Set(approvalsNeeded)] };
}

/** Create a TaskEngine task from a validated plan. */
export function createTask(goal: string, validation: PlanValidation, origin: string): Task {
  if (!validation.ok) throw new Error(`refusing to create an invalid plan: ${validation.errors.join("; ")}`);
  return TaskEngine.getInstance().create({
    goal,
    description: `Planned (${origin}): ${validation.steps.length} step(s)`,
    steps: validation.steps,
    requiredTools: validation.steps.flatMap((step) => (step.action.kind === "tool" ? [step.action.tool] : [])),
    origin,
  });
}

/* ------------------------------ model planning ------------------------------ */

export type PlanGenerator = (prompt: string, system: string) => Promise<{ ok: boolean; text: string }>;

const SYSTEM = `You are LÉLU's task planner. Turn the request into a short executable plan.

Reply with ONLY a JSON object, no prose:
{"steps":[{"id":"s1","title":"...","tool":"<tool id>","args":{...}}, ...]}

Each step has exactly ONE of:
  "tool": a tool id from the capability list, with "args" matching its parameters
  "agent": a runnable agent's name, with "instruction"
  "prompt": a reasoning instruction for a model (summarise, compare, draft)

Optional per step: "dependsOn": ["<earlier id>"] (default: the previous step),
"verify": {"operator":"not-empty"|"contains"|"not-contains"|"equals","value":"..."}.
Pass an earlier step's output with the literal text {{steps.<id>.output}} inside args,
instruction or prompt — only from a step it depends on.

Rules: use only listed capabilities; at most ${MAX_STEPS} steps; prefer the fewest steps
that really accomplish the request; do not add steps that only restate the answer.
If the request cannot be done with the listed capabilities, reply {"steps":[],"reason":"..."}.`;

async function defaultGenerator(prompt: string, system: string): Promise<{ ok: boolean; text: string }> {
  const { default: AIService } = await import("../AIService");
  const response = await AIService.getInstance().reason(prompt, { system, maxTokens: 2500 });
  const ok = response.metadata?.success !== false && response.provider !== "offline" && response.text.trim().length > 0;
  return { ok, text: response.text };
}

/** Pull the plan object out of a reply, tolerating fences and stray prose. */
export function parsePlan(text: string): { steps: PlanStepInput[]; reason?: string } | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { steps?: unknown; reason?: unknown };
    if (!Array.isArray(parsed.steps)) return null;
    return {
      steps: parsed.steps as PlanStepInput[],
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch {
    return null;
  }
}

export interface PlanResult {
  ok: boolean;
  validation?: PlanValidation;
  /** Why no plan was produced (model unreachable, declined, invalid twice). */
  reason?: string;
  attempts: number;
}

export async function planTask(
  goal: string,
  options: { context?: string; generate?: PlanGenerator; capabilities?: Capability[] } = {},
): Promise<PlanResult> {
  const capabilities = options.capabilities ?? usableCapabilities();
  const generate = options.generate ?? defaultGenerator;

  let guidance = "";
  try {
    const { default: ObjectiveLearning } = await import("../cognition/ObjectiveLearning");
    guidance = ObjectiveLearning.getInstance().guidanceFor(goal);
  } catch {
    guidance = "";
  }

  const base = [
    "CAPABILITIES AVAILABLE NOW:",
    describeCapabilities(capabilities),
    "",
    "TOOL PARAMETERS (JSON Schema):",
    ...capabilities
      .filter((c) => c.kind === "tool" && c.parameters)
      .map((c) => `${c.id}: ${JSON.stringify(c.parameters)}`),
    guidance ? `\nLESSONS FROM EARLIER WORK:\n${guidance}` : "",
    options.context ? `\nCONTEXT:\n${options.context}` : "",
    "",
    `REQUEST: ${goal}`,
  ].join("\n");

  let prompt = base;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const reply = await generate(prompt, SYSTEM);
    if (!reply.ok) return { ok: false, reason: "no model was reachable to plan this", attempts: attempt };
    const parsed = parsePlan(reply.text);
    if (parsed && parsed.steps.length === 0) {
      return { ok: false, reason: parsed.reason ?? "the planner found no way to do this with current capabilities", attempts: attempt };
    }
    const validation: PlanValidation = parsed
      ? validatePlan(parsed.steps, capabilities)
      : { ok: false, errors: ["the reply was not a JSON plan"], steps: [], approvalsNeeded: [] };
    if (validation.ok) return { ok: true, validation, attempts: attempt };
    prompt = `${base}\n\nYOUR PREVIOUS PLAN WAS REJECTED:\n${validation.errors.map((e) => `- ${e}`).join("\n")}\nReturn a corrected plan.`;
    if (attempt === 2) return { ok: false, validation, reason: `invalid plan: ${validation.errors.join("; ")}`, attempts: attempt };
  }
  return { ok: false, reason: "planning did not converge", attempts: 2 };
}
