/**
 * ==========================================================
 * LÉLU
 * INTENT DETECTOR
 * ==========================================================
 */

import type {
  AIIntent,
} from "./AIIntent";

export default class IntentDetector {

  /**
   * Determine the user's intent.
   */
  public detect(
    input: string,
  ): AIIntent {

    const text =
      input
        .trim()
        .toLowerCase();

    if (
      this.contains(
        text,
        [
          "wire",
          "circuit",
          "electrical",
          "electrician",
          "voltage",
          "current",
          "breaker",
          "panel",
          "engineering",
          "engineer",
          "code",
          "typescript",
          "javascript",
          "react",
          "vite",
          "bug",
          "compile",
          "compiler",
          "error",
          "debug",
          "fix",
        ],
      )
    ) {

      return "engineering";

    }

    if (
      this.contains(
        text,
        [
          "remember",
          "memory",
          "recall",
          "forgot",
          "save",
          "store",
        ],
      )
    ) {

      return "memory";

    }

    if (
      this.contains(
        text,
        [
          "genesis",
          "galaxy",
          "universe",
          "cosmos",
          "star",
          "planet",
        ],
      )
    ) {

      return "genesis";

    }

    if (
      this.contains(
        text,
        [
          "voice",
          "speech",
          "speak",
          "listen",
          "audio",
        ],
      )
    ) {

      return "voice";

    }

    if (
      this.contains(
        text,
        [
          "search",
          "find",
          "look up",
          "lookup",
          "research",
          "wikipedia",
          "who is",
          "what is",
          "where is",
          "when did",
        ],
      )
    ) {

      return "search";

    }

    return "chat";

  }

  /**
   * Determine whether the input
   * contains any keyword.
   */
  private contains(
    input: string,
    keywords:
      readonly string[],
  ): boolean {

    for (
      const keyword of keywords
    ) {

      if (
        input.includes(
          keyword,
        )
      ) {

        return true;

      }

    }

    return false;

  }

}