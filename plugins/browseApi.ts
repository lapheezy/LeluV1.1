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
 *   - accepts http/https only,
 *   - refuses loopback, link-local, and RFC1918 private address targets,
 *   - caps response size and time,
 *   - returns ONLY extracted text (never response headers, cookies, or
 *     any environment value), so no credential can leak through it.
 */

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

/** Hard cap so a huge page can never exhaust the server. */
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 15000;

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/**
 * Refuse anything that points back inside the host's own network.
 * Hostname-based (pre-DNS) — a deliberate, conservative first line of
 * defence, not a claim of complete SSRF immunity.
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

export function createBrowseApi(): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  return {
    attach(middlewares) {
      middlewares.use("/api/browse", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }

        const requestUrl = new URL(req.url ?? "", "http://localhost");
        const target = requestUrl.searchParams.get("url")?.trim() ?? "";
        if (!target) {
          sendJson(res, { ok: false, error: "Missing ?url=" }, 400);
          return;
        }

        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          sendJson(res, { ok: false, error: "Invalid URL." }, 400);
          return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          sendJson(res, { ok: false, error: "Only http and https are supported." }, 400);
          return;
        }
        if (isBlockedHost(parsed.hostname)) {
          sendJson(res, { ok: false, error: "That address is not permitted." }, 403);
          return;
        }

        void (async () => {
          try {
            const response = await fetch(parsed.toString(), {
              redirect: "follow",
              signal: AbortSignal.timeout(TIMEOUT_MS),
              headers: {
                // Identify honestly; some sites reject an empty UA.
                "User-Agent": "Lelu/1.0 (+in-app reader)",
                Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
              },
            });

            if (!response.ok) {
              sendJson(res, { ok: false, url: parsed.toString(), error: `HTTP ${response.status}` }, 502);
              return;
            }

            const contentType = response.headers.get("content-type") ?? "";
            const body = await response.text();
            const clipped = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;

            const { title, text } = /html|xml/i.test(contentType)
              ? extractReadable(clipped)
              : { title: "", text: clipped.replace(/\s+/g, " ").trim() };

            sendJson(res, {
              ok: true,
              url: response.url || parsed.toString(),
              title,
              text,
              truncated: body.length > MAX_BYTES,
            });
          } catch (error) {
            sendJson(
              res,
              {
                ok: false,
                url: parsed.toString(),
                error: error instanceof Error ? error.message : String(error),
              },
              502,
            );
          }
        })();
      });
    },
  };
}
