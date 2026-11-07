/**
 * ==========================================================
 * LÉLU — CREATION STUDIO: THE ARTIFACT STORE
 *
 * Every artifact keeps all its revisions. A revision is never
 * overwritten: changing an artifact adds one, restoring an old
 * one adds a copy of it. Every export is recorded with its hash,
 * size and verification. An imported file's original bytes are
 * kept exactly as given. Deleting an artifact needs confirm:true.
 *
 * Specs persist in localStorage (browser); exported bytes are
 * held in memory for download and re-opening, and can always be
 * rebuilt from their revision.
 * ==========================================================
 */

import { exportArtifact, type ExportResult, type Verification } from "./StudioExport";
import { applyOps, compareSpecs, normalizeSpec, type StudioOp } from "./StudioOps";
import { formatOf, readArtifact, type ReadResult } from "./StudioReader";
import { fromCreationArtifact, type CanonicalStudioProject } from "./StudioModel";
import type { ArtifactSpec, ExportFormat } from "./StudioTypes";
import { sha256Hex } from "./writers/bytes";

export interface Revision {
  rev: number;
  spec: ArtifactSpec;
  at: number;
  note: string;
  /** Who made it: "lelu" (a tool call), "user", "import". */
  by: string;
  basedOn?: number;
}

export interface ExportRecord {
  rev: number;
  format: ExportFormat;
  filename: string;
  sha256: string;
  size: number;
  ok: boolean;
  at: number;
  checks: Verification["checks"];
}

export interface StudioArtifact {
  id: string;
  title: string;
  kind: ArtifactSpec["kind"];
  createdAt: number;
  updatedAt: number;
  /** The chat it was made in, so later messages there can refer to it. */
  conversationId?: string;
  revisions: Revision[];
  exports: ExportRecord[];
  /** An imported file: what it was, and the hash of the bytes as given. */
  original?: { name: string; format: ExportFormat; sha256: string; size: number };
}

type Listener = (artifacts: StudioArtifact[]) => void;

/** In a browser, exports run in a Web Worker so they never compete with the Cosmos scene. */
async function runExport(spec: ArtifactSpec, format: ExportFormat): Promise<ExportResult> {
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    const { exportOffMainThread } = await import("./StudioExportClient");
    return exportOffMainThread(spec, format);
  }
  return exportArtifact(spec, format);
}

const STORAGE_KEY = "lelu.studio.artifacts.v1";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function newId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `art_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export default class StudioStore {
  private static instance: StudioStore | null = null;
  private artifacts = new Map<string, StudioArtifact>();
  private files = new Map<string, Uint8Array>(); // `${id}@${rev}.${format}` and `${id}#original`
  private listeners = new Set<Listener>();
  private version = 0;

  static getInstance(): StudioStore {
    if (!StudioStore.instance) StudioStore.instance = new StudioStore();
    return StudioStore.instance;
  }

  /** Tests: a store that neither reads nor writes localStorage. */
  static createIsolated(): StudioStore {
    const store = new StudioStore(false);
    return store;
  }

  private constructor(private persist = true) {
    if (!persist) return;
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (raw) for (const a of JSON.parse(raw) as StudioArtifact[]) this.artifacts.set(a.id, a);
    } catch {
      /* an unreadable store starts empty rather than failing the app */
    }
  }

  private save(): void {
    if (this.persist) {
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify([...this.artifacts.values()]));
      } catch {
        /* quota: the in-memory store still holds everything this session */
      }
    }
    this.version += 1;
    const list = this.list();
    for (const l of this.listeners) l(list);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes on every write: a stable snapshot for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }

  /**
   * Every artifact as the ONE canonical studio project (StudioModel).
   *
   * The Creation Studio is the primary studio, so this is where its work
   * enters the unified model; a caller that only knows CanonicalStudioProject
   * can read documents, decks and workbooks without knowing this store exists,
   * and software projects from the preserved backup arrive in the same shape.
   */
  canonicalProjects(): CanonicalStudioProject[] {
    return this.list().map(fromCreationArtifact);
  }

  list(): StudioArtifact[] {
    return [...this.artifacts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): StudioArtifact | undefined {
    return this.artifacts.get(id);
  }

  latest(a: StudioArtifact): Revision {
    return a.revisions[a.revisions.length - 1];
  }

  revision(a: StudioArtifact, rev?: number): Revision | undefined {
    return rev === undefined ? this.latest(a) : a.revisions.find((r) => r.rev === rev);
  }

  /** An artifact by id, by part of its title, or the most recent one ("", "this", "it", "latest"). */
  resolve(ref?: string, conversationId?: string): StudioArtifact | undefined {
    const r = (ref ?? "").trim();
    const pool = this.list();
    if (!r || /^(this|it|that|latest|last)$/i.test(r)) {
      return (conversationId ? pool.find((a) => a.conversationId === conversationId) : undefined) ?? pool[0];
    }
    const exact = this.artifacts.get(r);
    if (exact) return exact;
    const lower = r.toLowerCase();
    return pool.find((a) => a.title.toLowerCase() === lower) ?? pool.find((a) => a.title.toLowerCase().includes(lower));
  }

  create(input: unknown, meta: { by?: string; note?: string; conversationId?: string } = {}): { ok: true; artifact: StudioArtifact } | { ok: false; reason: string } {
    const n = normalizeSpec(input);
    if (!n.ok) return n;
    const now = Date.now();
    const artifact: StudioArtifact = {
      id: newId(),
      title: n.spec.title,
      kind: n.spec.kind,
      createdAt: now,
      updatedAt: now,
      conversationId: meta.conversationId,
      revisions: [{ rev: 1, spec: n.spec, at: now, note: meta.note ?? "created", by: meta.by ?? "lelu" }],
      exports: [],
    };
    this.artifacts.set(artifact.id, artifact);
    this.save();
    return { ok: true, artifact };
  }

  private addRevision(a: StudioArtifact, spec: ArtifactSpec, note: string, by: string, basedOn: number): Revision {
    const rev: Revision = { rev: this.latest(a).rev + 1, spec, at: Date.now(), note, by, basedOn };
    a.revisions.push(rev);
    a.title = spec.title;
    a.updatedAt = rev.at;
    this.save();
    return rev;
  }

  /** A new revision from changes, or from a whole replacement spec. The previous revision stays. */
  revise(id: string, change: { ops?: StudioOp[]; spec?: unknown; note?: string; by?: string; fromRev?: number }):
    { ok: true; artifact: StudioArtifact; revision: Revision; changes: string[] } | { ok: false; reason: string } {
    const a = this.artifacts.get(id);
    if (!a) return { ok: false, reason: `no artifact ${id}` };
    const base = this.revision(a, change.fromRev);
    if (!base) return { ok: false, reason: `revision ${change.fromRev} of “${a.title}” does not exist` };
    let spec: ArtifactSpec;
    let changes: string[];
    if (change.spec !== undefined) {
      const n = normalizeSpec(change.spec);
      if (!n.ok) return { ok: false, reason: `${n.reason}. Nothing was changed.` };
      if (n.spec.kind !== a.kind) return { ok: false, reason: `“${a.title}” is a ${a.kind}; a ${n.spec.kind} is a new artifact, not a revision. Nothing was changed.` };
      spec = n.spec;
      changes = compareSpecs(base.spec, spec);
    } else if (change.ops?.length) {
      const r = applyOps(base.spec, change.ops);
      if (!r.ok) return r;
      spec = r.spec;
      changes = r.changes;
    } else {
      return { ok: false, reason: "a revision needs changes (ops) or a replacement spec. Nothing was changed." };
    }
    const revision = this.addRevision(a, spec, change.note ?? changes.slice(0, 3).join("; "), change.by ?? "lelu", base.rev);
    return { ok: true, artifact: a, revision, changes };
  }

  /** Bring an old revision back — as a NEW revision; nothing in between is lost. */
  restore(id: string, rev: number, by = "user"): { ok: true; revision: Revision } | { ok: false; reason: string } {
    const a = this.artifacts.get(id);
    const old = a ? this.revision(a, rev) : undefined;
    if (!a || !old) return { ok: false, reason: `revision ${rev} not found` };
    return { ok: true, revision: this.addRevision(a, JSON.parse(JSON.stringify(old.spec)), `restored revision ${rev}`, by, rev) };
  }

  compare(id: string, revA: number, revB: number): { ok: true; changes: string[] } | { ok: false; reason: string } {
    const a = this.artifacts.get(id);
    const ra = a ? this.revision(a, revA) : undefined;
    const rb = a ? this.revision(a, revB) : undefined;
    if (!ra || !rb) return { ok: false, reason: `revision ${!ra ? revA : revB} not found` };
    return { ok: true, changes: compareSpecs(ra.spec, rb.spec) };
  }

  /** Write, re-open, verify and record an export of one revision. */
  async export(id: string, format: ExportFormat, rev?: number): Promise<{ ok: true; result: ExportResult; record: ExportRecord } | { ok: false; reason: string }> {
    const a = this.artifacts.get(id);
    if (!a) return { ok: false, reason: `no artifact ${id}` };
    const r = this.revision(a, rev);
    if (!r) return { ok: false, reason: `revision ${rev} not found` };
    let result: ExportResult;
    try {
      result = await runExport(r.spec, format);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const record: ExportRecord = {
      rev: r.rev,
      format,
      filename: result.filename,
      sha256: result.sha256,
      size: result.size,
      ok: result.verification.ok,
      at: Date.now(),
      checks: result.verification.checks,
    };
    a.exports.push(record);
    a.exports = a.exports.slice(-60);
    this.files.set(`${id}@${r.rev}.${format}`, result.bytes);
    this.save();
    return { ok: true, result, record };
  }

  /**
   * The bytes of an export of one revision. Held bytes are returned as
   * they are; otherwise the file is written again from the revision,
   * verified again and recorded as a NEW export (a writer that stamps
   * the time produces different bytes, which must not pass as the old
   * record's).
   */
  async fileOf(id: string, rev: number, format: ExportFormat): Promise<Uint8Array | null> {
    const held = this.files.get(`${id}@${rev}.${format}`);
    if (held) return held;
    const exported = await this.export(id, format, rev);
    return exported.ok ? exported.result.bytes : null;
  }

  /** Re-open an exported file from its bytes, as a reader sees it. */
  async reopen(id: string, rev: number, format: ExportFormat): Promise<ReadResult | null> {
    const bytes = await this.fileOf(id, rev, format);
    return bytes ? readArtifact(bytes, format) : null;
  }

  /**
   * Open a file the user supplied. Its bytes are kept exactly as given;
   * what LÉLU can edit is a revision built from what the reader found.
   */
  async importFile(name: string, bytes: Uint8Array, meta: { mime?: string; conversationId?: string } = {}):
    Promise<{ ok: true; artifact: StudioArtifact; read: ReadResult } | { ok: false; reason: string; read?: ReadResult }> {
    const format = formatOf(name, meta.mime);
    if (!format) return { ok: false, reason: `“${name}” is not a format the Studio reads (DOCX, PPTX, XLSX, PDF, CSV, Markdown, HTML, TXT, RTF)` };
    const read = await readArtifact(bytes, format);
    if (!read.ok) return { ok: false, reason: `“${name}” could not be opened: ${read.error}`, read };
    const spec: ArtifactSpec = read.spec ?? {
      kind: "document",
      title: read.title || name.replace(/\.[^.]+$/, ""),
      blocks: read.text.split(/\n{2,}|\n/).map((t) => t.trim()).filter(Boolean).slice(0, 400).map((text) => ({ type: "paragraph" as const, text })),
    };
    if (spec.kind === "document" && spec.blocks.length === 0) spec.blocks.push({ type: "paragraph", text: "(no text could be read from this file)" });
    if (!spec.title?.trim()) spec.title = name.replace(/\.[^.]+$/, "");
    const created = this.create(spec, { by: "import", note: `imported from ${name}`, conversationId: meta.conversationId });
    if (!created.ok) return { ok: false, reason: created.reason, read };
    created.artifact.original = { name, format, sha256: await sha256Hex(bytes), size: bytes.length };
    this.files.set(`${created.artifact.id}#original`, bytes);
    this.save();
    return { ok: true, artifact: created.artifact, read };
  }

  original(id: string): Uint8Array | undefined {
    return this.files.get(`${id}#original`);
  }

  remove(id: string, confirm: boolean): { ok: boolean; reason?: string } {
    const a = this.artifacts.get(id);
    if (!a) return { ok: false, reason: `no artifact ${id}` };
    if (confirm !== true) return { ok: false, reason: `Deleting “${a.title}” removes all ${a.revisions.length} revisions; it needs confirm:true.` };
    this.artifacts.delete(id);
    for (const key of [...this.files.keys()]) if (key.startsWith(id)) this.files.delete(key);
    this.save();
    return { ok: true };
  }
}
