/**
 * ==========================================================
 * LÉLU
 * CONFIDENCE ENGINE
 * ==========================================================
 */

import type ResponsePattern
  from "./ResponsePattern";

export default class ConfidenceEngine {

  public calculate(
    pattern: ResponsePattern,
  ): number {

    const totalUses =

      pattern.successfulUses +

      pattern.failedUses;

    if (
      totalUses === 0
    ) {

      return 0.5;

    }

    const successRate =

      pattern.successfulUses /

      totalUses;

    const experienceBonus =

      Math.min(

        totalUses / 100,

        0.2,

      );

    const confidence =

      successRate +

      experienceBonus;

    return Math.max(

      0,

      Math.min(

        1,

        confidence,

      ),

    );

  }

  public update(
    pattern: ResponsePattern,
  ): ResponsePattern {

    pattern.confidence =

      this.calculate(
        pattern,
      );

    pattern.updatedAt =
      Date.now();

    return pattern;

  }

  public compare(

    left: ResponsePattern,

    right: ResponsePattern,

  ): number {

    const leftScore =
      this.calculate(
        left,
      );

    const rightScore =
      this.calculate(
        right,
      );

    return rightScore -
      leftScore;

  }

  public sort(

    patterns:
      ResponsePattern[],

  ): ResponsePattern[] {

    return [

      ...patterns,

    ].sort(

      (
        left,
        right,
      ) =>

        this.compare(
          left,
          right,
        ),

    );

  }

  public best(

    patterns:
      ResponsePattern[],

  ): ResponsePattern | undefined {

    if (
      patterns.length === 0
    ) {

      return undefined;

    }

    return this.sort(
      patterns,
    )[0];

  }

}