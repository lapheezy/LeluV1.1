/**
 * ============================================================
 * LÉLU — EAGLE EYE · EARTH CORE · UNIFIED VISUAL SURFACE
 *
 * The 2D tile map fills the ENTIRE viewport. All controls float
 * above the map. There is no bordered container, no flex layout,
 * no stacked navigation layers. This IS the LÉLU environment.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ [🔍 Search] [sat|map] [+|−] [🌍 HOME]  │  ← floating controls
 *   │                                          │
 *   │            EARTH MAP                     │  ← fills 100%
 *   │         (full viewport)                  │
 *   │                                          │
 *   │   [◉ entity info panel]                 │  ← single floating panel
 *   └──────────────────────────────────────────┘
 *
 * Chat, dock and modules render as overlays ABOVE this surface
 * through GenesisInterface (the unified LÉLU shell).
 * ============================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import EarthCore from "../../../core/earth/EarthCore";
import {
  type EarthState,
  type SpatialEntity,
} from "../../../core/earth/EarthTypes";
import GenesisEarthMap from "./GenesisEarthMap";

/* ------------------------------------------------------------------
 * Floating compact controls — always above the map, never blocking it
 * ------------------------------------------------------------------ */

function EagleEyeControls({
  state,
  earth,
  search,
  setSearch,
  onSearch,
}: {
  state: EarthState;
  earth: EarthCore;
  search: string;
  setSearch: (q: string) => void;
  onSearch: () => void;
}) {
  const [layersOpen, setLayersOpen] = useState(false);
  const [mode, setMode] = useState<"satellite" | "street">("satellite");

  const layerOrder = [
    "aircraft", "vessels", "satellites", "earthquakes",
    "fires", "weather", "alpr", "terrain",
  ];

  const toggleLayer = (id: string) => void earth.execute({ op: "toggle", layer: id });
  const goHome = () => void earth.execute({ op: "navigate_to_location", lat: 0, lon: 10, zoom: 0.5 });

  const zoomLabel =
    state.cameraZoom < 1 ? "GLOBAL" :
    state.cameraZoom < 2.5 ? "CONTINENTAL" :
    state.cameraZoom < 4 ? "COUNTRY" :
    state.cameraZoom < 6.5 ? "CITY" : "LOCAL";

  return (
    <div style={{
      position: "absolute",
      top: 12,
      left: 12,
      right: 12,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      pointerEvents: "none",
      zIndex: 20,
      fontFamily: "inherit",
    }}>
      {/* Top row: search + quick actions */}
      <div style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        pointerEvents: "auto",
      }}>
        {/* Search input */}
        <form
          onSubmit={(e) => { e.preventDefault(); onSearch(); }}
          style={{
            display: "flex",
            gap: 0,
            flex: "1 1 auto",
            maxWidth: 320,
            background: "rgba(2, 8, 23, 0.85)",
            border: "1px solid rgba(103, 232, 249, 0.2)",
            borderRadius: 999,
            overflow: "hidden",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search places…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#e0f2fe",
              fontSize: 11,
              padding: "7px 12px",
              fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            style={{
              background: "rgba(103, 232, 249, 0.15)",
              border: "none",
              color: "#a5f3fc",
              fontSize: 11,
              padding: "7px 10px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >🔍</button>
        </form>

        {/* Map mode toggle */}
        <button
          type="button"
          onClick={() => setMode((m) => m === "satellite" ? "street" : "satellite")}
          style={pillBtn(mode === "satellite")}
        >
          {mode === "satellite" ? "🛰 SATELLITE" : "🗺 MAP"}
        </button>

        {/* Zoom controls */}
        <div style={{
          display: "flex",
          background: "rgba(2, 8, 23, 0.85)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 8,
          overflow: "hidden",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
          <button
            type="button"
            onClick={() => void earth.execute({ op: "set_camera", lat: state.camera?.lat ?? 0, lon: state.camera?.lon ?? 10, zoom: Math.min(7, state.cameraZoom + 1) })}
            style={zoomBtn}
          >+</button>
          <div style={{ width: 1, background: "rgba(255,255,255,0.1)" }} />
          <button
            type="button"
            onClick={() => void earth.execute({ op: "set_camera", lat: state.camera?.lat ?? 0, lon: state.camera?.lon ?? 10, zoom: Math.max(0.5, state.cameraZoom - 1) })}
            style={zoomBtn}
          >−</button>
        </div>

        {/* Home / whole planet */}
        <button type="button" onClick={goHome} style={pillBtn(false)}>
          🌍
        </button>

        {/* Layers toggle */}
        <button
          type="button"
          onClick={() => setLayersOpen((v) => !v)}
          style={pillBtn(layersOpen)}
        >
          ◧ LAYERS
        </button>

        {/* Zoom level indicator */}
        <span style={{
          fontSize: 9,
          letterSpacing: "0.08em",
          color: "#a5f3fc",
          background: "rgba(2, 8, 23, 0.78)",
          border: "1px solid rgba(103,232,249,0.2)",
          borderRadius: 999,
          padding: "5px 10px",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}>
          {zoomLabel} · zoom {state.cameraZoom.toFixed(1)}
        </span>
      </div>

      {/* Layers panel — collapsible strip below search */}
      {layersOpen ? (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          pointerEvents: "auto",
          background: "rgba(2, 8, 23, 0.88)",
          border: "1px solid rgba(103, 232, 249, 0.15)",
          borderRadius: 10,
          padding: "6px 8px",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
          {layerOrder.map((id) => {
            const layer = state.layers[id];
            if (!layer) return null;
            const enabled = layer.enabled;
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleLayer(id)}
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1px solid ${enabled ? layer.color + "99" : "rgba(255,255,255,0.15)"}`,
                  background: enabled ? layer.color + "22" : "rgba(255,255,255,0.03)",
                  color: enabled ? layer.color : "#94a3b8",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {layer.glyph} {layer.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Search results — compact dropdown */}
      {state.searchResults.length > 0 && state.searchQuery ? (
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          maxWidth: 340,
          background: "rgba(2, 8, 23, 0.92)",
          border: "1px solid rgba(103, 232, 249, 0.2)",
          borderRadius: 10,
          padding: 6,
          pointerEvents: "auto",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
          {state.searchResults.slice(0, 5).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void earth.execute({ op: "navigate_to_location", lat: r.lat, lon: r.lon, zoom: 5 })}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "5px 8px",
                borderRadius: 7,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.03)",
                color: "#dbeafe",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <strong>{r.name}</strong>
              {r.country ? <span style={{ opacity: 0.6 }}> · {r.country}</span> : null}
              <div style={{ opacity: 0.45, fontSize: 9.5 }}>
                {r.featureType} · {r.lat.toFixed(3)}°, {r.lon.toFixed(3)}°
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
 * Entity info panel — ONE panel for selected/tracked entity
 * ------------------------------------------------------------------ */

const VESSEL_NAV_STATUS: Record<number, string> = {
  0: "Under way", 1: "At anchor", 2: "Not under command",
  3: "Restricted manoeuvrability", 4: "Constrained by draught",
  5: "Moored", 6: "Aground", 7: "Fishing", 8: "Under way sailing",
};

function EntityInfoPanel({
  entity,
  tracked,
  onTrack,
  onStopTracking,
  onClose,
}: {
  entity: SpatialEntity;
  tracked: boolean;
  onTrack: () => void;
  onStopTracking: () => void;
  onClose: () => void;
}) {
  const m = entity.metadata ?? {};
  const rows: Array<[string, string]> = [];

  // Type-specific telemetry
  if (typeof m.altitudeFt === "number") rows.push(["Altitude", `${Math.round(m.altitudeFt).toLocaleString()} ft`]);
  if (typeof m.groundSpeedKt === "number") rows.push(["Speed", `${Math.round(m.groundSpeedKt)} kt`]);
  if (typeof m.trackDeg === "number") rows.push(["Heading", `${Math.round(m.trackDeg)}°`]);
  if (m.squawk) rows.push(["Squawk", String(m.squawk)]);
  if (typeof m.magnitude === "number") rows.push(["Magnitude", `M${m.magnitude.toFixed(1)}`]);
  if (typeof m.depthKm === "number") rows.push(["Depth", `${m.depthKm.toFixed(1)} km`]);
  if (typeof m.temperatureC === "number") rows.push(["Temperature", `${Math.round(m.temperatureC)}°C`]);
  if (typeof m.windKph === "number") rows.push(["Wind", `${Math.round(m.windKph)} km/h`]);
  if (typeof m.inclinationDeg === "number") rows.push(["Inclination", `${Math.round(m.inclinationDeg)}°`]);
  if (m.operator) rows.push(["Operator", String(m.operator)]);
  if (typeof m.direction === "string") rows.push(["Faces", `${m.direction}${typeof m.directionDeg === "number" ? ` (${Math.round(m.directionDeg)}°)` : ""}`]);
  if (m.mmsi !== undefined) rows.push(["MMSI", String(m.mmsi)]);
  if (typeof m.sogKt === "number") rows.push(["Speed", `${m.sogKt.toFixed(1)} kt`]);
  if (typeof m.cogDeg === "number") rows.push(["Course", `${Math.round(m.cogDeg)}°`]);
  if (typeof m.navStatus === "number") rows.push(["Status", VESSEL_NAV_STATUS[m.navStatus] ?? `Code ${m.navStatus}`]);
  if (m.destination) rows.push(["Destination", String(m.destination)]);
  if (m.callsign) rows.push(["Call sign", String(m.callsign)]);
  if (typeof m.brightnessK === "number") rows.push(["Brightness", `${Math.round(m.brightnessK)} K`]);
  if (typeof m.frpMw === "number") rows.push(["Fire power", `${m.frpMw.toFixed(1)} MW`]);
  if (m.satellite) rows.push(["Satellite", String(m.satellite)]);

  const TYPE_GLYPH: Record<string, string> = {
    aircraft: "✈", vessel: "⛴", satellite: "🛰", earthquake: "≋",
    fire: "🔥", weather: "☁", alpr: "◈", place: "◎",
  };
  const TYPE_COLOR: Record<string, string> = {
    aircraft: "#7dd3fc", vessel: "#5eead4", satellite: "#c4b5fd",
    earthquake: "#fca5a5", fire: "#fdba74", weather: "#a5f3fc",
    alpr: "#f472b6", place: "#fef08a",
  };

  const color = TYPE_COLOR[entity.type] ?? "#94a3b8";
  const glyph = TYPE_GLYPH[entity.type] ?? "●";

  return (
    <div style={{
      position: "absolute",
      bottom: 16,
      right: 16,
      width: 280,
      maxHeight: "calc(100vh - 120px)",
      overflowY: "auto",
      background: "rgba(2, 8, 23, 0.92)",
      border: `1px solid ${color}44`,
      borderRadius: 12,
      padding: 0,
      color: "#e0f2fe",
      fontFamily: "inherit",
      fontSize: 11,
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      zIndex: 20,
      pointerEvents: "auto",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px 8px",
        borderBottom: `1px solid ${color}22`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>{glyph}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#f0f9ff" }}>
              {entity.name}
            </div>
            <div style={{ fontSize: 9.5, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {entity.type}{entity.estimated ? " · estimated" : ""}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "none",
            borderRadius: 999,
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 12,
          }}
        >×</button>
      </div>

      {/* Telemetry rows */}
      {rows.length > 0 ? (
        <div style={{ padding: "8px 12px" }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "2px 0",
              fontSize: 10.5,
            }}>
              <span style={{ opacity: 0.5 }}>{label}</span>
              <span style={{ fontWeight: 600, color: "#dbeafe" }}>{value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Coordinates */}
      <div style={{ padding: "4px 12px 8px", fontSize: 9.5, opacity: 0.4 }}>
        {entity.location.lat.toFixed(4)}°, {entity.location.lon.toFixed(4)}°
      </div>

      {/* Actions */}
      <div style={{
        display: "flex",
        gap: 4,
        padding: "8px 12px 10px",
        borderTop: `1px solid ${color}15`,
      }}>
        {tracked ? (
          <button type="button" onClick={onStopTracking} style={actionBtn("#f87171")}>
            ■ Stop Tracking
          </button>
        ) : (
          <button type="button" onClick={onTrack} style={actionBtn(color)}>
            ◉ Track
          </button>
        )}
        <button
          type="button"
          onClick={() => void EarthCore.getInstance().execute({
            op: "navigate_to_location",
            lat: entity.location.lat,
            lon: entity.location.lon,
            zoom: 6,
          })}
          style={actionBtn("#a5f3fc")}
        >
          ◎ Zoom To
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Place / location badge — bottom-left, compact
 * ------------------------------------------------------------------ */

function PlaceBadge({ state }: { state: EarthState }) {
  const place = state.placeContext;
  const camera = state.camera;
  if (!place && !camera) return null;

  const text = place
    ? `◈ ${place.name}${place.admin1 ? `, ${place.admin1}` : ""}${place.country ? `, ${place.country}` : ""}`
    : `◎ ${camera!.lat.toFixed(3)}°, ${camera!.lon.toFixed(3)}°`;

  const tracked = state.trackedEntityId
    ? state.entities.find((e) => e.id === state.trackedEntityId)
    : null;

  return (
    <div style={{
      position: "absolute",
      bottom: 16,
      left: 16,
      display: "flex",
      flexDirection: "column",
      gap: 4,
      pointerEvents: "none",
      zIndex: 15,
      fontFamily: "inherit",
    }}>
      <span style={{
        fontSize: 10.5,
        color: "#cfeefc",
        background: "rgba(2, 8, 23, 0.78)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 999,
        padding: "5px 10px",
        whiteSpace: "nowrap",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}>
        {text}
      </span>
      {tracked ? (
        <span style={{
          fontSize: 9.5,
          color: "#a5f3fc",
          background: "rgba(2, 8, 23, 0.78)",
          border: "1px solid rgba(103,232,249,0.2)",
          borderRadius: 999,
          padding: "3px 8px",
          whiteSpace: "nowrap",
        }}>
          ◉ Tracking {tracked.name}{tracked.estimated ? " (est.)" : ""}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
 * Attribution badge — bottom-right corner, minimal
 * ------------------------------------------------------------------ */

function AttributionBadge() {
  return (
    <div style={{
      position: "absolute",
      bottom: 4,
      right: 8,
      fontSize: 8,
      color: "rgba(255,255,255,0.55)",
      pointerEvents: "none",
      zIndex: 10,
    }}>
      Imagery © Esri · © OpenStreetMap
    </div>
  );
}

/* ------------------------------------------------------------------
 * Main component — the Eagle Eye Earth surface
 * ------------------------------------------------------------------ */

export default function GenesisEarthCore({ onClose: _onClose }: { onClose: () => void }) {
  const earth = useMemo(() => EarthCore.getInstance(), []);
  const [state, setState] = useState<EarthState>(() => earth.getState());
  const [search, setSearch] = useState("");

  useEffect(() => earth.subscribe(() => setState(earth.getState())), [earth]);

  useEffect(() => {
    earth.activate();
    return () => earth.deactivate();
  }, [earth]);

  const onSearch = useCallback(() => {
    if (!search.trim()) return;
    void earth.execute({ op: "search_places", query: search });
  }, [earth, search]);

  const selected = state.selectedEntityId
    ? state.entities.find((e) => e.id === state.selectedEntityId) ?? null
    : null;

  return (
    <div
      data-lelu-eagle-eye
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#020617",
      }}
    >
      {/* THE MAP — fills the entire viewport, no borders, no container */}
      <div style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}>
        <GenesisEarthMap earth={earth} state={state} />
      </div>

      {/* Floating controls — above the map, never blocking gestures */}
      <EagleEyeControls
        state={state}
        earth={earth}
        search={search}
        setSearch={setSearch}
        onSearch={onSearch}
      />

      {/* Place / location badge — bottom-left */}
      <PlaceBadge state={state} />

      {/* Attribution — bottom-right corner */}
      <AttributionBadge />

      {/* Entity info panel — ONE panel for selected entity */}
      {selected ? (
        <EntityInfoPanel
          entity={selected}
          tracked={state.trackedEntityId === selected.id}
          onTrack={() => void earth.execute({ op: "track_entity", id: selected.id })}
          onStopTracking={() => void earth.execute({ op: "stop_tracking" })}
          onClose={() => void earth.execute({ op: "select_entity", id: "" })}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
 * Shared styles
 * ------------------------------------------------------------------ */

const pillBtn = (active: boolean): React.CSSProperties => ({
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  padding: "6px 10px",
  borderRadius: 999,
  border: active
    ? "1px solid rgba(103,232,249,0.6)"
    : "1px solid rgba(255,255,255,0.15)",
  background: active
    ? "rgba(103,232,249,0.15)"
    : "rgba(2, 8, 23, 0.85)",
  color: active ? "#a5f3fc" : "#cbd5e1",
  cursor: "pointer",
  fontFamily: "inherit",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  whiteSpace: "nowrap",
});

const zoomBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  border: "none",
  background: "transparent",
  color: "#e0f2fe",
  fontSize: 16,
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const actionBtn = (color: string): React.CSSProperties => ({
  flex: 1,
  fontSize: 10,
  fontWeight: 600,
  padding: "5px 8px",
  borderRadius: 7,
  border: `1px solid ${color}44`,
  background: `${color}15`,
  color,
  cursor: "pointer",
  fontFamily: "inherit",
});
