/**
 * ==========================================================
 * LÉLU — EARTH CORE · CANONICAL TYPES
 *
 * The single authoritative vocabulary for LÉLU's spatial
 * subsystem. Every consumer (Chat, voice, cognition, tools,
 * GenUI) reads and writes these shapes through ONE runtime
 * (EarthCore) — there is no second Earth state anywhere.
 * ==========================================================
 */

/** A geographic point on the real Earth. */
export interface GeoLocation {
  lat: number;
  lon: number;
}

export type EntityType =
  | "aircraft"
  | "vessel"
  | "satellite"
  | "earthquake"
  | "fire"
  | "weather"
  | "alpr"
  | "place"
  | "unknown";

/**
 * Honest data temporality — never present stale, cached, estimated
 * or simulated information as live information.
 */
export type DataFreshness =
  | "live"          // real-time feed, updated within the last minutes
  | "updated"       // recent but not streaming (e.g. cached within hours)
  | "historical"    // explicitly past data
  | "forecast"      // future/predicted data
  | "simulated"     // generated/approximate — never presented as live
  | "unavailable";  // nothing loaded for this layer

/** One real spatial object (aircraft, vessel, quake, place, …). */
export interface SpatialEntity {
  id: string;
  type: EntityType;
  name: string;
  location: GeoLocation;
  /** Epoch ms of the observation this entity represents. */
  timestamp: number;
  /** Provider/source id (see DataSource.id). */
  source: string;
  freshness: DataFreshness;
  /** True when the position is propagated/estimated, not observed. */
  estimated?: boolean;
  /** Layer-specific telemetry (altitude, speed, magnitude, …). */
  metadata?: Record<string, unknown>;
  /** Recent observed positions — used for trails (oldest first). */
  trail?: GeoLocation[];
}

export type ProviderStatus =
  | "idle"
  | "loading"
  | "live"
  | "error"
  | "not_configured"
  | "disconnected"
  | "rate_limited"
  | "auth_error"
  | "unavailable";

/** One spatial data source with its license/attribution/freshness. */
export interface DataSource {
  id: string;
  name: string;
  provider: string;
  attribution: string;
  license?: string;
  /** How often EarthCore polls this source (ms). */
  updateIntervalMs: number;
  /** Whether a secret/key is required (kept server-side, never in the bundle). */
  authRequired: boolean;
  status: ProviderStatus;
  lastUpdatedAt?: number;
  lastError?: string;
  /** Human-readable freshness line, e.g. "LIVE · 22s ago". */
  freshnessLabel?: string;
}

/** One enabled visual layer on the Earth (data-backed). */
export interface SpatialLayer {
  id: string;
  name: string;
  glyph: string;
  color: string;
  /** Which SpatialEntity.type this layer renders. */
  entityType: EntityType | null;
  enabled: boolean;
  source: DataSource;
}

/** A structured geocoding / place-search result. */
export interface SpatialSearchResult {
  id: string;
  name: string;
  country?: string;
  admin1?: string;
  lat: number;
  lon: number;
  featureType: string;
  source: string;
  confidence: number;
}

/** Reverse-geocoded context for the current camera focus. */
export interface SpatialPlaceContext {
  name: string;
  country?: string;
  admin1?: string;
  lat: number;
  lon: number;
}

/** The one canonical Earth Core state. */
export interface EarthState {
  /** Ordered layer registry (id → layer). */
  layers: Record<string, SpatialLayer>;
  /** Bounded list of currently visible entities (merged from layers). */
  entities: SpatialEntity[];
  selectedEntityId: string | null;
  trackedEntityId: string | null;
  /** When true the camera follows the tracked entity. */
  followMode: boolean;
  /** Current camera focus (the location EarthCore is pointed at). */
  camera: GeoLocation | null;
  cameraZoom: number;
  /** Reverse-geocoded context for the focus. */
  placeContext: SpatialPlaceContext | null;
  searchQuery: string;
  searchResults: SpatialSearchResult[];
  /** Provider status by source id — real measured state, never a claim. */
  providerStatus: Record<string, DataSource>;
  /** Bounded recent spatial activity (feeds the execution stream). */
  activity: Array<{
    at: number;
    op: string;
    label: string;
    side: "backend" | "frontend" | "both";
    layer?: string;
  }>;
  /** True while the Earth surface is mounted (polls only then). */
  active: boolean;
  /** Sun direction in world space for the day/night terminator. */
  sunDirection: { x: number; y: number; z: number };
}

/** Structured commands — Chat, voice and tools all use the same router. */
export type EarthCommand =
  | { op: "show"; layer: string }
  | { op: "hide"; layer: string }
  | { op: "toggle"; layer: string }
  | { op: "navigate_to_location"; query?: string; lat?: number; lon?: number; zoom?: number }
  | { op: "search_places"; query: string }
  | { op: "select_entity"; id: string }
  | { op: "track_entity"; id?: string }
  | { op: "stop_tracking" }
  | { op: "follow"; enabled: boolean }
  | { op: "query_radius"; lat: number; lon: number; radiusKm: number; layers?: string[] }
  | { op: "reverse_geocode"; lat: number; lon: number }
  | { op: "refresh_layer"; layer: string }
  | { op: "set_camera"; lat?: number; lon?: number; zoom?: number };

/** Great-circle distance in km between two points. */
export function earthDistanceKm(a: GeoLocation, b: GeoLocation): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Format a freshness line from an update timestamp. */
export function freshnessLabel(updatedAt: number | undefined, live: boolean): string {
  if (!updatedAt) return "NO DATA";
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (live) {
    if (seconds < 60) return `LIVE · ${seconds}s ago`;
    return `LIVE · ${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 3600) return `UPDATED · ${Math.round(seconds / 60)}m ago`;
  return `UPDATED · ${new Date(updatedAt).toLocaleTimeString()}`;
}
