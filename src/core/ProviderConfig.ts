/**
 * ==========================================================
 * LÉLU
 * PROVIDER CONFIG (backward-compat wrapper)
 *
 * Now delegates to the centralized Environment.ts.
 * Existing callers (provider constructors, validation)
 * continue to work unchanged.
 * ==========================================================
 */

import { getEnvironment, validateProviderConfig as validateAll } from "./Environment";

export interface ProviderConfig {
  githubToken: string;
  youtubeApiKey: string;
  newsApiKey: string;
  groqApiKey: string;
  elpheruRssUrl: string;
  sapiolingoRssUrl: string;
  googleNewsRssUrl: string;
  googleNewsRssUrl2: string;
  rssFeeds: string[];
}

const rawEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const env = getEnvironment();

const config: ProviderConfig = {
  githubToken:   env.githubModels.hasKey ? (rawEnv["VITE_GITHUB_TOKEN"] ?? "") : "",
  youtubeApiKey: env.youtube.hasKey      ? (rawEnv["VITE_YOUTUBE_API_KEY"] ?? "") : "",
  newsApiKey:    env.news.hasKey         ? (rawEnv["VITE_NEWS_API_KEY"] ?? "") : "",
  groqApiKey:    env.groq.hasKey         ? (rawEnv["VITE_GROQ_API_KEY"] ?? "") : "",
  elpheruRssUrl: env.elpheruRssUrl,
  sapiolingoRssUrl: env.sapiolingoRssUrl,
  googleNewsRssUrl: env.googleNewsRssUrl,
  googleNewsRssUrl2: env.googleNewsRssUrl2,
  rssFeeds: env.rssFeeds,
};

export default config;

export function validateProviderConfig(): void {
  validateAll();
}