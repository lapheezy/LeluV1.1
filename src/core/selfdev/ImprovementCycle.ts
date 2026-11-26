/**
 * ==========================================================
 * LÉLU — CONTINUOUS IMPROVEMENT CYCLE
 *
 * The seven stages the mission requires, each one routed to the
 * system that already owns it — no parallel queue, no second set
 * of records:
 *
 *   IDENTIFY   SelfDiagnostics + the capability/evidence gap scan
 *   COMPARE    ImprovementLifecycle vs journal, history, evidence
 *   PRIORITIZE ImprovementPrioritizer over what is still true
 *   EXECUTE    SelfDevelopmentLoop (only when explicitly asked)
 *   VERIFY     the run's own checks decide the lifecycle
 *   JOURNAL    DevelopmentJournal + EngineeringMemory
 *   REASSESS   reconcile again; name the next meaningful thing
 *
 * The cycle is safe to run repeatedly: COMPARE retires what is
 * already done and collapses duplicates, so a second run with no
 * new evidence changes nothing.
 * ==========================================================
 */

import SelfDiagnostics, { type DiagnosticReport } from "./SelfDiagnostics";
import SelfDevelopmentEngine from "./SelfDevelopmentEngine";
import SelfDevelopmentLoop from "./SelfDevelopmentLoop";
import SelfAwareness, { type NextImprovement } from "./SelfAwareness";
import ImprovementQueue from "./ImprovementQueue";
import DevelopmentJournal from "./DevelopmentJournal";
import EngineeringMemory from "./EngineeringMemory";
import { isActiveLifecycle } from "./ImprovementLifecycle";

export type ImprovementStage = "identify" | "compare" | "prioritize" | "execute" | "verify" | "journal" | "reassess";

export const STAGE_ORDER: ImprovementStage[] = [
  "identify",
  "compare",
  "prioritize",
  "execute",
  "verify",
  "journal",
  "reassess",
];

export interface StageOutcome {
  stage: ImprovementStage;
  at: number;
  detail: string;
}

export interface VerificationOutcome {
  id: string;
  title: string;
  state: "verified" | "pending" | "failed";
  detail: string;
}

export interface ImprovementCycleResult {
  at: number;
  stages: StageOutcome[];
  diagnostics: DiagnosticReport;
  created: string[];
  retired: string[];
  duplicates: string[];
  verified: string[];
  reopened: string[];
  executed: string[];
  verification: VerificationOutcome[];
  next: NextImprovement | null;
}

export default class SelfImprovementCycle {
  private static instance: SelfImprovementCycle | null = null;
  private lastResult: ImprovementCycleResult | null = null;

  private constructor() {}

  public static getInstance(): SelfImprovementCycle {
    if (!SelfImprovementCycle.instance) SelfImprovementCycle.instance = new SelfImprovementCycle();
    return SelfImprovementCycle.instance;
  }

  public getLastResult(): ImprovementCycleResult | null {
    return this.lastResult;
  }

  /**
   * Run the cycle once.
   *
   * `execute` is false by default: identifying, comparing and
   * prioritising are observations, while development is real work at the
   * autonomy gate. Only an explicit caller asks for it.
   */
  public async run(options: { execute?: boolean } = {}): Promise<ImprovementCycleResult> {
    const stages: StageOutcome[] = [];
    const mark = (stage: ImprovementStage, detail: string) => stages.push({ stage, at: Date.now(), detail });

    const awareness = SelfAwareness.getInstance();
    const queue = ImprovementQueue.getInstance();

    /* 1. IDENTIFY — real diagnostics, then the existing detector. */
    const diagnostics = await SelfDiagnostics.getInstance().run();
    const created = SelfDevelopmentEngine.getInstance().detectOpportunities(diagnostics);
    mark(
      "identify",
      `${diagnostics.summary.error} error(s), ${diagnostics.summary.warn} warning(s) from real runtime checks` +
        (created.length ? `; detected ${created.length} new limitation(s): ${created.join("; ")}` : "; nothing new detected"),
    );

    /* 2. COMPARE — against lifecycle, evidence, history and duplicates. */
    const before = awareness.assess();
    const reconciliation = awareness.reconcile();
    const afterCompare = awareness.assess();
    const unresolvedGaps = afterCompare.capabilities.filter((capability) => capability.truth === "unverified").length;
    mark(
      "compare",
      `${reconciliation.retired.length} retired, ${reconciliation.duplicates.length} duplicate(s) collapsed, ${reconciliation.reopened.length} reopened; ` +
        `${afterCompare.activeRecommendations.length} active (was ${before.activeRecommendations.length}); ${unresolvedGaps} capability(ies) still unverified.`,
    );

    /* 3. PRIORITIZE — only what still describes the system. */
    const next = awareness.assess().nextImprovement;
    mark("prioritize", next ? `Next: ${next.title} (${next.score}/100 ${next.level}).` : "Nothing actionable.");

    /* 4. EXECUTE — the existing development loop owns it, or nothing runs. */
    const executed: string[] = [];
    if (options.execute && next) {
      const loop = SelfDevelopmentLoop.getInstance();
      const proposal = queue.get(next.id);
      if (proposal && isActiveLifecycle(proposal.lifecycle)) {
        const started = loop.approve(proposal.id) || (await loop.develop(proposal.id).then(() => true));
        if (started) executed.push(proposal.id);
      }
      mark("execute", executed.length ? `Development started for ${executed.join(", ")}.` : "Nothing was started.");
    } else {
      mark("execute", "Observed only: execution needs an explicit request and the autonomy gate.");
    }

    /* 5. VERIFY — the runs' own checks, never an assumption. */
    const verification: VerificationOutcome[] = queue.list().map((proposal) => {
      const checks = proposal.lastExecution?.checks ?? [];
      const state: VerificationOutcome["state"] =
        proposal.lifecycle === "VerifiedComplete"
          ? "verified"
          : proposal.lastExecution?.outcome === "Failed" || checks.some((check) => check.ok === false)
            ? "failed"
            : "pending";
      return {
        id: proposal.id,
        title: proposal.title,
        state,
        detail: checks.length
          ? checks.map((check) => `${check.name}: ${check.ok === true ? "ok" : check.ok === false ? "failed" : "not run"}`).join(" · ")
          : "No check has run for this proposal.",
      };
    });
    const verifiedIds = verification.filter((item) => item.state === "verified").map((item) => item.id);
    mark("verify", verifiedIds.length ? `${verifiedIds.length} improvement(s) verified by their own checks.` : "No improvement carries passing checks yet.");

    /* 6. JOURNAL — the record, with its evidence. */
    if (created.length || reconciliation.changed) {
      DevelopmentJournal.getInstance().record({
        kind: "explicit",
        title: `Improvement cycle: ${created.length} identified, ${reconciliation.retired.length} retired, ${verifiedIds.length} verified`,
        detail: stages.map((stage) => `${stage.stage}: ${stage.detail}`).join(" · "),
        capabilities: [],
        evidence: diagnostics.findings.filter((finding) => finding.severity === "error").map((finding) => finding.evidence),
        verified: false,
      });
      EngineeringMemory.getInstance().record({
        kind: "lesson",
        topic: "improvement-cycle",
        summary: `Improvement cycle completed: ${created.length} identified, ${reconciliation.retired.length} retired, ${verifiedIds.length} verified.`,
        outcome: "neutral",
      });
    }
    mark("journal", created.length || reconciliation.changed ? "Cycle recorded in the development journal." : "Nothing new to record.");

    /* 7. REASSESS — the backlog after reconciliation, and the next thing. */
    const finalSnapshot = awareness.assess();
    mark(
      "reassess",
      `${finalSnapshot.activeRecommendations.length} active, ${finalSnapshot.outdatedRecommendations.length} retired for history.`,
    );

    const result: ImprovementCycleResult = {
      at: Date.now(),
      stages,
      diagnostics,
      created,
      retired: reconciliation.retired,
      duplicates: reconciliation.duplicates,
      verified: verifiedIds,
      reopened: reconciliation.reopened,
      executed,
      verification,
      next: finalSnapshot.nextImprovement,
    };
    this.lastResult = result;
    return result;
  }
}
