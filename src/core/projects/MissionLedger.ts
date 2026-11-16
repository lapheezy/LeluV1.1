/**
 * ==========================================================
 * LÉLU — MISSION CONTINUITY LEDGER
 *
 * Mission 14's answer to "don't lose the plot when a
 * conversation ends."
 *
 * Existing systems already answer narrower questions:
 *
 *   ProjectStore        what a creative project contains
 *   ProjectMission      why LÉLU exists (north star)
 *   OperationalModel    whether a capability can run
 *   ImprovementQueue    what should be improved next
 *
 * None of them record a WORKSTREAM: the mission, where it lives
 * (repo/branch/commit), who owns it, what changed, what is
 * blocked, what evidence supports its status, and the next SAFE
 * action. That is what this ledger stores — one durable record
 * per workstream, offline-first through the shared KvStore.
 *
 * Honesty rules enforced here:
 *   - every free-text write is secret-redacted before storage;
 *   - an unverified import is REPORTED, never VERIFIED;
 *   - if the store refuses the write, the record says
 *     "memory-only" instead of claiming durability;
 *   - remote merges never overwrite a newer local record;
 *   - nothing is deleted — abandonment is a status.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import {
  redactText,
  type MissionEvidence,
} from "../operational-intelligence/evidence.ts";

export const MISSION_STATUSES = ["active", "paused", "blocked", "completed", "abandoned"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export type MissionOwner = "user" | "lelu" | "agent" | "unknown";

/**
 * How far a record has travelled beyond this browser.
 *
 * There is no mission sync transport in this build, so every write starts at
 * `local`. The other values exist so a future transport can report them
 * honestly instead of overloading `durability` (which only says whether the
 * local write reached a storage backend). A local record is never described
 * as synchronized merely because it was saved.
 */
export type MissionSyncState =
  | "local"
  | "queued"
  | "synchronizing"
  | "synchronized"
  | "conflict"
  | "failed";

export type MissionLogKind =
  | "created"
  | "status"
  | "evidence"
  | "file"
  | "decision"
  | "blocker"
  | "blocker-cleared"
  | "next-action"
  | "note"
  | "duplicate"
  | "merged";

export interface MissionLogEntry {
  at: number;
  kind: MissionLogKind;
  detail: string;
  evidence: MissionEvidence;
  source?: string;
}

export interface MissionBlocker {
  id: string;
  text: string;
  raisedAt: number;
  clearedAt?: number;
  evidence: MissionEvidence;
}

export interface MissionProvenance {
  createdBy: string;
  /** Free-form session/chat marker, when the writer has one. */
  session?: string;
}

export interface MissionRecord {
  id: string;
  title: string;
  objective: string;
  owner: MissionOwner;
  status: MissionStatus;
  evidence: MissionEvidence;
  repository?: string;
  branch?: string;
  commit?: string;
  files: string[];
  decisions: string[];
  blockers: MissionBlocker[];
  dependencies: string[];
  nextSafeAction: string | null;
  provenance: MissionProvenance;
  /** The stable id of the record this one duplicates, when known. */
  duplicateOf?: string;
  createdAt: number;
  updatedAt: number;
  /** Monotonic local revision. Incremented by every local mutation. */
  revision: number;
  /** Bounded, newest-first? No — chronological, oldest first. */
  log: MissionLogEntry[];
  /** Whether the LAST write actually reached a storage backend. */
  durability: "persisted" | "memory-only";
  /** Whether this record has been queued/synchronized, never inferred from durability. */
  sync?: MissionSyncState;
}

export interface MissionSnapshot {
  version: 1;
  exportedAt: number;
  missions: MissionRecord[];
}

/** What the last local load could recover from storage. */
export interface MissionRecoveryReport {
  loaded: number;
  rejected: number;
  duplicateIdsRemoved: number;
  source: "empty" | "storage" | "corrupt";
  storageError: boolean;
}

/** Counts across the whole local ledger, never evidence of remote success. */
export interface MissionSyncSummary {
  total: number;
  local: number;
  queued: number;
  synchronizing: number;
  synchronized: number;
  conflict: number;
  failed: number;
}

export interface CreateMissionInput {
  title: string;
  objective?: string;
  owner?: MissionOwner;
  status?: MissionStatus;
  evidence?: MissionEvidence;
  repository?: string;
  branch?: string;
  commit?: string;
  dependencies?: string[];
  nextSafeAction?: string | null;
  files?: string[];
  provenance?: Partial<MissionProvenance>;
  duplicateOf?: string;
}

export interface MissionPatch {
  title?: string;
  objective?: string;
  owner?: MissionOwner;
  repository?: string;
  branch?: string;
  commit?: string;
  dependencies?: string[];
  duplicateOf?: string | null;
}

const KEY = "lelu.missions.v1";
const LOG_LIMIT = 80;
const FILE_LIMIT = 200;
const BLOCKER_LIMIT = 40;
const DECISION_LIMIT = 60;
const DEPENDENCY_LIMIT = 40;

const STATUS_ORDER: Record<MissionStatus, number> = {
  blocked: 0,
  active: 1,
  paused: 2,
  completed: 3,
  abandoned: 4,
};

function isStatus(value: unknown): value is MissionStatus {
  return typeof value === "string" && (MISSION_STATUSES as readonly string[]).includes(value);
}

function isSyncState(value: unknown): value is MissionSyncState {
  return (
    value === "local" ||
    value === "queued" ||
    value === "synchronizing" ||
    value === "synchronized" ||
    value === "conflict" ||
    value === "failed"
  );
}

function revisionOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}

function isEvidence(value: unknown): value is MissionEvidence {
  return (
    value === "VERIFIED" ||
    value === "REPORTED" ||
    value === "PARTIAL" ||
    value === "BLOCKED" ||
    value === "UNAVAILABLE" ||
    value === "PROPOSED" ||
    value === "SIMULATED"
  );
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? redactText(value).trim() : fallback;
}

function list(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => redactText(item).trim())
    .filter(Boolean)
    .slice(-limit);
}

function newId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRecord(raw: unknown, at: number): MissionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  const title = typeof item.title === "string" ? redactText(item.title).trim() : "";
  if (!id || !title) return null;

  const status = isStatus(item.status) ? item.status : "active";
  const evidence = isEvidence(item.evidence) ? item.evidence : "REPORTED";
  const owner =
    item.owner === "user" || item.owner === "lelu" || item.owner === "agent" ? item.owner : "unknown";

  const blockers: MissionBlocker[] = Array.isArray(item.blockers)
    ? item.blockers
        .map((blocker): MissionBlocker | null => {
          if (!blocker || typeof blocker !== "object") return null;
          const b = blocker as Record<string, unknown>;
          if (typeof b.text !== "string" || !b.text.trim()) return null;
          return {
            id: typeof b.id === "string" ? b.id : newId("blocker"),
            text: redactText(b.text).trim(),
            raisedAt: typeof b.raisedAt === "number" ? b.raisedAt : at,
            ...(typeof b.clearedAt === "number" ? { clearedAt: b.clearedAt } : {}),
            evidence: isEvidence(b.evidence) ? b.evidence : "REPORTED",
          };
        })
        .filter((blocker): blocker is MissionBlocker => blocker !== null)
        .slice(-BLOCKER_LIMIT)
    : [];

  const log: MissionLogEntry[] = Array.isArray(item.log)
    ? item.log
        .map((entry): MissionLogEntry | null => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          if (typeof e.detail !== "string") return null;
          return {
            at: typeof e.at === "number" ? e.at : at,
            kind: (typeof e.kind === "string" ? e.kind : "note") as MissionLogKind,
            detail: redactText(e.detail).trim(),
            evidence: isEvidence(e.evidence) ? e.evidence : "REPORTED",
            ...(typeof e.source === "string" ? { source: e.source } : {}),
          };
        })
        .filter((entry): entry is MissionLogEntry => entry !== null)
        .slice(-LOG_LIMIT)
    : [];

  return {
    id,
    title,
    objective: text(item.objective),
    owner,
    status,
    evidence,
    ...(typeof item.repository === "string" ? { repository: text(item.repository) } : {}),
    ...(typeof item.branch === "string" ? { branch: text(item.branch) } : {}),
    ...(typeof item.commit === "string" ? { commit: text(item.commit) } : {}),
    files: list(item.files, FILE_LIMIT),
    decisions: list(item.decisions, DECISION_LIMIT),
    blockers,
    dependencies: list(item.dependencies, DEPENDENCY_LIMIT),
    nextSafeAction: typeof item.nextSafeAction === "string" ? redactText(item.nextSafeAction).trim() || null : null,
    ...(typeof item.duplicateOf === "string" && item.duplicateOf.trim()
      ? { duplicateOf: item.duplicateOf.trim() }
      : {}),
    provenance: {
      createdBy:
        item.provenance && typeof item.provenance === "object" && typeof (item.provenance as Record<string, unknown>).createdBy === "string"
          ? redactText(String((item.provenance as Record<string, unknown>).createdBy)).trim() || "unknown"
          : "unknown",
      ...(item.provenance &&
      typeof item.provenance === "object" &&
      typeof (item.provenance as Record<string, unknown>).session === "string"
        ? { session: redactText(String((item.provenance as Record<string, unknown>).session)).trim() }
        : {}),
    },
    createdAt: typeof item.createdAt === "number" ? item.createdAt : at,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : at,
    revision: revisionOf(item.revision),
    log,
    // A record read from storage WAS stored; the flag is re-evaluated on
    // the next write. It never means "written by this process".
    durability: "persisted",
    sync: isSyncState(item.sync) ? item.sync : "local",
  };
}

export class MissionLedger {
  private missions: MissionRecord[] = [];
  private recovery: MissionRecoveryReport = {
    loaded: 0,
    rejected: 0,
    duplicateIdsRemoved: 0,
    source: "empty",
    storageError: false,
  };
  private readonly kv: KvStore;
  private readonly now: () => number;

  constructor(options: { kv?: KvStore; now?: () => number } = {}) {
    this.kv = options.kv ?? KvStore.getInstance();
    this.now = options.now ?? (() => Date.now());
    this.load();
  }

  private load(): void {
    let stored: { version?: unknown; missions?: unknown } | null = null;
    let storageError = false;
    try {
      stored = this.kv.get<{ version?: unknown; missions?: unknown }>(KEY);
    } catch {
      storageError = true;
    }

    const corrupt = !storageError && stored !== null && !Array.isArray(stored?.missions);
    const raw = stored && Array.isArray(stored.missions) ? stored.missions : [];
    const at = this.now();
    const accepted: MissionRecord[] = [];
    const seen = new Set<string>();
    let rejected = 0;
    let duplicateIdsRemoved = 0;

    for (const item of raw) {
      const record = normalizeRecord(item, at);
      if (!record) {
        rejected += 1;
        continue;
      }
      // A duplicate id is ambiguous ownership, not a second mission. Keep the
      // first valid copy and report the second rather than letting a corrupt
      // write silently replace the record it collided with.
      if (seen.has(record.id)) {
        duplicateIdsRemoved += 1;
        continue;
      }
      seen.add(record.id);
      accepted.push(record);
    }

    this.missions = accepted;
    this.recovery = {
      loaded: accepted.length,
      rejected,
      duplicateIdsRemoved,
      source: corrupt || storageError ? "corrupt" : stored === null ? "empty" : "storage",
      storageError,
    };
  }

  /** What the constructor recovered, for diagnostics and tests. */
  public recoveryReport(): MissionRecoveryReport {
    return { ...this.recovery };
  }

  /**
   * Write every mission and report whether a backend accepted it.
   * A failure is recorded on each record, because "saved" and
   * "silently dropped" must never look the same to cognition.
   */
  private save(): boolean {
    let persisted = false;
    try {
      persisted = this.kv.set(KEY, { version: 1, missions: this.missions });
    } catch {
      persisted = false;
    }
    for (const mission of this.missions) {
      mission.durability = persisted ? "persisted" : "memory-only";
    }
    return persisted;
  }

  private touch(mission: MissionRecord): void {
    mission.updatedAt = this.now();
    mission.revision = revisionOf(mission.revision) + 1;
    // Every caller of touch() is a LOCAL change. A record imported or
    // acknowledged as synchronized must not keep that label after this device
    // edits it: there is no mission sync transport in this build, so the edit
    // exists only here until a future transport says otherwise.
    mission.sync = "local";
  }

  private logEntry(
    mission: MissionRecord,
    kind: MissionLogKind,
    detail: string,
    evidence: MissionEvidence = mission.evidence,
    source?: string,
  ): void {
    mission.log.push({
      at: this.now(),
      kind,
      detail: redactText(detail).trim(),
      evidence,
      ...(source ? { source } : {}),
    });
    if (mission.log.length > LOG_LIMIT) mission.log.splice(0, mission.log.length - LOG_LIMIT);
  }

  /* ------------------------------- reads ------------------------------- */

  public list(): MissionRecord[] {
    return [...this.missions].sort((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return byStatus !== 0 ? byStatus : b.updatedAt - a.updatedAt;
    });
  }

  public get(id: string): MissionRecord | null {
    return this.missions.find((mission) => mission.id === id) ?? null;
  }

  /** Missions that still need work, most urgent first. */
  public open(): MissionRecord[] {
    return this.list().filter((mission) => mission.status !== "completed" && mission.status !== "abandoned");
  }

  /**
   * Aggregate local sync labels. This reports what the ledger actually knows;
   * it never infers `synchronized` from a storage write or cloud connectivity.
   */
  public syncSummary(): MissionSyncSummary {
    const summary: MissionSyncSummary = {
      total: this.missions.length,
      local: 0,
      queued: 0,
      synchronizing: 0,
      synchronized: 0,
      conflict: 0,
      failed: 0,
    };
    for (const mission of this.missions) {
      const sync = mission.sync ?? "local";
      summary[sync] += 1;
    }
    return summary;
  }

  /* ------------------------------- writes ------------------------------ */

  public create(input: CreateMissionInput): { ok: boolean; mission?: MissionRecord; error?: string; durability: string } {
    const title = text(input.title);
    if (!title) return { ok: false, error: "a mission needs a title", durability: "memory-only" };
    const id = newId("m");
    let duplicateOf: string | undefined;
    if (input.duplicateOf) {
      const requested = text(input.duplicateOf);
      const canonical = requested ? this.canonicalTarget(id, requested) : null;
      if (!canonical) {
        return {
          ok: false,
          error: `the canonical mission "${requested}" does not exist or is not a valid canonical record`,
          durability: "memory-only",
        };
      }
      // A duplicate of a duplicate belongs to the ROOT, never to the middle of
      // the chain. This is the same rule markDuplicate and update use.
      duplicateOf = canonical.id;
    }

    const at = this.now();
    const mission: MissionRecord = {
      id,
      title,
      objective: text(input.objective),
      owner:
        input.owner === "user" || input.owner === "lelu" || input.owner === "agent"
          ? input.owner
          : "unknown",
      status: duplicateOf ? "abandoned" : isStatus(input.status) ? input.status : "active",
      evidence: isEvidence(input.evidence) ? input.evidence : "REPORTED",
      ...(input.repository ? { repository: text(input.repository) } : {}),
      ...(input.branch ? { branch: text(input.branch) } : {}),
      ...(input.commit ? { commit: text(input.commit) } : {}),
      files: list(input.files ?? [], FILE_LIMIT),
      decisions: [],
      blockers: [],
      dependencies: list(input.dependencies ?? [], DEPENDENCY_LIMIT),
      nextSafeAction: input.nextSafeAction ? text(input.nextSafeAction) : null,
      ...(duplicateOf ? { duplicateOf } : {}),
      sync: "local",
      provenance: {
        createdBy: text(input.provenance?.createdBy ?? "lelu") || "lelu",
        ...(input.provenance?.session ? { session: text(input.provenance.session) } : {}),
      },
      createdAt: at,
      updatedAt: at,
      revision: 1,
      log: [],
      durability: "memory-only",
    };
    this.logEntry(mission, "created", `Mission opened: ${title}`, mission.evidence, "mission-ledger");
    this.missions.push(mission);
    const persisted = this.save();
    return { ok: true, mission, durability: persisted ? "persisted" : "memory-only" };
  }

  public update(id: string, patch: MissionPatch): MissionRecord | null {
    const mission = this.get(id);
    if (!mission) return null;
    // An abandoned duplicate is history. Updating it directly would let a
    // retry diverge from the canonical record while looking authoritative;
    // callers must resolve the canonical id first.
    if (mission.duplicateOf) return null;
    if (patch.title !== undefined) {
      const title = text(patch.title);
      if (title) mission.title = title;
    }
    if (patch.objective !== undefined) mission.objective = text(patch.objective);
    if (patch.owner !== undefined) mission.owner = patch.owner;
    if (patch.repository !== undefined) mission.repository = text(patch.repository) || undefined;
    if (patch.branch !== undefined) mission.branch = text(patch.branch) || undefined;
    if (patch.commit !== undefined) mission.commit = text(patch.commit) || undefined;
    if (patch.dependencies !== undefined) mission.dependencies = list(patch.dependencies, DEPENDENCY_LIMIT);
    if (patch.duplicateOf !== undefined) {
      const canonicalId = patch.duplicateOf ? text(patch.duplicateOf) : "";
      if (!canonicalId) {
        delete mission.duplicateOf;
      } else {
        const canonical = this.canonicalTarget(mission.id, canonicalId);
        if (!canonical) return null;
        mission.duplicateOf = canonical.id;
        if (mission.status !== "abandoned") mission.status = "abandoned";
        this.logEntry(mission, "duplicate", `Duplicate of ${canonical.id}`, mission.evidence, "mission-ledger");
      }
    }
    this.touch(mission);
    this.save();
    return mission;
  }

  public setStatus(id: string, status: MissionStatus, note?: string): MissionRecord | null {
    const mission = this.get(id);
    if (!mission || !isStatus(status)) return null;
    const previous = mission.status;
    mission.status = status;
    this.logEntry(
      mission,
      "status",
      note ? `${previous} → ${status}: ${note}` : `${previous} → ${status}`,
      mission.evidence,
      "mission-ledger",
    );
    this.touch(mission);
    this.save();
    return mission;
  }

  public setEvidence(id: string, evidence: MissionEvidence, basis: string): MissionRecord | null {
    const mission = this.get(id);
    if (!mission || !isEvidence(evidence)) return null;
    if (!redactText(basis).trim()) return null;
    mission.evidence = evidence;
    this.logEntry(mission, "evidence", basis, evidence, "mission-ledger");
    this.touch(mission);
    this.save();
    return mission;
  }

  public addFile(id: string, path: string): MissionRecord | null {
    const mission = this.get(id);
    const file = text(path);
    if (!mission || !file) return null;
    if (!mission.files.includes(file)) mission.files.push(file);
    if (mission.files.length > FILE_LIMIT) mission.files.splice(0, mission.files.length - FILE_LIMIT);
    this.logEntry(mission, "file", file, mission.evidence, "mission-ledger");
    this.touch(mission);
    this.save();
    return mission;
  }

  public addDecision(id: string, decision: string): MissionRecord | null {
    const mission = this.get(id);
    const entry = text(decision);
    if (!mission || !entry) return null;
    mission.decisions.push(entry);
    if (mission.decisions.length > DECISION_LIMIT) mission.decisions.splice(0, mission.decisions.length - DECISION_LIMIT);
    this.logEntry(mission, "decision", entry, mission.evidence, "mission-ledger");
    this.touch(mission);
    this.save();
    return mission;
  }

  public addBlocker(
    id: string,
    blockerText: string,
    evidence: MissionEvidence = "REPORTED",
  ): MissionRecord | null {
    const mission = this.get(id);
    const detail = text(blockerText);
    if (!mission || !detail) return null;
    mission.blockers.push({
      id: newId("blocker"),
      text: detail,
      raisedAt: this.now(),
      evidence: isEvidence(evidence) ? evidence : "REPORTED",
    });
    if (mission.blockers.length > BLOCKER_LIMIT) mission.blockers.splice(0, mission.blockers.length - BLOCKER_LIMIT);
    if (mission.status === "active") mission.status = "blocked";
    this.logEntry(mission, "blocker", detail, isEvidence(evidence) ? evidence : "REPORTED", "mission-ledger");
    this.touch(mission);
    this.save();
    return mission;
  }

  /** Clear the blocker with this id, or the most recent open one. */
  public clearBlocker(id: string, blockerId?: string, note?: string): MissionRecord | null {
    const mission = this.get(id);
    if (!mission) return null;
    const open = mission.blockers.filter((blocker) => blocker.clearedAt === undefined);
    const target = blockerId ? open.find((blocker) => blocker.id === blockerId) : open[open.length - 1];
    if (!target) return null;
    target.clearedAt = this.now();
    if (mission.blockers.every((blocker) => blocker.clearedAt !== undefined) && mission.status === "blocked") {
      mission.status = "active";
    }
    this.logEntry(
      mission,
      "blocker-cleared",
      note ? `${target.text} — ${note}` : target.text,
      mission.evidence,
      "mission-ledger",
    );
    this.touch(mission);
    this.save();
    return mission;
  }

  public setNextAction(id: string, action: string | null): MissionRecord | null {
    const mission = this.get(id);
    if (!mission) return null;
    mission.nextSafeAction = action ? text(action) || null : null;
    this.logEntry(
      mission,
      "next-action",
      mission.nextSafeAction ?? "No safe next action is known yet.",
      mission.evidence,
      "mission-ledger",
    );
    this.touch(mission);
    this.save();
    return mission;
  }

  /**
   * Mark a record as a duplicate of a canonical one. The duplicate is
   * abandoned rather than deleted, so the history and its original session
   * survive, while open lists stop offering two identical titles. Refuses a
   * self-reference or a canonical id that does not exist.
   */
  public markDuplicate(id: string, canonicalId: string, note?: string): MissionRecord | null {
    const mission = this.get(id);
    const canonical = mission ? this.canonicalTarget(id, canonicalId) : null;
    if (!mission || !canonical) return null;
    mission.duplicateOf = canonical.id;
    if (mission.status !== "abandoned") mission.status = "abandoned";
    this.logEntry(
      mission,
      "duplicate",
      note ? `Duplicate of ${canonical.id}: ${note}` : `Duplicate of ${canonical.id}`,
      mission.evidence,
      "mission-ledger",
    );
    this.touch(mission);
    this.save();
    return mission;
  }

  /**
   * Follow a duplicate chain to the canonical original. Refuses a missing,
   * self-referential or cyclic target instead of creating an unresolvable
   * record. The returned record is the one history belongs to.
   */
  private canonicalTarget(id: string, canonicalId: string): MissionRecord | null {
    if (!canonicalId || id === canonicalId) return null;
    let current = this.get(canonicalId);
    if (!current) return null;
    const seen = new Set<string>([id]);
    while (current.duplicateOf) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      const parent = this.get(current.duplicateOf);
      if (!parent) return null;
      current = parent;
    }
    return current.id === id ? null : current;
  }

  /** Resolve the canonical record and the record the caller named. */
  public resolveCanonical(id: string): { requested: MissionRecord; canonical: MissionRecord } | null {
    const requested = this.get(id);
    if (!requested) return null;
    const seen = new Set<string>();
    let canonical = requested;
    while (canonical.duplicateOf) {
      if (seen.has(canonical.id)) break;
      seen.add(canonical.id);
      const next = this.get(canonical.duplicateOf);
      if (!next) break;
      canonical = next;
    }
    return { requested, canonical };
  }

  /**
   * Resolve a mission by stable id or by its own words, not by title alone.
   * A shared title is common after a retry (two records opened for one job);
   * the id, status, objective, project identity and provenance are what tell
   * them apart. Results are ranked, never silently collapsed.
   */
  public find(
    query: string,
    options: { status?: MissionStatus; repository?: string; branch?: string; includeClosed?: boolean } = {},
  ): MissionRecord[] {
    const needle = text(query).toLowerCase();
    if (!needle) return [];
    const tokens = needle.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
    const all = this.list();
    // An exact stable id is always resolvable, including an abandoned
    // duplicate. Hiding it by default would make the record impossible to
    // audit after a duplicate merge; the status still says it is abandoned.
    const exactId = all.find((mission) => mission.id.toLowerCase() === needle);
    const candidates = all.filter((mission) => {
      if (!options.includeClosed && mission.status !== "active" && mission.status !== "paused" && mission.status !== "blocked") {
        if (mission.id !== exactId?.id) return false;
      }
      if (options.status && mission.status !== options.status) return false;
      if (options.repository && mission.repository !== options.repository) return false;
      if (options.branch && mission.branch !== options.branch) return false;
      return true;
    });

    const scored = candidates.map((mission) => {
      const fields = [
        mission.id,
        mission.title,
        mission.objective,
        mission.nextSafeAction ?? "",
        mission.repository ?? "",
        mission.branch ?? "",
        mission.provenance.createdBy,
        ...mission.decisions,
        ...mission.files,
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      if (mission.id.toLowerCase() === needle) score += 1_000;
      else if (mission.id.toLowerCase().includes(needle)) score += 300;
      if (mission.title.toLowerCase() === needle) score += 200;
      else if (mission.title.toLowerCase().includes(needle)) score += 100;
      if (mission.objective.toLowerCase().includes(needle)) score += 50;
      for (const token of tokens) if (fields.includes(token)) score += 5;
      if (mission.duplicateOf) score -= 40;
      if (mission.status === "blocked") score += 2;
      return { mission, score };
    });

    return scored
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          STATUS_ORDER[a.mission.status] - STATUS_ORDER[b.mission.status] ||
          b.mission.updatedAt - a.mission.updatedAt,
      )
      .slice(0, 5)
      .map((entry) => entry.mission);
  }

  public note(id: string, note: string, evidence: MissionEvidence = "REPORTED"): MissionRecord | null {
    const mission = this.get(id);
    const detail = text(note);
    if (!mission || !detail) return null;
    this.logEntry(mission, "note", detail, isEvidence(evidence) ? evidence : "REPORTED", "mission-ledger");
    this.touch(mission);
    this.save();
    return mission;
  }

  /* -------------------------- sync and recovery ------------------------ */

  public export(): MissionSnapshot {
    return { version: 1, exportedAt: this.now(), missions: this.list() };
  }

  /**
   * Merge another device's records without discarding newer local work.
   * A record only replaces the local one when its updatedAt is strictly
   * newer; ties keep local. Deletion is never inferred from absence.
   */
  public mergeRemote(records: MissionRecord[]): { merged: number; kept: number; persisted: boolean } {
    const byId = new Map(this.missions.map((mission) => [mission.id, mission]));
    const knownIds = new Set<string>([
      ...byId.keys(),
      ...records
        .map((record) => (record && typeof record === "object" ? record.id : ""))
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ]);
    let merged = 0;
    let kept = 0;
    const at = this.now();
    for (const remote of records) {
      const normalized = normalizeRecord(remote, at);
      if (!normalized) continue;
      // A duplicate relationship that points outside the merged set is
      // corrupt provenance. Refuse it rather than importing an orphan whose
      // canonical owner cannot be resolved.
      if (normalized.duplicateOf && !knownIds.has(normalized.duplicateOf)) {
        kept += 1;
        continue;
      }
      const current = byId.get(normalized.id);
      const newer =
        !current ||
        normalized.updatedAt > current.updatedAt ||
        (normalized.updatedAt === current.updatedAt && normalized.revision > current.revision);
      if (newer) {
        normalized.durability = "persisted";
        byId.set(normalized.id, normalized);
        merged += 1;
      } else {
        kept += 1;
      }
    }
    if (merged > 0) {
      this.missions = [...byId.values()];
      const persisted = this.save();
      return { merged, kept, persisted };
    }
    return { merged, kept, persisted: true };
  }

  /* ------------------------------- briefs ------------------------------ */

  public brief(id: string): string {
    const resolved = this.resolveCanonical(id);
    if (!resolved) return `No mission named "${id}".`;
    const requested = resolved.requested;
    const mission = resolved.canonical;
    const redirect =
      requested.id === mission.id
        ? ""
        : `Requested ${requested.id} is a duplicate of ${mission.id}; the canonical record is shown.\n\n`;
    return `${redirect}${formatMission(mission)}`;
  }

  /**
   * The resumable brief: everything that still needs work, with its
   * next safe action. This is what a new session should read first.
   */
  public resumeBrief(): string {
    const open = this.open();
    if (open.length === 0) {
      return "MISSION CONTINUITY: no open workstreams are recorded. Nothing is being carried over.";
    }
    const memoryOnly = open.filter((mission) => mission.durability === "memory-only").length;
    const lines = [
      `MISSION CONTINUITY — ${open.length} open workstream${open.length === 1 ? "" : "s"}` +
        (memoryOnly > 0 ? ` (${memoryOnly} not durably stored)` : ""),
      ...open.map((mission) => {
        const next = mission.nextSafeAction ?? "no safe next action recorded";
        const blockers = mission.blockers.filter((blocker) => blocker.clearedAt === undefined);
        return [
          `- [${mission.status.toUpperCase()} · ${mission.evidence}] ${mission.title} (${mission.id})`,
          mission.objective ? `  objective: ${mission.objective}` : "",
          `  next safe action: ${next}`,
          blockers.length > 0 ? `  blocked by: ${blockers.map((blocker) => blocker.text).join("; ")}` : "",
          mission.branch ? `  where: ${mission.repository ?? "repo"} @ ${mission.branch}${mission.commit ? ` (${mission.commit.slice(0, 12)})` : ""}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ];
    return lines.join("\n");
  }
}

export function formatMission(mission: MissionRecord): string {
  const blockers = mission.blockers.filter((blocker) => blocker.clearedAt === undefined);
  return [
    `${mission.title} (${mission.id})`,
    `  status: ${mission.status} · evidence: ${mission.evidence} · owner: ${mission.owner}`,
    `  identity: ${mission.id} · revision ${mission.revision} · created by ${mission.provenance.createdBy}` +
      `${mission.provenance.session ? ` (session ${mission.provenance.session})` : ""} · created ${new Date(mission.createdAt).toISOString()}`,
    mission.duplicateOf ? `  duplicate of: ${mission.duplicateOf}` : "",
    mission.objective ? `  objective: ${mission.objective}` : "",
    mission.repository || mission.branch || mission.commit
      ? `  where: ${mission.repository ?? "unknown repo"}${mission.branch ? ` @ ${mission.branch}` : ""}${mission.commit ? ` (${mission.commit})` : ""}`
      : "",
    `  next safe action: ${mission.nextSafeAction ?? "none recorded"}`,
    blockers.length > 0 ? `  blockers: ${blockers.map((blocker) => `${blocker.text} [${blocker.evidence}]`).join("; ")}` : "",
    mission.files.length > 0 ? `  files: ${mission.files.slice(-8).join(", ")}` : "",
    mission.decisions.length > 0 ? `  decisions: ${mission.decisions.slice(-3).join(" · ")}` : "",
    mission.dependencies.length > 0 ? `  depends on: ${mission.dependencies.join(", ")}` : "",
    `  durability: ${mission.durability} · sync: ${mission.sync ?? "local"}${mission.sync === "synchronized" ? "" : " (not synchronized)"} · updated ${new Date(mission.updatedAt).toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

let instance: MissionLedger | null = null;

export default class MissionLedgerStore {
  public static getInstance(): MissionLedger {
    if (!instance) instance = new MissionLedger();
    return instance;
  }

  /** Test seam: replace the singleton with a fresh, isolated ledger. */
  public static setForTests(ledger: MissionLedger | null): void {
    instance = ledger;
  }
}
