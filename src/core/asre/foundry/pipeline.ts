/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — THE FEEDBACK LOOP
 *
 * Part VII names twelve steps. This is that loop as a state machine with an
 * injected adapter per step, so the CLI, the API and the test all run the same
 * sequence and every step records what it actually did.
 *
 * The honesty rule is enforced here, not in prose: `assessRun` refuses to call a
 * run validated unless the render AND the comparison ran and produced a verdict.
 * A correction with no re-render is a correction nobody has seen, and it says so.
 * ==========================================================
 */

export const FOUNDRY_STEPS = [
  { id: "receive", title: "Receive the reference", required: true },
  { id: "analyse", title: "Analyse the reference", required: true },
  { id: "measure", title: "Extract measurements", required: true },
  { id: "build", title: "Build initial geometry", required: true },
  { id: "materials", title: "Generate materials", required: false },
  { id: "hair", title: "Construct hair and accessories", required: false },
  { id: "render", title: "Render", required: true },
  { id: "compare", title: "Compare against the original", required: true },
  { id: "diagnose", title: "Identify discrepancies", required: true },
  { id: "correct", title: "Correct geometry and materials", required: false },
  { id: "re-render", title: "Render again", required: false },
  { id: "preserve", title: "Preserve the validated version", required: false },
] as const;

export type FoundryStepId = (typeof FOUNDRY_STEPS)[number]["id"];

export type StepState = "ran" | "skipped" | "failed";

export interface StepOutcome {
  evidence: string;
  data?: unknown;
}

export type StepAdapter = (run: FoundryRun) => Promise<StepOutcome | null> | StepOutcome | null;

export interface FoundryContext {
  subject: string;
  projectId: string;
  versionId?: string;
  /** Anything a step needs: reference paths, metrics, shot ids, a GLB path. */
  inputs: Record<string, unknown>;
}

export interface StepRecord {
  id: FoundryStepId;
  title: string;
  state: StepState;
  evidence: string;
  ms: number;
  data?: unknown;
}

export interface FoundryRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  context: FoundryContext;
  steps: StepRecord[];
  /** The last comparison verdict, copied up so assessment never has to dig. */
  verdict: string | null;
  error: string | null;
}

const catalog = new Map(FOUNDRY_STEPS.map((s) => [s.id, s]));

export function newRun(context: FoundryContext): FoundryRun {
  return {
    id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    context,
    steps: [],
    verdict: null,
    error: null,
  };
}

export interface RunOptions {
  /** Stop at the first failure instead of continuing with what can still run. */
  stopOnFailure?: boolean;
  /** Only these steps (dependencies are not implied — the caller asked). */
  only?: FoundryStepId[];
  now?: () => number;
}

/**
 * Run the loop. A step with no adapter is `skipped` with that reason; a step
 * that throws is `failed` with the real error, never hidden.
 */
export async function runFoundryPipeline(context: FoundryContext, adapters: Partial<Record<FoundryStepId, StepAdapter>>, options: RunOptions = {}): Promise<FoundryRun> {
  const run = newRun(context);
  const now = options.now ?? (() => Date.now());
  for (const step of FOUNDRY_STEPS) {
    if (options.only && !options.only.includes(step.id)) continue;
    const adapter = adapters[step.id];
    const started = now();
    if (!adapter) {
      run.steps.push({ id: step.id, title: step.title, state: "skipped", evidence: `no adapter registered for ${step.id}`, ms: 0 });
      continue;
    }
    try {
      const outcome = await adapter(run);
      if (!outcome) {
        run.steps.push({ id: step.id, title: step.title, state: "skipped", evidence: "adapter reported nothing to do", ms: now() - started });
        continue;
      }
      run.steps.push({ id: step.id, title: step.title, state: "ran", evidence: outcome.evidence, ms: now() - started, data: outcome.data });
      if (step.id === "compare") {
        const verdict = (outcome.data as { verdict?: string } | undefined)?.verdict;
        if (verdict) run.verdict = verdict;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.steps.push({ id: step.id, title: step.title, state: "failed", evidence: message, ms: now() - started });
      run.error = `${step.id}: ${message}`;
      if (options.stopOnFailure) break;
    }
  }
  run.finishedAt = new Date().toISOString();
  return run;
}

export interface RunAssessment {
  validated: boolean;
  reasons: string[];
  correctionsUnseen: boolean;
}

/**
 * The acceptance gate for a run. This is the code that stops the report from
 * claiming success it did not measure.
 */
export function assessRun(run: FoundryRun): RunAssessment {
  const state = (id: FoundryStepId) => run.steps.find((s) => s.id === id)?.state ?? "skipped";
  const reasons: string[] = [];
  const render = state("render");
  const compare = state("compare");
  const diagnose = state("diagnose");
  const correct = state("correct");
  const reRender = state("re-render");
  const preserve = state("preserve");

  if (render !== "ran") reasons.push(`no render ran (render: ${render})`);
  if (compare !== "ran") reasons.push(`no comparison ran (compare: ${compare})`);
  if (!run.verdict) reasons.push("the comparison produced no verdict");
  if (diagnose !== "ran") reasons.push("discrepancies were not identified");
  if (run.error) reasons.push(`a step failed: ${run.error}`);

  const correctionsUnseen = correct === "ran" && reRender !== "ran";
  if (correctionsUnseen) reasons.push("corrections were applied but never re-rendered — nobody has seen the result");
  if (preserve !== "ran") reasons.push("the version was not preserved in the project store");

  return { validated: reasons.length === 0, reasons, correctionsUnseen };
}

/** Human-readable summary: what ran, what did not, and what it means. */
export function describeRun(run: FoundryRun): string {
  const ran = run.steps.filter((s) => s.state === "ran").length;
  const skipped = run.steps.filter((s) => s.state === "skipped").length;
  const failed = run.steps.filter((s) => s.state === "failed");
  const assessment = assessRun(run);
  const head = `${run.id}: ${ran} step(s) ran, ${skipped} skipped${failed.length ? `, ${failed.length} FAILED (${failed.map((f) => f.id).join(", ")})` : ""}. Verdict: ${run.verdict ?? "none"}.`;
  return `${head} ${assessment.validated ? "Validated against the comparison." : `NOT validated — ${assessment.reasons.join("; ")}.`}`;
}

export function stepById(id: FoundryStepId): { id: FoundryStepId; title: string; required: boolean } {
  const step = catalog.get(id);
  if (!step) throw new Error(`unknown Foundry step "${id}"`);
  return step as { id: FoundryStepId; title: string; required: boolean };
}
