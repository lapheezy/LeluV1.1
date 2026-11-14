/**
 * ==========================================================
 * LÉLU — PUBLIC DATA CONNECTORS
 *
 * Structured retrieval from public, no-key data services, for
 * the work that needs ROWS rather than prose: charts, maps,
 * timelines, comparisons, citations. (ResearchResolver and the
 * knowledge providers in src/providers stay the prose/research
 * path; this layer does not replace them.)
 *
 * Every connector:
 *   • needs no account and no key (auth: "none") — a connector
 *     that would need one is not added here;
 *   • records its documented limits and terms, and is rate-
 *     limited client-side to stay inside them;
 *   • caches responses (TTL per source) so repeats cost nothing;
 *   • times out, retries 429/5xx with backoff (honouring
 *     Retry-After), and fails with a precise reason;
 *   • returns a citation (title, URL, retrieval time, required
 *     attribution) with every result.
 *
 * These retrieve DATA. None of them is a model or inference API.
 *
 * Verified 2026-11-14 from LÉLU's cloud build environment
 * (shared IP): see `verified` on each profile.
 * ==========================================================
 */

import { corsFetch } from "../../providers/corsFetch";

export interface ConnectorProfile {
  id: string;
  name: string;
  description: string;
  /** Who runs it and where its terms are. */
  docs: string;
  auth: "none";
  /** Documented limits, in words, as published. */
  limits: string;
  terms: string;
  attribution: string;
  /** Does the endpoint send CORS headers (callable straight from the browser)? */
  cors: boolean;
  /** Minimum gap between requests this client keeps, ms. */
  minIntervalMs: number;
  cacheTtlMs: number;
  /** Parameters the connector takes. */
  params: Record<string, string>;
  verified: { at: string; status: "ok" | "rate-limited" | "blocked-here" | "no-cors"; note?: string };
}

export interface DataCitation { title: string; url: string; accessed: string; attribution: string }

export interface DataResult {
  ok: true;
  connector: string;
  query: Record<string, unknown>;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  /** A sensible default chart for these rows, when one exists. */
  suggestedViz?: { kind: "bar" | "column" | "line" | "scatter"; label: string; value: string; x?: string };
  summary: string;
  citation: DataCitation;
  cached: boolean;
  fetchedAt: string;
}
export type DataFailure = { ok: false; connector: string; reason: string; retryable: boolean };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface ConnectorImpl {
  profile: ConnectorProfile;
  url: (q: Record<string, unknown>) => string | { error: string };
  parse: (body: string, q: Record<string, unknown>, url: string) => Omit<DataResult, "ok" | "connector" | "query" | "cached" | "fetchedAt" | "citation"> & { citationTitle: string; citationUrl?: string };
  /** Some services need a follow-up request (NWS points → forecast). */
  follow?: (body: string) => string | null;
  accept?: string;
}

const H = 60 * 60 * 1000;
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : fallback);
const int = (v: unknown, fallback: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
const enc = encodeURIComponent;
const VERIFIED_AT = "2026-11-14";

const CONNECTORS: ConnectorImpl[] = [
  {
    profile: {
      id: "wikipedia.summary", name: "Wikipedia page summary", description: "The lead summary, description and canonical URL of a Wikipedia article.",
      docs: "https://en.wikipedia.org/api/rest_v1/", auth: "none", limits: "Wikimedia REST: no fixed quota; keep under ~200 req/s and identify the client", terms: "CC BY-SA 4.0 text; Wikimedia Terms of Use",
      attribution: "Text from Wikipedia, CC BY-SA 4.0", cors: true, minIntervalMs: 100, cacheTtlMs: 24 * H, params: { title: "article title", lang: "language code (default en)" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: (q) => (str(q.title) ? `https://${str(q.lang, "en").replace(/[^a-z-]/g, "") || "en"}.wikipedia.org/api/rest_v1/page/summary/${enc(str(q.title).replace(/ /g, "_"))}` : { error: "title is required" }),
    parse: (body) => {
      const j = JSON.parse(body) as { title?: string; description?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
      return {
        columns: ["title", "description", "extract"], rows: [{ title: j.title ?? "", description: j.description ?? "", extract: j.extract ?? "" }],
        summary: j.extract ? j.extract.slice(0, 600) : "No summary.", citationTitle: `Wikipedia — ${j.title ?? "article"}`, citationUrl: j.content_urls?.desktop?.page,
      };
    },
  },
  {
    profile: {
      id: "wikipedia.search", name: "Wikipedia search", description: "Full-text search over Wikipedia: titles, snippets, word counts.",
      docs: "https://www.mediawiki.org/wiki/API:Search", auth: "none", limits: "MediaWiki API etiquette: serial requests, identify the client", terms: "CC BY-SA 4.0 text",
      attribution: "Wikipedia, CC BY-SA 4.0", cors: true, minIntervalMs: 200, cacheTtlMs: 6 * H, params: { query: "search text", limit: "1–50 (default 10)", lang: "language code" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: (q) => (str(q.query) ? `https://${str(q.lang, "en").replace(/[^a-z-]/g, "") || "en"}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${int(q.limit, 10, 1, 50)}&srsearch=${enc(str(q.query))}` : { error: "query is required" }),
    parse: (body, q) => {
      const j = JSON.parse(body) as { query?: { search?: Array<{ title: string; snippet: string; wordcount: number; timestamp: string }> } };
      const rows = (j.query?.search ?? []).map((r) => ({ title: r.title, words: r.wordcount, snippet: r.snippet.replace(/<[^>]+>/g, ""), updated: r.timestamp.slice(0, 10) }));
      return { columns: ["title", "words", "snippet", "updated"], rows, suggestedViz: { kind: "bar", label: "title", value: "words" }, summary: `${rows.length} articles for “${str(q.query)}”.`, citationTitle: `Wikipedia search — ${str(q.query)}` };
    },
  },
  {
    profile: {
      id: "wikidata.sparql", name: "Wikidata SPARQL", description: "Structured facts from Wikidata via a SPARQL SELECT query (people, places, works, quantities, dates).",
      docs: "https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service", auth: "none", limits: "60 s of query time per 60 s per client; 30 s per query; 5 parallel queries", terms: "Data CC0",
      attribution: "Wikidata (CC0)", cors: true, minIntervalMs: 1000, cacheTtlMs: 24 * H, params: { sparql: "a SELECT query" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: (q) => {
      const s = str(q.sparql ?? q.query);
      if (!/^\s*(PREFIX[\s\S]*?)?SELECT\b/i.test(s)) return { error: "sparql must be a SELECT query" };
      return `https://query.wikidata.org/sparql?format=json&query=${enc(s.slice(0, 8000))}`;
    },
    accept: "application/sparql-results+json",
    parse: (body) => {
      const j = JSON.parse(body) as { head: { vars: string[] }; results: { bindings: Array<Record<string, { value: string; datatype?: string }>> } };
      const rows = j.results.bindings.slice(0, 2000).map((b) => Object.fromEntries(j.head.vars.map((v) => {
        const cell = b[v];
        if (!cell) return [v, null];
        const n = Number(cell.value);
        return [v, cell.datatype && /decimal|integer|double|float/.test(cell.datatype) && Number.isFinite(n) ? n : cell.value];
      })));
      const numeric = j.head.vars.find((v) => rows.some((r) => typeof r[v] === "number"));
      const label = j.head.vars.find((v) => v !== numeric && /label|name/i.test(v)) ?? j.head.vars.find((v) => v !== numeric);
      return { columns: j.head.vars, rows, suggestedViz: numeric && label ? { kind: "bar", label, value: numeric } : undefined, summary: `${rows.length} result rows.`, citationTitle: "Wikidata Query Service" };
    },
  },
  {
    profile: {
      id: "crossref.works", name: "Crossref scholarly works", description: "Published papers and books: title, authors, year, venue, DOI, citation count.",
      docs: "https://api.crossref.org/swagger-ui/index.html", auth: "none", limits: "Public pool: 5 req/s and 1 concurrent request per client (2025 policy)", terms: "Metadata is free to reuse (CC0 facts)",
      attribution: "Metadata from Crossref", cors: true, minIntervalMs: 250, cacheTtlMs: 12 * H, params: { query: "search text", rows: "1–50 (default 10)", from: "earliest year (optional)" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: (q) => (str(q.query) ? `https://api.crossref.org/works?query=${enc(str(q.query))}&rows=${int(q.rows ?? q.limit, 10, 1, 50)}&select=DOI,title,author,issued,container-title,is-referenced-by-count,URL${str(q.from) ? `&filter=from-pub-date:${enc(str(q.from))}` : ""}` : { error: "query is required" }),
    parse: (body, q) => {
      const j = JSON.parse(body) as { message: { items: Array<{ DOI: string; title?: string[]; author?: Array<{ family?: string; given?: string }>; issued?: { "date-parts"?: number[][] }; "container-title"?: string[]; "is-referenced-by-count"?: number; URL?: string }> } };
      const rows = j.message.items.map((w) => ({
        title: (w.title?.[0] ?? "").slice(0, 300), authors: (w.author ?? []).slice(0, 4).map((a) => [a.given, a.family].filter(Boolean).join(" ")).join(", "),
        year: w.issued?.["date-parts"]?.[0]?.[0] ?? null, venue: w["container-title"]?.[0] ?? "", citations: w["is-referenced-by-count"] ?? 0, doi: w.DOI, url: w.URL ?? `https://doi.org/${w.DOI}`,
      }));
      return { columns: ["title", "authors", "year", "venue", "citations", "doi", "url"], rows, suggestedViz: { kind: "bar", label: "title", value: "citations" }, summary: `${rows.length} works for “${str(q.query)}”.`, citationTitle: `Crossref — ${str(q.query)}` };
    },
  },
  {
    profile: {
      id: "arxiv.search", name: "arXiv preprints", description: "Preprints: title, authors, published date, abstract, PDF link.",
      docs: "https://info.arxiv.org/help/api/user-manual.html", auth: "none", limits: "One request every 3 seconds; single connection", terms: "arXiv API Terms of Use; link back to arXiv",
      attribution: "Thank you to arXiv for use of its open access interoperability", cors: false, minIntervalMs: 3000, cacheTtlMs: 12 * H, params: { query: "search text", max: "1–50 (default 10)" },
      verified: { at: VERIFIED_AT, status: "no-cors", note: "answers 200 but sends no CORS header: browser calls go through the existing CORS relay (corsFetch)" },
    },
    url: (q) => (str(q.query) ? `https://export.arxiv.org/api/query?search_query=all:${enc(str(q.query))}&start=0&max_results=${int(q.max ?? q.limit, 10, 1, 50)}&sortBy=relevance` : { error: "query is required" }),
    parse: (body, q) => {
      const entries = body.split("<entry>").slice(1);
      const tag = (s: string, t: string) => (new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(s)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const rows = entries.map((e) => ({
        title: tag(e, "title"), authors: [...e.matchAll(/<name>([^<]+)<\/name>/g)].slice(0, 4).map((m) => m[1]).join(", "),
        published: tag(e, "published").slice(0, 10), year: Number(tag(e, "published").slice(0, 4)) || null, abstract: tag(e, "summary").slice(0, 500), url: tag(e, "id"),
      }));
      return { columns: ["title", "authors", "published", "year", "abstract", "url"], rows, summary: `${rows.length} preprints for “${str(q.query)}”.`, citationTitle: `arXiv — ${str(q.query)}` };
    },
  },
  {
    profile: {
      id: "openalex.works", name: "OpenAlex scholarly works", description: "Works with concepts, open-access status and citation counts.",
      docs: "https://docs.openalex.org", auth: "none", limits: "Keyless requests share a small free daily budget per IP address; heavier use needs a (free) key, which LÉLU does not create", terms: "Data CC0",
      attribution: "Data from OpenAlex (CC0)", cors: true, minIntervalMs: 200, cacheTtlMs: 12 * H, params: { query: "search text", limit: "1–50" },
      verified: { at: VERIFIED_AT, status: "rate-limited", note: "429 here: this shared cloud IP's keyless daily budget was spent; works where the IP's budget remains" },
    },
    url: (q) => (str(q.query) ? `https://api.openalex.org/works?search=${enc(str(q.query))}&per-page=${int(q.limit, 10, 1, 50)}&select=id,display_name,publication_year,cited_by_count,open_access,doi` : { error: "query is required" }),
    parse: (body, q) => {
      const j = JSON.parse(body) as { results: Array<{ id: string; display_name: string; publication_year: number; cited_by_count: number; open_access?: { is_oa?: boolean }; doi?: string }> };
      const rows = j.results.map((w) => ({ title: w.display_name, year: w.publication_year, citations: w.cited_by_count, open_access: w.open_access?.is_oa ? "yes" : "no", url: w.doi ?? w.id }));
      return { columns: ["title", "year", "citations", "open_access", "url"], rows, suggestedViz: { kind: "bar", label: "title", value: "citations" }, summary: `${rows.length} works for “${str(q.query)}”.`, citationTitle: `OpenAlex — ${str(q.query)}` };
    },
  },
  {
    profile: {
      id: "usgs.earthquakes", name: "USGS earthquakes", description: "Real-time earthquake feed: magnitude, place, time, depth, coordinates.",
      docs: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", auth: "none", limits: "No published quota; feeds update every minute — cache, don't poll faster", terms: "US public domain",
      attribution: "U.S. Geological Survey Earthquake Hazards Program", cors: true, minIntervalMs: 1000, cacheTtlMs: 5 * 60 * 1000,
      params: { magnitude: "significant | 4.5 | 2.5 | 1.0 | all (default 4.5)", period: "hour | day | week | month (default week)" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: (q) => {
      const mag = ["significant", "4.5", "2.5", "1.0", "all"].includes(str(q.magnitude)) ? str(q.magnitude) : "4.5";
      const period = ["hour", "day", "week", "month"].includes(str(q.period)) ? str(q.period) : "week";
      return `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${mag}_${period}.geojson`;
    },
    parse: (body, _q, url) => {
      const j = JSON.parse(body) as { metadata: { title: string }; features: Array<{ properties: { mag: number; place: string; time: number; url: string; tsunami: number }; geometry: { coordinates: [number, number, number] } }> };
      const rows = j.features.map((f) => ({
        time: new Date(f.properties.time).toISOString().slice(0, 16).replace("T", " "), day: new Date(f.properties.time).toISOString().slice(0, 10),
        magnitude: f.properties.mag, place: f.properties.place, depth_km: f.geometry.coordinates[2], latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0], url: f.properties.url,
      }));
      const strongest = [...rows].sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))[0];
      return {
        columns: ["time", "day", "magnitude", "place", "depth_km", "latitude", "longitude", "url"], rows, suggestedViz: { kind: "scatter", label: "place", value: "magnitude", x: "depth_km" },
        summary: `${rows.length} earthquakes (${j.metadata.title}).${strongest ? ` Strongest: M${strongest.magnitude} ${strongest.place}.` : ""}`, citationTitle: `USGS — ${j.metadata.title}`, citationUrl: url,
      };
    },
  },
  {
    profile: {
      id: "nws.forecast", name: "US National Weather Service forecast", description: "Official 7-day forecast periods for a US latitude/longitude.",
      docs: "https://www.weather.gov/documentation/services-web-api", auth: "none", limits: "Undisclosed generous limit; identify the client; cache", terms: "US public domain",
      attribution: "NOAA / National Weather Service", cors: true, minIntervalMs: 1000, cacheTtlMs: H, params: { lat: "latitude (US only)", lon: "longitude" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: (q) => {
      const lat = Number(q.lat), lon = Number(q.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}` : { error: "lat and lon are required" };
    },
    accept: "application/geo+json",
    follow: (body) => (JSON.parse(body) as { properties?: { forecast?: string } }).properties?.forecast ?? null,
    parse: (body, _q, url) => {
      const j = JSON.parse(body) as { properties: { periods: Array<{ name: string; temperature: number; temperatureUnit: string; shortForecast: string; windSpeed: string }> } };
      const rows = j.properties.periods.map((p) => ({ period: p.name, temperature: p.temperature, unit: p.temperatureUnit, forecast: p.shortForecast, wind: p.windSpeed }));
      return { columns: ["period", "temperature", "unit", "forecast", "wind"], rows, suggestedViz: { kind: "line", label: "period", value: "temperature" }, summary: rows.slice(0, 2).map((r) => `${r.period}: ${r.temperature}°${r.unit}, ${r.forecast}`).join("; "), citationTitle: "National Weather Service forecast", citationUrl: url };
    },
  },
  {
    profile: {
      id: "openmeteo.forecast", name: "Open-Meteo forecast", description: "Daily temperature/precipitation forecast for any latitude/longitude.",
      docs: "https://open-meteo.com/en/docs", auth: "none", limits: "Non-commercial use only; < 10,000 calls/day, 5,000/hour, 600/minute", terms: "CC BY 4.0; non-commercial free tier",
      attribution: "Weather data by Open-Meteo.com (CC BY 4.0)", cors: true, minIntervalMs: 500, cacheTtlMs: H, params: { lat: "latitude", lon: "longitude", days: "1–16 (default 7)" },
      verified: { at: VERIFIED_AT, status: "rate-limited", note: "429 here: the shared cloud IP's daily allowance was spent by others" },
    },
    url: (q) => {
      const lat = Number(q.lat), lon = Number(q.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=${int(q.days, 7, 1, 16)}` : { error: "lat and lon are required" };
    },
    parse: (body, _q, url) => {
      const j = JSON.parse(body) as { daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[] } };
      const rows = j.daily.time.map((t, i) => ({ day: t, max_c: j.daily.temperature_2m_max[i], min_c: j.daily.temperature_2m_min[i], precipitation_mm: j.daily.precipitation_sum[i] }));
      return { columns: ["day", "max_c", "min_c", "precipitation_mm"], rows, suggestedViz: { kind: "line", label: "day", value: "max_c" }, summary: `${rows.length}-day forecast.`, citationTitle: "Open-Meteo forecast", citationUrl: url };
    },
  },
  {
    profile: {
      id: "hackernews.top", name: "Hacker News top stories", description: "Current top stories with score, comments and link.",
      docs: "https://github.com/HackerNews/API", auth: "none", limits: "No published limit (Firebase); cache", terms: "Public API",
      attribution: "Hacker News (Y Combinator)", cors: true, minIntervalMs: 100, cacheTtlMs: 10 * 60 * 1000, params: { limit: "1–30 (default 10)" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: () => "https://hacker-news.firebaseio.com/v0/topstories.json",
    parse: () => ({ columns: [], rows: [], summary: "", citationTitle: "" }), // replaced by a custom fetch below
  },
  {
    profile: {
      id: "github.releases", name: "GitHub releases", description: "A public repository's releases: tag, name, date, URL.",
      docs: "https://docs.github.com/rest/releases/releases", auth: "none", limits: "60 unauthenticated requests per hour per IP", terms: "GitHub API Terms",
      attribution: "GitHub", cors: true, minIntervalMs: 1000, cacheTtlMs: 6 * H, params: { repo: "owner/name", limit: "1–30" },
      verified: { at: VERIFIED_AT, status: "blocked-here", note: "this build session's network proxy blocks api.github.com for repositories it is not scoped to; reachable from a normal network" },
    },
    url: (q) => (/^[\w.-]+\/[\w.-]+$/.test(str(q.repo)) ? `https://api.github.com/repos/${str(q.repo)}/releases?per_page=${int(q.limit, 10, 1, 30)}` : { error: "repo must be owner/name" }),
    accept: "application/vnd.github+json",
    parse: (body, q) => {
      const j = JSON.parse(body) as Array<{ tag_name: string; name: string; published_at: string; html_url: string }>;
      const rows = j.map((r) => ({ tag: r.tag_name, name: r.name, published: r.published_at?.slice(0, 10) ?? "", url: r.html_url }));
      return { columns: ["tag", "name", "published", "url"], rows, summary: `${rows.length} releases of ${str(q.repo)}.`, citationTitle: `GitHub — ${str(q.repo)} releases`, citationUrl: `https://github.com/${str(q.repo)}/releases` };
    },
  },
  {
    profile: {
      id: "nominatim.search", name: "OpenStreetMap place search (Nominatim)", description: "Geocode a place name to coordinates and an address.",
      docs: "https://operations.osmfoundation.org/policies/nominatim/", auth: "none", limits: "Absolute maximum 1 request per second; no bulk geocoding; cache results", terms: "ODbL — © OpenStreetMap contributors",
      attribution: "© OpenStreetMap contributors (ODbL)", cors: true, minIntervalMs: 1100, cacheTtlMs: 7 * 24 * H, params: { query: "place name", limit: "1–10 (default 5)" },
      verified: { at: VERIFIED_AT, status: "ok" },
    },
    url: (q) => (str(q.query) ? `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${int(q.limit, 5, 1, 10)}&q=${enc(str(q.query))}` : { error: "query is required" }),
    parse: (body, q) => {
      const j = JSON.parse(body) as Array<{ display_name: string; lat: string; lon: string; type: string; importance?: number }>;
      const rows = j.map((p) => ({ place: p.display_name, latitude: Number(p.lat), longitude: Number(p.lon), type: p.type, importance: p.importance ?? null }));
      return { columns: ["place", "latitude", "longitude", "type", "importance"], rows, summary: rows[0] ? `${rows[0].place} at ${rows[0].latitude}, ${rows[0].longitude}` : "No match.", citationTitle: `OpenStreetMap — ${str(q.query)}` };
    },
  },
];

const BY_ID = new Map(CONNECTORS.map((c) => [c.profile.id, c]));

export function connectorProfiles(): ConnectorProfile[] {
  return CONNECTORS.map((c) => ({ ...c.profile }));
}

/** Every host a connector may contact — checked by the spend-policy test (all keyless, none bills). */
export function connectorHosts(): string[] {
  return ["en.wikipedia.org", "query.wikidata.org", "api.crossref.org", "export.arxiv.org", "api.openalex.org", "earthquake.usgs.gov", "api.weather.gov", "api.open-meteo.com", "hacker-news.firebaseio.com", "api.github.com", "nominatim.openstreetmap.org"];
}

/* ------------------------------------------------------------------ *
 * Transport: cache, pacing, timeout, retry
 * ------------------------------------------------------------------ */

const cache = new Map<string, { at: number; ttl: number; body: string; url: string }>();
const lastCall = new Map<string, number>();
const CACHE_MAX = 200;
const CLIENT_ID = "LELU-research/1.1 (open-source assistant; public data connector)";

export function clearConnectorCache(): void { cache.clear(); lastCall.clear(); }

function isBrowser(): boolean { return typeof window !== "undefined" && typeof document !== "undefined"; }

async function pace(id: string, minInterval: number): Promise<void> {
  const last = lastCall.get(id) ?? 0;
  const wait = last + minInterval - Date.now();
  lastCall.set(id, Math.max(Date.now(), last + minInterval));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getText(c: ConnectorImpl, url: string, fetchImpl: FetchLike | undefined, timeoutMs: number): Promise<{ ok: true; body: string } | { ok: false; reason: string; retryable: boolean }> {
  const headers: Record<string, string> = { Accept: c.accept ?? "application/json" };
  // Browsers forbid setting User-Agent; Wikimedia reads Api-User-Agent instead.
  if (!isBrowser()) headers["User-Agent"] = CLIENT_ID;
  else if (url.includes("wikipedia.org") || url.includes("wikidata.org")) headers["Api-User-Agent"] = CLIENT_ID;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    await pace(c.profile.id, c.profile.minIntervalMs);
    try {
      const doFetch: FetchLike = fetchImpl ?? (isBrowser() && !c.profile.cors ? (u, init) => corsFetch(u, init, timeoutMs) : (u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(timeoutMs) }));
      const res = await doFetch(url, { headers });
      if (res.ok) return { ok: true, body: await res.text() };
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < 3) {
        const header = res.headers.get("retry-after");
        const after = header ? Number(header) : Number.NaN;
        const delay = Number.isFinite(after) && after > 0 && after <= 10 ? after * 1000 : 600 * 2 ** (attempt - 1);
        if (res.status === 429 && !(Number.isFinite(after) && after <= 10)) {
          // A daily/hourly budget (no short Retry-After) will not clear by retrying.
          return { ok: false, reason: `${c.profile.name} refused with 429 (rate limit: ${c.profile.limits})`, retryable: true };
        }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      return { ok: false, reason: `${c.profile.name} answered HTTP ${res.status}${text ? `: ${text}` : ""}`, retryable };
    } catch (error) {
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 500)); continue; }
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `${c.profile.name} could not be reached (${/timeout|abort/i.test(msg) ? `no answer in ${timeoutMs / 1000}s` : msg})`, retryable: true };
    }
  }
}

async function cachedText(c: ConnectorImpl, url: string, fetchImpl: FetchLike | undefined, timeoutMs: number) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return { ok: true as const, body: hit.body, cached: true };
  const r = await getText(c, url, fetchImpl, timeoutMs);
  if (!r.ok) return r;
  cache.set(url, { at: Date.now(), ttl: c.profile.cacheTtlMs, body: r.body, url });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return { ...r, cached: false };
}

/** Query a connector. Never throws. */
export async function queryConnector(id: string, query: Record<string, unknown> = {}, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<DataResult | DataFailure> {
  const c = BY_ID.get(id);
  if (!c) return { ok: false, connector: id, reason: `no connector “${id}” (have ${[...BY_ID.keys()].join(", ")})`, retryable: false };
  const timeoutMs = options.timeoutMs ?? 12_000;
  const accessed = new Date().toISOString();
  if (id === "hackernews.top") return hackerNews(c, query, options.fetchImpl, timeoutMs, accessed);
  const url = c.url(query);
  if (typeof url !== "string") return { ok: false, connector: id, reason: url.error, retryable: false };
  let r = await cachedText(c, url, options.fetchImpl, timeoutMs);
  if (!r.ok) return { ok: false, connector: id, reason: r.reason, retryable: r.retryable };
  let finalUrl = url;
  if (c.follow) {
    const next = c.follow(r.body);
    if (!next) return { ok: false, connector: id, reason: `${c.profile.name} has no follow-up data for this request (outside its coverage?)`, retryable: false };
    finalUrl = next;
    const r2 = await cachedText(c, next, options.fetchImpl, timeoutMs);
    if (!r2.ok) return { ok: false, connector: id, reason: r2.reason, retryable: r2.retryable };
    r = r2;
  }
  try {
    const parsed = c.parse(r.body, query, finalUrl);
    const { citationTitle, citationUrl, ...rest } = parsed;
    return { ok: true, connector: id, query, ...rest, cached: r.cached, fetchedAt: accessed, citation: { title: citationTitle, url: citationUrl ?? finalUrl, accessed, attribution: c.profile.attribution } };
  } catch (error) {
    return { ok: false, connector: id, reason: `${c.profile.name} returned data in an unexpected shape (${error instanceof Error ? error.message : String(error)})`, retryable: false };
  }
}

async function hackerNews(c: ConnectorImpl, q: Record<string, unknown>, fetchImpl: FetchLike | undefined, timeoutMs: number, accessed: string): Promise<DataResult | DataFailure> {
  const top = await cachedText(c, "https://hacker-news.firebaseio.com/v0/topstories.json", fetchImpl, timeoutMs);
  if (!top.ok) return { ok: false, connector: c.profile.id, reason: top.reason, retryable: top.retryable };
  const ids = (JSON.parse(top.body) as number[]).slice(0, int(q.limit, 10, 1, 30));
  const items = await Promise.all(ids.map((id) => cachedText({ ...c, profile: { ...c.profile, minIntervalMs: 0 } }, `https://hacker-news.firebaseio.com/v0/item/${id}.json`, fetchImpl, timeoutMs)));
  const rows = items.flatMap((it) => {
    if (!it.ok) return [];
    const j = JSON.parse(it.body) as { id: number; title: string; score: number; descendants?: number; url?: string; by: string };
    return [{ title: j.title, score: j.score, comments: j.descendants ?? 0, by: j.by, url: j.url ?? `https://news.ycombinator.com/item?id=${j.id}` }];
  });
  return {
    ok: true, connector: c.profile.id, query: q, columns: ["title", "score", "comments", "by", "url"], rows, suggestedViz: { kind: "bar", label: "title", value: "score" },
    summary: `${rows.length} top stories.`, cached: top.cached, fetchedAt: accessed,
    citation: { title: "Hacker News — top stories", url: "https://news.ycombinator.com/", accessed, attribution: c.profile.attribution },
  };
}

/** Turn rows into a chart program input (kind/labels/series/x/details/sources), using the connector's suggestion unless told otherwise. */
export function rowsToViz(result: DataResult, choice: { kind?: string; label?: string; value?: string; x?: string; title?: string; limit?: number; aggregate?: "count" | "sum" | "mean" } = {}): Record<string, unknown> | string {
  const s = result.suggestedViz;
  const kind = choice.kind ?? s?.kind ?? "column";
  const label = choice.label ?? s?.label ?? result.columns[0];
  const value = choice.value ?? s?.value ?? result.columns.find((c) => result.rows.some((r) => typeof r[c] === "number"));
  const limit = Math.min(Math.max(1, choice.limit ?? 40), 2000);
  const source = { title: result.citation.title, url: result.citation.url, accessed: result.citation.accessed.slice(0, 10) };
  if (choice.aggregate === "count" || (choice.aggregate && value)) {
    const groups = new Map<string, number[]>();
    for (const r of result.rows) {
      const k = String(r[label] ?? "—");
      groups.set(k, [...(groups.get(k) ?? []), choice.aggregate === "count" ? 1 : Number(r[value!] ?? 0)]);
    }
    const keys = [...groups.keys()].sort().slice(0, limit);
    const agg = (vs: number[]) => (choice.aggregate === "mean" ? vs.reduce((a, b) => a + b, 0) / vs.length : vs.reduce((a, b) => a + b, 0));
    return { kind, title: choice.title ?? `${choice.aggregate === "count" ? "Count" : choice.aggregate} by ${label}`, labels: keys, series: [{ name: choice.aggregate === "count" ? "count" : `${choice.aggregate} of ${value}`, values: keys.map((k) => Math.round(agg(groups.get(k)!) * 100) / 100) }], xLabel: label, sources: [source] };
  }
  if (!value) return `none of the columns (${result.columns.join(", ")}) is numeric`;
  const rows = result.rows.filter((r) => typeof r[value] === "number").slice(0, limit);
  if (rows.length === 0) return `no rows have a numeric “${value}”`;
  const details = rows.map((r) => String(r.place ?? r.title ?? r[label] ?? ""));
  if (kind === "scatter") {
    const x = choice.x ?? s?.x;
    if (!x) return "a scatter chart needs an x column";
    return { kind, title: choice.title ?? `${value} vs ${x}`, labels: [], x: rows.map((r) => Number(r[x])), series: [{ name: value, values: rows.map((r) => r[value] as number) }], details, xLabel: x, yLabel: value, sources: [source] };
  }
  return { kind, title: choice.title ?? `${value} by ${label}`, labels: rows.map((r) => String(r[label] ?? "")), series: [{ name: value, values: rows.map((r) => r[value] as number) }], details, yLabel: value, sources: [source] };
}
