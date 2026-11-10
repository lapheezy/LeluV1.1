/**
 * ==========================================================
 * LÉLU — INTERNAL FAILURE (engine bug ≠ her answer)
 * ==========================================================
 *
 * Three separate layers used to hand a caught exception to the UI as if it
 * were the reply: `AIService.chat`, `Orchestrator.process`, and the two chat
 * surfaces. On the owner's account that produced a turn which read
 *
 *     undefined is not an object (evaluating '…favoriteColors.join')
 *
 * as LÉLU's answer — from a turn in which no provider had been consulted at
 * all, because the throw happened before the model call.
 *
 * The classification lives here so every surface agrees on it: a TypeError,
 * ReferenceError or RangeError (or their wording, which is what a
 * cross-engine message is) is a BUG REPORT. Everything else is a provider or
 * transport failure, whose message is useful and may be shown.
 */

/** What the user reads instead of a stack trace. */
export const INTERNAL_FAILURE_NOTICE =
  "Something inside me failed while composing that reply — your message is safe. Send it again and I'll retry.";

/** Engine-failure wording, shared by Chromium and WebKit. */
const ENGINE_WORDING =
  /is not an object|is not a function|undefined is not|cannot read propert|evaluating|reading '/i;

/**
 * Is this an engine failure rather than a provider/transport failure?
 *
 * Accepts the thrown value or its already-extracted message, because some
 * call sites only have the string (the OG chat receives `error.message`).
 */
export function isInternalEngineError(value: unknown): boolean {
  if (
    value instanceof TypeError ||
    value instanceof ReferenceError ||
    value instanceof RangeError
  ) {
    return true;
  }
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : "";
  return ENGINE_WORDING.test(text);
}
