/**
 * ==========================================================
 * LÉLU ASRE — PERSISTENT CHARACTERS (server only, WP04 + WP05)
 *
 *   <root>/characters/<id>/character.json   identity + head pointer,
 *                                           redo stack, exports (mutable,
 *                                           atomic writes)
 *   <root>/characters/<id>/versions/vNNNN.json  immutable version record
 *   <root>/characters/<id>/versions/vNNNN.glb   immutable model
 *   <root>/characters/_components/<builder>/<key>.bin
 *                                           content-addressed component
 *                                           geometry shared by every version
 *
 * Versions are written with O_EXCL ("wx") and carry a record hash and the
 * GLB's SHA-256; reading a version re-checks both, so a corrupt or edited
 * snapshot is reported, never served.
 *
 * The component cache is keyed by the BUILDER hash (a SHA-256 of the
 * component builder's own source files) plus lattice resolution plus the
 * component's content key, and every disk entry is verified (header key,
 * builder, resolution, payload SHA-256) before it is used. A code change,
 * a different lattice or a damaged file can therefore only cause a miss —
 * a cache hit cannot return stale or incompatible geometry.
 *
 * Edits run component by component and yield to the event loop between
 * components, so one request never blocks the server for a whole build.
 * Operations on one character are serialised.
 * ==========================================================
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../src/core/asre/character/CharacterSpec.ts";
import { buildComponent, characterGrid, ComponentCache, DEFAULT_LATTICE, glbParts, plan, type BuiltComponent, type CharacterBuild, type Lattice, type LocalComponent } from "../src/core/asre/character/build.ts";
import { COMPONENT_ORDER, type ComponentId } from "../src/core/asre/character/components.ts";
import {
  componentRecord,
  diffComponents,
  impactOf,
  restoreGroups,
  specChanges,
  specHash,
  versionHash,
  type CharacterVersion,
  type ComponentRecord,
  type RestorableGroup,
  type SpecPatch,
  type VersionOperation,
} from "../src/core/asre/character/identity.ts";
import { writeGlb } from "../src/core/asre/gltf/GlbWriter.ts";
import { compareGrids } from "../src/core/asre/temporal/compare.ts";
import { inspectGlb } from "../src/core/forge/GlbInspector.ts";
import type { AsreForge } from "./asreForge.ts";

export class CharacterError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const yieldNow = () => new Promise<void>((r) => setImmediate(r));
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** SHA-256 over the builder's own sources: any change to how geometry is made invalidates the cache. */
export function builderHash(): string {
  const dir = path.join(HERE, "..", "src", "core", "asre");
  const files = ["character/build.ts", "character/components.ts", "character/sdf.ts", "character/shape.ts", "volume/mesh.ts"];
  const h = createHash("sha256");
  for (const f of files) h.update(f).update(readFileSync(path.join(dir, f)));
  return h.digest("hex").slice(0, 16);
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}

/* --------------------------- persistent component cache --------------------------- */

interface DiskHeader {
  key: string;
  builder: string;
  resolution: number;
  samples: number;
  lengths: { cells: number; positions: number; indices: number; colors: number; normals: number };
  sha256: string;
}

export class PersistentComponentCache extends ComponentCache {
  readonly dir: string;
  readonly builder: string;
  readonly resolution: number;
  diskHits = 0;
  diskWrites = 0;
  /** Disk entries refused because their header or payload did not verify. */
  rejected = 0;

  constructor(dir: string, builder: string, resolution: number) {
    super();
    this.dir = path.join(dir, builder);
    this.builder = builder;
    this.resolution = resolution;
    mkdirSync(this.dir, { recursive: true });
  }

  private file(key: string): string {
    return path.join(this.dir, `${key.replace(/[^a-z0-9:_-]/gi, "_").replace(/:/g, "~")}@${this.resolution}.bin`);
  }

  override get(key: string): LocalComponent | undefined {
    const mem = super.get(key);
    if (mem) return mem;
    const f = this.file(key);
    if (!existsSync(f)) return undefined;
    const v = this.read(f, key);
    if (!v) return undefined;
    this.diskHits++;
    super.set(key, v);
    this.misses--; // a disk hit is a hit, not a build
    this.hits++;
    return v;
  }

  override set(key: string, v: LocalComponent): void {
    super.set(key, v);
    const f = this.file(key);
    if (existsSync(f)) return;
    const parts = [v.cells, v.mesh.positions, v.mesh.indices, v.mesh.colors ?? new Float32Array(0), v.mesh.normals ?? new Float32Array(0)];
    const payload = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
    const header: DiskHeader = {
      key,
      builder: this.builder,
      resolution: this.resolution,
      samples: v.samples,
      lengths: { cells: v.cells.length, positions: v.mesh.positions.length, indices: v.mesh.indices.length, colors: v.mesh.colors?.length ?? 0, normals: v.mesh.normals?.length ?? 0 },
      sha256: sha256(payload),
    };
    const h = Buffer.from(JSON.stringify(header));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(h.length);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, Buffer.concat([len, h, payload]));
    renameSync(tmp, f);
    this.diskWrites++;
  }

  private read(f: string, key: string): LocalComponent | null {
    try {
      const buf = readFileSync(f);
      const hl = buf.readUInt32LE(0);
      const header = JSON.parse(buf.subarray(4, 4 + hl).toString("utf8")) as DiskHeader;
      const payload = buf.subarray(4 + hl);
      if (header.key !== key || header.builder !== this.builder || header.resolution !== this.resolution || sha256(payload) !== header.sha256) {
        this.rejected++;
        return null;
      }
      const L = header.lengths;
      const ab = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
      let o = 0;
      const take = <T>(C: new (b: ArrayBuffer, o: number, n: number) => T, n: number, size: number): T => {
        const t = new C(ab, o, n);
        o += n * size;
        return t;
      };
      const cells = take(Int32Array, L.cells, 4);
      const positions = take(Float32Array, L.positions, 4);
      const indices = take(Uint32Array, L.indices, 4);
      const colors = take(Float32Array, L.colors, 4);
      const normals = take(Float32Array, L.normals, 4);
      if (o !== ab.byteLength) {
        this.rejected++;
        return null;
      }
      return { key, cells, mesh: { positions, indices, ...(L.colors ? { colors } : {}), ...(L.normals ? { normals } : {}) }, samples: header.samples, buildMs: 0 };
    } catch {
      this.rejected++;
      return null;
    }
  }
}

/* ------------------------------------ store ------------------------------------ */

export interface CharacterRecord {
  id: string;
  name: string;
  leluLook: string | null;
  createdAt: number;
  head: string;
  /** Versions undone from the head, most recent last (redo pops it). */
  redo: string[];
  /** Every version id, in creation order. */
  versions: string[];
  /** Version id → Forge job id, for versions exported to the Forge. */
  exports: Record<string, string>;
}

export interface VersionSummary {
  id: string;
  parentId: string | null;
  label: string;
  createdAt: number;
  operation: VersionOperation["kind"];
  regenerated: ComponentId[];
  recolored: ComponentId[];
  reused: number;
  buildMs: number;
  triangles: number;
  isHead: boolean;
  exportedAs: string | null;
}

export class AsreCharacterStore {
  readonly root: string;
  readonly lattice: Lattice;
  readonly builder: string;
  readonly cache: PersistentComponentCache;
  private readonly forge: AsreForge | null;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: { root: string; forge?: AsreForge | null; lattice?: Lattice; builder?: string }) {
    this.root = path.join(path.resolve(options.root), "characters");
    this.lattice = options.lattice ?? DEFAULT_LATTICE;
    this.builder = options.builder ?? builderHash();
    this.cache = new PersistentComponentCache(path.join(this.root, "_components"), this.builder, this.lattice.resolution);
    this.forge = options.forge ?? null;
    mkdirSync(this.root, { recursive: true });
  }

  /** Serialise operations per character. */
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }

  private dir(id: string): string {
    if (!ID.test(id)) throw new CharacterError(`invalid character id "${id}"`);
    return path.join(this.root, id);
  }

  list(): Array<CharacterRecord & { headSummary: VersionSummary }> {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((d) => ID.test(d) && existsSync(path.join(this.root, d, "character.json")))
      .map((d) => {
        const r = this.record(d);
        return { ...r, headSummary: this.summary(r, this.version(d, r.head)) };
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  record(id: string): CharacterRecord {
    const f = path.join(this.dir(id), "character.json");
    if (!existsSync(f)) throw new CharacterError(`no character ${id}`, 404);
    return JSON.parse(readFileSync(f, "utf8")) as CharacterRecord;
  }

  private saveRecord(r: CharacterRecord): void {
    writeJsonAtomic(path.join(this.dir(r.id), "character.json"), r);
  }

  /** A version, verified: its record hash and its GLB's SHA-256 must both match. */
  version(id: string, vid: string): CharacterVersion {
    if (!/^v\d{4}$/.test(vid)) throw new CharacterError(`invalid version "${vid}"`);
    const f = path.join(this.dir(id), "versions", `${vid}.json`);
    if (!existsSync(f)) throw new CharacterError(`no version ${vid} of ${id}`, 404);
    const v = JSON.parse(readFileSync(f, "utf8")) as CharacterVersion;
    const problems = this.problems(id, v);
    if (problems.length) throw new CharacterError(`version ${vid} of ${id} failed verification: ${problems.join("; ")}`, 500);
    return v;
  }

  private problems(id: string, v: CharacterVersion): string[] {
    const out: string[] = [];
    if (versionHash(v) !== v.recordHash) out.push("record hash mismatch (the version file was altered)");
    const glb = path.join(this.dir(id), "versions", `${v.id}.glb`);
    if (!existsSync(glb)) out.push("model file missing");
    else if (sha256(readFileSync(glb)) !== v.glb.sha256) out.push("model SHA-256 mismatch");
    return out;
  }

  /** Check every version of a character; returns the problems found (empty = intact). */
  verify(id: string): Array<{ version: string; problems: string[] }> {
    const r = this.record(id);
    return r.versions
      .map((vid) => {
        const v = JSON.parse(readFileSync(path.join(this.dir(id), "versions", `${vid}.json`), "utf8")) as CharacterVersion;
        return { version: vid, problems: this.problems(id, v) };
      })
      .filter((x) => x.problems.length);
  }

  glbFile(id: string, vid: string): string {
    this.version(id, vid);
    return path.join(this.dir(id), "versions", `${vid}.glb`);
  }

  summary(r: CharacterRecord, v: CharacterVersion): VersionSummary {
    return {
      id: v.id,
      parentId: v.parentId,
      label: v.label,
      createdAt: v.createdAt,
      operation: v.operation.kind,
      regenerated: v.build.regenerated,
      recolored: v.build.recolored,
      reused: v.build.reused.length,
      buildMs: v.build.ms,
      triangles: v.glb.triangles,
      isHead: r.head === v.id,
      exportedAs: r.exports[v.id] ?? null,
    };
  }

  history(id: string): { character: CharacterRecord; versions: VersionSummary[] } {
    const r = this.record(id);
    return { character: r, versions: r.versions.map((vid) => this.summary(r, this.version(id, vid))) };
  }

  /** Build every component (cache first), yielding between components. */
  async build(spec: CharacterSpec): Promise<CharacterBuild> {
    const t0 = performance.now();
    const p = plan(spec, this.lattice);
    const components: BuiltComponent[] = [];
    for (const cid of COMPONENT_ORDER) {
      components.push(buildComponent(cid, p, this.cache, this.lattice));
      await yieldNow();
    }
    return {
      components,
      regenerated: components.filter((c) => c.regenerated).map((c) => c.id),
      recolored: components.filter((c) => c.action === "recolored").map((c) => c.id),
      reused: components.filter((c) => c.action === "reused").map((c) => c.id),
      ms: performance.now() - t0,
    };
  }

  private async commit(r: CharacterRecord, parent: CharacterVersion | null, spec: CharacterSpec, operation: VersionOperation, label: string): Promise<CharacterVersion> {
    const impact = parent ? impactOf(parent.spec, spec, this.lattice) : COMPONENT_ORDER.map((cid) => ({ id: cid, action: "rebuild" as const, reason: "new character" }));
    const build = await this.build(spec);
    const h = this.lattice.resolution;
    const components = {} as Record<ComponentId, ComponentRecord>;
    for (const c of build.components) components[c.id] = componentRecord(c, h);
    // regenerated flags are build facts, not geometry: keep them out of the file so equal specs give equal bytes
    const parts = glbParts(build, h, spec).map((part) => ({ ...part, extras: { component: part.extras!.component, key: part.extras!.key, identity: spec.identity.id, evidence: "GENERATED" } }));
    const glb = writeGlb(parts, { generator: "LÉLU ASRE character", extras: { identity: spec.identity.id, specHash: specHash(spec), builder: this.builder } });
    const report = inspectGlb(glb);
    const n = r.versions.length + 1;
    const vid = `v${String(n).padStart(4, "0")}`;
    const dir = path.join(this.dir(r.id), "versions");
    mkdirSync(dir, { recursive: true });
    const body: Omit<CharacterVersion, "recordHash"> = {
      id: vid,
      characterId: r.id,
      parentId: parent?.id ?? null,
      createdAt: Date.now(),
      label,
      operation,
      spec,
      specHash: specHash(spec),
      builder: this.builder,
      lattice: h,
      impact,
      components,
      build: { ms: Math.round(build.ms), regenerated: build.regenerated, recolored: build.recolored, reused: build.reused },
      glb: { file: `characters/${r.id}/versions/${vid}.glb`, sha256: sha256(glb), bytes: glb.length, triangles: report.geometry.triangles, meshValid: report.verdict.meshValid },
      evidence: "GENERATED",
    };
    const version: CharacterVersion = { ...body, recordHash: versionHash(body) };
    // immutable: O_EXCL — an existing version is never overwritten
    writeFileSync(path.join(dir, `${vid}.glb`), glb, { flag: "wx" });
    writeFileSync(path.join(dir, `${vid}.json`), JSON.stringify(version, null, 1), { flag: "wx" });
    r.versions.push(vid);
    r.head = vid;
    r.redo = [];
    this.saveRecord(r);
    return version;
  }

  create(input: { id: string; name?: string; base?: CharacterSpec; leluLook?: string | null }): Promise<CharacterVersion> {
    return this.serial(input.id, async () => {
      const dir = this.dir(input.id);
      if (existsSync(path.join(dir, "character.json"))) throw new CharacterError(`character ${input.id} already exists`, 409);
      mkdirSync(dir, { recursive: true });
      const base = structuredClone(input.base ?? BASE_CHARACTER);
      base.identity = { ...base.identity, id: input.id, name: input.name ?? base.identity.name, ...(input.leluLook !== undefined ? { leluLook: input.leluLook ?? undefined } : {}) };
      const r: CharacterRecord = { id: input.id, name: base.identity.name, leluLook: base.identity.leluLook ?? null, createdAt: Date.now(), head: "", redo: [], versions: [], exports: {} };
      return this.commit(r, null, base, { kind: "create" }, "created");
    });
  }

  /** Edit from the head (or from `base`, which makes a branch). The identity never changes. */
  edit(id: string, patch: SpecPatch, options: { base?: string; label?: string } = {}): Promise<CharacterVersion> {
    return this.serial(id, async () => {
      const r = this.record(id);
      const parent = this.version(id, options.base ?? r.head);
      validatePatch(patch);
      const spec = withChanges(parent.spec, patch);
      if (specHash(spec) === parent.specHash) throw new CharacterError("the edit changes nothing", 409);
      return this.commit(r, parent, spec, { kind: "edit", patch, ...(options.label ? { label: options.label } : {}) }, options.label ?? describePatch(patch));
    });
  }

  /** Restore an earlier version entirely, or only some of its groups (e.g. its hairstyle), as a NEW version. */
  restore(id: string, from: string, groups?: RestorableGroup[]): Promise<CharacterVersion> {
    return this.serial(id, async () => {
      const r = this.record(id);
      const head = this.version(id, r.head);
      const source = this.version(id, from);
      const spec = groups?.length ? restoreGroups(head.spec, source.spec, groups) : structuredClone(source.spec);
      if (specHash(spec) === head.specHash) throw new CharacterError("the head already matches what would be restored", 409);
      return this.commit(r, head, spec, { kind: "restore", from, ...(groups?.length ? { components: groups } : {}) }, groups?.length ? `restore ${groups.join(", ")} from ${from}` : `restore ${from}`);
    });
  }

  /** Move the head to its parent. Nothing is deleted; redo brings it back. */
  undo(id: string): Promise<CharacterRecord> {
    return this.serial(id, async () => {
      const r = this.record(id);
      const head = this.version(id, r.head);
      if (!head.parentId) throw new CharacterError("nothing to undo: the head is the first version", 409);
      r.redo.push(r.head);
      r.head = head.parentId;
      this.saveRecord(r);
      return r;
    });
  }

  redo(id: string): Promise<CharacterRecord> {
    return this.serial(id, async () => {
      const r = this.record(id);
      const next = r.redo.pop();
      if (!next) throw new CharacterError("nothing to redo", 409);
      r.head = next;
      this.saveRecord(r);
      return r;
    });
  }

  /** Make any existing version the head (switch branch). Clears redo. */
  checkout(id: string, vid: string): Promise<CharacterRecord> {
    return this.serial(id, async () => {
      const r = this.record(id);
      this.version(id, vid);
      r.head = vid;
      r.redo = [];
      this.saveRecord(r);
      return r;
    });
  }

  /** Compare two versions: spec fields, per-component hashes and the voxel geometry. */
  async compare(id: string, a: string, b: string) {
    const va = this.version(id, a), vb = this.version(id, b);
    const ga = characterGrid(await this.build(va.spec), this.lattice);
    const gb = characterGrid(await this.build(vb.spec), this.lattice);
    const g = compareGrids(ga, gb);
    return {
      a,
      b,
      specChanges: specChanges(va.spec, vb.spec),
      components: diffComponents(va, vb),
      geometry: { iou: g.iou, change: g.classification, added: g.added, removed: g.removed, cellsA: ga.size, cellsB: gb.size, centroidShift: g.centroidShift },
      triangles: { a: va.glb.triangles, b: vb.glb.triangles },
      evidence: "both versions are GENERATED (procedural): nothing in them was observed",
    };
  }

  /** File a version in the Forge (kind "asre"); the parent's export, if any, becomes its Forge parent. */
  export(id: string, vid: string): Promise<{ forgeJobId: string; reused: boolean }> {
    return this.serial(id, async () => {
      if (!this.forge) throw new CharacterError("no Forge store is configured", 503);
      const r = this.record(id);
      const v = this.version(id, vid);
      const bytes = new Uint8Array(readFileSync(path.join(this.dir(id), "versions", `${vid}.glb`)));
      const parentJob = v.parentId ? (r.exports[v.parentId] ?? null) : null;
      const { job, reused } = this.forge.file({
        collection: id.replace(/[^a-z0-9_-]/g, "_"),
        bytes,
        purpose: `Character ${r.name} ${vid}: ${v.label}`,
        source: { kind: "character", characterId: id, version: vid },
        provenance: { evidence: "GENERATED", note: "procedural component character: every cell is generated, none observed", specHash: v.specHash, builder: v.builder, operation: v.operation, regenerated: v.build.regenerated },
        parentJobId: parentJob,
      });
      if (job.status !== "SUCCEEDED") throw new CharacterError(`the Forge rejected ${vid}: ${job.error}`, 422);
      r.exports[vid] = job.id;
      this.saveRecord(r);
      return { forgeJobId: job.id, reused };
    });
  }
}

const GROUPS = new Set(["body", "face", "hair", "clothing", "accessories", "materials", "pose"]);
function validatePatch(patch: SpecPatch): void {
  if (!patch || typeof patch !== "object") throw new CharacterError("patch must be an object");
  for (const k of Object.keys(patch)) if (!GROUPS.has(k)) throw new CharacterError(`unknown patch group "${k}" (identity cannot be edited)`);
  const nums = (o: Record<string, unknown> | undefined, ranges: Record<string, [number, number]>) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      const r = ranges[k];
      if (!r) throw new CharacterError(`unknown field "${k}"`);
      if (typeof v !== "number" || !Number.isFinite(v) || v < r[0] || v > r[1]) throw new CharacterError(`${k} must be a number in [${r[0]}, ${r[1]}]`);
    }
  };
  nums(patch.body as Record<string, unknown>, { height: [1.2, 2.2], shoulderWidth: [0.28, 0.6], hipWidth: [0.24, 0.5], build: [0.7, 1.4], legRatio: [0.4, 0.56], armRatio: [0.8, 1.2] });
  nums(patch.face as Record<string, unknown>, { headScale: [0.8, 1.25], eyeSize: [0.6, 1.5], eyeSpacing: [0.8, 1.25], noseSize: [0.6, 1.5] });
  for (const [k, v] of Object.entries(patch.materials ?? {})) {
    if (!Array.isArray(v) || v.length !== 3 || v.some((c) => typeof c !== "number" || c < 0 || c > 1)) throw new CharacterError(`material ${k} must be [r, g, b] in 0..1`);
  }
}

function describePatch(p: SpecPatch): string {
  const parts: string[] = [];
  if (p.hair) parts.push(`hair ${p.hair.style ?? ""}`.trim());
  if (p.clothing) parts.push(`outfit ${[p.clothing.top, p.clothing.bottom].filter(Boolean).join("+")}`.trim());
  if (p.body) parts.push("body proportions");
  if (p.face) parts.push("face");
  if (p.accessories) parts.push("accessories");
  if (p.materials) parts.push(`materials (${Object.keys(p.materials).join(", ")})`);
  if (p.pose) parts.push(`pose ${p.pose}`);
  return parts.join("; ") || "edit";
}
