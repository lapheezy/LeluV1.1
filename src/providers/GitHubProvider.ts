/**
 * ==========================================================
 * LÉLU
 * GITHUB PROVIDER
 * ==========================================================
 */

import config
  from "../core/ProviderConfig";

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

  private readonly endpoint =
    "https://api.github.com/search/repositories";

  canSearch(
    query: string,
  ): boolean {

    return query.trim().length > 0;

  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const token =
      config.githubToken;

    if (!token) {

      throw new Error(
        "GitHub token missing.",
      );

    }

    const response =
      await fetch(

        `${this.endpoint}?q=${encodeURIComponent(
          query,
        )}&sort=stars&per_page=10`,

        {

          headers: {

            Accept:
              "application/vnd.github+json",

            Authorization:
              `Bearer ${token}`,

          },

        },

      );

    if (!response.ok) {

      throw new Error(

        `GitHub ${response.status}`,

      );

    }

    const json =
      await response.json();

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