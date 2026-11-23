/**
 * ==========================================================
 * LÉLU
 * RESEARCH — the shapes of durable knowledge
 *
 * A journal entry is not a log line and not a chat message. It is
 * a record that must still answer the same fourteen questions a
 * year from now, because the only thing that makes research
 * reusable is that the next reader can tell WHAT was observed,
 * HOW it was measured, and HOW MUCH of it is actually settled.
 *
 * The fourteen required fields (WP03):
 *
 *    1 id              8  method
 *    2 createdAt       9  results
 *    3 mission + WP    10 evidence + sources
 *    4 observed        11 learned
 *    5 studied         12 confidence + limitations
 *    6 question        13 applications
 *    7 hypothesis      14 next questions
 *
 * `confidence` is a number, never a word, and `status: "verified"`
 * is refused unless the evidence contains a measurement, a test,
 * a render or an observation. A conclusion supported only by prose
 * stays a hypothesis — that single rule is what stops the journal
 * from becoming a pile of confident sentences.
 * ==========================================================
 */

/** The directories under `research/`, exactly as WP03 lists them. */
export const RESEARCH_KINDS = [
  "observations",
  "experiments",
  "discoveries",
  "hypotheses",
  "failures",
  "technical-studies",
  "research-papers",
  "capabilities",
  "knowledge-index",
  "daily-journals",
] as const;

export type ResearchKind = (typeof RESEARCH_KINDS)[number];

/** The mission's work packages. MISSION is for cross-cutting entries. */
export const WORK_PACKAGES = [
  "WP01",
  "WP02",
  "WP03",
  "WP04",
  "WP05",
  "WP06",
  "WP07",
  "WP08",
  "WP09",
  "WP10",
  "MISSION",
] as const;

export type WorkPackage = (typeof WORK_PACKAGES)[number];

/**
 * What the entry currently IS.
 *
 * `verified` is earned by evidence, not chosen. `rejected` is a
 * first-class outcome: a refuted hypothesis that is recorded is
 * worth more than one that quietly disappeared.
 */
export type EntryStatus = "hypothesis" | "experiment" | "verified" | "rejected" | "open";

export const ENTRY_STATUSES: EntryStatus[] = ["hypothesis", "experiment", "verified", "rejected", "open"];

/** Where a claim's support actually comes from. */
export type EvidenceKind =
  | "code"
  | "commit"
  | "artifact"
  | "measurement"
  | "render"
  | "test"
  | "source"
  | "document"
  | "observation";

export const EVIDENCE_KINDS: EvidenceKind[] = [
  "code",
  "commit",
  "artifact",
  "measurement",
  "render",
  "test",
  "source",
  "document",
  "observation",
];

/**
 * Evidence that can carry a `verified` status on its own.
 *
 * A file path proves that a file exists; only a measurement, a
 * passing test, a render or a recorded observation says anything
 * about whether the claim is TRUE. Prose and source references are
 * support, not proof.
 */
export const MEASURED_EVIDENCE: EvidenceKind[] = ["measurement", "test", "render", "observation", "artifact"];

export interface EvidenceRef {
  kind: EvidenceKind;
  /** Repo-relative path, commit sha, URL, or a stable identifier. */
  ref: string;
  /** The commit the evidence was produced at, when known. */
  commit?: string;
  /** What this evidence shows, in one line. */
  note?: string;
  /** When the evidence was produced, when known. */
  at?: number;
}

/** An assumption an entry makes, and what the evidence did to it. */
export interface Assumption {
  statement: string;
  verdict: "untested" | "supported" | "refuted";
}

/** A later entry showing an earlier assumption does not hold. */
export interface Refutation {
  /** The entry whose assumption is refuted. */
  entryId: string;
  /** The assumption text, quoted as it was written. */
  assumption: string;
  evidence: EvidenceRef[];
  note: string;
}

export interface ResearchEntry {
  /** Stable, human-sortable: R-YYYYMMDD-<slug>. */
  id: string;
  kind: ResearchKind;
  createdAt: number;
  updatedAt: number;

  mission: string;
  workPackage: WorkPackage;

  observed: string;
  studied: string;
  question: string;
  hypothesis: string;
  method: string;
  results: string;

  evidence: EvidenceRef[];

  learned: string;
  /** 0..1. See confidenceFor() — derived from evidence, not asserted. */
  confidence: number;
  limitations: string[];
  applications: string[];
  nextQuestions: string[];

  status: EntryStatus;
  tags: string[];

  /** HEAD when the entry was written, so a claim can be located in history. */
  commit: string | null;
  session: string | null;

  assumptions: Assumption[];
  refutations: Refutation[];
  /** Entries this one replaces (an earlier, weaker version of the same finding). */
  supersedes: string[];
  supersededBy: string[];

  /**
   * Questions this entry settles, quoted as they were asked. Explicit
   * rather than inferred: an answer rarely repeats the question's words,
   * and a gap report that guesses is a gap report that lies.
   */
  answers: string[];

  /** Only set when status became `verified`, and only by verify(). */
  verifiedAt: number | null;
}

/** What a caller supplies. Identity and timestamps are assigned. */
export type ResearchEntryInput = Omit<
  ResearchEntry,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "verifiedAt"
  | "supersededBy"
  | "assumptions"
  | "refutations"
  | "supersedes"
  | "tags"
  | "commit"
  | "session"
  | "evidence"
  | "limitations"
  | "applications"
  | "nextQuestions"
  | "answers"
  | "confidence"
> & {
  answers?: string[];
  confidence?: number;
  evidence?: EvidenceRef[];
  limitations?: string[];
  applications?: string[];
  nextQuestions?: string[];
  assumptions?: Assumption[];
  refutations?: Refutation[];
  supersedes?: string[];
  tags?: string[];
  commit?: string | null;
  session?: string | null;
  id?: string;
};

/** A verified entry that can be turned into a capability (WP08). */
export interface CapabilityRecord {
  id: string;
  name: string;
  fromEntryId: string;
  status: "proposed" | "verified";
  /** Measurable acceptance criteria, one per line. */
  acceptance: string[];
  /** The exact command that proves the capability still works. */
  testCommand: string;
  evidence: EvidenceRef[];
  createdAt: number;
  verifiedAt: number | null;
  notes: string[];
}

/** A question worth answering, with the evidence that it is worth it. */
export interface ResearchProposal {
  question: string;
  origin: string;
  /** 0..1 — how much a correct answer would change what LÉLU does. */
  impact: number;
  /** 0..1 — how reachable an answer is with the tools that exist. */
  feasibility: number;
  /** 1..5 — relative cost in build time, compute and risk. */
  cost: number;
  /** 0..1 — how directly it serves the active mission. */
  relevance: number;
  priority: number;
  reasons: string[];
}
