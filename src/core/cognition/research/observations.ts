/**
 * ==========================================================
 * LÉLU
 * OBSERVATION LOG — the development session as evidence
 *
 * Console output is not observation. A session is observable when
 * an event carries: when it happened, what kind of event it was,
 * which work package it belongs to, what it changed, and what
 * produced it. That is the difference between a log and a record
 * you can reason over later.
 *
 * Sources are ordinary development facts:
 *   - git commits (message, files, sha, branch, time)
 *   - artefacts on disk (renders, measurement files, GLBs)
 *   - build and test results
 *   - engineering decisions and failures
 *
 * Interpretation is explicit and inspectable: `interpretCommit`
 * derives the work package and the meaning from the commit's own
 * text and files, and says which rule it used. Nothing here asks a
 * model to guess, so a session digest is reproducible.
 * ==========================================================
 */

import type { EvidenceRef, WorkPackage } from "./types";
import { WORK_PACKAGES } from "./types";
import ResearchStore from "./store";

export type ObservationType =
  | "commit"
  | "branch"
  | "source-change"
  | "architecture-change"
  | "experiment-config"
  | "build"
  | "test"
  | "render"
  | "comparison"
  | "performance"
  | "failure"
  | "decision"
  | "research-finding";

export interface Observation {
  id: string;
  at: number;
  type: ObservationType;
  workPackage: WorkPackage;
  /** One line: what happened. */
  summary: string;
  /** The evidence-bearing detail, not prose commentary. */
  detail: string;
  /** Why it matters — the interpretation, kept separate from the fact. */
  interpretation: string;
  evidence: EvidenceRef[];
  commit: string | null;
  branch: string | null;
  session: string;
  source: "git" | "artifact" | "result" | "manual";
  /** Stable key used to avoid recording the same fact twice. */
  key: string;
}

export interface RawCommit {
  sha: string;
  at: number;
  message: string;
  files: string[];
  branch: string | null;
}

export interface RawArtifact {
  path: string;
  bytes: number;
  modifiedAt: number;
}

export interface RawResult {
  name: string;
  ok: boolean;
  at: number;
  detail: string;
}

/** Everything the log can ingest, without knowing where it came from. */
export interface DevelopmentEventSource {
  commits(limit: number): RawCommit[];
  artifacts(): RawArtifact[];
  results(): RawResult[];
}

export interface SessionDigest {
  session: string;
  startedAt: number | null;
  finishedAt: number | null;
  events: number;
  byType: Record<string, number>;
  byWorkPackage: Record<string, number>;
  timeline: Array<{ at: number; type: ObservationType; workPackage: WorkPackage; summary: string }>;
  decisions: string[];
  failures: string[];
  findings: string[];
  /** Commits this session observed, newest last. */
  commits: string[];
}

const KEYWORD_WORK_PACKAGE: Array<[RegExp, WorkPackage]> = [
  [/\bwp\s*0?1\b|claim|audit|retract/i, "WP01"],
  [/\bwp\s*0?2\b|sampl|distribution|fibonacci|vogel|spiral|matrix/i, "WP02"],
  [/\bwp\s*0?3\b|hair|tube|curl|lod|strand/i, "WP03"],
  [/\bwp\s*0?4\b|head|anatom|measure|reference|landmark/i, "WP04"],
  [/\bwp\s*0?5\b|mobile|projection|benchmark|gpu|draw call/i, "WP05"],
  [/\bwp\s*0?6\b|question|agenda|hypothes/i, "WP06"],
  [/\bwp\s*0?7\b|render|image|visual/i, "WP07"],
  [/\bwp\s*0?8\b|capabilit/i, "WP08"],
  [/\bwp\s*0?9\b|participat/i, "WP09"],
  [/\bwp\s*1?0\b|integrat|bridge|knowledge/i, "WP10"],
];

/**
 * Which work package a commit belongs to, from the commit's own text.
 * `MISSION` is the honest answer when nothing matches; guessing would
 * make the association meaningless.
 */
export function workPackageOf(text: string): { workPackage: WorkPackage; rule: string } {
  const explicit = text.match(/\bWP\s?(0?[1-9]|10)\b/i);
  if (explicit) {
    const number = String(Number(explicit[1])).padStart(2, "0");
    const candidate = `WP${number}` as WorkPackage;
    if (WORK_PACKAGES.includes(candidate)) return { workPackage: candidate, rule: `explicit ${explicit[0]}` };
  }
  for (const [pattern, workPackage] of KEYWORD_WORK_PACKAGE) {
    if (pattern.test(text)) return { workPackage, rule: `keyword ${pattern.source.slice(0, 28)}` };
  }
  return { workPackage: "MISSION", rule: "no work-package signal" };
}

/**
 * Which work package an artefact belongs to, from where it lives.
 * A render under `hair/` is WP03 evidence even though the file itself
 * never says so; deriving it from the path keeps the association
 * inspectable instead of defaulting everything to MISSION.
 */
export function workPackageForArtifact(path: string): { workPackage: WorkPackage; rule: string } {
  const byPath: Array<[RegExp, WorkPackage]> = [
    [/\/hair\//, "WP03"],
    [/\/head\//, "WP04"],
    [/\/matrix\//, "WP02"],
    [/projection\.json/, "WP05"],
    [/\/audit\.json|\/baseline\/|\/golden\/|\/ornament\//, "WP01"],
    [/\/research\//, "WP10"],
  ];
  for (const [pattern, workPackage] of byPath) {
    if (pattern.test(path)) return { workPackage, rule: `artefact path ${pattern.source}` };
  }
  return workPackageOf(path);
}

/** How an artefact is best understood. */
export function classifyArtifact(path: string): { type: ObservationType; kind: EvidenceRef["kind"]; interpretation: string } {
  if (/\.png$|\.jpg$|\.jpeg$|\.webp$/i.test(path)) {
    return {
      type: "render",
      kind: "render",
      interpretation: "a rendered image — visual evidence that can be compared, not just counted",
    };
  }
  if (/metrics|audit|summary|comparison|projection|head-metrics/i.test(path)) {
    return {
      type: "comparison",
      kind: "measurement",
      interpretation: "a measured result — the only kind of artefact that can promote a claim to verified",
    };
  }
  if (/\.glb$|\.gltf$/i.test(path)) {
    return {
      type: "source-change",
      kind: "artifact",
      interpretation: "a generated model — geometry that can be measured and rendered again",
    };
  }
  if (/\.json$/i.test(path)) {
    return { type: "experiment-config", kind: "artifact", interpretation: "an experiment configuration or result document" };
  }
  return { type: "research-finding", kind: "artifact", interpretation: "a supporting document" };
}

function dayStamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export default class ObservationLog {
  constructor(
    private readonly store: ResearchStore,
    private readonly clock: () => number = () => Date.now(),
    private readonly session: string = defaultSession(clock()),
  ) {}

  public get sessionId(): string {
    return this.session;
  }

  public all(): Observation[] {
    return this.store
      .listDocs("observations")
      .filter((name) => /^O-/.test(name))
      .map((name) => this.store.readDoc<Observation>(`observations/${name}`))
      .filter((item): item is Observation => item !== null)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  }

  public record(input: Omit<Observation, "id" | "session" | "source"> & Partial<Pick<Observation, "id" | "session" | "source">>): Observation {
    if (!input.summary.trim()) throw new Error("an observation needs a summary");
    const at = Number.isFinite(input.at) ? input.at : this.clock();
    const key = input.key || `${input.type}:${input.commit ?? ""}:${input.summary}`.slice(0, 200);
    const existing = this.all().find((item) => item.key === key);
    // Re-ingesting the same commit or artefact is a no-op, not a duplicate.
    if (existing) return existing;

    const observation: Observation = {
      id: input.id ?? `O-${dayStamp(at)}-${String(this.all().length + 1).padStart(3, "0")}`,
      at,
      type: input.type,
      workPackage: input.workPackage,
      summary: input.summary,
      detail: input.detail,
      interpretation: input.interpretation,
      evidence: input.evidence,
      commit: input.commit ?? null,
      branch: input.branch ?? null,
      session: input.session ?? this.session,
      source: input.source ?? "manual",
      key,
    };
    this.store.writeDoc(`observations/${observation.id}.json`, observation);
    return observation;
  }

  /** Interpret and store one commit. */
  public observeCommit(commit: RawCommit): Observation {
    const { workPackage, rule } = workPackageOf(`${commit.message}\n${commit.files.join(" ")}`);
    const firstLine = commit.message.split("\n")[0].slice(0, 160);
    const isArchitecture = commit.files.some((file) => /provider|contracts|types|index|build|CharacterSpec|components/.test(file));
    return this.record({
      at: commit.at,
      type: isArchitecture ? "architecture-change" : "source-change",
      workPackage,
      summary: firstLine,
      detail: `${commit.files.length} file(s): ${commit.files.slice(0, 8).join(", ")}${commit.files.length > 8 ? ", …" : ""}`,
      interpretation: `Associated with ${workPackage} by ${rule}. Changes were ${isArchitecture ? "architectural" : "local to the affected code"}.`,
      evidence: [
        { kind: "commit", ref: commit.sha, commit: commit.sha, note: firstLine },
        ...commit.files.slice(0, 12).map((file) => ({ kind: "code" as const, ref: file, commit: commit.sha })),
      ],
      commit: commit.sha,
      branch: commit.branch,
      source: "git",
      key: `commit:${commit.sha}`,
    });
  }

  public observeArtifact(artifact: RawArtifact): Observation {
    const classified = classifyArtifact(artifact.path);
    const { workPackage, rule } = workPackageForArtifact(artifact.path);
    return this.record({
      at: artifact.modifiedAt,
      type: classified.type,
      workPackage,
      summary: `${artifact.path} (${formatBytes(artifact.bytes)})`,
      detail: `${classified.interpretation}; ${artifact.bytes} bytes`,
      interpretation: `classed as ${classified.type} · ${classified.kind} evidence · associated with ${workPackage} by ${rule}`,
      evidence: [{ kind: classified.kind, ref: artifact.path, at: artifact.modifiedAt }],
      commit: null,
      branch: null,
      source: "artifact",
      key: `artifact:${artifact.path}:${artifact.bytes}`,
    });
  }

  public observeResult(result: RawResult): Observation {
    return this.record({
      at: result.at,
      type: result.ok ? "test" : "failure",
      workPackage: "MISSION",
      summary: `${result.name}: ${result.ok ? "passed" : "FAILED"}`,
      detail: result.detail,
      interpretation: result.ok
        ? "a passing check — evidence that re-runs, so it can support verification"
        : "a failure kept in the record: it is a result, not an absence of one",
      evidence: [{ kind: "test", ref: `${result.name}@${result.at}`, note: result.ok ? "passed" : "failed" }],
      commit: null,
      branch: null,
      source: "result",
      key: `result:${result.name}:${result.at}`,
    });
  }

  /** Ingest whatever the source offers; returns what was newly stored. */
  public sync(source: DevelopmentEventSource, options: { commitLimit?: number } = {}): Observation[] {
    const before = new Set(this.all().map((item) => item.key));
    for (const commit of source.commits(options.commitLimit ?? 40)) this.observeCommit(commit);
    for (const artifact of source.artifacts()) this.observeArtifact(artifact);
    for (const result of source.results()) this.observeResult(result);
    return this.all().filter((item) => !before.has(item.key));
  }

  /** Rebuild what happened, by work package, in time order. */
  public digest(session = this.session): SessionDigest {
    const events = this.all().filter((item) => item.session === session || session === "*");
    const byType: Record<string, number> = {};
    const byWorkPackage: Record<string, number> = {};
    for (const event of events) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      byWorkPackage[event.workPackage] = (byWorkPackage[event.workPackage] ?? 0) + 1;
    }
    return {
      session,
      startedAt: events.length > 0 ? events[0].at : null,
      finishedAt: events.length > 0 ? events[events.length - 1].at : null,
      events: events.length,
      byType,
      byWorkPackage,
      timeline: events.map((event) => ({
        at: event.at,
        type: event.type,
        workPackage: event.workPackage,
        summary: event.summary,
      })),
      decisions: events.filter((event) => event.type === "decision").map((event) => event.summary),
      failures: events.filter((event) => event.type === "failure").map((event) => event.summary),
      findings: events.filter((event) => event.type === "research-finding").map((event) => event.summary),
      commits: [...new Set(events.map((event) => event.commit).filter((sha): sha is string => Boolean(sha)))],
    };
  }

  /** Recurring problems: same type and WP seen more than once. */
  public recurrences(minimum = 2): Array<{ type: ObservationType; workPackage: WorkPackage; count: number; examples: string[] }> {
    const groups = new Map<string, Observation[]>();
    for (const event of this.all()) {
      if (event.type !== "failure" && event.type !== "comparison") continue;
      const key = `${event.type}:${event.workPackage}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.values()]
      .filter((group) => group.length >= minimum)
      .map((group) => ({
        type: group[0].type,
        workPackage: group[0].workPackage,
        count: group.length,
        examples: group.slice(0, 3).map((event) => event.summary),
      }));
  }
}

export function defaultSession(now = Date.now()): string {
  return `S-${new Date(now).toISOString().slice(0, 10)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
