/**
 * ==========================================================
 * LÉLUVERSE — PLANET EXPLORER
 *
 * Continuous planetary zoom: Cosmos → planet → continent →
 * city → neighborhood → street. A camera-facing "surface
 * patch" streams progressively richer LOD as the camera
 * descends, plus a fixed Atlantis underwater city.
 *
 * This EXTENDS the existing planet renderer — it does not
 * replace it. The base globe (TestPlanet) stays exactly as-is.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import {
  AdditiveBlending,
  BackSide,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import {
  BIOMES,
  biomeAt,
  countryAt,
  dayFactor,
  groundDirToLatLon,
  sunDirection,
  warmGeoData,
  type PlanetBiomeId,
} from "./PlanetBiomes";
import { boundaryForCountry, type CountryRing } from "./GeoPipeline";
import {
  CoastSurface,
  DesertSurface,
  MountainSurface,
  OceanSurface,
  PolarSurface,
  VegetationSurface,
} from "./PlanetSurfaces";
import {
  getGpsPosition,
  loadCountries,
  nearestPlace,
} from "./GeoData";
import ProactiveCore from "../../../../core/proactive/ProactiveCore";
import KvStore from "../../../../core/storage/KvStore";
import EarthCore from "../../../../core/earth/EarthCore";

/* ------------------------------------------------------------------
 * Shared constants + navigation store (module-level so the DOM HUD
 * and the 3D layers can talk without reaching into the canvas).
 * ------------------------------------------------------------------ */

export const PLANET_CENTER = new Vector3(0, 1.15, 0);
export const PLANET_RADIUS = 2.1;

export type PlanetScaleLabel =
  | "COSMOS"
  | "SYSTEM"
  | "PLANET"
  | "CITY"
  | "NEIGHBORHOOD"
  | "STREET";

const SCALE_ORDER: PlanetScaleLabel[] = [
  "COSMOS",
  "SYSTEM",
  "PLANET",
  "CITY",
  "NEIGHBORHOOD",
  "STREET",
];

type ScaleListener = (label: PlanetScaleLabel) => void;
type BiomeListener = (id: PlanetBiomeId) => void;
type PlaceListener = (text: string) => void;

export const planetNavStore = {
  scaleLabel: "COSMOS" as PlanetScaleLabel,
  biome: "OCEAN" as PlanetBiomeId,
  place: "" as string,
  atlantisWorld: new Vector3(0, PLANET_CENTER.y, -PLANET_RADIUS),
  _listeners: new Set<ScaleListener>(),
  _biomeListeners: new Set<BiomeListener>(),
  _placeListeners: new Set<PlaceListener>(),
  setScale(label: PlanetScaleLabel) {
    if (label !== this.scaleLabel) {
      this.scaleLabel = label;
      this._listeners.forEach((fn) => fn(label));
    }
  },
  setBiome(id: PlanetBiomeId) {
    if (id !== this.biome) {
      this.biome = id;
      this._biomeListeners.forEach((fn) => fn(id));
    }
  },
  setPlace(text: string) {
    if (text !== this.place) {
      this.place = text;
      this._placeListeners.forEach((fn) => fn(text));
    }
  },
  subscribe(fn: ScaleListener) {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  },
  subscribeBiome(fn: BiomeListener) {
    this._biomeListeners.add(fn);
    return () => {
      this._biomeListeners.delete(fn);
    };
  },
  subscribePlace(fn: PlaceListener) {
    this._placeListeners.add(fn);
    return () => {
      this._placeListeners.delete(fn);
    };
  },
};

function scaleLabelFor(surfaceDist: number): PlanetScaleLabel {
  if (surfaceDist > 12) return "COSMOS";
  if (surfaceDist > 7) return "SYSTEM";
  if (surfaceDist > 4) return "PLANET";
  if (surfaceDist > 2) return "CITY";
  if (surfaceDist > 1) return "NEIGHBORHOOD";
  return "STREET";
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Deterministic seeded RNG so procedural geometry is stable per frame. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new Vector3(0, 1, 0);

/* ------------------------------------------------------------------
 * LOD LAYER 1 — CITY GLOW (seen from orbit)
 * A warm glowing city footprint + instanced building dots.
 * ------------------------------------------------------------------ */

function CityGlowLayer() {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const count = 220;

  const buildings = useMemo(() => {
    const rnd = mulberry32(1234);
    return Array.from({ length: count }, () => ({
      x: (rnd() - 0.5) * 2.6,
      z: (rnd() - 0.5) * 2.6,
      w: 0.02 + rnd() * 0.06,
      d: 0.02 + rnd() * 0.06,
      h: 0.02 + rnd() * 0.16,
    }));
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new Color(1, 0.72 + (i % 5) * 0.05, 0.35));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [buildings, dummy]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001}>
        <circleGeometry args={[2.7, 48]} />
        <meshBasicMaterial
          color="#ffb347"
          transparent
          opacity={0.22}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#ffb25e"
          emissive="#ff8a2a"
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------
 * LOD LAYER 2 — STREET CITY (near surface)
 * Flat tangent city: ground, roads, buildings, trees, lamps,
 * moving cars and walking people.
 * ------------------------------------------------------------------ */

const CAR_COLORS = ["#e0483f", "#4f8fe0", "#f2c14e", "#7fd0a8", "#c07fd0", "#e8e8ec", "#f2a13e", "#5bd6e8"];

function StreetCar({ path, speed, color }: {
  path: { x: number; z: number; horiz: boolean };
  speed: number;
  color: string;
}) {
  const ref = useRef<Group>(null);
  const t = useRef(Math.random() * 100);

  useFrame((_, delta) => {
    if (!ref.current) return;
    t.current += delta * speed;
    const span = 2.4;
    const p = (((t.current % span) + span) % span) - span / 2;
    if (path.horiz) {
      ref.current.position.set(p, 0.012, path.z);
      ref.current.rotation.y = 0;
    } else {
      ref.current.position.set(path.x, 0.012, p);
      ref.current.rotation.y = Math.PI / 2;
    }
  });

  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.07, 0.022, 0.032]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          metalness={0.6}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0.036, 0.002, 0.008]}>
        <sphereGeometry args={[0.006, 6, 6]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.036, 0.002, -0.008]}>
        <sphereGeometry args={[0.006, 6, 6]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[-0.036, 0.002, 0.006]}>
        <sphereGeometry args={[0.005, 6, 6]} />
        <meshBasicMaterial color="#ff4433" />
      </mesh>
    </group>
  );
}

function StreetCityLayer() {
  const buildingRef = useRef<InstancedMesh>(null);
  const treeRef = useRef<InstancedMesh>(null);
  const lampRef = useRef<InstancedMesh>(null);
  const peopleRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  /* Roads form a 5×5 grid; blocks between them hold buildings/trees. */
  const layout = useMemo(() => {
    const rnd = mulberry32(777);

    const roads: { x: number; z: number; horiz: boolean }[] = [];
    for (let i = -2; i <= 2; i++) {
      roads.push({ x: i, z: 0, horiz: false });
      roads.push({ x: 0, z: i, horiz: true });
    }

    const buildings: { x: number; z: number; w: number; h: number; d: number }[] = [];
    const trees: { x: number; z: number; s: number }[] = [];
    const lamps: { x: number; z: number }[] = [];

    // Block centers are at half-integer grid positions between roads.
    const centers = [-1.5, -0.5, 0.5, 1.5];
    centers.forEach((cx) => {
      centers.forEach((cz) => {
        const isPark = rnd() < 0.18;
        const buildingCount = isPark ? 0 : 2 + Math.floor(rnd() * 3);
        for (let b = 0; b < buildingCount; b++) {
          buildings.push({
            x: cx + (rnd() - 0.5) * 0.5,
            z: cz + (rnd() - 0.5) * 0.5,
            w: 0.14 + rnd() * 0.14,
            d: 0.14 + rnd() * 0.14,
            h: 0.06 + rnd() * 0.28,
          });
        }
        const treeCount = isPark ? 4 : 1 + Math.floor(rnd() * 2);
        for (let t = 0; t < treeCount; t++) {
          trees.push({
            x: cx + (rnd() - 0.5) * 0.6,
            z: cz + (rnd() - 0.5) * 0.6,
            s: 0.4 + rnd() * 0.5,
          });
        }
      });
    });

    // Street lamps at road intersections.
    for (let ix = -2; ix <= 2; ix++) {
      for (let iz = -2; iz <= 2; iz++) {
        lamps.push({ x: ix + 0.18, z: iz + 0.18 });
      }
    }

    const carPaths: { x: number; z: number; horiz: boolean }[] = [];
    for (let i = 0; i < 10; i++) {
      carPaths.push({
        x: -1.5 + Math.floor(i / 2) * 1,
        z: i % 2 === 0 ? 0 : 0,
        horiz: i % 2 === 0,
      });
    }

    const people = Array.from({ length: 24 }, () => ({
      x: (rnd() - 0.5) * 4,
      z: (rnd() - 0.5) * 4,
      speed: 0.08 + rnd() * 0.2,
      phase: rnd() * Math.PI * 2,
    }));

    return { roads, buildings, trees, lamps, carPaths, people };
  }, []);

  /* Static instanced layout — set once on mount. */
  useEffect(() => {
    const b = buildingRef.current;
    if (b) {
      layout.buildings.forEach((bl, i) => {
        dummy.position.set(bl.x, bl.h / 2, bl.z);
        dummy.scale.set(bl.w, bl.h, bl.d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        b.setMatrixAt(i, dummy.matrix);
        const warm = 0.55 + (i % 4) * 0.05;
        b.setColorAt(i, new Color(warm, warm * 0.85, warm * 0.6));
      });
      b.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    }

    const t = treeRef.current;
    if (t) {
      layout.trees.forEach((tr, i) => {
        dummy.position.set(tr.x, 0.06 * tr.s, tr.z);
        dummy.scale.set(0.05 * tr.s, 0.12 * tr.s, 0.05 * tr.s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        t.setMatrixAt(i, dummy.matrix);
      });
      t.instanceMatrix.needsUpdate = true;
    }

    const l = lampRef.current;
    if (l) {
      layout.lamps.forEach((lp, i) => {
        dummy.position.set(lp.x, 0.1, lp.z);
        dummy.scale.set(0.03, 0.03, 0.03);
        dummy.updateMatrix();
        l.setMatrixAt(i, dummy.matrix);
      });
      l.instanceMatrix.needsUpdate = true;
    }
  }, [layout, dummy]);

  /* Animate people. */
  useFrame(({ clock }) => {
    const p = peopleRef.current;
    if (!p) return;
    const t = clock.elapsedTime;
    layout.people.forEach((person, i) => {
      const x = person.x + Math.sin(t * person.speed + person.phase) * 0.4;
      const z = person.z + Math.cos(t * person.speed * 0.8 + person.phase) * 0.4;
      dummy.position.set(x, 0.014, z);
      dummy.scale.set(0.008, 0.02, 0.008);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      p.setMatrixAt(i, dummy.matrix);
    });
    p.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* Ground */}
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[5, 5]} />
        <meshStandardMaterial color="#0c1118" roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Roads */}
      {layout.roads.map((r, i) => (
        <mesh
          key={`road-${i}`}
          position={[r.x, 0.004, r.z]}
          rotation-x={-Math.PI / 2}
        >
          <planeGeometry args={[r.horiz ? 4.2 : 0.14, r.horiz ? 0.14 : 4.2]} />
          <meshStandardMaterial color="#1b2430" roughness={0.85} />
        </mesh>
      ))}

      {/* Buildings */}
      <instancedMesh
        ref={buildingRef}
        args={[undefined, undefined, layout.buildings.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial emissive="#5a3d1e" emissiveIntensity={0.7} roughness={0.6} />
      </instancedMesh>

      {/* Trees */}
      <instancedMesh
        ref={treeRef}
        args={[undefined, undefined, layout.trees.length]}
        frustumCulled={false}
      >
        <coneGeometry args={[1, 2, 6]} />
        <meshStandardMaterial color="#1d7a4a" emissive="#0f3d26" emissiveIntensity={0.4} roughness={0.8} />
      </instancedMesh>

      {/* Street lamp glows */}
      <instancedMesh
        ref={lampRef}
        args={[undefined, undefined, layout.lamps.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color="#ffe6a8" transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
      </instancedMesh>

      {/* Moving cars */}
      {layout.carPaths.map((p, i) => (
        <StreetCar
          key={`car-${i}`}
          path={{ x: p.x, z: p.z, horiz: p.horiz }}
          speed={0.35 + (i % 5) * 0.12}
          color={CAR_COLORS[i % CAR_COLORS.length]}
        />
      ))}

      {/* People */}
      <instancedMesh
        ref={peopleRef}
        args={[undefined, undefined, layout.people.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 5, 5]} />
        <meshBasicMaterial color="#dce7ff" />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------
 * SURFACE LOD ORCHESTRATOR
 * Tracks the camera, positions a tangent patch on the planet surface,
 * and streams the two LOD layers in/out by distance.
 * ------------------------------------------------------------------ */

export function PlanetSurfaceLOD() {
  const detailRef = useRef<Group>(null);
  const cityRef = useRef<Group>(null);
  const oceanRef = useRef<Group>(null);
  const coastRef = useRef<Group>(null);
  const forestRef = useRef<Group>(null);
  const jungleRef = useRef<Group>(null);
  const desertRef = useRef<Group>(null);
  const grassRef = useRef<Group>(null);
  const savannaRef = useRef<Group>(null);
  const mountainRef = useRef<Group>(null);
  const polarRef = useRef<Group>(null);
  const urbanRef = useRef<Group>(null);

  const { camera } = useThree();

  const localCam = useMemo(() => new Vector3(), []);
  const surface = useMemo(() => new Vector3(), []);
  const dir = useMemo(() => new Vector3(), []);
  const quat = useMemo(() => new Quaternion(), []);

  const layerRefs = useMemo<Record<PlanetBiomeId, { current: Group | null }>>(() => ({
    OCEAN: oceanRef,
    COAST: coastRef,
    FOREST: forestRef,
    JUNGLE: jungleRef,
    DESERT: desertRef,
    GRASSLAND: grassRef,
    SAVANNA: savannaRef,
    MOUNTAIN: mountainRef,
    POLAR: polarRef,
    URBAN: urbanRef,
  }), []);

  const currentBiomeRef = useRef<PlanetBiomeId | null>(null);
  const previousBiomeRef = useRef<PlanetBiomeId | null>(null);
  const blendRef = useRef(1);

  useFrame((_, delta) => {
    const detail = detailRef.current;
    if (!detail) return;

    localCam.copy(camera.position).sub(PLANET_CENTER);
    const dist = localCam.length();
    if (dist < 1e-6) localCam.set(0, 0, 1);
    dir.copy(localCam).normalize();

    const surfaceDist = Math.max(0, dist - PLANET_RADIUS);
    surface.copy(PLANET_CENTER).addScaledVector(dir, PLANET_RADIUS);

    // Local to the parent group (whose origin sits at PLANET_CENTER).
    detail.position.set(surface.x - PLANET_CENTER.x, surface.y - PLANET_CENTER.y, surface.z - PLANET_CENTER.z);
    quat.setFromUnitVectors(UP, dir);
    detail.quaternion.copy(quat);

    // Determine which environment we are standing over.
    const { lat, lon } = groundDirToLatLon(dir);
    const biome = biomeAt(lat, lon);
    planetNavStore.setBiome(biome);

    // Stream real country boundaries + elevation tiles for this location.
    warmGeoData(lat, lon);

    const nearest = nearestPlace(lat, lon);
    const realCountry = countryAt(lat, lon);
    const placeName = nearest.city
      ? `${nearest.city.name}, ${nearest.city.country}`
      : realCountry
        ? realCountry
        : nearest.country
          ? nearest.country.name
          : `${BIOMES[biome].name} · ${lat.toFixed(1)}°, ${lon.toFixed(1)}°`;
    planetNavStore.setPlace(placeName);

    // Crossfade between the previous and current biome on change.
    if (currentBiomeRef.current !== biome) {
      previousBiomeRef.current = currentBiomeRef.current;
      currentBiomeRef.current = biome;
      blendRef.current = 0;
    }
    blendRef.current = Math.min(1, blendRef.current + delta * 2.2);

    // Orbit-level city glow appears only over urban regions.
    const tGlow = biome === "URBAN" ? clamp01((9 - surfaceDist) / 6.5) : 0;
    if (cityRef.current) {
      cityRef.current.visible = tGlow > 0.02;
      cityRef.current.scale.setScalar(0.05 + 0.95 * easeInOut(tGlow));
    }

    // Near-surface biome layers.
    const tSurface = clamp01((2.6 - surfaceDist) / 2.6);
    const reveal = easeInOut(tSurface);

    for (const id of Object.keys(layerRefs) as PlanetBiomeId[]) {
      const ref = layerRefs[id];
      if (!ref.current) continue;
      if (id === currentBiomeRef.current) {
        ref.current.visible = reveal * blendRef.current > 0.01;
        ref.current.scale.setScalar(0.04 + 0.96 * reveal * blendRef.current);
      } else if (id === previousBiomeRef.current && blendRef.current < 1) {
        ref.current.visible = true;
        ref.current.scale.setScalar(0.04 + 0.96 * reveal * (1 - blendRef.current));
      } else {
        ref.current.visible = false;
      }
    }

    planetNavStore.setScale(scaleLabelFor(surfaceDist));
  });

  return (
    <group ref={detailRef}>
      <group ref={cityRef} visible={false}>
        <CityGlowLayer />
      </group>
      <group ref={oceanRef} visible={false}>
        <OceanSurface />
      </group>
      <group ref={coastRef} visible={false}>
        <CoastSurface />
      </group>
      <group ref={forestRef} visible={false}>
        <VegetationSurface variant="forest" />
      </group>
      <group ref={jungleRef} visible={false}>
        <VegetationSurface variant="jungle" />
      </group>
      <group ref={desertRef} visible={false}>
        <DesertSurface />
      </group>
      <group ref={grassRef} visible={false}>
        <VegetationSurface variant="grassland" />
      </group>
      <group ref={savannaRef} visible={false}>
        <VegetationSurface variant="savanna" />
      </group>
      <group ref={mountainRef} visible={false}>
        <MountainSurface />
      </group>
      <group ref={polarRef} visible={false}>
        <PolarSurface />
      </group>
      <group ref={urbanRef} visible={false}>
        <StreetCityLayer />
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------
 * PLANET SUN — one persistent day/night light that orbits the planet
 * ------------------------------------------------------------------ */

function PlanetSun() {
  const lightRef = useRef<DirectionalLight>(null);
  const initial = useMemo(() => sunDirection(0), []);

  useFrame(({ clock }) => {
    const light = lightRef.current;
    if (!light) return;
    const elapsed = clock.elapsedTime;
    light.position.copy(sunDirection(elapsed));
    light.intensity = 0.5 + dayFactor(elapsed) * 2.1;
  });

  return (
    <directionalLight
      ref={lightRef}
      position={initial}
      intensity={2.6}
      color="#fff3e0"
    />
  );
}

/* ------------------------------------------------------------------
 * UNDERWATER EFFECT — blue depth haze + tint when below the ocean
 * ------------------------------------------------------------------ */

function UnderwaterEffect() {
  const tintRef = useRef<Mesh>(null);
  const { camera } = useThree();
  const dir = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const tint = tintRef.current;
    if (!tint) return;

    dir.copy(camera.position).sub(PLANET_CENTER);
    const dist = dir.length();
    if (dist < 1e-4) return;

    const { lat, lon } = groundDirToLatLon(dir);
    const biome = biomeAt(lat, lon);
    const underwater =
      (biome === "OCEAN" || biome === "COAST") && dist < PLANET_RADIUS - 0.12;

    tint.visible = underwater;
    if (underwater) {
      // Parent group sits at PLANET_CENTER, so use local coordinates.
      tint.position.copy(camera.position).sub(PLANET_CENTER);
    }
  });

  return (
    <mesh ref={tintRef} visible={false}>
      <sphereGeometry args={[7, 24, 24]} />
      <meshBasicMaterial color="#0b3a5c" transparent opacity={0.42} side={BackSide} depthWrite={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------
 * ATLANTIS — fixed underwater city on the planet surface.
 * A cyan beacon marks it from orbit; ruins reveal as you approach.
 * ------------------------------------------------------------------ */

const ATLANTIS_LAT = 24;
const ATLANTIS_LON = -44;
const DEG = Math.PI / 180;

function latLonToDir(lat: number, lon: number): Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new Vector3(
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
}

/** Fly the camera to a real-world lat/lon on the planet surface. */
function flyToLatLon(lat: number, lon: number) {
  const surface = PLANET_CENTER.clone().addScaledVector(latLonToDir(lat, lon), PLANET_RADIUS);
  const outward = surface.clone().sub(PLANET_CENTER).normalize();
  const pos = surface.clone().addScaledVector(outward, 1.5);
  window.dispatchEvent(
    new CustomEvent("planet-navigate", {
      detail: {
        pos: { x: pos.x, y: pos.y, z: pos.z },
        lookAt: { x: surface.x, y: surface.y, z: surface.z },
      },
    })
  );
}

function AtlantisWorld() {
  const groupRef = useRef<Group>(null);
  const ruinsRef = useRef<Group>(null);
  const beaconRef = useRef<Group>(null);
  const { camera } = useThree();
  const reveal = useRef(0);
  const worldPos = useMemo(() => new Vector3(), []);
  const dummy = useMemo(() => new Object3D(), []);
  const columnRef = useRef<InstancedMesh>(null);
  const bubbleRef = useRef<InstancedMesh>(null);

  const atlantisDir = useMemo(() => latLonToDir(ATLANTIS_LAT, ATLANTIS_LON), []);

  const columns = useMemo(() => {
    const rnd = mulberry32(555);
    return Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2;
      const r = 0.35 + rnd() * 0.45;
      return {
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        h: 0.1 + rnd() * 0.25,
      };
    });
  }, []);

  useEffect(() => {
    const c = columnRef.current;
    if (!c) return;
    columns.forEach((col, i) => {
      dummy.position.set(col.x, col.h / 2, col.z);
      dummy.scale.set(0.05, col.h, 0.05);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      c.setMatrixAt(i, dummy.matrix);
    });
    c.instanceMatrix.needsUpdate = true;
  }, [columns, dummy]);

  useFrame(({ clock }, delta) => {
    const g = groupRef.current;
    if (!g) return;
    g.updateWorldMatrix(true, false);
    worldPos.setFromMatrixPosition(g.matrixWorld);
    planetNavStore.atlantisWorld.copy(worldPos);

    const dist = camera.position.distanceTo(worldPos);
    const target = dist < 2.4 ? 1 : dist < 4.5 ? 0.35 : 0;
    reveal.current += (target - reveal.current) * Math.min(1, delta * 2.5);

    if (ruinsRef.current) {
      ruinsRef.current.visible = reveal.current > 0.02;
      ruinsRef.current.scale.setScalar(0.3 + 0.7 * reveal.current);
    }
    if (beaconRef.current) {
      // Beacon stays visible but grows brighter as you approach.
      beaconRef.current.scale.setScalar(1 + reveal.current * 0.8);
    }

    // Drifting bubbles.
    const b = bubbleRef.current;
    if (b && b.visible) {
      const t = clock.elapsedTime;
      for (let i = 0; i < 18; i++) {
        const x = Math.sin(i * 1.7 + t * 0.4) * 0.5;
        const z = Math.cos(i * 1.3 + t * 0.35) * 0.5;
        const y = ((t * 0.15 + i * 0.13) % 1) * 0.5;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(0.008 + (i % 4) * 0.004);
        dummy.updateMatrix();
        b.setMatrixAt(i, dummy.matrix);
      }
      b.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} position={atlantisDir.clone().multiplyScalar(1.96)}>
      {/* Orbit beacon */}
      <group ref={beaconRef}>
        <mesh>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial color="#39f0e6" transparent opacity={0.85} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.3, 12, 12]} />
          <meshBasicMaterial color="#18a8c8" transparent opacity={0.18} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <pointLight color="#39f0e6" intensity={6} distance={3} decay={2} />
      </group>

      {/* Revealed ruins */}
      <group ref={ruinsRef} visible={false}>
        {/* Glowing seabed */}
        <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
          <circleGeometry args={[0.85, 48]} />
          <meshBasicMaterial color="#0e5a6e" transparent opacity={0.4} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} />
        </mesh>

        {/* Grand dome */}
        <mesh position={[0, 0.18, 0]}>
          <sphereGeometry args={[0.3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#0f9bb8" emissive="#0b6a86" emissiveIntensity={0.9} roughness={0.4} side={DoubleSide} />
        </mesh>

        {/* Columns */}
        <instancedMesh ref={columnRef} args={[undefined, undefined, columns.length]} frustumCulled={false}>
          <cylinderGeometry args={[1, 1, 1, 8]} />
          <meshStandardMaterial color="#3bb8c9" emissive="#136c82" emissiveIntensity={0.7} roughness={0.5} />
        </instancedMesh>

        {/* Ruined arches (broken tori) */}
        {Array.from({ length: 3 }).map((_, i) => (
          <mesh key={`arch-${i}`} position={[Math.cos(i * 2.1) * 0.55, 0.02, Math.sin(i * 2.1) * 0.55]} rotation-y={i * 1.2}>
            <torusGeometry args={[0.16, 0.02, 6, 12, Math.PI * 1.4]} />
            <meshStandardMaterial color="#2a8fa5" emissive="#0f4f63" emissiveIntensity={0.5} roughness={0.6} />
          </mesh>
        ))}

        {/* Bubbles */}
        <instancedMesh ref={bubbleRef} args={[undefined, undefined, 18]} frustumCulled={false}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial color="#aef4ff" transparent opacity={0.5} blending={AdditiveBlending} depthWrite={false} />
        </instancedMesh>
      </group>
    </group>
  );
}

export { AtlantisWorld, PlanetSun, UnderwaterEffect };

/* ------------------------------------------------------------------
 * COUNTRY BOUNDARY LAYER
 * Draws the REAL country polygon (streamed GeoJSON) as glowing border
 * lines on the planet surface. Only visible at planet/continent scale,
 * not when the camera is down at street level.
 * ------------------------------------------------------------------ */

function BoundaryLine({ ring }: { ring: CountryRing[] }) {
  const points = useMemo(() => {
    const step = Math.max(1, Math.floor(ring.length / 500));
    const pts: [number, number, number][] = [];
    for (let i = 0; i < ring.length; i += step) {
      const v = latLonToDir(ring[i].lat, ring[i].lon).multiplyScalar(PLANET_RADIUS + 0.015);
      pts.push([v.x, v.y, v.z]);
    }
    const first = latLonToDir(ring[0].lat, ring[0].lon).multiplyScalar(PLANET_RADIUS + 0.015);
    pts.push([first.x, first.y, first.z]);
    return pts;
  }, [ring]);

  return (
    <Line
      points={points}
      color="#5eead4"
      lineWidth={1.2}
      transparent
      opacity={0.55}
    />
  );
}

export function CountryBoundaryLayer() {
  const { camera } = useThree();
  const [rings, setRings] = useState<CountryRing[][]>([]);
  const dir = useMemo(() => new Vector3(), []);
  const lastCountry = useRef<string | null>(null);

  useFrame(() => {
    dir.copy(camera.position).sub(PLANET_CENTER);
    const dist = dir.length();
    if (dist < 1e-6) return;
    const surfaceDist = dist - PLANET_RADIUS;

    // Borders only read at planet/continent/country scale.
    if (surfaceDist < 1.6) {
      if (lastCountry.current !== null) {
        lastCountry.current = null;
        setRings([]);
      }
      return;
    }

    const { lat, lon } = groundDirToLatLon(dir);
    const name = countryAt(lat, lon);
    if (name !== lastCountry.current) {
      lastCountry.current = name;
      setRings(name ? (boundaryForCountry(name) ?? []) : []);
    }
  });

  if (rings.length === 0) return null;

  return (
    <group>
      {rings.map((ring, i) => (
        <BoundaryLine key={i} ring={ring} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------
 * HUD — minimal breadcrumb + quick-nav (mounted in DOM, outside canvas).
 *
 * Positioned at top-right by default, away from the bottom-left dock
 * and navigation. Draggable via the header pill; position persists
 * through KvStore so the user's chosen spot survives reloads.
 * ------------------------------------------------------------------ */

const GPS_POSITION_KEY = "lelu.gps-bubble.pos";

interface GPSPosition {
  x: number;
  y: number;
}

function readGPSPosition(): GPSPosition | null {
  try {
    const stored = KvStore.getInstance().get<GPSPosition | null>(GPS_POSITION_KEY);
    if (stored && typeof stored.x === "number" && typeof stored.y === "number") {
      return stored;
    }
  } catch {
    // persistence backend blocked — use default
  }
  return null;
}

function persistGPSPosition(pos: GPSPosition): void {
  try {
    KvStore.getInstance().set(GPS_POSITION_KEY, pos);
  } catch {
    // persistence must never break the HUD
  }
}

export function PlanetExplorerHUD() {
  const [scale, setScale] = useState<PlanetScaleLabel>("COSMOS");
  const [biome, setBiome] = useState<PlanetBiomeId>("OCEAN");
  const [place, setPlace] = useState("");
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  // Draggable position — default to top-right (away from dock, chat, nav).
  const [position, setPosition] = useState<GPSPosition>(() => {
    return readGPSPosition() ?? { x: -1, y: -1 };
  });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Compute actual position — use stored or default to top-right.
  const effectiveX = position.x >= 0 ? position.x : (typeof window !== "undefined" ? window.innerWidth - 200 : 0);
  const effectiveY = position.y >= 0 ? position.y : 76;

  // Clamp to viewport on resize.
  const clampToViewport = useCallback((x: number, y: number): GPSPosition => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1440;
    const h = typeof window !== "undefined" ? window.innerHeight : 900;
    // The pill is ~200px wide; the popover is ~200px wide.
    const maxX = Math.max(0, w - 220);
    const maxY = Math.max(0, h - 280);
    return { x: Math.round(Math.min(maxX, Math.max(0, x))), y: Math.round(Math.min(maxY, Math.max(0, y))) };
  }, []);

  // Re-clamp on window resize.
  useEffect(() => {
    const handler = () => {
      setPosition((prev) => {
        if (prev.x < 0 && prev.y < 0) return prev; // default
        return clampToViewport(prev.x, prev.y);
      });
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [clampToViewport]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = Math.abs(event.clientX - drag.startX);
    const dy = Math.abs(event.clientY - drag.startY);
    if (dx + dy > 4) {
      drag.moved = true;
      const x = event.clientX - drag.offsetX;
      const y = event.clientY - drag.offsetY;
      const clamped = clampToViewport(x, y);
      setPosition(clamped);
    }
  }, [clampToViewport]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    // If it was a real drag, persist AND suppress the click.
    if (drag.moved) {
      const x = event.clientX - drag.offsetX;
      const y = event.clientY - drag.offsetY;
      const clamped = clampToViewport(x, y);
      setPosition(clamped);
      persistGPSPosition(clamped);
      return;
    }
  }, [clampToViewport]);

  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleToggle = useCallback(() => {
    // If a drag just ended, don't toggle.
    if (dragRef.current?.moved) return;
    setOpen((v) => !v);
  }, []);

  useEffect(() => {
    return planetNavStore.subscribe((label) => setScale(label));
  }, []);

  useEffect(() => {
    return planetNavStore.subscribeBiome((id) => setBiome(id));
  }, []);

  useEffect(() => {
    return planetNavStore.subscribePlace((text) => {
      setPlace(text);
      // The UI, cognition, and planetary engine share the same
      // authoritative location state — feed it into the proactive layer.
      if (text) {
        ProactiveCore.getInstance().setPlanetaryContext(text);
      }
    });
  }, []);

  // Follow Earth Core's canonical camera so chat, Deflock, and the planet
  // explorer always navigate the same location.
  const lastFollowedRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    const earth = EarthCore.getInstance();
    return earth.subscribe(() => {
      const camera = earth.getState().camera;
      if (!camera) return;
      const last = lastFollowedRef.current;
      if (last && Math.abs(last.lat - camera.lat) < 0.01 && Math.abs(last.lon - camera.lon) < 0.01) {
        return;
      }
      lastFollowedRef.current = { lat: camera.lat, lon: camera.lon };
      flyToLatLon(camera.lat, camera.lon);
      const resolved = nearestPlace(camera.lat, camera.lon);
      const locationName = resolved.city
        ? resolved.city.name
        : resolved.country?.name ?? `${camera.lat.toFixed(2)}°, ${camera.lon.toFixed(2)}°`;
      planetNavStore.setPlace(locationName);
    });
  }, []);

  // Enrich the country table from the free REST Countries API once.
  useEffect(() => {
    void loadCountries();
  }, []);

  const flyToGps = async () => {
    setLocating(true);
    try {
      const pos = await getGpsPosition();
      const resolved = nearestPlace(pos.lat, pos.lon);
      const locationName = resolved.city
        ? resolved.city.name
        : resolved.country?.name ?? `${pos.lat.toFixed(2)}°, ${pos.lon.toFixed(2)}°`;
      ProactiveCore.getInstance().setLocation(
        locationName,
        resolved.city?.country ?? resolved.country?.name,
      );
      flyToLatLon(pos.lat, pos.lon);
      lastFollowedRef.current = { lat: pos.lat, lon: pos.lon };
      void EarthCore.getInstance().execute({
        op: "navigate_to_location",
        lat: pos.lat,
        lon: pos.lon,
        zoom: 6,
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not read GPS position.");
    } finally {
      setLocating(false);
    }
  };

  const flyToAtlantis = () => {
    const atlantis = planetNavStore.atlantisWorld.clone();
    const outward = atlantis.clone().sub(PLANET_CENTER).normalize();
    const pos = atlantis.clone().addScaledVector(outward, 1.4);
    window.dispatchEvent(
      new CustomEvent("planet-navigate", {
        detail: { pos: { x: pos.x, y: pos.y, z: pos.z }, lookAt: { x: atlantis.x, y: atlantis.y, z: atlantis.z } },
      })
    );
  };

  const resetToSpace = () => {
    window.dispatchEvent(
      new CustomEvent("planet-navigate", {
        detail: { resetToSpace: true },
      })
    );
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "fixed",
        left: effectiveX,
        top: effectiveY,
        zIndex: 18,
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={handleToggle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        title="Drag to reposition · Click to expand"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(8,16,32,0.82)",
          color: "#9be8ff",
          border: "1px solid rgba(125,211,252,0.25)",
          borderRadius: 999,
          padding: "6px 12px",
          cursor: "grab",
          fontSize: 11,
          letterSpacing: "0.08em",
          fontFamily: "inherit",
          backdropFilter: "blur(8px)",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <span style={{ opacity: 0.7 }}>◈</span>
        {scale}
        <span style={{ color: BIOMES[biome].accent, opacity: 0.85 }}>· {BIOMES[biome].name}</span>
        {place ? <span style={{ opacity: 0.75, color: "#e6f4ff" }}>· {place}</span> : null}
      </button>

      {open && (
        <div
          style={{
            marginTop: 6,
            background: "rgba(8,16,32,0.92)",
            border: "1px solid rgba(125,211,252,0.2)",
            borderRadius: 10,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            backdropFilter: "blur(12px)",
            minWidth: 180,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 3,
              marginBottom: 4,
            }}
          >
            {SCALE_ORDER.map((label, i) => (
              <span key={label} style={{ display: "inline-flex", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.05em",
                    color: label === scale ? "#9be8ff" : "rgba(148,163,184,0.45)",
                    fontWeight: label === scale ? 700 : 400,
                  }}
                >
                  {label}
                </span>
                {i < SCALE_ORDER.length - 1 && (
                  <span style={{ color: "rgba(148,163,184,0.3)", margin: "0 3px" }}>›</span>
                )}
              </span>
            ))}
          </div>
          {place ? (
            <div style={{ color: "rgba(203,228,255,0.8)", fontSize: 10, marginBottom: 2 }}>
              📍 {place}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={flyToGps}
              disabled={locating}
              style={hudButtonStyle}
            >
              {locating ? "📍 …" : "📍 GPS"}
            </button>
            <button
              type="button"
              onClick={flyToAtlantis}
              style={hudButtonStyle}
            >
              🌊 Atlantis
            </button>
            <button
              type="button"
              onClick={resetToSpace}
              style={hudButtonStyle}
            >
              ⟳ Space
            </button>
          </div>
          <div style={{ color: "rgba(148,163,184,0.45)", fontSize: 9, marginTop: 2 }}>
            Scroll to zoom · drag to orbit · WASD to walk streets
          </div>
        </div>
      )}
    </div>
  );
}

const hudButtonStyle: React.CSSProperties = {
  flex: 1,
  background: "rgba(125,211,252,0.1)",
  color: "#cfeefc",
  border: "1px solid rgba(125,211,252,0.3)",
  borderRadius: 6,
  padding: "5px 8px",
  cursor: "pointer",
  fontSize: 10,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
