/**
 * ==========================================================
 * LÉLU — OPERATIONAL PLANNING ADAPTER
 *
 * Converts a snapshot into an ordered plan through the EXISTING
 * PlanningEngine. There is no second planner here: this module
 * decides WHAT the steps are and WHICH of them need a human,
 * then hands them to PlanningEngine, which keeps owning plans.
 *
 * The three separations the brief demands, enforced by shape:
 *
 *   planning      ≠ authorization  (a step can be "awaiting_approval")
 *   approval      ≠ execution      (this module never executes)
 *   execution     ≠ verification   (a step is "verified" only on evidence)
 * ==========================================================
 */

import PlanningEngine, { type Plan } from "../planning/PlanningEngine.ts";
import { explainCapability } from "./dependencies.ts";
import type { OperationalSnapshot } from "./types.ts";

export type OperationalPlanStatus =
  | "DRAFT"
  | "VALIDATING"
  | "BLOCKED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "VERIFIED";

export type OperationalStepStatus = "pending" | "blocked" | "awaiting_approval" | "completed" | "failed" | "verified";

export interface OperationalPlanStep {
  id: string;
  capabilityId: string | null;
  title: string;
  description: string;
  priority: number;
  status: OperationalStepStatus;
  dependsOn: string[];
  /** True when a human must approve before this step may run. */
  requiresApproval: boolean;
  /** The observed state that made this step necessary. */
  observedState: string;
  blocker: string | null;
}

export interface OperationalPlan {
  id: string;
  goal: string;
  createdAt: number;
  status: OperationalPlanStatus;
  snapshotId: string;
  /** The plan as PlanningEngine recorded it — same object, one authority. */
  planningEnginePlanId: string;
  steps: OperationalPlanStep[];
  blockers: Array<{ capabilityId: string; reason: string }>;
  approvalRequired: boolean;
  /** Explicitly not an execution record. */
  execution: { started: false; note: string };
  evidence: string[];
}

/** Words in a goal that name a capability LÉLU actually owns. */
const GOAL_TARGETS: Array<{ pattern: RegExp; capabilityIds: string[] }> = [
  { pattern: /openhands/i, capabilityIds: ["engineering.openhands.execute"] },
  { pattern: /opencode/i, capabilityIds: ["engineering.opencode.execute"] },
  { pattern: /local (engineering )?(runtime|engine|workspace)/i, capabilityIds: ["engineering.local.execute"] },
  { pattern: /speak|voice|voice out|synthes|talk/i, capabilityIds: ["voice.synthesis.speak"] },
  { pattern: /listen|transcri|recogni|hear/i, capabilityIds: ["voice.recognition.transcribe"] },
  { pattern: /code|engineering|modify your|change your|develop/i, capabilityIds: ["engineering.local.execute"] },
];

export function targetCapabilities(goal: string, snapshot: OperationalSnapshot): string[] {
  const matched = new Set<string>();
  for (const target of GOAL_TARGETS) {
    if (target.pattern.test(goal)) target.capabilityIds.forEach((id) => matched.add(id));
  }
  if (matched.size === 0) {
    // No named target: the plan is about whatever is actually blocked.
    for (const capability of snapshot.capabilities) {
      if (capability.state === "BLOCKED" || capability.state === "NOT_CONFIGURED") matched.add(capability.capabilityId);
    }
  }
  return [...matched];
}

export class OperationalPlanner {
  private readonly engine: PlanningEngine;

  constructor(engine: PlanningEngine = new PlanningEngine()) {
    this.engine = engine;
  }

  public plans(): Plan[] {
    return this.engine.all();
  }

  /**
   * Build an activation plan for one goal.
   *
   * Every step is derived from an observed blocker or a declared
   * requirement. If nothing is missing, the plan says so instead of
   * inventing busywork.
   */
  public createActivationPlan(goal: string, snapshot: OperationalSnapshot): OperationalPlan {
    const targets = targetCapabilities(goal, snapshot);
    const created = this.engine.create(goal);
    const steps: OperationalPlanStep[] = [];
    const blockers: Array<{ capabilityId: string; reason: string }> = [];

    for (const capabilityId of targets) {
      const explanation = explainCapability(snapshot, capabilityId);
      if (explanation.state === "AVAILABLE" || explanation.state === "VERIFIED") continue;

      if (explanation.state === "NOT_REPORTED") {
        blockers.push({ capabilityId, reason: "no studio reported this capability" });
        continue;
      }

      const unsatisfied = explanation.blockers.filter((blocker) => blocker.reason !== "satisfied");
      const capability = snapshot.capabilities.find((item) => item.capabilityId === capabilityId);

      // First: the capability's own state, when no declared requirement covers it.
      if (unsatisfied.length === 0 && capability) {
        steps.push({
          id: `step-${steps.length + 1}`,
          capabilityId,
          title: `Resolve ${capability.label} (${capability.state})`,
          description: capability.blockingReasons.join("; ") || "the capability reports a blocking state with no detail",
          priority: steps.length + 1,
          status: "blocked",
          dependsOn: [],
          requiresApproval: true,
          observedState: capability.state,
          blocker: capability.blockingReasons[0] ?? null,
        });
        continue;
      }

      for (const blocker of unsatisfied) {
        const prerequisite = snapshot.capabilities.find((item) => item.capabilityId === blocker.required);
        const needsConfiguration = prerequisite ? prerequisite.state === "NOT_CONFIGURED" : true;
        const step: OperationalPlanStep = {
          id: `step-${steps.length + 1}`,
          capabilityId: blocker.required,
          title: needsConfiguration
            ? `Configure ${blocker.required}`
            : `Restore ${blocker.required} (${blocker.state})`,
          description: blocker.reason,
          priority: steps.length + 1,
          // A configuration change is a WRITE/INSTALL action: it is
          // never something the planner may approve on its own.
          status: "awaiting_approval",
          dependsOn: steps.length > 0 ? [steps[steps.length - 1]!.id] : [],
          requiresApproval: true,
          observedState: blocker.state,
          blocker: blocker.reason,
        };
        steps.push(step);
        blockers.push({ capabilityId: blocker.required, reason: blocker.reason });
      }
    }

    // A plan whose target is already usable still gets one verification
    // step, so "nothing to do" is recorded rather than asserted.
    if (steps.length === 0) {
      steps.push({
        id: "step-1",
        capabilityId: targets[0] ?? null,
        title: "Verify the requested capability is genuinely usable",
        description:
          targets.length === 0
            ? "No capability was named and nothing is blocked; a verification pass is all this plan can honestly contain."
            : `${targets.join(", ")} reports AVAILABLE/VERIFIED; the next step is a real execution, not a plan.`,
        priority: 1,
        status: "pending",
        dependsOn: [],
        requiresApproval: false,
        observedState: targets.length === 0 ? "NOT_REPORTED" : "AVAILABLE",
        blocker: null,
      });
    }

    for (const step of steps) {
      this.engine.addStep(created.id, {
        id: step.id,
        title: step.title,
        description: step.description,
        priority: step.priority,
        dependencies: step.dependsOn,
      });
    }

    const approvalRequired = steps.some((step) => step.requiresApproval);
    const status: OperationalPlanStatus = approvalRequired ? "AWAITING_APPROVAL" : "DRAFT";

    return {
      id: `oplan-${created.id}`,
      goal,
      createdAt: created.createdAt,
      status,
      snapshotId: snapshot.snapshotId,
      planningEnginePlanId: created.id,
      steps,
      blockers,
      approvalRequired,
      execution: {
        started: false,
        note: "Planning is not authorization and this plan has not run. Every step above is a proposal; execution stays with AdapterRegistry and EngineeringOrchestrator.",
      },
      evidence: [
        `snapshot ${snapshot.snapshotId} at ${new Date(snapshot.timestamp).toISOString()}`,
        `${snapshot.collection.studiosRead}/${snapshot.collection.studiosRead + snapshot.collection.studiosFailed} studios read`,
        ...blockers.slice(0, 8).map((blocker) => `${blocker.capabilityId}: ${blocker.reason}`),
      ],
    };
  }
}
