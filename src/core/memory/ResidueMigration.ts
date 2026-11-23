/**
 * ==========================================================
 * LÉLU
 * HISTORICAL MEMORY RESIDUE MIGRATION (M22.5, extended in M22.6)
 *
 * Deleting a memory now removes it from the store, the cognitive
 * graph, workspace observations and the project checkpoints that
 * quote it (M22.4). What M22.4 could not repair was residue from
 * *before* that purge existed: checkpoints and project text
 * written by the old build still quote statements whose records
 * are gone.
 *
 * This migration finds and removes those copies — but only when it
 * can prove what they are. Proof comes from the deletion ledger:
 * hashed token windows of statements deleted while the record was
 * still in hand. A field that matches a tombstone quotes a deleted
 * memory; it is cleaned. A legacy checkpoint that matches no
 * tombstone is *not* guessed at — it is quarantined and shown to
 * the user to forget or keep.
 *
 * Guarantees:
 *   - dry run first: `run({ dryRun: true })` writes nothing;
 *   - targeted: only matching fields are touched, never whole
 *     projects, items, names, timestamps or unrelated text;
 *   - idempotent: a second run finds nothing left to do;
 *   - resumable: `limit` processes projects in id order and stores
 *     a cursor, so an interrupted run continues where it stopped;
 *   - corruptible-proof: a cursor that does not validate is
 *     discarded and the scan restarts, rather than stalling;
 *   - failure-honest: a progress/report write that fails raises,
 *     so a caller cannot report a clean migration that was not
 *     recorded;
 *   - auditable: every run's counts are persisted, and review
 *     dispositions are kept in their own store so a later run
 *     cannot erase them;
 *   - privacy-preserving: the persisted report records ids,
 *     counts and reasons — never the text that was removed, and
 *     never the text of a quarantined record either.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import ProjectStore, { type LeluProject, type ProjectCheckpoint } from "../projects/ProjectStore";
import DeletionLedger, {
  buildTombstoneIndex,
  matchTombstoneIndex,
  type DeletionTombstone,
  type TombstoneIndex,
} from "./DeletionLedger";

export const RESIDUE_REPORT_KEY = "memory.migration.v1";
export const RESIDUE_PROGRESS_KEY = "memory.migration.progress.v1";
export const RESIDUE_REVIEWS_KEY = "memory.migration.reviews.v1";

/** Bumped when the report's meaning changes, so readers can tell them apart. */
export const RESIDUE_REPORT_VERSION = 2;

/** Projects the old answered-turn writer created for itself. */
const AUTO_PROJECT_PREFIX = "Auto-created for ";

/** The report is an audit record, not a log: keep a bounded tail of findings. */
const MAX_PERSISTED_FINDINGS = 100;

/** What a cursor must look like to be trusted. */
interface MigrationProgress {
  cursor: string | null;
  cleanedFields: number;
  cleanedByTombstone: Record<string, number>;
  scannedProjects: number;
  updatedAt: number;
}

export interface ResidueFinding {
  /** Stable id for this finding: project + location. */
  id: string;
  kind: "checkpoint" | "project" | "item";
  projectId: string;
  projectName: string;
  /** Exact field, e.g. `checkpoint.summary` or `items[2].text`. */
  location: string;
  /** First 80 characters, for the review surface. Never persisted. */
  preview: string;
  reason: "tombstone" | "legacy-checkpoint";
  /** The tombstone that proves it, when there is one. */
  tombstoneId?: string;
  /** Token count, so a review surface can describe size without the text. */
  tokens?: number;
}

export interface ResidueReport {
  /** Report shape version. */
  version: number;
  at: number;
  dryRun: boolean;
  durationMs: number;
  tombstones: number;
  scannedProjects: number;
  scannedFields: number;
  /** Fields that quote a tombstoned memory (would be / were removed). */
  findings: ResidueFinding[];
  cleanedFields: number;
  /** Which deleted memory caused how many removals. */
  cleanedByTombstone: Record<string, number>;
  /** Legacy checkpoints no tombstone can vouch for — review, never auto-delete. */
  quarantined: ResidueFinding[];
  /** Findings the user chose to keep. */
  dismissed: string[];
  /** Checkpoints the user explicitly forgot through review. */
  reviewed: number;
  /** Non-null when the run was bounded and stopped before the end. */
  cursor: string | null;
  remainingProjects: number;
  resumed: boolean;
  /** True when a stored cursor failed validation and the scan restarted. */
  recoveredCursor: boolean;
  /** Projects this run could not read; they are not counted as clean. */
  skippedProjects: number;
  /** False when the run was dry (nothing was written) or a write failed. */
  persisted: boolean;
}

interface FieldValue {
  location: string;
  kind: ResidueFinding["kind"];
  text: string;
}

/** A write that had to happen did not — the caller must not report success. */
export class ResidueStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResidueStorageError";
  }
}

/** Every text field in a project that can carry a quoted statement. */
function projectTextFields(project: LeluProject): FieldValue[] {
  const fields: FieldValue[] = [];
  const add = (location: string, kind: ResidueFinding["kind"], text?: string | null) => {
    if (typeof text === "string" && text.trim()) fields.push({ location, kind, text });
  };

  add("originalRequest", "project", project.originalRequest);
  add("objective", "project", project.objective);
  add("context", "project", project.context);
  (project.executionPlan ?? []).forEach((entry, index) => add(`executionPlan[${index}]`, "project", entry));
  (project.actionableTasks ?? []).forEach((entry, index) => add(`actionableTasks[${index}]`, "project", entry));

  const checkpoint = project.checkpoint;
  if (checkpoint) {
    add("checkpoint.summary", "checkpoint", checkpoint.summary);
    checkpoint.completed.forEach((entry, index) => add(`checkpoint.completed[${index}]`, "checkpoint", entry));
    checkpoint.pending.forEach((entry, index) => add(`checkpoint.pending[${index}]`, "checkpoint", entry));
    checkpoint.blockers.forEach((entry, index) => add(`checkpoint.blockers[${index}]`, "checkpoint", entry));
    add("checkpoint.nextAction", "checkpoint", checkpoint.nextAction);
  }

  project.items.forEach((item, index) => {
    add(`items[${index}].title`, "item", item.title);
    add(`items[${index}].text`, "item", item.text);
    add(`items[${index}].ref`, "item", item.ref);
  });

  return fields;
}

function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
}

function tokensOf(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * A checkpoint the old answered-turn writer produced: it carries the turn's
 * request and reply but no resumable work (no pending step, no blocker, no
 * next action). It is not project state; it exists only because that writer
 * ran. No tombstone can prove what it quotes, so it is quarantined.
 */
function isLegacyCheckpoint(project: LeluProject): boolean {
  if (!project.description.startsWith(AUTO_PROJECT_PREFIX)) return false;
  const checkpoint = project.checkpoint;
  if (!checkpoint) return false;
  return (
    checkpoint.pending.length === 0 &&
    checkpoint.blockers.length === 0 &&
    checkpoint.nextAction === null &&
    Boolean(checkpoint.summary.trim())
  );
}

function emptied(checkpoint: ProjectCheckpoint): boolean {
  return (
    !checkpoint.summary.trim() &&
    checkpoint.completed.length === 0 &&
    checkpoint.pending.length === 0 &&
    checkpoint.blockers.length === 0 &&
    !checkpoint.nextAction
  );
}

/** Counts only, so a persisted finding can describe itself without its text. */
function withoutPreview(finding: ResidueFinding): ResidueFinding {
  return { ...finding, preview: "" };
}

export default class ResidueMigration {
  private static instance: ResidueMigration | null = null;

  private readonly kv = KvStore.getInstance();

  public static getInstance(): ResidueMigration {
    if (!ResidueMigration.instance) {
      ResidueMigration.instance = new ResidueMigration();
    }
    return ResidueMigration.instance;
  }

  public report(): ResidueReport | null {
    return this.kv.get<ResidueReport>(RESIDUE_REPORT_KEY) ?? null;
  }

  /** Duplicate evidence used to persist quarantine previews before M22.6. */
  public scrubLegacyPreviews(): void {
    const existing = this.report();
    if (!existing) return;
    const hadPreview =
      existing.quarantined.some((finding) => finding.preview) ||
      existing.findings.some((finding) => finding.preview);
    if (!hadPreview) return;
    this.kv.set(RESIDUE_REPORT_KEY, {
      ...existing,
      quarantined: existing.quarantined.map(withoutPreview),
      findings: existing.findings.map(withoutPreview),
    });
  }

  /**
   * What the user chose to keep. Kept in the review store rather than in the
   * report so a later execute-run cannot drop the decision.
   */
  private dismissedIds(): string[] {
    const reviews = this.dispositions();
    const kept = reviews.filter((entry) => entry.action === "keep").map((entry) => `${entry.projectId}:checkpoint`);
    const legacy = this.report()?.dismissed ?? [];
    return [...new Set([...kept, ...legacy])];
  }

  private reviewedIds(): string[] {
    return [
      ...new Set(
        [...this.dispositions().filter((entry) => entry.action === "forget").map((entry) => entry.projectId)],
      ),
    ];
  }

  /** The disposition log: which quarantined record was forgotten or kept. */
  public dispositions(): Array<{ projectId: string; action: "forget" | "keep"; at: number }> {
    const stored = this.kv.get<{ entries: Array<{ projectId: string; action: "forget" | "keep"; at: number }> }>(
      RESIDUE_REVIEWS_KEY,
    );
    return Array.isArray(stored?.entries) ? stored!.entries : [];
  }

  /**
   * Read the cursor, refusing to trust anything that does not look like one.
   * A corrupted value used to be treated as a project id and silently filtered
   * every project out, so the migration reported "done" without scanning.
   */
  private readProgress(): { progress: MigrationProgress | null; recovered: boolean } {
    const stored = this.kv.get<unknown>(RESIDUE_PROGRESS_KEY);
    if (stored === null || stored === undefined) return { progress: null, recovered: false };
    const candidate = stored as Partial<MigrationProgress>;
    const valid =
      typeof candidate === "object" &&
      (candidate.cursor === null || (typeof candidate.cursor === "string" && candidate.cursor.length > 0 && candidate.cursor.length <= 200)) &&
      typeof candidate.cleanedFields === "number" &&
      Number.isFinite(candidate.cleanedFields) &&
      candidate.cleanedFields >= 0 &&
      typeof candidate.scannedProjects === "number" &&
      Number.isFinite(candidate.scannedProjects) &&
      candidate.scannedProjects >= 0 &&
      (candidate.cleanedByTombstone === undefined ||
        (typeof candidate.cleanedByTombstone === "object" && candidate.cleanedByTombstone !== null));
    if (!valid) {
      this.kv.remove(RESIDUE_PROGRESS_KEY);
      return { progress: null, recovered: true };
    }
    return {
      progress: {
        cursor: candidate.cursor ?? null,
        cleanedFields: candidate.cleanedFields!,
        cleanedByTombstone: candidate.cleanedByTombstone ?? {},
        scannedProjects: candidate.scannedProjects!,
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
      },
      recovered: false,
    };
  }

  /** Persist the cursor, or refuse to pretend the run was recorded. */
  private writeProgress(progress: MigrationProgress | null): void {
    if (progress === null) {
      this.kv.remove(RESIDUE_PROGRESS_KEY);
      return;
    }
    if (!this.kv.set(RESIDUE_PROGRESS_KEY, { ...progress, updatedAt: Date.now() })) {
      throw new ResidueStorageError("Migration progress could not be saved; nothing is reported as complete.");
    }
  }

  /**
   * Move the cursor past one window without cleaning anything.
   *
   * The boot healer needs this: when a window contains no provable residue but
   * more projects remain, the scan must still advance or the same window is
   * re-read forever. Returns false when there was nothing left to advance past.
   */
  public advanceCursor(options: { limit?: number } = {}): boolean {
    const { progress } = this.readProgress();
    const all = this.sortedProjects();
    const after = progress?.cursor ? all.filter((project) => project.id > progress.cursor!) : all;
    const batch = typeof options.limit === "number" ? after.slice(0, Math.max(1, options.limit)) : after;
    if (batch.length === 0) {
      this.writeProgress(null);
      return false;
    }
    const completed = batch.length === after.length;
    this.writeProgress(
      completed
        ? null
        : {
            cursor: batch[batch.length - 1].id,
            cleanedFields: progress?.cleanedFields ?? 0,
            cleanedByTombstone: progress?.cleanedByTombstone ?? {},
            scannedProjects: (progress?.scannedProjects ?? 0) + batch.length,
            updatedAt: Date.now(),
          },
    );
    return !completed;
  }

  private sortedProjects(): LeluProject[] {
    return ProjectStore.getInstance()
      .list()
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Find and (unless dryRun) remove residue.
   *
   * `limit` bounds how many projects this call processes and stores a cursor;
   * a later call continues from it. An unbounded call processes everything and
   * clears the cursor.
   */
  public run(options: { dryRun?: boolean; limit?: number } = {}): ResidueReport {
    const startedAt = performance.now();
    const dryRun = options.dryRun ?? true;
    const projects = ProjectStore.getInstance();
    const tombstones: DeletionTombstone[] = DeletionLedger.getInstance().entries();
    // Built ONCE per run: rebuilding the window map per field was the migration's
    // dominant cost at 1,000 projects (see M22.6/migration-reliability-performance.md).
    const index: TombstoneIndex = buildTombstoneIndex(tombstones);
    const { progress: storedProgress, recovered } = this.readProgress();
    const resumed = Boolean(storedProgress?.cursor);

    const all = this.sortedProjects();
    const after = storedProgress?.cursor
      ? all.filter((project) => project.id > storedProgress.cursor!)
      : all;
    const batch = typeof options.limit === "number" ? after.slice(0, Math.max(1, options.limit)) : after;

    const findings: ResidueFinding[] = [];
    const quarantined: ResidueFinding[] = [];
    const dismissed = this.dismissedIds();
    let cleanedFields = storedProgress?.cleanedFields ?? 0;
    const cleanedByTombstone: Record<string, number> = { ...(storedProgress?.cleanedByTombstone ?? {}) };
    let scannedFields = 0;
    let skippedProjects = 0;

    for (const project of batch) {
      let cleanedProject: LeluProject | undefined;
      try {
        const fields = projectTextFields(project);
        scannedFields += fields.length;
        const hits: { field: FieldValue; tombstone: DeletionTombstone }[] = [];
        for (const field of fields) {
          const tombstone = index.bySize.size > 0 ? matchTombstoneIndex(field.text, index) : undefined;
          if (tombstone) hits.push({ field, tombstone });
        }

        if (hits.length > 0) {
          for (const hit of hits) {
            findings.push({
              id: `${project.id}:${hit.field.location}`,
              kind: hit.field.kind,
              projectId: project.id,
              projectName: project.name,
              location: hit.field.location,
              preview: previewOf(hit.field.text),
              reason: "tombstone",
              tombstoneId: hit.tombstone.id,
              tokens: tokensOf(hit.field.text),
            });
          }
          if (!dryRun) {
            cleanedProject = this.redact(projects, project, hits);
            cleanedFields += hits.length;
            for (const hit of hits) {
              cleanedByTombstone[hit.tombstone.id] = (cleanedByTombstone[hit.tombstone.id] ?? 0) + 1;
            }
          }
        }

        // Quarantine is computed from what is still there after cleaning.
        //
        // This used to re-read the project through the store, which lists and
        // re-parses the whole collection per call — O(projects²) across a scan.
        // Measured on 1,000 projects: 1,586 ms for a dry run. `redact()` already
        // returns what it wrote, so the updated record is used directly.
        const current = cleanedProject ?? project;
        const summary = current.checkpoint?.summary ?? "";
        const completed = current.checkpoint?.completed ?? [];
        const checkpointText = [summary, ...completed].filter(Boolean).join(" ");
        if (
          isLegacyCheckpoint(current) &&
          (index.bySize.size === 0 || matchTombstoneIndex(checkpointText, index) === undefined)
        ) {
          quarantined.push({
            id: `${current.id}:checkpoint`,
            kind: "checkpoint",
            projectId: current.id,
            projectName: current.name,
            location: "checkpoint",
            preview: previewOf(checkpointText),
            reason: "legacy-checkpoint",
            tokens: tokensOf(checkpointText),
          });
        }
      } catch (error) {
        // One unreadable project must not abort the scan, and it must not be
        // counted as clean either.
        skippedProjects += 1;
        console.warn("[ResidueMigration] project could not be scanned", {
          projectId: project?.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const completed = batch.length === after.length;
    const cursor = completed ? null : batch[batch.length - 1]?.id ?? null;

    let persisted = false;
    if (!dryRun) {
      // Progress first: if this fails the run is not recorded, so the error
      // propagates before the report claims anything was completed.
      this.writeProgress(
        cursor
          ? {
              cursor,
              cleanedFields,
              cleanedByTombstone,
              scannedProjects: (storedProgress?.scannedProjects ?? 0) + batch.length,
              updatedAt: Date.now(),
            }
          : null,
      );

      const report: ResidueReport = {
        version: RESIDUE_REPORT_VERSION,
        at: Date.now(),
        dryRun,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        tombstones: tombstones.length,
        scannedProjects: (storedProgress?.scannedProjects ?? 0) + batch.length,
        scannedFields,
        findings: findings.slice(-MAX_PERSISTED_FINDINGS).map(withoutPreview),
        cleanedFields,
        cleanedByTombstone,
        // Quarantined records still EXIST in storage, so their text is not
        // "deleted plaintext" — but it can be a quote of one. Persisting only
        // the location and reason keeps the audit without the text.
        quarantined: quarantined.filter((finding) => !dismissed.includes(finding.id)).map(withoutPreview),
        dismissed,
        reviewed: this.reviewedIds().length,
        cursor,
        remainingProjects: after.length - batch.length,
        resumed,
        recoveredCursor: recovered,
        skippedProjects,
        persisted: true,
      };
      if (!this.kv.set(RESIDUE_REPORT_KEY, report)) {
        throw new ResidueStorageError("Migration report could not be saved; the run is not recorded.");
      }
      persisted = true;
    }

    const liveQuarantined = quarantined.filter((finding) => !dismissed.includes(finding.id));
    return {
      version: RESIDUE_REPORT_VERSION,
      at: Date.now(),
      dryRun,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      tombstones: tombstones.length,
      scannedProjects: (storedProgress?.scannedProjects ?? 0) + batch.length,
      scannedFields,
      findings,
      cleanedFields,
      cleanedByTombstone,
      // The LIVE result keeps its previews so a person can recognise a record
      // and decide; only the persisted copy is text-free.
      quarantined: liveQuarantined,
      dismissed,
      reviewed: this.reviewedIds().length,
      cursor,
      remainingProjects: after.length - batch.length,
      resumed,
      recoveredCursor: recovered,
      skippedProjects,
      persisted,
    };
  }

  /** Keep the user's other fields; remove exactly the text that quotes a deleted memory. */
  private redact(
    store: ProjectStore,
    project: LeluProject,
    hits: { field: FieldValue; tombstone: DeletionTombstone }[],
  ): LeluProject | undefined {
    const doomed = new Set(hits.map((hit) => hit.field.location));
    const patch: Partial<LeluProject> = {};

    const checkpoint = project.checkpoint;
    if (checkpoint && hits.some((hit) => hit.field.kind === "checkpoint")) {
      const next: ProjectCheckpoint = {
        ...checkpoint,
        summary: doomed.has("checkpoint.summary") ? "" : checkpoint.summary,
        completed: checkpoint.completed.filter((_, index) => !doomed.has(`checkpoint.completed[${index}]`)),
        pending: checkpoint.pending.filter((_, index) => !doomed.has(`checkpoint.pending[${index}]`)),
        blockers: checkpoint.blockers.filter((_, index) => !doomed.has(`checkpoint.blockers[${index}]`)),
        nextAction: doomed.has("checkpoint.nextAction") ? null : checkpoint.nextAction,
      };
      patch.checkpoint = emptied(next) ? undefined : next;
    }

    if (doomed.has("originalRequest")) patch.originalRequest = undefined;
    if (doomed.has("objective")) patch.objective = undefined;
    if (doomed.has("context")) patch.context = undefined;
    if (project.executionPlan && project.executionPlan.some((_, index) => doomed.has(`executionPlan[${index}]`))) {
      patch.executionPlan = project.executionPlan.filter((_, index) => !doomed.has(`executionPlan[${index}]`));
    }
    if (project.actionableTasks && project.actionableTasks.some((_, index) => doomed.has(`actionableTasks[${index}]`))) {
      patch.actionableTasks = project.actionableTasks.filter((_, index) => !doomed.has(`actionableTasks[${index}]`));
    }
    if (project.items.some((_, index) => doomed.has(`items[${index}].title`) || doomed.has(`items[${index}].text`) || doomed.has(`items[${index}].ref`))) {
      patch.items = project.items.filter(
        (_, index) =>
          !doomed.has(`items[${index}].title`) &&
          !doomed.has(`items[${index}].text`) &&
          !doomed.has(`items[${index}].ref`),
      );
    }

    return store.update(project.id, patch);
  }

  /**
   * Explicit review of one quarantined checkpoint. Never deletes the project.
   *
   * The decision is appended to the disposition log — a durable record of what
   * a person decided and when — so it survives later runs, report rewrites and
   * restarts, and the same record is not asked about again.
   */
  public review(projectId: string, action: "forget" | "keep"): ResidueReport {
    const store = ProjectStore.getInstance();
    if (action === "forget") {
      store.clearCheckpoint(projectId);
    }
    const entries = this.dispositions().filter((entry) => entry.projectId !== projectId);
    entries.push({ projectId, action, at: Date.now() });
    if (!this.kv.set(RESIDUE_REVIEWS_KEY, { entries })) {
      throw new ResidueStorageError("Review decision could not be saved.");
    }
    return this.run({ dryRun: true });
  }

  /** Test/maintenance seam: forget the cursor so the next run scans everything. */
  public clearProgress(): void {
    this.kv.remove(RESIDUE_PROGRESS_KEY);
  }
}
