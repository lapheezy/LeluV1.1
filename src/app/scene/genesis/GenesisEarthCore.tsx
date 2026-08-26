/**
 * ==========================================================
 * LÉLU — EARTH CORE · GENUI SURFACE
 *
 * LÉLU's native spatial intelligence surface. This is NOT a
 * separate application — it is a capability rendered inside
 * the unified LÉLU environment, driven entirely by the
 * canonical EarthCore singleton (the same state Chat, voice,
 * cognition and tools read and command).
 *
 *  • 3D Earth with a REAL day/night terminator (solar position)
 *  • Real Earth imagery (NASA Blue Marble via the three.js
 *    example asset) with a graceful procedural fallback
 *  • Real terrain displacement (GeoPipeline terrarium tiles)
 *  • Live entity layers — aircraft (adsb.lol), satellites
 *    (CelesTrak, positions labeled estimated), earthquakes
 *    (USGS), weather (Open-Meteo), fires (NASA FIRMS), and
 *    vessels (AISStream via the server-side bridge)
 *  • Global place search / geocoding + camera fly-to
 *  • Selection, tracking, follow, trails
 *  • Freshness + provider status for every layer
 *  • Live execution strip fed by the SAME AgentEventBus the
 *    chat timeline subscribes to
 * ==========================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import GenesisEarthMap from "./GenesisEarthMap";
import EarthCore, { sunDirectionEcef } from "../../../core/earth/EarthCore";
import {
  earthDistanceKm,
  type EarthState,
  type SpatialEntity,
  type SpatialSearchResult,
} from "../../../core/earth/EarthTypes";
import AgentEventBus from "../../../core/agent/AgentEvents";
import {
  elevationAtLatLon,
  warmElevationAround,
} from "./render/GeoPipeline";

const RADIUS = 1.9;
const DEG = Math.PI / 180;

function latLonToDir(lat: number, lon: number): THREE.Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
}

function dirToLatLon(dir: THREE.Vector3): { lat: number; lon: number } {
  const n = dir.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) / DEG;
  const lon = ((Math.atan2(n.z, -n.x) / DEG) - 180 + 540) % 360 - 180;
  return { lat, lon };
}

function cameraDistanceForZoom(zoom: number): number {
  return RADIUS + 2.1 + zoom * 0.55;
}

/* ------------------------------------------------------------------
 * Globe — real imagery + real day/night terminator + terrain
 * ------------------------------------------------------------------ */

function EarthGlobe({ terrain }: { terrain: boolean }) {
  const sphereRef = useRef<THREE.Mesh>(null);
  const terrainRef = useRef(0);
  const { camera } = useThree();
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  const tmpVertex = useMemo(() => new THREE.Vector3(), []);
  const [map, setMap] = useState<THREE.Texture | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const texture = loader.load(
      // NASA Blue Marble imagery (public domain), served by the three.js
      // example asset host. Falls back to the procedural shader offline.
      "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
      () => {
        if (alive) setMapReady(true);
      },
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    setMap(texture);
    return () => {
      alive = false;
    };
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          sunDir: { value: new THREE.Vector3(0, 1, 0) },
          map: { value: null as THREE.Texture | null },
          hasMap: { value: 0 },
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPosition;
          varying vec2 vUv;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vPosition = position;
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 sunDir;
          uniform sampler2D map;
          uniform float hasMap;
          varying vec3 vNormal;
          varying vec3 vPosition;
          varying vec2 vUv;
          void main() {
            vec3 n = normalize(vNormal);
            float d = dot(n, normalize(sunDir));
            float day = smoothstep(-0.14, 0.38, d);
            vec3 tex = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.02, 0.11, 0.2);
            vec3 night = vec3(0.006, 0.016, 0.04);
            vec3 col = mix(night, tex, day);
            // thin atmosphere rim on the terminator
            float rim = pow(1.0 - max(d, 0.0), 3.0);
            col += vec3(0.06, 0.3, 0.5) * rim * 0.3;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );

  useEffect(() => {
    material.uniforms.map.value = map;
    material.uniforms.hasMap.value = mapReady ? 1 : 0;
    material.needsUpdate = true;
  }, [map, mapReady, material]);

  useFrame(({ clock }) => {
    const sun = sunDirectionEcef(Date.now());
    material.uniforms.sunDir.value.set(sun.x, sun.y, sun.z);

    // Real terrain displacement from Mapzen Terrarium tiles, throttled.
    const mesh = sphereRef.current;
    if (!mesh || !terrain) return;
    if (clock.elapsedTime - terrainRef.current < 2.5) return;
    terrainRef.current = clock.elapsedTime;
    const geometry = mesh.geometry as THREE.SphereGeometry;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    tmpDir.copy(camera.position).normalize();
    const { lat, lon } = dirToLatLon(tmpDir);
    warmElevationAround(lat, lon, 7, 1);
    for (let i = 0; i < pos.count; i++) {
      tmpVertex.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const ll = dirToLatLon(tmpVertex);
      const elev = elevationAtLatLon(ll.lat, ll.lon, 7);
      const r = RADIUS + (elev === null ? 0 : THREE.MathUtils.clamp(elev * 0.00002, -0.09, 0.14));
      pos.setXYZ(i, tmpVertex.x * r, tmpVertex.y * r, tmpVertex.z * r);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.attributes.normal.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={sphereRef} material={material}>
        <sphereGeometry args={[RADIUS, 96, 48]} />
      </mesh>
      {/* Atmosphere glow */}
      <mesh>
        <sphereGeometry args={[RADIUS * 1.022, 48, 24]} />
        <meshBasicMaterial
          color="#3b82f6"
          transparent
          opacity={0.14}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------
 * Markers — real entity positions on the globe
 * ------------------------------------------------------------------ */

const TYPE_COLORS: Record<string, string> = {
  aircraft: "#7dd3fc",
  vessel: "#5eead4",
  satellite: "#c4b5fd",
  earthquake: "#fca5a5",
  fire: "#fdba74",
  weather: "#a5f3fc",
  alpr: "#f472b6",
  place: "#fef08a",
};

function Marker({ entity, selected, tracked, onClick }: {
  entity: SpatialEntity;
  selected: boolean;
  tracked: boolean;
  onClick: () => void;
}) {
  const dir = latLonToDir(entity.location.lat, entity.location.lon).multiplyScalar(RADIUS + 0.01);
  const color = TYPE_COLORS[entity.type] ?? "#94a3b8";
  const size = entity.type === "earthquake" ? 0.02 : entity.type === "fire" ? 0.014 : 0.011;
  return (
    <group position={[dir.x, dir.y, dir.z]}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[tracked ? size * 2 : size, 10, 10]} />
        <meshBasicMaterial color={selected || tracked ? "#ffffff" : color} />
      </mesh>
      {selected || tracked ? (
        <mesh>
          <sphereGeometry args={[size * 2.6, 10, 10]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ) : null}
      {selected ? (
        <Html position={[0, size * 4, 0]} center distanceFactor={12} zIndexRange={[40, 0]}>
          <div
            style={{
              background: "rgba(2, 8, 23, 0.92)",
              border: `1px solid ${color}`,
              borderRadius: 8,
              padding: "4px 8px",
              fontSize: 10.5,
              color: "#e6f4ff",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              fontFamily: "inherit",
            }}
          >
            {entity.name}
            <span style={{ opacity: 0.6, marginLeft: 6 }}>{entity.type}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function Trail({ entity }: { entity: SpatialEntity }) {
  const points = useMemo(
    () =>
      (entity.trail ?? [])
        .map((p) => {
          const v = latLonToDir(p.lat, p.lon).multiplyScalar(RADIUS + 0.012);
          return [v.x, v.y, v.z] as [number, number, number];
        })
        .concat([
          (() => {
            const v = latLonToDir(entity.location.lat, entity.location.lon).multiplyScalar(RADIUS + 0.012);
            return [v.x, v.y, v.z] as [number, number, number];
          })(),
        ]),
    [entity],
  );
  if (points.length < 2) return null;
  const color = TYPE_COLORS[entity.type] ?? "#94a3b8";
  return (
    <Line
      points={points}
      color={color}
      lineWidth={1.4}
      transparent
      opacity={0.75}
      dashed={false}
    />
  );
}

function FocusMarker({ state }: { state: EarthState }) {
  const place = state.placeContext;
  const focus = state.camera;
  if (!place && !focus) return null;
  const target = place ?? { name: "", lat: focus!.lat, lon: focus!.lon };
  const dir = latLonToDir(target.lat, target.lon).multiplyScalar(RADIUS + 0.02);
  return (
    <group position={[dir.x, dir.y, dir.z]}>
      <mesh>
        <sphereGeometry args={[0.016, 12, 12]} />
        <meshBasicMaterial color="#fef08a" transparent opacity={0.9} />
      </mesh>
      {target.name ? (
        <Html position={[0, 0.08, 0]} center distanceFactor={12} zIndexRange={[30, 0]}>
          <div
            style={{
              background: "rgba(2, 8, 23, 0.85)",
              border: "1px solid rgba(254, 240, 138, 0.4)",
              borderRadius: 999,
              padding: "2px 8px",
              fontSize: 10,
              color: "#fef9c3",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              fontFamily: "inherit",
            }}
          >
            ◈ {target.name}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------------
 * Camera rig — fly-to + follow tracking
 * ------------------------------------------------------------------ */

function CameraRig({ state }: { state: EarthState }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const pending = useRef<{ pos: THREE.Vector3; look: THREE.Vector3; arrived: number } | null>(null);
  const lastFocus = useRef<string>("");
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!state.camera) return;
    const key = `${state.camera.lat.toFixed(3)}:${state.camera.lon.toFixed(3)}:${state.cameraZoom}`;
    if (key === lastFocus.current) return;
    lastFocus.current = key;
    const dir = latLonToDir(state.camera.lat, state.camera.lon);
    const dist = cameraDistanceForZoom(state.cameraZoom);
    pending.current = {
      pos: dir.clone().multiplyScalar(dist),
      look: dir.clone().multiplyScalar(RADIUS),
      arrived: 0,
    };
  }, [state.camera, state.cameraZoom]);

  useFrame((_, delta) => {
    const tracked = state.followMode && state.trackedEntityId
      ? state.entities.find((e) => e.id === state.trackedEntityId)
      : null;
    if (tracked) {
      const dir = latLonToDir(tracked.location.lat, tracked.location.lon);
      const target = dir.clone().multiplyScalar(RADIUS);
      const desired = dir.clone().multiplyScalar(RADIUS + 3.4);
      camera.position.lerp(desired, Math.min(1, delta * 2.4));
      if (controls) {
        controls.target.lerp(target, Math.min(1, delta * 4));
        controls.update();
      }
      return;
    }
    if (!pending.current) return;
    const p = pending.current;
    p.arrived += delta;
    const t = Math.min(1, p.arrived / 1.6);
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerp(p.pos, eased);
    if (controls) {
      controls.target.lerp(p.look, eased);
      controls.update();
    }
    tmp.copy(camera.position).sub(p.pos);
    if (tmp.length() < 0.05 && t >= 1) {
      pending.current = null;
    }
  });

  return null;
}

/* ------------------------------------------------------------------
 * The 3D scene
 * ------------------------------------------------------------------ */

function EarthScene({ state, onSelect }: { state: EarthState; onSelect: (id: string) => void }) {
  const trackedEntity = state.trackedEntityId
    ? state.entities.find((e) => e.id === state.trackedEntityId)
    : null;
  const terrainLayer = state.layers["terrain"];
  const markers = useMemo(() => {
    const visible = state.entities.filter((e) => {
      const layer = Object.values(state.layers).find(
        (l) => l.entityType === e.type,
      );
      return layer?.enabled ?? false;
    });
    // Keep rendering bounded for performance.
    return visible.slice(-240);
  }, [state.entities, state.layers]);

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 4]} intensity={1.1} color="#fff6e8" />
      <Stars radius={70} depth={45} count={1400} factor={3.2} saturation={0.4} fade speed={0.6} />
      <EarthGlobe terrain={terrainLayer?.enabled ?? false} />
      <FocusMarker state={state} />
      {markers.map((entity) => (
        <Marker
          key={entity.id}
          entity={entity}
          selected={entity.id === state.selectedEntityId}
          tracked={entity.id === state.trackedEntityId}
          onClick={() => onSelect(entity.id)}
        />
      ))}
      {trackedEntity ? <Trail entity={trackedEntity} /> : null}
      <CameraRig state={state} />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={RADIUS + 0.4}
        maxDistance={RADIUS + 24}
        makeDefault
      />
    </>
  );
}

/* ------------------------------------------------------------------
 * Panel
 * ------------------------------------------------------------------ */

// The former Three.js EarthScene remains defined only for source history;
// the mounted Earth surface below is GenesisEarthMap. Keep this explicit so
// it can never be mistaken for a second active Earth renderer.
void EarthScene;

const PANEL_COLORS: Record<string, string> = {
  live: "#34d399",
  loading: "#fbbf24",
  error: "#f87171",
  not_configured: "#fbbf24",
  idle: "#64748b",
  updated: "#38bdf8",
  disconnected: "#f87171",
  rate_limited: "#fbbf24",
  auth_error: "#f87171",
  unavailable: "#94a3b8",
};

export default function GenesisEarthCore({ onClose: _onClose }: { onClose: () => void }) {
  const earth = useMemo(() => EarthCore.getInstance(), []);
  const [state, setState] = useState<EarthState>(() => earth.getState());
  const [query, setQuery] = useState("");
  const [spatialLog, setSpatialLog] = useState<Array<{ label: string; side: string; at: number }>>([]);
  // The Earth Core opens in dive/immersive mode: it IS the LÉLU core, and
  // the whole planet should be the first thing the user sees.
  const [dive, setDive] = useState(true);

  useEffect(() => earth.subscribe(() => setState(earth.getState())), [earth]);

  useEffect(() => {
    earth.activate();
    return () => earth.deactivate();
  }, [earth]);

  useEffect(() => {
    const bus = AgentEventBus.getInstance();
    return bus.subscribe((event) => {
      if (event.type !== "spatial_event") return;
      setSpatialLog((prev) =>
        [{ label: event.label, side: event.side ?? "both", at: Date.now() }, ...prev].slice(0, 6),
      );
    });
  }, []);

  const runSearch = async () => {
    if (!query.trim()) return;
    await earth.execute({ op: "search_places", query });
  };

  const toggleLayer = (id: string) => void earth.execute({ op: "toggle", layer: id });
  // Home = the whole planet (Eagle Eye view of the exact Earth replica).
  const goHome = () => void earth.execute({ op: "navigate_to_location", lat: 0, lon: 10, zoom: 0.5 });

  // One Earth at every zoom — the HUD names the current geographic detail
  // level so zooming is visibly progressive on the SAME renderer.
  const zoomLabel =
    state.cameraZoom < 1
      ? "GLOBAL"
      : state.cameraZoom < 2.5
        ? "CONTINENTAL"
        : state.cameraZoom < 4
          ? "COUNTRY"
          : state.cameraZoom < 6.5
            ? "CITY"
            : "LOCAL";

  const layerOrder = ["aircraft", "vessels", "satellites", "earthquakes", "fires", "weather", "alpr", "terrain"];
  const providerStatus = state.providerStatus;
  const selected = state.selectedEntityId
    ? state.entities.find((e) => e.id === state.selectedEntityId) ?? null
    : null;
  const tracked = state.trackedEntityId
    ? state.entities.find((e) => e.id === state.trackedEntityId) ?? null
    : null;

  const visibleEntities = state.entities.filter((e) => {
    const layer = Object.values(state.layers).find((l) => l.entityType === e.type);
    return layer?.enabled ?? false;
  });

  const renderResult = (r: SpatialSearchResult) => (
    <button
      key={r.id}
      type="button"
      onClick={() =>
        void earth.execute({ op: "navigate_to_location", lat: r.lat, lon: r.lon, zoom: 5 })
      }
      style={{
        width: "100%",
        textAlign: "left",
        padding: "6px 8px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        color: "#dbeafe",
        fontSize: 11.5,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <strong>{r.name}</strong>
      {r.country ? <span style={{ opacity: 0.65 }}> · {r.country}</span> : null}
      <div style={{ opacity: 0.5, fontSize: 10 }}>
        {r.featureType} · {r.lat.toFixed(3)}°, {r.lon.toFixed(3)}° · {r.source}
      </div>
    </button>
  );

  const VESSEL_NAV_STATUS: Record<number, string> = {
    0: "Under way",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuvrability",
    4: "Constrained by draught",
    5: "Moored",
    6: "Aground",
    7: "Fishing",
    8: "Under way sailing",
    12: "Reserved",
  };

  const telemetryRows = (entity: SpatialEntity) => {
    const m = entity.metadata ?? {};
    const rows: Array<[string, string]> = [];
    if (typeof m.altitudeFt === "number") rows.push(["Altitude", `${Math.round(m.altitudeFt).toLocaleString()} ft`]);
    if (typeof m.groundSpeedKt === "number") rows.push(["Speed", `${Math.round(m.groundSpeedKt)} kt`]);
    if (typeof m.trackDeg === "number") rows.push(["Heading", `${Math.round(m.trackDeg)}°`]);
    if (m.squawk) rows.push(["Squawk", String(m.squawk)]);
    if (typeof m.magnitude === "number") rows.push(["Magnitude", `M${m.magnitude.toFixed(1)}`]);
    if (typeof m.depthKm === "number") rows.push(["Depth", `${m.depthKm.toFixed(1)} km`]);
    if (typeof m.temperatureC === "number") rows.push(["Temperature", `${Math.round(m.temperatureC)}°C`]);
    if (typeof m.windKph === "number") rows.push(["Wind", `${Math.round(m.windKph)} km/h`]);
    if (typeof m.inclinationDeg === "number") rows.push(["Inclination", `${Math.round(m.inclinationDeg)}°`]);
    // Deflock / ALPR cameras — OpenStreetMap camera infrastructure
    if (m.operator) rows.push(["Operator", String(m.operator)]);
    if (typeof m.direction === "string") rows.push(["Faces", `${m.direction}${typeof m.directionDeg === "number" ? ` (${Math.round(m.directionDeg)}°)` : ""}`]);
    if (m.mount) rows.push(["Mount", String(m.mount)]);
    if (m.zone) rows.push(["Zone", String(m.zone)]);
    if (m.cameraNumber) rows.push(["Camera #", String(m.cameraNumber)]);
    if (m.heightM) rows.push(["Height", `${m.heightM} m`]);
    if (m.startDate) rows.push(["Installed", String(m.startDate)]);
    if (typeof m.distanceToRouteKm === "number") rows.push(["From route", `${m.distanceToRouteKm} km`]);
    if (m.source && m.source !== "OpenStreetMap") rows.push(["Source", String(m.source)]);
    // Vessels — AISStream
    if (m.mmsi !== undefined) rows.push(["MMSI", String(m.mmsi)]);
    if (typeof m.sogKt === "number") rows.push(["Speed", `${m.sogKt.toFixed(1)} kt`]);
    if (typeof m.cogDeg === "number") rows.push(["Course", `${Math.round(m.cogDeg)}°`]);
    if (typeof m.headingDeg === "number") rows.push(["Heading", `${Math.round(m.headingDeg)}°`]);
    if (typeof m.navStatus === "number") rows.push(["Status", VESSEL_NAV_STATUS[m.navStatus] ?? `Code ${m.navStatus}`]);
    if (typeof m.shipType === "number") rows.push(["Ship type", String(m.shipType)]);
    if (m.destination) rows.push(["Destination", String(m.destination)]);
    if (m.callsign) rows.push(["Call sign", String(m.callsign)]);
    if (typeof m.lastUpdate === "number") rows.push(["Last fix", new Date(m.lastUpdate).toLocaleTimeString()]);
    // Fires — NASA FIRMS
    if (typeof m.brightnessK === "number") rows.push(["Brightness", `${Math.round(m.brightnessK)} K`]);
    if (m.confidence !== undefined) {
      const conf =
        typeof m.confidence === "number"
          ? `${m.confidence}%`
          : String(m.confidence).toLowerCase() === "n"
            ? "Nominal"
            : String(m.confidence).toLowerCase() === "h"
              ? "High"
              : String(m.confidence).toLowerCase() === "l"
                ? "Low"
                : String(m.confidence);
      rows.push(["Confidence", conf]);
    }
    if (typeof m.frpMw === "number") rows.push(["Fire power", `${m.frpMw.toFixed(1)} MW`]);
    if (m.daynight) rows.push(["Day/night", m.daynight === "D" ? "Day" : "Night"]);
    if (m.satellite) rows.push(["Satellite", String(m.satellite)]);
    if (m.acqDate) rows.push(["Detected (UTC)", `${m.acqDate} ${m.acqTime ?? ""}`.trim()]);
    if (m.note) rows.push(["Note", String(m.note)]);
    return rows;
  };

  return (
    <div
      data-lelu-earth-core
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 0,
        width: "100%",
        color: "white",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "stretch", minHeight: 0, flexDirection: typeof window !== "undefined" && window.innerWidth < 720 ? "column" : "row" }}>
        {/* ── One canonical 2D Earth surface ── */}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <div
            style={{
              position: "relative",
              height: dive ? "min(72vh, 680px)" : "clamp(240px, 48vh, 470px)",
              minHeight: 240,
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid rgba(103, 232, 249, 0.14)",
              background: "#07111b",
            }}
          >
            <GenesisEarthMap earth={earth} state={state} />

            {/* Zoom-level HUD — one renderer at every zoom + dive toggle */}
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 4,
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  letterSpacing: "0.08em",
                  color: "#a5f3fc",
                  background: "rgba(2, 8, 23, 0.78)",
                  border: "1px solid rgba(103,232,249,0.25)",
                  borderRadius: 999,
                  padding: "4px 9px",
                  pointerEvents: "none",
                }}
              >
                ◉ LÉLU CORE · EAGLE EYE · {zoomLabel} · zoom {state.cameraZoom.toFixed(1)}
              </span>
              <button
                type="button"
                onClick={() => setDive((v) => !v)}
                style={{
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  color: dive ? "#a5f3fc" : "#cbd5e1",
                  background: dive ? "rgba(103,232,249,0.18)" : "rgba(2, 8, 23, 0.78)",
                  border: `1px solid ${dive ? "rgba(103,232,249,0.5)" : "rgba(255,255,255,0.14)"}`,
                  borderRadius: 999,
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {dive ? "▣ EXIT DIVE" : "⬢ DIVE — IMMERSIVE EARTH"}
              </button>
            </div>

            {/* Focus / coords HUD */}
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                display: "flex",
                flexDirection: "column",
                gap: 3,
                background: "rgba(2, 8, 23, 0.78)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 10.5,
                color: "#cfeefc",
                pointerEvents: "none",
                fontFamily: "inherit",
              }}
            >
              <span>
                {state.placeContext
                  ? `◈ ${state.placeContext.name}${state.placeContext.country ? `, ${state.placeContext.country}` : ""}`
                  : state.camera
                    ? `◎ ${state.camera.lat.toFixed(3)}°, ${state.camera.lon.toFixed(3)}°`
                    : "◎ Earth — drag to orbit, scroll to zoom"}
              </span>
              <span style={{ opacity: 0.55 }}>
                {tracked ? `◉ Tracking ${tracked.name}${tracked.estimated ? " (estimated)" : ""}` : `${visibleEntities.length} entities visible`}
              </span>
            </div>

            {/* Live execution strip — the same bus chat uses */}
            <div
              style={{
                position: "absolute",
                bottom: 10,
                left: 10,
                right: 10,
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                pointerEvents: "none",
                fontFamily: "inherit",
              }}
            >
              {spatialLog.length === 0 ? (
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(148,163,184,0.55)",
                    background: "rgba(2, 8, 23, 0.6)",
                    borderRadius: 999,
                    padding: "3px 9px",
                  }}
                >
                  LÉLU is ready — ask her to “Show aircraft” or search a place
                </span>
              ) : (
                spatialLog.map((entry, i) => (
                  <span
                    key={`${entry.at}-${i}`}
                    style={{
                      fontSize: 10,
                      color: entry.side === "backend" ? "#7dd3fc" : "#a5f3fc",
                      background: "rgba(2, 8, 23, 0.78)",
                      border: "1px solid rgba(125,211,252,0.18)",
                      borderRadius: 999,
                      padding: "3px 9px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.side === "backend" ? "◈" : entry.side === "frontend" ? "▣" : "◉"} {entry.label}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Controls ── */}              <div style={{
                width: typeof window !== "undefined" && window.innerWidth < 720 ? "100%" : 296,
                flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflowY: "auto",
            maxHeight: dive ? "calc(96vh - 150px)" : 470,
            paddingRight: 2,
            fontFamily: "inherit",
          }}
        >
          {/* Search */}
          <div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
                placeholder="Search the Earth — Tokyo, Kilimanjaro, 321 Imperial Blvd…"
                style={{
                  flex: 1,
                  padding: "7px 10px",
                  borderRadius: 9,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(8,16,38,0.55)",
                  color: "#e2e8f0",
                  fontSize: 11.5,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                style={{
                  padding: "7px 12px",
                  borderRadius: 9,
                  border: "1px solid rgba(103,232,249,0.4)",
                  background: "rgba(103,232,249,0.12)",
                  color: "#a5f3fc",
                  fontSize: 11.5,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Search
              </button>
            </div>
            {state.searchResults.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {state.searchResults.slice(0, 5).map(renderResult)}
              </div>
            ) : null}
          </div>

          {/* Layers */}
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", opacity: 0.6, marginBottom: 5 }}>
              DATA LAYERS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {layerOrder.map((id) => {
                const layer = state.layers[id];
                if (!layer) return null;
                const src = providerStatus[id] ?? layer.source;
                const statusColor = PANEL_COLORS[src.status] ?? "#64748b";
                return (
                  <div
                    key={id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 8px",
                      borderRadius: 9,
                      border: layer.enabled
                        ? `1px solid ${layer.color}44`
                        : "1px solid rgba(255,255,255,0.07)",
                      background: layer.enabled ? "rgba(255,255,255,0.04)" : "transparent",
                    }}
                  >
                    <span style={{ fontSize: 13, width: 18, textAlign: "center" }}>{layer.glyph}</span>
                    <button
                      type="button"
                      onClick={() => toggleLayer(id)}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        color: layer.enabled ? "#e6f4ff" : "rgba(148,163,184,0.7)",
                        fontSize: 11.5,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        padding: 0,
                      }}
                    >
                      {layer.name}
                    </button>
                    <span
                      style={{
                        fontSize: 9,
                        color: statusColor,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {src.freshnessLabel ?? src.status.toUpperCase().replace("_", " ")}
                    </span>
                    <button
                      type="button"
                      aria-label={`Toggle ${layer.name}`}
                      onClick={() => toggleLayer(id)}
                      style={{
                        width: 26,
                        height: 15,
                        borderRadius: 999,
                        border: "none",
                        cursor: "pointer",
                        background: layer.enabled ? layer.color : "rgba(100,116,139,0.4)",
                        position: "relative",
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 2,
                          left: layer.enabled ? 13 : 2,
                          width: 11,
                          height: 11,
                          borderRadius: 999,
                          background: "#0b1220",
                          transition: "left 0.15s ease",
                        }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Entities */}
          {visibleEntities.length > 0 ? (
            <div>
              <div style={{ fontSize: 10.5, letterSpacing: "0.06em", opacity: 0.6, marginBottom: 5 }}>
                ENTITIES · {visibleEntities.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {visibleEntities.slice(0, 40).map((entity) => {
                  const isSelected = entity.id === state.selectedEntityId;
                  const color = TYPE_COLORS[entity.type] ?? "#94a3b8";
                  return (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => void earth.execute({ op: "select_entity", id: entity.id })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        textAlign: "left",
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: isSelected ? `1px solid ${color}66` : "1px solid transparent",
                        background: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
                        color: "#dbeafe",
                        fontSize: 11,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entity.name}
                      </span>
                      {entity.estimated ? (
                        <span style={{ fontSize: 8.5, opacity: 0.55, color: "#c4b5fd" }}>EST</span>
                      ) : null}
                      {typeof (entity.metadata ?? {}).magnitude === "number" ? (
                        <span style={{ fontSize: 9.5, opacity: 0.8, color: color }}>
                          M{(entity.metadata! as { magnitude: number }).magnitude.toFixed(1)}
                        </span>
                      ) : null}
                      {entity.type === "fire" && typeof (entity.metadata ?? {}).frpMw === "number" ? (
                        <span style={{ fontSize: 9.5, opacity: 0.8, color: color }}>
                          {(entity.metadata! as { frpMw: number }).frpMw.toFixed(0)} MW
                        </span>
                      ) : null}
                      {entity.type === "vessel" && typeof (entity.metadata ?? {}).sogKt === "number" ? (
                        <span style={{ fontSize: 9.5, opacity: 0.8, color: color }}>
                          {(entity.metadata! as { sogKt: number }).sogKt.toFixed(0)} kt
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Inspector */}
          {selected ? (
            <div
              style={{
                borderRadius: 10,
                border: `1px solid ${TYPE_COLORS[selected.type] ?? "#64748b"}55`,
                background: "rgba(255,255,255,0.03)",
                padding: 10,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#e6f4ff" }}>{selected.name}</div>
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>
                {selected.type} · {selected.location.lat.toFixed(3)}°, {selected.location.lon.toFixed(3)}° ·{" "}
                {state.layers[selected.source]?.source?.provider ?? selected.source}
                {selected.estimated ? " · ESTIMATED" : ""}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
                {telemetryRows(selected).map(([label, value]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }}>
                    <span style={{ opacity: 0.6 }}>{label}</span>
                    <span style={{ color: "#dbeafe" }}>{value}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {state.trackedEntityId !== selected.id ? (
                  <button
                    type="button"
                    onClick={() => void earth.execute({ op: "track_entity", id: selected.id })}
                    style={actionButton("#5eead4")}
                  >
                    ◉ Track
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void earth.execute({ op: "stop_tracking" })}
                    style={actionButton("#f87171")}
                  >
                    ■ Stop
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void earth.execute({ op: "follow", enabled: !state.followMode })}
                  style={actionButton(state.followMode ? "#fbbf24" : "#7dd3fc")}
                >
                  {state.followMode ? "◎ Following" : "◎ Follow"}
                </button>
              </div>
            </div>
          ) : tracked ? (
            <div style={{ borderRadius: 10, border: "1px solid rgba(94,234,212,0.4)", padding: 10, background: "rgba(94,234,212,0.05)" }}>
              <div style={{ fontSize: 11.5, color: "#5eead4" }}>
                ◉ Tracking {tracked.name} {tracked.estimated ? "(estimated)" : ""}
              </div>
              <button
                type="button"
                onClick={() => void earth.execute({ op: "stop_tracking" })}
                style={{ ...actionButton("#f87171"), marginTop: 8 }}
              >
                ■ Stop tracking
              </button>
            </div>
          ) : null}

          {/* Quick actions */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={goHome} style={actionButton("#fde68a")}>🌍 Whole Planet</button>
            <button
              type="button"
              onClick={() => {
                void earth.execute({ op: "navigate_to_location", lat: 37.77, lon: -122.42, zoom: 6 });
                void earth.execute({ op: "show", layer: "aircraft" });
              }}
              style={actionButton("#7dd3fc")}
            >
              ✈ Bay Area traffic
            </button>
            <button
              type="button"
              onClick={() => {
                void earth.execute({ op: "navigate_to_location", lat: 35.68, lon: 139.69, zoom: 6 });
                void earth.execute({ op: "show", layer: "earthquakes" });
              }}
              style={actionButton("#fca5a5")}
            >
              ≋ Tokyo quakes
            </button>
            <button
              type="button"
              onClick={() => {
                void earth.execute({ op: "show", layer: "alpr" });
              }}
              style={actionButton("#f472b6")}
            >
              ◈ ALPR cameras
            </button>
          </div>

          {/* Distance helper */}
          {state.camera ? (
            <div style={{ fontSize: 9.5, opacity: 0.5 }}>
              {visibleEntities
                .slice(0, 1)
                .map((e) => `${e.name} is ${earthDistanceKm(state.camera!, e.location).toFixed(0)} km from focus`)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function actionButton(color: string): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${color}55`,
    background: `${color}14`,
    color,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
