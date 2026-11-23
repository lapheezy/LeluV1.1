/**
 * ==========================================================
 * LÉLU — STUDY CONCLUSION: pure judgement for self-study
 *
 * A study cycle used to close the moment a tool returned lines.
 * Research volume grew; conclusions did not. This file holds
 * the rules that make a study FINISH:
 *
 *   PURPOSE      what gap, why it matters, what evidence settles
 *                it, what it could improve — set before studying
 *   SUFFICIENCY  is there evidence that actually addresses it?
 *   CONCLUSION   learned · evidence · relevance · verdict ·
 *                change · benefit · risks · verification
 *   GROUNDING    a proposed change must name something real that
 *                the evidence touched, or it is not a proposal
 *   FINGERPRINT  the same evidence twice is not new learning
 *
 * Everything here is a pure function over plain data. There is
 * no store, provider, or clock. SelfStudyEngine owns the effects.
 * ==========================================================
 */

import type { StudyDomain, StudyOrigin } from "./StudyObjectives";

/** The five kinds of applied knowledge self-study maintains. */
export type KnowledgeCategory = "architecture" | "technical" | "cognitive" | "personality" | "operational";

/** What a finished study decided. */
export type ConclusionVerdict =
  /** Something in LÉLU should change; the conclusion says what. */
  | "change"
  /** Understood; nothing needs to change. A valid, complete outcome. */
  | "no-change"
  /** The evidence did not settle the question. Not a conclusion. */
  | "insufficient";

/** Why a study exists — recorded BEFORE any investigation runs. */
export interface StudyPurpose {
  gap: string;
  whyItMatters: string;
  sufficientEvidence: string;
  potentialImprovement: string;
}

export interface StudyConclusion {
  /** The real handle this is about: a path, subsystem id, capability id, or failure signature. */
  subject: string;
  category: KnowledgeCategory;
  verdict: ConclusionVerdict;
  /** What was learned, in one or two sentences. */
  learned: string;
  /** The evidence lines the conclusion rests on. */
  evidence: string[];
  /** How this applies to LÉLU's own architecture. */
  relevance: string;
  /** Present when verdict is "change". */
  change?: string;
  expectedBenefit?: string;
  risks?: string;
  verification?: string;
  /** "provider:<name>" when a model synthesized it, else "deterministic". */
  synthesizedBy: string;
  /** Identity of the evidence, so identical evidence is never re-concluded. */
  evidenceFingerprint: string;
  cycle: number;
  concludedAt: number;
  /** The ImprovementQueue proposal this conclusion produced, when one exists. */
  proposalId?: string;
  /** Why a "change" conclusion has no proposal yet (e.g. another awaits approval). */
  held?: string;
  /** Set when a proposed change was downgraded because it was not grounded. */
  note?: string;
}

/** Just the parts of an investigation these rules read. */
export interface EvidenceView {
  ok: boolean;
  tool: string;
  evidence: string[];
  summary: string;
}

/* ------------------------------------------------------------------ */
/* Purpose                                                             */
/* ------------------------------------------------------------------ */

/** The purpose of a study, derived from the reason it was raised. */
export function purposeFor(origin: StudyOrigin, domain: StudyDomain, target?: string): StudyPurpose {
  const subject = target ?? "this part of my system";
  const sufficient: Record<StudyDomain, string> = {
    source: `a successful read of ${subject} with its exports, imports and unfinished markers`,
    architecture: `the architecture map's record of ${subject}, including its files and status`,
    capability: `the capability registry entry and live manifest status for ${subject}`,
    runtime: "current provider, runtime and diagnostics status",
    testing: "a self-test run with its pass/fail results",
    memory: "a recall that returns the relevant memories",
    research: "external sources that address the question directly",
  };
  const gapByOrigin: Record<StudyOrigin, string> = {
    mission: `I cannot yet explain what ${subject} depends on.`,
    "knowledge-gap": `What I hold about ${subject} is unverified.`,
    "self-model": `My self-model marks ${subject} as unfinished or hypothetical.`,
    architecture: `I cannot describe ${subject} from evidence.`,
    discovery: `${subject} was touched by an earlier investigation and I have no record of it.`,
    contradiction: `Evidence shows a failure: ${subject}.`,
    unresolved: `An earlier study of ${subject} produced no usable evidence.`,
    revalidation: `My belief about ${subject} may have drifted from the code.`,
  };
  return {
    gap: gapByOrigin[origin],
    whyItMatters:
      origin === "contradiction" || origin === "unresolved"
        ? "A failure I do not understand is a failure I cannot fix or warn about."
        : "Knowledge I cannot rely on is knowledge I cannot act on.",
    sufficientEvidence: sufficient[domain],
    potentialImprovement:
      origin === "contradiction"
        ? `A fix for the failure in ${subject}.`
        : `A concrete change to ${subject} if the evidence shows it is incomplete or broken.`,
  };
}

/* ------------------------------------------------------------------ */
/* Relevance                                                           */
/* ------------------------------------------------------------------ */

/** A source-like path: no spaces, ends in a code extension. */
export function isSourcePath(candidate: string): boolean {
  return /^[\w@~.-]+(\/[\w@.-]+)+\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/.test(candidate.trim());
}

/**
 * May a lead become a study objective? Only when it names something real in
 * LÉLU: a source path, or an id the caller confirms (subsystem, capability,
 * diagnostics category). Titles of external papers and articles are research
 * results, not parts of her, and are never adopted as self-study subjects.
 */
export function isRelevantLead(
  lead: string,
  tool: string,
  knownId: (id: string) => boolean,
): boolean {
  const text = lead.trim();
  if (text.length < 2 || text.length > 120) return false;
  if (tool === "knowledge-providers") return false;
  if (isSourcePath(text)) return true;
  if (knownId(text)) return true;
  // A short identifier from an internal tool (e.g. a diagnostics category).
  return /^[a-z][\w.-]{1,40}$/i.test(text) && !/\s/.test(text);
}

/* ------------------------------------------------------------------ */
/* Category                                                            */
/* ------------------------------------------------------------------ */

export function categoryFor(domain: StudyDomain, subject: string): KnowledgeCategory {
  if (/identity|personality|trait|reflection|voice|avatar/i.test(subject)) return "personality";
  if (/cognit|reason|plan|curiosity|study|learn|objective|memory|brain/i.test(subject)) return "cognitive";
  if (domain === "runtime" || domain === "testing") return "operational";
  if (domain === "research") return "technical";
  return "architecture";
}

/* ------------------------------------------------------------------ */
/* Fingerprint                                                         */
/* ------------------------------------------------------------------ */

/**
 * The identity of a body of evidence. Volatile parts (timestamps, durations,
 * byte counts) are removed so the same facts read twice produce the same
 * fingerprint.
 */
export function evidenceFingerprint(evidence: string[]): string {
  const text = evidence
    .map((line) =>
      line
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "")
        .replace(/\b\d+(\.\d+)?\s*(ms|s|bytes?)\b/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("\n");
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(index), 16777619);
    h2 = Math.imul(h2 ^ text.charCodeAt(index), 2246822507);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Sufficiency                                                         */
/* ------------------------------------------------------------------ */

const FAILURE_ONLY = /\b(could not|cannot|unavailable|unreachable|failed to)\b/i;

/** Did the investigation produce evidence that can support a conclusion? */
export function isSufficient(investigation: EvidenceView): boolean {
  if (!investigation.ok || investigation.evidence.length === 0) return false;
  // Evidence made only of "could not read / unreachable" lines describes the
  // tool's failure, not the subject.
  return investigation.evidence.some((line) => !FAILURE_ONLY.test(line));
}

/* ------------------------------------------------------------------ */
/* Deterministic conclusion — always available, no model               */
/* ------------------------------------------------------------------ */

interface DeterministicInput {
  subject: string;
  domain: StudyDomain;
  question: string;
}

/**
 * The source reader reports any line mentioning TODO / FIXME / HACK /
 * "not implemented". Most such lines in this codebase are not unfinished
 * work: they are the regexes that detect markers, or honest user-facing
 * text ("Music generation is not implemented."). Only a marker written as
 * a code COMMENT counts as recorded unfinished work.
 */
export function realUnfinishedMarker(evidence: string[]): string | undefined {
  const line = evidence.find((item) => /^Unfinished markers \(\d+\):/.test(item));
  if (!line) return undefined;
  const pieces = line.replace(/^Unfinished markers \(\d+\):\s*/, "").split(" | ");
  const real = pieces.filter((piece) => /^\s*(\/\/|\/?\*+)\s*(TODO|FIXME|HACK)\b/.test(piece));
  return real.length > 0 ? `Unfinished markers (${real.length}): ${real.join(" | ")}` : undefined;
}

/**
 * A conclusion read directly off structured evidence. It proposes a change
 * only when the evidence itself states something unfinished or failing about
 * the subject: an unfinished marker in the file, a failing self-test, or a
 * diagnostics error. Everything else is "no-change": understood, recorded,
 * and nothing invented to act on.
 */
export function deterministicConclusion(
  input: DeterministicInput,
  investigation: EvidenceView,
): Omit<StudyConclusion, "subject" | "category" | "synthesizedBy" | "evidenceFingerprint" | "cycle" | "concludedAt"> {
  if (!isSufficient(investigation)) {
    return {
      verdict: "insufficient",
      learned: investigation.summary,
      evidence: investigation.evidence.slice(0, 4),
      relevance: `The question “${input.question}” is still open; the evidence did not address it.`,
    };
  }

  const unfinished = realUnfinishedMarker(investigation.evidence);
  const failingTest = investigation.evidence.find((line) => /^FAILING\s/.test(line));
  const diagnosticError = investigation.evidence.find((line) => /^ERROR\s/.test(line));
  const finding = failingTest ?? diagnosticError ?? unfinished;

  if (finding && (input.domain === "source" || input.domain === "testing" || input.domain === "runtime")) {
    const where = isSourcePath(input.subject) ? input.subject : `the ${input.subject} area`;
    return {
      verdict: "change",
      learned: `${investigation.summary} The evidence records unfinished or failing work: ${finding.slice(0, 220)}`,
      evidence: [finding, ...investigation.evidence.filter((line) => line !== finding).slice(0, 3)],
      relevance: `${where} is part of my own running system, so this affects what I can actually do.`,
      change: `Resolve the recorded issue in ${where}: ${finding.replace(/^(FAILING|ERROR)\s+/, "").slice(0, 180)}`,
      expectedBenefit: `${where} no longer carries this unfinished or failing work, and its behaviour can be verified.`,
      risks: "Touching code that other systems import; the change must keep their existing tests passing.",
      verification: failingTest
        ? "The named self-test passes, and the full test suite shows no regressions."
        : diagnosticError
          ? "Self-diagnostics no longer report this error, and the full test suite shows no regressions."
          : `A fresh read of ${where} no longer shows this marker, and the tests covering it pass.`,
    };
  }

  return {
    verdict: "no-change",
    learned: `${investigation.summary} ${investigation.evidence.slice(0, 3).join(" ")}`.slice(0, 600),
    evidence: investigation.evidence.slice(0, 4),
    relevance: "Recorded so later work starts from this rather than re-reading it. Nothing in the evidence calls for a change.",
  };
}

/* ------------------------------------------------------------------ */
/* Model synthesis — the one place a provider is worth calling          */
/* ------------------------------------------------------------------ */

export function synthesisPrompt(
  question: string,
  purpose: StudyPurpose,
  subject: string,
  investigation: EvidenceView,
  memory: string[],
): string {
  return [
    `QUESTION: ${question}`,
    `SUBJECT: ${subject}`,
    `GAP: ${purpose.gap}`,
    `WHY IT MATTERS: ${purpose.whyItMatters}`,
    `WHAT WOULD SETTLE IT: ${purpose.sufficientEvidence}`,
    "",
    `EVIDENCE (${investigation.tool}):`,
    ...investigation.evidence.slice(0, 12).map((line) => `- ${line}`),
    "",
    memory.length > 0 ? `ALREADY KNOWN:\n${memory.slice(0, 3).map((line) => `- ${line.slice(0, 200)}`).join("\n")}` : "Nothing relevant was already known.",
    "",
    "Conclude this study. Use ONLY the evidence above. Reply with these labelled lines:",
    "LEARNED: what the evidence establishes (1-2 sentences).",
    "RELEVANCE: how this applies to my own architecture.",
    "VERDICT: change | no-change | insufficient",
    "CHANGE: (only if VERDICT is change) the specific change, naming the file, subsystem or capability from the evidence.",
    "BENEFIT: (only if change) what would measurably improve.",
    "RISKS: (only if change) what could break.",
    "VERIFY: (only if change) how to prove it worked.",
    "NEXT: the single most important open question, or none.",
  ].join("\n");
}

export interface ParsedConclusion {
  learned?: string;
  relevance?: string;
  verdict?: ConclusionVerdict;
  change?: string;
  benefit?: string;
  risks?: string;
  verify?: string;
  next?: string;
}

export function parseConclusion(text: string): ParsedConclusion {
  const field = (label: string): string | undefined => {
    const match = text.match(new RegExp(`^\\s*\\**${label}\\**\\s*:\\s*(.+)$`, "im"));
    const value = match?.[1]?.trim();
    return value && !/^(n\/a|none|-)$/i.test(value) ? value : undefined;
  };
  const verdictText = field("VERDICT")?.toLowerCase() ?? "";
  const verdict: ConclusionVerdict | undefined = /no[\s-]?change/.test(verdictText)
    ? "no-change"
    : /insufficient/.test(verdictText)
      ? "insufficient"
      : /change/.test(verdictText)
        ? "change"
        : undefined;
  return {
    learned: field("LEARNED"),
    relevance: field("RELEVANCE"),
    verdict,
    change: field("CHANGE"),
    benefit: field("BENEFIT"),
    risks: field("RISKS"),
    verify: field("VERIFY"),
    next: field("NEXT"),
  };
}

/**
 * Is a proposed change grounded? It has to name the subject, or a real path
 * or identifier that appears in the evidence. A change that names nothing the
 * study actually touched is an idea, not a proposal.
 */
export function isGroundedChange(change: string, subject: string, evidence: string[]): boolean {
  const lowered = change.toLowerCase();
  const base = subject.split("/").pop()?.replace(/\.[a-z]+$/, "").toLowerCase() ?? "";
  if (subject && lowered.includes(subject.toLowerCase())) return true;
  if (base.length > 3 && lowered.includes(base)) return true;
  // A name the evidence quotes (e.g. a capability “Video projects”).
  const quoted = [...evidence.join(" ").matchAll(/[“"]([^”"]{3,60})[”"]/g)].map((match) => match[1].toLowerCase());
  if (quoted.some((name) => lowered.includes(name))) return true;
  const handles = evidence.join(" ").match(/[\w@~.-]+\/[\w@./-]+\.(?:ts|tsx|js|mjs)|\b[a-z][\w-]+\.[a-z][\w.-]+\b/gi) ?? [];
  return handles.some((handle) => lowered.includes(handle.toLowerCase()));
}
