/**
 * ==========================================================
 * LÉLU — DATA-API KEYS STAY ON THE SERVER
 *
 * CATEGORY: unit. No network: fetch is stubbed and the relay
 * middleware is driven directly.
 *
 * Security incident found in Session 2 Phase 6: the runtime key bridge
 * published NASA, Geoapify, GNews, Guardian and NewsData keys into every
 * served page (dev server and production server.ts), and publicEnv
 * statically read VITE_ copies of Guardian/GNews/NewsData/FIRMS, which a
 * production build inlines. They now go through the knowledge relay,
 * which appends the key server-side.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bridgeScriptBody } from "../plugins/runtimeKeyBridge";
import { createAiProxyApi } from "../plugins/aiProxyApi";

const CANARIES: Record<string, string> = {
  NASA_API_KEY: "CANARY_nasa_relay",
  GEOAPIFY_API_KEY: "CANARY_geo_relay",
  GNEWS_API_KEY: "CANARY_gnews_relay",
  GUARDIAN_API_KEY: "CANARY_guardian_relay",
  NEWSDATA_API_KEY: "CANARY_newsdata_relay",
  FIRMS_API_KEY: "CANARY_firms_relay",
};

test("the runtime key bridge publishes none of the data-API keys into the page", () => {
  const body = bridgeScriptBody((name) => CANARIES[name]);
  for (const [name, value] of Object.entries(CANARIES)) {
    assert.ok(!body.includes(value), `${name} must not be written into the served HTML`);
  }
});

test("no browser module reads a VITE_ copy of these keys (a static read is inlined by the build)", () => {
  for (const file of ["src/core/env/publicEnv.ts", "src/core/earth/EarthProviders.ts", "src/providers/GeoapifyProvider.ts", "src/providers/NASAScienceProviders.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /import\.meta\.env\.VITE_(GUARDIAN|GNEWS|NEWSDATA|FIRMS|NASA|GEOAPIFY)_API_KEY/, file);
  }
  assert.doesNotMatch(readFileSync("src/providers/NASAScienceProviders.ts", "utf8"), /archive\/natural[^\n]*api_key/, "EPIC result links carry no key");
});

type Captured = { url: string; status: number; body: string; headers: Record<string, string> };

async function relay(env: Record<string, string>, provider: string, path: string): Promise<Captured & { upstream: string | null }> {
  let upstream: string | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    upstream = String(input);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const handlers: Record<string, (req: unknown, res: unknown, next: () => void) => void> = {};
    createAiProxyApi((name) => env[name]).attach({ use: (route, handler) => { handlers[route] = handler as never; } });
    const captured: Captured = { url: "", status: 0, body: "", headers: {} };
    await new Promise<void>((resolve) => {
      const res = {
        statusCode: 200,
        setHeader: (name: string, value: string) => { captured.headers[name.toLowerCase()] = value; },
        write: (chunk: Uint8Array | string) => { captured.body += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); },
        end: (body?: string) => { captured.body += body ?? ""; captured.status = res.statusCode; resolve(); },
      };
      const req = {
        method: "GET",
        url: `/?provider=${provider}&path=${encodeURIComponent(path)}`,
        headers: {},
        on: () => undefined,
      };
      handlers["/api/knowledge/relay"](req, res, () => resolve());
    });
    return { ...captured, upstream };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("the relay appends each key server-side, in that API's own position", async () => {
  const cases: Array<[string, string, RegExp]> = [
    ["guardian", "/search?q=mars&page-size=1", /^https:\/\/content\.guardianapis\.com\/search\?q=mars&page-size=1&api-key=CANARY_guardian_relay$/],
    ["gnews", "/api/v4/search?q=mars", /^https:\/\/gnews\.io\/api\/v4\/search\?q=mars&apikey=CANARY_gnews_relay$/],
    ["newsdata", "/api/1/news?q=mars", /^https:\/\/newsdata\.io\/api\/1\/news\?q=mars&apikey=CANARY_newsdata_relay$/],
    ["geoapify", "/v1/geocode/search?text=Paris", /^https:\/\/api\.geoapify\.com\/v1\/geocode\/search\?text=Paris&apiKey=CANARY_geo_relay$/],
    ["nasa", "/planetary/apod", /^https:\/\/api\.nasa\.gov\/planetary\/apod\?api_key=CANARY_nasa_relay$/],
    ["firms", "/api/area/csv/VIIRS_SNPP_NRT/1,2,3,4/2", /^https:\/\/firms\.modaps\.eosdis\.nasa\.gov\/api\/area\/csv\/CANARY_firms_relay\/VIIRS_SNPP_NRT\/1,2,3,4\/2$/],
  ];
  for (const [provider, path, expected] of cases) {
    const result = await relay(CANARIES, provider, path);
    assert.equal(result.status, 200, `${provider}: ${result.body}`);
    assert.match(result.upstream ?? "", expected, provider);
    assert.ok(!result.body.includes("CANARY"), `${provider}: the key is never echoed back`);
  }
});

test("NASA falls back to the public DEMO_KEY on the server; others refuse without a key", async () => {
  const nasa = await relay({}, "nasa", "/planetary/apod");
  assert.match(nasa.upstream ?? "", /api_key=DEMO_KEY$/);
  const guardian = await relay({}, "guardian", "/search?q=x");
  assert.equal(guardian.status, 503);
  assert.equal(guardian.upstream, null, "no upstream call without a key");
});

test("the relay stays scoped: a client-supplied key is overwritten and paths cannot escape", async () => {
  const spoof = await relay(CANARIES, "guardian", "/search?q=x&api-key=ATTACKER");
  assert.match(spoof.upstream ?? "", /api-key=CANARY_guardian_relay$/);
  assert.ok(!(spoof.upstream ?? "").includes("ATTACKER"));
  const escape = await relay(CANARIES, "guardian", "/../v1/other");
  assert.equal(escape.status, 400);
  const outside = await relay(CANARIES, "guardian", "/content/x");
  assert.equal(outside.status, 400, "only the Guardian search endpoint is relayed");
});
