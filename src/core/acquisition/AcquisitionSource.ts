/**
 * ==========================================================
 * LÉLU — ACQUISITION-BACKED REPOSITORY SOURCE
 *
 * A connector whose registry is one isolated acquisition.
 *
 * Why it exists: repository research normally reads the GitHub
 * API. When that API is rate-limited or unauthenticated, the
 * Executive must not invent metadata and must not stop the whole
 * workforce. A clone is still possible over git, so research can
 * be grounded in the real tree, the real LICENSE file, the real
 * package manifest and the real commit log of the acquisition.
 *
 * Everything it returns is read from the acquisition workspace.
 * Fields the clone cannot supply (stars, open issues, archived
 * flag) are returned as 0/false and the caller records that as
 * missing evidence, never as a measured value.
 * ==========================================================
 */

import type { AcquisitionRecord, RepositoryCandidate, RepositoryCommitSummary, RepositoryFileEntry } from "./AcquisitionTypes";
import AcquisitionRuntime from "./AcquisitionRuntime";
import { RepositorySourceError, type RepositorySearchQuery, type RepositorySource } from "./RepositorySource";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  rb: "Ruby",
};

interface DeclaredManifest {
  description?: string;
  license?: string | { type?: string };
  module?: string;
  main?: string;
  type?: string;
}

export default class AcquisitionSource implements RepositorySource {
  readonly id = "acquisition";
  readonly label: string;
  private readonly runtime = AcquisitionRuntime.getInstance();
  private treeCache: RepositoryFileEntry[] | null = null;

  constructor(private readonly acquisition: AcquisitionRecord) {
    this.label = `Acquired ${acquisition.source.identifier}`;
  }

  get record(): AcquisitionRecord {
    return this.acquisition;
  }

  /** A local workspace resolves no remote host: it is not a discovery source. */
  supports(): boolean {
    return false;
  }

  async search(_query: RepositorySearchQuery): Promise<RepositoryCandidate[]> {
    throw new RepositorySourceError(
      this.id,
      "An isolated acquisition holds exactly one repository and cannot search a registry. " +
        "Discovery needs a network connector; this source grounds research after a clone.",
    );
  }

  /** Build a candidate from real reads of the acquired workspace. */
  async metadata(identifier = this.acquisition.source.identifier): Promise<RepositoryCandidate> {
    const tree = await this.tree();
    const paths = tree.map((entry) => entry.path);

    let manifest: DeclaredManifest = {};
    if (paths.includes("package.json")) {
      try {
        manifest = JSON.parse(await this.file(identifier, "package.json")) as DeclaredManifest;
      } catch {
        /* an unparsable manifest is reported by the Executive, which reads it again */
      }
    }

    const readmePath = paths.find((path) => /^readme(\.md|\.txt|\.rst)?$/i.test(path));
    const readme = readmePath ? await this.file(identifier, readmePath).catch(() => "") : "";
    const description =
      manifest.description ||
      readme
        .split("\n")
        .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
        .find((line) => line.length > 40 && !line.startsWith("!"))?.slice(0, 300) ||
      "";

    const counts = new Map<string, number>();
    for (const path of paths) {
      const extension = path.split(".").pop()?.toLowerCase() ?? "";
      const language = LANGUAGE_BY_EXTENSION[extension];
      if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
    }
    const language = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

    const commits = await this.commits(identifier, undefined, 1).catch(() => []);
    const updatedAt = commits[0]?.date || new Date(this.acquisition.createdAt).toISOString();

    return {
      id: this.acquisition.id,
      source: "github",
      identifier,
      url: this.acquisition.source.url,
      description,
      // A clone carries no registry counts. Zero means "not available",
      // and the Executive records that in its observations.
      stars: 0,
      forks: 0,
      language,
      topics: [],
      license: this.acquisition.license.spdx,
      defaultBranch: this.acquisition.ref || "HEAD",
      updatedAt,
      archived: false,
      openIssues: 0,
    };
  }

  async branches(): Promise<string[]> {
    const result = await this.runtime.git<{ branches?: string[]; output?: string }>(this.acquisition.id, "status");
    if (!result.ok) return [];
    const branches = result.branches ?? [];
    return Array.isArray(branches) ? branches : [];
  }

  async commits(_identifier?: string, _ref?: string, limit = 30): Promise<RepositoryCommitSummary[]> {
    const result = await this.runtime.log(this.acquisition.id, limit);
    if (!result.ok) {
      throw new RepositorySourceError(this.id, result.error);
    }
    return result.commits.filter((commit) => commit.sha);
  }

  async tree(): Promise<RepositoryFileEntry[]> {
    if (this.treeCache) return this.treeCache;
    const result = await this.runtime.tree(this.acquisition.id, ".");
    if (!result.ok) throw new RepositorySourceError(this.id, result.error);
    this.treeCache = result.entries;
    return result.entries;
  }

  async file(_identifier: string, filePath: string): Promise<string> {
    const result = await this.runtime.read(this.acquisition.id, filePath);
    if (!result.ok) throw new RepositorySourceError(this.id, result.error);
    return result.content;
  }

  async license(): Promise<{ spdx: string; name: string; url: string; excerpt: string }> {
    const license = this.acquisition.license;
    return {
      spdx: license.spdx,
      name: license.name,
      url: license.path ? this.acquisition.source.url : "",
      excerpt: license.excerpt,
    };
  }
}
