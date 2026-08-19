/**
 * ==========================================================
 * LÉLU
 * PROVIDER CONFIG
 * ==========================================================
 */

export interface ProviderConfig {

  githubToken: string;

  youtubeApiKey: string;

  newsApiKey: string;

  groqApiKey: string;

}

const env = (
  import.meta as ImportMeta & {
    env?: Record<
      string,
      string | undefined
    >;
  }
).env ?? {};

const config: ProviderConfig = {

  githubToken:

    env.VITE_GITHUB_TOKEN ??
    "",

  youtubeApiKey:

    env.VITE_YOUTUBE_API_KEY ??
    "",

  newsApiKey:

    env.VITE_NEWS_API_KEY ??
    "",

  groqApiKey:

    env.VITE_GROQ_API_KEY ??
    "",

};

export default config;

export function validateProviderConfig(): void {

  const missing: string[] = [];

  if (!config.githubToken) {

    missing.push(
      "VITE_GITHUB_TOKEN",
    );

  }

  if (!config.youtubeApiKey) {

    missing.push(
      "VITE_YOUTUBE_API_KEY",
    );

  }

  if (!config.newsApiKey) {

    missing.push(
      "VITE_NEWS_API_KEY",
    );

  }

  if (!config.groqApiKey) {

    missing.push(
      "VITE_GROQ_API_KEY",
    );

  }

  if (missing.length) {

    throw new Error(

      `Missing Provider Configuration:

${missing.join("\n")}`,

    );

  }

}