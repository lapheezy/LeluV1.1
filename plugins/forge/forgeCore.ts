/**
 * ==========================================================
 * LÉLU 3D FORGE — CORE (server side)
 *
 * The reusable production pipeline behind "make this in 3D": references
 * in, a costed plan, an approval, real generation jobs, inspected and
 * versioned outputs. Not tied to one character: an asset is any folder
 * under leluverse/assets/<kind>/<name>/.
 *
 *   ingest  — copy references in (originals preserved), hash, de-duplicate,
 *             record each one's role in the asset's manifest
 *   plan    — a job: provider workflow + parameters + estimated credits;
 *             identical requests are the same job (no double spend)
 *   approve — a person approves the spend; LÉLU can plan, never approve
 *   run     — forgeRunner submits, tracks, downloads, validates, versions
 *
 * Prices are Meshy's published per-request credits
 * (docs.meshy.ai/api/pricing, read 2026-10-30); the real charge is what
 * the task reports as consumed_credits, and that is what is recorded.
 * ==========================================================
 */

import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/* ------------------------------- assets ------------------------------- */

export const ASSET_FOLDERS = [
  "references", "identity", "body", "face", "hair", "clothing", "accessories", "textures",
  "materials", "meshes", "rig", "animations", "previews", "manifests", "generation_logs",
] as const;

/** leluverse/assets/<kind>/<name>, created with its standard folders. */
export function assetRoot(projectRoot: string, kind: string, name: string): string {
  const safe = (part: string) => {
    const clean = part.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    if (!clean) throw new Error(`Invalid asset path part "${part}"`);
    return clean;
  };
  const root = path.join(projectRoot, "leluverse", "assets", safe(kind), safe(name));
  for (const folder of ASSET_FOLDERS) mkdirSync(path.join(root, folder), { recursive: true });
  return root;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Written whole to a temp file, then renamed: a crash never leaves half a ledger. */
function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

/* ----------------------------- references ----------------------------- */

export type ReferenceUse = "geometry" | "texture" | "design" | "identity";

export interface ReferenceEntry {
  file: string;
  sha256: string;
  bytes: number;
  width?: number;
  height?: number;
  category: string;
  intendedUse: string;
  quality: string;
  reconstructionSuitability: "high" | "medium" | "low";
  uses: ReferenceUse[];
  sourceName?: string;
  addedAt: string;
}

export interface ReferenceManifest {
  asset: string;
  references: ReferenceEntry[];
  duplicatesSkipped: Array<{ sourceName: string; sameAs: string }>;
}

export function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Copy references into the asset (never moving or altering the originals)
 * under the name given; a file whose bytes are already there is skipped
 * and reported, not stored twice.
 */
export function ingestReferences(
  root: string,
  items: Array<Omit<ReferenceEntry, "sha256" | "bytes" | "addedAt"> & { source: string }>,
): ReferenceManifest {
  const manifestFile = path.join(root, "manifests", "references.json");
  const manifest = readJson<ReferenceManifest>(manifestFile, { asset: path.basename(root), references: [], duplicatesSkipped: [] });
  for (const item of items) {
    const sha256 = sha256File(item.source);
    const existing = manifest.references.find((ref) => ref.sha256 === sha256);
    if (existing) {
      if (!manifest.duplicatesSkipped.some((d) => d.sourceName === path.basename(item.source))) {
        manifest.duplicatesSkipped.push({ sourceName: path.basename(item.source), sameAs: existing.file });
      }
      continue;
    }
    const target = path.join(root, "references", item.file);
    if (existsSync(target) && sha256File(target) !== sha256) {
      throw new Error(`references/${item.file} already holds a different image; refusing to overwrite it.`);
    }
    copyFileSync(item.source, target);
    const { source, ...rest } = item;
    manifest.references.push({ ...rest, sha256, bytes: statSync(target).size, sourceName: path.basename(source), addedAt: new Date().toISOString() });
  }
  writeJson(manifestFile, manifest);
  return manifest;
}

/* ------------------------------- pricing ------------------------------ */

/** Meshy credits per request (docs.meshy.ai/api/pricing). */
const IMAGE_TO_3D: Record<string, { mesh: number; tex2k: number; tex4k: number; tex8k: number }> = {
  "meshy-7.1": { mesh: 20, tex2k: 30, tex4k: 30, tex8k: 35 },
  latest: { mesh: 20, tex2k: 30, tex4k: 30, tex8k: 35 },
  "meshy-6": { mesh: 20, tex2k: 30, tex4k: 30, tex8k: 35 },
  "meshy-6-lite": { mesh: 5, tex2k: 15, tex4k: NaN, tex8k: NaN },
};

export type ForgeWorkflow = "multi-image-to-3d" | "image-to-3d" | "rigging" | "animation" | "remesh";

export function estimateCredits(workflow: ForgeWorkflow, params: Record<string, unknown>): number {
  if (workflow === "rigging") return 5;
  if (workflow === "remesh") return 5;
  if (workflow === "animation") {
    const ids = Array.isArray(params.action_ids) ? params.action_ids.length : params.action_id !== undefined ? 1 : 0;
    return 3 * Math.max(1, ids);
  }
  const model = String(params.ai_model ?? "latest");
  const table = IMAGE_TO_3D[model];
  if (!table) throw new Error(`No published price for model "${model}".`);
  const textured = params.should_texture !== false;
  const res = String(params.texture_resolution ?? "2k");
  const base = !textured ? table.mesh : res === "8k" ? table.tex8k : res === "4k" ? table.tex4k : table.tex2k;
  if (Number.isNaN(base)) throw new Error(`Model "${model}" does not support ${res} textures.`);
  const ultra = params.geometry_resolution === "2k" || params.geometry_resolution === "4k" ? 5 : 0;
  return base + ultra;
}

/* -------------------------------- jobs -------------------------------- */

export type JobState = "awaiting_approval" | "approved" | "submitted" | "succeeded" | "failed" | "needs_attention" | "rejected";

export interface ForgeJob {
  id: string;
  asset: string;
  workflow: ForgeWorkflow;
  /** What it is for, in words (shown with the approval request). */
  purpose: string;
  /** Provider parameters, with reference images named by asset-relative path (resolved at submit). */
  params: Record<string, unknown>;
  /** Jobs whose outputs this one needs (e.g. rigging after generation). */
  dependsOn?: string[];
  requestHash: string;
  estimatedCredits: number;
  state: JobState;
  plannedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  providerTaskId?: string;
  submittedAt?: string;
  finishedAt?: string;
  progress?: number;
  consumedCredits?: number;
  outputs?: Record<string, string>;
  validation?: Record<string, unknown>;
  error?: string;
  history: Array<{ at: string; event: string }>;
}

export interface Ledger {
  jobs: ForgeJob[];
}

export function ledgerFile(projectRoot: string): string {
  return path.join(projectRoot, "leluverse", "forge", "ledger.json");
}

export function loadLedger(projectRoot: string): Ledger {
  return readJson<Ledger>(ledgerFile(projectRoot), { jobs: [] });
}

export function saveLedger(projectRoot: string, ledger: Ledger): void {
  writeJson(ledgerFile(projectRoot), ledger);
}

/** Same workflow + same parameters + same reference bytes = the same request. */
export function requestHash(workflow: ForgeWorkflow, params: Record<string, unknown>, referenceHashes: string[]): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify({ workflow, params: canonical(params), refs: [...referenceHashes].sort() })).digest("hex").slice(0, 24);
}

/**
 * A planned job, or the existing job for the same request. A request that
 * already succeeded, is running, or awaits approval is never planned twice;
 * only a failed or rejected one may be planned again.
 */
export function planJob(
  ledger: Ledger,
  input: { asset: string; workflow: ForgeWorkflow; purpose: string; params: Record<string, unknown>; referenceHashes: string[]; dependsOn?: string[]; plannedBy: string },
): { job: ForgeJob; reused: boolean } {
  const hash = requestHash(input.workflow, input.params, [...input.referenceHashes, ...(input.dependsOn ?? [])]);
  const existing = ledger.jobs.find((job) => job.requestHash === hash && !["failed", "rejected"].includes(job.state));
  if (existing) return { job: existing, reused: true };
  const now = new Date().toISOString();
  const job: ForgeJob = {
    id: `forge-${randomUUID().slice(0, 8)}`,
    asset: input.asset,
    workflow: input.workflow,
    purpose: input.purpose,
    params: input.params,
    dependsOn: input.dependsOn,
    requestHash: hash,
    estimatedCredits: estimateCredits(input.workflow, input.params),
    state: "awaiting_approval",
    plannedBy: input.plannedBy,
    history: [{ at: now, event: `planned by ${input.plannedBy}` }],
  };
  ledger.jobs.push(job);
  return { job, reused: false };
}

/** Only a person approves spend. `by` is who; LÉLU's own identity is refused. */
export function approveJob(ledger: Ledger, id: string, by: string): ForgeJob {
  const job = ledger.jobs.find((item) => item.id === id);
  if (!job) throw new Error(`No forge job ${id}.`);
  if (!by.trim() || /^l[ée]lu\b/i.test(by.trim())) throw new Error("A forge job must be approved by a person, not by LÉLU.");
  if (job.state !== "awaiting_approval") throw new Error(`Job ${id} is ${job.state}, not awaiting approval.`);
  job.state = "approved";
  job.approvedBy = by;
  job.approvedAt = new Date().toISOString();
  job.history.push({ at: job.approvedAt, event: `approved by ${by} (${job.estimatedCredits} credits estimated)` });
  return job;
}

export function creditsSpent(ledger: Ledger): number {
  return ledger.jobs.reduce((sum, job) => sum + (job.consumedCredits ?? 0), 0);
}

/* ------------------------------ versions ------------------------------ */

/** The next free vNNN folder under <root>/<folder>: approved outputs are never overwritten. */
export function nextVersionDir(root: string, folder: string): string {
  const base = path.join(root, folder);
  mkdirSync(base, { recursive: true });
  const taken = readdirSync(base).map((name) => /^v(\d{3})$/.exec(name)?.[1]).filter(Boolean).map(Number);
  const next = `v${String((taken.length ? Math.max(...taken) : 0) + 1).padStart(3, "0")}`;
  const dir = path.join(base, next);
  mkdirSync(dir);
  return dir;
}

/* ---------------------------- GLB inspection --------------------------- */

export interface GlbReport {
  valid: boolean;
  error?: string;
  bytes: number;
  meshes: number;
  primitives: number;
  triangles: number;
  vertices: number;
  materials: number;
  textures: number;
  skins: number;
  joints: number;
  jointNames: string[];
  animations: Array<{ name: string; channels: number }>;
  morphTargets: number;
}

/** What a GLB actually contains, read from its own JSON chunk — not from what a provider said. */
export function inspectGlb(buffer: Buffer): GlbReport {
  const empty: GlbReport = { valid: false, bytes: buffer.length, meshes: 0, primitives: 0, triangles: 0, vertices: 0, materials: 0, textures: 0, skins: 0, joints: 0, jointNames: [], animations: [], morphTargets: 0 };
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") return { ...empty, error: "not a GLB (no glTF magic)" };
  if (buffer.readUInt32LE(4) !== 2) return { ...empty, error: `glTF version ${buffer.readUInt32LE(4)}, expected 2` };
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.toString("ascii", 16, 20) !== "JSON") return { ...empty, error: "first chunk is not JSON" };
  type Gltf = {
    meshes?: Array<{ primitives: Array<{ indices?: number; attributes: Record<string, number>; mode?: number; targets?: unknown[] }> }>;
    accessors?: Array<{ count: number }>;
    materials?: unknown[];
    textures?: unknown[];
    skins?: Array<{ joints: number[] }>;
    nodes?: Array<{ name?: string }>;
    animations?: Array<{ name?: string; channels: unknown[] }>;
  };
  let gltf: Gltf;
  try {
    gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength)) as Gltf;
  } catch (error) {
    return { ...empty, error: `JSON chunk unreadable: ${String(error)}` };
  }
  let primitives = 0;
  let triangles = 0;
  let vertices = 0;
  let morphTargets = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      primitives += 1;
      const position = gltf.accessors?.[primitive.attributes.POSITION];
      vertices += position?.count ?? 0;
      const indexCount = primitive.indices !== undefined ? gltf.accessors?.[primitive.indices]?.count ?? 0 : position?.count ?? 0;
      if ((primitive.mode ?? 4) === 4) triangles += Math.floor(indexCount / 3);
      morphTargets += primitive.targets?.length ?? 0;
    }
  }
  const jointIndices = [...new Set((gltf.skins ?? []).flatMap((skin) => skin.joints))];
  return {
    valid: true,
    bytes: buffer.length,
    meshes: gltf.meshes?.length ?? 0,
    primitives,
    triangles,
    vertices,
    materials: gltf.materials?.length ?? 0,
    textures: gltf.textures?.length ?? 0,
    skins: gltf.skins?.length ?? 0,
    joints: jointIndices.length,
    jointNames: jointIndices.map((index) => gltf.nodes?.[index]?.name ?? `#${index}`).slice(0, 80),
    animations: (gltf.animations ?? []).map((animation, index) => ({ name: animation.name ?? `animation ${index}`, channels: animation.channels.length })),
    morphTargets,
  };
}
