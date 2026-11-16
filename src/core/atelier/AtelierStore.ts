/**
 * ==========================================================
 * LÉLU — ATELIER: PROJECTS, DIRECTIONS, VERSIONS, PROPAGATION
 *
 * A project holds the brief, the material that was really
 * inspected, the sources, and versions of its design directions.
 * Nothing is overwritten: every change (a new direction, a fork,
 * a combination, a component edit, a selection) is a new version.
 *
 * Changing a component is propagation: the BOM, every drawing,
 * every model and the production documents are produced from the
 * components, so the next export carries the change everywhere,
 * and the version records which component IDs changed.
 * ==========================================================
 */

import { billOfMaterials, cosmeticPairs, interferences, type BomSummary } from "./AtelierGeometry";
import { ATELIER_FORMATS, UNSUPPORTED_FORMATS, writeAtelierFile, type AtelierFormat } from "./AtelierFiles";
import { verifyAtelierFile, type FileVerification } from "./AtelierReadback";
import {
  EVIDENCE_LEVELS,
  SAFETY_DOMAINS,
  type AtelierProject,
  type AtelierSource,
  type Component,
  type DesignDirection,
  type DesignVersion,
  type EvidenceLevel,
  type InspectedInput,
  type Material,
} from "./AtelierTypes";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/* ---------------- validation of what a model supplies ---------------- */

export function normalizeComponent(v: unknown, where: string): Component | string {
  if (!isObj(v)) return `${where}: a component is an object`;
  const id = s(v.id, 24);
  if (!/^[A-Za-z][A-Za-z0-9-]{0,23}$/.test(id)) return `${where}: id “${id}” must look like C-01`;
  const shape = s(v.shape) || "box";
  if (!["box", "cylinder", "sphere"].includes(shape)) return `${where} (${id}): shape must be box, cylinder or sphere`;
  const size = isObj(v.size) ? v.size : {};
  const width = n(size.width ?? size.diameter), depth = n(size.depth ?? size.width ?? size.diameter), height = n(size.height ?? size.width ?? size.diameter);
  if (width === null || width <= 0) return `${where} (${id}): size.width must be a positive number of mm`;
  if (shape === "box" && (depth === null || depth <= 0 || height === null || height <= 0)) return `${where} (${id}): a box needs positive width, depth and height (mm)`;
  if (shape === "cylinder" && (height === null || height <= 0)) return `${where} (${id}): a cylinder needs a positive height (mm)`;
  const p = isObj(v.position) ? v.position : {};
  const position = { x: n(p.x) ?? 0, y: n(p.y) ?? 0, z: n(p.z) ?? 0 };
  const qty = n(v.quantity) ?? 1;
  if (!Number.isInteger(qty) || qty < 1) return `${where} (${id}): quantity must be a whole number ≥ 1`;
  const unitCost = v.unitCost === undefined || v.unitCost === null ? undefined : n(v.unitCost);
  if (unitCost === null || (unitCost !== undefined && unitCost < 0)) return `${where} (${id}): unitCost must be a number ≥ 0 (or omitted when unknown)`;
  const make = s(v.make);
  return {
    id,
    name: s(v.name, 120) || id,
    shape: shape as Component["shape"],
    size: { width, depth: shape === "box" ? depth! : width, height: shape === "sphere" ? width : height! },
    position,
    material: s(v.material, 80) || "unspecified",
    quantity: qty,
    unitCost,
    sources: Array.isArray(v.sources) ? v.sources.map((x) => s(x, 40)).filter(Boolean) : undefined,
    supplier: s(v.supplier, 120) || undefined,
    notes: s(v.notes, 600) || undefined,
    tolerance: n(v.tolerance) ?? undefined,
    step: n(v.step) ?? undefined,
    make: make === "buy" || make === "fabricate" ? make : undefined,
    connects: Array.isArray(v.connects) ? v.connects.filter(isObj).map((w) => ({ to: s(w.to, 24), signal: s(w.signal, 40) || "signal" })).filter((w) => w.to) : undefined,
  };
}

export function normalizeDirection(v: unknown, index: number): DesignDirection | string {
  const where = `direction ${index + 1}`;
  if (!isObj(v)) return `${where} is not an object`;
  const name = s(v.name, 120);
  if (!name) return `${where}: a direction needs a name`;
  const architecture = s(v.architecture);
  if (!architecture) return `${where} (${name}): state its technical architecture — the principle that makes it different`;
  const raw = Array.isArray(v.components) ? v.components : [];
  if (raw.length === 0) return `${where} (${name}): a direction needs components`;
  if (raw.length > 120) return `${where}: at most 120 components`;
  const components: Component[] = [];
  for (const [i, c] of raw.entries()) {
    const comp = normalizeComponent(c, `${where} component ${i + 1}`);
    if (typeof comp === "string") return comp;
    if (components.some((x) => x.id === comp.id)) return `${where}: two components are ${comp.id}; IDs must be unique`;
    components.push(comp);
  }
  for (const c of components) for (const w of c.connects ?? []) if (!components.some((x) => x.id === w.to)) return `${where}: ${c.id} connects to ${w.to}, which is not a component`;
  const claims = (Array.isArray(v.claims) ? v.claims : []).filter(isObj).map((c) => {
    const level = (EVIDENCE_LEVELS as readonly string[]).includes(s(c.level)) ? (s(c.level) as EvidenceLevel) : "conceptual";
    return { text: s(c.text, 600), level, sources: Array.isArray(c.sources) ? c.sources.map((x) => s(x, 40)) : undefined };
  }).filter((c) => c.text);
  const complexity = isObj(v.complexity) ? v.complexity : {};
  const score = Math.min(5, Math.max(1, Math.round(n(complexity.score) ?? n(v.complexity) ?? 3)));
  return {
    id: s(v.id, 12) || `D${index + 1}`,
    name,
    identity: s(v.identity, 300),
    concept: s(v.concept, 2000),
    conceptImage: /^data:image\//.test(s(v.conceptImage, 20_000_000)) ? s(v.conceptImage, 20_000_000) : undefined,
    function: s(v.function, 2000),
    architecture,
    components,
    claims,
    limitations: Array.isArray(v.limitations) ? v.limitations.map((x) => s(x, 400)).filter(Boolean) : [],
    validationRequired: Array.isArray(v.validationRequired) ? v.validationRequired.map((x) => s(x, 400)).filter(Boolean) : [],
    complexity: { score, reason: s(complexity.reason, 300) || s(v.complexityReason, 300) },
    derivedFrom: Array.isArray(v.derivedFrom) ? v.derivedFrom.map((x) => s(x, 12)) : undefined,
  };
}

/* ---------------- assessment ---------------- */

export interface Assessment {
  /** The highest level the design as a whole can honestly claim. */
  level: EvidenceLevel;
  why: string[];
  bom: BomSummary;
  interferences: ReturnType<typeof interferences>;
  /** Domains needing a qualified person before anyone builds it. */
  safety: Array<{ domain: string; reviewer: string }>;
  /** Claims citing a source the project does not hold, or an inaccessible one. */
  unsupportedClaims: string[];
}

export function assess(project: AtelierProject, d: DesignDirection, fileChecks?: FileVerification[]): Assessment {
  const bom = billOfMaterials(d, project.materials);
  const hits = interferences(d.components);
  const known = new Map(project.sources.map((x) => [x.id, x]));
  const unsupported = d.claims.filter((c) => (c.sources ?? []).some((id) => !known.has(id) || known.get(id)!.inaccessible)).map((c) => c.text);
  const why: string[] = [];
  let level: EvidenceLevel = "conceptual";
  const researched = d.claims.some((c) => c.sources?.length && c.sources.every((id) => known.has(id) && !known.get(id)!.inaccessible)) || d.components.some((c) => c.sources?.some((id) => known.has(id)));
  if (researched) { level = "research-supported"; why.push("claims or parts cite sources the project holds"); }
  else why.push("no cited source supports it yet");
  if (bom.unweighed.length < d.components.length) {
    if (researched) { level = "calculated"; why.push(`mass ${bom.totalMass} g and cost are calculated from the stated parts`); }
    else why.push(`mass ${bom.totalMass} g is calculated, but from unsourced inputs`);
  }
  const filesOk = fileChecks?.length ? fileChecks.every((f) => f.ok) : false;
  if (level === "calculated" && hits.length === 0 && filesOk) { level = "software-validated"; why.push("no interference between parts (bounding-box check) and every exported file passed read-back"); }
  else if (hits.length) why.push(`${hits.length} interference(s): ${hits.map((h) => `${h.a}/${h.b}`).join(", ")}`);
  // Higher levels need evidence this system cannot produce.
  for (const higher of ["simulated", "independently-reviewed", "physically-tested"] as const) {
    if (d.claims.some((c) => c.level === higher && c.sources?.some((id) => known.has(id)))) why.push(`a ${higher} result is cited for one claim; the design as a whole is not promoted by it`);
  }
  const text = [project.brief, d.name, d.function, d.architecture, ...d.components.map((c) => `${c.name} ${c.material}`)].join(" ");
  const safety = SAFETY_DOMAINS.filter((x) => x.pattern.test(text)).map((x) => ({ domain: x.domain, reviewer: x.reviewer }));
  return { level, why, bom, interferences: hits, safety, unsupportedClaims: unsupported };
}

/* ---------------- the store ---------------- */

type Listener = () => void;
const STORAGE_KEY = "lelu.atelier.projects.v1";

function storage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}
function newId(prefix: string): string {
  const b = new Uint8Array(5);
  globalThis.crypto.getRandomValues(b);
  return `${prefix}_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export interface ExportedFile {
  directionId: string;
  version: number;
  format: AtelierFormat;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  verification: FileVerification;
}

export default class AtelierStore {
  private static instance: AtelierStore | null = null;
  private projects = new Map<string, AtelierProject>();
  private listeners = new Set<Listener>();
  private version = 0;
  private files = new Map<string, ExportedFile[]>();

  static getInstance(): AtelierStore {
    if (!AtelierStore.instance) AtelierStore.instance = new AtelierStore();
    return AtelierStore.instance;
  }
  static createIsolated(): AtelierStore { return new AtelierStore(false); }

  private constructor(private persist = true) {
    if (!persist) return;
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (raw) for (const p of JSON.parse(raw) as AtelierProject[]) this.projects.set(p.id, p);
    } catch { /* start empty */ }
  }
  private save() {
    if (this.persist) { try { storage()?.setItem(STORAGE_KEY, JSON.stringify([...this.projects.values()])); } catch { /* quota */ } }
    this.version += 1;
    for (const l of this.listeners) l();
  }
  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  getVersion(): number { return this.version; }
  list(): AtelierProject[] { return [...this.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
  get(id: string): AtelierProject | undefined { return this.projects.get(id); }
  latest(p: AtelierProject): DesignVersion { return p.versions[p.versions.length - 1]; }
  resolve(ref?: string, conversationId?: string): AtelierProject | undefined {
    const r = (ref ?? "").trim();
    const pool = this.list();
    if (!r || /^(this|it|latest|last)$/i.test(r)) return (conversationId ? pool.find((p) => p.conversationId === conversationId) : undefined) ?? pool[0];
    const exact = this.projects.get(r);
    if (exact) return exact;
    // A planned step names the project through an earlier step's output: the id inside it is the reference.
    for (const id of r.match(/\batl_[a-z0-9]+\b/gi) ?? []) {
      const tagged = this.projects.get(id);
      if (tagged) return tagged;
    }
    return pool.find((p) => p.title.toLowerCase().includes(r.toLowerCase()));
  }

  create(input: { title: unknown; brief: unknown; currency?: unknown; inputs?: unknown; sources?: unknown; materials?: unknown; conversationId?: string }): Result<{ project: AtelierProject }> {
    const title = s(input.title, 160);
    if (!title) return { ok: false, reason: "a project needs a title" };
    const inputs: InspectedInput[] = (Array.isArray(input.inputs) ? input.inputs : []).filter(isObj).map((x, i) => {
      const method = s(x.method, 200);
      const findings = s(x.findings, 4000);
      // "Inspected" means a method and findings exist — a file name alone is not inspection.
      return { id: s(x.id, 20) || `I${i + 1}`, kind: (s(x.kind) || "text") as InspectedInput["kind"], name: s(x.name, 200) || `input ${i + 1}`, findings, method: method || undefined, inspected: Boolean(method && findings) };
    });
    const sources: AtelierSource[] = (Array.isArray(input.sources) ? input.sources : []).filter(isObj).map((x, i) => ({ id: s(x.id, 20) || `S${i + 1}`, title: s(x.title, 300), url: s(x.url, 1000) || undefined, kind: (s(x.kind) || "other") as AtelierSource["kind"], accessed: s(x.accessed, 40) || undefined, supports: s(x.supports, 400) || undefined, inaccessible: x.inaccessible === true })).filter((x) => x.title);
    const materials: Material[] = (Array.isArray(input.materials) ? input.materials : []).filter(isObj).map((m) => ({ name: s(m.name, 80), density: n(m.density) ?? NaN, source: s(m.source, 40) || undefined })).filter((m) => m.name && Number.isFinite(m.density) && m.density > 0);
    const now = Date.now();
    const project: AtelierProject = { id: newId("atl"), title, brief: s(input.brief, 6000), currency: s(input.currency, 8) || "EUR", inputs, sources, materials, versions: [{ version: 1, at: now, note: "project created", directions: [] }], createdAt: now, updatedAt: now, conversationId: input.conversationId };
    this.projects.set(project.id, project);
    this.save();
    return { ok: true, project };
  }

  private commit(p: AtelierProject, directions: DesignDirection[], note: string, extra: Partial<DesignVersion> = {}): DesignVersion {
    const prev = this.latest(p);
    const v: DesignVersion = { version: prev.version + 1, at: Date.now(), note, directions: JSON.parse(JSON.stringify(directions)), selected: extra.selected ?? prev.selected, changed: extra.changed };
    p.versions.push(v);
    p.updatedAt = v.at;
    this.save();
    return v;
  }

  /** Add design directions. Refuses ones that are cosmetic variations of another (same parts, materials and principle). */
  addDirections(projectId: string, raw: unknown[], options: { allowSimilar?: boolean } = {}): Result<{ version: DesignVersion; similar: Array<{ a: string; b: string; similarity: number }> }> {
    const p = this.projects.get(projectId);
    if (!p) return { ok: false, reason: `no project ${projectId}` };
    const existing = this.latest(p).directions;
    const added: DesignDirection[] = [];
    for (const [i, r] of raw.entries()) {
      const d = normalizeDirection(r, existing.length + i);
      if (typeof d === "string") return { ok: false, reason: `${d}. Nothing was added.` };
      if ([...existing, ...added].some((x) => x.id === d.id)) d.id = `D${existing.length + added.length + 1}`;
      added.push(d);
    }
    const all = [...existing, ...added];
    const similar = cosmeticPairs(all).filter((pr) => added.some((a) => a.id === pr.a || a.id === pr.b));
    if (similar.length && !options.allowSimilar) {
      return { ok: false, reason: `These are cosmetic variations, not different architectures: ${similar.map((x) => `${x.a} and ${x.b} share ${Math.round(x.similarity * 100)}% of their parts, materials and principle`).join("; ")}. Change the working principle or the parts. Nothing was added.` };
    }
    return { ok: true, version: this.commit(p, all, `added ${added.map((d) => `${d.id} ${d.name}`).join(", ")}`), similar };
  }

  /** Change one component in one direction; everything made from the components follows. */
  updateComponent(projectId: string, directionId: string, componentId: string, patch: Record<string, unknown>): Result<{ version: DesignVersion; before: Component; after: Component }> {
    const p = this.projects.get(projectId);
    if (!p) return { ok: false, reason: `no project ${projectId}` };
    const dirs: DesignDirection[] = JSON.parse(JSON.stringify(this.latest(p).directions));
    const d = dirs.find((x) => x.id === directionId);
    if (!d) return { ok: false, reason: `no direction ${directionId} (have ${dirs.map((x) => x.id).join(", ")})` };
    const i = d.components.findIndex((c) => c.id === componentId);
    const before = i >= 0 ? d.components[i] : undefined;
    if (patch.remove === true) {
      if (!before) return { ok: false, reason: `no component ${componentId} in ${directionId}` };
      d.components.splice(i, 1);
      for (const c of d.components) c.connects = c.connects?.filter((w) => w.to !== componentId);
      return { ok: true, version: this.commit(p, dirs, `removed ${componentId} from ${directionId}`, { changed: [componentId] }), before, after: before };
    }
    const merged = { ...(before ?? { id: componentId }), ...patch, id: componentId, size: { ...(before?.size ?? {}), ...(isObj(patch.size) ? patch.size : {}) }, position: { ...(before?.position ?? {}), ...(isObj(patch.position) ? patch.position : {}) } };
    const after = normalizeComponent(merged, `${directionId} ${componentId}`);
    if (typeof after === "string") return { ok: false, reason: `${after}. Nothing was changed.` };
    if (i >= 0) d.components[i] = after; else d.components.push(after);
    return { ok: true, version: this.commit(p, dirs, `${before ? "changed" : "added"} ${componentId} in ${directionId}`, { changed: [componentId] }), before: before ?? after, after };
  }

  /** A new direction from an existing one (fork) or from several (combine). Originals are untouched. */
  derive(projectId: string, from: string[], change: { name: string; architecture?: string; components?: unknown[]; identity?: string }): Result<{ version: DesignVersion; direction: DesignDirection }> {
    const p = this.projects.get(projectId);
    if (!p) return { ok: false, reason: `no project ${projectId}` };
    const dirs = this.latest(p).directions;
    const sources = from.map((id) => dirs.find((d) => d.id === id));
    if (sources.some((x) => !x) || sources.length === 0) return { ok: false, reason: `unknown direction(s): ${from.filter((id) => !dirs.some((d) => d.id === id)).join(", ") || "(none given)"}` };
    const base = sources[0]!;
    const components = change.components ?? (sources.length > 1
      ? sources.flatMap((x, k) => x!.components.map((c) => ({ ...c, id: k === 0 ? c.id : `${c.id}-${x!.id}` })))
      : base.components);
    const raw = { ...base, id: `D${dirs.length + 1}`, name: change.name, identity: change.identity ?? base.identity, architecture: change.architecture ?? (sources.length > 1 ? `Combination of ${from.join(" + ")}: ${sources.map((x) => x!.architecture).join(" / ")}` : base.architecture), components, derivedFrom: from };
    const d = normalizeDirection(raw, dirs.length);
    if (typeof d === "string") return { ok: false, reason: d };
    return { ok: true, version: this.commit(p, [...dirs, d], `${sources.length > 1 ? "combined" : "forked"} ${from.join(" + ")} into ${d.id} ${d.name}`), direction: d };
  }

  select(projectId: string, directionId: string): Result<{ version: DesignVersion }> {
    const p = this.projects.get(projectId);
    if (!p) return { ok: false, reason: `no project ${projectId}` };
    const dirs = this.latest(p).directions;
    if (!dirs.some((d) => d.id === directionId)) return { ok: false, reason: `no direction ${directionId}` };
    return { ok: true, version: this.commit(p, dirs, `selected ${directionId}`, { selected: directionId }) };
  }

  addSources(projectId: string, raw: unknown[]): Result<{ added: number }> {
    const p = this.projects.get(projectId);
    if (!p) return { ok: false, reason: `no project ${projectId}` };
    let added = 0;
    for (const x of raw.filter(isObj)) {
      const title = s(x.title, 300);
      if (!title) continue;
      const id = s(x.id, 20) || `S${p.sources.length + 1}`;
      if (p.sources.some((y) => y.id === id)) continue;
      p.sources.push({ id, title, url: s(x.url, 1000) || undefined, kind: (s(x.kind) || "other") as AtelierSource["kind"], supports: s(x.supports, 400) || undefined, accessed: s(x.accessed, 40) || undefined, inaccessible: x.inaccessible === true });
      added += 1;
    }
    p.updatedAt = Date.now();
    this.save();
    return { ok: true, added };
  }

  direction(p: AtelierProject, id?: string, version?: number): DesignDirection | undefined {
    const v = version ? p.versions.find((x) => x.version === version) : this.latest(p);
    const dirs = v?.directions ?? [];
    return id ? dirs.find((d) => d.id === id) : dirs.find((d) => d.id === v?.selected) ?? dirs[0];
  }

  /** Write, re-open and verify design files for one direction. */
  exportFiles(projectId: string, directionId: string, formats: string[]): Result<{ files: ExportedFile[]; refused: Array<{ format: string; reason: string }> }> {
    const p = this.projects.get(projectId);
    if (!p) return { ok: false, reason: `no project ${projectId}` };
    const d = this.direction(p, directionId);
    if (!d) return { ok: false, reason: `no direction ${directionId}` };
    const v = this.latest(p);
    const files: ExportedFile[] = [];
    const refused: Array<{ format: string; reason: string }> = [];
    const level = assess(p, d).level;
    for (const raw of formats) {
      const f = raw.toLowerCase();
      if (UNSUPPORTED_FORMATS[f]) { refused.push({ format: f, reason: UNSUPPORTED_FORMATS[f] }); continue; }
      if (!(ATELIER_FORMATS as readonly string[]).includes(f)) { refused.push({ format: f, reason: `not an Atelier format (${ATELIER_FORMATS.join(", ")})` }); continue; }
      const written = writeAtelierFile(d, f as AtelierFormat, { project: p.title, version: v.version, level });
      const slug = `${p.title}-${d.id}-v${v.version}`.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").slice(0, 70);
      files.push({ directionId: d.id, version: v.version, format: f as AtelierFormat, filename: `${slug}.${written.ext}`, mime: written.mime, bytes: written.bytes, verification: verifyAtelierFile(d, f as AtelierFormat, written.bytes) });
    }
    this.files.set(projectId, [...(this.files.get(projectId) ?? []).filter((f) => !files.some((n) => n.filename === f.filename)), ...files]);
    p.exports = [...(p.exports ?? []), ...files.map((f) => ({ directionId: f.directionId, version: f.version, format: f.format, filename: f.filename, size: f.bytes.length, ok: f.verification.ok, at: Date.now(), checks: f.verification.checks }))].slice(-200);
    p.updatedAt = Date.now();
    this.save();
    return { ok: true, files, refused };
  }

  /** The bytes of an exported design file, written again (and re-verified) when not held in memory. */
  fileOf(projectId: string, filename: string): ExportedFile | undefined {
    const held = this.files.get(projectId)?.find((f) => f.filename === filename);
    if (held) return held;
    const p = this.projects.get(projectId);
    const rec = p?.exports?.find((e) => e.filename === filename);
    if (!p || !rec || rec.version !== this.latest(p).version) return undefined;
    const again = this.exportFiles(projectId, rec.directionId, [rec.format]);
    return again.ok ? again.files.find((f) => f.verification.ok) : undefined;
  }
}
