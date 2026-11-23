/**
 * ==========================================================
 * LÉLU
 * RESEARCH STORE — persistence that outlives the process
 *
 * The journal is files, not memory. A branch change, a restart, a
 * different runtime and a future mission all have to see the same
 * entries, so the unit of storage is one JSON document per entry
 * under `research/<kind>/<id>.json`, plus a rendered `.md` beside
 * it for a human reading the repository on GitHub.
 *
 * This module knows nothing about Node or the browser. It writes
 * through a `DocStore`, which the mission CLI implements with
 * `node:fs` and the tests implement in memory. That is what keeps
 * the cognition layer importable by the app without dragging
 * `node:fs` into a browser bundle.
 * ==========================================================
 */

import type { ResearchEntry, ResearchKind } from "./types";
import { RESEARCH_KINDS } from "./types";

/** The smallest persistence surface the journal needs. */
export interface DocStore {
  list(dir: string): string[];
  read(path: string): string | null;
  write(path: string, content: string): void;
  remove(path: string): void;
}

/** Deterministic in-memory store: tests, and any runtime with no disk. */
export class MemoryDocStore implements DocStore {
  private readonly files = new Map<string, string>();

  public list(dir: string): string[] {
    const prefix = dir.replace(/\/+$/, "") + "/";
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => path.slice(prefix.length))
      .sort();
  }

  public read(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  public write(path: string, content: string): void {
    this.files.set(path, content);
  }

  public remove(path: string): void {
    this.files.delete(path);
  }

  /** Everything written, for assertions about what really landed. */
  public paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

const META_SEPARATOR = "\n\n---\n\n";

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** One entry, rendered for a reader who is not going to open the JSON. */
export function renderMarkdown(entry: ResearchEntry): string {
  const line = (label: string, value: string): string => `**${label}.** ${value}`;
  const evidence = entry.evidence
    .map((item) => `- \`${item.kind}\` ${item.ref}${item.commit ? ` @ ${item.commit.slice(0, 8)}` : ""}${item.note ? ` — ${item.note}` : ""}`)
    .join("\n");
  const assumptions =
    entry.assumptions.length > 0
      ? entry.assumptions.map((item) => `- [${item.verdict}] ${item.statement}`).join("\n")
      : "- (none recorded)";
  const refutations =
    entry.refutations.length > 0
      ? entry.refutations
          .map((item) => `- refutes \`${item.entryId}\`: "${item.assumption}" — ${item.note}`)
          .join("\n")
      : "- (none)";

  return [
    `# ${entry.id}`,
    "",
    `${entry.workPackage} · ${entry.kind} · ${entry.status} · confidence ${entry.confidence.toFixed(2)}`,
    "",
    `_${new Date(entry.createdAt).toISOString()}_${entry.commit ? ` · commit \`${entry.commit.slice(0, 8)}\`` : ""}`,
    "",
    line("1–3 Mission", `${entry.mission} (${entry.workPackage})`),
    "",
    line("4 Observed", entry.observed),
    "",
    line("5 Studied", entry.studied),
    "",
    line("6 Question", entry.question),
    "",
    line("7 Hypothesis", entry.hypothesis),
    "",
    line("8 Method", entry.method),
    "",
    line("9 Results", entry.results),
    "",
    "**10 Evidence.**",
    evidence || "- (none)",
    "",
    line("11 Learned", entry.learned),
    "",
    line("12 Confidence", `${entry.confidence.toFixed(2)}`),
    "",
    "**12b Limitations.**",
    entry.limitations.length > 0 ? entry.limitations.map((item) => `- ${item}`).join("\n") : "- (none)",
    "",
    line("13 Applications", entry.applications.join("; ") || "(none)"),
    "",
    "**14 Next questions.**",
    entry.nextQuestions.length > 0 ? entry.nextQuestions.map((item) => `- ${item}`).join("\n") : "- (none)",
    "",
    "**Settles.**",
    entry.answers.length > 0 ? entry.answers.map((item) => `- ${item}`).join("\n") : "- (nothing declared)",
    "",
    "**Assumptions.**",
    assumptions,
    "",
    "**Refutations.**",
    refutations,
    "",
    "**Tags.**",
    entry.tags.length > 0 ? entry.tags.map((tag) => `\`${tag}\``).join(" ") : "(none)",
    "",
  ].join("\n");
}

export interface JournalIndex {
  generatedAt: number;
  entries: number;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
  byWorkPackage: Record<string, number>;
  tags: Record<string, number>;
  ids: string[];
}

export default class ResearchStore {
  constructor(
    private readonly store: DocStore,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Every entry file, read and ordered oldest first. */
  public all(): ResearchEntry[] {
    const entries: ResearchEntry[] = [];
    for (const kind of RESEARCH_KINDS) {
      for (const name of this.store.list(kind)) {
        if (!name.endsWith(".json")) continue;
        const raw = this.store.read(`${kind}/${name}`);
        if (raw === null) continue;
        try {
          const parsed = JSON.parse(raw) as Partial<ResearchEntry>;
          // The index document and any future non-entry document live in
          // the same tree; only documents that ARE entries are returned.
          // Capability records deliberately live in the same tree; they are
          // not research entries and must not be read as one.
          if (
            typeof parsed.id !== "string" ||
            typeof parsed.createdAt !== "number" ||
            typeof parsed.question !== "string" ||
            !Array.isArray(parsed.tags) ||
            !Array.isArray(parsed.evidence)
          ) {
            continue;
          }
          entries.push(parsed as ResearchEntry);
        } catch {
          // A corrupt document is skipped rather than taking the
          // journal with it — but it is never deleted.
        }
      }
    }
    return entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  public byKind(kind: ResearchKind): ResearchEntry[] {
    return this.all().filter((entry) => entry.kind === kind);
  }

  public get(id: string): ResearchEntry | null {
    return this.all().find((entry) => entry.id === id) ?? null;
  }

  /** Write the JSON and its markdown twin; returns what was stored. */
  public save(entry: ResearchEntry): ResearchEntry {
    const path = `${entry.kind}/${safeId(entry.id)}`;
    this.store.write(`${path}.json`, JSON.stringify(entry, null, 2) + "\n");
    this.store.write(`${path}.md`, renderMarkdown(entry));
    return entry;
  }

  public update(id: string, patch: Partial<ResearchEntry>): ResearchEntry | null {
    const current = this.get(id);
    if (!current) return null;
    const next: ResearchEntry = { ...current, ...patch, id: current.id, updatedAt: this.clock() };
    // A kind change moves the document rather than leaving two copies.
    if (patch.kind && patch.kind !== current.kind) {
      this.store.remove(`${current.kind}/${safeId(current.id)}.json`);
      this.store.remove(`${current.kind}/${safeId(current.id)}.md`);
    }
    return this.save(next);
  }

  public remove(id: string): boolean {
    const current = this.get(id);
    if (!current) return false;
    this.store.remove(`${current.kind}/${safeId(current.id)}.json`);
    this.store.remove(`${current.kind}/${safeId(current.id)}.md`);
    return true;
  }

  public index(): JournalIndex {
    const entries = this.all();
    const bump = (record: Record<string, number>, key: string): void => {
      record[key] = (record[key] ?? 0) + 1;
    };
    const index: JournalIndex = {
      generatedAt: this.clock(),
      entries: entries.length,
      byKind: {},
      byStatus: {},
      byWorkPackage: {},
      tags: {},
      ids: entries.map((entry) => entry.id),
    };
    for (const entry of entries) {
      bump(index.byKind, entry.kind);
      bump(index.byStatus, entry.status);
      bump(index.byWorkPackage, entry.workPackage);
      for (const tag of entry.tags) bump(index.tags, tag);
    }
    return index;
  }

  public writeIndex(index: JournalIndex): void {
    this.store.write("knowledge-index/index.json", JSON.stringify(index, null, 2) + "\n");
  }

  public readIndex(): JournalIndex | null {
    const raw = this.store.read("knowledge-index/index.json");
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as JournalIndex;
    } catch {
      return null;
    }
  }

  /** A raw document write, for capability records and digests. */
  public writeDoc(path: string, value: unknown): void {
    this.store.write(path, JSON.stringify(value, null, 2) + "\n");
  }

  public readDoc<T>(path: string): T | null {
    const raw = this.store.read(path);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public listDocs(dir: string): string[] {
    return this.store.list(dir).filter((name) => name.endsWith(".json"));
  }

  public raw(path: string): string | null {
    return this.store.read(path);
  }

  public store_(): DocStore {
    return this.store;
  }
}

export { META_SEPARATOR };
