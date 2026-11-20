/**
 * ==========================================================
 * LÉLU
 * HISTORICAL MEMORY RESIDUE MIGRATION (M22.5)
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
 *   - auditable: every run's counts and findings are persisted.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import ProjectStore, { type LeluProject, type ProjectCheckpoint } from "../projects/ProjectStore";
import DeletionLedger, { matchTombstone, type DeletionTombstone } from "./DeletionLedger";

export const RESIDUE_REPORT_KEY = "memory.migration.v1";
export const RESIDUE_PROGRESS_KEY = "memory.migration.progress.v1";

/** Projects the old answered-turn writer created for itself. */
const AUTO_PROJECT_PREFIX = "Auto-created for ";

export interface ResidueFinding {
  /** Stable id for this finding: project + location. */
  id: string;
  kind: "checkpoint" | "project" | "item";
  projectId: string;
  projectName: string;
  /** Exact field, e.g. `checkpoint.summary` or `items[2].text`. */
  location: string;
  /** First 80 characters, for the review surface. */
  preview: string;
  reason: "tombstone" | "legacy-checkpoint";
  /** The tombstone that proves it, when there is one. */
  tombstoneId?: string;
}

export interface ResidueReport {
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
}

interface FieldValue {
  location: string;
  kind: ResidueFinding["kind"];
  text: string;
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
    // The old writer always set a summary; a checkpoint left with only a short
    // "reply" line is not worth guessing about and carries no quoted statement.
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

  /** What the user chose to keep, so the review surface stops asking. */
  private dismissedIds(): string[] {
    return this.report()?.dismissed ?? [];
  }

  private reviewedIds(): string[] {
    return (this.kv.get<{ ids: string[] }>(`${RESIDUE_REPORT_KEY}.reviewed`) ?? { ids: [] }).ids;
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
    const storedProgress = this.kv.get<{ cursor: string | null; cleanedFields: number; cleanedByTombstone: Record<string, number>; scannedProjects: number }>(RESIDUE_PROGRESS_KEY);
    const resumed = Boolean(storedProgress?.cursor);

    const all = projects.list().slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const after = storedProgress?.cursor ? all.filter((project) => project.id > storedProgress.cursor!) : all;
    const batch = typeof options.limit === "number" ? after.slice(0, Math.max(1, options.limit)) : after;

    const findings: ResidueFinding[] = [];
    const quarantined: ResidueFinding[] = [];
    const dismissed = this.dismissedIds();
    let cleanedFields = storedProgress?.cleanedFields ?? 0;
    const cleanedByTombstone: Record<string, number> = { ...(storedProgress?.cleanedByTombstone ?? {}) };
    let scannedFields = 0;

    for (const project of batch) {
      const fields = projectTextFields(project);
      scannedFields += fields.length;
      const hits: { field: FieldValue; tombstone: DeletionTombstone }[] = [];
      for (const field of fields) {
        const tombstone = matchTombstone(field.text, tombstones);
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
          });
        }
        if (!dryRun) {
          this.redact(projects, project, hits);
          cleanedFields += hits.length;
          for (const hit of hits) {
            cleanedByTombstone[hit.tombstone.id] = (cleanedByTombstone[hit.tombstone.id] ?? 0) + 1;
          }
        }
      }

      // Quarantine is computed from what is still there after cleaning.
      const current = projects.get(project.id) ?? project;
      if (isLegacyCheckpoint(current) && matchTombstone(
        [current.checkpoint?.summary, ...(current.checkpoint?.completed ?? [])].filter(Boolean).join(" "),
        tombstones,
      ) === undefined) {
        const text = [current.checkpoint?.summary, ...(current.checkpoint?.completed ?? [])].filter(Boolean).join(" ");
        quarantined.push({
          id: `${current.id}:checkpoint`,
          kind: "checkpoint",
          projectId: current.id,
          projectName: current.name,
          location: "checkpoint",
          preview: previewOf(text),
          reason: "legacy-checkpoint",
        });
      }
    }

    const completed = batch.length === after.length;
    const cursor = completed ? null : batch[batch.length - 1]?.id ?? null;

    if (!dryRun) {
      if (cursor) {
        this.kv.set(RESIDUE_PROGRESS_KEY, {
          cursor,
          cleanedFields,
          cleanedByTombstone,
          scannedProjects: (storedProgress?.scannedProjects ?? 0) + batch.length,
        });
      } else {
        this.kv.remove(RESIDUE_PROGRESS_KEY);
      }
    }

    const reviewed = this.reviewedIds();
    const report: ResidueReport = {
      at: Date.now(),
      dryRun,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      tombstones: tombstones.length,
      scannedProjects: (storedProgress?.scannedProjects ?? 0) + batch.length,
      scannedFields,
      findings,
      cleanedFields,
      cleanedByTombstone,
      quarantined: quarantined.filter((finding) => !dismissed.includes(finding.id)),
      dismissed,
      reviewed: reviewed.length,
      cursor,
      remainingProjects: after.length - batch.length,
      resumed,
    };

    // A dry run never overwrites the record of what was actually changed.
    if (!dryRun) {
      this.kv.set(RESIDUE_REPORT_KEY, { ...report, findings: [], quarantined: report.quarantined });
    }
    return report;
  }

  /** Keep the user's other fields; remove exactly the text that quotes a deleted memory. */
  private redact(
    store: ProjectStore,
    project: LeluProject,
    hits: { field: FieldValue; tombstone: DeletionTombstone }[],
  ): void {
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

    store.update(project.id, patch);
  }

  /** Explicit review of one quarantined checkpoint. Never deletes the project. */
  public review(projectId: string, action: "forget" | "keep"): ResidueReport {
    const store = ProjectStore.getInstance();
    if (action === "forget") {
      store.clearCheckpoint(projectId);
      const reviewed = this.reviewedIds();
      this.kv.set(`${RESIDUE_REPORT_KEY}.reviewed`, { ids: [...new Set([...reviewed, projectId])] });
    } else {
      const existing = this.report();
      const id = `${projectId}:checkpoint`;
      this.kv.set(RESIDUE_REPORT_KEY, {
        ...(existing ?? this.run({ dryRun: true })),
        dismissed: [...new Set([...(existing?.dismissed ?? []), id])],
      });
    }
    return this.run({ dryRun: true });
  }
}
