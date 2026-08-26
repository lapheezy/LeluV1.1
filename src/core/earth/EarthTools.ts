/**
 * ==========================================================
 * LÉLU — EARTH CORE · TOOL REGISTRATION
 *
 * Exposes Earth Core to LÉLU's existing tool router — the same
 * ToolRegistry cognition already queries. Every tool routes
 * through the canonical EarthCore.execute() command router, so
 * Chat, voice and tools all drive ONE spatial state.
 *
 * All earth tools are read/navigation level (risk 0-1): they
 * only fetch public data and move the local camera/state.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import EarthCore from "./EarthCore";
import { alprRouteAnalysis, queryAlprCameras } from "./EarthProviders";

const EARTH_TOOLS: ToolDefinition[] = [
  {
    id: "earth.show",
    name: "Show Earth",
    description: "Open the Earth Core surface and reveal the live Earth",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "EarthCore.execute(show)",
  },
  {
    id: "earth.search_place",
    name: "Search Place",
    description: "Global place search / geocoding — find countries, cities, streets, landmarks, coordinates",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { query: "string" },
    executionRoute: "EarthCore.execute(search_places)",
  },
  {
    id: "earth.geocode",
    name: "Geocode",
    description: "Resolve a place name or address to coordinates",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { query: "string" },
    executionRoute: "EarthCore.execute(search_places)",
  },
  {
    id: "earth.reverse_geocode",
    name: "Reverse Geocode",
    description: "Resolve coordinates to a geographic description (country/region/city/place)",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { lat: "number", lon: "number" },
    executionRoute: "EarthCore.execute(reverse_geocode)",
  },
  {
    id: "earth.navigate",
    name: "Navigate to Location",
    description: "Fly the Earth camera to a place or coordinate and establish spatial context",
    category: "Earth",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { query: "string" },
    executionRoute: "EarthCore.execute(navigate_to_location)",
  },
  {
    id: "earth.query_nearby",
    name: "Query Nearby",
    description: "Find spatial entities (aircraft, vessels, satellites, quakes, fires) near a location",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { lat: "number", lon: "number", radiusKm: "number" },
    executionRoute: "EarthCore.queryNearby",
  },
  {
    id: "earth.query_radius",
    name: "Query Radius",
    description: "Spatial query constrained to a radius around a point",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { lat: "number", lon: "number", radiusKm: "number", layers: "string[]" },
    executionRoute: "EarthCore.execute(query_radius)",
  },
  {
    id: "earth.query_entities",
    name: "Query Spatial Entities",
    description: "List current live spatial entities filtered by type and region",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { types: "string[]", radiusKm: "number" },
    executionRoute: "EarthCore.queryEntities",
  },
  {
    id: "earth.set_layer",
    name: "Set Earth Layer",
    description: "Enable or disable a data layer (aircraft, vessels, satellites, earthquakes, fires, weather, alpr)",
    category: "Earth",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { layer: "string", enabled: "boolean" },
    executionRoute: "EarthCore.execute(show|hide)",
  },
  {
    id: "deflock.cameras",
    name: "Deflock · ALPR Cameras",
    description: "Find ALPR / license-plate-reader camera infrastructure around a location or area (FoggedLens/DeFlock OpenStreetMap data)",
    category: "Deflock",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { lat: "number", lon: "number", radiusKm: "number" },
    executionRoute: "EarthProviders.queryAlprCameras",
  },
  {
    id: "deflock.analyze",
    name: "Deflock · Camera Analysis",
    description: "Analyze ALPR camera density, clustering and coverage around a location (spatial analysis over real camera data)",
    category: "Deflock",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { lat: "number", lon: "number", radiusKm: "number" },
    executionRoute: "EarthProviders.queryAlprCameras",
  },
  {
    id: "deflock.route",
    name: "Deflock · Route Analysis",
    description: "Analyze a route between two points for ALPR cameras along the corridor — the DeFlock ALPR-aware routing capability",
    category: "Deflock",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { fromLat: "number", fromLon: "number", toLat: "number", toLon: "number", corridorKm: "number" },
    executionRoute: "EarthProviders.alprRouteAnalysis",
  },
  {
    id: "earth.track",
    name: "Track Entity",
    description: "Track a selected or named entity and follow it with the camera",
    category: "Earth",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { id: "string" },
    executionRoute: "EarthCore.execute(track_entity)",
  },
  {
    id: "earth.inspect",
    name: "Inspect Entity",
    description: "Select and inspect an entity's telemetry (altitude, speed, magnitude, …)",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { id: "string" },
    executionRoute: "EarthCore.execute(select_entity)",
  },
  {
    id: "earth.context",
    name: "Earth Context",
    description: "Get the current Earth Core spatial context (focus, layers, selected/tracked entity, providers)",
    category: "Earth",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "EarthCore.buildSpatialContext",
  },
];

let registered = false;

/** Idempotent registration — call from bootstrap or first use. */
export function registerEarthTools(): void {
  if (registered) return;
  registered = true;
  const registry = ToolRegistry.getInstance();
  for (const tool of EARTH_TOOLS) {
    registry.register(tool);
  }
}

/**
 * Execute an earth tool by id. Returns a human + machine readable
 * result so the tool-call path can surface real outcomes.
 */
export async function executeEarthTool(
  toolId: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: boolean; message: string; data?: unknown }> {
  const earth = EarthCore.getInstance();
  switch (toolId) {
    case "earth.show":
      return { ok: true, message: "Earth Core opened" };
    case "earth.search_place":
    case "earth.geocode":
      return earth.execute({ op: "search_places", query: String(args.query ?? "") });
    case "earth.reverse_geocode": {
      const lat = Number(args.lat);
      const lon = Number(args.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, message: "Invalid coordinates" };
      }
      return earth.execute({ op: "reverse_geocode", lat, lon });
    }
    case "earth.navigate":
      return earth.execute({ op: "navigate_to_location", query: String(args.query ?? "") });
    case "earth.query_nearby": {
      const lat = Number(args.lat);
      const lon = Number(args.lon);
      const radiusKm = Number(args.radiusKm ?? 100);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, message: "Invalid coordinates" };
      }
      const entities = earth.entitiesNear(lat, lon, radiusKm);
      return { ok: true, message: `${entities.length} entities near ${lat.toFixed(2)}, ${lon.toFixed(2)}`, data: entities };
    }
    case "earth.query_radius":
      return earth.execute({
        op: "query_radius",
        lat: Number(args.lat),
        lon: Number(args.lon),
        radiusKm: Number(args.radiusKm ?? 100),
        layers: Array.isArray(args.layers) ? (args.layers as string[]) : undefined,
      });
    case "earth.query_entities": {
      const types = Array.isArray(args.types) ? (args.types as string[]) : undefined;
      const entities = earth.entitiesNear(
        earth.getState().camera?.lat ?? 0,
        earth.getState().camera?.lon ?? 0,
        Number(args.radiusKm ?? 5000),
        types,
      );
      return { ok: true, message: `${entities.length} entities`, data: entities };
    }
    case "earth.set_layer": {
      const layer = String(args.layer ?? "");
      const enabled = Boolean(args.enabled);
      return earth.execute(enabled ? { op: "show", layer } : { op: "hide", layer });
    }
    case "deflock.cameras":
    case "deflock.analyze": {
      const lat = Number(args.lat);
      const lon = Number(args.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, message: "Deflock needs lat/lon — geocode the area first or pass coordinates" };
      }
      const radiusKm = Number(args.radiusKm ?? 100);
      const result = await queryAlprCameras(lat, lon, radiusKm);
      const { cameras, density } = result;
      if (cameras.length === 0) {
        return {
          ok: true,
          message: `No ALPR cameras documented within ${radiusKm} km of ${lat.toFixed(2)}, ${lon.toFixed(2)} (OpenStreetMap/DeFlock data).`,
          data: result,
        };
      }
      const operators = Array.from(new Set(cameras.map((c) => String((c.metadata ?? {}).operator ?? "unknown"))));
      return {
        ok: true,
        message:
          `${cameras.length} ALPR cameras within ${radiusKm} km of ${lat.toFixed(2)}, ${lon.toFixed(2)} · ` +
          `${density.clusters} clusters · ~${density.per1000km2}/1000 km² · operators: ${operators.slice(0, 5).join(", ")}`,
        data: result,
      };
    }
    case "deflock.route": {
      const fromLat = Number(args.fromLat);
      const fromLon = Number(args.fromLon);
      const toLat = Number(args.toLat);
      const toLon = Number(args.toLon);
      if (![fromLat, fromLon, toLat, toLon].every(Number.isFinite)) {
        return { ok: false, message: "Deflock route needs fromLat/fromLon/toLat/toLon" };
      }
      const corridorKm = Number(args.corridorKm ?? 1.5);
      const analysis = await alprRouteAnalysis(
        { lat: fromLat, lon: fromLon },
        { lat: toLat, lon: toLon },
        corridorKm,
      );
      if (!analysis.route) {
        return { ok: false, message: "Could not compute a route between those points (OSRM unavailable or invalid points)." };
      }
      return {
        ok: true,
        message:
          `Route ${analysis.distanceKm.toFixed(1)} km (~${Math.round(analysis.durationMin)} min) with ` +
          `${analysis.camerasOnRoute.length} ALPR camera${analysis.camerasOnRoute.length === 1 ? "" : "s"} within ${corridorKm} km of the corridor.`,
        data: analysis,
      };
    }
    case "earth.track":
      return earth.execute({ op: "track_entity", id: args.id ? String(args.id) : undefined });
    case "earth.inspect":
      return earth.execute({ op: "select_entity", id: String(args.id ?? "") });
    case "earth.context": {
      const context = earth.buildSpatialContext();
      return {
        ok: true,
        message: context ?? "Earth Core is dormant — no layers enabled yet.",
        data: context,
      };
    }
    default:
      return { ok: false, message: `Unknown earth tool ${toolId}` };
  }
}
