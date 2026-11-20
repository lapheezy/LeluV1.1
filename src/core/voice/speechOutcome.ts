/**
 * LÉLU — why a voice turn did or did not end in speech.
 *
 * M22.9 recorded 26 spoken turns out of 30 and could not say what happened
 * on the other four: no error, no failed request, no diagnostics entry. The
 * turns were simply absent. An absent turn is indistinguishable from a
 * defect, so every turn now ENDS WITH A RECORDED OUTCOME — the silence is
 * explained by the pipeline instead of being discovered by the listener.
 *
 * The four M22.9 silences were traced to a provider refusal (HTTP 429, quota
 * exhausted) that the engine treated as a "failure notice": shown in the
 * conversation and deliberately never spoken, so the user heard nothing at
 * all. That rule protected against reading an error message aloud as if it
 * were her answer, and it still holds — the notice text is still never
 * spoken. What changed is that a refusal is no longer allowed to produce
 * total silence: a short, fixed holding line tells the person what happened.
 *
 * Pure, so the classification and the wording are unit-tested rather than
 * described.
 */

import type { VoiceTurnFailureKind } from "./turnFailure";

export type TurnSpeechOutcome =
  /** Her answer reached the speaker. */
  | "spoke"
  /** A newer turn took the conversation before this one spoke. */
  | "superseded"
  /** Providers refused (quota, credit, key) — not a timeout. */
  | "provider-unavailable"
  /** A provider accepted the request and did not answer in time. */
  | "provider-timeout"
  /** The network itself failed mid-turn. */
  | "network-failure"
  /** Speech arrived but could not be turned into words. */
  | "transcription-failure"
  /** The model answered with nothing that can be said. */
  | "empty-reply"
  /** The reply contained nothing pronounceable (emoji, code, symbols only). */
  | "unpronounceable"
  /** Her voice was produced but the device could not play it. */
  | "playback-failed"
  /** The person stopped it, or the session ended mid-turn. */
  | "cancelled"
  /** The mic heard her own voice and it was not treated as a user turn. */
  | "echo-suppressed"
  /** The same utterance arrived twice in quick succession. */
  | "duplicate-suppressed";

/** Every outcome, in a stable order — used for reporting and tests. */
export const TURN_SPEECH_OUTCOMES: TurnSpeechOutcome[] = [
  "spoke",
  "superseded",
  "provider-unavailable",
  "provider-timeout",
  "network-failure",
  "transcription-failure",
  "empty-reply",
  "unpronounceable",
  "playback-failed",
  "cancelled",
  "echo-suppressed",
  "duplicate-suppressed",
];

/**
 * Did this outcome leave the turn without audio of her answer?
 *
 * "Explained" is not "harmless": a rate-limited turn is still a turn the
 * person did not get an answer to. It is only not *unexplained*, which is
 * the property M22.9 lacked.
 */
export function isSilentOutcome(outcome: TurnSpeechOutcome): boolean {
  return outcome !== "spoke";
}

/** Map the turn-failure vocabulary onto the outcome vocabulary. */
export function outcomeForFailure(kind: VoiceTurnFailureKind): TurnSpeechOutcome {
  switch (kind) {
    case "provider-timeout":
      return "provider-timeout";
    case "transcription-failure":
      return "transcription-failure";
    case "playback-failure":
      return "playback-failed";
    case "user-cancellation":
      return "cancelled";
    case "network-failure":
      return "network-failure";
    case "provider-unavailable":
    default:
      return "provider-unavailable";
  }
}

/**
 * The short line LÉLU says INSTEAD of silence when a turn produced no answer.
 *
 * Fixed wording, never the provider's error text: an error message is not
 * something she would say, and reading one aloud as her answer was the
 * Mission 10.3 defect. This is a notice in her voice, one sentence, and it
 * names what happened without pretending it did not.
 *
 * `null` means there is nothing worth saying — a person who stopped her knows
 * why there is no audio, and a device that cannot play sound cannot say so.
 */
export function holdingLineFor(outcome: TurnSpeechOutcome): string | null {
  switch (outcome) {
    case "provider-unavailable":
      return "I can't get an answer from my model providers right now. Give me a minute and ask me again.";
    case "provider-timeout":
      return "That answer took too long on my side. Ask me again and I'll try to be quicker.";
    case "network-failure":
      return "I lost the network while I was answering. Ask me again when you're back.";
    case "transcription-failure":
      return "I couldn't make out that audio. Say it once more and I'll listen properly.";
    case "empty-reply":
      return "I don't have a good answer to that one. Ask me differently and I'll try again.";
    default:
      return null;
  }
}

export interface SpeechOutcomeSummary {
  /** Turns that reached the speech layer this session. */
  started: number;
  /** Turns that ended with a recorded reason. */
  recorded: number;
  /** Turns with no recorded reason at all — the M22.9 failure mode. */
  unexplained: number;
  spoken: number;
  silent: number;
  noticeSpoken: number;
  byOutcome: Partial<Record<TurnSpeechOutcome, number>>;
  last: TurnSpeechOutcome | null;
}

/** Fold a per-turn outcome map into the numbers a report can quote. */
export function summarizeOutcomes(
  outcomes: Iterable<TurnSpeechOutcome>,
  started: number,
  noticeSpoken = 0,
  last: TurnSpeechOutcome | null = null,
): SpeechOutcomeSummary {
  const byOutcome: Partial<Record<TurnSpeechOutcome, number>> = {};
  let recorded = 0;
  let spoken = 0;
  for (const outcome of outcomes) {
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    recorded += 1;
    if (outcome === "spoke") spoken += 1;
  }
  return {
    started,
    recorded,
    unexplained: Math.max(0, started - recorded),
    spoken,
    silent: recorded - spoken,
    noticeSpoken,
    byOutcome,
    last,
  };
}
