/**
 * EarthCore geo-pipeline proof with the REAL configured credentials.
 * Runs inside a Bun-built bundle where `import.meta.env` is statically
 * defined (matching Vite's dev/build injection), exercising the exact
 * provider code the browser runs:
 *
 *   key → FIRMS API → real hotspots → canonical SpatialEntity[]
 *   key → AIS bridge (server-side WS, subscribed to Tokyo box) →
 *         real vessels → provider fetchVessels → canonical SpatialEntity[]
 *
 * Counts + freshness only — never key values.
 */
import { registerEarthProviders, getProvider } from "../src/core/earth/EarthProviders.ts";

const VESSEL_ENDPOINT = (import.meta.env as Record<string, string | undefined>).VITE_EARTH_VESSELS_ENDPOINT ?? "";

const TOKYO = { lat: 35.6762, lon: 139.6503 };

/** Subscribe the shared bridge to the Tokyo box and wait for real vessels. */
async function waitForTokyoVessels(): Promise<number> {
  const boxUrl = `${VESSEL_ENDPOINT}?bbox=129,30,152,42`;
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(boxUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = (await res.json()) as { vessels?: unknown[] };
      total = data.vessels?.length ?? 0;
      if (total > 0) return total;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return total;
}

async function main(): Promise<void> {
  registerEarthProviders();

  const fires = getProvider("fires");
  const vessels = getProvider("vessels");
  const results: Record<string, unknown> = {};

  // 1) FIRMS — direct real fetch around Tokyo.
  if (fires) {
    try {
      const entities = await fires.fetch({ focus: TOKYO, radiusKm: 300 });
      results.fires = {
        ok: true,
        count: entities.length,
        live: entities.filter((e) => e.freshness === "live").length,
        sample: entities.slice(0, 2).map((e) => ({
          type: e.type,
          name: e.name,
          location: e.location,
          source: e.source,
          freshness: e.freshness,
          acqDate: e.metadata?.acqDate,
          satellite: e.metadata?.satellite,
          frpMw: e.metadata?.frpMw,
        })),
      };
    } catch (error) {
      results.fires = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // 2) AIS — subscribe bridge to Tokyo box, then run the provider path.
  const boxVessels = await waitForTokyoVessels();
  results.aisBridge = { ok: boxVessels > 0, bridgeVesselsInTokyoBox: boxVessels };

  if (vessels) {
    try {
      const entities = await vessels.fetch({ focus: TOKYO, radiusKm: 300 });
      results.vessels = {
        ok: true,
        count: entities.length,
        live: entities.filter((e) => e.freshness === "live").length,
        sample: entities.slice(0, 2).map((e) => ({
          type: e.type,
          name: e.name,
          location: e.location,
          source: e.source,
          freshness: e.freshness,
          mmsi: e.metadata?.mmsi,
          sogKt: e.metadata?.sogKt,
        })),
      };
    } catch (error) {
      results.vessels = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  console.log(JSON.stringify(results, null, 2));
  const pass =
    (results.fires?.ok && (results.fires?.count ?? 0) > 0) ||
    ((results.aisBridge?.ok ?? false) && results.vessels?.ok && (results.vessels?.count ?? 0) > 0);
  console.log(`PIPELINE_OK: ${pass ? "true" : "false"}`);
  process.exit(pass ? 0 : 1);
}

void main();
