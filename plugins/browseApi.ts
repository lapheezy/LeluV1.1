/**
 * LÉLU browse bridge.
 *
 * WHY THIS EXISTS
 * ---------------
 * BrowserTool.visit() fetches a page directly from the browser so LÉLU
 * can READ it, not merely display it in the iframe panel. From a browser
 * origin that fetch is subject to CORS, and essentially every real site
 * refuses it — verified live: example.com and en.wikipedia.org both
 * returned "Failed to fetch" and BrowserTool honestly reported `blocked`.
 * The result was that LÉLU could OPEN a page but never read one, so
 * browsed content never reached her cognition.
 *
 * This is the same server-side treatment rssApi already documents
 * ("fetched server-side so the canonical chat/research path does not
 * depend on browser CORS relays") — the pattern existed, the browser
 * tool just never used it. A server-side fetch has no CORS restriction,
 * so the page text can be extracted and handed back to the existing
 * BrowserTool → BrowserResolver → router → cognition path. No new
 * browser system, no second runtime.
 *
 * SAFETY
 * ------
 * A server-side URL fetcher is an SSRF vector, so this endpoint:
 *   - requires a Supabase-verified signed-in user, rate-limited per user
 *     (plugins/requestGuard.ts) — it is not an open proxy;
 *   - fetches through plugins/safeFetch.ts: resolved addresses checked
 *     (IPv4/IPv6, private/loopback/link-local/reserved), the socket pinned
 *     to the checked address, every redirect re-checked, at most 5, loops
 *     refused, the body streamed and cut off at 2 MB (raw and decoded);
 *   - returns ONLY extracted text (never response headers, cookies, or
 *     any environment value), so no credential can leak through it.
 */

import { safeFetch, SafeFetchError, type SafeFetchOptions } from "./safeFetch.ts";
import { createGuard, sendRefusal, type Guard, type GuardRequest } from "./requestGuard.ts";

interface ConnectLikeReq {
  method?: string;
  url?: string;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;


function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/**
 * Refuse anything that points back inside the host's own network.
 * Hostname-based (pre-DNS). Kept for selfViewApi's own checks; the browse
 * relay itself uses safeFetch, which also checks resolved addresses.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  // IPv6 loopback / unique-local / link-local
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;            // loopback / private / this-network
    if (a === 169 && b === 254) return true;                       // link-local (cloud metadata)
    if (a === 192 && b === 168) return true;                       // private
    if (a === 172 && b >= 16 && b <= 31) return true;              // private
  }
  return false;
}

/** Strip markup to readable text — same shape BrowserTool expects. */
export function extractReadable(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/gi, (entity) =>
      ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" }[
        entity.toLowerCase()
      ] ?? entity),
    )
    .replace(/\s+/g, " ")
    .trim();

  return { title, text };
}

export interface BrowseApiOptions {
  /** Identity + rate gate. Default: Supabase-verified identity (plugins/requestGuard). */
  guard?: Guard;
  /** Passed to safeFetch (tests inject a resolver and a fixture dialler). */
  fetchOptions?: SafeFetchOptions;
}

const BROWSE_LIMIT = { max: 30, windowMs: 60_000 };

export function createBrowseApi(options: BrowseApiOptions = {}): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
  handle: Handler;
} {
  const guard = options.guard ?? createGuard();
  const handle: Handler = (req, res, next) => {
    if ((req.method ?? "GET") !== "GET") {
      next();
      return;
    }
    const requestUrl = new URL(req.url ?? "", "http://localhost");
    const target = requestUrl.searchParams.get("url")?.trim() ?? "";
    void (async () => {
      // Who is asking comes first: an anonymous caller learns nothing,
      // not even whether the URL would have been allowed.
      const decision = await guard.check(req as unknown as GuardRequest, "user", "browse", BROWSE_LIMIT);
      if (!decision.ok) {
        sendRefusal(res, decision);
        return;
      }
      if (!target) {
        sendJson(res, { ok: false, error: "Missing ?url=" }, 400);
        return;
      }
      try {
        const page = await safeFetch(target, options.fetchOptions);
        const { title, text } = /html|xml/i.test(page.contentType)
          ? extractReadable(page.body)
          : { title: "", text: page.body.replace(/\s+/g, " ").trim() };
        sendJson(res, { ok: true, url: page.url, title, text, truncated: page.truncated, redirects: page.redirects.length });
      } catch (error) {
        if (error instanceof SafeFetchError) {
          const status = error.code === "blocked_address" || error.code === "port_not_allowed" ? 403
            : error.code === "invalid_url" || error.code === "unsupported_protocol" ? 400
            : error.code === "unsupported_content" ? 415
            : error.code === "timeout" ? 504
            : 502;
          sendJson(res, { ok: false, url: target, code: error.code, error: error.message }, status);
          return;
        }
        // Never echo an internal error message: it can name hosts or paths.
        sendJson(res, { ok: false, url: target, error: "The page could not be read." }, 502);
      }
    })();
  };
  return {
    handle,
    attach(middlewares) {
      middlewares.use("/api/browse", handle);
    },
  };
}
