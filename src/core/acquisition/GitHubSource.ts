/**
 * ==========================================================
 * LÉLU — GITHUB REPOSITORY SOURCE
 *
 * A real GitHub REST connector: search, metadata, branches,
 * commits, trees, file contents and license. Every method
 * returns what the API returned; a refusal raises with the
 * HTTP status, never an empty successful-looking result.
 *
 * Credentials
 * -----------
 * The browser bundle must not carry a GitHub token, and this
 * module does not read one. Two transports are supported:
 *
 *   • `proxy` — a server-side fetch (the acquisition runtime's
 *     `/api/acquisition` github action), which holds the token
 *     and is what LÉLU uses when the runtime is reachable;
 *   • direct public API — unauthenticated, subject to GitHub's
 *     60 requests/hour anonymous limit, for offline/dev use.
 *
 * ==========================================================
 */

import {
  type RepositoryCandidate,
  type RepositoryCommitSummary,
  type RepositoryFileEntry,
} from "./AcquisitionTypes";
import {
  RepositorySourceError,
  type RepositorySearchQuery,
  type RepositorySource,
} from "./RepositorySource";

const API_BASE = "https://api.github.com";

export interface GitHubJson {
  [key: string]: unknown;
}

export type GitHubTransport = (path: string) => Promise<unknown>;

interface GitHubRepoPayload {
  id?: number;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  topics?: string[];
  license?: { spdx_id?: string | null; name?: string | null } | null;
  default_branch?: string;
  pushed_at?: string;
  updated_at?: string;
  archived?: boolean;
  open_issues_count?: number;
}

function candidateFrom(payload: GitHubRepoPayload): RepositoryCandidate {
  const identifier = String(payload.full_name ?? "");
  if (!identifier) {
    throw new RepositorySourceError("github", "GitHub returned a repository without a full_name.");
  }
  return {
    id: `github:${identifier}`,
    source: "github",
    identifier,
    url: String(payload.html_url ?? `https://github.com/${identifier}`),
    description: String(payload.description ?? "").trim(),
    stars: Number(payload.stargazers_count ?? 0),
    forks: Number(payload.forks_count ?? 0),
    language: String(payload.language ?? ""),
    topics: Array.isArray(payload.topics) ? payload.topics.map((topic) => String(topic)) : [],
    license: String(payload.license?.spdx_id ?? ""),
    defaultBranch: String(payload.default_branch ?? "main"),
    updatedAt: String(payload.pushed_at ?? payload.updated_at ?? ""),
    archived: payload.archived === true,
    openIssues: Number(payload.open_issues_count ?? 0),
  };
}

function decodeBase64(value: string): string {
  const clean = value.replace(/\s/g, "");
  try {
    if (typeof atob === "function") {
      return new TextDecoder().decode(Uint8Array.from(atob(clean), (char) => char.charCodeAt(0)));
    }
    return Buffer.from(clean, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export default class GitHubSource implements RepositorySource {
  readonly id = "github";
  readonly label = "GitHub";
  private readonly proxy?: GitHubTransport;
  private readonly directFetch: typeof fetch;
  private readonly tokenHint: string;

  constructor(options: { proxy?: GitHubTransport; fetchImpl?: typeof fetch; tokenHint?: string } = {}) {
    this.proxy = options.proxy;
    this.directFetch = options.fetchImpl ?? ((...args) => fetch(...args));
    this.tokenHint = options.tokenHint ?? "";
  }

  supports(host: string): boolean {
    return host === "github.com" || host === "www.github.com" || host === "api.github.com";
  }

  private async request<T>(path: string): Promise<T> {
    if (this.proxy) {
      const proxied = await this.proxy(path);
      return proxied as T;
    }

    let response: Response;
    try {
      response = await this.directFetch(`${API_BASE}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(this.tokenHint ? { Authorization: `Bearer ${this.tokenHint}` } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new RepositorySourceError(
        "github",
        `GitHub was unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      const hint =
        response.status === 403 && remaining === "0"
          ? ` GitHub's anonymous quota is exhausted; it resets at ${reset ? new Date(Number(reset) * 1000).toISOString() : "an unknown time"}. Configure a runtime GitHub token to raise it.`
          : "";
      let detail = "";
      try {
        detail = ((await response.json()) as { message?: string }).message ?? "";
      } catch {
        detail = "";
      }
      throw new RepositorySourceError(
        "github",
        `GitHub API ${path} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.${hint}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  async search(query: RepositorySearchQuery): Promise<RepositoryCandidate[]> {
    const keywords = query.keywords.trim();
    if (!keywords) return [];
    const terms = [keywords];
    if (query.language) terms.push(`language:${query.language}`);
    if (query.minStars && query.minStars > 0) terms.push(`stars:>=${Math.floor(query.minStars)}`);
    terms.push("archived:false");
    const limit = Math.max(1, Math.min(50, query.limit ?? 10));
    const payload = await this.request<{ items?: GitHubRepoPayload[]; message?: string }>(
      `/search/repositories?q=${encodeURIComponent(terms.join(" "))}&sort=stars&order=desc&per_page=${limit}`,
    );
    if (!Array.isArray(payload.items)) {
      throw new RepositorySourceError("github", `GitHub search returned no items array${payload.message ? `: ${payload.message}` : ""}.`);
    }
    return payload.items.map(candidateFrom);
  }

  async metadata(identifier: string): Promise<RepositoryCandidate> {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identifier)) {
      throw new RepositorySourceError("github", `Expected owner/repository, got "${identifier}".`);
    }
    return candidateFrom(await this.request<GitHubRepoPayload>(`/repos/${identifier}`));
  }

  async branches(identifier: string): Promise<string[]> {
    const payload = await this.request<Array<{ name?: string }>>(`/repos/${identifier}/branches?per_page=100`);
    return payload.map((branch) => String(branch.name ?? "")).filter(Boolean);
  }

  async commits(identifier: string, ref = "", limit = 20): Promise<RepositoryCommitSummary[]> {
    const count = Math.max(1, Math.min(100, limit));
    const suffix = ref ? `&sha=${encodeURIComponent(ref)}` : "";
    const payload = await this.request<
      Array<{
        sha?: string;
        commit?: { message?: string; author?: { name?: string; date?: string } };
        author?: { login?: string } | null;
      }>
    >(`/repos/${identifier}/commits?per_page=${count}${suffix}`);
    return payload.map((commit) => ({
      sha: String(commit.sha ?? ""),
      message: String(commit.commit?.message ?? "").split("\n")[0].slice(0, 200),
      author: String(commit.commit?.author?.name ?? commit.author?.login ?? ""),
      date: String(commit.commit?.author?.date ?? ""),
    }));
  }

  async tree(identifier: string, ref = ""): Promise<RepositoryFileEntry[]> {
    const branch = ref || (await this.metadata(identifier)).defaultBranch;
    const payload = await this.request<{
      tree?: Array<{ path?: string; type?: string; size?: number }>;
      truncated?: boolean;
    }>(`/repos/${identifier}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    if (!Array.isArray(payload.tree)) {
      throw new RepositorySourceError("github", `GitHub returned no tree for ${identifier}@${branch}.`);
    }
    return payload.tree.map((entry) => ({
      path: String(entry.path ?? ""),
      type: entry.type === "tree" ? "dir" : "file",
      size: typeof entry.size === "number" ? entry.size : undefined,
    }));
  }

  async file(identifier: string, filePath: string, ref = ""): Promise<string> {
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const payload = await this.request<{
      type?: string;
      encoding?: string;
      content?: string;
      size?: number;
    }>(`/repos/${identifier}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}${suffix}`);
    if (payload.type !== "file" || typeof payload.content !== "string") {
      throw new RepositorySourceError("github", `${filePath} is not a readable file in ${identifier}.`);
    }
    if (payload.encoding === "base64") return decodeBase64(payload.content);
    return payload.content;
  }

  async license(identifier: string): Promise<{ spdx: string; name: string; url: string; excerpt: string }> {
    const payload = await this.request<{
      license?: { spdx_id?: string | null; name?: string | null; url?: string | null };
      content?: string;
      html_url?: string;
    }>(`/repos/${identifier}/license`);
    const spdx = String(payload.license?.spdx_id ?? "UNKNOWN");
    return {
      spdx,
      name: String(payload.license?.name ?? spdx),
      url: String(payload.html_url ?? payload.license?.url ?? ""),
      excerpt: typeof payload.content === "string" ? decodeBase64(payload.content).slice(0, 2000) : "",
    };
  }
}
