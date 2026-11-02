/**
 * ==========================================================
 * LÉLU — SESSION 3C: PROJECT LIBRARY
 *
 * The persistent library the spec asks for: source, versions, builds,
 * tests, assets, documentation and deployment records for every project
 * the studio creates, so LÉLU can reopen and improve one later.
 *
 * It stores FACTS the runtime measured. A build record is written from a
 * real exit code, a version from a real file set. Nothing here invents a
 * success.
 *
 * Storage is pluggable so the library is testable without a browser; the
 * default is the app's existing KvStore, which is already the one
 * persistence layer for projects.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { persistedDisplayName, type PersistedStudioProject } from "./StudioPersistence";
import {
  studioSlug,
  type StudioAssetRef,
  type StudioBuildRecord,
  type StudioDeployment,
  type StudioEngineId,
  type StudioProject,
  type StudioProjectKind,
  type StudioTestRecord,
  type StudioVersion,
} from "./StudioTypes";

export interface StudioStorePort {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

const kvPort: StudioStorePort = {
  get<T>(key: string): T | null {
    return KvStore.getInstance().get<T>(key) ?? null;
  },
  set(key: string, value: unknown): void {
    KvStore.getInstance().set(key, value);
  },
};

const KEY = "lelu.studio.library.v1";
const MAX_RECORDS = 20;
const MAX_PROJECTS = 40;

/** FNV-1a over a sorted file set: the same content gives the same version. */
export function contentHash(files: Record<string, string>): string {
  const paths = Object.keys(files).sort();
  let hash = 0x811c9dc5;
  for (const path of paths) {
    const body = `${path}\u0000${files[path]}\u0001`;
    for (let index = 0; index < body.length; index += 1) {
      hash ^= body.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

export function byteSize(files: Record<string, string>): number {
  let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    bytes += path.length + content.length;
  }
  return bytes;
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function trim<T>(records: T[]): T[] {
  return records.slice(-MAX_RECORDS);
}

export interface CreateStudioProjectInput {
  name: string;
  kind: StudioProjectKind;
  engine: StudioEngineId;
  stack: string;
  root: string;
  documentation?: string;
}

export default class StudioLibrary {
  private static instance: StudioLibrary | null = null;
  private projects: StudioProject[];

  constructor(private readonly store: StudioStorePort = kvPort) {
    this.projects = this.load();
  }

  public static getInstance(): StudioLibrary {
    if (!StudioLibrary.instance) StudioLibrary.instance = new StudioLibrary();
    return StudioLibrary.instance;
  }

  /** Fresh library over an explicit store (tests). */
  public static resetForTests(store: StudioStorePort = kvPort): StudioLibrary {
    StudioLibrary.instance = new StudioLibrary(store);
    return StudioLibrary.instance;
  }

  private load(): StudioProject[] {
    const stored = this.store.get<StudioProject[]>(KEY);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (project) =>
        project &&
        typeof project.id === "string" &&
        typeof project.slug === "string" &&
        Array.isArray(project.versions),
    );
  }

  private persist(): void {
    try {
      this.store.set(KEY, this.projects);
    } catch {
      /* a blocked storage must never break the studio */
    }
  }

  public list(): StudioProject[] {
    return [...this.projects].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public get(idOrSlug: string): StudioProject | null {
    return (
      this.projects.find((project) => project.id === idOrSlug || project.slug === idOrSlug) ?? null
    );
  }

  /** Create a project record for a directory the runtime really created. */
  public create(input: CreateStudioProjectInput): StudioProject {
    const slug = studioSlug(input.name);
    if (this.get(slug)) {
      throw new Error(`A studio project with the slug "${slug}" already exists.`);
    }
    const now = Date.now();
    const project: StudioProject = {
      id: id("studio"),
      slug,
      name: input.name.trim() || slug,
      kind: input.kind,
      engine: input.engine,
      stack: input.stack,
      root: input.root,
      createdAt: now,
      updatedAt: now,
      versions: [],
      builds: [],
      tests: [],
      assets: [],
      deployments: [],
      documentation: input.documentation ?? "",
      previewUrl: null,
      lastOpenedAt: now,
    };
    this.projects = [project, ...this.projects].slice(0, MAX_PROJECTS);
    this.persist();
    return project;
  }

  public update(idOrSlug: string, patch: Partial<StudioProject>): StudioProject | null {
    const project = this.get(idOrSlug);
    if (!project) return null;
    const next: StudioProject = { ...project, ...patch, updatedAt: Date.now() };
    this.projects = this.projects.map((item) => (item.id === project.id ? next : item));
    this.persist();
    return next;
  }

  /** Reopen: record that it was opened, keep everything else. */
  public reopen(idOrSlug: string): StudioProject | null {
    return this.update(idOrSlug, { lastOpenedAt: Date.now() });
  }

  public remove(idOrSlug: string): boolean {
    const project = this.get(idOrSlug);
    if (!project) return false;
    this.projects = this.projects.filter((item) => item.id !== project.id);
    this.persist();
    return true;
  }

  /** A snapshot of the real file set, with a comparable content hash. */
  public recordVersion(
    idOrSlug: string,
    files: Record<string, string>,
    note?: string,
  ): StudioVersion | null {
    const project = this.get(idOrSlug);
    if (!project) return null;
    const version: StudioVersion = {
      id: id("ver"),
      label: `v${project.versions.length + 1}`,
      createdAt: Date.now(),
      files: Object.keys(files).length,
      bytes: byteSize(files),
      hash: contentHash(files),
      note,
    };
    project.versions = trim([...project.versions, version]);
    project.updatedAt = Date.now();
    this.persist();
    return version;
  }

  /**
   * A version the runtime hashed itself (build output), when the whole
   * file set is not in the client's hands.
   */
  public recordVersionManifest(
    idOrSlug: string,
    meta: { files: number; bytes: number; hash: string; note?: string },
  ): StudioVersion | null {
    const project = this.get(idOrSlug);
    if (!project) return null;
    const version: StudioVersion = {
      id: id("ver"),
      label: `v${project.versions.length + 1}`,
      createdAt: Date.now(),
      files: meta.files,
      bytes: meta.bytes,
      hash: meta.hash,
      note: meta.note,
    };
    project.versions = trim([...project.versions, version]);
    project.updatedAt = Date.now();
    this.persist();
    return version;
  }

  public recordBuild(idOrSlug: string, build: Omit<StudioBuildRecord, "id">): StudioBuildRecord | null {
    const project = this.get(idOrSlug);
    if (!project) return null;
    const record: StudioBuildRecord = { ...build, id: id("build") };
    project.builds = trim([...project.builds, record]);
    project.updatedAt = Date.now();
    this.persist();
    return record;
  }

  public recordTest(idOrSlug: string, run: Omit<StudioTestRecord, "id">): StudioTestRecord | null {
    const project = this.get(idOrSlug);
    if (!project) return null;
    const record: StudioTestRecord = { ...run, id: id("test") };
    project.tests = trim([...project.tests, record]);
    project.updatedAt = Date.now();
    this.persist();
    return record;
  }

  public recordAssets(idOrSlug: string, assets: StudioAssetRef[]): StudioProject | null {
    return this.update(idOrSlug, { assets: [...assets] });
  }

  public recordDeployment(
    idOrSlug: string,
    deployment: Omit<StudioDeployment, "id">,
  ): StudioDeployment | null {
    const project = this.get(idOrSlug);
    if (!project) return null;
    const record: StudioDeployment = { ...deployment, id: id("deploy") };
    project.deployments = trim([...project.deployments, record]);
    project.updatedAt = Date.now();
    this.persist();
    return record;
  }

  /**
   * Adopt projects that exist on disk but are absent from this browser's
   * library. No build/version/test record is invented: the disk flag is
   * kept separately and the next real build/test fills the history.
   */
  public syncFromDisk(entries: readonly PersistedStudioProject[]): StudioProject[] {
    const bySlug = new Map(this.projects.map((project) => [project.slug, project]));
    let changed = false;
    for (const entry of entries) {
      if (bySlug.has(entry.slug)) continue;
      const now = Date.now();
      const project: StudioProject = {
        id: `studio-disk-${entry.slug}`,
        slug: entry.slug,
        name: persistedDisplayName(entry.slug),
        kind: "application",
        engine: "web",
        stack: "persisted on disk",
        root: `.lelu-studio/${entry.slug}`,
        createdAt: entry.updatedAt,
        updatedAt: entry.updatedAt,
        versions: [],
        builds: [],
        tests: [],
        assets: [],
        deployments: [],
        documentation: `Found on disk at .lelu-studio/${entry.slug}. Build and test history is recorded the next time they run.`,
        previewUrl: null,
        lastOpenedAt: now,
        discovered: true,
        discoveredBuilt: entry.built,
      };
      this.projects = [...this.projects, project];
      bySlug.set(entry.slug, project);
      changed = true;
    }
    if (changed) this.persist();
    const onDisk = new Set(entries.map((entry) => entry.slug));
    return this.list().filter((project) => onDisk.has(project.slug));
  }

  /** A factual description for LÉLU's own context. */
  public describe(idOrSlug: string): string {
    const project = this.get(idOrSlug);
    if (!project) return `No studio project named "${idOrSlug}".`;
    const latestBuild = project.builds.at(-1);
    const latestTest = project.tests.at(-1);
    const parts = [
      `${project.name} (${project.kind}, ${project.engine}) at ${project.root}.`,
      `${project.versions.length} version(s), ${project.assets.length} asset reference(s).`,
    ];
    if (latestBuild) {
      parts.push(
        `Last build exited ${latestBuild.exitCode} (${latestBuild.ok ? "passed" : "FAILED"})` +
          `${latestBuild.artifact ? `, output ${latestBuild.artifact}` : ""}.`,
      );
    } else {
      parts.push("No build has been run.");
    }
    if (latestTest) {
      parts.push(
        `Last tests: ${latestTest.passed} passed, ${latestTest.failed} failed (exit ${latestTest.exitCode}).`,
      );
    }
    if (project.previewUrl) parts.push(`Preview: ${project.previewUrl}.`);
    const deployments = project.deployments.at(-1);
    if (deployments) parts.push(`Last deployment: ${deployments.environment} ${deployments.status}.`);
    return parts.join(" ");
  }
}
