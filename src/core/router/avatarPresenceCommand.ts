/**
 * ==========================================================
 * LÉLU — HER PRESENCE COMMANDS, IN WORDS
 *
 * Deterministic: no model call. "Become a hologram", "show me all of you",
 * "just your face", "walk to the studio", "come closer", "face me", "dance".
 * Conservative: the sentence must be an instruction to her (it starts with
 * the verb, after an optional "LÉLU," / "please" / "can you"), so talk about
 * holograms or dancing is never taken as a command.
 *
 * The router hands the result to AvatarResolver, which executes it through
 * the one store (LeluCharacterStore) or the one action bus
 * (AvatarCommandBus) and reports only what a renderer confirmed.
 * ==========================================================
 */

import type { AvatarCommandKind, AvatarPlace } from "../avatar/AvatarCommandBus";

export type AvatarPresenceCommand =
  | { type: "form"; form: "auto" | "embodied" | "hologram"; label: string }
  | { type: "framing"; framing: "auto" | "full" | "face"; label: string }
  | { type: "presentation-auto"; label: string }
  | { type: "motion"; kind: AvatarCommandKind; label: string; place?: AvatarPlace };

const LEAD = /^(?:l[eé]lu[,!\s]+)?(?:(?:please|can you|could you|would you|will you|now)\s+)*/;

const PLACE_WORDS: ReadonlyArray<[RegExp, AvatarPlace]> = [
  [/\b(?:the\s+)?core\b/, "core"],
  [/\b(?:the\s+)?(?:creation\s+)?studio\b/, "studio"],
  [/\b(?:the\s+)?(?:research\s+)?lab\b/, "lab"],
  [/\b(?:the\s+)?vault\b/, "vault"],
  [/\b(?:your\s+(?:own\s+)?(?:spot|place|home)|home|where you were)\b/, "home"],
  [/\b(?:me|here|us)\b/, "viewer"],
  [/\b(?:the\s+)?left\b/, "left"],
  [/\b(?:the\s+)?right\b/, "right"],
  [/\b(?:the\s+)?(?:middle|center|centre)\b/, "center"],
];

function placeIn(text: string): AvatarPlace | undefined {
  for (const [pattern, place] of PLACE_WORDS) if (pattern.test(text)) return place;
  return undefined;
}

export function parseAvatarPresenceCommand(input: string): AvatarPresenceCommand | null {
  const raw = input.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!raw || raw.length > 90) return null;
  const t = raw.replace(LEAD, "").trim();

  // ---- Form ----
  if (/^(?:become|turn into|switch to|change (?:in)?to|go|be|appear as|show yourself as|project yourself as)\s+(?:a\s+|your\s+)?(?:hologram|holographic(?:\s+form)?|holo)\b/.test(t) || /^(?:go|switch to|turn on)\s+hologram(?:\s+mode)?$/.test(t)) {
    return { type: "form", form: "hologram", label: "become a hologram" };
  }
  if (/^(?:become|go back to|switch (?:back )?to|change (?:back )?to|be)\s+(?:embodied|normal|your (?:real |normal )?(?:self|body))\b/.test(t) || /^(?:stop being a hologram|no more hologram|turn off (?:the )?hologram)$/.test(t)) {
    return { type: "form", form: "embodied", label: "become embodied" };
  }

  // ---- Framing ----
  if (/^(?:show (?:me )?(?:all of you|your (?:whole|full) body|your full figure)|full body(?: mode)?|go full body|switch to full body)$/.test(t)) {
    return { type: "framing", framing: "full", label: "show all of her" };
  }
  if (/^(?:(?:just|only) (?:show )?your face|show (?:me )?(?:just|only) your face|face only|go face only|switch to (?:your )?face(?: only)?)$/.test(t)) {
    return { type: "framing", framing: "face", label: "show just her face" };
  }
  if (/^(?:choose|pick) (?:your|the) (?:own )?(?:form|look|presentation)(?: yourself)?$|^(?:auto(?:matic)?|adaptive) (?:form|presentation|mode)$/.test(t)) {
    return { type: "presentation-auto", label: "let each interface choose" };
  }

  // ---- Movement (with somewhere to go) ----
  const go = t.match(/^(?:walk|go|move|head|run|come)\s+(?:over\s+)?(?:back\s+)?(?:to|toward|towards|over to|into)\s+(.+)$/);
  if (go) {
    const place = placeIn(go[1]);
    if (place) return { type: "motion", kind: "move", label: `walk to ${place === "viewer" ? "you" : place === "home" ? "her spot" : `the ${place}`}`, place };
  }
  if (/^(?:come (?:here|closer|over here|to me)|approach(?: me)?|step (?:forward|closer)|walk over)$/.test(t)) {
    return { type: "motion", kind: "move", label: "come closer", place: "viewer" };
  }
  if (/^(?:step (?:back|away)|back (?:up|off)|give me (?:some )?space|move away)$/.test(t)) {
    return { type: "motion", kind: "move", label: "step away", place: "away" };
  }
  if (/^(?:go back to your (?:spot|place)|return to your (?:spot|place)|go home)$/.test(t)) {
    return { type: "motion", kind: "move", label: "go back to her spot", place: "home" };
  }
  if (/^(?:move|go|slide) (?:to the )?(left|right)(?: side)?$/.test(t)) {
    const side = t.includes("left") ? "left" : "right";
    return { type: "motion", kind: "move", label: `move to the ${side}`, place: side };
  }

  // ---- Turning ----
  if (/^(?:face me|turn (?:to|toward|towards) me|look at me|turn around to me)$/.test(t)) {
    return { type: "motion", kind: "look", label: "face you", place: "viewer" };
  }
  const face = t.match(/^(?:face|turn (?:to|toward|towards)|look (?:at|toward|towards))\s+(?:the\s+)?(core|studio|lab|vault)$/);
  if (face) return { type: "motion", kind: "look", label: `face the ${face[1]}`, place: face[1] as AvatarPlace };
  if (/^look around$/.test(t)) return { type: "motion", kind: "look", label: "look around" };

  // ---- Gestures (her captured clips) ----
  const gestures: ReadonlyArray<[RegExp, AvatarCommandKind, string]> = [
    [/^dance(?: for me)?$/, "dance", "dance"],
    [/^(?:wave|wave (?:at|to) me|say hi|say hello)$/, "wave", "wave"],
    [/^nod$/, "nod", "nod"],
    [/^(?:bow|take a bow)$/, "bow", "bow"],
    [/^shrug$/, "shrug", "shrug"],
    [/^(?:make a heart|show (?:me )?(?:some )?love|blow (?:me )?a kiss)$/, "heart", "heart"],
    [/^(?:cheer|celebrate)$/, "cheer", "cheer"],
    [/^jump$/, "jump", "jump"],
    [/^(?:sit(?: down)?|take a seat|have a seat)$/, "sit", "sit down"],
    [/^(?:stand(?: up)?|get up)$/, "stand", "stand up"],
    [/^(?:walk (?:away|off)|take a (?:walk|break)|go for a walk)$/, "leave", "walk off"],
    [/^(?:come back|return)$/, "return", "come back"],
  ];
  for (const [pattern, kind, label] of gestures) if (pattern.test(t)) return { type: "motion", kind, label };
  return null;
}
