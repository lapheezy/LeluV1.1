/**
 * ==========================================================
 * LÉLU 3D FORGE — ASSET STORE + JOB LEDGER (server only)
 *
 * The disk side of the Forge. One directory per character:
 *
 *   leluverse/assets/characters/<id>/
 *     references/       originals, never modified
 *     identity/         identity.json — the locked face
 *     meshes/ rig/ animations/ …   one vNNN_* folder per
 *                       finished job; folders are created
 *                       exclusively, so nothing approved is
 *                       ever overwritten
 *     manifests/        references.json, character.json
 *     generation_logs/  jobs.json (the ledger), events.ndjson
 *
 * The ledger is what stops credits being spent twice: every
 * job carries the canonical key of its request, and a second
 * request with the same key returns the first job instead of
 * creating another.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ForgeJobKind, MeshyTaskStatus } from "../src/core/forge/MeshyCatalog.ts";
import type { GlbReport } from "../src/core/forge/GlbInspector.ts";
import type { ReferenceRecord } from "./forgeReferences.ts";

export type ForgeJobStatus =
  | "awaiting_approval"
  | "submitting"
  /** The create call left and no answer came back: a task MAY exist. Never auto-retried. */
  | "submit_uncertain"
  | MeshyTaskStatus
  | "rejected";

export interface ForgeOutputFile {
  role: string;
  file: string;
  bytes: number;
  sha256: string;
}

export interface ForgeJob {
  id: string;
  character: string;
  /** A Meshy task kind, or "blender" for a local post-process (spends nothing; see plugins/blenderStage.ts). */
  kind: ForgeJobKind | "blender";
  purpose: string;
  /** The request as asked for, with `ref:` handles unresolved — what the key is computed from. */
  request: Record<string, unknown>;
  requestKey: string;
  estimatedCredits: number;
  status: ForgeJobStatus;
  meshyTaskId: string | null;
  progress: number;
  consumedCredits: number | null;
  error: string | null;
  identityLock: string | null;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  finishedAt: number | null;
  output: { dir: string; files: ForgeOutputFile[] } | null;
  validation: GlbReport | null;
}

export interface IdentityLock {
  character: string;
  primary: string;
  secondary: string[];
  references: Array<{ id: string; file: string; sha256: string }>;
  preserve: Record<string, string>;
  mayChange: string[];
  rule: string;
  lockedAt: number;
  lockHash: string;
}

/** A finished Forge asset placed in the Cosmos. Survives restarts; removing one never deletes the asset. */
export interface CosmosPlacement {
  id: string;
  jobId: string;
  character: string;
  label: string;
  file: string;
  position: [number, number, number];
  rotationY: number;
  /** Height in world units the model is fitted to. */
  height: number;
  /**
   * Worn or held instead of standing in the world: follows this bone of
   * the character's rendered rig every frame, so it moves with her.
   * position/rotationY are ignored while attached.
   */
  attach?: PlacementAttachment | null;
  /** Wearable slot (e.g. "hood", "pendant"); wearables in one slot are worn or taken off together. */
  slot?: string | null;
  /** For a wearable: on her (true) or carried in the wardrobe, not shown (false). */
  worn?: boolean;
  /** Which environment it belongs to; absent means the home room. */
  environmentId?: string;
  /** A built-in shape instead of a Forge asset (jobId and file are then empty). */
  primitive?: PrimitiveSpec | null;
  /** Simulated by the rigid-body physics (src/core/world/Physics.ts) when dynamic. */
  physics?: PhysicsSpec | null;
  /** Furniture piece a part belongs to (e.g. "desk-1"), so a generated piece moves and goes as one. */
  group?: string | null;
  createdAt: number;
}

export type PrimitiveShape = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane";

export interface PrimitiveSpec {
  shape: PrimitiveShape;
  color: string;
  metalness: number;
  roughness: number;
  emissive: string | null;
  opacity: number;
  /** Size along x/y/z as a fraction of the placement height (default [1, 1, 1]); lets a desk top be flat. */
  proportions?: [number, number, number];
}

export interface PhysicsSpec {
  dynamic: boolean;
  mass: number;
  restitution: number;
  friction: number;
  velocity?: [number, number, number];
}

export interface PlacementAttachment {
  character: string;
  /** Bone name, matched case-insensitively and ignoring rig prefixes (e.g. "Head", "Spine02", "LeftHand"). */
  bone: string;
  offset: [number, number, number];
  rotation: [number, number, number];
}

export type CharacterSlot = "base" | "rig" | `animation:${string}` | `look:${string}`;

export interface CharacterManifest {
  character: string;
  active: Record<string, string>;
  /** Which look:<name> slot the Cosmos shows; null shows the rig/base. */
  currentLook?: string | null;
  history: Array<{ slot: string; jobId: string | null; replacedBy: string; at: number }>;
}

const TERMINAL: ReadonlySet<ForgeJobStatus> = new Set(["SUCCEEDED", "FAILED", "CANCELED", "rejected"]);

export function isTerminal(status: ForgeJobStatus): boolean {
  return TERMINAL.has(status);
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Write via a temp file + rename so a crash never leaves half a ledger. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

const CHARACTER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const SUBDIRS = [
  "references",
  "identity",
  "body",
  "face",
  "hair",
  "clothing",
  "accessories",
  "textures",
  "materials",
  "meshes",
  "rig",
  "animations",
  "previews",
  "concepts",
  "manifests",
  "generation_logs",
];

export class ForgeStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  characterDir(character: string): string {
    if (!CHARACTER_ID.test(character)) throw new Error(`Invalid character id "${character}".`);
    const dir = path.join(this.root, "characters", character);
    for (const sub of SUBDIRS) mkdirSync(path.join(dir, sub), { recursive: true });
    return dir;
  }

  /** Resolve a path under the asset root, refusing anything that escapes it. */
  safeAssetPath(relative: string): string | null {
    const resolved = path.resolve(this.root, relative);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) return null;
    return resolved;
  }

  relative(file: string): string {
    return path.relative(this.root, file).split(path.sep).join("/");
  }

  /* ------------------------------ ledger ------------------------------ */

  private ledgerFile(character: string): string {
    return path.join(this.characterDir(character), "generation_logs", "jobs.json");
  }

  jobs(character: string): ForgeJob[] {
    return readJson<ForgeJob[]>(this.ledgerFile(character), []);
  }

  allJobs(): ForgeJob[] {
    const base = path.join(this.root, "characters");
    if (!existsSync(base)) return [];
    return readdirSync(base).filter((c) => CHARACTER_ID.test(c)).flatMap((c) => this.jobs(c));
  }

  job(id: string): ForgeJob | null {
    return this.allJobs().find((j) => j.id === id) ?? null;
  }

  saveJob(job: ForgeJob): ForgeJob {
    const jobs = this.jobs(job.character);
    const index = jobs.findIndex((j) => j.id === job.id);
    job.updatedAt = Date.now();
    if (index === -1) jobs.push(job);
    else jobs[index] = job;
    writeJsonAtomic(this.ledgerFile(job.character), jobs);
    return job;
  }

  /**
   * The live job for a request, if one exists. A failed, cancelled or
   * rejected job does not count — asking again after a failure is a
   * deliberate retry, which is exactly when a new job is wanted.
   */
  findByKey(character: string, requestKey: string): ForgeJob | null {
    return (
      this.jobs(character).find(
        (j) => j.requestKey === requestKey && j.status !== "FAILED" && j.status !== "CANCELED" && j.status !== "rejected",
      ) ?? null
    );
  }

  logEvent(character: string, event: Record<string, unknown>): void {
    const file = path.join(this.characterDir(character), "generation_logs", "events.ndjson");
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  }

  usage(character?: string): { jobs: number; estimatedCredits: number; consumedCredits: number; byStatus: Record<string, number> } {
    const jobs = character ? this.jobs(character) : this.allJobs();
    const byStatus: Record<string, number> = {};
    let estimated = 0;
    let consumed = 0;
    for (const job of jobs) {
      byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
      if (job.submittedAt !== null) estimated += job.estimatedCredits;
      consumed += job.consumedCredits ?? 0;
    }
    return { jobs: jobs.length, estimatedCredits: estimated, consumedCredits: consumed, byStatus };
  }

  /* ---------------------------- references ---------------------------- */

  references(character: string): ReferenceRecord[] {
    return readJson<ReferenceRecord[]>(path.join(this.characterDir(character), "manifests", "references.json"), []);
  }

  saveReferences(character: string, records: ReferenceRecord[]): void {
    writeJsonAtomic(path.join(this.characterDir(character), "manifests", "references.json"), records);
  }

  /** Copy an original into references/ exactly once; an existing file is never replaced. */
  storeReferenceFile(character: string, id: string, ext: string, bytes: Uint8Array): string {
    const file = path.join(this.characterDir(character), "references", `${id}${ext}`);
    if (existsSync(file)) {
      if (sha256(readFileSync(file)) !== sha256(bytes)) {
        throw new Error(`Reference ${id} already exists with different content; originals are never overwritten.`);
      }
      return file;
    }
    writeFileSync(file, bytes, { flag: "wx" });
    return file;
  }

  /**
   * Turn `ref:<id>` handles in a request into data URIs read from the
   * stored originals. Requests are written, stored and fingerprinted with
   * the handles, so the ledger stays small and a request is identified by
   * which references it used, not by megabytes of base64.
   */
  resolveReferences(character: string, value: unknown): unknown {
    if (typeof value === "string" && value.startsWith("ref:")) {
      const id = value.slice(4);
      const record = this.references(character).find((r) => r.id === id);
      if (!record) throw new Error(`Unknown reference "${id}" for ${character}.`);
      const file = this.safeAssetPath(record.file);
      if (!file || !existsSync(file)) throw new Error(`Reference file for "${id}" is missing.`);
      const bytes = readFileSync(file);
      if (sha256(bytes) !== record.metrics.sha256) throw new Error(`Reference "${id}" no longer matches its recorded hash.`);
      const mime = record.metrics.format === "jpeg" ? "image/jpeg" : record.metrics.format === "webp" ? "image/webp" : "image/png";
      return `data:${mime};base64,${bytes.toString("base64")}`;
    }
    if (Array.isArray(value)) return value.map((v) => this.resolveReferences(character, v));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.resolveReferences(character, v);
      return out;
    }
    return value;
  }

  /* ----------------------------- identity ----------------------------- */

  private identityFile(character: string): string {
    return path.join(this.characterDir(character), "identity", "identity.json");
  }

  identity(character: string): IdentityLock | null {
    return readJson<IdentityLock | null>(this.identityFile(character), null);
  }

  /**
   * Lock (or, with approval, re-lock) the identity. A lock is the hash of
   * the exact reference bytes it names; changing which face LÉLU is takes
   * an explicit `approveChange`, so no code path can swap it quietly.
   */
  lockIdentity(
    character: string,
    spec: { primary: string; secondary: string[]; preserve: Record<string, string>; mayChange: string[]; rule: string },
    approveChange = false,
  ): IdentityLock {
    const records = this.references(character);
    const refs = [spec.primary, ...spec.secondary].map((id) => {
      const record = records.find((r) => r.id === id);
      if (!record) throw new Error(`Identity reference "${id}" has not been ingested.`);
      if (record.generatedFrom) throw new Error(`"${id}" is a generated image; identity references must be supplied originals.`);
      return { id, file: record.file, sha256: record.metrics.sha256 };
    });
    const lockHash = sha256(JSON.stringify({ refs, preserve: spec.preserve }));
    const current = this.identity(character);
    if (current && current.lockHash !== lockHash && !approveChange) {
      throw new Error("Identity is already locked to different references; re-locking needs explicit approval.");
    }
    if (current && current.lockHash === lockHash) return current;
    const lock: IdentityLock = { character, ...spec, references: refs, lockedAt: Date.now(), lockHash };
    writeJsonAtomic(this.identityFile(character), lock);
    this.logEvent(character, { type: current ? "identity_relocked" : "identity_locked", lockHash, previous: current?.lockHash ?? null });
    return lock;
  }

  /** Verify the identity references on disk still match the lock. */
  verifyIdentity(character: string): { ok: boolean; lockHash: string | null; problems: string[] } {
    const lock = this.identity(character);
    if (!lock) return { ok: false, lockHash: null, problems: ["No identity lock."] };
    const problems: string[] = [];
    for (const ref of lock.references) {
      const file = this.safeAssetPath(ref.file);
      if (!file || !existsSync(file)) problems.push(`Identity reference ${ref.id} is missing.`);
      else if (sha256(readFileSync(file)) !== ref.sha256) problems.push(`Identity reference ${ref.id} was modified.`);
    }
    return { ok: problems.length === 0, lockHash: lock.lockHash, problems };
  }

  /* ------------------------------ outputs ----------------------------- */

  /** A fresh, exclusively-created version folder: vNNN_<label>. */
  newVersionDir(character: string, area: "meshes" | "rig" | "animations" | "textures" | "concepts", label: string): string {
    const dir = path.join(this.characterDir(character), area);
    const taken = readdirSync(dir).map((n) => /^v(\d{3})_/.exec(n)?.[1]).filter(Boolean).map(Number);
    let next = (taken.length ? Math.max(...taken) : 0) + 1;
    for (;;) {
      const candidate = path.join(dir, `v${String(next).padStart(3, "0")}_${label.replace(/[^a-z0-9_-]/gi, "_")}`);
      try {
        mkdirSync(candidate);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        next++;
      }
    }
  }

  writeOutput(dir: string, name: string, role: string, bytes: Uint8Array): ForgeOutputFile {
    const file = path.join(dir, name);
    writeFileSync(file, bytes, { flag: "wx" });
    return { role, file: this.relative(file), bytes: bytes.byteLength, sha256: sha256(bytes) };
  }

  copyPreview(character: string, jobId: string, bytes: Uint8Array, ext: string): ForgeOutputFile {
    const dir = path.join(this.characterDir(character), "previews");
    return this.writeOutput(dir, `${jobId}${ext}`, "preview", bytes);
  }

  /* ------------------------------ cosmos ------------------------------ */

  private placementsFile(): string {
    mkdirSync(path.join(this.root, "cosmos"), { recursive: true });
    return path.join(this.root, "cosmos", "placements.json");
  }

  placements(): CosmosPlacement[] {
    return readJson<CosmosPlacement[]>(this.placementsFile(), []);
  }

  savePlacements(placements: CosmosPlacement[]): void {
    writeJsonAtomic(this.placementsFile(), placements);
  }

  /* ----------------------------- character ---------------------------- */

  private manifestFile(character: string): string {
    return path.join(this.characterDir(character), "manifests", "character.json");
  }

  manifest(character: string): CharacterManifest {
    return readJson<CharacterManifest>(this.manifestFile(character), { character, active: {}, history: [] });
  }

  setCurrentLook(character: string, look: string | null): CharacterManifest {
    const manifest = this.manifest(character);
    if (look !== null && !manifest.active[`look:${look}`]) throw new Error(`No approved look "${look}" for ${character}.`);
    manifest.currentLook = look;
    writeJsonAtomic(this.manifestFile(character), manifest);
    this.logEvent(character, { type: "look_changed", look });
    return manifest;
  }

  /** Point a slot at a finished job. The previous holder is kept in history, never deleted. */
  setActive(character: string, slot: CharacterSlot, jobId: string): CharacterManifest {
    const manifest = this.manifest(character);
    manifest.history.push({ slot, jobId: manifest.active[slot] ?? null, replacedBy: jobId, at: Date.now() });
    manifest.active[slot] = jobId;
    writeJsonAtomic(this.manifestFile(character), manifest);
    this.logEvent(character, { type: "slot_approved", slot, jobId });
    return manifest;
  }

  /** Take a job out of a slot (e.g. a model the user rejected after seeing it). The job and its files are kept. */
  clearActive(character: string, slot: string, reason: string): CharacterManifest {
    const manifest = this.manifest(character);
    const jobId = manifest.active[slot];
    if (!jobId) return manifest;
    manifest.history.push({ slot, jobId, replacedBy: "withdrawn", at: Date.now() });
    delete manifest.active[slot];
    writeJsonAtomic(this.manifestFile(character), manifest);
    this.logEvent(character, { type: "slot_withdrawn", slot, jobId, reason });
    return manifest;
  }
}
