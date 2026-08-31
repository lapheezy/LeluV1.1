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
import { publicEnv } from "./env/publicEnv";

export interface ProviderConfig {
  githubToken: string;
  youtubeApiKey: string;
  newsApiKey: string;
  elpheruRssUrl: string;
  sapiolingoRssUrl: string;
  googleNewsRssUrl: string;
  googleNewsRssUrl2: string;
  rssFeeds: string[];
}

// Browser-safe allowlist, not the whole env record — see env/publicEnv.ts.
const rawEnv = publicEnv();
const env = getEnvironment();

const config: ProviderConfig = {
  githubToken:   env.githubModels.hasKey ? (rawEnv["VITE_GITHUB_TOKEN"] ?? "") : "",
  youtubeApiKey: env.youtube.hasKey      ? (rawEnv["VITE_YOUTUBE_API_KEY"] ?? "") : "",
  newsApiKey:    env.news.hasKey         ? (rawEnv["VITE_NEWS_API_KEY"] ?? "") : "",
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