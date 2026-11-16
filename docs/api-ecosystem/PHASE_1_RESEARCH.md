# Phase 1 — Repository and API Research

**Status:** PASS. Every named source has a documented evaluation. Sources that could not be fully evaluated are marked with what was and wasn't observed.
**Baseline:** `62ddd61` · **Machine-readable inventory:** [source-inventory.json](source-inventory.json), generated from `src/core/apiEcosystem/SourceCatalog.ts` (the same data the app serves at `/api/sources/catalog`).

## Method

1. **Overlap first.** Each source was checked against LÉLU's existing knowledge providers (`src/core/RegisterProviders.ts`). Most of the directive's API list was **already integrated**.
2. **Live probe** (2026-11-06, from the build container through its egress proxy, `Origin` header set to observe CORS): HTTP status, latency, and `Access-Control-Allow-Origin`.
3. **Decision rule.** Integrate only where a free, key-less, CORS-callable, maintained source fills a gap no existing provider covers. Defer anything needing a key the user hasn't configured, a self-hosted service, or an unstable endpoint.
4. "Free" means free **to call within a stated limit**. Publicly readable docs don't count as free.

## Summary

| Decision | Count | Meaning |
|---|---|---|
| integrated | 24 | Executed by a registered LÉLU provider or tool (4 new this phase, plus public-apis discovery) |
| defer | 17 | Valuable, but blocked by a key, self-hosting, instability, or terms (reason per row) |
| reference | 2 | Human reference only (prose lists) |
| reject | 1 | OpenAPI Generator: Java toolchain, heavier than LÉLU's adapters |

**New integrations:** Free Dictionary API, Open Library, Frankfurter (ECB), USGS earthquakes (its endpoint was registered but nothing used it), and public-apis discovery.

## Notable findings from live probes

| Source | Observation | Consequence |
|---|---|---|
| REST Countries | `/v3.1/name/peru` returns 301 to a static `legacy.json` file host | Service in transition; deferred (Wikidata covers country facts) |
| Frankfurter | `api.frankfurter.app` returns 301 to `api.frankfurter.dev/v1` | Adapter uses the new host directly (configurable via `FRANKFURTER_API_URL`) |
| Data.gov | CKAN `package_search` returns 404 | Catalog API moved; deferred until re-discovered |
| Jikan | Connection timed out (10 s, 20 s) | Deferred; unofficial MAL scraper |
| Gutendex | 503 after 15 s, then 200 | Unreliable single host; Open Library chosen for books |
| TheMealDB | 200, but the free key is "development/education only" | Deferred: production use would breach terms |
| APIs.guru `list.json` | 8.86 MB | Exceeds the 2 MB `safeFetch` cap; OpenAPI ingest deferred |
| public-apis README | 346 KB, ACAO `*`; **2,170 APIs in 51 categories** parsed | Used as the discovery feed |

## Additional repositories considered

Beyond the named list, these were considered for capabilities the directive names: **Mozilla Readability** (article extraction), **feedparser/rss-parser** (feeds), **p-limit/bottleneck** (rate limiting), **OpenTelemetry JS** (observability), and **LiteLLM** (provider routing). None was added. LÉLU already has equivalents (`browseApi.extractReadable`, `rssApi`, per-provider timeouts and cooldowns, `Telemetry.ts` with OTLP export, `AIProviderRegistry`). Adding them would have duplicated existing systems, which the directive forbids.

## Security and license review

- Every new source is key-less, so no new secret exists.
- Licenses: dictionary content is CC BY-SA (attribution kept in `KnowledgeResult.source` and `metadata.license`); Open Library metadata is CC0; ECB rates are free to reuse; USGS is US-Government public domain; public-apis is MIT.
- AGPL services (SearXNG, LibreTranslate, Firecrawl) are deferred. Calling them over HTTP wouldn't license LÉLU under AGPL, but each needs a self-hosted deployment.
- Catalog text (public-apis) is treated as untrusted data: tables only, fields length-capped, only http(s) links kept, never placed into a prompt.

## Decision matrix (generated)

| Source | Category | Type | Access | Auth | Limits | License / terms | LÉLU provider | Decision | Reason | Observed 2026-11-06 |
|---|---|---|---|---|---|---|---|---|---|---|
| Public APIs | discovery | repository | free | none | GitHub raw content; fetched at most once per 24 h by LÉLU | MIT | — | **integrated** | Largest curated list (~1,400 APIs) with auth/HTTPS/CORS columns; parsed as the discovery feed (plugins/sourceCatalogApi.ts). | reachable: README 346 KB, HTTP 200, ACAO * |
| Free for Dev | discovery | repository | free | none | n/a | CC0-1.0 | — | **reference** | Free tiers of infrastructure (hosting, DB, monitoring), not data APIs; prose format, not machine-parseable. Used as a human reference for free-tier limits. | not-probed |
| OpenAPI Directory (APIs.guru) | discovery | repository | free | none | list.json is 8.9 MB, over safeFetch's 2 MB cap | CC0-1.0 | — | **defer** | Machine-readable specs are valuable for adapter generation, but the index exceeds the server fetch cap; needs a streamed or pre-filtered ingest. Deferred to a later phase. | reachable: api.apis.guru/v2/list.json 8.86 MB, HTTP 200 |
| Public API Lists | discovery | repository | free | none | n/a | MIT | — | **reference** | A fork-lineage of public-apis with heavy overlap; adds little over the primary list. Kept as a comparison reference. | not-probed |
| SearXNG | search | service | self-hosted | none (SEARXNG_URL) | Public instances rate-limit and often disable JSON; self-hosting needed | AGPL-3.0 | — | **defer** | Best route to provider-independent web search, but needs a self-hosted instance (Docker) LÉLU does not run yet. AGPL applies to the service, not to LÉLU calling it. | not-probed |
| Brave Search API | search | api | freemium | api-key (BRAVE_SEARCH_API_KEY) | Free tier with monthly query cap; card required at signup | Commercial ToS | — | **defer** | High-quality web index; needs a key and a server relay. Deferred until the user configures a key. | not-probed |
| Model Context Protocol | interop | protocol | free | varies | n/a | MIT | — | **defer** | Useful for exposing LÉLU tools externally; consuming MCP servers would need a server-side client bound to ToolRegistry permissions. No current need justifies a second tool path. | not-probed |
| OpenAPI Generator | interop | tool | free | none | n/a | Apache-2.0 | — | **reject** | Java toolchain; generated clients are heavier than the ~60-line hand adapters LÉLU uses and would bypass its validation conventions. Revisit only with the OpenAPI ingest. | not-probed |
| Crawl4AI | extraction | tool | self-hosted | none | Python + headless browser; heavy | Apache-2.0 | — | **defer** | LÉLU already reads pages via browseApi + safeFetch; Crawl4AI would add a Python service and a browser. Value is in multi-page crawls, not needed yet. | not-probed |
| Playwright | extraction | tool | free | none | n/a | Apache-2.0 | — | **integrated** | Already used by LÉLU's browser.capture tool (plugins/selfViewApi.ts) and verification scripts; reused, not duplicated. | reachable: pre-installed Chromium used for this report's screenshots |
| Firecrawl | extraction | service | freemium | api-key (FIRECRAWL_API_KEY) | Hosted free credits; self-host needs Redis + workers | AGPL-3.0 | — | **defer** | Same niche as Crawl4AI; overlaps browseApi. Deferred. | not-probed |
| Wikipedia (MediaWiki API) | knowledge | api | free | none | Polite use; User-Agent requested | CC BY-SA 4.0 | `wikipedia` | **integrated** | Existing WikipediaProvider. | not-probed |
| Wikidata | knowledge | api | free | none | SPARQL 60 s query limit | CC0 | `wikidata` | **integrated** | Existing WikidataProvider. | not-probed |
| Wikimedia Commons | media | api | free | none | Polite use | Per-file (CC/PD) | `wikimedia` | **integrated** | Existing WikimediaProvider. | not-probed |
| REST Countries | knowledge | api | free | none | unknown | MPL-2.0 | — | **defer** | v3.1 endpoint now 301-redirects to a static legacy file host; the service is in transition. Country facts are covered by Wikidata meanwhile. | changed: /v3.1/name/peru → 301 files-03.restcountries.com/countries.00/legacy.json |
| Free Dictionary API | knowledge | api | free | none | No published limit; donation-funded — cache and keep volume low | CC BY-SA (Wiktionary-derived) | `dictionary` | **integrated** | Fills a real gap: LÉLU had no dictionary. New DictionaryProvider. | reachable: HTTP 200, ACAO * |
| Open Library | knowledge | api | free | none | Polite use; bulk via data dumps | Metadata CC0 | `openlibrary` | **integrated** | Fills a gap: no book search existed. New OpenLibraryProvider. | reachable: HTTP 200, ACAO * |
| Gutendex (Project Gutenberg) | knowledge | api | free | none | Single community host; intermittent | Texts public domain (US) | — | **defer** | Observed 503 then 200: unreliable. Open Library already covers book discovery; revisit with a self-hosted instance. | degraded: 503 after 15 s, then 200 on retry |
| arXiv API | science | api | free | none | 1 request / 3 s | Metadata CC0 / per-record | `arxiv` | **integrated** | Existing arXiv API provider. | not-probed |
| Crossref REST API | science | api | free | none | Polite pool with mailto | Metadata CC0 / per-record | `crossref` | **integrated** | Existing Crossref REST API provider. | not-probed |
| OpenAlex | science | api | free | none | 100k requests/day, 10/s | Metadata CC0 / per-record | `openalex` | **integrated** | Existing OpenAlex provider. | not-probed |
| NASA APIs | science | api | free-with-key | api-key (NASA_API_KEY) | DEMO_KEY 30/h; free key 1,000/h | US Gov public domain (mostly) | `nasa` | **integrated** | Existing NASAProvider plus 8 NASA science providers. | not-probed |
| USGS Earthquake Catalog (FDSN) | science | api | free | none | Max 20,000 events per query | US Gov public domain | `usgs-earthquakes` | **integrated** | Endpoint was registered in Endpoints.ts but no knowledge provider used it. New UsgsEarthquakeProvider. | reachable: HTTP 200 GeoJSON, ACAO * |
| USGS Water Services | science | api | free | none | unknown | US Gov public domain | — | **defer** | Requires site-code lookup to be useful; low demand. | not-probed |
| Data.gov (CKAN catalog) | open-data | dataset | free | none | unknown | Per dataset | — | **defer** | catalog.data.gov/api/3/action/package_search returned 404 — the catalog API moved; needs re-discovery before an adapter is written. | changed: CKAN package_search → HTTP 404 |
| OpenStreetMap | geo-weather | api | free | none | Tile/API usage policy applies | ODbL | `openstreetmap` | **integrated** | Existing OpenStreetMap provider. | not-probed |
| Nominatim | geo-weather | api | free | none | Max 1 request/s; User-Agent required | ODbL | `nominatim` | **integrated** | Existing Nominatim provider. | not-probed |
| Open-Meteo | geo-weather | api | free | none | Non-commercial free; 10k calls/day | CC BY 4.0 | `open-meteo` | **integrated** | Existing Open-Meteo provider. | not-probed |
| GDELT | news | api | free | none | Rate-limited DOC API | Open, citation requested | `gdelt` | **integrated** | Existing GDELTProvider. | not-probed |
| Hacker News (Algolia) | news | api | free | none | 10k requests/h per IP | Public | `hackernews` | **integrated** | Existing HackerNewsProvider. | not-probed |
| RSS / Atom feeds | news | protocol | free | none | Per feed | Per publisher | `rss` | **integrated** | Existing RSSProvider through server-side rssApi. | not-probed |
| NewsAPI | news | api | freemium | api-key (NEWSAPI_KEY) | Developer tier 100/day, localhost-only, 24 h delay | Commercial ToS | `news` | **integrated** | Existing NewsProvider; free tier is development-only — not a production news source. | not-probed |
| GitHub REST / GraphQL | developer | api | free-with-key | token (GITHUB_TOKEN) | 60/h anonymous; 5,000/h with token | GitHub ToS | `github` | **integrated** | Existing GitHubProvider and githubApi bridge. | not-probed |
| Frankfurter (ECB rates) | finance | api | free | none | No key, no published cap; ECB reference rates updated once per working day (~16:00 CET) | ECB data, free reuse | `frankfurter` | **integrated** | No currency source existed. New FrankfurterProvider; results are labelled as daily reference rates, never live quotes. | reachable: api.frankfurter.app 301 → api.frankfurter.dev/v1; HTTP 200, ACAO * |
| YouTube Data API v3 | media | api | free-with-key | api-key (YOUTUBE_API_KEY) | 10,000 quota units/day; search = 100 units | Google ToS | `youtube` | **integrated** | Existing YouTubeProvider. | not-probed |
| Unsplash | media | api | free-with-key | api-key (UNSPLASH_API_KEY) | 50 req/h demo | Attribution + hotlinking required | — | **defer** | Needs a key the user has not configured; low priority for research. Adapter pattern ready when a key exists. | not-probed |
| Giphy | media | api | free-with-key | api-key (GIPHY_API_KEY) | Beta key 100/h | Attribution required | — | **defer** | Needs a key the user has not configured; low priority for research. Adapter pattern ready when a key exists. | not-probed |
| TMDB | media | api | free-with-key | api-key (TMDB_API_KEY) | Fair use; attribution | Non-commercial free | — | **defer** | Needs a key the user has not configured; low priority for research. Adapter pattern ready when a key exists. | not-probed |
| Jikan (MyAnimeList) | media | api | free | none | 3/s, 60/min | Unofficial MAL scraper | — | **defer** | Unreachable from the build environment (timeout); unofficial scraper of MAL — fragile. | unreachable: connection timed out at 10 s and 20 s |
| PokeAPI | entertainment | api | free | none | Fair use; cache required | BSD-3 | — | **defer** | Reachable, but entertainment trivia is low value for LÉLU's research; trivial to add later through the same adapter shape. | reachable: HTTP 200, ACAO *, 309 KB per Pokémon — heavy |
| TheMealDB | lifestyle | api | free | api-key | Test key '1' for development only; production needs a supporter key | Commercial ToS | — | **defer** | The free key is explicitly development/education only; using it in production would breach terms. | reachable: HTTP 200 with test key |
| LibreTranslate | language | service | self-hosted | api-key (LIBRETRANSLATE_URL) | Hosted instance needs a paid key; self-host is free | AGPL-3.0 | — | **defer** | LÉLU's LLM providers already translate; a self-hosted instance only pays off for offline/bulk translation. | not-probed |
| Ollama | models | service | self-hosted | none (OLLAMA_URL) | Local hardware | MIT | — | **integrated** | Existing LocalInferenceProvider / LocalRuntime. | not-probed |
| Anthropic, Groq, OpenRouter, Cerebras, Fireworks, Gemini, Mistral | models | api | paid | api-key (ANTHROPIC_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, FIREWORKS_API_KEY) | Per provider; free tiers on Groq/Cerebras/OpenRouter(:free) | Provider ToS | — | **integrated** | Existing AIProviderRegistry chain; untouched. Usage now metered by UsageLedger. | not-probed |

## Usage for this phase

About 15 tool calls. Live probes: 13 endpoints (≈ 15 KB each except PokeAPI 309 KB, APIs.guru 8.9 MB, public-apis 346 KB). No AI tokens were spent on research. Token and context counters for this implementation session are not exposed by the environment.
