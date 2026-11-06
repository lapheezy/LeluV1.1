/**
 * LÉLU source catalog + API discovery routes.
 *
 *   GET /api/sources/catalog?q=&category=&keyless=1
 *       The evaluated source inventory (src/core/apiEcosystem/SourceCatalog.ts).
 *       Static data, no outbound request.
 *
 *   GET /api/sources/discover?q=&category=&freeOpen=1&limit=
 *       Searches the public-apis catalog for candidate APIs.
 *
 * SAFETY (discover makes an outbound request, so it is gated):
 *   - Supabase-verified signed-in user, rate-limited (requestGuard);
 *   - the ONLY URL fetched is the fixed catalog address below, never one
 *     from the request, so this cannot be used as a proxy;
 *   - fetched through safeFetch (SSRF containment, byte cap, deadline);
 *   - cached for 24 h (and the failure cached for 10 min), so a burst of
 *     requests is one download per day, not one per request;
 *   - the README is parsed as untrusted table data (PublicApisParser).
 */

import { safeFetch, type SafeFetchOptions } from "./safeFetch.ts";
import { createGuard, sendRefusal, type Guard, type GuardRequest } from "./requestGuard.ts";
import { searchCatalog, SOURCE_CATALOG, type SourceAccess, type SourceDecision } from "../src/core/apiEcosystem/SourceCatalog.ts";
import { filterDiscovered, parsePublicApis, type DiscoveredApi } from "../src/core/apiEcosystem/PublicApisParser.ts";

export const PUBLIC_APIS_URL = "https://raw.githubusercontent.com/public-apis/public-apis/master/README.md";
const CACHE_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 10 * 60 * 1000;
const DISCOVER_LIMIT = { max: 20, windowMs: 60_000 };

interface Req { method?: string; url?: string }
interface Res { statusCode?: number; setHeader: (n: string, v: string) => void; end: (b: string) => void }
type Handler = (req: Req, res: Res, next: () => void) => void;

function sendJson(res: Res, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export interface SourceCatalogApiOptions {
  guard?: Guard;
  fetchOptions?: SafeFetchOptions;
  now?: () => number;
  /** Tests: replace the download (still parsed by the real parser). */
  download?: () => Promise<string>;
}

export function createSourceCatalogApi(options: SourceCatalogApiOptions = {}) {
  const guard = options.guard ?? createGuard();
  const now = options.now ?? (() => Date.now());
  const download = options.download ?? (async () => (await safeFetch(PUBLIC_APIS_URL, { maxBytes: 1_000_000, ...options.fetchOptions })).body);

  let cache: { at: number; apis: DiscoveredApi[] } | null = null;
  let failure: { at: number; reason: string } | null = null;
  let inflight: Promise<DiscoveredApi[]> | null = null;
  let downloads = 0;

  async function catalogApis(): Promise<{ apis: DiscoveredApi[]; fetchedAt: number; cached: boolean }> {
    const t = now();
    if (cache && t - cache.at < CACHE_MS) return { apis: cache.apis, fetchedAt: cache.at, cached: true };
    if (failure && t - failure.at < FAILURE_CACHE_MS) throw new Error(failure.reason);
    inflight ??= (async () => {
      downloads += 1;
      const apis = parsePublicApis(await download());
      if (apis.length === 0) throw new Error("The public-apis catalog parsed to zero entries (format changed?).");
      return apis;
    })();
    try {
      const apis = await inflight;
      cache = { at: now(), apis };
      failure = null;
      return { apis, fetchedAt: cache.at, cached: false };
    } catch (error) {
      failure = { at: now(), reason: error instanceof Error ? error.message : "catalog download failed" };
      throw new Error(failure.reason);
    } finally {
      inflight = null;
    }
  }

  const handle: Handler = (req, res, next) => {
    if ((req.method ?? "GET") !== "GET") return next();
    const url = new URL(req.url ?? "", "http://localhost");
    const path = url.pathname.startsWith("/api/sources") ? url.pathname.slice("/api/sources".length) || "/" : url.pathname;
    const q = url.searchParams.get("q")?.slice(0, 200) ?? "";
    const category = url.searchParams.get("category")?.slice(0, 80) || undefined;

    if (path === "/catalog") {
      const results = searchCatalog({
        text: q,
        category,
        access: (url.searchParams.get("access") as SourceAccess) || undefined,
        decision: (url.searchParams.get("decision") as SourceDecision) || undefined,
        keyless: url.searchParams.get("keyless") === "1",
      });
      sendJson(res, { ok: true, total: SOURCE_CATALOG.length, count: results.length, sources: results });
      return;
    }

    if (path === "/discover") {
      void (async () => {
        const decision = await guard.check(req as unknown as GuardRequest, "user", "source-discovery", DISCOVER_LIMIT);
        if (!decision.ok) return sendRefusal(res, decision);
        try {
          const { apis, fetchedAt, cached } = await catalogApis();
          const results = filterDiscovered(apis, {
            text: q,
            category,
            freeOpen: url.searchParams.get("freeOpen") === "1",
            limit: Number(url.searchParams.get("limit")) || undefined,
          });
          sendJson(res, {
            ok: true,
            source: PUBLIC_APIS_URL,
            fetchedAt: new Date(fetchedAt).toISOString(),
            cached,
            catalogSize: apis.length,
            count: results.length,
            results,
            note: "Candidates from a community catalog — unverified leads, not integrations.",
          });
        } catch (error) {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : "Discovery failed." }, 502);
        }
      })();
      return;
    }
    next();
  };

  return {
    handle,
    /** For tests and the status panel: how many times the catalog was actually downloaded. */
    downloadCount: () => downloads,
    attach(middlewares: { use: (path: string, handler: Handler) => void }) {
      // Connect (Vite) strips the mount prefix from req.url and server.ts does
      // not; `handle` accepts both forms, so req.url is never rewritten.
      middlewares.use("/api/sources", handle);
    },
  };
}
