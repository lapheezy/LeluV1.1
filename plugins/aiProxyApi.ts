/**
 * ==========================================================
 * LÉLU — KNOWLEDGE CREDENTIAL RELAY (shared middleware)
 *
 * WHY THIS EXISTS
 * ---------------
 * NewsAPI and the YouTube Data API read their key from
 * `import.meta.env.VITE_*`. Vite inlines those at build time, so the
 * keys were compiled verbatim into the client bundle and anyone
 * loading the page could read them. That violates the project's own
 * rule — no secrets in frontend bundles — so the credential moves to
 * the server.
 *
 * These two take the key as a QUERY PARAMETER rather than a header,
 * which is why they have a relay of their own shape.
 *
 * WHAT THIS USED TO BE
 * --------------------
 * This middleware also fronted every AI MODEL provider, via
 * `POST /api/ai/relay`, `POST /api/ai/relay-raw` and
 * `GET /api/ai/providers` — a second server-owned credential
 * mechanism beside the model broker in `plugins/modelApi.ts`, with
 * its own provider allowlist, its own status endpoint and its own
 * provider-id spelling. Two mechanisms for one responsibility meant
 * two places to register the next provider and one of them to
 * forget; the id vocabularies had already drifted.
 *
 * Model traffic — chat, tools, streaming AND audio — now goes
 * through the broker only, which carries the guards this relay had
 * (origin, path, body size, timeout). Do not add a model provider
 * back to this file.
 *
 * ENDPOINTS
 * ---------
 *   GET /api/knowledge/providers → { news: { configured: true }, … }
 *                                  BOOLEANS ONLY — never a key value,
 *                                  never a prefix, never a length.
 *   GET /api/knowledge/relay     → ?provider=&path= forwarded to the
 *                                  allowlisted upstream with the
 *                                  server's key appended. The upstream
 *                                  status and body are returned
 *                                  verbatim.
 *   POST /api/knowledge/relay    → the same, with a JSON body, for a
 *                                  provider marked allowPost (Meshy,
 *                                  whose key goes as a Bearer header).
 *                                  Same-origin only; body capped.
 *
 * SAFETY
 * ------
 *   • provider allowlist — an unknown id is refused; the browser can
 *     never name an arbitrary origin, so this is not an open proxy.
 *   • path allowlist — the path must sit under the provider's own
 *     prefix, so the relay cannot be walked onto another API on the
 *     same host.
 *   • the key is never logged, never returned, and never included in
 *     an error message.
 * ==========================================================
 */

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on: (event: string, handler: (chunk?: unknown) => void) => void;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  write: (chunk: Uint8Array | string) => void;
  end: (body?: string) => void;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

/** Reads one env var by name; supplied by each runtime. */
export type EnvReader = (key: string) => string | undefined;

interface UpstreamKnowledgeProvider {
  origin: string;
  pathPrefix: string;
  keyVars: string[];
  /** Query parameter the upstream expects the credential in. */
  queryParam?: string;
  /** Send the credential as `Authorization: Bearer …` instead. */
  bearer?: true;
  /** Env var that may point the provider at another base URL. */
  originVar?: string;
  /** Also relay POST (JSON body, bounded, same-origin only). */
  allowPost?: true;
}

/** Largest POST body relayed — an image-to-3D request carries the image as a data URI. */
const MAX_POST_BYTES = 20 * 1024 * 1024;

const KNOWLEDGE_PROVIDERS: Record<string, UpstreamKnowledgeProvider> = {
  news: {
    origin: "https://newsapi.org",
    pathPrefix: "/v2/",
    keyVars: ["NEWS_API_KEY", "VITE_NEWS_API_KEY"],
    queryParam: "apiKey",
  },
  youtube: {
    origin: "https://www.googleapis.com",
    pathPrefix: "/youtube/v3/",
    keyVars: ["YOUTUBE_API_KEY", "VITE_YOUTUBE_API_KEY"],
    queryParam: "key",
  },
  // Meshy is a PAID API (image → 3-D avatar). Its key was read in the
  // browser from VITE_MESHY_API_KEY, so any build made with it set
  // shipped a spendable credential to every visitor (verify-bundle-
  // secrets reported it "SHIPPED in 1 file"). It now stays here.
  meshy: {
    origin: "https://api.meshy.ai",
    originVar: "MESHY_API_URL",
    pathPrefix: "/openapi/v1/image-to-3d",
    keyVars: ["MESHY_API_KEY", "VITE_MESHY_API_KEY"],
    bearer: true,
    allowPost: true,
  },
};

/** A POST from another site must not spend this server's paid credential. */
function isCrossOrigin(req: ConnectLikeReq): boolean {
  const headers = req.headers ?? {};
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  const host = typeof headers.host === "string" ? headers.host : "";
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function readBody(req: ConnectLikeReq, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    req.on("data", (chunk) => {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true });
      size += text.length;
      if (size > limit) {
        reject(new Error(`Request body exceeds ${limit} bytes.`));
        return;
      }
      chunks.push(text);
    });
    req.on("end", () => resolve(chunks.join("")));
    req.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}

/** Non-secret headers a provider may ask the relay to pass upstream. */
const TIMEOUT_MS = 60_000;

function firstSetVar(env: EnvReader, keyVars: string[]): string {
  for (const name of keyVars) {
    const value = env(name);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function pipeUpstream(res: ConnectLikeRes, upstream: Response): Promise<void> {
  // Status and body pass through untouched so the existing provider code
  // sees exactly what a direct call would return — including an error
  // status, which is what drives the real fallback in ProviderResolver.
  res.statusCode = upstream.status;
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");

  if (!upstream.body) {
    res.end(await upstream.text());
    return;
  }

  // Chunk by chunk: SSE token streaming has to stay progressive or
  // `stream: true` would silently degrade into one late blob.
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(value);
  }
  res.end();
}

/**
 * Warn about any credential still stored under a `VITE_` name.
 *
 * The relay accepts the `VITE_` spelling so an existing `.env` keeps
 * working, but that spelling is not safe: Vite's DEV server serves the
 * entire `import.meta.env` record to the browser for every `VITE_`
 * variable, no matter what application code reads. Verified in a real
 * browser — a production build served 726 scripts with zero key-shaped
 * literals, while `vite dev` handed the same keys straight to the page.
 *
 * So the production bundle is clean either way, but a `VITE_`-named
 * secret is still exposed to anyone who can reach the dev server. The
 * only complete fix is the rename, and this makes that impossible to
 * miss. Names only — never a value, never a length.
 */
function warnAboutPrefixedCredentials(env: EnvReader): void {
  const exposed: string[] = [];
  // Knowledge providers only. The model broker warns about its own
  // credential names, which it owns (plugins/modelApi.ts).
  const entries = Object.values(KNOWLEDGE_PROVIDERS).map((entry) => entry.keyVars);
  for (const keyVars of entries) {
    for (const name of keyVars) {
      if (!name.startsWith("VITE_")) continue;
      const value = env(name);
      if (typeof value === "string" && value.trim().length > 0) {
        exposed.push(name);
      }
    }
  }
  if (exposed.length === 0) return;
  console.warn(
    `[LÉLU] ${exposed.length} credential(s) are stored under a VITE_ prefix: ` +
      `${[...new Set(exposed)].sort().join(", ")}.\n` +
      "        These still work — the relay reads them server-side — but Vite's DEV\n" +
      "        server exposes every VITE_ variable to the browser, so they are\n" +
      "        readable by anyone who can reach it. Rename them to their unprefixed\n" +
      "        server-side names (see ENV_VARS.md) and rotate the old values.",
  );
}

export function createAiProxyApi(env: EnvReader): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  warnAboutPrefixedCredentials(env);
  return {
    attach(middlewares) {
      // ---- capability report: booleans only -------------------------
      // Knowledge providers only. Model-provider status is served by the
      // broker at GET /api/model/status, which is the single authority for
      // what the server can reach; reporting it from here as well gave two
      // answers to one question and they had already drifted.
      middlewares.use("/api/knowledge/providers", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }
        const knowledge: Record<string, { configured: boolean }> = {};
        for (const [id, entry] of Object.entries(KNOWLEDGE_PROVIDERS)) {
          // Deliberately a boolean. Not the value, not a prefix, not a
          // length — nothing an attacker could use to narrow a key.
          knowledge[id] = { configured: firstSetVar(env, entry.keyVars).length > 0 };
        }
        sendJson(res, { ok: true, knowledge });
      });

      // ---- knowledge relay (GET, key as a query parameter) ----------
      // NewsAPI and the YouTube Data API were called straight from the
      // browser with a VITE_-prefixed key, so those keys shipped in the
      // bundle exactly like the chat keys did. Same fix, same allowlist
      // discipline; only the credential's position differs (a query
      // parameter rather than a bearer header).
      middlewares.use("/api/knowledge/relay", (req, res, next) => {
        const method = (req.method ?? "GET").toUpperCase();
        if (method !== "GET" && method !== "POST") {
          next();
          return;
        }

        void (async () => {
          const query = new URL(req.url ?? "", "http://localhost").searchParams;
          const id = (query.get("provider") ?? "").toLowerCase();
          const entry = KNOWLEDGE_PROVIDERS[id];
          if (!entry) {
            sendJson(res, { ok: false, error: `Unknown knowledge provider "${id}".` }, 400);
            return;
          }
          if (method === "POST" && !entry.allowPost) {
            sendJson(res, { ok: false, error: `POST is not relayed for provider "${id}".` }, 405);
            return;
          }
          if (method === "POST" && isCrossOrigin(req)) {
            sendJson(res, { ok: false, error: "Cross-origin requests may not use this server's credentials." }, 403);
            return;
          }

          // The client sends the upstream path AND its query string as one
          // encoded value; the credential is added here and only here.
          const rawPath = query.get("path") ?? "";
          // A prefix without a trailing slash is a whole segment:
          // "/openapi/v1/image-to-3d" admits "/…/image-to-3d/<id>", not
          // "/…/image-to-3d-anything-else".
          const after = rawPath.charAt(entry.pathPrefix.length);
          const segmentEnds = entry.pathPrefix.endsWith("/") || after === "" || after === "/" || after === "?";
          if (!rawPath.startsWith(entry.pathPrefix) || !segmentEnds || rawPath.includes("..")) {
            sendJson(res, { ok: false, error: `Path is not permitted for provider "${id}".` }, 400);
            return;
          }

          const key = firstSetVar(env, entry.keyVars);
          if (!key) {
            sendJson(res, { ok: false, error: `No server-side credential configured for "${id}".` }, 503);
            return;
          }

          try {
            const origin = ((entry.originVar && env(entry.originVar)?.trim()) || entry.origin).replace(/\/+$/, "");
            const target = new URL(`${origin}${rawPath}`);
            const headers: Record<string, string> = { Accept: "application/json" };
            // A caller-supplied credential is overwritten, never honoured —
            // the server's key is the only one that goes out.
            if (entry.bearer) {
              target.searchParams.delete("key");
              headers.Authorization = `Bearer ${key}`;
            } else if (entry.queryParam) {
              target.searchParams.set(entry.queryParam, key);
            }
            let body: string | undefined;
            if (method === "POST") {
              body = await readBody(req, MAX_POST_BYTES);
              headers["Content-Type"] = "application/json";
            }
            const upstream = await fetch(target.toString(), {
              method,
              headers,
              ...(body !== undefined ? { body } : {}),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            await pipeUpstream(res, upstream);
          } catch (error) {
            sendJson(
              res,
              { ok: false, error: error instanceof Error ? error.message : String(error) },
              error instanceof Error && error.message.startsWith("Request body exceeds") ? 413 : 502,
            );
          }
        })();
      });

      // ---- raw/binary relay -----------------------------------------
    },
  };
}
