/**
 * ==========================================================
 * LÉLU — AI CREDENTIAL RELAY (shared middleware)
 *
 * WHY THIS EXISTS
 * ---------------
 * Every chat provider read its key from `import.meta.env.VITE_*`.
 * Vite inlines those at build time, so the keys were compiled
 * verbatim into the client bundle. Measured, not assumed: building
 * with canary values put both keys in 11 separate chunks of
 * `dist/assets/` (GroqProvider, OpenRouterProvider, ProviderConfig
 * and, through shared imports, VoiceEngine, Environment, speech,
 * push, …). Anyone loading the page could read them.
 *
 * That violates the project's own rule — no secrets in frontend
 * bundles — so the credential moves to the server.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT a second provider system, router, or fallback chain.
 * Provider selection, priority, retry, streaming and response
 * parsing all stay exactly where they already live, in
 * `src/providers/*` behind AIProviderRegistry/ProviderResolver.
 * Only two things move server-side: the API key, and the decision
 * of which upstream origin a provider id may talk to.
 *
 * It is also not a new pattern. `server.ts` already proxied GitHub
 * Models this way (`/api/ai` → models.inference.ai.azure.com with a
 * server-side Authorization header), and `aisBridgePlugin` does the
 * same for AISStream. This generalizes that one-provider proxy to
 * the whole chat fallback chain and mounts it in every runtime, the
 * way `engineerApi` is mounted.
 *
 * ENDPOINTS
 * ---------
 *   GET  /api/ai/providers  → { groq: { configured: true }, … }
 *                             BOOLEANS ONLY — never a key value,
 *                             never a prefix, never a length.
 *   POST /api/ai/relay      → { provider, path, body } forwarded to
 *                             the allowlisted upstream with the
 *                             server's Authorization header. The
 *                             upstream status and body (including an
 *                             SSE stream) are returned verbatim so
 *                             the existing provider code parses them
 *                             completely unchanged.
 *
 * SAFETY
 * ------
 *   • provider allowlist — an unknown id is refused; the browser can
 *     never name an arbitrary origin, so this is not an open proxy.
 *   • path allowlist — the path must sit under the provider's own
 *     prefix, so the relay cannot be walked onto another API on the
 *     same host.
 *   • header allowlist — only non-secret headers are forwarded
 *     upstream; a client-supplied Authorization is DROPPED, never
 *     honoured and never echoed.
 *   • origin guard — cross-origin POSTs are rejected (CSRF), the
 *     same stance engineerApi takes.
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

interface UpstreamProvider {
  /** Exact origin this provider id may reach — nothing else. */
  origin: string;
  /** Every relayed path must start with this. */
  pathPrefix: string;
  /**
   * Env vars holding the key, in order. The unprefixed name is the
   * correct one (server-only); the VITE_ name is accepted so an
   * existing local .env keeps working during the transition.
   */
  keyVars: string[];
  /** How the key is presented upstream. */
  auth: (key: string) => Record<string, string>;
}

const PROVIDERS: Record<string, UpstreamProvider> = {
  anthropic: {
    origin: "https://api.anthropic.com",
    pathPrefix: "/v1/",
    // Deliberately NOT a bare `API_KEY`: that name is generic, and in a
    // Claude Code environment it holds the AGENT's own Anthropic
    // credential. Adopting it would spend someone else's quota and make
    // this provider report itself configured when nothing was ever set
    // for LÉLU — the same trap githubmodels documents below.
    keyVars: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "VITE_ANTHROPIC_API_KEY"],
    // The Messages API authenticates with x-api-key, not a bearer token,
    // and requires a pinned version header on every request.
    auth: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  groq: {
    origin: "https://api.groq.com",
    pathPrefix: "/openai/v1/",
    keyVars: ["GROQ_API_KEY", "VITE_GROQ_API_KEY"],
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  openrouter: {
    origin: "https://openrouter.ai",
    pathPrefix: "/api/v1/",
    keyVars: ["OPENROUTER_API_KEY", "VITE_OPENROUTER_API_KEY"],
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  cerebras: {
    origin: "https://api.cerebras.ai",
    pathPrefix: "/v1/",
    keyVars: ["CEREBRAS_API_KEY", "VITE_CEREBRAS_API_KEY"],
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mistral: {
    origin: "https://api.mistral.ai",
    pathPrefix: "/v1/",
    keyVars: ["MISTRAL_API_KEY", "VITE_MISTRAL_API_KEY"],
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  fireworks: {
    origin: "https://api.fireworks.ai",
    pathPrefix: "/inference/v1/",
    keyVars: ["FIREWORKS_API_KEY", "VITE_FIREWORKS_API_KEY"],
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  githubmodels: {
    origin: "https://models.github.ai",
    pathPrefix: "/inference/",
    // Deliberately NOT `GITHUB_TOKEN` / `GITHUB_CODESPACE_TOKEN`: dev
    // containers, Codespaces and CI runners set those for git tooling,
    // and adopting one makes this provider falsely report "configured"
    // (and would spend a repo-scoped token against an unrelated
    // inference API) wherever LÉLU happens to run. Verified live: with
    // only the harness's ambient GITHUB_TOKEN present, /api/ai/providers
    // reported githubmodels configured:true with nothing ever set for
    // it. GitHubModelsProvider already refuses those names for exactly
    // this reason; the server side must match. Only the two explicit,
    // documented channels count (see ENV_VARS.md).
    keyVars: ["GITHUB_MODELS_TOKEN", "VITE_GITHUB_TOKEN"],
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

/**
 * Knowledge/research providers the browser used to call directly with a
 * `VITE_`-prefixed key — so those keys shipped in the bundle too. Same
 * mechanism as the chat relay, but these are GET APIs that take their
 * credential as a query parameter rather than a bearer header.
 */
interface UpstreamKnowledgeProvider {
  origin: string;
  pathPrefix: string;
  keyVars: string[];
  /** Query parameter the upstream expects the credential in. */
  queryParam: string;
}

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
};

/** Non-secret headers a provider may ask the relay to pass upstream. */
const FORWARDABLE_HEADERS = new Set([
  "content-type",
  "accept",
  "http-referer",
  "x-title",
  // Anthropic pins its wire format per request; the header is a version
  // string, not a credential. The server sets it too, so a caller can
  // only ever restate the same value.
  "anthropic-version",
]);

const MAX_BODY_BYTES = 1_000_000;
const TIMEOUT_MS = 60_000;

export function providerIds(): string[] {
  return Object.keys(PROVIDERS);
}

/** The key for a provider id, or "" — never logged, never returned. */
function resolveKey(env: EnvReader, id: string): string {
  const entry = PROVIDERS[id];
  if (!entry) return "";
  return firstSetVar(env, entry.keyVars);
}

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

function header(req: ConnectLikeReq, name: string): string {
  const value = req.headers?.[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * Reject a state-changing request that did not come from this app.
 * Same CSRF stance as engineerApi: a missing Origin (curl, a native
 * shell, a verification script) is allowed; a DIFFERENT origin is not.
 */
function crossOrigin(req: ConnectLikeReq): boolean {
  const origin = header(req, "origin");
  if (!origin) return false;
  const host = header(req, "host");
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function readBodyBytes(req: ConnectLikeReq): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk) => {
      const part = chunk as Uint8Array;
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(part);
    });
    req.on("end", () => {
      const total = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        total.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(total);
    });
    req.on("error", (error) => reject(error as Error));
  });
}

async function readBody(req: ConnectLikeReq): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(req));
}

/** Shared guard for both relay routes. Returns an error tuple, or the key. */
function authorizeRelay(
  env: EnvReader,
  id: string,
  path: string,
): { ok: true; entry: UpstreamProvider; key: string } | { ok: false; status: number; error: string } {
  const entry = PROVIDERS[id];
  if (!entry) {
    return { ok: false, status: 400, error: `Unknown provider "${id}".` };
  }
  if (!path.startsWith(entry.pathPrefix) || path.includes("..")) {
    return { ok: false, status: 400, error: `Path is not permitted for provider "${id}".` };
  }
  const key = resolveKey(env, id);
  if (!key) {
    // Honest, specific, and secret-free: the caller learns the provider
    // is unconfigured, never anything about the key.
    return { ok: false, status: 503, error: `No server-side credential configured for "${id}".` };
  }
  return { ok: true, entry, key };
}

/** Pass an upstream response back verbatim, streaming when it streams. */
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
  const entries = [
    ...Object.values(PROVIDERS).map((entry) => entry.keyVars),
    ...Object.values(KNOWLEDGE_PROVIDERS).map((entry) => entry.keyVars),
  ];
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
      middlewares.use("/api/ai/providers", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }
        const providers: Record<string, { configured: boolean }> = {};
        for (const id of Object.keys(PROVIDERS)) {
          // Deliberately a boolean. Not the value, not a prefix, not a
          // length — nothing an attacker could use to narrow a key.
          providers[id] = { configured: resolveKey(env, id).length > 0 };
        }
        const knowledge: Record<string, { configured: boolean }> = {};
        for (const [id, entry] of Object.entries(KNOWLEDGE_PROVIDERS)) {
          knowledge[id] = { configured: firstSetVar(env, entry.keyVars).length > 0 };
        }
        sendJson(res, { ok: true, providers, knowledge });
      });

      // ---- knowledge relay (GET, key as a query parameter) ----------
      // NewsAPI and the YouTube Data API were called straight from the
      // browser with a VITE_-prefixed key, so those keys shipped in the
      // bundle exactly like the chat keys did. Same fix, same allowlist
      // discipline; only the credential's position differs (a query
      // parameter rather than a bearer header).
      middlewares.use("/api/knowledge/relay", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
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

          // The client sends the upstream path AND its query string as one
          // encoded value; the credential is added here and only here.
          const rawPath = query.get("path") ?? "";
          if (!rawPath.startsWith(entry.pathPrefix) || rawPath.includes("..")) {
            sendJson(res, { ok: false, error: `Path is not permitted for provider "${id}".` }, 400);
            return;
          }

          const key = firstSetVar(env, entry.keyVars);
          if (!key) {
            sendJson(res, { ok: false, error: `No server-side credential configured for "${id}".` }, 503);
            return;
          }

          try {
            const target = new URL(`${entry.origin}${rawPath}`);
            // A caller-supplied credential parameter is overwritten, never
            // honoured — the server's key is the only one that goes out.
            target.searchParams.set(entry.queryParam, key);
            const upstream = await fetch(target.toString(), {
              method: "GET",
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            await pipeUpstream(res, upstream);
          } catch (error) {
            sendJson(
              res,
              { ok: false, error: error instanceof Error ? error.message : String(error) },
              502,
            );
          }
        })();
      });

      // ---- raw/binary relay -----------------------------------------
      // Speech-to-text posts multipart audio, which cannot survive a JSON
      // envelope. This forwards the request body byte-for-byte with its
      // own content-type and the server's credential. It is the SAME
      // allowlist and the same guards — only the body encoding differs,
      // so voice stops needing a browser-side Groq key.
      middlewares.use("/api/ai/relay-raw", (req, res, next) => {
        if ((req.method ?? "GET") !== "POST") {
          next();
          return;
        }
        if (crossOrigin(req)) {
          sendJson(res, { ok: false, error: "Cross-origin relay requests are refused." }, 403);
          return;
        }

        void (async () => {
          const query = new URL(req.url ?? "", "http://localhost").searchParams;
          const id = (query.get("provider") ?? "").toLowerCase();
          const path = query.get("path") ?? "";
          const authorized = authorizeRelay(env, id, path);
          if (!authorized.ok) {
            sendJson(res, { ok: false, error: authorized.error }, authorized.status);
            return;
          }
          const { entry, key } = authorized;

          try {
            const body = await readBodyBytes(req);
            const contentType = header(req, "content-type");
            const upstream = await fetch(`${entry.origin}${path}`, {
              method: "POST",
              headers: {
                // The multipart boundary lives in the content-type, so it
                // must be forwarded exactly as the browser wrote it.
                ...(contentType ? { "Content-Type": contentType } : {}),
                ...entry.auth(key),
              },
              body,
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            await pipeUpstream(res, upstream);
          } catch (error) {
            sendJson(
              res,
              { ok: false, error: error instanceof Error ? error.message : String(error) },
              502,
            );
          }
        })();
      });

      // ---- the relay itself -----------------------------------------
      middlewares.use("/api/ai/relay", (req, res, next) => {
        if ((req.method ?? "GET") !== "POST") {
          next();
          return;
        }
        if (crossOrigin(req)) {
          sendJson(res, { ok: false, error: "Cross-origin relay requests are refused." }, 403);
          return;
        }

        void (async () => {
          let payload: { provider?: string; path?: string; headers?: Record<string, string>; body?: unknown };
          try {
            payload = JSON.parse(await readBody(req)) as typeof payload;
          } catch (error) {
            sendJson(res, { ok: false, error: error instanceof Error ? error.message : "Invalid JSON body." }, 400);
            return;
          }

          const id = String(payload.provider ?? "").toLowerCase();
          const path = String(payload.path ?? "");
          const authorized = authorizeRelay(env, id, path);
          if (!authorized.ok) {
            sendJson(res, { ok: false, error: authorized.error }, authorized.status);
            return;
          }
          const { entry, key } = authorized;

          // Only allowlisted, non-secret headers survive. A caller-supplied
          // Authorization is dropped here — the server's own key is the
          // only credential that ever reaches the upstream.
          const forwarded: Record<string, string> = {};
          for (const [name, value] of Object.entries(payload.headers ?? {})) {
            if (FORWARDABLE_HEADERS.has(name.toLowerCase()) && typeof value === "string") {
              forwarded[name] = value;
            }
          }

          try {
            const upstream = await fetch(`${entry.origin}${path}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...forwarded,
                ...entry.auth(key),
              },
              body: JSON.stringify(payload.body ?? {}),
              signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            await pipeUpstream(res, upstream);
          } catch (error) {
            sendJson(
              res,
              {
                ok: false,
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
