/**
 * ==========================================================
 * LÉLU — EXTERNAL SOURCE CATALOG
 *
 * The machine-readable inventory of every external repository,
 * API, protocol and dataset LÉLU has evaluated: what it offers,
 * what it costs, what it needs, whether LÉLU already has it, and
 * what was decided.
 *
 * It DESCRIBES sources; it does not call them. Execution stays
 * with the existing knowledge providers (src/providers/*) chosen
 * by ResearchResolver, so this is not a second runtime. `provider`
 * links an entry to the knowledge provider that executes it, which
 * is how the registry reports an entry as live rather than
 * catalogued.
 *
 * Rules kept here:
 *   • "free" means free to call within a stated limit, not
 *     "the documentation is public". Unknown limits say "unknown".
 *   • `verified` records only what was actually observed, with
 *     the date. "not-probed" means it was not tested.
 *   • No credential values, only the NAMES of the variables.
 * ==========================================================
 */

export type SourceKind = "api" | "repository" | "protocol" | "dataset" | "service" | "tool";
export type SourceAccess = "free" | "freemium" | "paid" | "self-hosted" | "free-with-key";
export type SourceAuth = "none" | "api-key" | "oauth" | "token" | "varies";
export type SourceDecision = "integrated" | "integrate" | "adapt" | "reference" | "defer" | "reject";

export interface SourceVerification {
  /** ISO date of the observation. */
  at: string;
  status: "reachable" | "unreachable" | "changed" | "degraded" | "not-probed";
  note?: string;
}

export interface CatalogSource {
  id: string;
  name: string;
  url: string;
  category: string;
  kind: SourceKind;
  capabilities: string[];
  access: SourceAccess;
  auth: SourceAuth;
  /** Environment variable NAMES (never values). */
  envVars?: string[];
  limits: string;
  license: string;
  /** Browser-callable without a relay (CORS observed or documented). */
  cors: boolean | "unknown";
  /** Knowledge-provider `name` that executes this source, when one exists. */
  provider?: string;
  decision: SourceDecision;
  reason: string;
  verified: SourceVerification;
}

const PROBED = "2026-11-06";
const ok = (note?: string): SourceVerification => ({ at: PROBED, status: "reachable", note });
const notProbed: SourceVerification = { at: PROBED, status: "not-probed" };

export const SOURCE_CATALOG: readonly CatalogSource[] = [
  /* ---------- A. API catalogs and free-service discovery ---------- */
  {
    id: "public-apis", name: "Public APIs", url: "https://github.com/public-apis/public-apis",
    category: "discovery", kind: "repository", capabilities: ["api-discovery"],
    access: "free", auth: "none", limits: "GitHub raw content; fetched at most once per 24 h by LÉLU",
    license: "MIT", cors: true, decision: "integrated",
    reason: "Largest curated list (~1,400 APIs) with auth/HTTPS/CORS columns; parsed as the discovery feed (plugins/sourceCatalogApi.ts).",
    verified: ok("README 346 KB, HTTP 200, ACAO *"),
  },
  {
    id: "free-for-dev", name: "Free for Dev", url: "https://github.com/ripienaar/free-for-dev",
    category: "discovery", kind: "repository", capabilities: ["service-discovery"],
    access: "free", auth: "none", limits: "n/a", license: "CC0-1.0", cors: "unknown", decision: "reference",
    reason: "Free tiers of infrastructure (hosting, DB, monitoring), not data APIs; prose format, not machine-parseable. Used as a human reference for free-tier limits.",
    verified: notProbed,
  },
  {
    id: "openapi-directory", name: "OpenAPI Directory (APIs.guru)", url: "https://github.com/APIs-guru/openapi-directory",
    category: "discovery", kind: "repository", capabilities: ["api-discovery", "openapi-specs"],
    access: "free", auth: "none", limits: "list.json is 8.9 MB, over safeFetch's 2 MB cap", license: "CC0-1.0",
    cors: true, decision: "defer",
    reason: "Machine-readable specs are valuable for adapter generation, but the index exceeds the server fetch cap; needs a streamed or pre-filtered ingest. Deferred to a later phase.",
    verified: ok("api.apis.guru/v2/list.json 8.86 MB, HTTP 200"),
  },
  {
    id: "public-api-lists", name: "Public API Lists", url: "https://github.com/public-api-lists/public-api-lists",
    category: "discovery", kind: "repository", capabilities: ["api-discovery"],
    access: "free", auth: "none", limits: "n/a", license: "MIT", cors: "unknown", decision: "reference",
    reason: "A fork-lineage of public-apis with heavy overlap; adds little over the primary list. Kept as a comparison reference.",
    verified: notProbed,
  },

  /* ---------- B. Search ---------- */
  {
    id: "searxng", name: "SearXNG", url: "https://github.com/searxng/searxng",
    category: "search", kind: "service", capabilities: ["web-search", "metasearch"],
    access: "self-hosted", auth: "none", envVars: ["SEARXNG_URL"], limits: "Public instances rate-limit and often disable JSON; self-hosting needed",
    license: "AGPL-3.0", cors: false, decision: "defer",
    reason: "Best route to provider-independent web search, but needs a self-hosted instance (Docker) LÉLU does not run yet. AGPL applies to the service, not to LÉLU calling it.",
    verified: notProbed,
  },
  {
    id: "brave-search", name: "Brave Search API", url: "https://brave.com/search/api/",
    category: "search", kind: "api", capabilities: ["web-search", "news"],
    access: "freemium", auth: "api-key", envVars: ["BRAVE_SEARCH_API_KEY"], limits: "Free tier with monthly query cap; card required at signup",
    license: "Commercial ToS", cors: false, decision: "defer",
    reason: "High-quality web index; needs a key and a server relay. Deferred until the user configures a key.",
    verified: notProbed,
  },

  /* ---------- C. Interop and integration infrastructure ---------- */
  {
    id: "mcp", name: "Model Context Protocol", url: "https://github.com/modelcontextprotocol",
    category: "interop", kind: "protocol", capabilities: ["tool-interop"],
    access: "free", auth: "varies", limits: "n/a", license: "MIT", cors: "unknown", decision: "defer",
    reason: "Useful for exposing LÉLU tools externally; consuming MCP servers would need a server-side client bound to ToolRegistry permissions. No current need justifies a second tool path.",
    verified: notProbed,
  },
  {
    id: "openapi-generator", name: "OpenAPI Generator", url: "https://github.com/OpenAPITools/openapi-generator",
    category: "interop", kind: "tool", capabilities: ["client-generation"],
    access: "free", auth: "none", limits: "n/a", license: "Apache-2.0", cors: "unknown", decision: "reject",
    reason: "Java toolchain; generated clients are heavier than the ~60-line hand adapters LÉLU uses and would bypass its validation conventions. Revisit only with the OpenAPI ingest.",
    verified: notProbed,
  },
  {
    id: "crawl4ai", name: "Crawl4AI", url: "https://github.com/unclecode/crawl4ai",
    category: "extraction", kind: "tool", capabilities: ["crawl", "markdown-extraction"],
    access: "self-hosted", auth: "none", limits: "Python + headless browser; heavy", license: "Apache-2.0",
    cors: false, decision: "defer",
    reason: "LÉLU already reads pages via browseApi + safeFetch; Crawl4AI would add a Python service and a browser. Value is in multi-page crawls, not needed yet.",
    verified: notProbed,
  },
  {
    id: "playwright", name: "Playwright", url: "https://github.com/microsoft/playwright",
    category: "extraction", kind: "tool", capabilities: ["browser-automation", "screenshots"],
    access: "free", auth: "none", limits: "n/a", license: "Apache-2.0", cors: false, decision: "integrated",
    reason: "Already used by LÉLU's browser.capture tool (plugins/selfViewApi.ts) and verification scripts; reused, not duplicated.",
    verified: ok("pre-installed Chromium used for this report's screenshots"),
  },
  {
    id: "firecrawl", name: "Firecrawl", url: "https://github.com/firecrawl/firecrawl",
    category: "extraction", kind: "service", capabilities: ["crawl", "markdown-extraction"],
    access: "freemium", auth: "api-key", envVars: ["FIRECRAWL_API_KEY"], limits: "Hosted free credits; self-host needs Redis + workers",
    license: "AGPL-3.0", cors: false, decision: "defer", reason: "Same niche as Crawl4AI; overlaps browseApi. Deferred.",
    verified: notProbed,
  },

  /* ---------- Knowledge and reference ---------- */
  {
    id: "wikipedia", name: "Wikipedia (MediaWiki API)", url: "https://www.mediawiki.org/wiki/API",
    category: "knowledge", kind: "api", capabilities: ["encyclopedia", "fact"], access: "free", auth: "none",
    limits: "Polite use; User-Agent requested", license: "CC BY-SA 4.0", cors: true, provider: "wikipedia",
    decision: "integrated", reason: "Existing WikipediaProvider.", verified: notProbed,
  },
  {
    id: "wikidata", name: "Wikidata", url: "https://www.wikidata.org/wiki/Wikidata:Data_access",
    category: "knowledge", kind: "api", capabilities: ["structured-facts"], access: "free", auth: "none",
    limits: "SPARQL 60 s query limit", license: "CC0", cors: true, provider: "wikidata",
    decision: "integrated", reason: "Existing WikidataProvider.", verified: notProbed,
  },
  {
    id: "wikimedia-commons", name: "Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/Commons:API",
    category: "media", kind: "api", capabilities: ["images"], access: "free", auth: "none",
    limits: "Polite use", license: "Per-file (CC/PD)", cors: true, provider: "wikimedia",
    decision: "integrated", reason: "Existing WikimediaProvider.", verified: notProbed,
  },
  {
    id: "restcountries", name: "REST Countries", url: "https://restcountries.com/",
    category: "knowledge", kind: "api", capabilities: ["countries"], access: "free", auth: "none",
    limits: "unknown", license: "MPL-2.0", cors: "unknown", decision: "defer",
    reason: "v3.1 endpoint now 301-redirects to a static legacy file host; the service is in transition. Country facts are covered by Wikidata meanwhile.",
    verified: { at: PROBED, status: "changed", note: "/v3.1/name/peru → 301 files-03.restcountries.com/countries.00/legacy.json" },
  },
  {
    id: "dictionaryapi", name: "Free Dictionary API", url: "https://dictionaryapi.dev/",
    category: "knowledge", kind: "api", capabilities: ["dictionary", "definition"], access: "free", auth: "none",
    limits: "No published limit; donation-funded — cache and keep volume low", license: "CC BY-SA (Wiktionary-derived)",
    cors: true, provider: "dictionary", decision: "integrated",
    reason: "Fills a real gap: LÉLU had no dictionary. New DictionaryProvider.", verified: ok("HTTP 200, ACAO *"),
  },
  {
    id: "openlibrary", name: "Open Library", url: "https://openlibrary.org/developers/api",
    category: "knowledge", kind: "api", capabilities: ["books", "authors"], access: "free", auth: "none",
    limits: "Polite use; bulk via data dumps", license: "Metadata CC0", cors: true, provider: "openlibrary",
    decision: "integrated", reason: "Fills a gap: no book search existed. New OpenLibraryProvider.", verified: ok("HTTP 200, ACAO *"),
  },
  {
    id: "gutendex", name: "Gutendex (Project Gutenberg)", url: "https://gutendex.com/",
    category: "knowledge", kind: "api", capabilities: ["books", "public-domain-texts"], access: "free", auth: "none",
    limits: "Single community host; intermittent", license: "Texts public domain (US)", cors: "unknown",
    decision: "defer", reason: "Observed 503 then 200: unreliable. Open Library already covers book discovery; revisit with a self-hosted instance.",
    verified: { at: PROBED, status: "degraded", note: "503 after 15 s, then 200 on retry" },
  },

  /* ---------- Science and research ---------- */
  ...[
    ["arxiv", "arXiv API", "https://info.arxiv.org/help/api/", "arxiv", "1 request / 3 s"],
    ["crossref", "Crossref REST API", "https://www.crossref.org/documentation/retrieve-metadata/rest-api/", "crossref", "Polite pool with mailto"],
    ["openalex", "OpenAlex", "https://openalex.org/", "openalex", "100k requests/day, 10/s"],
  ].map(([id, name, url, provider, limits]): CatalogSource => ({
    id, name, url, category: "science", kind: "api", capabilities: ["academic", "paper"], access: "free", auth: "none",
    limits, license: "Metadata CC0 / per-record", cors: true, provider, decision: "integrated",
    reason: `Existing ${name} provider.`, verified: notProbed,
  })),
  {
    id: "nasa", name: "NASA APIs", url: "https://api.nasa.gov/", category: "science", kind: "api",
    capabilities: ["space", "astronomy"], access: "free-with-key", auth: "api-key", envVars: ["NASA_API_KEY"],
    limits: "DEMO_KEY 30/h; free key 1,000/h", license: "US Gov public domain (mostly)", cors: true, provider: "nasa",
    decision: "integrated", reason: "Existing NASAProvider plus 8 NASA science providers.", verified: notProbed,
  },
  {
    id: "usgs-earthquakes", name: "USGS Earthquake Catalog (FDSN)", url: "https://earthquake.usgs.gov/fdsnws/event/1/",
    category: "science", kind: "api", capabilities: ["earthquake", "geology", "hazards"], access: "free", auth: "none",
    limits: "Max 20,000 events per query", license: "US Gov public domain", cors: true, provider: "usgs-earthquakes",
    decision: "integrated", reason: "Endpoint was registered in Endpoints.ts but no knowledge provider used it. New UsgsEarthquakeProvider.",
    verified: ok("HTTP 200 GeoJSON, ACAO *"),
  },
  {
    id: "usgs-water", name: "USGS Water Services", url: "https://waterservices.usgs.gov/", category: "science", kind: "api",
    capabilities: ["hydrology"], access: "free", auth: "none", limits: "unknown", license: "US Gov public domain", cors: "unknown",
    decision: "defer", reason: "Requires site-code lookup to be useful; low demand.", verified: notProbed,
  },

  /* ---------- Government / open data ---------- */
  {
    id: "data-gov", name: "Data.gov (CKAN catalog)", url: "https://data.gov/", category: "open-data", kind: "dataset",
    capabilities: ["dataset-discovery"], access: "free", auth: "none", limits: "unknown", license: "Per dataset",
    cors: "unknown", decision: "defer",
    reason: "catalog.data.gov/api/3/action/package_search returned 404 — the catalog API moved; needs re-discovery before an adapter is written.",
    verified: { at: PROBED, status: "changed", note: "CKAN package_search → HTTP 404" },
  },

  /* ---------- Maps / weather ---------- */
  ...[
    ["openstreetmap", "OpenStreetMap", "https://www.openstreetmap.org/", "openstreetmap", "Tile/API usage policy applies"],
    ["nominatim", "Nominatim", "https://nominatim.org/", "nominatim", "Max 1 request/s; User-Agent required"],
    ["open-meteo", "Open-Meteo", "https://open-meteo.com/", "open-meteo", "Non-commercial free; 10k calls/day"],
  ].map(([id, name, url, provider, limits]): CatalogSource => ({
    id, name, url, category: "geo-weather", kind: "api", capabilities: id === "open-meteo" ? ["weather"] : ["geography", "map"],
    access: "free", auth: "none", limits, license: id === "open-meteo" ? "CC BY 4.0" : "ODbL", cors: true, provider,
    decision: "integrated", reason: `Existing ${name} provider.`, verified: notProbed,
  })),

  /* ---------- News and events ---------- */
  {
    id: "gdelt", name: "GDELT", url: "https://www.gdeltproject.org/", category: "news", kind: "api", capabilities: ["news", "events"],
    access: "free", auth: "none", limits: "Rate-limited DOC API", license: "Open, citation requested", cors: true, provider: "gdelt",
    decision: "integrated", reason: "Existing GDELTProvider.", verified: notProbed,
  },
  {
    id: "hackernews", name: "Hacker News (Algolia)", url: "https://github.com/HackerNews/API", category: "news", kind: "api",
    capabilities: ["technology", "news"], access: "free", auth: "none", limits: "10k requests/h per IP", license: "Public",
    cors: true, provider: "hackernews", decision: "integrated", reason: "Existing HackerNewsProvider.", verified: notProbed,
  },
  {
    id: "rss", name: "RSS / Atom feeds", url: "https://www.rssboard.org/", category: "news", kind: "protocol", capabilities: ["news", "feeds"],
    access: "free", auth: "none", limits: "Per feed", license: "Per publisher", cors: false, provider: "rss",
    decision: "integrated", reason: "Existing RSSProvider through server-side rssApi.", verified: notProbed,
  },
  {
    id: "newsapi", name: "NewsAPI", url: "https://newsapi.org/", category: "news", kind: "api", capabilities: ["news"],
    access: "freemium", auth: "api-key", envVars: ["NEWSAPI_KEY"], limits: "Developer tier 100/day, localhost-only, 24 h delay",
    license: "Commercial ToS", cors: false, provider: "news", decision: "integrated",
    reason: "Existing NewsProvider; free tier is development-only — not a production news source.", verified: notProbed,
  },

  /* ---------- Developer ---------- */
  {
    id: "github-rest", name: "GitHub REST / GraphQL", url: "https://docs.github.com/en/rest", category: "developer", kind: "api",
    capabilities: ["code", "github"], access: "free-with-key", auth: "token", envVars: ["GITHUB_TOKEN"],
    limits: "60/h anonymous; 5,000/h with token", license: "GitHub ToS", cors: true, provider: "github",
    decision: "integrated", reason: "Existing GitHubProvider and githubApi bridge.", verified: notProbed,
  },

  /* ---------- Finance ---------- */
  {
    id: "frankfurter", name: "Frankfurter (ECB rates)", url: "https://frankfurter.dev/", category: "finance", kind: "api",
    capabilities: ["currency", "exchange-rate"], access: "free", auth: "none",
    limits: "No key, no published cap; ECB reference rates updated once per working day (~16:00 CET)",
    license: "ECB data, free reuse", cors: true, provider: "frankfurter", decision: "integrated",
    reason: "No currency source existed. New FrankfurterProvider; results are labelled as daily reference rates, never live quotes.",
    verified: ok("api.frankfurter.app 301 → api.frankfurter.dev/v1; HTTP 200, ACAO *"),
  },

  /* ---------- Media and entertainment ---------- */
  {
    id: "youtube", name: "YouTube Data API v3", url: "https://developers.google.com/youtube/v3", category: "media", kind: "api",
    capabilities: ["video"], access: "free-with-key", auth: "api-key", envVars: ["YOUTUBE_API_KEY"], limits: "10,000 quota units/day; search = 100 units",
    license: "Google ToS", cors: true, provider: "youtube", decision: "integrated", reason: "Existing YouTubeProvider.", verified: notProbed,
  },
  ...[
    ["unsplash", "Unsplash", "https://unsplash.com/developers", "50 req/h demo", "Attribution + hotlinking required"],
    ["giphy", "Giphy", "https://developers.giphy.com/", "Beta key 100/h", "Attribution required"],
    ["tmdb", "TMDB", "https://developer.themoviedb.org/", "Fair use; attribution", "Non-commercial free"],
  ].map(([id, name, url, limits, license]): CatalogSource => ({
    id, name, url, category: "media", kind: "api", capabilities: ["media-metadata"], access: "free-with-key", auth: "api-key",
    envVars: [`${id.toUpperCase()}_API_KEY`], limits, license, cors: "unknown", decision: "defer",
    reason: "Needs a key the user has not configured; low priority for research. Adapter pattern ready when a key exists.",
    verified: notProbed,
  })),
  {
    id: "jikan", name: "Jikan (MyAnimeList)", url: "https://docs.api.jikan.moe/", category: "media", kind: "api", capabilities: ["anime"],
    access: "free", auth: "none", limits: "3/s, 60/min", license: "Unofficial MAL scraper", cors: "unknown", decision: "defer",
    reason: "Unreachable from the build environment (timeout); unofficial scraper of MAL — fragile.",
    verified: { at: PROBED, status: "unreachable", note: "connection timed out at 10 s and 20 s" },
  },
  {
    id: "pokeapi", name: "PokeAPI", url: "https://pokeapi.co/", category: "entertainment", kind: "api", capabilities: ["pokemon"],
    access: "free", auth: "none", limits: "Fair use; cache required", license: "BSD-3", cors: true, decision: "defer",
    reason: "Reachable, but entertainment trivia is low value for LÉLU's research; trivial to add later through the same adapter shape.",
    verified: ok("HTTP 200, ACAO *, 309 KB per Pokémon — heavy"),
  },
  {
    id: "themealdb", name: "TheMealDB", url: "https://www.themealdb.com/api.php", category: "lifestyle", kind: "api", capabilities: ["recipes"],
    access: "free", auth: "api-key", limits: "Test key '1' for development only; production needs a supporter key",
    license: "Commercial ToS", cors: true, decision: "defer",
    reason: "The free key is explicitly development/education only; using it in production would breach terms.",
    verified: ok("HTTP 200 with test key"),
  },

  /* ---------- Language and models ---------- */
  {
    id: "libretranslate", name: "LibreTranslate", url: "https://github.com/LibreTranslate/LibreTranslate", category: "language", kind: "service",
    capabilities: ["translation"], access: "self-hosted", auth: "api-key", envVars: ["LIBRETRANSLATE_URL"],
    limits: "Hosted instance needs a paid key; self-host is free", license: "AGPL-3.0", cors: "unknown", decision: "defer",
    reason: "LÉLU's LLM providers already translate; a self-hosted instance only pays off for offline/bulk translation.",
    verified: notProbed,
  },
  {
    id: "ollama", name: "Ollama", url: "https://github.com/ollama/ollama", category: "models", kind: "service", capabilities: ["local-inference"],
    access: "self-hosted", auth: "none", envVars: ["OLLAMA_URL"], limits: "Local hardware", license: "MIT", cors: "unknown",
    decision: "integrated", reason: "Existing LocalInferenceProvider / LocalRuntime.", verified: notProbed,
  },
  {
    id: "hosted-llms", name: "Anthropic, Groq, OpenRouter, Cerebras, Fireworks, Gemini, Mistral", url: "https://docs.anthropic.com/",
    category: "models", kind: "api", capabilities: ["chat", "reasoning"], access: "paid", auth: "api-key",
    envVars: ["ANTHROPIC_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "FIREWORKS_API_KEY"],
    limits: "Per provider; free tiers on Groq/Cerebras/OpenRouter(:free)", license: "Provider ToS", cors: false,
    decision: "integrated", reason: "Existing AIProviderRegistry chain; untouched. Usage now metered by UsageLedger.", verified: notProbed,
  },
];

/* ---------------- registry queries ---------------- */

export interface SourceQuery {
  text?: string;
  category?: string;
  access?: SourceAccess;
  decision?: SourceDecision;
  /** Only sources callable without any credential. */
  keyless?: boolean;
}

export function searchCatalog(query: SourceQuery = {}, catalog: readonly CatalogSource[] = SOURCE_CATALOG): CatalogSource[] {
  const words = (query.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return catalog.filter((source) => {
    if (query.category && source.category !== query.category) return false;
    if (query.access && source.access !== query.access) return false;
    if (query.decision && source.decision !== query.decision) return false;
    if (query.keyless && source.auth !== "none") return false;
    if (words.length === 0) return true;
    const haystack = [source.id, source.name, source.category, source.reason, ...source.capabilities].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function catalogEntry(id: string): CatalogSource | undefined {
  return SOURCE_CATALOG.find((source) => source.id === id);
}

/** Hosts that serve many unrelated projects under one domain. */
const PROJECT_HOSTS = new Set([
  "github.com", "gitlab.com", "bitbucket.org", "sourceforge.net", "npmjs.com", "rapidapi.com",
  "developers.google.com", "cloud.google.com", "learn.microsoft.com", "developer.microsoft.com", "aws.amazon.com",
]);

/** Normalised key used to detect the same API appearing in several catalogs. */
export function dedupeKey(nameOrUrl: string): string {
  let value = nameOrUrl.toLowerCase().trim();
  try {
    if (/^https?:\/\//.test(value)) {
      const url = new URL(value);
      // The whole host (minus www/api/docs prefixes), TLD included:
      // dictionaryapi.dev and dictionaryapi.com are different services.
      // A missed match leaves a lead unlinked; a false one hides a new source.
      const host = url.hostname.replace(/^www\./, "");
      value = host.replace(/^(api|developers?|docs)\./, "");
      // On a host that serves many unrelated projects the project is in the
      // path ("github.com/ollama/ollama"), or every repository on it would
      // be the same source.
      const segment = url.pathname.split("/").filter(Boolean)[0];
      if (segment && PROJECT_HOSTS.has(host)) value = `${value}/${segment}`;
    }
  } catch {
    /* not a URL: fall through to name normalisation */
  }
  return value.replace(/\b(api|apis|the)\b/g, "").replace(/[^a-z0-9]/g, "");
}
