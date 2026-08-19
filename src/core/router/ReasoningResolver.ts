/**
 * ==========================================================
 * LÉLU
 * REASONING RESOLVER
 *
 * Runs after Memory and Planning, before Knowledge Retrieval
 * and Provider Selection.
 *
 * It does not answer the request. It decides, and records,
 * *how* Lélu should approach answering it — so the choice is
 * visible to the rest of the pipeline (via RouterContext) and
 * to the UI/reflection stage (via AIResponse.metadata), instead
 * of being an implicit side effect of provider selection.
 * ==========================================================
 */

import IntentDetector
  from "./IntentDetector";

import ReasoningEngine, {
  type Hypothesis,
} from "../reasoning/ReasoningEngine";

import type RouterContext
  from "./RouterContext";


export default class ReasoningResolver {


  private readonly detector =
    new IntentDetector();


  private readonly engine =
    new ReasoningEngine();


  /**
   * Evaluate candidate strategies for
   * this request and record the winner
   * on the shared context.
   *
   * Never short-circuits the pipeline —
   * this stage only annotates.
   */
  public async execute(

    context:
      RouterContext,

  ):
    Promise<void> {


    const prompt =
      context.request.prompt;


    const intent =
      this.detector.detect(
        prompt,
      );


    const hasMemory =
      (context.recalledMemories ?? [])
        .length > 0;


    const hasInjectedContext =
      Boolean(
        context.request.context &&
        context.request.context
          .trim()
          .length > 0,
      );


    const hasPlan =
      Boolean(
        context.plan &&
        context.plan.steps.length > 0,
      );


    const hypotheses:
      Hypothesis[] =
    [

      {
        id: "recalled-memory",
        statement:
          "Ground the answer in patterns Lélu has already learned.",
        confidence:
          hasMemory ? 0.8 : 0.15,
        evidence:
          hasMemory
            ? [`${context.recalledMemories!.length} related memory pattern(s) found`]
            : [],
      },

      {
        id: "injected-context",
        statement:
          "Ground the answer in the conversation/context already attached to this request.",
        confidence:
          hasInjectedContext ? 0.75 : 0.2,
        evidence:
          hasInjectedContext
            ? ["request.context is populated"]
            : [],
      },

      {
        id: "plan-driven",
        statement:
          "Work the request as a sequence of steps rather than a single answer.",
        confidence:
          hasPlan ? 0.7 : 0.1,
        evidence:
          hasPlan
            ? [`Plan with ${context.plan!.steps.length} step(s) is active`]
            : [],
      },

      {
        id: "knowledge-lookup",
        statement:
          "Defer to knowledge/tool retrieval before generating an answer.",
        confidence:
          intent === "search" ? 0.65 : 0.1,
        evidence:
          intent === "search"
            ? ["Intent detected as search"]
            : [],
      },

      {
        id: "general-knowledge",
        statement:
          "Answer from the provider's general knowledge; no special grounding available.",
        confidence:
          0.4,
        evidence:
          [],
      },

    ];


    const result =
      this.engine.evaluate(
        hypotheses,
      );


    context.reasoning =
      result;


    if (
      result.selected
    ) {

      context.logger.info(

        "ReasoningResolver",

        result.explanation,

        {
          intent,
          hypothesisId:
            result.selected.id,
        },

      );


      context.request.context = [

        context.request.context,

        `Reasoning: ${result.explanation}`,

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

}
