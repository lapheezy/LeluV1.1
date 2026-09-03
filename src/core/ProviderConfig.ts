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

import environment, {
  getEnvironment,
  validateProviderConfig as validateAll,
} from "./Environment";

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

// Values come from Environment's resolver, NOT straight off
// import.meta.env. Reading import.meta.env here meant a key supplied
// under an unprefixed platform name (GROQ_API_KEY rather than
// VITE_GROQ_API_KEY) produced `hasKey: true` from getEnvironment() and
// an EMPTY STRING here — so callers of this config saw no credential
// for a provider the runtime considered configured.
const env = getEnvironment();

const config: ProviderConfig = {
  githubToken:   env.githubModels.hasKey ? environment.githubToken : "",
  youtubeApiKey: env.youtube.hasKey      ? environment.youtubeApiKey : "",
  newsApiKey:    env.news.hasKey         ? environment.newsApiKey : "",
  groqApiKey:    env.groq.hasKey         ? environment.groqApiKey : "",
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