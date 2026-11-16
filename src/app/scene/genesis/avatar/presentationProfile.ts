/**
 * ==========================================================
 * LÉLU — HOW SHE PRESENTS HERSELF IN EACH INTERFACE
 *
 * A pure decision, read by her one presence (LeluCompanion): given the
 * interface she is in, the space she has and what the person (or she)
 * chose, which of her presentations to show:
 *
 *   framing "full" — all of her: demonstrations, modelling, movement
 *   framing "face" — head and shoulders: compact, conversation
 *   form "embodied" — as she is
 *   form "hologram" — the same her, projected (a material on her own
 *                     model; LeluBody/holoMaterial)
 *
 * It decides nothing about WHO she is (one model, one controller, one
 * state) and nothing about WHERE she is (presencePlacement /
 * spatialPresence). A user's explicit choice (LeluCharacterStore) wins
 * over the interface; "auto" lets the interface decide.
 * ==========================================================
 */

import type { LeluForm, LeluFraming } from "../../../../core/avatar/LeluRig";
import type { LeluFormChoice, LeluFramingChoice } from "../../../../core/avatar/LeluCharacterStore";

/** The kind of interface she is in. */
export type PresenceContext = "home" | "chat" | "creative" | "engineering" | "browser" | "world" | "workspace" | "other";

const CREATIVE = new Set(["visualstudio", "creation", "sketch", "render", "video", "avatar", "creativity", "projects"]);
const ENGINEERING = new Set(["engineering", "command", "evolution", "diagnostics", "logs", "development", "system", "device", "executive", "cognition", "reasoning"]);
const BROWSER = new Set(["browser", "research", "knowledge", "earth"]);

/** Which interface a panel or window id belongs to. */
export function contextOf(input: { onHome: boolean; inWorld: boolean; chatOpen: boolean; focused: string | null }): PresenceContext {
  if (input.inWorld) return "world";
  const id = input.focused;
  if (id && CREATIVE.has(id)) return "creative";
  if (id && ENGINEERING.has(id)) return "engineering";
  if (id && BROWSER.has(id)) return "browser";
  if (id === "chat" || (!id && input.chatOpen)) return "chat";
  if (input.onHome) return "home";
  return id ? "workspace" : "other";
}

/**
 * Whether she rests on a captured frame instead of animating. Only on a
 * device measured as "light" (software renderer, no WebGL, data saver) and
 * only beside a phone's full-screen sheet; see LeluCompanion for the
 * measurement. Everywhere else she is live.
 */
export function restsOnStill(input: { besidePhoneSheet: boolean; renderProfile: "full" | "balanced" | "light" }): boolean {
  return input.besidePhoneSheet && input.renderProfile === "light";
}

/** Below this height her whole figure is too small to read: head and shoulders instead. */
export const FULL_MIN_HEIGHT = 150;

export interface Presentation {
  framing: LeluFraming;
  form: LeluForm;
  /** Why, in words (shown in data-presentation-reason for tests and assistive tooling). */
  reason: string;
}

/**
 * The presentation for this interface. `boxHeight` is the space her place
 * gives her; `hero` is the Home's reserved spot (a portrait).
 */
export function choosePresentation(input: {
  context: PresenceContext;
  boxHeight: number;
  hero: boolean;
  userForm: LeluFormChoice;
  userFraming: LeluFramingChoice;
}): Presentation {
  const { context, boxHeight, hero, userForm, userFraming } = input;
  const roomy = boxHeight >= FULL_MIN_HEIGHT;
  // What the interface asks for.
  let framing: LeluFraming;
  let form: LeluForm;
  let why: string;
  switch (context) {
    case "home":
      framing = hero || !roomy ? "face" : "full";
      form = "embodied";
      why = hero ? "home: her portrait in the hero spot" : "home";
      break;
    case "chat":
      framing = roomy ? "full" : "face";
      form = "embodied";
      why = roomy ? "chat: room beside the conversation for all of her" : "chat: compact beside the conversation";
      break;
    case "creative":
      framing = "full";
      form = "embodied";
      why = "creative: all of her, to demonstrate and model";
      break;
    case "engineering":
      framing = "face";
      form = "hologram";
      why = "engineering: a compact projection beside the work";
      break;
    case "browser":
      framing = "face";
      form = "hologram";
      why = "browser: a compact projection beside the page";
      break;
    case "world":
      framing = "full";
      form = "embodied";
      why = "world: she stands in it";
      break;
    default:
      framing = roomy ? "full" : "face";
      form = "embodied";
      why = context;
  }
  // What the person (or she) chose wins.
  if (userForm !== "auto") {
    form = userForm;
    why += `; form chosen: ${userForm}`;
  }
  if (userFraming !== "auto") {
    framing = userFraming;
    why += `; framing chosen: ${userFraming}`;
  }
  return { framing, form, reason: why };
}
