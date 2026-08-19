/**
 * ==========================================================
 * LÉLU
 * REASONING ENGINE
 * ==========================================================
 */

export interface Hypothesis {

  id:
    string;

  statement:
    string;

  confidence:
    number;

  evidence:
    string[];

}

export interface ReasoningResult {

  selected:
    Hypothesis | null;

  hypotheses:
    Hypothesis[];

  explanation:
    string;

}

export default class ReasoningEngine {

  private readonly history =
    new Array<
      ReasoningResult
    >();

  public evaluate(

    hypotheses:
      Hypothesis[],

  ): ReasoningResult {

    const sorted =

      [...hypotheses]

        .sort(

          (
            left,
            right,
          ) =>

            right.confidence -

            left.confidence,

        );

    const result: ReasoningResult = {

      selected:

        sorted.length > 0

          ? sorted[0]

          : null,

      hypotheses:
        sorted,

      explanation:

        sorted.length > 0

          ? `Selected "${sorted[0].statement}" with confidence ${sorted[0].confidence}.`

          : "No valid hypothesis.",

    };

    this.history.push(
      result,
    );

    return result;

  }

  public latest():
    ReasoningResult | undefined {

    return this.history.at(
      -1,
    );

  }

  public all():
    ReasoningResult[] {

    return [
      ...this.history,
    ];

  }

  public clear():
    void {

    this.history.length =
      0;

  }

}