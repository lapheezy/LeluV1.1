/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — PERSISTENT PROJECT STATE
 *
 * Part VI.4: a character project keeps its references, geometry, materials, hair
 * parameters, jewelry, garments, render settings, versions, validation reports
 * and export history, and can restore an earlier version.
 *
 * The storage rule is the same one ASRE's character store already proves:
 * a version is immutable. Adding a version writes a NEW directory; restoring an
 * earlier one writes another new version that copies the earlier bytes. Nothing
 * is ever overwritten or deleted, so a failed experiment can never destroy
 * geometry that worked.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface RenderRecord {
  shot: string;
  file: string;
  sha256: string;
  seconds: number | null;
  camera: unknown;
  comparison: unknown;
}

export interface VersionValidation {
  verdict: "matches" | "close" | "differs" | "unknown" | "unvalidated";
  landmarks?: unknown;
  hair?: unknown;
  notes: string[];
  validatedAt: string;
}

export interface FoundryVersion {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  parentId: string | null;
  operation: string;
  spec: Record<string, unknown>;
  model: { file: string; sha256: string; bytes: number };
  triangles: number | null;
  validation: VersionValidation | null;
  renders: RenderRecord[];
  exports: Array<{ format: string; file: string; at: string }>;
  notes: string[];
}

export interface FoundryProject {
  id: string;
  name: string;
  subject: string;
  createdAt: string;
  head: string;
  versions: string[];
  redo: string[];
  settings: Record<string, unknown>;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function projectsRoot(root: string): string {
  return path.join(root, "projects");
}

export function projectDir(root: string, id: string): string {
  return path.join(projectsRoot(root), id);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
}

export function listProjects(root: string): FoundryProject[] {
  const dir = projectsRoot(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(path.join(dir, name, "project.json")))
    .map((name) => readJson<FoundryProject>(path.join(dir, name, "project.json")))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function readProject(root: string, id: string): FoundryProject {
  const file = path.join(projectDir(root, id), "project.json");
  if (!existsSync(file)) throw new Error(`no Foundry project "${id}" under ${projectsRoot(root)}`);
  return readJson<FoundryProject>(file);
}

export function createProject(root: string, input: { id: string; name?: string; subject?: string; settings?: Record<string, unknown> }): FoundryProject {
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/i.test(input.id)) throw new Error(`project id "${input.id}" must be letters, digits, dash or underscore`);
  const dir = projectDir(root, input.id);
  if (existsSync(path.join(dir, "project.json"))) throw new Error(`project "${input.id}" already exists`);
  const project: FoundryProject = {
    id: input.id,
    name: input.name ?? input.id,
    subject: input.subject ?? "unspecified",
    createdAt: new Date().toISOString(),
    head: "",
    versions: [],
    redo: [],
    settings: input.settings ?? {},
  };
  writeJson(path.join(dir, "project.json"), project);
  return project;
}

function saveProject(root: string, project: FoundryProject): void {
  writeJson(path.join(projectDir(root, project.id), "project.json"), project);
}

export function readVersion(root: string, projectId: string, versionId: string): FoundryVersion {
  const file = path.join(projectDir(root, projectId), "versions", versionId, "record.json");
  if (!existsSync(file)) throw new Error(`no version "${versionId}" in project "${projectId}"`);
  return readJson<FoundryVersion>(file);
}

export function listVersions(root: string, projectId: string): FoundryVersion[] {
  const project = readProject(root, projectId);
  return project.versions.map((v) => readVersion(root, projectId, v));
}

export interface AddVersionInput {
  /** GLB to copy into the project. It is read, never modified. */
  sourceGlb: string;
  label: string;
  operation: string;
  spec?: Record<string, unknown>;
  triangles?: number | null;
  validation?: VersionValidation | null;
  parentId?: string | null;
  notes?: string[];
}

function nextId(versions: string[]): string {
  const n = versions.reduce((max, v) => Math.max(max, Number(/^v(\d+)$/.exec(v)?.[1] ?? 0)), 0);
  return `v${String(n + 1).padStart(4, "0")}`;
}

export function addVersion(root: string, projectId: string, input: AddVersionInput): FoundryVersion {
  const project = readProject(root, projectId);
  if (!existsSync(input.sourceGlb)) throw new Error(`source model does not exist: ${input.sourceGlb}`);
  const id = nextId(project.versions);
  const dir = path.join(projectDir(root, projectId), "versions", id);
  if (existsSync(dir)) throw new Error(`version directory ${id} already exists — versions are immutable`);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "model.glb");
  copyFileSync(input.sourceGlb, target);
  const bytes = readFileSync(target);
  const version: FoundryVersion = {
    id,
    projectId,
    label: input.label,
    createdAt: new Date().toISOString(),
    parentId: input.parentId ?? (project.head || null),
    operation: input.operation,
    spec: input.spec ?? {},
    model: { file: path.relative(projectDir(root, projectId), target), sha256: sha256(bytes), bytes: bytes.length },
    triangles: input.triangles ?? null,
    validation: input.validation ?? null,
    renders: [],
    exports: [],
    notes: input.notes ?? [],
  };
  writeJson(path.join(dir, "record.json"), version);
  project.versions = [...project.versions, id];
  project.head = id;
  project.redo = [];
  saveProject(root, project);
  return version;
}

/** Restore an earlier version as a NEW version; the original stays untouched. */
export function restoreVersion(root: string, projectId: string, from: string, groups?: string[]): FoundryVersion {
  const source = readVersion(root, projectId, from);
  const sourcePath = path.join(projectDir(root, projectId), source.model.file);
  return addVersion(root, projectId, {
    sourceGlb: sourcePath,
    label: `restore ${from}${groups?.length ? ` (${groups.join(", ")})` : ""}`,
    operation: "restore",
    spec: groups?.length ? { restoredGroups: groups, from } : source.spec,
    triangles: source.triangles,
    validation: source.validation,
    parentId: from,
    notes: [`restored from ${from}${groups?.length ? ` — groups ${groups.join(", ")}` : " — everything"}`],
  });
}

export function recordRender(root: string, projectId: string, versionId: string, input: { shot: string; png: string; seconds?: number | null; camera?: unknown; comparison?: unknown }): RenderRecord {
  const version = readVersion(root, projectId, versionId);
  const file = path.join(projectDir(root, projectId), "versions", versionId, "renders", `${input.shot}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  copyFileSync(input.png, file);
  const render: RenderRecord = {
    shot: input.shot,
    file: path.relative(projectDir(root, projectId), file),
    sha256: sha256(readFileSync(file)),
    seconds: input.seconds ?? null,
    camera: input.camera ?? null,
    comparison: input.comparison ?? null,
  };
  version.renders = [...version.renders.filter((r) => r.shot !== input.shot), render];
  writeJson(path.join(projectDir(root, projectId), "versions", versionId, "record.json"), version);
  return render;
}

export function recordExport(root: string, projectId: string, versionId: string, format: string, file: string): FoundryVersion {
  const version = readVersion(root, projectId, versionId);
  version.exports = [...version.exports, { format, file, at: new Date().toISOString() }];
  writeJson(path.join(projectDir(root, projectId), "versions", versionId, "record.json"), version);
  return version;
}

export function setValidation(root: string, projectId: string, versionId: string, validation: VersionValidation): FoundryVersion {
  const version = readVersion(root, projectId, versionId);
  version.validation = validation;
  writeJson(path.join(projectDir(root, projectId), "versions", versionId, "record.json"), version);
  return version;
}

export interface ProjectVerification {
  id: string;
  ok: boolean;
  versions: Array<{ id: string; ok: boolean; expected: string; actual: string; bytes: number }>;
}

/** Re-hash every stored model: a version that changed on disk is reported, not trusted. */
export function verifyProject(root: string, projectId: string): ProjectVerification {
  const project = readProject(root, projectId);
  const versions = project.versions.map((id) => {
    const version = readVersion(root, projectId, id);
    const file = path.join(projectDir(root, projectId), version.model.file);
    const actual = existsSync(file) ? sha256(readFileSync(file)) : "";
    return { id, ok: actual === version.model.sha256, expected: version.model.sha256, actual, bytes: existsSync(file) ? statSync(file).size : 0 };
  });
  return { id: projectId, ok: versions.every((v) => v.ok), versions };
}

/** The base model for a render: the head of the project, or a named version. */
export function modelPath(root: string, projectId: string, versionId?: string): { version: FoundryVersion; file: string } {
  const project = readProject(root, projectId);
  const id = versionId ?? project.head;
  if (!id) throw new Error(`project "${projectId}" has no versions yet`);
  const version = readVersion(root, projectId, id);
  return { version, file: path.join(projectDir(root, projectId), version.model.file) };
}
