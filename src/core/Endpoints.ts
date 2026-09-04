/**
 * ==========================================================
 * LÉLU — ENDPOINT REGISTRY
 *
 * Single source of truth for every EXTERNAL SERVICE BASE URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every endpoint in the codebase was a string literal at its
 * call site. That is fine until you need to point one somewhere
 * else — a regional mirror, a self-hosted Nominatim or OSRM, an
 * OpenAI-compatible gateway in front of Groq, a proxy for a
 * network that blocks a host, or a recorded fixture in a test —
 * and then there is no way to do it but edit source.
 *
 * This module makes each of those a named, resolvable setting
 * with the current hardcoded value as its default, so nothing
 * changes until something is actually configured.
 *
 * RESOLUTION
 * ----------
 * Identical to the credential chain in Environment.ts, so an
 * endpoint and a key configured the same way behave the same way:
 *
 *   1. import.meta.env.VITE_<NAME>   (browser bundle)
 *   2. globalThis.__LELU_<NAME>__    (runtime key bridge)
 *   3. window.__LELU_<NAME>__        (same object in a browser)
 *   4. process.env.<NAME>            (server runtimes, unprefixed)
 *
 * The UNPREFIXED name is the documented one here — these are the
 * names a platform's secret/variable UI actually carries, and
 * unlike credentials a base URL is not a secret, so it is bridged
 * to the browser without the exposure question that governs keys.
 *
 * A VITE_-prefixed form of any name is accepted and wins, matching
 * the precedence rule used everywhere else in the project.
 * ==========================================================
 */

/** Resolve one name across every rung a provider would use. */
function readRungs(name: string): string | undefined {
  try {
    const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const fromVite = viteEnv?.[`VITE_${name}`] ?? viteEnv?.[name];
    if (typeof fromVite === "string" && fromVite.trim()) return fromVite.trim();
  } catch {
    /* import.meta.env does not exist outside Vite — fall through */
  }

  const runtime = globalThis as unknown as Record<string, string | undefined>;
  const fromGlobal = runtime[`__LELU_${name}__`];
  if (typeof fromGlobal === "string" && fromGlobal.trim()) return fromGlobal.trim();

  const processEnv =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined> | undefined)
      : undefined;
  const fromProcess = processEnv?.[`VITE_${name}`] ?? processEnv?.[name];
  if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess.trim();

  return undefined;
}

/** Drop a trailing slash so `${base}/path` never produces a double slash. */
function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Append the API's version segment when a configured base omits it.
 * A base that already carries the segment anywhere in its path is left
 * untouched, so a gateway URL that includes its own `/v1` is not doubled.
 */
function withApiSuffix(base: string, suffix?: string): string {
  if (!suffix) return base;
  const normalizedSuffix = normalize(suffix);
  return base.endsWith(normalizedSuffix) ? base : `${base}${normalizedSuffix}`;
}

export interface EndpointDefinition {
  /** Accepted environment variable names, in precedence order. */
  readonly names: readonly string[];
  /** The value used when nothing is configured — today's hardcoded URL. */
  readonly fallback: string;
  /** What the endpoint is for, shown in diagnostics. */
  readonly description: string;
  /**
   * A version segment the API's paths are relative to (`/v1`, `/api/v1`).
   *
   * This is not decoration. The name `ANTHROPIC_BASE_URL` is genuinely
   * ambiguous — the Anthropic SDK documents it WITHOUT the version
   * (`https://api.anthropic.com`, since the SDK appends `/v1` itself),
   * while the endpoint an operator copies out of the API reference
   * includes it. Both spellings are in the wild, and the two differ by
   * exactly one path segment, so guessing wrong is a silent 404 on every
   * request rather than a startup error. Any base already containing the
   * segment is left alone; one missing it gets it appended, so both
   * spellings resolve to the same working URL.
   */
  readonly apiSuffix?: string;
}

/**
 * The registry. Keys are the logical identifiers used in code;
 * `names` are what an operator sets in the environment.
 *
 * Every `fallback` is the exact URL the code used before this
 * module existed, so behaviour is unchanged out of the box.
 */
export const ENDPOINTS = {
  /* ---- AI chat providers ---- */
  anthropic: {
    names: ["ANTHROPIC_BASE_URL"],
    fallback: "https://api.anthropic.com/v1",
    description: "Anthropic Messages API base",
    apiSuffix: "/v1",
  },
  groq: {
    names: ["GROQ_BASE_URL"],
    fallback: "https://api.groq.com/openai/v1",
    description: "Groq OpenAI-compatible base",
    apiSuffix: "/openai/v1",
  },
  cerebras: {
    names: ["CEREBRAS_BASE_URL"],
    fallback: "https://api.cerebras.ai/v1",
    description: "Cerebras inference base",
    apiSuffix: "/v1",
  },
  openrouter: {
    names: ["OPENROUTER_BASE_URL"],
    fallback: "https://openrouter.ai/api/v1",
    description: "OpenRouter inference base",
    apiSuffix: "/api/v1",
  },
  gemini: {
    names: ["GEMINI_BASE_URL"],
    fallback: "https://generativelanguage.googleapis.com",
    description: "Google Gemini generative language base",
  },
  mistral: {
    names: ["MISTRAL_BASE_URL"],
    fallback: "https://api.mistral.ai/v1",
    description: "Mistral inference base",
    apiSuffix: "/v1",
  },
  fireworks: {
    names: ["FIREWORKS_BASE_URL"],
    fallback: "https://api.fireworks.ai/inference/v1",
    description: "Fireworks inference base",
    apiSuffix: "/inference/v1",
  },

  /* ---- Geocoding / mapping / routing ---- */
  geocoding: {
    names: ["GEOCODING_BASE_URL"],
    fallback: "https://nominatim.openstreetmap.org",
    description: "Forward/reverse geocoding base",
  },
  nominatim: {
    names: ["NOMINATIM_API_URL"],
    fallback: "https://nominatim.openstreetmap.org",
    description: "Nominatim place search",
  },
  openstreetmap: {
    names: ["OPENSTREETMAP_API_URL"],
    fallback: "https://www.openstreetmap.org",
    description: "OpenStreetMap web (map permalinks)",
  },
  osrm: {
    names: ["OSRM_API_URL"],
    fallback: "https://router.project-osrm.org",
    description: "OSRM routing",
  },
  geoapify: {
    names: ["GEOAPIFY_API_URL"],
    fallback: "https://api.geoapify.com",
    description: "Geoapify geocoding/places",
  },
  openMeteoGeocoding: {
    names: ["OPEN_METEO_GEOCODING_API_URL"],
    fallback: "https://geocoding-api.open-meteo.com",
    description: "Open-Meteo geocoding (name ⇄ coordinate lookups)",
  },

  /* ---- Weather / earth science ---- */
  openMeteo: {
    names: ["OPEN_METEO_API_URL"],
    fallback: "https://api.open-meteo.com",
    description: "Open-Meteo forecast",
  },
  noaa: {
    names: ["NOAA_API_URL"],
    fallback: "https://api.weather.gov",
    description: "NOAA / US National Weather Service",
  },
  firms: {
    names: ["FIRMS_API_URL"],
    fallback: "https://firms.modaps.eosdis.nasa.gov",
    description: "NASA FIRMS active-fire hotspots",
  },
  usgsEarthquake: {
    names: ["USGS_EARTHQUAKE_API_URL"],
    fallback: "https://earthquake.usgs.gov",
    description: "USGS earthquake feeds",
  },

  /* ---- NASA ---- */
  nasa: {
    names: ["NASA_API_URL"],
    fallback: "https://api.nasa.gov",
    description: "NASA open API root",
  },
  nasaImages: {
    names: ["NASA_IMAGES_API_URL"],
    fallback: "https://images-api.nasa.gov",
    description: "NASA image and video library",
  },
  nasaApod: {
    names: ["NASA_APOD_API_URL"],
    fallback: "https://api.nasa.gov/planetary/apod",
    description: "NASA Astronomy Picture of the Day",
  },
  nasaNeo: {
    names: ["NASA_NEO_API_URL"],
    fallback: "https://api.nasa.gov/neo/rest/v1",
    description: "NASA near-Earth object catalogue",
  },
  nasaDonki: {
    names: ["NASA_DONKI_API_URL"],
    fallback: "https://api.nasa.gov/DONKI",
    description: "NASA space-weather notifications",
  },
  nasaEonet: {
    names: ["NASA_EONET_API_URL"],
    fallback: "https://eonet.gsfc.nasa.gov/api/v2.1",
    description: "NASA Earth Observatory natural events",
  },
  nasaEpic: {
    names: ["NASA_EPIC_API_URL"],
    fallback: "https://api.nasa.gov/EPIC",
    description: "NASA EPIC full-disc Earth imagery",
  },
  nasaExoplanet: {
    names: ["NASA_EXOPLANET_API_URL"],
    fallback: "https://exoplanetarchive.ipac.caltech.edu",
    description: "NASA exoplanet archive",
  },
  nasaOsdr: {
    names: ["NASA_OSDR_API_URL"],
    fallback: "https://osdr.nasa.gov/osdr/data/osd",
    description: "NASA Open Science Data Repository",
  },
  nasaInsight: {
    names: ["NASA_INSIGHT_API_URL"],
    fallback: "https://api.nasa.gov/insight_weather",
    description: "NASA InSight Mars weather",
  },
  spacex: {
    names: ["SPACEX_API_URL"],
    fallback: "https://api.spacexdata.com/v5",
    description: "SpaceX launch data",
  },
  celestrak: {
    names: ["CELESTRAK_API_URL"],
    fallback: "https://celestrak.org",
    description: "CelesTrak orbital elements",
  },

  /* ---- News ---- */
  newsapi: {
    names: ["NEWSAPI_URL", "NEWSAPI_API_URL"],
    fallback: "https://newsapi.org/v2",
    description: "NewsAPI.org",
  },
  newsdata: {
    names: ["NEWSDATA_API_URL"],
    fallback: "https://newsdata.io/api/1",
    description: "NewsData.io",
  },
  newsdataWebsocket: {
    names: ["NEWSDATA_WEBSOCKET_URL"],
    fallback: "wss://ws.newsdata.io/ws/event",
    description: "NewsData.io live event stream",
  },
  gnews: {
    names: ["GNEWS_URL", "GNEWS_API_URL"],
    fallback: "https://gnews.io/api/v4",
    description: "GNews",
  },
  guardian: {
    names: ["GUARDIAN_API_URL"],
    fallback: "https://content.guardianapis.com",
    description: "The Guardian content API",
  },
  googleNewsRss: {
    names: ["GOOGLE_NEWS_RSS_BASE_URL"],
    fallback: "https://news.google.com",
    description: "Google News RSS host",
  },

  /* ---- Media / social ---- */
  youtube: {
    names: ["YOUTUBE_API_URL"],
    fallback: "https://www.googleapis.com/youtube/v3",
    description: "YouTube Data API v3",
  },
  instagram: {
    names: ["INSTAGRAM_API_URL"],
    fallback: "https://graph.instagram.com",
    description: "Instagram Graph API",
  },
  metaGraph: {
    names: ["META_GRAPH_API_URL"],
    fallback: "https://graph.facebook.com",
    description: "Meta Graph API",
  },

  /* ---- Knowledge / research ---- */
  github: {
    names: ["GITHUB_API_URL"],
    fallback: "https://api.github.com",
    description: "GitHub REST API",
  },
  githubModels: {
    names: ["GITHUB_MODELS_BASE_URL"],
    fallback: "https://models.github.ai/inference",
    description: "GitHub Models inference",
  },
  arxiv: {
    names: ["ARXIV_API_URL"],
    fallback: "https://export.arxiv.org",
    description: "arXiv query API",
  },
  crossref: {
    names: ["CROSSREF_API_URL"],
    fallback: "https://api.crossref.org",
    description: "CrossRef works",
  },
  openalex: {
    names: ["OPENALEX_API_URL"],
    fallback: "https://api.openalex.org",
    description: "OpenAlex works",
  },
  gdelt: {
    names: ["GDELT_API_URL"],
    fallback: "https://api.gdeltproject.org",
    description: "GDELT document API",
  },
  hackernews: {
    names: ["HACKERNEWS_API_URL"],
    fallback: "https://hn.algolia.com/api/v1",
    description: "Hacker News search (Algolia)",
  },
  meshy: {
    names: ["MESHY_API_URL"],
    fallback: "https://api.meshy.ai",
    description: "Meshy image-to-3D",
  },

  /* ---- Persistence ---- */
  supabase: {
    names: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
    fallback: "",
    description: "Supabase project URL (no default — instance specific)",
  },
} as const satisfies Record<string, EndpointDefinition>;

export type EndpointId = keyof typeof ENDPOINTS;

/**
 * The resolved base URL for an endpoint, without a trailing slash.
 * Falls back to the value the code used before it was configurable,
 * so an unset variable is never an outage.
 */
/**
 * Endpoints that are PATHS UNDER a configurable root rather than hosts of
 * their own. `NASA_API_URL` moves the whole api.nasa.gov family at once
 * (a mirror, a cache, a rate-limit-friendly proxy); setting one of the
 * specific names still wins for that one. Without this the root would be
 * a setting that looks like it governs the family and governs nothing.
 */
const DERIVED_FROM_ROOT: Partial<Record<EndpointId, { root: EndpointId; path: string }>> = {
  nasaApod: { root: "nasa", path: "planetary/apod" },
  nasaNeo: { root: "nasa", path: "neo/rest/v1" },
  nasaDonki: { root: "nasa", path: "DONKI" },
  nasaEpic: { root: "nasa", path: "EPIC" },
  nasaInsight: { root: "nasa", path: "insight_weather" },
};

export function endpoint(id: EndpointId): string {
  const definition: EndpointDefinition = ENDPOINTS[id];
  for (const name of definition.names) {
    const configured = readRungs(name);
    if (configured) return withApiSuffix(normalize(configured), definition.apiSuffix);
  }

  const derived = DERIVED_FROM_ROOT[id];
  if (derived) {
    for (const rootName of ENDPOINTS[derived.root].names) {
      const configuredRoot = readRungs(rootName);
      if (configuredRoot) return `${normalize(configuredRoot)}/${derived.path}`;
    }
  }

  return withApiSuffix(normalize(definition.fallback), definition.apiSuffix);
}

/** Join an endpoint base with a path, tolerating a leading slash or not. */
export function endpointUrl(id: EndpointId, path = ""): string {
  const base = endpoint(id);
  if (!path) return base;
  return `${base}/${path.replace(/^\/+/, "")}`;
}

/** True when an operator has pointed this endpoint somewhere else. */
export function isOverridden(id: EndpointId): boolean {
  return endpoint(id) !== normalize(ENDPOINTS[id].fallback);
}

/**
 * Diagnostic snapshot. Base URLs are not credentials, so the resolved
 * value is shown — that is the point of the report: an operator needs
 * to see WHERE traffic is actually going, and `overridden` tells them
 * at a glance whether anything has been redirected away from default.
 */
export function endpointDiagnostics(): Array<{
  id: string;
  url: string;
  overridden: boolean;
  names: string[];
  description: string;
}> {
  return (Object.keys(ENDPOINTS) as EndpointId[]).map((id) => ({
    id,
    url: endpoint(id),
    overridden: isOverridden(id),
    names: [...ENDPOINTS[id].names],
    description: ENDPOINTS[id].description,
  }));
}

export default endpoint;
