import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "hono/deno";
import { createEngineerApi } from "./plugins/engineerApi.ts";
import { createDenoEngineerAdapter } from "./plugins/denoAdapters.ts";
import { createEnvApi } from "./plugins/envApi.ts";
import { createAisBridge } from "./plugins/aisBridgePlugin.ts";
import { loadEnvFiles } from "./plugins/loadEnvFiles.ts";
import { createInstagramApi } from "./plugins/instagramApi.ts";
import { createRssApi } from "./plugins/rssApi.ts";
import { createBrowseApi } from "./plugins/browseApi.ts";
import { createNekoApi } from "./plugins/nekoApi.ts";

/**
 * LÉLU — Deno production server entry.
 *
 * Serves the built app AND the full application runtime:
 *
 *   POST /api/engineer/command|read|write  (engineering runtime,
 *        whitelisted + workspace-bounded — same code as Vite/Node)
 *   GET  /api/engineer/status
 *   GET  /api/ais/status | /api/ais/vessels (server-side AISStream key)
 *   GET  /api/env-check | /api/provider-health
 *   static dist/ + SPA fallback
 *
 * This makes the server-backed deployment runtime capable of LÉLU's
 * engineering/self-development workflow — not a static dead end.
 */

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on?: (event: "data" | "end" | "error", fn: (chunk?: unknown) => void) => void;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

type ConnectHandler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

const apiMiddlewares: { path: string; handler: ConnectHandler }[] = [];

function use(path: string, handler: ConnectHandler): void {
  apiMiddlewares.push({ path, handler });
}

// Load the project's existing environment files (.env.local overrides
// .env; platform-injected Deno.env always wins) before anything reads
// env, so this runtime reports the same provider state as Vite dev.
const mergedEnv = new Map<string, string>();
loadEnvFiles(
  {
    get: (key) => mergedEnv.get(key) ?? Deno.env.get(key),
    set: (key, value) => {
      mergedEnv.set(key, value);
    },
  },
  [
    "VITE_FIRMS_API_KEY",
    "AISSTREAM_API_KEY",
    "INSTAGRAM_ACCESS_TOKEN",
    "INSTAGRAM_USER_ID",
    "INSTAGRAM_API_VERSION",
    "VITE_SAPIOLINGO_RSS_URL",
    "VITE_ELPHERU_RSS_URL",
    "VITE_GOOGLE_NEWS_RSS_URL",
    "VITE_GOOGLE_NEWS_RSS_URL_2",
    "VITE_GOOGLE_NEWS_TEMPLATE",
    "VITE_NEKO_URL",
    "NEKO_URL",
  ],
);
const envGet = (key: string): string => mergedEnv.get(key) ?? Deno.env.get(key) ?? "";

const aisBridge = createAisBridge({ apiKey: envGet("AISSTREAM_API_KEY") });
const instagramApi = createInstagramApi(envGet);
const rssApi = createRssApi(envGet);
const nekoApi = createNekoApi(envGet);

createEngineerApi(createDenoEngineerAdapter("deno")).attach({ use });
createEnvApi((key) => envGet(key), "deno", { aisStatus: () => aisBridge.getStatus() }).attach({ use });
aisBridge.attach({ use });
instagramApi.attach({ use });
rssApi.attach({ use });
createBrowseApi().attach({ use });
nekoApi.attach({ use });

/** Adapt a connect-style (req, res, next) handler to a Hono fetch handler. */
function connectToFetch(handler: ConnectHandler) {
  return async (c: Context): Promise<Response> => {
    const request = c.req.raw;
    const url = new URL(request.url);
    let bodyPromise: Promise<string> | null = null;
    const body = () => (bodyPromise ??= request.text());
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const fakeReq = {
      method: request.method,
      url: url.pathname + url.search,
      headers,
      on(event: string, fn: (chunk?: unknown) => void): void {
        if (event === "data") {
          void body().then((value) => {
            if (value) fn(value);
          });
        }
        if (event === "end") {
          void body().then(() => fn());
        }
      },
    };
    let resolved = false;
    return await new Promise<Response>((resolve) => {
      const outHeaders = new Headers();
      const fakeRes = {
        statusCode: 200,
        setHeader(name: string, value: string): void {
          outHeaders.set(name, value);
        },
        end(payload: string): void {
          if (resolved) return;
          resolved = true;
          resolve(new Response(payload, { status: fakeRes.statusCode, headers: outHeaders }));
        },
      };
      handler(fakeReq, fakeRes, () => {
        if (resolved) return;
        resolved = true;
        resolve(c.notFound());
      });
    });
  };
}

const app = new Hono();

// API routes first — before the static fallbacks.
for (const entry of apiMiddlewares) {
  app.all(`${entry.path}*`, connectToFetch(entry.handler));
}

// 1) Serve anything in /assets/**
app.use("/assets/*", serveStatic({ root: "./dist/assets" }));

// 2) Catch *all* other files in dist (CSS, JS, images, etc.)
app.use("*", serveStatic({ root: "./dist" }));

// 3) Fallback to index.html for the SPA
app.get("*", serveStatic({ path: "./dist/index.html" }));

const PORT = Number(Deno.env.get("PORT") || 8000);
const HOSTNAME = Deno.env.get("HOST") || "0.0.0.0";

Deno.serve({ port: PORT, hostname: HOSTNAME }, app.fetch);
