/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — CHAT INTENTS (pure)
 *
 * Part VI.1 lists the sentences a user must be able to say. This module turns
 * those sentences into one operation with its arguments, so the chat tool, the
 * API and the CLI all answer the same way and none of them needs an LLM call to
 * understand "render a profile".
 *
 * It is a resolver, not a chatbot: when the sentence is not a Foundry request it
 * says `unknown` instead of guessing, and when it names several things it returns
 * one operation plus the shots it named.
 * ==========================================================
 */

export type FoundryOperation =
  | "status"
  | "references"
  | "research"
  | "render"
  | "benchmark"
  | "compare"
  | "project"
  | "versions"
  | "restore"
  | "export"
  | "explain"
  | "improve-face"
  | "hair"
  | "jewelry"
  | "clothing"
  | "anatomy"
  | "reconstruct"
  | "unknown";

export interface FoundryIntent {
  operation: FoundryOperation;
  shots: string[];
  /** The words that decided it — so an answer can be checked. */
  because: string[];
  /** A version id or label if the sentence names one. */
  version: string | null;
}

const SHOT_WORDS: Array<[RegExp, string[]]> = [
  [/\b(front|frontal|portrait)\b/i, ["portrait-front"]],
  [/\b(three[- ]quarter|3\/4|threequarter)\b/i, ["portrait-three-quarter"]],
  [/\b(side|profile|lateral)\b/i, ["profile"]],
  [/\b(back|rear)\b/i, ["rear"]],
  [/\b(face|close[- ]?up)\b/i, ["face-close-up"]],
  [/\b(eyes?|eyelids?|iris)\b/i, ["eyes"]],
  [/\b(nose|lips?|mouth)\b/i, ["nose-lips"]],
  [/\b(hairline|baby[- ]?hairs?|forehead)\b/i, ["hairline"]],
  [/\b(curls?|ringlets?|strands?)\b/i, ["curl-detail"]],
  [/\b(hairstyle|hair)\b/i, ["hair-full"]],
  [/\b(jewell?ery|jewelry|chain|headpiece|ornament)\b/i, ["jewelry"]],
  [/\b(upper[- ]body|torso|bust)\b/i, ["upper-body"]],
  [/\b(full[- ]body|whole body|figure)\b/i, ["full-body"]],
];

const VERSION = /\b(v\d{4})\b/i;

/**
 * Resolve a sentence. Order matters: an explicit comparison beats a render, and
 * "why did the reconstruction fail" is an explanation rather than a new job.
 */
export function interpretFoundryIntent(text: string): FoundryIntent {
  const because: string[] = [];
  const shots = new Set<string>();
  for (const [pattern, ids] of SHOT_WORDS) {
    if (pattern.test(text)) {
      for (const id of ids) shots.add(id);
      because.push(`"${pattern.source}" → ${ids.join(", ")}`);
    }
  }
  const version = VERSION.exec(text)?.[1]?.toLowerCase() ?? null;
  if (version) because.push(`named version ${version}`);

  const op = (operation: FoundryOperation): FoundryIntent => ({ operation, shots: [...shots], because, version });

  if (/\b(why|explain).*(fail|failed|wrong|broken|blocked)\b/i.test(text) || /\bwhat went wrong\b/i.test(text)) return op("explain");
  if (/\b(compare|difference|diff|versus|vs\.?)\b/i.test(text)) return op("compare");
  if (/\b(restore|roll ?back|revert)\b/i.test(text)) return op("restore");
  if (/\b(versions?|history|timeline)\b/i.test(text)) return op("versions");
  if (/\b(export|download|obj|fbx|glb)\b/i.test(text) && !/\brender\b/i.test(text)) return op("export");
  if (/\b(what|which|status|capab\w*|hardware|gpu|licen[cs]e)\b/i.test(text) && !shots.size) return op("status");
  if (/\b(reference|photograph|inspect|measurement|sheet)\b/i.test(text) && !shots.size) return op("references");
  if (/\b(research|technology|compare engines|benchmark matrix)\b/i.test(text) && !shots.size) return op("research");
  if (/\b(benchmark|thirteen|13 shots|all views|every view)\b/i.test(text)) return op("benchmark");
  if (/\b(improve|fix|correct).*(face|jaw|cheek|chin|proportion)\b/i.test(text)) return op("improve-face");
  if (/\b(hairstyle|hair|curl|ringlet)\b/i.test(text) && /\b(change|new|generate|variation|add|more|less|longer|shorter)\b/i.test(text)) return op("hair");
  if (/\b(jewell?ery|jewelry|chain|headpiece|ornament)\b/i.test(text) && /\b(add|change|place|restore|design)\b/i.test(text)) return op("jewelry");
  if (/\b(cloth|clothing|garment|outfit|dress|corset)\b/i.test(text) && /\b(add|change|new|fit|wear)\b/i.test(text)) return op("clothing");
  if (/\b(anatomy|shoulders?|neck|body proportions?|hips?|legs?)\b/i.test(text) && /\b(adjust|change|fix|correct)\b/i.test(text)) return op("anatomy");
  if (/\b(reconstruct|rebuild|build).*(character|lelu|her)\b/i.test(text)) return op("reconstruct");
  if (/\b(render|show|see|look|view|shot|image|picture)\b/i.test(text)) {
    if (!shots.size) because.push("generic render request → face and portrait");
    return op("render");
  }
  if (/\b(project|version|state|preserve)\b/i.test(text)) return op("project");
  return op("unknown");
}

/** Shots to render for an operation: the named ones, or a sensible pair. */
export function shotsForIntent(intent: FoundryIntent): string[] {
  if (intent.shots.length) return intent.shots;
  switch (intent.operation) {
    case "render":
      return ["face-close-up", "portrait-front"];
    case "benchmark":
      return [];
    case "improve-face":
      return ["face-close-up", "portrait-front"];
    case "hair":
      return ["hairline", "hair-full"];
    case "jewelry":
      return ["jewelry", "portrait-three-quarter"];
    default:
      return [];
  }
}
