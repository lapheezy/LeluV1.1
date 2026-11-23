/**
 * ==========================================================
 * LÉLU — CHANGING CLOTHES, IN WORDS
 *
 * Deterministic, no model call: "wear the copper coat", "change into your
 * catsuit", "put on something comfy", "switch back to your camo",
 * "what can you wear?". Like avatarPresenceCommand.ts it is conservative:
 * the sentence must be an instruction to her (it starts with the verb, after
 * an optional "LÉLU," / "please" / "can you"), so talk ABOUT coats is never
 * taken as an order to change.
 *
 * A look is named by its wardrobe id or by any of the words a person would
 * use for it. Aliases are data (LOOK_ALIASES); a new look in the wardrobe is
 * reachable by its id immediately, and by its words once listed here.
 * ==========================================================
 */

export type OutfitCommand =
  | { type: "dress"; look: string; label: string; matched: string }
  | { type: "undress-look"; label: string }
  | { type: "wardrobe"; label: string };

/** Words a person uses for each look. First entry is how she says it. */
export const LOOK_ALIASES: Record<string, string[]> = {
  rose_gold_sovereign: ["copper-rose coat", "rose gold coat", "rose-gold coat", "rose gold", "sovereign", "long coat", "coat dress", "coat", "trench"],
  bronze_velocity: ["copper catsuit", "bronze catsuit", "catsuit", "bodysuit", "jumpsuit", "bronze", "velocity", "copper suit"],
  home_laidback3: ["home look", "laidback look", "laid back", "laidback", "loungewear", "lounge", "hoodie", "sweats", "comfy", "cozy", "cosy", "home", "casual"],
  camo_repaired: ["camo outfit", "camo", "camouflage", "corset", "original outfit", "usual outfit", "original", "usual", "cargo"],
};

const LEAD = /^(?:l[eé]lu[,!\s]+)?(?:(?:please|can you|could you|would you|will you|now|ok|okay)\s+)*/;
const DRESS_VERB = /^(?:wear|put on|change into|change to|switch to|switch into|get into|get dressed in|dress in|dress up in|slip into|go with|try on|show me (?:you )?in|change back into|switch back to|go back to)\b/;
const WARDROBE = /^(?:what (?:can|could) you wear|what(?:'s| is) in your (?:wardrobe|closet)|show (?:me )?your (?:wardrobe|closet|outfits|looks)|list your (?:outfits|looks)|what (?:outfits|looks) do you have)\b/;
const BASE = /^(?:take off (?:the|your) (?:outfit|look)|go back to (?:your )?base (?:rig|look|model))\b/;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which look a phrase names, longest alias first so "copper catsuit" beats "copper". */
export function lookFromWords(phrase: string, available: string[] = Object.keys(LOOK_ALIASES)): { look: string; matched: string } | null {
  const p = normalise(phrase);
  for (const id of available) if (p.includes(id) || p.includes(id.replace(/_/g, " "))) return { look: id, matched: id };
  const pairs: Array<[string, string]> = [];
  for (const [id, words] of Object.entries(LOOK_ALIASES)) if (available.includes(id)) for (const w of words) pairs.push([id, w]);
  pairs.sort((a, b) => b[1].length - a[1].length);
  for (const [id, w] of pairs) if (new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`).test(p)) return { look: id, matched: w };
  return null;
}

export function parseOutfitCommand(text: string, available?: string[]): OutfitCommand | null {
  const body = normalise(text).replace(LEAD, "");
  if (WARDROBE.test(body)) return { type: "wardrobe", label: "list the wardrobe" };
  if (BASE.test(body)) return { type: "undress-look", label: "back to the base rig" };
  const verb = body.match(DRESS_VERB);
  if (!verb) return null;
  const rest = body.slice(verb[0].length);
  const hit = lookFromWords(rest, available);
  if (!hit) return null;
  return { type: "dress", look: hit.look, matched: hit.matched, label: `wear ${hit.look}` };
}

/** How she names a look in a sentence. */
export function lookName(id: string): string {
  return LOOK_ALIASES[id]?.[0] ?? id.replace(/_/g, " ");
}
