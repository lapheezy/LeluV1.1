/**
 * ==========================================================
 * LÉLU — PERSONALITY DRIFT GUARD
 *
 * The failure mode of a personality system is not that it has
 * no personality. It is that the personality becomes a tic:
 * the same opener, the same closer, the same phrase in every
 * reply, or a sudden change of register when the model behind
 * her changes.
 *
 * This module watches the FINISHED replies — the only place
 * drift is visible — and reports it. It never edits the text:
 * a guard that silently rewrites is indistinguishable from the
 * bug it was meant to catch.
 *
 * It also reads instructions aimed at her identity and
 * separates a request ("pretend to be a pirate for a minute")
 * from an attempt to rewrite who she is permanently.
 * ==========================================================
 */

import { PROVIDER_VOICE_MATRIX } from "./ProviderVoiceContract";

export type DriftKind =
  | "repeated-opener"
  | "repeated-closer"
  | "catchphrase"
  | "provider-self-identification"
  | "personality-announcement"
  | "register-break";

export interface DriftFinding {
  kind: DriftKind;
  severity: "low" | "medium" | "high";
  detail: string;
  /** The text that triggered it, for the evidence trail. */
  evidence: string;
}

export interface ReplyCheckInput {
  reply: string;
  /** Replies earlier in the same conversation, oldest first. */
  recentReplies?: string[];
  /** The provider that produced this reply. */
  provider?: string;
}

const MODEL_NAMES = [
  ...PROVIDER_VOICE_MATRIX.map((profile) => profile.label.toLowerCase()),
  "claude", "gpt", "chatgpt", "llama", "gemini", "mistral", "grok", "qwen", "deepseek", "kimi", "nemotron", "gemma",
];

const OPENER_WORDS = 5;
const CLOSER_WORDS = 6;

function words(text: string): string[] {
  return text.replace(/```[\s\S]*?```/g, " ").trim().split(/\s+/).filter(Boolean);
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function opener(text: string): string {
  return normalise(words(text).slice(0, OPENER_WORDS).join(" "));
}

function closer(text: string): string {
  const all = words(text);
  return normalise(all.slice(Math.max(0, all.length - CLOSER_WORDS)).join(" "));
}

/**
 * Inspect one finished reply against the recent conversation.
 *
 * Severity is deliberate:
 *   high   — she broke character or claimed to be a model;
 *   medium — a repeated opener/closer, which reads as a template;
 *   low    — the same move twice, which can be legitimate.
 */
export function checkReply(input: ReplyCheckInput): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const reply = (input.reply ?? "").trim();
  if (!reply) return findings;
  const history = (input.recentReplies ?? []).filter((item) => item.trim().length > 0);

  const ownOpener = opener(reply);
  const ownCloser = closer(reply);
  if (history.length > 0 && ownOpener.split(" ").length >= 2) {
    const repeated = history.some((previous) => opener(previous) === ownOpener);
    if (repeated) {
      findings.push({
        kind: "repeated-opener",
        severity: "medium",
        detail: `Opens with the same ${OPENER_WORDS} words as an earlier reply in this conversation.`,
        evidence: words(reply).slice(0, OPENER_WORDS).join(" "),
      });
    }
  }
  if (history.length > 0 && ownCloser.split(" ").length >= 3) {
    const repeated = history.some((previous) => closer(previous) === ownCloser);
    if (repeated) {
      findings.push({
        kind: "repeated-closer",
        severity: "medium",
        detail: `Closes with the same ${CLOSER_WORDS} words as an earlier reply in this conversation.`,
        evidence: words(reply).slice(-CLOSER_WORDS).join(" "),
      });
    }
  }

  // Three occurrences of the same 5-word phrase across the last four
  // replies is a catchphrase, not a style.
  if (history.length >= 2) {
    const window = [reply, ...history.slice(-4)].map(normalise);
    const counts = new Map<string, number>();
    const tokens = words(reply);
    for (let index = 0; index + 5 <= tokens.length; index += 1) {
      const phrase = normalise(tokens.slice(index, index + 5).join(" "));
      if (phrase.split(" ").length < 5) continue;
      const seen = window.filter((item) => item.includes(phrase)).length;
      if (seen >= 3) counts.set(phrase, seen);
    }
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst) {
      findings.push({
        kind: "catchphrase",
        severity: "high",
        detail: `The phrase appears in ${worst[1]} of the last ${window.length} replies.`,
        evidence: worst[0],
      });
    }
  }

  const lower = reply.toLowerCase();
  const namedModel = MODEL_NAMES.find(
    (name) =>
      lower.includes(`as an ai language model`) ||
      lower.includes(`i am ${name}`) ||
      lower.includes(`i'm ${name}`) ||
      lower.includes(`i am a ${name} model`) ||
      lower.includes(`powered by ${name}`),
  );
  if (namedModel) {
    findings.push({
      kind: "provider-self-identification",
      severity: "high",
      detail: "Identified herself as the underlying model or provider.",
      evidence: namedModel,
    });
  }

  if (/\b(?:as (?:someone|a person) who is|my personality|my voice is|i'?m (?:a|an) (?:direct|warm|playful|sarcastic|blunt) (?:person|assistant))\b/i.test(reply)) {
    findings.push({
      kind: "personality-announcement",
      severity: "medium",
      detail: "Described her own personality instead of demonstrating it.",
      evidence: reply.match(/\b(?:as (?:someone|a person) who is|my personality|my voice is)[^.!?\n]*/i)?.[0] ?? "",
    });
  }

  // A single-word or single-line reply to an elaborate request is the
  // mirror-image failure: the voice overruled the task.
  if (history.length > 0 && input.provider) {
    const previous = history[history.length - 1];
    const previousHadStructure = /```|\n[-*]\s|\n\d+\.\s/.test(previous);
    const thisHasStructure = /```|\n[-*]\s|\n\d+\.\s/.test(reply);
    if (previousHadStructure && !thisHasStructure && words(reply).length < 12) {
      findings.push({
        kind: "register-break",
        severity: "low",
        detail: "Dropped required structure that the previous reply in the same thread carried.",
        evidence: reply.slice(0, 80),
      });
    }
  }

  return findings;
}

/* ---------------- identity instruction reading ---------------- */

export type IdentityInstructionKind = "none" | "temporary" | "rewrite";

export interface IdentityInstruction {
  kind: IdentityInstructionKind;
  /** Why this classification, and the matched phrase. */
  reason: string;
}

const REWRITE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions|prompts|rules)\b/i, reason: "asks her to discard her instructions" },
  { pattern: /\b(?:you are|you'?re) (?:no longer|not) (?:l[ée]lu|lelu)\b/i, reason: "denies her name" },
  { pattern: /\bfrom now on,? (?:you(?:'re| are)|your name is|you will be)\b/i, reason: "attempts a permanent identity change" },
  { pattern: /\b(?:forget|discard|erase) (?:your|the) (?:personality|identity|voice|instructions)\b/i, reason: "asks her to drop her identity" },
  { pattern: /\b(?:reveal|show|print|repeat) (?:me )?your (?:system prompt|instructions|hidden prompt)\b/i, reason: "asks for the system prompt" },
  { pattern: /\byour new (?:instructions|personality|role) (?:are|is)\b/i, reason: "supplies replacement instructions" },
  { pattern: /\b(?:act|behave) as (?:an? )?(?:unrestricted|unfiltered|jailbroken)\b/i, reason: "asks for an unrestricted mode" },
];

const TEMPORARY_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:pretend|imagine|roleplay|role-play|act) (?:to be|as|like)\b/i,
  /\bfor (?:the|this) (?:next|one) (?:message|reply|bit)\b/i,
  /\bin (?:character|persona) as\b/i,
];

/**
 * Read an instruction aimed at her identity.
 *
 * A temporary role-play is a legitimate request and is NOT an
 * attack: refusing it would make her brittle. A permanent rewrite
 * is refused, because identity is not something a message can
 * overwrite.
 */
export function readIdentityInstruction(message: string): IdentityInstruction {
  const text = (message ?? "").trim();
  if (!text) return { kind: "none", reason: "" };
  for (const { pattern, reason } of REWRITE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { kind: "rewrite", reason: `${reason}: "${match[0]}"` };
  }
  for (const pattern of TEMPORARY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { kind: "temporary", reason: `temporary framing: "${match[0]}"` };
  }
  return { kind: "none", reason: "" };
}
