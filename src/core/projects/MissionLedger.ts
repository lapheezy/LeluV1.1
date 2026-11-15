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
  /** Bounded, newest-first? No — chronological, oldest first. */
  log: MissionLogEntry[];
  /** Whether the LAST write actually reached a storage backend. */
  durability: "persisted" | "memory-only";
}

export interface MissionSnapshot {
  version: 1;
  exportedAt: number;
  missions: MissionRecord[];
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
    ...(typeof item.repository === "string" ? { repository: item.repository } : {}),
    ...(typeof item.branch === "string" ? { branch: item.branch } : {}),
    ...(typeof item.commit === "string" ? { commit: item.commit } : {}),
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
          ? String((item.provenance as Record<string, unknown>).createdBy)
          : "unknown",
      ...(item.provenance &&
      typeof item.provenance === "object" &&
      typeof (item.provenance as Record<string, unknown>).session === "string"
        ? { session: String((item.provenance as Record<string, unknown>).session) }
        : {}),
    },
    createdAt: typeof item.createdAt === "number" ? item.createdAt : at,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : at,
    log,
    // A record read from storage WAS stored; the flag is re-evaluated on
    // the next write. It never means "written by this process".
    durability: "persisted",
  };
}

export class MissionLedger {
  private missions: MissionRecord[] = [];
  private readonly kv: KvStore;
  private readonly now: () => number;

  constructor(options: { kv?: KvStore; now?: () => number } = {}) {
    this.kv = options.kv ?? KvStore.getInstance();
    this.now = options.now ?? (() => Date.now());
    this.load();
  }

  private load(): void {
    let stored: { version?: unknown; missions?: unknown } | null = null;
    try {
      stored = this.kv.get<{ version?: unknown; missions?: unknown }>(KEY);
    } catch {
      stored = null;
    }
    const raw = stored && Array.isArray(stored.missions) ? stored.missions : [];
    const at = this.now();
    this.missions = raw
      .map((item) => normalizeRecord(item, at))
      .filter((item): item is MissionRecord => item !== null);
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

  /* ------------------------------- writes ------------------------------ */

  public create(input: CreateMissionInput): { ok: boolean; mission?: MissionRecord; error?: string; durability: string } {
    const title = text(input.title);
    if (!title) return { ok: false, error: "a mission needs a title", durability: "memory-only" };

    const at = this.now();
    const mission: MissionRecord = {
      id: newId("m"),
      title,
      objective: text(input.objective),
      owner: input.owner ?? "unknown",
      status: input.status ?? "active",
      evidence: input.evidence ?? "REPORTED",
      ...(input.repository ? { repository: input.repository } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.commit ? { commit: input.commit } : {}),
      files: list(input.files ?? [], FILE_LIMIT),
      decisions: [],
      blockers: [],
      dependencies: list(input.dependencies ?? [], DEPENDENCY_LIMIT),
      nextSafeAction: input.nextSafeAction ? text(input.nextSafeAction) : null,
      ...(input.duplicateOf ? { duplicateOf: text(input.duplicateOf) } : {}),
      provenance: {
        createdBy: input.provenance?.createdBy ?? "lelu",
        ...(input.provenance?.session ? { session: input.provenance.session } : {}),
      },
      createdAt: at,
      updatedAt: at,
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
      const canonical = patch.duplicateOf ? text(patch.duplicateOf) : "";
      if (canonical && canonical !== mission.id && this.get(canonical)) mission.duplicateOf = canonical;
      if (!canonical) delete mission.duplicateOf;
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
    const canonical = this.get(canonicalId);
    if (!mission || !canonical || id === canonicalId) return null;
    mission.duplicateOf = canonicalId;
    if (mission.status !== "abandoned") mission.status = "abandoned";
    this.logEntry(
      mission,
      "duplicate",
      note ? `Duplicate of ${canonicalId}: ${note}` : `Duplicate of ${canonicalId}`,
      mission.evidence,
      "mission-ledger",
    );
    this.touch(mission);
    this.save();
    return mission;
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
    const candidates = (options.includeClosed ? this.list() : this.open()).filter((mission) => {
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
    let merged = 0;
    let kept = 0;
    const at = this.now();
    for (const remote of records) {
      const normalized = normalizeRecord(remote, at);
      if (!normalized) continue;
      const current = byId.get(normalized.id);
      if (!current || normalized.updatedAt > current.updatedAt) {
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
    const mission = this.get(id);
    return mission ? formatMission(mission) : `No mission named "${id}".`;
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
    `  identity: ${mission.id} · created by ${mission.provenance.createdBy}` +
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
    `  durability: ${mission.durability} · updated ${new Date(mission.updatedAt).toISOString()}`,
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
