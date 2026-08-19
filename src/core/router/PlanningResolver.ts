/**
 * ==========================================================
 * LÉLU
 * PLANNING RESOLVER
 *
 * Runs right after Memory, before Reasoning.
 *
 * Detects whether a request is actually a single question or
 * a multi-step task. When it looks multi-step, it builds a
 * tracked Plan (via PlanningEngine) and records it on the
 * shared context so Reasoning can factor it in, the provider
 * gets a short outline to work from, and the response can
 * carry the plan back out for the UI / reflection stage.
 *
 * Never short-circuits the pipeline — this stage only
 * annotates.
 * ==========================================================
 */

import PlanningEngine
  from "../planning/PlanningEngine";

import type RouterContext
  from "./RouterContext";


/**
 * Conjunctions/markers that suggest
 * the prompt is describing more than
 * one step.
 */
const STEP_MARKERS =
  [
    "\n",
    ";",
    " then ",
    " after that",
    " next,",
    " and then",
    " finally,",
    " first,",
    " step 1",
  ];


export default class PlanningResolver {


  private readonly engine =
    new PlanningEngine();


  public async execute(

    context:
      RouterContext,

  ):
    Promise<void> {


    const prompt =
      context.request.prompt.trim();


    const steps =
      this.split(
        prompt,
      );


    if (
      steps.length < 2
    ) {

      return;

    }


    const plan =
      this.engine.create(
        prompt,
      );


    steps.forEach(
      (
        title,
        index,
      ) => {

        this.engine.addStep(

          plan.id,

          {

            id:
              `${plan.id}-step-${index + 1}`,

            title:
              title.length > 80
                ? `${title.slice(0, 77)}...`
                : title,

            description:
              title,

            priority:
              index,

            dependencies:
              index === 0
                ? []
                : [`${plan.id}-step-${index}`],

          },

        );

      },

    );


    this.engine.start(
      plan.id,
    );


    context.plan =
      this.engine.get(
        plan.id,
      );


    if (
      context.plan
    ) {

      context.logger.info(

        "PlanningResolver",

        `Built a ${context.plan.steps.length}-step plan for this request.`,

      );


      const outline =
        context.plan.steps

          .map(
            (
              step,
              index,
            ) =>
              `${index + 1}. ${step.title}`,
          )

          .join(
            "\n",
          );


      context.request.context = [

        context.request.context,

        `Plan:\n${outline}`,

      ]

        .filter(
          value =>
            Boolean(value && value.trim().length > 0),
        )

        .join(
          "\n\n",
        );

    }

  }


  /**
   * Split a prompt into candidate steps
   * using simple structural markers.
   * Conservative on purpose: a false
   * negative just means no plan is
   * attached, which is the current
   * (safe) behavior. A false positive
   * would fabricate structure that
   * isn't there.
   */
  private split(

    prompt:
      string,

  ):
    string[] {


    if (
      !prompt
    ) {

      return [];

    }


    let normalized =
      prompt;


    for (
      const marker of STEP_MARKERS
    ) {

      if (
        marker === "\n" ||
        marker === ";"
      ) {

        continue;

      }


      normalized =
        normalized.split(
          marker,
        )
          .join(
            "\n",
          );

    }


    const parts =
      normalized

        .split(
          /[\n;]/,
        )

        .map(
          part =>
            part.trim(),
        )

        .filter(
          part =>
            part.length > 3,
        );


    return parts;

  }

}
