/**
 * ==========================================================
 * LÉLU — ONE STUDIO MODEL, TWO ARCHITECTURES
 *
 * LÉLU grew two studios instead of one:
 *
 *   • CREATION STUDIO (primary) — documents, decks and workbooks.
 *     An artifact is an `ArtifactSpec` with every revision kept, real
 *     exports (DOCX/PPTX/XLSX/PDF/HTML/MD/CSV/TXT/RTF), verification
 *     hashes and imported originals. It is the one wired into the
 *     Genesis shell, the Atelier and the chat tools, and it is the
 *     studio a person uses every day.
 *
 *   • SOFTWARE STUDIO (backup, Session 3C) — websites, applications
 *     and games. A project is a real directory with measured builds,
 *     tests, versions, assets, approvals and deployments.
 *
 * They are not competing stores: both describe a LÉLU project, and
 * both project into the ONE model below. The canonical record keeps
 * every field either side measured — revisions and exports for
 * documents, versions/builds/tests/deployments for software — so
 * nothing either architecture learned is lost, and no caller has to
 * guess which of two incompatible shapes it is holding.
 *
 * The primary architecture is the default experience. The software
 * studio stays intact and activatable (see StudioArchitectureRegistry)
 * but never initializes at the same time: one studio runs, one can be
 * restored.
 * ==========================================================
 */

import type { ArtifactSpec, ExportFormat } from "./StudioTypes";
import type { StudioArtifact } from "./StudioStore";
import type {
  StudioAssetRef,
  StudioBuildRecord,
  StudioDeployment,
  StudioEngineId,
  StudioProject,
  StudioProjectKind,
  StudioTestRecord,
  StudioVersion,
} from "./StudioProjectTypes";

/** Which of the two implementations produced a project. */
export type StudioArchitecture = "creation" | "software";

/** The studio a person gets by default: the one integrated with the shell. */
export const PRIMARY_STUDIO: StudioArchitecture = "creation";
/** The preserved alternate: intact, documented, activatable, not running. */
export const BACKUP_STUDIO: StudioArchitecture = "software";

export type CanonicalKind = ArtifactSpec["kind"] | StudioProjectKind;

export interface CanonicalRevision {
  rev: number;
  spec: ArtifactSpec;
  at: number;
  note: string;
  by: string;
  basedOn?: number;
}

export interface CanonicalExport {
  rev: number;
  format: ExportFormat;
  filename: string;
  sha256: string;
  size: number;
  ok: boolean;
  at: number;
}

export interface CanonicalDocument {
  id: string;
  title: string;
  kind: ArtifactSpec["kind"];
  /** The latest revision number. Every revision is kept in `revisions`. */
  revision: number;
  revisions: CanonicalRevision[];
  exports: CanonicalExport[];
  /** An imported file: what it was, and the hash of the bytes as given. */
  original?: StudioArtifact["original"];
}

/** Everything the software studio measured about a real project on disk. */
export interface CanonicalSoftware {
  engine: StudioEngineId;
  stack: string;
  /** Real directory inside the studio root. */
  root: string;
  versions: StudioVersion[];
  builds: StudioBuildRecord[];
  tests: StudioTestRecord[];
  assets: StudioAssetRef[];
  deployments: StudioDeployment[];
  documentation: string;
  previewUrl: string | null;
  lastOpenedAt: number | null;
  discovered?: boolean;
  discoveredBuilt?: boolean;
}

/**
 * The one project record. A creation artifact and a software project are
 * both this shape; `architecture` says which implementation owns it and
 * `software` is present exactly when a runtime measured one.
 */
export interface CanonicalStudioProject {
  /** Stable, architecture-scoped identity: `creation:art_…`, `software:focus-ledger`. */
  id: string;
  slug: string;
  name: string;
  architecture: StudioArchitecture;
  kind: CanonicalKind;
  createdAt: number;
  updatedAt: number;
  /** Monotonic revision: revision count of documents, version count of software. */
  revision: number;
  /** The chat this project came from, when it has one. */
  conversationId?: string;
  documents: CanonicalDocument[];
  software?: CanonicalSoftware;
  /** Extensible metadata from either side; never invented. */
  meta: Record<string, unknown>;
}

const CREATION_PREFIX = "creation:" as const;
const SOFTWARE_PREFIX = "software:" as const;

/** A stable id that cannot collide across the two architectures. */
export function canonicalId(architecture: StudioArchitecture, localId: string): string {
  return `${architecture === "creation" ? CREATION_PREFIX : SOFTWARE_PREFIX}${localId}`;
}

/** The architecture and local id behind a canonical id, or null if malformed. */
export function splitCanonicalId(id: string): { architecture: StudioArchitecture; localId: string } | null {
  const match = /^(creation|software):(.+)$/.exec(String(id ?? ""));
  if (!match) return null;
  return { architecture: match[1] as StudioArchitecture, localId: match[2] };
}

/* ------------------------------------------------------------------ */
/* creation → canonical                                                */
/* ------------------------------------------------------------------ */

export function fromCreationArtifact(artifact: StudioArtifact): CanonicalStudioProject {
  const revisions = artifact.revisions.map((revision) => ({
    rev: revision.rev,
    spec: revision.spec,
    at: revision.at,
    note: revision.note,
    by: revision.by,
    ...(revision.basedOn === undefined ? {} : { basedOn: revision.basedOn }),
  }));
  const revision = revisions.reduce((latest, entry) => Math.max(latest, entry.rev), 0);
  return {
    id: canonicalId("creation", artifact.id),
    slug: artifact.id,
    name: artifact.title,
    architecture: "creation",
    kind: artifact.kind,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    revision,
    ...(artifact.conversationId ? { conversationId: artifact.conversationId } : {}),
    documents: [
      {
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        revision,
        revisions,
        exports: artifact.exports.map((record) => ({
          rev: record.rev,
          format: record.format,
          filename: record.filename,
          sha256: record.sha256,
          size: record.size,
          ok: record.ok,
          at: record.at,
        })),
        ...(artifact.original ? { original: { ...artifact.original } } : {}),
      },
    ],
    meta: {},
  };
}

/* ------------------------------------------------------------------ */
/* software → canonical                                                */
/* ------------------------------------------------------------------ */

export function fromSoftwareProject(project: StudioProject): CanonicalStudioProject {
  return {
    id: canonicalId("software", project.slug || project.id),
    slug: project.slug,
    name: project.name,
    architecture: "software",
    kind: project.kind,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    revision: project.versions.length,
    documents: [],
    software: {
      engine: project.engine,
      stack: project.stack,
      root: project.root,
      versions: project.versions.map((version) => ({ ...version })),
      builds: project.builds.map((build) => ({ ...build })),
      tests: project.tests.map((record) => ({ ...record })),
      assets: project.assets.map((asset) => ({ ...asset })),
      deployments: project.deployments.map((deployment) => ({ ...deployment })),
      documentation: project.documentation,
      previewUrl: project.previewUrl,
      lastOpenedAt: project.lastOpenedAt,
      ...(project.discovered === undefined ? {} : { discovered: project.discovered }),
      ...(project.discoveredBuilt === undefined ? {} : { discoveredBuilt: project.discoveredBuilt }),
    },
    meta: { projectId: project.id },
  };
}

/**
 * Canonical → the software studio's own record. Used when the backup
 * architecture is reactivated, so a round trip never has to re-measure
 * what was already measured.
 */
export function toSoftwareProject(project: CanonicalStudioProject): StudioProject | null {
  if (!project.software) return null;
  const software = project.software;
  return {
    id: typeof project.meta.projectId === "string" ? project.meta.projectId : project.slug,
    slug: project.slug,
    name: project.name,
    kind: project.kind as StudioProjectKind,
    engine: software.engine,
    stack: software.stack,
    root: software.root,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    versions: software.versions.map((version) => ({ ...version })),
    builds: software.builds.map((build) => ({ ...build })),
    tests: software.tests.map((record) => ({ ...record })),
    assets: software.assets.map((asset) => ({ ...asset })),
    deployments: software.deployments.map((deployment) => ({ ...deployment })),
    documentation: software.documentation,
    previewUrl: software.previewUrl,
    lastOpenedAt: software.lastOpenedAt,
    ...(software.discovered === undefined ? {} : { discovered: software.discovered }),
    ...(software.discoveredBuilt === undefined ? {} : { discoveredBuilt: software.discoveredBuilt }),
  };
}

/* ------------------------------------------------------------------ */
/* legacy migration                                                    */
/* ------------------------------------------------------------------ */

const CREATION_STORAGE_KEY = "lelu.studio.artifacts.v1";
const SOFTWARE_STORAGE_KEY = "lelu.studio.library.v1";

export const LEGACY_STUDIO_KEYS = {
  creation: CREATION_STORAGE_KEY,
  software: SOFTWARE_STORAGE_KEY,
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArtifact(value: unknown): StudioArtifact | null {
  if (!isObject(value)) return null;
  const kind = value.kind;
  if (kind !== "document" && kind !== "deck" && kind !== "workbook") return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  if (!Array.isArray(value.revisions) || value.revisions.length === 0) return null;
  const revisions = value.revisions.filter(
    (revision): revision is StudioArtifact["revisions"][number] =>
      isObject(revision) && typeof revision.rev === "number" && isObject(revision.spec),
  );
  if (revisions.length === 0) return null;
  return {
    id: value.id,
    title: value.title,
    kind,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    ...(typeof value.conversationId === "string" ? { conversationId: value.conversationId } : {}),
    revisions,
    exports: Array.isArray(value.exports)
      ? (value.exports.filter(isObject) as unknown as StudioArtifact["exports"])
      : [],
    ...(isObject(value.original) ? { original: value.original as StudioArtifact["original"] } : {}),
  };
}

function asSoftwareProject(value: unknown): StudioProject | null {
  if (!isObject(value)) return null;
  const kind = value.kind;
  if (kind !== "website" && kind !== "application" && kind !== "game") return null;
  if (typeof value.slug !== "string" || typeof value.name !== "string") return null;
  const engine = value.engine;
  if (engine !== "web" && engine !== "godot" && engine !== "unity" && engine !== "unreal") return null;
  const arrayOf = <T>(candidate: unknown): T[] => (Array.isArray(candidate) ? (candidate as T[]) : []);
  return {
    id: typeof value.id === "string" ? value.id : value.slug,
    slug: value.slug,
    name: value.name,
    kind,
    engine,
    stack: typeof value.stack === "string" ? value.stack : "",
    root: typeof value.root === "string" ? value.root : "",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    versions: arrayOf<StudioVersion>(value.versions),
    builds: arrayOf<StudioBuildRecord>(value.builds),
    tests: arrayOf<StudioTestRecord>(value.tests),
    assets: arrayOf<StudioAssetRef>(value.assets),
    deployments: arrayOf<StudioDeployment>(value.deployments),
    documentation: typeof value.documentation === "string" ? value.documentation : "",
    previewUrl: typeof value.previewUrl === "string" ? value.previewUrl : null,
    lastOpenedAt: typeof value.lastOpenedAt === "number" ? value.lastOpenedAt : null,
    ...(typeof value.discovered === "boolean" ? { discovered: value.discovered } : {}),
    ...(typeof value.discoveredBuilt === "boolean" ? { discoveredBuilt: value.discoveredBuilt } : {}),
  };
}

/**
 * Read either legacy payload into the canonical model.
 *
 * Accepts exactly the shapes the two stores wrote — an array of creation
 * artifacts, `{ artifacts: [...] }`, an array or map of software projects,
 * `{ projects: [...] }`, or one bare record. Unreadable entries are
 * DROPPED and counted, never coerced into an invented project: a migration
 * that fabricates a document is worse than one that reports what it could
 * not read.
 */
export function migrateLegacyStudio(raw: unknown): {
  projects: CanonicalStudioProject[];
  skipped: number;
} {
  const projects: CanonicalStudioProject[] = [];
  let skipped = 0;
  const add = (value: unknown): void => {
    const artifact = asArtifact(value);
    if (artifact) {
      projects.push(fromCreationArtifact(artifact));
      return;
    }
    const software = asSoftwareProject(value);
    if (software) {
      projects.push(fromSoftwareProject(software));
      return;
    }
    skipped += 1;
  };

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) add(entry);
      return;
    }
    if (!isObject(value)) {
      if (value !== null && value !== undefined) skipped += 1;
      return;
    }
    if (Array.isArray(value.artifacts)) {
      for (const entry of value.artifacts) add(entry);
      return;
    }
    if (Array.isArray(value.projects)) {
      for (const entry of value.projects) add(entry);
      return;
    }
    if (isObject(value.projects)) {
      for (const entry of Object.values(value.projects)) add(entry);
      return;
    }
    add(value);
  };

  walk(raw);
  return { projects, skipped };
}

/* ------------------------------------------------------------------ */
/* one studio runs at a time                                           */
/* ------------------------------------------------------------------ */

/** How to bring the backup studio back, shown where it is reactivated. */
export const BACKUP_RESTORE_STEPS =
  "Set the active architecture to \"software\" through StudioArchitectureRegistry " +
  "(activate(BACKUP_STUDIO)), then load the library with StudioLibrary.list(). " +
  "Both studios read the same canonical projects, so nothing has to be re-imported; " +
  "a software project's measured history survives in CanonicalSoftware.";

/**
 * Which studio is running.
 *
 * Exactly one architecture may hold the registry. Activating a second one
 * while the first is active THROWS instead of silently running two stores —
 * the failure the whole model exists to prevent. `reset()` is how the backup
 * is activated after the primary is released (and how tests isolate).
 */
export class StudioArchitectureRegistry {
  private static instance: StudioArchitectureRegistry | null = null;
  private active: StudioArchitecture | null = null;

  static getInstance(): StudioArchitectureRegistry {
    if (!StudioArchitectureRegistry.instance) {
      StudioArchitectureRegistry.instance = new StudioArchitectureRegistry();
    }
    return StudioArchitectureRegistry.instance;
  }

  /** Start the primary studio if nothing is running. Idempotent. */
  ensurePrimary(): StudioArchitecture {
    if (this.active === null) this.active = PRIMARY_STUDIO;
    return this.active;
  }

  activate(architecture: StudioArchitecture): StudioArchitecture {
    if (this.active === architecture) return architecture;
    if (this.active !== null) {
      throw new Error(
        `The ${this.active} studio is already running. Release it before activating the ${architecture} studio: ` +
          "two live studios would mean two project stores and two initializations.",
      );
    }
    this.active = architecture;
    return architecture;
  }

  release(architecture: StudioArchitecture): void {
    if (this.active === architecture) this.active = null;
  }

  reset(): void {
    this.active = null;
  }

  current(): StudioArchitecture | null {
    return this.active;
  }

  isActive(architecture: StudioArchitecture): boolean {
    return this.active === architecture;
  }
}
