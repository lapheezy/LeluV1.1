/**
 * ==========================================================
 * LÉLU
 * GITHUB PROVIDER
 * ==========================================================
 */

import type Provider
  from "./Provider";

import type {
  KnowledgeResult,
} from "./Provider";

export default class GitHubProvider
  implements Provider {

  readonly name =
    "github";

  readonly category =
    "code";

  readonly priority =
    100;

  readonly enabled =
    true;

  readonly requiresApiKey =
    true;

  readonly timeout =
    15000;

  readonly cooldown =
    1000;

  readonly maxConcurrent =
    2;

  readonly capabilities = [

    "code",
    "repository",
    "repositories",
    "programming",
    "engineering",
    "typescript",
    "javascript",
    "python",
    "java",
    "c++",
    "rust",

  ] as const;

  canSearch(
    query: string,
  ): boolean {

    return query.trim().length > 0;

  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    // The token is NOT read here any more. This ran in the browser with
    // a VITE_GITHUB_TOKEN, which Vite compiled into the bundle. It now
    // goes through the SAME server-side proxy GitHubIntegration already
    // uses (plugins/githubApi.ts), so the token stays on the server —
    // no new route, no second GitHub client.
    const response =
      await fetch(

        "/api/github/proxy",

        {

          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            endpoint: `/search/repositories?q=${encodeURIComponent(
              query,
            )}&sort=stars&per_page=10`,
          }),

        },

      );

    if (!response.ok) {

      throw new Error(

        `GitHub ${response.status}`,

      );

    }

    // The proxy wraps the upstream reply as { ok, status, data } so a
    // GitHub-side failure is still reported honestly rather than being
    // flattened into a 200 with no results.
    const envelope =
      await response.json();

    if (!envelope.ok) {

      throw new Error(

        `GitHub ${envelope.status ?? ""}: ${
          envelope.error ?? "request failed"
        }`.trim(),

      );

    }

    const json = envelope.data ?? {};

    return (json.items ?? []).map(

      (repo: any): KnowledgeResult => ({

        id:
          String(repo.id),

        title:
          repo.full_name,

        content:
          repo.description ??
          "",

        url:
          repo.html_url,

        source:
          "GitHub",

        confidence:
          0.98,

        timestamp:
          repo.updated_at,

        metadata: {

          owner:
            repo.owner?.login,

          language:
            repo.language,

          stars:
            repo.stargazers_count,

          forks:
            repo.forks_count,

          issues:
            repo.open_issues_count,

          branch:
            repo.default_branch,

          license:
            repo.license?.name,

        },

      }),

    );

  }

}