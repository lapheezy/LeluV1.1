/**
 * ==========================================================
 * LÉLU
 * GITHUB INTEGRATION — client-side module
 *
 * All GitHub API calls go through the server-side proxy
 * (/api/github/*) so the token NEVER reaches the browser
 * bundle. This module provides typed methods for every
 * GitHub operation LÉLU's cognition needs.
 *
 * Usage:
 *   const gh = GitHubIntegration.getInstance();
 *   const user = await gh.getAuthenticatedUser();
 *   const repos = await gh.listRepositories();
 *   const content = await gh.getFileContent("owner", "repo", "path");
 * ==========================================================
 */

import CapabilityManifest from "../capabilities/CapabilityManifest";
import AgentEventBus from "../agent/AgentEvents";

// ---------- TYPES ----------

export interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
  type: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
}

export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: string;
  type: string;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface GitHubCommit {
  sha: string;
  node_id: string;
  message: string;
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
}

export interface GitHubDiff {
  status: string;
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitHubProxyResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  headers?: {
    "x-ratelimit-remaining": string | null;
    "x-ratelimit-limit": string | null;
  };
}

// ---------- INTEGRATION ----------

export default class GitHubIntegration {
  private static instance: GitHubIntegration | null = null;
  private configured = false;
  private user: GitHubUser | null = null;


  private constructor() {}

  public static getInstance(): GitHubIntegration {
    if (!GitHubIntegration.instance) {
      GitHubIntegration.instance = new GitHubIntegration();
    }
    return GitHubIntegration.instance;
  }

  // ---------- CORE PROXY ----------

  private async proxy<T = unknown>(
    endpoint: string,
    method = "GET",
    body?: unknown,
  ): Promise<GitHubProxyResponse<T>> {
    try {
      const response = await fetch("/api/github/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, method, body }),
      });
      const result = (await response.json()) as GitHubProxyResponse<T>;
      return result;
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: null as T,
        headers: undefined,
      };
    }
  }

  // ---------- AUTH / STATUS ----------

  /** Check if GitHub is configured and return user info. */
  async getStatus(): Promise<{ configured: boolean; user?: GitHubUser; error?: string }> {
    try {
      const response = await fetch("/api/github/status");
      const result = (await response.json()) as {
        configured: boolean;
        user?: GitHubUser;
        error?: string;
      };
      this.configured = result.configured;
      if (result.user) {
        this.user = result.user;
      }

      return result;
    } catch (error) {
      return {
        configured: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Get the authenticated user. Caches the result. */
  async getAuthenticatedUser(): Promise<GitHubUser | null> {
    if (this.user) return this.user;
    const status = await this.getStatus();
    return status.user ?? null;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  // ---------- REPOSITORIES ----------

  /** List repositories the authenticated user can access. */
  async listRepositories(options?: {
    visibility?: "public" | "private" | "all";
    sort?: "created" | "updated" | "pushed" | "full_name";
    per_page?: number;
    page?: number;
  }): Promise<GitHubRepo[]> {
    const params = new URLSearchParams();
    if (options?.visibility) params.set("visibility", options.visibility);
    if (options?.sort) params.set("sort", options.sort);
    if (options?.per_page) params.set("per_page", String(options.per_page));
    if (options?.page) params.set("page", String(options.page));
    const qs = params.toString();
    const endpoint = `/user/repos${qs ? `?${qs}` : ""}`;
    const result = await this.proxy<GitHubRepo[]>(endpoint);
    if (result.ok && Array.isArray(result.data)) {
      return result.data;
    }
    return [];
  }

  /** Get a specific repository. */
  async getRepository(owner: string, repo: string): Promise<GitHubRepo | null> {
    const result = await this.proxy<GitHubRepo>(`/repos/${owner}/${repo}`);
    return result.ok ? result.data : null;
  }

  // ---------- FILES / CONTENTS ----------

  /** Get the content of a file (or directory listing) at a ref. */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHubFileContent | null> {
    const endpoint = `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`;
    const result = await this.proxy<GitHubFileContent>(endpoint);
    if (result.ok && result.data && typeof result.data === "object" && "content" in (result.data as unknown as Record<string, unknown>)) {
      return result.data;
    }
    return null;
  }

  /** List files in a directory. */
  async listDirectory(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<Array<{ name: string; path: string; type: string; sha: string }>> {
    const endpoint = `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`;
    const result = await this.proxy<Array<{ name: string; path: string; type: string; sha: string }>>(endpoint);
    if (result.ok && Array.isArray(result.data)) {
      return result.data;
    }
    return [];
  }

  // ---------- BRANCHES ----------

  /** List branches in a repository. */
  async listBranches(
    owner: string,
    repo: string,
    per_page = 30,
  ): Promise<GitHubBranch[]> {
    const endpoint = `/repos/${owner}/${repo}/branches?per_page=${per_page}`;
    const result = await this.proxy<GitHubBranch[]>(endpoint);
    return result.ok && Array.isArray(result.data) ? result.data : [];
  }

  /** Create a new branch (refs). */
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    fromSha: string,
  ): Promise<GitHubBranch | null> {
    const result = await this.proxy<GitHubBranch>(
      `/repos/${owner}/${repo}/git/refs`,
      "POST",
      {
        ref: `refs/heads/${branchName}`,
        sha: fromSha,
      },
    );
    return result.ok ? result.data : null;
  }

  // ---------- COMMITS ----------

  /** List recent commits on a branch. */
  async listCommits(
    owner: string,
    repo: string,
    branch = "main",
    per_page = 10,
  ): Promise<GitHubCommit[]> {
    const endpoint = `/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${per_page}`;
    const result = await this.proxy<GitHubCommit[]>(endpoint);
    return result.ok && Array.isArray(result.data) ? result.data : [];
  }

  /** Create a commit (via the git commits API). */
  async createCommit(
    owner: string,
    repo: string,
    message: string,
    tree: string,
    parents: string[],
  ): Promise<GitHubCommit | null> {
    const result = await this.proxy<GitHubCommit>(
      `/repos/${owner}/${repo}/git/commits`,
      "POST",
      { message, tree, parents },
    );
    return result.ok ? result.data : null;
  }

  /** Update a branch reference to point to a new commit. */
  async updateBranchRef(
    owner: string,
    repo: string,
    branchName: string,
    newSha: string,
  ): Promise<boolean> {
    const result = await this.proxy(
      `/repos/${owner}/${repo}/git/refs/heads/${branchName}`,
      "PATCH",
      { sha: newSha, force: false },
    );
    return result.ok;
  }

  // ---------- DIFFS / COMPARISON ----------

  /** Compare two commits/branches. */
  async compare(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<{ status: string; files: GitHubDiff[]; ahead_by: number; behind_by: number } | null> {
    const result = await this.proxy<{
      status: string;
      files: GitHubDiff[];
      ahead_by: number;
      behind_by: number;
    }>(`/repos/${owner}/${repo}/compare/${base}...${head}`);
    return result.ok ? result.data : null;
  }

  // ---------- PULL REQUESTS ----------

  /** List pull requests. */
  async listPullRequests(
    owner: string,
    repo: string,
    state: "open" | "closed" | "all" = "open",
  ): Promise<GitHubPullRequest[]> {
    const endpoint = `/repos/${owner}/${repo}/pulls?state=${state}`;
    const result = await this.proxy<GitHubPullRequest[]>(endpoint);
    return result.ok && Array.isArray(result.data) ? result.data : [];
  }

  /** Create a pull request. */
  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string,
  ): Promise<GitHubPullRequest | null> {
    const result = await this.proxy<GitHubPullRequest>(
      `/repos/${owner}/${repo}/pulls`,
      "POST",
      { title, head, base, body: body ?? "" },
    );
    return result.ok ? result.data : null;
  }

  // ---------- CAPABILITY REGISTRATION ----------

  /** Register GitHub capabilities in the manifest. */
  registerCapabilities(): void {
    const manifest = CapabilityManifest.getInstance();
    manifest.register({
      id: "github-auth",
      name: "GitHub Authentication",
      category: "tools",
      description: "Authenticate with GitHub and access authorized account",
      status: "not_configured",
      providers: ["github"],
      lastSuccessful: null,
      lastChecked: Date.now(),
    });
    manifest.register({
      id: "github-repos",
      name: "GitHub Repositories",
      category: "tools",
      description: "List and access GitHub repositories",
      status: "not_configured",
      providers: ["github"],
      lastSuccessful: null,
      lastChecked: Date.now(),
    });
    manifest.register({
      id: "github-files",
      name: "GitHub File Access",
      category: "tools",
      description: "Read and write files in GitHub repositories",
      status: "not_configured",
      providers: ["github"],
      lastSuccessful: null,
      lastChecked: Date.now(),
    });
    manifest.register({
      id: "github-branches",
      name: "GitHub Branches",
      category: "tools",
      description: "Create and manage branches in GitHub repositories",
      status: "not_configured",
      providers: ["github"],
      lastSuccessful: null,
      lastChecked: Date.now(),
    });
    manifest.register({
      id: "github-commits",
      name: "GitHub Commits",
      category: "tools",
      description: "Create commits and manage commit history",
      status: "not_configured",
      providers: ["github"],
      lastSuccessful: null,
      lastChecked: Date.now(),
    });
    manifest.register({
      id: "github-prs",
      name: "GitHub Pull Requests",
      category: "tools",
      description: "Create and manage pull requests",
      status: "not_configured",
      providers: ["github"],
      lastSuccessful: null,
      lastChecked: Date.now(),
    });
  }

  /** Probe GitHub and update capability statuses. */
  async probeAndUpdateCapabilities(): Promise<void> {
    const status = await this.getStatus();
    const manifest = CapabilityManifest.getInstance();
    const available = status.configured;
    manifest.updateStatus("github-auth", available ? "available" : "not_configured", status.error);
    manifest.updateStatus("github-repos", available ? "available" : "not_configured");
    manifest.updateStatus("github-files", available ? "available" : "not_configured");
    manifest.updateStatus("github-branches", available ? "available" : "not_configured");
    manifest.updateStatus("github-commits", available ? "available" : "not_configured");
    manifest.updateStatus("github-prs", available ? "available" : "not_configured");

    // Emit event so cognition knows about GitHub capability
    if (available) {
      AgentEventBus.getInstance().emit({
        type: "tool_result",
        taskId: "github-probe",
        tool: "github-auth",
        result: `GitHub authenticated as ${status.user?.login ?? "unknown"}`,
      });
    }
  }
}
