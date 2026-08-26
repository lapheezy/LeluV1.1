/**
 * ==========================================================
 * LÉLU — EARTH CORE · CANONICAL SPATIAL RUNTIME
 *
 * ONE authoritative Earth state. Chat, voice, cognition, tools
 * and the GenUI surface all read and command this single
 * singleton — there is no second map/globe/tracker state.
 *
 *  EarthCore
 *   ├─ Spatial provider registry (EarthProviders)
 *   ├─ Spatial queries (radius / region / nearby)
 *   ├─ Tracking engine (select → track → follow → trail → stop)
 *   ├─ Spatial context builder (fed into cognition)
 *   └─ Canonical event stream (AgentEventBus.spatial_event)
 *
 * Polling only runs while the surface is active AND a layer is
 * enabled — optional services never block startup or chat.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import {
  allProviders,
  getProvider,
  providerToSource,
  registerEarthProviders,
  reverseGeocodePlace,
  searchPlaces,
  ProviderHintError,
} from "./EarthProviders";
import {
  earthDistanceKm,
  freshnessLabel,
  type DataSource,
  type EarthCommand,
  type EarthState,
  type GeoLocation,
  type ProviderStatus,
  type SpatialEntity,
  type SpatialLayer,
  type SpatialSearchResult,
} from "./EarthTypes";

const MAX_ENTITIES = 320;
const MAX_TRAIL = 60;
const MAX_ACTIVITY = 24;

/** Default layer registry — real providers, honest defaults. */
function defaultLayers(): Record<string, SpatialLayer> {
  const defs = allProviders();
  const layers: Record<string, SpatialLayer> = {};
  for (const def of defs) {
    layers[def.id] = {
      id: def.id,
      name: def.name,
      glyph:
        def.id === "aircraft"
          ? "✈"
          : def.id === "vessels"
            ? "⛴"
            : def.id === "satellites"
              ? "🛰"
              : def.id === "earthquakes"
                ? "≋"
                : def.id === "fires"
                  ? "🔥"
                  : def.id === "alpr"
                    ? "◈"
                    : "☁",
      color:
        def.id === "aircraft"
          ? "#7dd3fc"
          : def.id === "vessels"
            ? "#5eead4"
            : def.id === "satellites"
              ? "#c4b5fd"
              : def.id === "earthquakes"
                ? "#fca5a5"
                : def.id === "fires"
                  ? "#fdba74"
                  : def.id === "alpr"
                    ? "#f472b6"
                    : "#a5f3fc",
      entityType: def.id === "aircraft" ? "aircraft" : def.id === "vessels" ? "vessel" : def.id === "satellites" ? "satellite" : def.id === "earthquakes" ? "earthquake" : def.id === "fires" ? "fire" : def.id === "alpr" ? "alpr" : def.id === "weather" ? "weather" : null,
      enabled: false,
      source: providerToSource(def),
    };
  }
  // Render-only layers (real data via the existing GeoPipeline).
  layers["terrain"] = {
    id: "terrain",
    name: "Terrain",
    glyph: "⛰",
    color: "#6ee7b7",
    entityType: null,
    enabled: false,
    source: {
      id: "terrain",
      name: "Terrain",
      provider: "Mapzen Terrarium (GeoPipeline)",
      attribution: "Mapzen Terrarium elevation tiles",
      license: "Open terrain data",
      updateIntervalMs: 0,
      authRequired: false,
      status: "idle",
      freshnessLabel: "REAL ELEVATION",
    },
  };
  return layers;
}

/**
 * Real Sun/Earth relationship for the day/night terminator.
 * Returns the unit direction of the Sun (same coordinate mapping
 * the globe renderer uses) computed from the actual solar position.
 */
export function sunDirectionEcef(now: number): { x: number; y: number; z: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const hourAngle = ((12 - utcHours) * 15 * Math.PI) / 180;
  const sunLat = (decl * 180) / Math.PI;
  const sunLon = ((-hourAngle * 180) / Math.PI + 540) % 360 - 180;
  // Same lat/lon → unit-vector mapping the Earth globe uses.
  const phi = ((90 - sunLat) * Math.PI) / 180;
  const theta = ((sunLon + 180) * Math.PI) / 180;
  return {
    x: -Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };
}

export default class EarthCore {
  private static instance: EarthCore | null = null;

  private state: EarthState;
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private inFlight = new Set<string>();

  private constructor() {
    registerEarthProviders();
    const layers = defaultLayers();
    this.state = {
      layers,
      entities: [],
      selectedEntityId: null,
      trackedEntityId: null,
      followMode: false,
      camera: null,
      cameraZoom: 4,
      placeContext: null,
      searchQuery: "",
      searchResults: [],
      providerStatus: Object.fromEntries(
        Object.values(layers).map((l) => [l.source.id, { ...l.source }]),
      ),
      activity: [],
      active: false,
      sunDirection: sunDirectionEcef(Date.now()),
    };
  }

  static getInstance(): EarthCore {
    if (!EarthCore.instance) {
      EarthCore.instance = new EarthCore();
    }
    return EarthCore.instance;
  }

  /* ------------------------------------------------------------------
   * Subscription
   * ------------------------------------------------------------------ */

  getState(): EarthState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* contained — a UI listener can never break the runtime */
      }
    }
  }

  private patch(patch: Partial<EarthState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private updateLayer(layerId: string, fn: (layer: SpatialLayer) => SpatialLayer): void {
    const layers = { ...this.state.layers };
    const layer = layers[layerId];
    if (!layer) return;
    layers[layerId] = fn(layer);
    this.patch({ layers });
  }

  private updateSource(sourceId: string, fn: (source: DataSource) => DataSource): void {
    const providerStatus = { ...this.state.providerStatus };
    const source = providerStatus[sourceId] ?? this.state.layers[sourceId]?.source;
    if (!source) return;
    providerStatus[sourceId] = fn({ ...source });
    this.patch({ providerStatus });
    // Keep the layer's source in sync (single canonical source of truth).
    this.updateLayer(sourceId, (l) => ({ ...l, source: providerStatus[sourceId] }));
  }

  private pushActivity(op: string, label: string, side: "backend" | "frontend" | "both", layer?: string): void {
    const activity = [
      { at: Date.now(), op, label, side, layer },
      ...this.state.activity,
    ].slice(0, MAX_ACTIVITY);
    this.patch({ activity });
    AgentEventBus.getInstance().emit({
      type: "spatial_event",
      taskId: `earth-${Date.now()}`,
      op,
      label,
      side,
      layer,
    });
  }

  /* ------------------------------------------------------------------
   * Lifecycle — polling only while the surface is active
   * ------------------------------------------------------------------ */

  activate(): void {
    if (this.state.active) return;
    this.patch({ active: true });
    // Default focus: the WHOLE planet. The LÉLU core opens as Eagle Eye —
    // one look at the entire Earth replica — then the user can zoom down
    // to any region, and "what's around here" always has a coordinate.
    if (!this.state.camera) {
      this.patch({ camera: { lat: 0, lon: 10 }, cameraZoom: 0.5 });
      void this.resolvePlaceContext({ lat: 0, lon: 10 });
    }
    this.startPolling();
    this.pushActivity("earth_ready", "Earth Core initialized", "both");
  }

  deactivate(): void {
    this.stopPolling();
    this.patch({ active: false });
  }

  private startPolling(): void {
    const defs = allProviders();
    for (const def of defs) {
      if (def.authRequired && !def.configured()) continue;
      const tick = () => {
        const layer = this.state.layers[def.id];
        if (!layer?.enabled) return;
        void this.refreshLayer(def.id);
      };
      tick();
      const timer = setInterval(tick, def.updateIntervalMs);
      this.timers.set(def.id, timer);
    }
  }

  private stopPolling(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  /* ------------------------------------------------------------------
   * Data refresh
   * ------------------------------------------------------------------ */

  async refreshLayer(layerId: string): Promise<{ ok: boolean; count: number; message: string }> {
    const layer = this.state.layers[layerId];
    if (!layer) return { ok: false, count: 0, message: `Unknown layer ${layerId}` };
    const provider = getProvider(layerId);
    if (!provider) return { ok: false, count: 0, message: `No provider for ${layerId}` };
    if (provider.authRequired && !provider.configured()) {
      this.updateSource(layerId, (s) => ({ ...s, status: "not_configured", freshnessLabel: "NOT CONFIGURED" }));
      this.pushActivity(
        "provider_not_configured",
        `${layer.name} — NOT CONFIGURED (add provider key)`,
        "backend",
        layerId,
      );
      return { ok: false, count: 0, message: `${layer.name} — NOT CONFIGURED (add provider key)` };
    }
    if (this.inFlight.has(layerId)) return { ok: false, count: 0, message: "already refreshing" };
    this.inFlight.add(layerId);
    this.updateSource(layerId, (s) => ({ ...s, status: "loading" }));
    this.pushActivity("provider_connect", `Connecting to ${provider.provider}`, "backend", layerId);
    try {
      const entities = await provider.fetch({
        focus: this.state.camera,
        radiusKm: 200,
      });
      const now = Date.now();
      this.mergeLayerEntities(layerId, entities);
      this.updateSource(layerId, (s) => ({
        ...s,
        status: "live",
        lastUpdatedAt: now,
        freshnessLabel: freshnessLabel(now, true),
        lastError: undefined,
      }));
      if (entities.length > 0) {
        this.pushActivity("provider_data", `Received ${entities.length} ${layer.name.toLowerCase()}`, "backend", layerId);
      }
      return { ok: true, count: entities.length, message: `${layer.name}: ${entities.length} items` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let status: ProviderStatus = "error";
      let label = "UNAVAILABLE";
      if (error instanceof ProviderHintError) {
        switch (error.hint) {
          case "not_configured":
            status = "not_configured";
            label = "NOT CONFIGURED";
            break;
          case "auth_error":
            status = "auth_error";
            label = "AUTH FAILED";
            break;
          case "rate_limited":
            status = "rate_limited";
            label = "RATE LIMITED";
            break;
          case "disconnected":
            status = "disconnected";
            label = "DISCONNECTED";
            break;
          case "unavailable":
            status = "unavailable";
            label = "UNAVAILABLE";
            break;
        }
      }
      this.updateSource(layerId, (s) => ({ ...s, status, lastError: message, freshnessLabel: label }));
      this.pushActivity(
        "provider_failed",
        `${layer.name} — ${label}${message ? ` (${message})` : ""}`,
        "backend",
        layerId,
      );
      return { ok: false, count: 0, message: `${layer.name} — ${label}: ${message}` };
    } finally {
      this.inFlight.delete(layerId);
    }
  }

  /** Replace one layer's entities, preserving the tracked entity + trail. */
  private mergeLayerEntities(layerId: string, incoming: SpatialEntity[]): void {
    const oldForLayer = this.state.entities.filter((e) => e.source === layerId);
    const oldById = new Map(oldForLayer.map((e) => [e.id, e]));
    const newById = new Map(incoming.map((e) => [e.id, e]));

    // Preserve the tracked entity across refreshes — including through
    // gaps: if the provider briefly stops reporting it, keep the last
    // known fix marked stale so tracking recovers instead of vanishing.
    const trackedId = this.state.trackedEntityId;
    const trackedOld = trackedId ? oldById.get(trackedId) : undefined;
    if (trackedId && trackedOld) {
      const trackedNew = newById.get(trackedId);
      if (trackedNew) {
        const trail = [...(trackedOld.trail ?? []), trackedOld.location].slice(-MAX_TRAIL);
        trackedNew.trail = trail;
      } else {
        newById.set(trackedId, {
          ...trackedOld,
          freshness: "updated",
          metadata: { ...(trackedOld.metadata ?? {}), stale: true },
        });
      }
    }

    const merged = incoming.length > 0 ? Array.from(newById.values()) : oldForLayer;
    const rest = this.state.entities.filter((e) => e.source !== layerId);
    const entities = [...rest, ...merged].slice(-MAX_ENTITIES);
    this.patch({ entities });
  }

  /* ------------------------------------------------------------------
   * Command router — Chat, voice and tools all land here
   * ------------------------------------------------------------------ */

  async execute(command: EarthCommand): Promise<{ ok: boolean; message: string; data?: unknown }> {
    this.activate();
    switch (command.op) {
      case "show":
      case "toggle": {
        const layer = this.state.layers[command.layer];
        if (!layer) return { ok: false, message: `Unknown layer "${command.layer}"` };
        const enabled = command.op === "toggle" ? !layer.enabled : true;
        this.updateLayer(layer.id, (l) => ({ ...l, enabled }));
        this.pushActivity("layer_enabled", `${layer.name} layer ${enabled ? "enabled" : "disabled"}`, "both", layer.id);
        if (enabled) void this.refreshLayer(layer.id);
        return { ok: true, message: `${layer.name} ${enabled ? "shown" : "hidden"}` };
      }
      case "hide": {
        const layer = this.state.layers[command.layer];
        if (!layer) return { ok: false, message: `Unknown layer "${command.layer}"` };
        this.updateLayer(layer.id, (l) => ({ ...l, enabled: false }));
        this.pushActivity("layer_disabled", `${layer.name} layer hidden`, "both", layer.id);
        return { ok: true, message: `${layer.name} hidden` };
      }
      case "navigate_to_location": {
        let location: GeoLocation | null = null;
        let zoom = command.zoom;
        if (typeof command.lat === "number" && typeof command.lon === "number") {
          location = { lat: command.lat, lon: command.lon };
        } else if (command.query) {
          const results = await searchPlaces(command.query);
          const hit = results[0];
          if (hit) {
            location = { lat: hit.lat, lon: hit.lon };
            this.patch({ searchResults: results, searchQuery: command.query });
          }
        }
        if (!location) {
          return { ok: false, message: `Could not resolve "${command.query ?? "location"}"` };
        }
        if (zoom === undefined) {
          zoom = 5;
        }
        this.patch({ camera: location, cameraZoom: zoom });
        this.pushActivity("navigate", `Flying to ${location.lat.toFixed(2)}°, ${location.lon.toFixed(2)}°`, "both");
        void this.resolvePlaceContext(location);
        // Refresh nearby live layers for the new region.
        for (const id of Object.keys(this.state.layers)) {
          const l = this.state.layers[id];
          if (l.enabled && l.entityType) void this.refreshLayer(id);
        }
        return { ok: true, message: `Navigated to ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`, data: location };
      }
      case "search_places": {
        const results = await searchPlaces(command.query);
        this.patch({ searchResults: results, searchQuery: command.query });
        this.pushActivity("search", `Geocoding "${command.query}" — ${results.length} results`, "backend");
        return { ok: true, message: `${results.length} results for "${command.query}"`, data: results };
      }
      case "reverse_geocode": {
        await this.resolvePlaceContext({ lat: command.lat, lon: command.lon });
        return { ok: true, message: "Reverse geocoded", data: this.state.placeContext };
      }
      case "select_entity": {
        if (!command.id) {
          this.patch({ selectedEntityId: null });
          return { ok: true, message: "Selection cleared" };
        }
        const entity = this.state.entities.find((e) => e.id === command.id);
        if (!entity) return { ok: false, message: "Entity not visible" };
        this.patch({ selectedEntityId: command.id });
        this.pushActivity("select", `Selected ${entity.name}`, "frontend", entity.source);
        return { ok: true, message: `Selected ${entity.name}`, data: entity };
      }
      case "track_entity": {
        const entity = command.id
          ? this.state.entities.find((e) => e.id === command.id)
          : this.state.entities.find((e) => e.id === this.state.selectedEntityId);
        if (!entity) return { ok: false, message: "No entity to track — select one first" };
        const trail = (entity.trail ?? []).slice(-MAX_TRAIL);
        this.patch({ trackedEntityId: entity.id, followMode: true, selectedEntityId: entity.id });
        this.updateEntityTrail(entity.id, trail);
        this.pushActivity("track", `Tracking ${entity.name}`, "both", entity.source);
        return { ok: true, message: `Tracking ${entity.name}` };
      }
      case "stop_tracking": {
        this.patch({ trackedEntityId: null, followMode: false });
        this.pushActivity("stop_tracking", "Stopped tracking", "both");
        return { ok: true, message: "Stopped tracking" };
      }
      case "follow": {
        this.patch({ followMode: command.enabled });
        this.pushActivity("follow", command.enabled ? "Following entity" : "Released camera", "frontend");
        return { ok: true, message: command.enabled ? "Following" : "Released" };
      }
      case "query_radius": {
        const center: GeoLocation = { lat: command.lat, lon: command.lon };
        const within = this.state.entities.filter(
          (e) => earthDistanceKm(center, e.location) <= command.radiusKm,
        );
        this.patch({ camera: center, cameraZoom: 6 });
        this.pushActivity(
          "query_radius",
          `${within.length} entities within ${command.radiusKm} km of ${center.lat.toFixed(2)}°, ${center.lon.toFixed(2)}°`,
          "backend",
        );
        return { ok: true, message: `${within.length} entities within ${command.radiusKm} km`, data: within };
      }
      case "refresh_layer": {
        const result = await this.refreshLayer(command.layer);
        return { ok: result.ok, message: result.message };
      }
      case "set_camera": {
        if (typeof command.lat === "number" && typeof command.lon === "number") {
          this.patch({
            camera: { lat: command.lat, lon: command.lon },
            cameraZoom: command.zoom ?? this.state.cameraZoom,
          });
        }
        return { ok: true, message: "Camera updated" };
      }
      default: {
        const exhaustive: never = command;
        return { ok: false, message: `Unhandled command ${(exhaustive as { op?: string }).op ?? "?"}` };
      }
    }
  }

  private updateEntityTrail(id: string, trail: GeoLocation[]): void {
    this.patch({
      entities: this.state.entities.map((e) => (e.id === id ? { ...e, trail } : e)),
    });
  }

  private async resolvePlaceContext(location: GeoLocation): Promise<void> {
    const place = await reverseGeocodePlace(location.lat, location.lon);
    if (place) {
      this.patch({
        placeContext: { ...place, lat: location.lat, lon: location.lon },
      });
      this.pushActivity("reverse_geocode", `Located: ${place.name}${place.country ? `, ${place.country}` : ""}`, "backend");
    }
  }

  /* ------------------------------------------------------------------
   * Queries (used by tools + cognition)
   * ------------------------------------------------------------------ */

  entitiesNear(lat: number, lon: number, radiusKm: number, types?: string[]): SpatialEntity[] {
    const center: GeoLocation = { lat, lon };
    return this.state.entities
      .filter((e) => earthDistanceKm(center, e.location) <= radiusKm)
      .filter((e) => (types && types.length > 0 ? types.includes(e.type) : true))
      .sort((a, b) => earthDistanceKm(center, a.location) - earthDistanceKm(center, b.location));
  }

  selectedEntity(): SpatialEntity | null {
    return this.state.entities.find((e) => e.id === this.state.selectedEntityId) ?? null;
  }

  trackedEntity(): SpatialEntity | null {
    return this.state.entities.find((e) => e.id === this.state.trackedEntityId) ?? null;
  }

  /** The current search results (latest geocode/place search). */
  searchResults(): SpatialSearchResult[] {
    return this.state.searchResults;
  }

  /* ------------------------------------------------------------------
   * Spatial context for cognition — compact, never full datasets
   * ------------------------------------------------------------------ */

  /**
   * Structured summary of the current Earth Core state. Returns null
   * when Earth is dormant (nothing enabled / never used) so cognition
   * isn't polluted with empty spatial sections.
   */
  buildSpatialContext(): string | null {
    const s = this.state;
    const enabled = Object.values(s.layers).filter((l) => l.enabled);
    const anyData =
      s.active || s.trackedEntityId !== null || s.placeContext !== null || enabled.length > 0;
    if (!anyData && s.entities.length === 0) return null;

    const lines: string[] = [];
    lines.push("## EARTH CORE (spatial context)");

    if (s.placeContext) {
      const p = s.placeContext;
      lines.push(`Focus: ${p.name}${p.admin1 ? `, ${p.admin1}` : ""}${p.country ? `, ${p.country}` : ""} (${p.lat.toFixed(3)}°, ${p.lon.toFixed(3)}°)`);
    } else if (s.camera) {
      lines.push(`Focus: ${s.camera.lat.toFixed(3)}°, ${s.camera.lon.toFixed(3)}°`);
    } else {
      lines.push("Focus: none (Earth not opened yet)");
    }

    if (enabled.length > 0) {
      const layerLines = enabled.map((l) => {
        const src = s.providerStatus[l.id] ?? l.source;
        return `- ${l.name} ${src.status === "not_configured" ? "— NOT CONFIGURED" : `— ${src.freshnessLabel ?? src.status}`}`;
      });
      lines.push(`Active layers:\n${layerLines.join("\n")}`);
    }

    const byType = new Map<string, number>();
    for (const e of s.entities) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    if (byType.size > 0) {
      lines.push(
        `Entities visible: ${Array.from(byType.entries())
          .map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"}`)
          .join(", ")}`,
      );
    }

    const selected = this.selectedEntity();
    if (selected) {
      const m = selected.metadata ?? {};
      const telemetry = [
        typeof m.altitudeFt === "number" ? `${Math.round(m.altitudeFt).toLocaleString()} ft` : null,
        typeof m.groundSpeedKt === "number" ? `${Math.round(m.groundSpeedKt)} kt` : null,
        typeof m.trackDeg === "number" ? `heading ${Math.round(m.trackDeg)}°` : null,
        typeof m.magnitude === "number" ? `M${m.magnitude.toFixed(1)}` : null,
        typeof m.temperatureC === "number" ? `${Math.round(m.temperatureC)}°C` : null,
      ].filter(Boolean);
      const tracked = s.trackedEntityId === selected.id ? " (tracking, camera following)" : "";
      lines.push(`Selected: ${selected.name}${telemetry.length > 0 ? ` — ${telemetry.join(" · ")}` : ""}${tracked}${selected.estimated ? " (position estimated)" : ""}`);
    } else if (s.trackedEntityId) {
      const tracked = this.trackedEntity();
      if (tracked) lines.push(`Tracking: ${tracked.name}${tracked.estimated ? " (position estimated)" : ""}`);
    }

    const statuses = Object.values(s.providerStatus)
      .filter((src) => src.status !== "idle")
      .map((src) => `${src.id}:${src.status}`)
      .join(" · ");
    if (statuses) lines.push(`Providers: ${statuses}`);

    if (s.activity.length > 0) {
      lines.push(`Recent: ${s.activity.slice(0, 3).map((a) => a.label).join(" → ")}`);
    }

    return lines.join("\n");
  }
}
