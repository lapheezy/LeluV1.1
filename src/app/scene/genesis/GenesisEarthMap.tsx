import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { EarthState, SpatialEntity } from "../../../core/earth/EarthTypes";
import type EarthCore from "../../../core/earth/EarthCore";

const TILE_SIZE = 256;
// Full OpenStreetMap zoom range — 19 is street/GPS-level detail (roads,
// buildings, labels). The Earth Core is a real map, not a low-res globe.
// Zoom 1 (4 tiles) shows the ENTIRE planet at once — the Eagle Eye
// whole-Earth view.
const MAX_TILE_ZOOM = 19;
const MIN_TILE_ZOOM = 1;
const MAP_PADDING_TILES = 2;

type MapMode = "street" | "satellite";

type Point = { x: number; y: number };

function clampLatitude(lat: number): number {
  return Math.max(-85.0511, Math.min(85.0511, lat));
}

function wrapLongitude(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

function project(lat: number, lon: number, zoom: number): Point {
  const size = worldSize(zoom);
  const latitude = (clampLatitude(lat) * Math.PI) / 180;
  return {
    x: ((wrapLongitude(lon) + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * size,
  };
}

function unproject(point: Point, zoom: number): { lat: number; lon: number } {
  const size = worldSize(zoom);
  const x = ((point.x % size) + size) % size;
  const y = Math.max(0, Math.min(size, point.y));
  const lon = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lon: wrapLongitude(lon) };
}

function tileUrl(mode: MapMode, zoom: number, x: number, y: number): string {
  if (mode === "satellite") {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
  }
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

function entityColor(entity: SpatialEntity): string {
  switch (entity.type) {
    case "aircraft": return "#7dd3fc";
    case "vessel": return "#5eead4";
    case "satellite": return "#c4b5fd";
    case "earthquake": return "#fca5a5";
    case "fire": return "#fdba74";
    case "weather": return "#a5f3fc";
    case "alpr": return "#f472b6";
    default: return "#fef08a";
  }
}

function alprDirectionDeg(entity: SpatialEntity): number | null {
  const value = (entity.metadata ?? {}).directionDeg;
  return typeof value === "number" ? value : null;
}

function visibleEntities(state: EarthState): SpatialEntity[] {
  return state.entities.filter((entity) => {
    const layer = Object.values(state.layers).find((candidate) => candidate.entityType === entity.type);
    return layer?.enabled ?? false;
  }).slice(-240);
}

export default function GenesisEarthMap({ earth, state }: { earth: EarthCore; state: EarthState }) {
  // Satellite imagery is the default: opening the Earth Core is opening
  // an exact replica of the planet. Street/OSM (every geographical feature:
  // roads, borders, labels) is one toggle, down to GPS level.
  const [mode, setMode] = useState<MapMode>("satellite");
  const [tileErrors, setTileErrors] = useState(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; center: Point } | null>(null);
  const camera = state.camera ?? { lat: 18, lon: 10 };
  // Map the Earth Core's 0..7 zoom range onto the full tile range so the
  // user can zoom all the way out to the WHOLE PLANET (zoom 1) and all the
  // way down to street/GPS level (zoom 19) on the same map.
  const zoom = Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, Math.round(state.cameraZoom * 2.7)));
  const center = useMemo(() => project(camera.lat, camera.lon, zoom), [camera.lat, camera.lon, zoom]);
  const entities = useMemo(() => visibleEntities(state), [state.entities, state.layers]);
  const tileCount = 2 ** zoom;
  const centerTileX = Math.floor(center.x / TILE_SIZE);
  const centerTileY = Math.floor(center.y / TILE_SIZE);
  const tileKeys = useMemo(() => {
    const tiles: Array<{ key: string; x: number; y: number; left: number; top: number }> = [];
    for (let y = centerTileY - MAP_PADDING_TILES; y <= centerTileY + MAP_PADDING_TILES; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      for (let x = centerTileX - MAP_PADDING_TILES; x <= centerTileX + MAP_PADDING_TILES; x += 1) {
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        // Raw x in the key keeps wrap-around duplicates distinct (visible
        // at whole-planet zoom where a wrapped tile repeats on both edges).
        tiles.push({
          key: `${zoom}/${wrappedX}/${y}/${x}`,
          x: wrappedX,
          y,
          left: x * TILE_SIZE - center.x,
          top: y * TILE_SIZE - center.y,
        });
      }
    }
    return tiles;
  }, [center.x, center.y, centerTileX, centerTileY, tileCount, zoom]);

  const cameraCommand = (lat: number, lon: number, nextZoom = state.cameraZoom) => {
    void earth.execute({ op: "set_camera", lat, lon, zoom: nextZoom });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, center };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scale = worldSize(zoom) / 360;
    const next = unproject({ x: drag.center.x - (event.clientX - drag.startX), y: drag.center.y - (event.clientY - drag.startY) }, zoom);
    cameraCommand(next.lat, next.lon, state.cameraZoom);
    // Keep a small scale reference so the event is treated as a map gesture,
    // not as page scrolling, even on iPhone Safari.
    void scale;
  };

  const endPointer = () => {
    dragRef.current = null;
  };

  const setZoom = (delta: number) => {
    const next = Math.max(0.5, Math.min(7, state.cameraZoom + delta));
    cameraCommand(camera.lat, camera.lon, next);
  };

  // Eagle Eye whole-planet view: one tap from anywhere zooms all the way
  // out to the entire Earth as a single exact-replica image.
  const wholePlanet = () => {
    setMode("satellite");
    void earth.execute({ op: "set_camera", lat: 0, lon: 10, zoom: 0.5 });
  };

  return (
    <div
      data-lelu-earth-map
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: mode === "satellite" ? "#07111b" : "#d8e8f0",
        cursor: dragRef.current ? "grabbing" : "grab",
        touchAction: "none",
        userSelect: "none",
      }}
      aria-label="Interactive Earth map"
    >
      <div style={{ position: "absolute", left: "50%", top: "50%", width: TILE_SIZE, height: TILE_SIZE, transform: "translate(-50%, -50%)" }}>
        {tileKeys.map((tile) => (
          <img
            key={tile.key}
            src={tileUrl(mode, zoom, tile.x, tile.y)}
            alt=""
            draggable={false}
            onError={() => setTileErrors((count) => count + 1)}
            style={{
              position: "absolute",
              left: tile.left,
              top: tile.top,
              width: TILE_SIZE,
              height: TILE_SIZE,
              maxWidth: "none",
              pointerEvents: "none",
              imageRendering: "auto",
            }}
          />
        ))}
      </div>

      {entities.map((entity) => {
        const point = project(entity.location.lat, entity.location.lon, zoom);
        const left = ((point.x - center.x + worldSize(zoom) / 2) % worldSize(zoom)) - worldSize(zoom) / 2;
        const top = point.y - center.y;
        const color = entityColor(entity);
        const selected = entity.id === state.selectedEntityId;
        const alprDir = alprDirectionDeg(entity);
        const meta = entity.metadata ?? {};
        const detail = [
          entity.type === "alpr" ? "ALPR camera" : entity.type,
          typeof meta.operator === "string" ? meta.operator : null,
          alprDir !== null ? `faces ${Math.round(alprDir)}°` : typeof meta.direction === "string" ? `faces ${meta.direction}` : null,
        ].filter(Boolean).join(" · ");
        return (
          <button
            key={entity.id}
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void earth.execute({ op: "select_entity", id: entity.id });
            }}
            title={`${entity.name} · ${detail}`}
            style={{
              position: "absolute",
              left: `calc(50% + ${left}px)`,
              top: `calc(50% + ${top}px)`,
              width: selected ? 18 : 12,
              height: selected ? 18 : 12,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              border: `2px solid ${selected ? "#fff" : color}`,
              background: color,
              boxShadow: `0 0 ${selected ? 14 : 7}px ${color}`,
              padding: 0,
              cursor: "pointer",
              zIndex: selected ? 5 : 3,
            }}
          >
            {/* ALPR direction indicator — the direction the camera faces */}
            {entity.type === "alpr" && alprDir !== null ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 0,
                  height: 0,
                  transform: `translate(-50%, -50%) rotate(${alprDir}deg)`,
                  borderLeft: "4px solid transparent",
                  borderRight: "4px solid transparent",
                  borderBottom: `8px solid ${selected ? "#fff" : "rgba(2,8,23,0.9)"}`,
                  pointerEvents: "none",
                }}
              />
            ) : null}
          </button>
        );
      })}

      <div style={{ position: "absolute", left: 10, top: 10, display: "flex", gap: 6, flexWrap: "wrap", pointerEvents: "auto" }}>
        <button type="button" onClick={(event) => { event.stopPropagation(); setMode("street"); }} style={mapButton(mode === "street")}>MAP</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); setMode("satellite"); }} style={mapButton(mode === "satellite")}>SATELLITE</button>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); wholePlanet(); }}
          title="Zoom out to the whole planet — exact Earth replica"
          style={{
            ...mapButton(false),
            border: "1px solid rgba(253,224,71,0.55)",
            color: "#fde68a",
          }}
        >
          🌍 WHOLE PLANET
        </button>
      </div>
      <div style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", gap: 4, pointerEvents: "auto" }}>
        <button type="button" onClick={(event) => { event.stopPropagation(); setZoom(1); }} style={zoomButton}>+</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); setZoom(-1); }} style={zoomButton}>−</button>
      </div>
      <div style={{ position: "absolute", left: 10, bottom: 10, maxWidth: "calc(100% - 20px)", display: "flex", flexWrap: "wrap", gap: 5, pointerEvents: "none" }}>
        <span style={mapBadge}>{mode === "satellite" ? "Esri World Imagery" : "OpenStreetMap"} · zoom {zoom}</span>
        <span style={mapBadge}>{camera.lat.toFixed(3)}°, {camera.lon.toFixed(3)}°</span>
        {tileErrors > 0 ? <span style={{ ...mapBadge, color: "#fde68a" }}>Some tiles unavailable — map data remains interactive</span> : null}
      </div>
      <div style={{ position: "absolute", right: 8, bottom: 6, fontSize: 8.5, color: mode === "satellite" ? "rgba(255,255,255,0.75)" : "rgba(15,23,42,0.75)", pointerEvents: "none" }}>
        {mode === "satellite" ? "Imagery © Esri" : "© OpenStreetMap contributors"}
      </div>
    </div>
  );
}

const mapButton = (active: boolean): React.CSSProperties => ({
  border: active ? "1px solid rgba(103,232,249,0.8)" : "1px solid rgba(255,255,255,0.25)",
  background: active ? "rgba(8,70,96,0.88)" : "rgba(2,8,23,0.78)",
  color: "#e0f2fe",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.08em",
  cursor: "pointer",
});

const zoomButton: React.CSSProperties = {
  width: 30,
  height: 30,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(2,8,23,0.78)",
  color: "#e0f2fe",
  borderRadius: 7,
  fontSize: 18,
  cursor: "pointer",
};

const mapBadge: React.CSSProperties = {
  borderRadius: 999,
  padding: "4px 8px",
  fontSize: 9,
  color: "#e0f2fe",
  background: "rgba(2,8,23,0.76)",
  border: "1px solid rgba(125,211,252,0.25)",
};
