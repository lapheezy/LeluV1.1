/**
 * ==========================================================
 * LÉLU — KNOWLEDGE INGESTION
 *
 * "Read this." — and LÉLU works out what it is, retrieves it,
 * understands it, and keeps the part worth keeping (brief §7).
 *
 * The pipeline §8 asks for:
 *
 *   SOURCE → detect → retrieve → extract → analyse
 *          → identify knowledge → map relationships
 *          → memory candidates → dedupe/merge/confidence
 *          → consolidate → available to LÉLU
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * Reading is not storing. An 8,000-message conversation must
 * not become 8,000 memories — that is precisely how the OG
 * build buried itself. So extraction is bounded at both ends:
 * the source is sampled down to a readable window before the
 * model ever sees it, and the model is asked for a small number
 * of durable facts, capped again on the way out. A larger
 * source yields better-chosen memories, never more of them.
 *
 * What counts as durable is deliberately narrow — decisions,
 * facts, discoveries, project state, preferences, open
 * questions, instructions. Not "the user said hello".
 *
 * Attribution travels with every candidate so LÉLU can say how
 * she knows something, which §8 asks for and which is also the
 * only way a wrong memory can later be traced to its source.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not write to memory. It produces candidates and hands
 * them to MemoryOrchestrator, whose providers dedupe and merge
 * through the machinery that already exists (MemoryEngine's
 * findExisting → reinforce / supersede / merge). Writing here
 * would be the second memory system §4 forbids.
 * ==========================================================
 */

import BrowserTool from "../browser/BrowserTool";
import { youtubeTranscript } from "../../og/lib/research.functions";
import { BUDGET_LIMITS } from "./CognitiveBudget";
import type { MemoryCandidate } from "./MemoryProvider";

export type SourceKind =
  | "url"
  | "youtube"
  | "chatgpt-share"
  | "conversation"
  | "note"
  | "file"
  | "unknown";

export interface DetectedSource {
  kind: SourceKind;
  /** The URL to retrieve, when the source is remote. */
  url?: string;
  /** Inline text, when the source arrived as content rather than a link. */
  text?: string;
  /** Human-readable provenance, carried onto every candidate. */
  attribution: string;
}

export interface IngestionResult {
  source: DetectedSource;
  candidates: MemoryCandidate[];
  /** What happened, for UI that must report real work only (§12). */
  stats: {
    retrieved: boolean;
    sourceChars: number;
    analysedChars: number;
    candidatesProduced: number;
    truncated: boolean;
  };
  error?: string;
}

/** How much of a source is put in front of the model. */
const ANALYSIS_WINDOW_CHARS = 12_000;
/** Hard ceiling on memories from one source, however large it is. */
const MAX_CANDIDATES = 12;

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/i;

/**
 * Work out what the user just handed over.
 *
 * Ordering matters: the specific link shapes are checked before the general
 * URL case, because a YouTube link and a ChatGPT share link need different
 * retrieval even though both are URLs.
 */
export function detectSource(input: string): DetectedSource {
  const trimmed = input.trim();
  const match = trimmed.match(URL_PATTERN);

  if (match) {
    const url = match[0];
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();

    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) {
      return { kind: "youtube", url, attribution: `YouTube · ${url}` };
    }
    if (/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(host)) {
      return { kind: "chatgpt-share", url, attribution: `ChatGPT conversation · ${url}` };
    }
    return { kind: "url", url, attribution: host ? `${host} · ${url}` : url };
  }

  // A pasted conversation: many turns, recognisable speaker labels.
  const speakerTurns = (trimmed.match(/^\s*(user|assistant|me|you|lélu|lelu)\s*[:>]/gim) ?? []).length;
  if (speakerTurns >= 4) {
    return { kind: "conversation", text: trimmed, attribution: "a pasted conversation" };
  }

  if (trimmed.length > 0) {
    return { kind: "note", text: trimmed, attribution: "a note from you" };
  }

  return { kind: "unknown", attribution: "an empty source" };
}

/**
 * Reduce a source to something a model can read in one pass.
 *
 * Head and tail rather than head alone: conversations and documents put their
 * conclusions at the end, and truncating forward would systematically discard
 * the decisions that are the most worth remembering.
 */
export function windowSource(text: string, limit = ANALYSIS_WINDOW_CHARS): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= limit) return { text, truncated: false };
  const half = Math.floor(limit / 2);
  return {
    text: `${text.slice(0, half)}\n\n[… ${text.length - limit} characters omitted …]\n\n${text.slice(-half)}`,
    truncated: true,
  };
}

/** The instruction that turns a source into a short list of durable facts. */
export function extractionPrompt(source: DetectedSource, body: string): string {
  return [
    `Read the following ${source.kind === "unknown" ? "material" : source.kind.replace("-", " ")} and extract only what is worth remembering long-term.`,
    "",
    "Keep: decisions, facts, discoveries, project state, stated preferences,",
    "unresolved questions, concepts, relationships, and explicit instructions.",
    "Discard: pleasantries, restatements, and anything true only in the moment.",
    "",
    `Return at most ${MAX_CANDIDATES} items, one per line, each a single self-contained sentence.`,
    "If nothing is worth keeping, return the single line: NOTHING",
    "",
    "--- SOURCE ---",
    body,
  ].join("\n");
}

/**
 * Turn a model's extraction into candidates.
 *
 * Capped, deduplicated by normalized text, and stamped with attribution. The
 * cap is the load-bearing part: it is what makes an enormous source produce
 * better memories rather than more of them.
 */
export function toCandidates(
  raw: string,
  source: DetectedSource,
  limit = MAX_CANDIDATES,
): MemoryCandidate[] {
  const seen = new Set<string>();
  const candidates: MemoryCandidate[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/^\s*[-*\d.)\]]+\s*/, "").trim();
    if (cleaned.length < 12) continue;
    if (/^nothing$/i.test(cleaned)) continue;

    const key = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      prompt: `What did I learn from ${source.attribution}?`,
      response: cleaned,
      category: "ingested",
      attribution: source.attribution,
      metadata: {
        ingestedFrom: source.attribution,
        sourceKind: source.kind,
        ...(source.url ? { sourceUrl: source.url } : {}),
      },
    });

    if (candidates.length >= limit) break;
  }

  return candidates;
}

/** How the pipeline reaches a model; injected so it can be tested offline. */
export type Analyst = (prompt: string) => Promise<string>;

/**
 * Run the pipeline end to end.
 *
 * Retrieval failures are returned, not thrown: "I could not read that" is
 * information the user needs, and an exception here would take down whichever
 * surface asked.
 */
export async function ingest(
  input: string,
  analyse: Analyst,
  options: { maxCandidates?: number } = {},
): Promise<IngestionResult> {
  const source = detectSource(input);
  const limit = Math.min(options.maxCandidates ?? MAX_CANDIDATES, BUDGET_LIMITS.memoryWrites);

  const empty: IngestionResult["stats"] = {
    retrieved: false,
    sourceChars: 0,
    analysedChars: 0,
    candidatesProduced: 0,
    truncated: false,
  };

  if (source.kind === "unknown") {
    return { source, candidates: [], stats: empty, error: "There was nothing to read." };
  }

  // RETRIEVE
  let body = source.text ?? "";

  // A video is not a page. Fetching a YouTube watch URL returns the player
  // shell, whose readable text is navigation chrome — LÉLU would "read" the
  // video and learn nothing from it. The captions are the content.
  if (source.kind === "youtube" && source.url) {
    const transcript = await youtubeTranscript(source.url);
    if (!transcript.ok) {
      return { source, candidates: [], stats: { ...empty, retrieved: false }, error: transcript.error };
    }
    body = transcript.text;
  } else if (source.url) {
    const page = await BrowserTool.visit(source.url);
    if (page.status !== "read" || !page.text) {
      return {
        source,
        candidates: [],
        stats: { ...empty, retrieved: false },
        error:
          page.error ??
          (page.status === "blocked"
            ? "That page refuses to be read directly."
            : "That source could not be retrieved."),
      };
    }
    body = page.text;
  }

  if (body.trim().length === 0) {
    return { source, candidates: [], stats: empty, error: "That source was empty." };
  }

  // EXTRACT + ANALYSE — bounded before the model, bounded again after.
  const windowed = windowSource(body);
  let extracted = "";
  try {
    extracted = await analyse(extractionPrompt(source, windowed.text));
  } catch (error) {
    return {
      source,
      candidates: [],
      stats: {
        retrieved: true,
        sourceChars: body.length,
        analysedChars: windowed.text.length,
        candidatesProduced: 0,
        truncated: windowed.truncated,
      },
      error: error instanceof Error ? error.message : "That source could not be understood.",
    };
  }

  const candidates = toCandidates(extracted, source, limit);

  return {
    source,
    candidates,
    stats: {
      retrieved: true,
      sourceChars: body.length,
      analysedChars: windowed.text.length,
      candidatesProduced: candidates.length,
      truncated: windowed.truncated,
    },
  };
}
