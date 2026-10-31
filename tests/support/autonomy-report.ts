/**
 * ==========================================================
 * LÉLU — WHY DID THE AUTONOMOUS RUN END THERE?
 *
 * The live end-to-end test fails about half the time on this
 * container, and every failure printed the same sentence:
 * "only 1 action(s) were taken: workflow_list". That is a
 * symptom shared by at least four different faults, and the
 * message could not tell them apart:
 *
 *   A. the preferred provider refused the credential, a
 *      fallback served the turn, and the fallback model
 *      under-completed the objective
 *   B. the preferred provider served the turn and the model
 *      still under-completed it
 *   C. a tool was requested and its execution failed
 *   D. the runtime itself stopped the work
 *
 * A and B are facts about a model. C is a fact about a tool. D
 * is the only one that is a LÉLU cognition defect, and it is
 * the one the completion verifier exists to make impossible.
 * Reporting all four identically is how a real defect hides
 * among flaky runs.
 *
 * This collects the evidence while the run happens and prints
 * it as one compact report. It asserts nothing — the test's own
 * assertions are untouched, and this only explains them.
 *
 * It carries no credentials: provider NAMES and refusal
 * REASONS, never keys, and tool results are summarised to a
 * single line rather than dumped. Anything key-shaped is
 * redacted on the way out regardless.
 *
 * One honest gap: a tool's EXECUTOR is identified by its tool
 * id, because that is the identity the dispatcher records. It
 * is a one-to-one mapping, not a separate fact, and this does
 * not pretend otherwise.
 * ==========================================================
 */

import AgentEventBus from "../../src/core/agent/AgentEvents";
import AgentObjectives, { type CognitionCycleRecord } from "../../src/core/cognition/AgentObjectives";
import AIService from "../../src/core/AIService";
import {
  classifyProviderFailure,
  type ProviderFailureKind,
} from "../../src/core/AIProviderRegistry";

export type RunClassification =
  | "pass"
  | "provider-auth-failure"
  /** The provider never answered in time, so nothing downstream is the model's doing. */
  | "provider-timeout"
  /** Nothing left the machine: DNS, reset or unreachable host. */
  | "provider-network-failure"
  | "model-under-completed"
  | "tool-execution-failure"
  | "runtime-failure";

export interface ProviderHealth {
  name: string;
  /** The server refused the credential itself, as the registry judged it. */
  credentialRefused: boolean;
  /** Auth, timeout, network, server or unknown — see the registry. */
  kind: ProviderFailureKind;
  reason: string;
}

/** One tool call, as requested and as it really went. */
interface ToolEvent {
  tool: string;
  dispatched: boolean;
  ok?: boolean;
  summary: string;
}

/**
 * Belt and braces on secrets.
 *
 * Provider failure reasons are messages ("Groq failed 401: Invalid API
 * Key"), not credentials, and nothing here reads a key. This redacts
 * anything key-shaped anyway, because a report is printed to a log and
 * the cost of being wrong once is permanent.
 */
function redact(text: string): string {
  return text
    .replace(/\b(sk|pk|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}/gi, "[redacted]")
    // Unbroken runs only: a UUID is split by its dashes and survives,
    // which matters because objective and cycle ids are the thread a
    // reader follows through the trace.
    .replace(/\b[A-Za-z0-9_]{32,}\b/g, "[redacted]");
}

export class AutonomyReport {
  public readonly runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  private readonly tools: ToolEvent[] = [];
  private readonly stages: Array<{ stage: string; objectiveId?: string; detail: string }> = [];
  private unsubscribe: (() => void) | null = null;

  /** Begin collecting. Idempotent. */
  public start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
      if (event.type === "tool_result" && event.tool && event.tool !== "cognition.cycle") {
        this.tools.push({
          tool: event.tool,
          dispatched: true,
          ok: event.ok !== false,
          // A SUMMARY, never the payload: a tool result can be a whole
          // file, and a report nobody can read is a report nobody reads.
          summary: redact(String(event.result ?? "").replace(/\s+/g, " ")).slice(0, 120),
        });
      }
      if (event.type === "cognition") {
        this.stages.push({
          stage: event.stage,
          objectiveId: event.objectiveId,
          detail: String(event.detail ?? "").replace(/\s+/g, " ").slice(0, 160),
        });
      }
    });
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * What the provider chain did, from the registry's own failure
   * record rather than from log scraping.
   */
  public providerHealth(): ProviderHealth[] {
    const registry = AIService.getInstance().getAIProviderRegistry();
    const health: ProviderHealth[] = [];
    for (const name of registry.names()) {
      const failure = registry.failure(name);
      if (!failure) continue;
      health.push({
        name,
        credentialRefused: failure.authRejected === true,
        kind: failure.kind ?? classifyProviderFailure(failure.reason),
        reason: redact(failure.reason.replace(/\s+/g, " ")).slice(0, 120),
      });
    }
    return health;
  }

  /** The providers that actually served a decision for this objective. */
  public servingProviders(cycles: CognitionCycleRecord[]): string[] {
    return [...new Set(cycles.map((cycle) => cycle.provider).filter((name): name is string => Boolean(name)))];
  }

  /**
   * Which of the four faults this was.
   *
   * Deliberately ordered: a refused credential outranks everything
   * downstream of it, because every later symptom is its consequence.
   */
  public classify(
    objectiveId: string,
    expectedTools: string[],
  ): { classification: RunClassification; detail: string } {
    const cycles = AgentObjectives.getInstance().cycles(objectiveId);
    const objective = AgentObjectives.getInstance().get(objectiveId);
    const succeeded = new Set(
      cycles.flatMap((cycle) => cycle.executed.filter((entry) => entry.ok).map((entry) => entry.tool)),
    );
    const normalise = (name: string) => name.toLowerCase().replace(/[.]/g, "_");
    const missing = expectedTools.filter(
      (tool) => ![...succeeded].some((ran) => normalise(ran) === normalise(tool)),
    );

    if (missing.length === 0 && objective?.state === "completed") {
      return { classification: "pass", detail: "every required operation ran and completion was verified" };
    }

    const health = this.providerHealth();
    const served = this.servingProviders(cycles);

    // PROVIDER HEALTH, BUT ONLY WHEN IT ACTUALLY COST THIS RUN.
    //
    // Blaming any recorded provider failure for whatever happened
    // afterwards collapses the distinction this classifier exists to
    // make: on this container the two preferred providers answer 401
    // on EVERY run, so every failure came out as
    // provider-auth-failure. Caught by a real run — Fireworks served
    // the turn, workflow_list executed and returned "No workflows are
    // defined yet", and the model then declared BLOCKED claiming it
    // had not retrieved the list. Nothing about that was the
    // credential's fault.
    //
    // So health explains the run only when the run could not get a
    // usable answer: nothing served it, or the provider that served it
    // is itself the one that failed. Otherwise the failures are still
    // REPORTED in the providers section, just not blamed.
    const servedAndFailed = health.filter((entry) => served.includes(entry.name));
    if (served.length === 0 || servedAndFailed.length > 0) {
      const blame = servedAndFailed.length > 0 ? servedAndFailed : health;
      for (const [kind, classification, what] of [
        ["credential-refused", "provider-auth-failure", "refused the credential"],
        ["timeout", "provider-timeout", "timed out"],
        ["network", "provider-network-failure", "could not be reached"],
      ] as Array<[string, RunClassification, string]>) {
        const hit = blame.filter((entry) => entry.kind === kind);
        if (hit.length === 0) continue;
        return {
          classification,
          detail:
            `${hit.map((entry) => entry.name).join(", ")} ${what}, and ` +
            `${served.join(", ") || "nothing"} was left to serve the turn. ` +
            "This is provider health, not a cognition defect.",
        };
      }
    }

    const failedTool = cycles.flatMap((cycle) => cycle.executed.filter((entry) => !entry.ok));
    if (failedTool.length > 0 && missing.length > 0) {
      return {
        classification: "tool-execution-failure",
        detail: `${[...new Set(failedTool.map((entry) => entry.tool))].join(", ")} ran and failed.`,
      };
    }

    // THE ONE THAT WOULD BE A LÉLU DEFECT: the model stopped short AND
    // the runtime accepted it as complete anyway.
    if (missing.length > 0 && objective?.state === "completed") {
      return {
        classification: "runtime-failure",
        detail:
          `The objective is marked completed with ${missing.join(", ")} never executed. ` +
          "The completion verifier should have rejected this.",
      };
    }

    // Still reported, because a reader deserves to know the run was on
    // a fallback — just not blamed, because the fallback answered.
    const refusedElsewhere = health.filter((entry) => entry.kind === "credential-refused");
    return {
      classification: "model-under-completed",
      detail:
        `${served.join(", ") || "the model"} served the turn and stopped after ` +
        `${expectedTools.length - missing.length} of ${expectedTools.length} required operations ` +
        `(missing: ${missing.join(", ") || "none"}); the runtime did NOT accept it as complete.` +
        (refusedElsewhere.length > 0
          ? ` (${refusedElsewhere.map((entry) => entry.name).join(", ")} had refused their credentials, ` +
            "so this ran on a fallback; the fallback answered.)"
          : ""),
    };
  }

  /** The whole trace, as one printable block. */
  public render(objectiveId: string, expectedTools: string[]): string {
    const objectives = AgentObjectives.getInstance();
    const objective = objectives.get(objectiveId);
    const cycles = objectives.cycles(objectiveId).slice().reverse();
    const { classification, detail } = this.classify(objectiveId, expectedTools);

    const lines: string[] = [];
    lines.push("");
    lines.push("=================== AUTONOMY RUN REPORT ===================");
    lines.push(`runId        ${this.runId}`);
    lines.push(`objective    ${objectiveId}`);
    lines.push(`state        ${objective?.state ?? "(gone)"}${objective?.yieldReason ? ` (${objective.yieldReason})` : ""}`);
    lines.push(`actions      ${objective?.actionsTaken ?? 0}`);
    lines.push(`cycles       ${cycles.length}`);
    lines.push(`verdict      ${classification.toUpperCase()}`);
    lines.push(`             ${detail}`);

    lines.push("");
    lines.push("PROVIDERS");
    const health = this.providerHealth();
    if (health.length === 0) lines.push("  (no provider recorded a failure)");
    for (const entry of health) {
      const label =
        entry.kind === "credential-refused"
          ? "AUTH REFUSED "
          : entry.kind === "billing"
            ? "OUT OF CREDIT"
            : entry.kind === "model-not-found"
              ? "MODEL MISSING"
              : entry.kind === "bad-request"
                ? "BAD REQUEST  "
                : entry.kind === "timeout"
                  ? "timed out    "
                  : entry.kind === "network"
                    ? "unreachable  "
                    : entry.kind === "server"
                      ? "server error "
                      : "failed       ";
      lines.push(`  ${label}  ${entry.name}: ${entry.reason}`);
    }
    lines.push(`  served the decisions: ${this.servingProviders(cycles).join(", ") || "(none recorded)"}`);

    lines.push("");
    lines.push("EXPECTED");
    for (const tool of expectedTools) {
      const ran = cycles.some((cycle) =>
        cycle.executed.some(
          (entry) => entry.ok && entry.tool.toLowerCase().replace(/[.]/g, "_") === tool.toLowerCase().replace(/[.]/g, "_"),
        ),
      );
      lines.push(`  ${ran ? "✓" : "✗"} ${tool}`);
    }

    lines.push("");
    lines.push("CYCLES");
    for (const [index, cycle] of cycles.entries()) {
      lines.push(
        `  ${index + 1}. trigger=${cycle.trigger} provider=${cycle.provider ?? "?"} ` +
          `model=${cycle.model ?? "?"} finish=${cycle.finishReason ?? "?"} ` +
          `took=${Math.max(0, cycle.finishedAt - cycle.startedAt)}ms -> ${cycle.nextState}`,
      );
      lines.push(`     decision: ${cycle.decision.replace(/\s+/g, " ").slice(0, 140)}`);
      if (cycle.requested?.length) lines.push(`     requested: ${cycle.requested.join(", ")}`);
      lines.push(
        `     executed:  ${
          cycle.executed.length
            ? cycle.executed.map((entry) => `${entry.tool}${entry.ok ? "" : " FAILED"}`).join(", ")
            : "(nothing)"
        }`,
      );
      if (cycle.verification) {
        lines.push(`     verifier:  ${cycle.verification.verdict} — ${cycle.verification.reason}`);
        if (cycle.verification.missing.length) {
          lines.push(`                missing: ${cycle.verification.missing.join("; ")}`);
        }
      }
    }

    lines.push("");
    lines.push("TOOL DISPATCH");
    if (this.tools.length === 0) lines.push("  (nothing reached the dispatcher)");
    for (const entry of this.tools.slice(0, 40)) {
      lines.push(`  ${entry.ok ? "ok  " : "FAIL"} ${entry.tool} — ${entry.summary}`);
    }

    lines.push("");
    lines.push(
      `CONTINUATIONS SCHEDULED: ${
        this.stages.filter(
          (entry) => entry.stage === "continuation-scheduled" && (!entry.objectiveId || entry.objectiveId === objectiveId),
        ).length
      }`,
    );
    lines.push("  (how often the runtime armed its own next cycle for this objective)");

    lines.push("");
    lines.push("STAGES");
    lines.push(
      "  " +
        this.stages
          .filter((entry) => !entry.objectiveId || entry.objectiveId === objectiveId)
          .map((entry) => entry.stage)
          .join(" → ")
          .slice(0, 1200),
    );
    lines.push("===========================================================");
    lines.push("");
    return lines.join("\n");
  }

  /** The one-line result for the run matrix. */
  public summary(objectiveId: string, expectedTools: string[]): string {
    const objectives = AgentObjectives.getInstance();
    const cycles = objectives.cycles(objectiveId);
    const { classification } = this.classify(objectiveId, expectedTools);
    const succeeded = new Set(
      cycles.flatMap((cycle) => cycle.executed.filter((entry) => entry.ok).map((entry) => entry.tool)),
    );
    const normalise = (name: string) => name.toLowerCase().replace(/[.]/g, "_");
    const got = expectedTools.filter((tool) => [...succeeded].some((ran) => normalise(ran) === normalise(tool)));
    const verdicts = cycles.map((cycle) => cycle.verification?.verdict).filter(Boolean);

    return [
      classification === "pass" ? "PASS" : "FAIL",
      `provider: ${this.servingProviders(cycles).join("/") || "none"}`,
      `cycles: ${cycles.length}`,
      `actions: ${got.length}/${expectedTools.length}`,
      `completion: ${verdicts.length ? verdicts.join(",") : "never claimed"}`,
      `class: ${classification}`,
    ].join("  ");
  }
}
