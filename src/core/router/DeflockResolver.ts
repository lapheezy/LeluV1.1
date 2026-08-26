/**
 * ==========================================================
 * LÉLU
 * DEFLOCK RESOLVER — the FoggedLens/DeFlock router stage
 *
 * The Deflock/FoggedLens capability integrated with LÉLU's
 * EXISTING router chain (after Research, before Providers).
 *
 * When the user asks about ALPR / license-plate-reader camera
 * infrastructure ("show the ALPR cameras near…", "analyze the
 * camera coverage around…", "route that avoids ALPRs"), this
 * stage:
 *
 *   1. detects the intent (curated, conservative patterns),
 *   2. resolves the area — the named place (geocoded for real)
 *      or the Earth Core's current focus,
 *   3. runs the REAL DeFlock analysis against public
 *      OpenStreetMap data (Overpass API — the exact source
 *      FoggedLens/deflock uses): camera discovery, metadata,
 *      density/cluster math, and route-corridor analysis,
 *   4. commands the canonical Earth Core: fly the camera to
 *      the area and enable the ALPR layer, so the visual
 *      result renders on Eagle Eye Earth,
 *   5. emits the same AgentEventBus tool events the chat
 *      timeline and workspace already render,
 *   6. attaches the REAL data to the request context so the
 *      provider/cognition chain reasons over facts.
 *
 * The stage returns unhandled so the provider still answers
 * conversationally — the workspace, the events and the reply
 * all run together, and the Earth surface shows the data.
 *
 * DeFlock does NOT collect plate reads or trajectories — it
 * maps camera infrastructure. This stage is honest about that
 * and never fabricates plate-level data.
 * ==========================================================
 */

import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import { queryAlprCameras, alprRouteAnalysis } from "../earth/EarthProviders";
import EarthCore from "../earth/EarthCore";
import { searchPlaces } from "../earth/EarthProviders";
import AgentEventBus from "../agent/AgentEvents";

const CAMERA_PATTERNS = [
  /(deflock|fogged ?lens)/i,
  /\balpr\b/i,
  /license[- ]plate readers?/i,
  /(show|find|see|list|map|view).{0,40}(alpr|plate readers?|surveillance cameras?|camera (infrastructure|network|coverage|locations?))|(alpr|plate readers?|surveillance cameras?).{0,40}(show|find|see|list|map|view)/i,
  /(analy[sz]e|analy[sz]is).{0,40}(alpr|camera|surveillance).{0,40}(activity|infrastructure|coverage|density|cluster)/i,
  /(camera|surveillance|alpr).{0,30}(density|coverage|cluster|geofence|heat ?map)/i,
  /(alpr|camera|surveillance).{0,30}(around|near|in|at|for)\b/i,
];

const ROUTE_PATTERNS = [
  /(route|drive|path).{0,40}(avoid|without|clear of).{0,30}(alpr|plate readers?|surveillance cameras?|cameras?)/i,
  /(avoid|minimize).{0,30}(alpr|plate readers?|surveillance cameras?|cameras?).{0,30}(route|drive|path)/i,
];

const PLACE_PATTERNS = [
  /(?:around|near|in|at|for|covering|surrounding)\s+([A-Z][A-Za-z .'\-]{2,48})/,
  /(?:analy[sz]e|show|find|search)\s+(?:the\s+)?([A-Z][A-Za-z .'\-]{2,48})\b.*(?:alpr|camera|surveillance|plate)/i,
];

function extractPlace(prompt: string): string | null {
  for (const pattern of PLACE_PATTERNS) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].replace(/[.,;:]+$/, "").trim();
      if (candidate.length >= 3) return candidate;
    }
  }
  return null;
}

function extractCoordinates(prompt: string): Array<{ lat: number; lon: number }> | null {
  const matches = [...prompt.matchAll(/(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/g)];
  const points: Array<{ lat: number; lon: number }> = [];
  for (const match of matches) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      points.push({ lat, lon });
      if (points.length >= 2) break;
    }
  }
  return points.length > 0 ? points : null;
}

export default class DeflockResolver {
  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt;
    const isRoute = ROUTE_PATTERNS.some((pattern) => pattern.test(prompt));
    const isCamera = CAMERA_PATTERNS.some((pattern) => pattern.test(prompt));
    if (!isRoute && !isCamera) {
      return { handled: false };
    }

    const events = AgentEventBus.getInstance();
    const taskId = String(context.request.timestamp ?? Date.now());
    const earth = EarthCore.getInstance();

    events.emit({ type: "tool_selected", taskId, tool: "deflock", label: isRoute ? "Deflock route analysis" : "Deflock ALPR camera search" });
    events.emit({ type: "tool_started", taskId, tool: "deflock", label: isRoute ? "Analyzing route corridor for ALPR cameras" : "Querying OpenStreetMap for ALPR camera infrastructure" });

    try {
      const coords = extractCoordinates(prompt);
      let result: { ok: boolean; message: string; data?: unknown };

      if (isRoute) {
        // Route corridor analysis: two explicit points, or a "from X to Y"
        // pair of place names resolved by real geocoding.
        let from = coords?.[0] ?? null;
        let to = coords?.[1] ?? null;
        if (!from || !to) {
          const fromMatch = prompt.match(/from\s+([A-Z][A-Za-z .'\-]{2,48})/i);
          const toMatch = prompt.match(/to\s+([A-Z][A-Za-z .'\-]{2,48})/i);
          if (fromMatch?.[1] && toMatch?.[1]) {
            const [fromHit, toHit] = await Promise.all([
              searchPlaces(fromMatch[1]),
              searchPlaces(toMatch[1]),
            ]);
            if (fromHit[0]) from = { lat: fromHit[0].lat, lon: fromHit[0].lon };
            if (toHit[0]) to = { lat: toHit[0].lat, lon: toHit[0].lon };
          }
        }
        if (!from || !to) {
          events.emit({
            type: "tool_result",
            taskId,
            tool: "deflock",
            status: "error",
            result: "Deflock route analysis needs two points — pass coordinates or 'from <place> to <place>'.",
          });
          return { handled: false };
        }
        const analysis = await alprRouteAnalysis(from, to, 1.5);
        if (!analysis.route) {
          events.emit({
            type: "tool_result",
            taskId,
            tool: "deflock",
            status: "error",
            result: "Could not compute the route (OSRM unavailable or invalid points).",
          });
          return { handled: false };
        }
        const cam = analysis.camerasOnRoute;
        // Show the corridor on Eagle Eye Earth.
        const mid = {
          lat: (from.lat + to.lat) / 2,
          lon: (from.lon + to.lon) / 2,
        };
        void earth.execute({ op: "navigate_to_location", lat: mid.lat, lon: mid.lon, zoom: 4.5 });
        void earth.execute({ op: "show", layer: "alpr" });
        result = {
          ok: true,
          message:
            `Route ${analysis.distanceKm.toFixed(1)} km (~${Math.round(analysis.durationMin)} min) with ${cam.length} ALPR camera${cam.length === 1 ? "" : "s"} within the corridor.`,
          data: analysis,
        };
      } else {
        // Area camera search/analysis.
        let lat: number | null = coords?.[0]?.lat ?? null;
        let lon: number | null = coords?.[0]?.lon ?? null;
        if (lat === null || lon === null) {
          const place = extractPlace(prompt);
          if (place) {
            const hits = await searchPlaces(place);
            if (hits[0]) {
              lat = hits[0].lat;
              lon = hits[0].lon;
            }
          }
        }
        if (lat === null || lon === null) {
          const focus = earth.getState().camera;
          if (focus) {
            lat = focus.lat;
            lon = focus.lon;
          }
        }
        if (lat === null || lon === null) {
          events.emit({
            type: "tool_result",
            taskId,
            tool: "deflock",
            status: "error",
            result: "Deflock needs an area — name a place (e.g. 'around Atlanta') or pass coordinates.",
          });
          return { handled: false };
        }
        const radiusKm = 50;
        const analysis = await queryAlprCameras(lat, lon, radiusKm);
        // The visual result: fly Eagle Eye Earth to the area and enable
        // the ALPR camera layer — markers + metadata render immediately.
        void earth.execute({ op: "navigate_to_location", lat, lon, zoom: 5 });
        void earth.execute({ op: "show", layer: "alpr" });
        const { cameras, density } = analysis;
        result = {
          ok: true,
          message:
            cameras.length === 0
              ? `No ALPR cameras documented within ${radiusKm} km (OpenStreetMap/DeFlock data).`
              : `${cameras.length} ALPR cameras within ${radiusKm} km · ${density.clusters} clusters · ~${density.per1000km2}/1000 km². Markers shown on Eagle Eye Earth.`,
          data: analysis,
        };
      }

      context.deflock = result;
      // Attach the REAL data so the provider reasons over facts.
      const section = [
        `## DEFLOCK / ALPR ANALYSIS (real data)`,
        result.message,
        "",
        result.data
          ? `Data: ${this.compact(JSON.stringify(result.data)).slice(0, 1400)}`
          : "",
      ].filter(Boolean).join("\n");
      context.request.context = [context.request.context, section]
        .filter((value) => Boolean(value && value.trim().length > 0))
        .join("\n\n");

      events.emit({
        type: "tool_result",
        taskId,
        tool: "deflock",
        status: result.ok ? "complete" : "error",
        result: result.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.emit({
        type: "tool_result",
        taskId,
        tool: "deflock",
        status: "error",
        result: `Deflock analysis failed: ${message}`,
      });
    }

    // Unhandled: the provider answers conversationally on top of the
    // real result, and the events + Earth state render the execution.
    return { handled: false };
  }

  private compact(value: string): string {
    return value.length > 1600 ? `${value.slice(0, 1599)}…` : value;
  }
}
