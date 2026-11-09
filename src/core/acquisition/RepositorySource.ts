/**
 * ==========================================================
 * LÉLU — REPOSITORY SOURCES (extensible connectors)
 *
 * One interface for any place a repository can come from.
 * GitHub is the first connector; adding GitLab, Codeberg, a
 * package registry or an internal mirror means implementing
 * this interface and registering it — no changes to the
 * Executive, the Executor or the pipeline.
 * ==========================================================
 */

import type {
  RepositoryCandidate,
  RepositoryCommitSummary,
  RepositoryFileEntry,
} from "./AcquisitionTypes";

export interface RepositorySearchQuery {
  keywords: string;
  language?: string;
  minStars?: number;
  limit?: number;
}

export interface RepositorySource {
  /** Stable id, e.g. "github". */
  id: string;
  label: string;
  /** Can this source resolve a repository URL/host? */
  supports(host: string): boolean;
  search(query: RepositorySearchQuery): Promise<RepositoryCandidate[]>;
  metadata(identifier: string): Promise<RepositoryCandidate>;
  branches(identifier: string): Promise<string[]>;
  commits(identifier: string, ref?: string, limit?: number): Promise<RepositoryCommitSummary[]>;
  tree(identifier: string, ref?: string): Promise<RepositoryFileEntry[]>;
  file(identifier: string, filePath: string, ref?: string): Promise<string>;
  license(identifier: string): Promise<{ spdx: string; name: string; url: string; excerpt: string }>;
}

/** Thrown when a source is asked for something it cannot do, or its API refuses. */
export class RepositorySourceError extends Error {
  readonly sourceId: string;
  readonly status: number;
  constructor(sourceId: string, message: string, status = 0) {
    super(message);
    this.name = "RepositorySourceError";
    this.sourceId = sourceId;
    this.status = status;
  }
}

export default class RepositorySourceRegistry {
  private static instance: RepositorySourceRegistry | null = null;
  private sources = new Map<string, RepositorySource>();

  static getInstance(): RepositorySourceRegistry {
    if (!RepositorySourceRegistry.instance) {
      RepositorySourceRegistry.instance = new RepositorySourceRegistry();
    }
    return RepositorySourceRegistry.instance;
  }

  /** Test-only: drop the singleton so each test starts empty. */
  static resetForTests(): void {
    RepositorySourceRegistry.instance = null;
  }

  register(source: RepositorySource): void {
    this.sources.set(source.id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  get(id: string): RepositorySource | undefined {
    return this.sources.get(id);
  }

  list(): RepositorySource[] {
    return [...this.sources.values()];
  }

  /** The connector that handles a clone URL / host, if any. */
  forUrl(rawUrl: string): RepositorySource | undefined {
    let host = "";
    try {
      host = new URL(rawUrl).hostname.toLowerCase();
    } catch {
      return undefined;
    }
    return this.list().find((source) => source.supports(host));
  }

  /**
   * Search every registered source and merge the results.
   *
   * A source that fails is reported, not silently dropped: the caller
   * receives `errors` alongside whatever the other sources returned.
   */
  async searchAll(
    query: RepositorySearchQuery,
  ): Promise<{ candidates: RepositoryCandidate[]; errors: Array<{ sourceId: string; error: string }> }> {
    const candidates: RepositoryCandidate[] = [];
    const errors: Array<{ sourceId: string; error: string }> = [];
    for (const source of this.list()) {
      try {
        candidates.push(...(await source.search(query)));
      } catch (error) {
        errors.push({ sourceId: source.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { candidates, errors };
  }
}
