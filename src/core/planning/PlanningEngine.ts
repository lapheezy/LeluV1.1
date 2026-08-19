/**
 * ==========================================================
 * LÉLU
 * PLANNING ENGINE
 * ==========================================================
 */

export type PlanStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface PlanStep {

  id:
    string;

  title:
    string;

  description:
    string;

  priority:
    number;

  status:
    PlanStatus;

  dependencies:
    string[];

}

export interface Plan {

  id:
    string;

  goal:
    string;

  createdAt:
    number;

  updatedAt:
    number;

  status:
    PlanStatus;

  steps:
    PlanStep[];

}

export default class PlanningEngine {

  private readonly plans =
    new Map<
      string,
      Plan
    >();

  public create(
    goal: string,
  ): Plan {

    const now =
      Date.now();

    const plan: Plan = {

      id:
        `plan-${now}`,

      goal,

      createdAt:
        now,

      updatedAt:
        now,

      status:
        "pending",

      steps:
        [],

    };

    this.plans.set(
      plan.id,
      plan,
    );

    return plan;

  }

  public addStep(

    planId:
      string,

    step:
      Omit<
        PlanStep,
        "status"
      >,

  ): void {

    const plan =
      this.plans.get(
        planId,
      );

    if (!plan) {

      return;

    }

    plan.steps.push({

      ...step,

      status:
        "pending",

    });

    plan.updatedAt =
      Date.now();

  }

  public start(
    planId: string,
  ): void {

    const plan =
      this.plans.get(
        planId,
      );

    if (!plan) {

      return;

    }

    plan.status =
      "running";

    plan.updatedAt =
      Date.now();

  }

  public completeStep(

    planId:
      string,

    stepId:
      string,

  ): void {

    const plan =
      this.plans.get(
        planId,
      );

    if (!plan) {

      return;

    }

    const step =

      plan.steps.find(

        value =>

          value.id ===
          stepId,

      );

    if (!step) {

      return;

    }

    step.status =
      "completed";

    if (

      plan.steps.every(

        value =>

          value.status ===
          "completed",

      )

    ) {

      plan.status =
        "completed";

    }

    plan.updatedAt =
      Date.now();

  }

  public failStep(

    planId:
      string,

    stepId:
      string,

  ): void {

    const plan =
      this.plans.get(
        planId,
      );

    if (!plan) {

      return;

    }

    const step =

      plan.steps.find(

        value =>

          value.id ===
          stepId,

      );

    if (!step) {

      return;

    }

    step.status =
      "failed";

    plan.status =
      "failed";

    plan.updatedAt =
      Date.now();

  }

  public get(
    id: string,
  ): Plan | undefined {

    return this.plans.get(
      id,
    );

  }

  public all():
    Plan[] {

    return Array.from(
      this.plans.values(),
    );

  }

  public clear():
    void {

    this.plans.clear();

  }

}