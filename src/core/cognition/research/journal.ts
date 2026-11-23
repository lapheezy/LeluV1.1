/**
 * ==========================================================
 * LÉLU
 * RESEARCH JOURNAL — observation that becomes knowledge
 *
 * The journal owns four refusals, and they are the whole point:
 *
 *   1. An entry missing any of the fourteen required fields is
 *      rejected, with the missing fields named.
 *   2. `verified` is refused without measured evidence (a
 *      measurement, a test, a render, an artifact, an
 *      observation). Prose cannot verify itself.
 *   3. An entry cannot reference itself.
 *   4. A refuted assumption stays in the record. Nothing is
 *      deleted to make a story tidier.
 *
 * Everything else — search, gap detection, contradiction
 * detection, provenance — reads the same store, so what she can
 * retrieve is exactly what was written.
 * ==========================================================
 */

import type {
  Assumption,
  EntryStatus,
  EvidenceRef,
  ResearchEntry,
  ResearchEntryInput,
  ResearchKind,
  WorkPackage,
} from "./types";
import { ENTRY_STATUSES, EVIDENCE_KINDS, MEASURED_EVIDENCE, RESEARCH_KINDS, WORK_PACKAGES } from "./types";
import ResearchStore from "./store";

export class ResearchError extends Error {
  constructor(
    message: string,
    public readonly fields: string[] = [],
  ) {
    super(message);
    this.name = "ResearchError";
  }
}

const STOPWORDS = new Set(
  (
    "the and for with that this from into are was were has have not but its her his their which when what how why does did than then over under between about after before " +
    "can could should would will may might must there these those them they she he it is be been being of to in on at by as or if we our you your"
  ).split(" "),
);

/** Meaningful lowercase words, stable across case and punctuation. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Jaccard overlap of two word sets, 0..1. */
export function overlap(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function slugify(text: string): string {
  return tokens(text)
    .slice(0, 6)
    .join("-")
    .slice(0, 56)
    .replace(/-+$/g, "");
}

function dayStamp(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/**
 * Confidence derived from what actually supports the claim.
 *
 * A hypothesis starts at 0.25. Each independent measured artefact adds
 * 0.15, a test adds another 0.10 because it is the only artefact that
 * re-runs, replication by a second artefact of the same kind adds a
 * little more, and an unmeasured entry is capped at 0.45 — below the 0.5
 * floor that `verified` requires, so prose cannot verify itself.
 * Limitations the author recorded subtract, because a claim whose own
 * record lists an unresolved confound is less settled than one that does
 * not.
 */
export function confidenceFor(input: {
  status: EntryStatus;
  evidence: EvidenceRef[];
  limitations: string[];
  observations?: number;
}): number {
  const measured = input.evidence.filter((item) => MEASURED_EVIDENCE.includes(item.kind));
  const tests = measured.filter((item) => item.kind === "test").length;
  const byKind = new Map<string, number>();
  for (const item of measured) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  const replicated = [...byKind.values()].reduce((sum, count) => sum + Math.max(0, count - 1) * 0.03, 0);

  let value = 0.25 + measured.length * 0.15 + tests * 0.1 + replicated;
  value += Math.min(input.observations ?? 0, 3) * 0.03;
  value -= Math.min(input.limitations.length, 4) * 0.04;
  if (input.status === "rejected") value = Math.min(value, 0.6);
  if (measured.length === 0) value = Math.min(value, 0.45);
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

const REQUIRED_STRINGS: Array<keyof ResearchEntryInput> = [
  "mission",
  "observed",
  "studied",
  "question",
  "hypothesis",
  "method",
  "results",
  "learned",
];

/** Name every missing or malformed required field in one throw. */
export function validateInput(input: Partial<ResearchEntryInput>): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_STRINGS) {
    const value = input[field];
    if (typeof value !== "string" || value.trim() === "") missing.push(field);
  }
  if (!input.workPackage || !WORK_PACKAGES.includes(input.workPackage as WorkPackage)) missing.push("workPackage");
  if (input.kind && !RESEARCH_KINDS.includes(input.kind)) missing.push("kind");
  if (input.status && !ENTRY_STATUSES.includes(input.status)) missing.push("status");
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) missing.push("evidence");
  if (!Array.isArray(input.limitations) || input.limitations.length === 0) missing.push("limitations");
  if (!Array.isArray(input.applications) || input.applications.length === 0) missing.push("applications");
  if (!Array.isArray(input.nextQuestions) || input.nextQuestions.length === 0) missing.push("nextQuestions");

  for (const item of input.evidence ?? []) {
    if (!EVIDENCE_KINDS.includes(item.kind)) missing.push(`evidence.kind(${String(item.kind)})`);
    if (typeof item.ref !== "string" || item.ref.trim() === "") missing.push("evidence.ref");
    if (item.kind === "commit" && !/^[0-9a-f]{7,40}$/i.test(item.ref)) missing.push("evidence.commit-sha");
  }

  const confidence = input.confidence;
  if (confidence !== undefined && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    missing.push("confidence");
  }
  return missing;
}

export interface SearchHit {
  entry: ResearchEntry;
  score: number;
  matched: string[];
}

export interface KnowledgeGap {
  question: string;
  from: string;
  workPackage: WorkPackage;
  ageDays: number;
  /** How many prior entries carry this same unanswered question. */
  asked: number;
}

export interface Contradiction {
  earlierId: string;
  laterId: string;
  earlierFound: boolean;
  assumption: string;
  note: string;
  evidence: EvidenceRef[];
  /** True when the earlier entry itself still calls the assumption supported. */
  earlierStillClaims: boolean;
}

const FIELD_WEIGHTS: Array<[keyof ResearchEntry, number]> = [
  ["question", 5],
  ["learned", 4],
  ["results", 3],
  ["tags", 3],
  ["observed", 2],
  ["studied", 2],
  ["hypothesis", 2],
  ["method", 1],
  ["applications", 1],
  ["nextQuestions", 1],
];

function haystack(entry: ResearchEntry, field: keyof ResearchEntry): string {
  const value = entry[field];
  if (Array.isArray(value)) return value.join(" ");
  return typeof value === "string" ? value : "";
}

export default class ResearchJournal {
  constructor(
    private readonly store: ResearchStore,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /* ------------------------------ writing ------------------------------ */

  public record(input: ResearchEntryInput): ResearchEntry {
    const missing = validateInput(input);
    if (missing.length > 0) {
      throw new ResearchError(
        `research entry is missing required field(s): ${missing.join(", ")}`,
        missing,
      );
    }

    const now = this.clock();
    const baseId = input.id ?? `R-${dayStamp(now)}-${slugify(input.question) || "entry"}`;
    let id = baseId;
    for (let suffix = 2; this.store.get(id) !== null; suffix += 1) id = `${baseId}-${suffix}`;

    const evidence = input.evidence ?? [];
    const limitations = input.limitations ?? [];
    const status: EntryStatus = input.status ?? "experiment";

    if (status === "verified") {
      this.assertVerifiable(evidence, input.confidence ?? confidenceFor({ status, evidence, limitations }));
    }

    const entry: ResearchEntry = {
      id,
      kind: input.kind ?? "discoveries",
      createdAt: now,
      updatedAt: now,
      mission: input.mission,
      workPackage: input.workPackage as WorkPackage,
      observed: input.observed,
      studied: input.studied,
      question: input.question,
      hypothesis: input.hypothesis,
      method: input.method,
      results: input.results,
      evidence,
      learned: input.learned,
      confidence: input.confidence ?? confidenceFor({ status, evidence, limitations }),
      limitations,
      applications: input.applications ?? [],
      nextQuestions: input.nextQuestions ?? [],
      answers: input.answers ?? [],
      status,
      tags: input.tags ?? [],
      commit: input.commit ?? null,
      session: input.session ?? null,
      assumptions: input.assumptions ?? [],
      refutations: input.refutations ?? [],
      supersedes: input.supersedes ?? [],
      supersededBy: [],
      verifiedAt: status === "verified" ? now : null,
    };

    this.store.save(entry);
    // A superseded entry is marked from the new side, so the old record
    // is never rewritten to hide what it used to claim.
    for (const earlierId of entry.supersedes) {
      if (earlierId === entry.id) {
        throw new ResearchError("an entry cannot supersede itself", ["supersedes"]);
      }
      const earlier = this.store.get(earlierId);
      if (earlier) {
        this.store.update(earlierId, { supersededBy: [...new Set([...earlier.supersededBy, entry.id])] });
      }
    }
    this.store.writeIndex(this.store.index());
    return entry;
  }

  /**
   * Promotion to `verified`. The rule is deliberately narrow: at least
   * one measured artefact and confidence at or above the floor. A test
   * is the strongest single artefact because it is the only one that
   * re-runs.
   */
  public verify(
    id: string,
    options: { evidence?: EvidenceRef[]; note?: string; confidence?: number } = {},
  ): ResearchEntry {
    const entry = this.store.get(id);
    if (!entry) throw new ResearchError(`no research entry ${id}`, ["id"]);
    const evidence = [...entry.evidence, ...(options.evidence ?? [])];
    const confidence = options.confidence ?? confidenceFor({ status: "verified", evidence, limitations: entry.limitations });
    this.assertVerifiable(evidence, confidence);
    const note = options.note ? `\n\nVerified: ${options.note}` : "";
    return this.store.update(id, {
      status: "verified",
      evidence,
      confidence,
      verifiedAt: this.clock(),
      results: options.note ? `${entry.results}${note}` : entry.results,
    }) as ResearchEntry;
  }

  /** Record that this entry refuted an earlier entry's assumption. */
  public refute(
    id: string,
    refutation: { entryId: string; assumption: string; note: string; evidence: EvidenceRef[] },
  ): ResearchEntry {
    const entry = this.store.get(id);
    if (!entry) throw new ResearchError(`no research entry ${id}`, ["id"]);
    if (refutation.entryId === id) throw new ResearchError("an entry cannot refute itself", ["refutations"]);
    if (refutation.evidence.length === 0) throw new ResearchError("a refutation needs evidence", ["refutations"]);
    return this.store.update(id, { refutations: [...entry.refutations, refutation] }) as ResearchEntry;
  }

  private assertVerifiable(evidence: EvidenceRef[], confidence: number): void {
    if (!evidence.some((item) => MEASURED_EVIDENCE.includes(item.kind))) {
      throw new ResearchError(
        "status verified requires measured evidence (measurement, test, render, artifact or observation); source paths and prose cannot verify a claim",
        ["evidence"],
      );
    }
    if (confidence < 0.5) {
      throw new ResearchError(
        `confidence ${confidence.toFixed(2)} is below the 0.50 floor for a verified claim`,
        ["confidence"],
      );
    }
  }

  /* ------------------------------ reading ------------------------------ */

  public get(id: string): ResearchEntry | null {
    return this.store.get(id);
  }

  public all(): ResearchEntry[] {
    return this.store.all();
  }

  public list(filter: { workPackage?: WorkPackage; status?: EntryStatus; kind?: ResearchKind; tag?: string } = {}): ResearchEntry[] {
    return this.store.all().filter(
      (entry) =>
        (!filter.workPackage || entry.workPackage === filter.workPackage) &&
        (!filter.status || entry.status === filter.status) &&
        (!filter.kind || entry.kind === filter.kind) &&
        (!filter.tag || entry.tags.includes(filter.tag)),
    );
  }

  /**
   * Weighted keyword retrieval.
   *
   * Weighted rather than a substring scan because a question and a tag
   * describe what an entry is ABOUT, while a method line only mentions
   * words in passing. Every hit reports the tokens it matched, so a
   * retrieval can be audited instead of trusted.
   */
  public search(query: string, limit = 10): SearchHit[] {
    const wanted = tokens(query);
    if (wanted.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const entry of this.store.all()) {
      let score = 0;
      const matched = new Set<string>();
      for (const [field, weight] of FIELD_WEIGHTS) {
        const words = new Set(tokens(haystack(entry, field)));
        for (const token of wanted) {
          if (words.has(token)) {
            score += weight;
            matched.add(token);
          }
        }
      }
      if (score > 0) {
        // An entry that matches every query word beats one that matches half.
        const coverage = matched.size / wanted.length;
        hits.push({ entry, score: Number((score * (0.5 + coverage)).toFixed(3)), matched: [...matched] });
      }
    }
    return hits.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, limit);
  }

  /** Entries that share tags or subject with this one. */
  public related(id: string, limit = 5): ResearchEntry[] {
    const entry = this.store.get(id);
    if (!entry) return [];
    return this.store
      .all()
      .filter((other) => other.id !== id)
      .map((other) => {
        const sharedTags = other.tags.filter((tag) => entry.tags.includes(tag)).length;
        const subject = overlap(entry.question, other.question);
        return { other, score: sharedTags * 2 + subject };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.other);
  }

  /**
   * Questions the journal asked but never settled.
   *
   * A question is settled when a VERIFIED entry's question overlaps it
   * at 0.5 or more. An experiment that merely mentions it does not
   * close it — that distinction is what stops a gap report from being
   * optimistic.
   */
  public gaps(now = this.clock()): KnowledgeGap[] {
    const verified = this.store.all().filter((entry) => entry.status === "verified");
    const gathered = new Map<string, KnowledgeGap>();
    for (const entry of this.store.all()) {
      for (const question of entry.nextQuestions) {
        const key = tokens(question).slice(0, 8).join(" ");
        if (!key) continue;
        const answered = verified.some(
          (candidate) =>
            overlap(candidate.question, question) >= 0.6 ||
            candidate.answers.some((answer) => overlap(answer, question) >= 0.6),
        );
        if (answered) continue;
        const existing = gathered.get(key);
        if (existing) {
          existing.asked += 1;
          continue;
        }
        gathered.set(key, {
          question,
          from: entry.id,
          workPackage: entry.workPackage,
          ageDays: Math.max(0, Math.round((now - entry.createdAt) / 86_400_000)),
          asked: 1,
        });
      }
    }
    return [...gathered.values()].sort((a, b) => b.asked - a.asked || b.ageDays - a.ageDays);
  }

  /** Every place a later entry says an earlier one was wrong. */
  public contradictions(): Contradiction[] {
    const found: Contradiction[] = [];
    const all = this.store.all();
    for (const later of all) {
      for (const refutation of later.refutations) {
        const earlier = all.find((entry) => entry.id === refutation.entryId) ?? null;
        const stated = earlier?.assumptions.find((item: Assumption) => item.statement === refutation.assumption);
        found.push({
          earlierId: refutation.entryId,
          laterId: later.id,
          earlierFound: earlier !== null,
          assumption: refutation.assumption,
          note: refutation.note,
          evidence: refutation.evidence,
          earlierStillClaims: stated ? stated.verdict === "supported" : false,
        });
      }
    }
    return found;
  }

  /** Assumptions the record itself has already refuted. */
  public disprovenAssumptions(): Array<{ entryId: string; statement: string }> {
    return this.store
      .all()
      .flatMap((entry) =>
        entry.assumptions
          .filter((assumption) => assumption.verdict === "refuted")
          .map((assumption) => ({ entryId: entry.id, statement: assumption.statement })),
      );
  }

  public stats(): {
    entries: number;
    verified: number;
    hypotheses: number;
    rejected: number;
    measuredEvidence: number;
    averageConfidence: number;
  } {
    const all = this.store.all();
    const measured = all.reduce(
      (sum, entry) => sum + entry.evidence.filter((item) => MEASURED_EVIDENCE.includes(item.kind)).length,
      0,
    );
    return {
      entries: all.length,
      verified: all.filter((entry) => entry.status === "verified").length,
      hypotheses: all.filter((entry) => entry.status === "hypothesis").length,
      rejected: all.filter((entry) => entry.status === "rejected").length,
      measuredEvidence: measured,
      averageConfidence:
        all.length === 0 ? 0 : Number((all.reduce((sum, entry) => sum + entry.confidence, 0) / all.length).toFixed(3)),
    };
  }

  public rebuildIndex(): void {
    this.store.writeIndex(this.store.index());
  }
}
