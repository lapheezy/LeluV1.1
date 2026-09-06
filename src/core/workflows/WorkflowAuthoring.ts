/**
 * ==========================================================
 * LÉLU
 * WORKFLOW AUTHORING — validated, never executable
 *
 * LÉLU can now write her own workflows. The dangerous version of
 * that feature is a model emitting something the runtime then
 * runs; this is deliberately the other thing.
 *
 * A workflow is DATA in a closed shape: a list of steps, each
 * naming a tool id that must already exist in the ToolRegistry,
 * with arguments that are literals or references to earlier
 * steps, and control flow expressed as conditions the engine
 * compares — never as an expression it evaluates. There is no
 * field anywhere in the schema that can hold code, and this
 * validator rejects any key it does not recognise, so a
 * generated definition cannot smuggle one in.
 *
 * Everything the validator can reject, it rejects BEFORE
 * persisting: an invalid draft is never stored, so a workflow
 * that exists is one that could be run. What it cannot decide —
 * whether a tool is available right now, whether the autonomy
 * level permits it — stays with the engine's preflight and the
 * dispatcher, which re-check at execution time.
 *
 * No new storage: a valid workflow is persisted through the
 * existing WorkflowStore, and is therefore discoverable to every
 * agent, objective and cognition cycle by the routes that
 * already existed.
 * ==========================================================
 */

import ToolRegistry from "../tools/ToolRegistry";
import { registryIdForToolName } from "../tools/ToolDispatcher";
import WorkflowStore, {
  type ConditionOperator,
  type FailureAction,
  type StepCondition,
  type WorkflowDefinition,
  type WorkflowInput,
  type WorkflowStep,
} from "./WorkflowStore";
import WorkflowEngine, {
  MAX_ATTEMPTS,
  MAX_ITERATIONS,
  orderSteps,
} from "./WorkflowEngine";

/* ---------------------------- limits ---------------------------- */

export const MAX_STEPS = 20;
export const MAX_INPUTS = 10;
export const MAX_NAME_LENGTH = 80;
/** Serialized size of one step's arguments. */
export const MAX_ARGUMENTS_CHARS = 8_000;
/** How deeply an argument value may nest. */
const MAX_ARGUMENT_DEPTH = 3;

const STEP_ID = /^[A-Za-z0-9_-]{1,40}$/;
const INPUT_NAME = /^[A-Za-z0-9_-]{1,40}$/;

const OPERATORS: ConditionOperator[] = [
  "succeeded",
  "failed",
  "contains",
  "not-contains",
  "equals",
  "empty",
  "not-empty",
];
const NEEDS_VALUE: ConditionOperator[] = ["contains", "not-contains", "equals"];
const FAILURE_ACTIONS: FailureAction[] = ["fail", "continue", "stop", "escalate"];

/** Every key a step may carry. Anything else is rejected outright. */
const STEP_KEYS = new Set([
  "id",
  "name",
  "tool",
  "arguments",
  "dependsOn",
  "after",
  "optional",
  "condition",
  "retry",
  "loop",
  "onFailure",
  "terminateWhen",
]);
const CONDITION_KEYS = new Set(["step", "operator", "value"]);
const RETRY_KEYS = new Set(["maxAttempts", "when"]);
const LOOP_KEYS = new Set(["until", "maxIterations"]);
const FAILURE_KEYS = new Set(["action", "escalate"]);
const INPUT_KEYS = new Set(["name", "description", "required"]);

/* ---------------------------- types ---------------------------- */

/** The shape a caller proposes. Deliberately unknown-typed: it comes from a model. */
export type WorkflowDraft = Record<string, unknown>;

export interface ValidationResult {
  ok: boolean;
  /** Why it cannot be stored. Empty when ok. */
  errors: string[];
  /** True but not disqualifying — e.g. a tool that is currently unavailable. */
  warnings: string[];
  /** Present only when ok: the cleaned definition, with nothing extra. */
  normalized?: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt"> & { id?: string };
}

export interface AuthorResult extends ValidationResult {
  /** The persisted definition. Absent when validation failed. */
  workflow?: WorkflowDefinition;
  /** Live preflight of the stored workflow, so the caller learns what blocks it. */
  preflight?: ReturnType<WorkflowEngine["preflight"]>;
}

/* ---------------------------- helpers ---------------------------- */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Reject any argument value that is not plain, bounded JSON data. */
function checkArgumentValue(value: unknown, path: string, depth: number, errors: string[]): void {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (depth >= MAX_ARGUMENT_DEPTH) {
    errors.push(`${path}: nested more than ${MAX_ARGUMENT_DEPTH} levels deep.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkArgumentValue(entry, `${path}[${index}]`, depth + 1, errors));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      checkArgumentValue(entry, `${path}.${key}`, depth + 1, errors);
    }
    return;
  }
  // Functions, symbols and class instances have no place in a stored
  // definition — this is the line between data and code.
  errors.push(`${path}: only strings, numbers, booleans, null, arrays and plain objects are allowed.`);
}

/** Every step id this step can legitimately read, following dependsOn. */
function ancestorsOf(
  stepId: string,
  dependencies: Map<string, string[]>,
  seen = new Set<string>(),
): Set<string> {
  for (const parent of dependencies.get(stepId) ?? []) {
    if (seen.has(parent)) continue;
    seen.add(parent);
    ancestorsOf(parent, dependencies, seen);
  }
  return seen;
}

function collectReferences(value: unknown, steps: string[], inputs: string[]): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*steps\.([A-Za-z0-9_-]+)\.output\s*\}\}/g)) {
      steps.push(match[1]);
    }
    for (const match of value.matchAll(/\{\{\s*input\.([A-Za-z0-9_-]+)\s*\}\}/g)) {
      inputs.push(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, steps, inputs);
    return;
  }
  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) collectReferences(entry, steps, inputs);
  }
}

/** Validate one condition, in the context of what the step may read. */
function validateCondition(
  raw: unknown,
  label: string,
  stepIds: Set<string>,
  readable: Set<string>,
  errors: string[],
  allowSelfDefault: string | null,
): StepCondition | undefined {
  if (!isPlainObject(raw)) {
    errors.push(`${label}: must be an object with "step" and "operator".`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!CONDITION_KEYS.has(key)) errors.push(`${label}: unknown property "${key}".`);
  }
  const operator = text(raw.operator) as ConditionOperator;
  if (!OPERATORS.includes(operator)) {
    errors.push(`${label}: operator must be one of ${OPERATORS.join(", ")}.`);
  }
  const step = text(raw.step) || (allowSelfDefault ?? "");
  if (!step) {
    errors.push(`${label}: "step" is required.`);
  } else if (!stepIds.has(step)) {
    errors.push(`${label}: references step "${step}", which does not exist.`);
  } else if (step !== allowSelfDefault && !readable.has(step)) {
    // A condition over a step that may not have run yet is not a branch,
    // it is a coin flip: evaluateCondition would report "has not run".
    errors.push(
      `${label}: references step "${step}", which is not among this step's dependencies, ` +
        `so its result may not exist when the condition is evaluated.`,
    );
  }
  const value = text(raw.value);
  if (NEEDS_VALUE.includes(operator) && !value) {
    errors.push(`${label}: operator "${operator}" needs a non-empty "value" to compare against.`);
  }
  if (errors.length > 0) return undefined;
  return value ? { step, operator, value } : { step, operator };
}

/* ---------------------------- validation ---------------------------- */

/**
 * Check a proposed workflow completely, without storing anything.
 *
 * Every failure is reported at once, in the caller's own terms, so a
 * model revising a draft can fix all of it in one pass instead of
 * rediscovering one problem per attempt.
 */
export function validateWorkflow(draft: WorkflowDraft): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(draft)) {
    return { ok: false, errors: ["The workflow must be an object."], warnings };
  }

  const name = text(draft.name);
  if (!name) errors.push("name: required.");
  if (name.length > MAX_NAME_LENGTH) errors.push(`name: longer than ${MAX_NAME_LENGTH} characters.`);

  const description = text(draft.description);
  if (description.length < 10) {
    errors.push("description: required, and long enough to say what the workflow is for.");
  }

  const outputs = text(draft.outputs);
  if (!outputs) {
    errors.push("outputs: required — say what a successful run produces, or nobody can choose this workflow.");
  }

  /* ---- inputs ---- */
  const inputs: WorkflowInput[] = [];
  const rawInputs = draft.inputs;
  if (rawInputs !== undefined) {
    if (!Array.isArray(rawInputs)) {
      errors.push("inputs: must be an array.");
    } else if (rawInputs.length > MAX_INPUTS) {
      errors.push(`inputs: more than ${MAX_INPUTS}.`);
    } else {
      for (const [index, raw] of rawInputs.entries()) {
        if (!isPlainObject(raw)) {
          errors.push(`inputs[${index}]: must be an object.`);
          continue;
        }
        for (const key of Object.keys(raw)) {
          if (!INPUT_KEYS.has(key)) errors.push(`inputs[${index}]: unknown property "${key}".`);
        }
        const inputName = text(raw.name);
        if (!INPUT_NAME.test(inputName)) {
          errors.push(`inputs[${index}]: name must match ${INPUT_NAME}.`);
          continue;
        }
        if (inputs.some((existing) => existing.name === inputName)) {
          errors.push(`inputs[${index}]: duplicate input name "${inputName}".`);
          continue;
        }
        const inputDescription = text(raw.description);
        if (!inputDescription) {
          errors.push(`inputs[${index}] (${inputName}): description is required.`);
        }
        inputs.push({
          name: inputName,
          description: inputDescription,
          required: raw.required !== false,
        });
      }
    }
  }

  /* ---- steps ---- */
  const rawSteps = draft.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    errors.push("steps: at least one step is required.");
    return { ok: false, errors, warnings };
  }
  if (rawSteps.length > MAX_STEPS) {
    errors.push(`steps: more than ${MAX_STEPS}.`);
    return { ok: false, errors, warnings };
  }

  const registry = ToolRegistry.getInstance();
  const stepIds = new Set<string>();
  const dependencies = new Map<string, string[]>();
  /** dependsOn + after: everything guaranteed to have run before a step. */
  const ordering = new Map<string, string[]>();

  // First pass: identity, so later passes can resolve references.
  for (const [index, raw] of rawSteps.entries()) {
    if (!isPlainObject(raw)) {
      errors.push(`steps[${index}]: must be an object.`);
      continue;
    }
    const id = text(raw.id);
    if (!STEP_ID.test(id)) {
      errors.push(`steps[${index}]: id must match ${STEP_ID}.`);
      continue;
    }
    if (stepIds.has(id)) {
      errors.push(`steps[${index}]: duplicate step id "${id}".`);
      continue;
    }
    stepIds.add(id);
    const dependsOn = Array.isArray(raw.dependsOn) ? raw.dependsOn.map(text).filter(Boolean) : [];
    const afterIds = Array.isArray(raw.after) ? raw.after.map(text).filter(Boolean) : [];
    dependencies.set(id, dependsOn);
    // Ordering edges decide what a step may READ, alongside dependencies.
    ordering.set(id, [...dependsOn, ...afterIds]);
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const steps: WorkflowStep[] = [];

  for (const [index, raw] of rawSteps.entries()) {
    const step = raw as Record<string, unknown>;
    const id = text(step.id);
    const label = `steps[${index}] (${id})`;

    for (const key of Object.keys(step)) {
      if (!STEP_KEYS.has(key)) {
        errors.push(`${label}: unknown property "${key}". A workflow step carries no code.`);
      }
    }

    const stepName = text(step.name) || id;
    const declared = text(step.tool);
    // A MODEL SEES TOOLS AS "project_manage" AND THE REGISTRY CALLS THEM
    // "project.manage". Both forms mean the same tool, so both are
    // accepted and normalised — a model that used the only name it was
    // ever shown should not be told its tool does not exist.
    const tool = declared && !registry.get(declared) ? registryIdForToolName(declared) : declared;
    const definition = tool ? registry.get(tool) : undefined;
    if (!declared) {
      errors.push(`${label}: "tool" is required.`);
    } else if (!definition) {
      // THE CENTRAL SAFETY PROPERTY: a step can only ever name a tool
      // that already exists. There is no path from an authored
      // workflow to new behaviour. The error names real alternatives so
      // a caller can correct itself instead of guessing.
      const available = registry
        .all()
        .filter((entry) => entry.available)
        .map((entry) => entry.id);
      const near = available.filter((id) => {
        const head = declared.split(/[._]/)[0]?.toLowerCase() ?? "";
        return head.length > 2 && id.toLowerCase().startsWith(head);
      });
      errors.push(
        `${label}: no tool "${declared}" is registered. A step can only call an existing tool. ` +
          (near.length > 0
            ? `Did you mean: ${near.join(", ")}?`
            : `Available tools: ${available.slice(0, 25).join(", ")}`),
      );
    } else if (!definition.available) {
      warnings.push(
        `${label}: "${definition.name}" is not available in this runtime right now` +
          `${definition.dependency ? ` (needs ${definition.dependency})` : ""}; the workflow will be stored but blocked until it is.`,
      );
    } else if ((definition.riskLevel ?? 0) >= 3) {
      warnings.push(
        `${label}: "${definition.name}" is a high-risk action; every run stays subject to the ` +
          `autonomy gate and any authorization it requires.`,
      );
    }

    const dependsOn = dependencies.get(id) ?? [];
    for (const parent of dependsOn) {
      if (parent === id) errors.push(`${label}: depends on itself.`);
      else if (!stepIds.has(parent)) errors.push(`${label}: depends on "${parent}", which does not exist.`);
    }
    const after = (ordering.get(id) ?? []).filter((parent) => !dependsOn.includes(parent));
    for (const parent of after) {
      if (parent === id) errors.push(`${label}: is ordered after itself.`);
      else if (!stepIds.has(parent)) {
        errors.push(`${label}: is ordered after "${parent}", which does not exist.`);
      }
    }

    const args = step.arguments;
    if (args !== undefined && !isPlainObject(args)) {
      errors.push(`${label}: "arguments" must be an object.`);
    }
    const argumentsObject: Record<string, unknown> = isPlainObject(args) ? args : {};
    for (const [key, value] of Object.entries(argumentsObject)) {
      checkArgumentValue(value, `${label}.arguments.${key}`, 0, errors);
    }
    let serialized = "";
    try {
      serialized = JSON.stringify(argumentsObject) ?? "";
    } catch {
      errors.push(`${label}: "arguments" could not be serialized.`);
    }
    if (serialized.length > MAX_ARGUMENTS_CHARS) {
      errors.push(`${label}: arguments are larger than ${MAX_ARGUMENTS_CHARS} characters.`);
    }

    // References must resolve at RUN time, not just look plausible.
    // What this step may READ: everything ordered before it, whether by
    // dependency (which must succeed) or by ordering (which must merely
    // have run). A failure branch reads a step it deliberately does not
    // depend on, and that is exactly what makes it a failure branch.
    const readable = ancestorsOf(id, ordering);
    // What this step may take a VALUE from: only steps that must have
    // succeeded, because a failed step has no output to substitute.
    const valueSources = ancestorsOf(id, dependencies);
    const referencedSteps: string[] = [];
    const referencedInputs: string[] = [];
    collectReferences(argumentsObject, referencedSteps, referencedInputs);
    for (const reference of new Set(referencedSteps)) {
      if (reference === id) {
        if (!isPlainObject(step.loop)) {
          errors.push(
            `${label}: references its own output, which only exists for a looping step.`,
          );
        }
        continue;
      }
      if (!stepIds.has(reference)) {
        errors.push(`${label}: references step "${reference}", which does not exist.`);
      } else if (!valueSources.has(reference)) {
        errors.push(
          `${label}: references step "${reference}" without depending on it, so that output ` +
            `may not exist yet. Add it to dependsOn.`,
        );
      }
    }
    for (const reference of new Set(referencedInputs)) {
      if (!inputs.some((input) => input.name === reference)) {
        errors.push(`${label}: references input "${reference}", which the workflow does not declare.`);
      }
    }

    /* ---- control flow ---- */
    let condition: StepCondition | undefined;
    if (step.condition !== undefined) {
      condition = validateCondition(step.condition, `${label}.condition`, stepIds, readable, errors, null);
    }

    let retry: WorkflowStep["retry"];
    if (step.retry !== undefined) {
      if (!isPlainObject(step.retry)) {
        errors.push(`${label}.retry: must be an object.`);
      } else {
        for (const key of Object.keys(step.retry)) {
          if (!RETRY_KEYS.has(key)) errors.push(`${label}.retry: unknown property "${key}".`);
        }
        const attempts = Number(step.retry.maxAttempts);
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
          errors.push(`${label}.retry: maxAttempts must be a whole number from 1 to ${MAX_ATTEMPTS}.`);
        } else {
          retry = { maxAttempts: attempts };
          const when = text(step.retry.when);
          if (when) retry.when = when;
        }
      }
    }

    let loop: WorkflowStep["loop"];
    if (step.loop !== undefined) {
      if (!isPlainObject(step.loop)) {
        errors.push(`${label}.loop: must be an object.`);
      } else {
        for (const key of Object.keys(step.loop)) {
          if (!LOOP_KEYS.has(key)) errors.push(`${label}.loop: unknown property "${key}".`);
        }
        const iterations = Number(step.loop.maxIterations);
        if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
          errors.push(
            `${label}.loop: maxIterations must be a whole number from 1 to ${MAX_ITERATIONS}. ` +
              `A loop must be bounded.`,
          );
        }
        const until = validateCondition(
          step.loop.until,
          `${label}.loop.until`,
          stepIds,
          readable,
          errors,
          id,
        );
        if (until && Number.isInteger(iterations)) {
          loop = { until, maxIterations: Math.min(Math.max(iterations, 1), MAX_ITERATIONS) };
        }
      }
    }

    let onFailure: WorkflowStep["onFailure"];
    if (step.onFailure !== undefined) {
      if (!isPlainObject(step.onFailure)) {
        errors.push(`${label}.onFailure: must be an object.`);
      } else {
        for (const key of Object.keys(step.onFailure)) {
          if (!FAILURE_KEYS.has(key)) errors.push(`${label}.onFailure: unknown property "${key}".`);
        }
        const action = text(step.onFailure.action) as FailureAction;
        if (!FAILURE_ACTIONS.includes(action)) {
          errors.push(`${label}.onFailure: action must be one of ${FAILURE_ACTIONS.join(", ")}.`);
        } else {
          const escalate = text(step.onFailure.escalate);
          if (action === "escalate" && !escalate) {
            errors.push(
              `${label}.onFailure: "escalate" must say exactly what a person is being asked to decide.`,
            );
          } else {
            onFailure = escalate ? { action, escalate } : { action };
          }
        }
      }
    }

    let terminateWhen: StepCondition | undefined;
    if (step.terminateWhen !== undefined) {
      terminateWhen = validateCondition(
        step.terminateWhen,
        `${label}.terminateWhen`,
        stepIds,
        readable,
        errors,
        id,
      );
    }

    steps.push({
      id,
      name: stepName,
      tool,
      arguments: argumentsObject,
      dependsOn,
      ...(after.length > 0 ? { after } : {}),
      ...(step.optional === true ? { optional: true } : {}),
      ...(condition ? { condition } : {}),
      ...(retry ? { retry } : {}),
      ...(loop ? { loop } : {}),
      ...(onFailure ? { onFailure } : {}),
      ...(terminateWhen ? { terminateWhen } : {}),
    });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  // A dependency cycle can never become ready. Caught here rather than
  // discovered as a run where every step is blocked.
  const draftDefinition: WorkflowDefinition = {
    id: "draft",
    name,
    description,
    inputs,
    outputs,
    steps,
    createdAt: 0,
    updatedAt: 0,
  };
  const { unresolvable } = orderSteps(draftDefinition);
  if (unresolvable.length > 0) {
    errors.push(
      `steps: ${unresolvable.join(", ")} form a cycle in their ordering, so they could never run.`,
    );
    return { ok: false, errors, warnings };
  }

  const id = text(draft.id);
  return {
    ok: true,
    errors,
    warnings,
    normalized: {
      name,
      description,
      inputs,
      outputs,
      steps,
      ...(id ? { id } : {}),
      ...(text(draft.projectId) ? { projectId: text(draft.projectId) } : {}),
    },
  };
}

/**
 * Validate and, only if it is entirely valid, persist.
 *
 * Storing goes through the existing WorkflowStore, so a workflow LÉLU
 * writes is immediately discoverable by every route that already finds
 * workflows: AgentWorkflowBridge.discover, the workflow_list and
 * workflow_run tools, and the cognitive context.
 */
export function authorWorkflow(draft: WorkflowDraft): AuthorResult {
  const validation = validateWorkflow(draft);
  if (!validation.ok || !validation.normalized) return validation;

  const store = WorkflowStore.getInstance();
  const normalized = validation.normalized;

  // Never silently replace someone else's workflow: replacing is
  // allowed, but only when the caller names the id it means to replace.
  const clash = store
    .list()
    .find(
      (existing) =>
        existing.name.toLowerCase() === normalized.name.toLowerCase() &&
        existing.id !== normalized.id,
    );
  if (clash) {
    return {
      ok: false,
      errors: [
        `A workflow named "${clash.name}" already exists (id ${clash.id}). ` +
          `Choose a different name, or pass id: "${clash.id}" to replace it deliberately.`,
      ],
      warnings: validation.warnings,
    };
  }
  if (normalized.id && !store.get(normalized.id)) {
    return {
      ok: false,
      errors: [`No workflow with id ${normalized.id} exists to replace.`],
      warnings: validation.warnings,
    };
  }

  const workflow = store.define(normalized);
  return {
    ...validation,
    workflow,
    preflight: WorkflowEngine.getInstance().preflight(workflow),
  };
}
