/**
 * ==========================================================
 * LÉLU — CONVERSATIONAL COGNITION: SHARED VOCABULARY
 *
 * The types every WP18 module agrees on. Deliberately small: this
 * is a vocabulary, not a second cognition model.
 *
 * Two distinctions are carried everywhere because conflating them
 * is how "proactive" turns into noise:
 *
 *   SURFACE     where the words arrived (chat, voice, browser). One
 *               thread can move between them; the thread is what
 *               persists, not the panel.
 *   VISIBILITY  whether an event was internal reasoning or something
 *               the user was actually told. Neural Map projections
 *               keep these apart so an internal observation can never
 *               be mistaken for a claim she made.
 * ==========================================================
 */

/** Where a turn arrived from. One conversation can move between all three. */
export type Surface = "chat" | "voice" | "browser";

/**
 * Behavioral states of the SAME LÉLU cognition (WP18.8). These are
 * not agents and they own no stores; they decide how much she says,
 * not who is speaking.
 */
export type CognitiveMode =
  | "conversational"
  | "collaborative"
  | "executive"
  | "reflective"
  | "observational";

/**
 * Something real that justifies a statement.
 *
 * A contribution without at least one of these is not raised. That is
 * the mechanism that keeps initiative grounded rather than decorative.
 */
export interface Evidence {
  /** Which system or input this came from, e.g. "project:checkpoint". */
  source: string;
  /** The fact itself, short enough to read in a prompt. */
  detail: string;
}
