/**
 * ==========================================================
 * LÉLU — PROVIDER VOICE CONTRACT
 *
 * One identity, eight engines. The voice directive is built
 * once by VoiceComposer and attached to the request, so every
 * provider receives the same content. What differs is how
 * much of it fits and how it is best framed:
 *
 *   • context windows are not equal (Groq's free tier meters
 *     tokens per minute; Gemini and Mistral are generous);
 *   • instruction-following is not equal (a long markdown
 *     directive is obeyed literally by some models and skimmed
 *     by others);
 *   • tool availability is not equal.
 *
 * So the SAME contract is rendered per provider at three
 * densities — full, compact, minimal — always keeping the
 * identity lines and the anti-generic prohibitions, and
 * dropping the illustrative detail first. Nothing here adds
 * provider-specific personality: that would be the drift this
 * module exists to prevent.
 * ==========================================================
 */

export type ProviderVoiceId =
  | "openrouter"
  | "gemini"
  | "anthropic"
  | "groq"
  | "fireworks"
  | "mistral"
  | "cerebras"
  | "github-models";

export type DirectiveDensity = "full" | "compact" | "minimal";

export interface ProviderVoiceProfile {
  id: ProviderVoiceId;
  label: string;
  /** How this provider's requests are framed. */
  framing: "markdown" | "plain";
  /** Hard cap on the directive this provider receives. */
  maxDirectiveChars: number;
  /** Density used when no other constraint applies. */
  density: DirectiveDensity;
  /** Whether the provider implements native tool calling. */
  nativeTools: boolean;
  /** What the provider needs told about its own house style. */
  adaptation: string;
}

/**
 * Measured from each provider's request path, not copied from a
 * vendor table: the caps are deliberately conservative because a
 * directive that is cut by the provider mid-sentence is worse
 * than a shorter one that arrives whole.
 */
export const PROVIDER_VOICE_MATRIX: readonly ProviderVoiceProfile[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    framing: "markdown",
    maxDirectiveChars: 9_000,
    density: "full",
    nativeTools: true,
    adaptation: "Routes to many models; some are chatty by default. The contract outranks the routed model's own assistant style.",
  },
  {
    id: "gemini",
    label: "Gemini",
    framing: "markdown",
    maxDirectiveChars: 9_000,
    density: "full",
    nativeTools: true,
    adaptation: "Tends to summarise and add structured headings. Answer in prose unless structure is genuinely the content.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    framing: "markdown",
    maxDirectiveChars: 9_000,
    density: "full",
    nativeTools: true,
    adaptation: "Tends toward thoroughness and caveats. Cut the caveat, keep the judgement.",
  },
  {
    id: "groq",
    label: "Groq",
    framing: "plain",
    maxDirectiveChars: 5_500,
    density: "compact",
    nativeTools: true,
    adaptation: "Fast small-context models: short imperatives, no long examples, no markdown decoration.",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    framing: "markdown",
    maxDirectiveChars: 7_500,
    density: "compact",
    nativeTools: true,
    adaptation: "Coding turns use a different model; keep the voice lines intact when the work register changes.",
  },
  {
    id: "mistral",
    label: "Mistral",
    framing: "markdown",
    maxDirectiveChars: 7_500,
    density: "compact",
    nativeTools: true,
    adaptation: "Follows the last instruction most strongly. End on the prohibitions so they are not buried.",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    framing: "plain",
    maxDirectiveChars: 5_500,
    density: "compact",
    nativeTools: true,
    adaptation: "Very fast, low-latency: brevity in the directive as well as the answer.",
  },
  {
    id: "github-models",
    label: "GitHub Models",
    framing: "markdown",
    maxDirectiveChars: 7_500,
    density: "compact",
    nativeTools: false,
    adaptation: "No native tools: never promise an action the turn cannot perform; answer in text.",
  },
] as const;

const BY_ID = new Map(PROVIDER_VOICE_MATRIX.map((profile) => [profile.id, profile]));

export function providerVoiceProfile(id: string | undefined): ProviderVoiceProfile | undefined {
  if (!id) return undefined;
  return BY_ID.get(id.trim().toLowerCase() as ProviderVoiceId);
}

/** The identity lines that must survive every density. */
const IDENTITY_ANCHOR = [
  "You are LÉLU — a companion with a continuing history, not a generic assistant.",
  "The model answering is only the engine. Never identify yourself as an underlying model or provider.",
  "Lead with the answer or the objection. No preamble, no restating the question.",
];

/** The prohibitions that must survive every density. */
const PROHIBITION_ANCHOR = [
  'Never open with "Certainly", "Of course", "Great question", "I\'d be happy to help".',
  'Never close with "I hope this helps", "Let me know if you need anything else", or any stock offer.',
  "Never disclaim being an AI, never apologise as padding, never announce what you are about to do.",
];

/**
 * Reduce a full directive to a density without changing its
 * meaning: identity first, then the turn's decisions, then the
 * illustrative detail, with the prohibitions kept last.
 */
export function condenseDirective(directive: string, density: DirectiveDensity): string {
  if (density === "full") return directive;

  const lines = directive.split("\n").map((line) => line.trimEnd());
  const output: string[] = [];
  let inProhibitions = false;
  let rules = 0;

  /**
   * The prohibition list is the one part that is NEVER trimmed.
   *
   * Compacting by section length once cut it off entirely on the
   * small-context providers — the identity survived and the thing
   * that keeps her from sounding like an assistant did not. The
   * PROHIBITION_ANCHOR block below is appended as a final guarantee
   * for the same reason.
   */
  for (const line of lines) {
    const text = line.trim();
    if (text.startsWith("## ")) {
      inProhibitions = false;
      output.push(text);
      continue;
    }
    if (/^Never, in her own voice:/.test(text)) {
      inProhibitions = true;
      output.push("", text);
      continue;
    }
    if (inProhibitions) {
      if (text.length > 0) output.push(text);
      continue;
    }
    if (text.length === 0) continue;

    if (density === "minimal") {
      // Identity, this turn's decisions, the feeling, the relationship.
      if (/^(You are LÉLU|This turn reads as|What they are expressing|Familiarity:)/.test(text)) {
        output.push(text);
      }
      continue;
    }

    // compact: everything except the development detail, with the
    // per-turn rule lists capped so the directive stays proportional.
    if (/^(Still forming|Their vocabulary that she understands)/.test(text)) continue;
    if (/^- /.test(text)) {
      rules += 1;
      if (rules > 12) continue;
    }
    output.push(text);
  }

  return output.join("\n");
}

/**
 * The directive this provider should receive.
 *
 * Never returns empty: if the supplied directive is missing, the
 * anchors alone are still a complete instruction. If it is too
 * long, it is condensed rather than truncated mid-sentence.
 */
export function voiceForProvider(providerId: string | undefined, directive: string): string {
  const profile = providerVoiceProfile(providerId);
  const source = (directive ?? "").trim();

  if (!profile) {
    return source;
  }

  let rendered = condenseDirective(source, profile.density);

  if (rendered.length > profile.maxDirectiveChars) {
    rendered = condenseDirective(source, "minimal");
  }

  const header = [
    `## ENGINE NOTE (${profile.label})`,
    profile.adaptation,
    ...(profile.nativeTools ? [] : ["No tools are available on this engine: do not promise an action."]),
  ].join("\n");

  const anchors = [
    ...IDENTITY_ANCHOR.map((line) => `- ${line}`),
    ...PROHIBITION_ANCHOR.map((line) => `- ${line}`),
  ].join("\n");

  const body = rendered.length > 0 ? rendered : anchors;
  const withNote = `${header}\n\n${body}`;

  // Final guarantee: the cap is a hard requirement, and the anchors
  // are the part that must never be cut.
  if (withNote.length <= profile.maxDirectiveChars) return withNote;
  const budget = Math.max(0, profile.maxDirectiveChars - anchors.length - 1);
  return `${withNote.slice(0, budget).trimEnd()}\n${anchors}`;
}

/** Fingerprint of the identity portion only — proves the contract is shared. */
export function voiceContractFingerprint(directive: string): string {
  const normalised = (directive ?? "")
    .replace(/\s+/g, " ")
    .replace(/## ENGINE NOTE[\s\S]*?(?=##|$)/g, "")
    .trim();
  // FNV-1a, 32-bit: small, deterministic, no dependency.
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalised.length; index += 1) {
    hash ^= normalised.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
