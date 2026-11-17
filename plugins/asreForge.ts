/**
 * ==========================================================
 * LÉLU ASRE → 3D FORGE INTAKE (server only, zero spend)
 *
 * The Forge is where finished assets live. ASRE does not get a
 * second Forge: its GLBs enter the SAME ledger and version folders
 * (plugins/forgeStore.ts) as a local job kind "asre", exactly like
 * the Blender stage's "blender" kind. From then on the existing
 * machinery applies unchanged:
 *
 *   forge.library()        lists it
 *   forge.place()          puts it in the Cosmos (meshValid gate)
 *   exportFormats()        Blender .blend/.glb/.obj/.stl/.fbx export
 *                          (refused unless it passed inspection)
 *   /api/forge/assets/*    serves its files, immutable
 *
 * What ASRE adds to each job's `request`:
 *   source       reconstruction | character | edit | import
 *   provenance   evidence breakdown, evidence sentence, engine,
 *                hypotheses, confidence — so the Forge never loses
 *                what was observed and what was generated
 *   conventions  measured: glTF +Y up, metres, standing on y = 0
 *   parentJobId  the version this one was made from (history)
 *
 * A GLB that fails inspection is still filed — as `rejected`, with
 * the inspector's problems as its error — so the failure is on the
 * record and nothing downstream can place or export it.
 * Nothing here calls Meshy, the spend policy or the network.
 * ==========================================================
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ForgeJob, ForgeOutputFile, ForgeStore } from "./forgeStore.ts";
import { inspectGlb, type GlbReport } from "../src/core/forge/GlbInspector.ts";
import { editGlb, measureBounds, withSceneExtras, type GlbEdit } from "../src/core/asre/gltf/GlbEditor.ts";
import { canonicalJson } from "../src/core/asre/nre/serialize.ts";
import type { AsreJobView } from "../src/core/asre/contracts.ts";

export const ASRE_COLLECTION = "asre_reconstructions";
export const ASRE_IMPORTS = "asre_imports";

export class AsreForgeError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type AsreAssetSource =
  | { kind: "reconstruction"; jobId: string; engine: string }
  | { kind: "character"; characterId: string; version: string }
  | { kind: "edit"; edit: GlbEdit }
  | { kind: "import"; name: string };

export interface Conventions {
  upAxis: "+Y";
  units: "metres (assumed)";
  bounds: { min: number[]; max: number[] } | null;
  standsOnFloor: boolean;
  centred: boolean;
  warnings: string[];
}

/** Measure the conventions every Forge asset is expected to follow. */
export function conventionsOf(bytes: Uint8Array): Conventions {
  let b: ReturnType<typeof measureBounds> = null;
  try {
    b = measureBounds(bytes);
  } catch (e) {
    return { upAxis: "+Y", units: "metres (assumed)", bounds: null, standsOnFloor: false, centred: false, warnings: [`unreadable: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const warnings: string[] = [];
  if (!b) return { upAxis: "+Y", units: "metres (assumed)", bounds: null, standsOnFloor: false, centred: false, warnings: ["no geometry to measure"] };
  const size = b.max.map((v, i) => v - b.min[i]);
  const tol = Math.max(1e-3, 0.02 * Math.max(...size));
  const standsOnFloor = Math.abs(b.min[1]) <= tol;
  const centred = Math.abs((b.min[0] + b.max[0]) / 2) <= tol && Math.abs((b.min[2] + b.max[2]) / 2) <= tol;
  if (!standsOnFloor) warnings.push(`lowest point is at y = ${b.min[1].toFixed(3)} m, not on the floor (edit with ground: true)`);
  if (!centred) warnings.push("not centred on x = z = 0 (edit with center: true)");
  if (Math.max(...size) > 50) warnings.push(`largest side is ${Math.max(...size).toFixed(1)} m: check the units`);
  return { upAxis: "+Y", units: "metres (assumed)", bounds: { min: b.min, max: b.max }, standsOnFloor, centred, warnings };
}

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export interface FileOptions {
  collection: string;
  bytes: Uint8Array;
  purpose: string;
  source: AsreAssetSource;
  provenance?: Record<string, unknown>;
  parentJobId?: string | null;
  /** Additional files kept beside the model (e.g. the .lnre numerical record, a preview). */
  extra?: Array<{ name: string; role: string; bytes: Uint8Array }>;
}

export class AsreForge {
  readonly store: ForgeStore;
  constructor(store: ForgeStore) {
    this.store = store;
  }

  /** File a GLB as a Forge job of kind "asre". Identical bytes + source + parent → the existing job. */
  file(o: FileOptions): { job: ForgeJob; reused: boolean } {
    if (o.parentJobId && !this.store.job(o.parentJobId)) throw new AsreForgeError(`no Forge job ${o.parentJobId}`, 404);
    const modelSha = sha256(o.bytes);
    const request = { operation: "asre", collection: o.collection, model: modelSha, source: o.source, parentJobId: o.parentJobId ?? null };
    const requestKey = sha256(canonicalJson(request));
    const existing = this.store.findByKey(o.collection, requestKey);
    if (existing) return { job: existing, reused: true };
    const validation: GlbReport = inspectGlb(o.bytes);
    const conventions = conventionsOf(o.bytes);
    const now = Date.now();
    const label = o.source.kind === "reconstruction" ? `asre_${o.source.jobId}` : o.source.kind === "character" ? `asre_${o.source.characterId}_${o.source.version}` : `asre_${o.source.kind}`;
    const dir = this.store.newVersionDir(o.collection, "meshes", label.slice(0, 48));
    const files: ForgeOutputFile[] = [this.store.writeOutput(dir, "model.glb", "model", o.bytes)];
    for (const e of o.extra ?? []) files.push(this.store.writeOutput(dir, e.name, e.role, e.bytes));
    const record = { request, provenance: o.provenance ?? {}, conventions, validation: { verdict: validation.verdict, problems: validation.problems, warnings: validation.warnings } };
    files.push(this.store.writeOutput(dir, "asre.json", "asre-metadata", new TextEncoder().encode(JSON.stringify(record, null, 1))));
    const parent = o.parentJobId ? this.store.job(o.parentJobId) : null;
    const job: ForgeJob = {
      id: `fj_${now.toString(36)}_${sha256(`${requestKey}${Math.random()}`).slice(0, 6)}`,
      character: o.collection,
      kind: "asre",
      purpose: o.purpose.slice(0, 300),
      request: { ...request, provenance: o.provenance ?? {}, conventions, spend: "zero: local ASRE, no paid API" },
      requestKey,
      estimatedCredits: 0,
      status: validation.verdict.meshValid ? "SUCCEEDED" : "rejected",
      meshyTaskId: null,
      progress: 100,
      consumedCredits: 0,
      error: validation.verdict.meshValid ? null : `GLB failed inspection: ${validation.problems.join("; ") || "no valid mesh"}`,
      identityLock: parent?.identityLock ?? null,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
      finishedAt: now,
      output: { dir: this.store.relative(dir), files },
      validation,
    };
    this.store.saveJob(job);
    this.store.logEvent(o.collection, { type: validation.verdict.meshValid ? "asre_filed" : "asre_rejected", jobId: job.id, parentJobId: o.parentJobId ?? null, source: o.source.kind, model: modelSha, verdict: validation.verdict, problems: validation.problems });
    return { job, reused: false };
  }

  /** A finished reconstruction job → the Forge (the job manager's success hook). */
  fileReconstruction(job: AsreJobView, readAsset: (rel: string) => Uint8Array, parentForgeJobId: string | null = null): ForgeJob {
    const r = job.result;
    if (!r) throw new AsreForgeError(`reconstruction ${job.id} has no result`, 409);
    const glb = withSceneExtras(readAsset(r.files.glb), { asre: { job: job.id, engine: r.engine, evidence: r.evidence } });
    const extra = [{ name: "reconstruction.lnre", role: "nre-grid", bytes: readAsset(r.files.lnre) }];
    if (r.files.preview) extra.push({ name: "preview.png", role: "preview", bytes: readAsset(r.files.preview) });
    return this.file({
      collection: ASRE_COLLECTION,
      bytes: glb,
      purpose: `ASRE ${r.engine} reconstruction ${job.id} (${job.input.images.map((i) => i.view).join(" + ")} view${job.input.images.length > 1 ? "s" : ""})`,
      source: { kind: "reconstruction", jobId: job.id, engine: r.engine },
      provenance: {
        engine: r.engine,
        evidence: r.evidence,
        evidenceText: r.evidenceText,
        meanConfidence: r.grid.meanConfidence,
        selectedHypothesis: r.hypotheses.find((h) => h.selected)?.id ?? null,
        hypotheses: r.hypotheses.map((h) => ({ id: h.id, rank: h.rank, agreement: h.agreement, evidence: h.evidence })),
        inputs: job.input.images.map((i) => ({ view: i.view, sha256: i.sha256 })),
        parentReconstruction: job.parentJobId,
      },
      parentJobId: parentForgeJobId,
      extra,
    }).job;
  }

  /** Import an outside GLB: inspected and filed; a broken file is filed as rejected, never as usable. */
  importGlb(bytes: Uint8Array, name: string): ForgeJob {
    return this.file({ collection: ASRE_IMPORTS, bytes, purpose: `Imported GLB "${name.slice(0, 80)}"`, source: { kind: "import", name: name.slice(0, 120) }, provenance: { evidence: "UNKNOWN: an imported file carries no ASRE evidence" } }).job;
  }

  /** Edit a finished asset → a NEW version (the source job and its files are never touched). */
  edit(jobId: string, edit: GlbEdit): ForgeJob {
    const source = this.store.job(jobId);
    if (!source) throw new AsreForgeError(`no Forge job ${jobId}`, 404);
    const model = source.output?.files.find((f) => f.role === "model");
    if (source.status !== "SUCCEEDED" || !model || !source.validation?.verdict.meshValid) throw new AsreForgeError("only a finished asset whose GLB passed inspection can be edited", 409);
    const before = new Uint8Array(readFileSync(this.store.absolute(model.file)));
    if (sha256(before) !== model.sha256) throw new AsreForgeError(`the stored file of ${jobId} no longer matches its recorded SHA-256`, 409);
    let after: Uint8Array;
    try {
      after = editGlb(before, edit);
    } catch (e) {
      throw new AsreForgeError(e instanceof Error ? e.message : String(e), 422);
    }
    const inherited = (source.request as { provenance?: Record<string, unknown> }).provenance ?? {};
    return this.file({
      collection: source.character,
      bytes: after,
      purpose: `Edit of ${source.id}: ${Object.keys(edit).join(", ") || "no change"}`,
      source: { kind: "edit", edit },
      provenance: { ...inherited, editedFrom: source.id, edit, note: "a geometric edit changes placement, scale or colour; it adds no evidence" },
      parentJobId: source.id,
    }).job;
  }

  /** The version chain of an asset, oldest first. */
  history(jobId: string): ForgeJob[] {
    const chain: ForgeJob[] = [];
    const seen = new Set<string>();
    let cur = this.store.job(jobId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      const parent = (cur.request as { parentJobId?: string | null; parentJobId_?: string }).parentJobId;
      cur = parent ? this.store.job(parent) : null;
    }
    return chain;
  }

  /** Every ASRE asset in the ledger, newest first. */
  assets(): ForgeJob[] {
    return this.store.allJobs().filter((j) => j.kind === "asre").sort((a, b) => b.createdAt - a.createdAt);
  }
}
