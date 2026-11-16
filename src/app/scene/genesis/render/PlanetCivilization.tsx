/**
 * ==========================================================
 * LÉLUVERSE — PLANET CIVILIZATION RENDERER
 *
 * Renders visible cities, buildings, people, vehicles,
 * weather, and floating cities as actual 3D objects
 * positioned on the planet surface.
 *
 * Uses InstancedMesh for performance — hundreds of
 * buildings/people/vehicles rendered in a single draw call.
 * ==========================================================
 */

import { useEffect, useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Group,
  Matrix4,
  Color,
  Vector3,
  AdditiveBlending,
  InstancedMesh,
  Quaternion,
} from "three";

import { mobile } from "../qualityLimits";

// ── City cluster data ──

interface CityCluster {
  lat: number;
  lon: number;
  size: number;
  buildings: { x: number; y: number; z: number; w: number; h: number; d: number }[];
  color: Color;
}

function generateCityClusters(count: number): CityCluster[] {
  const cities: CityCluster[] = [];
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  for (let i = 0; i < count; i++) {
    const lat = (rand() - 0.5) * 120;
    const lon = rand() * 360;
    const size = 3 + Math.floor(rand() * 12);
    const hue = 0.05 + rand() * 0.15;

    const buildings: CityCluster["buildings"] = [];
    for (let b = 0; b < size; b++) {
      const spread = 0.15 + size * 0.008;
      buildings.push({
        x: (rand() - 0.5) * spread,
        y: 0.005 + rand() * 0.04,
        z: (rand() - 0.5) * spread,
        w: 0.008 + rand() * 0.015,
        h: 0.01 + rand() * 0.06 * (0.5 + size / 20),
        d: 0.008 + rand() * 0.015,
      });
    }

    cities.push({
      lat, lon, size, buildings,
      color: new Color().setHSL(hue, 0.6, 0.5),
    });
  }
  return cities;
}

/**
 * Writes a lat/lon into `out` instead of allocating.
 *
 * The population and vehicle loops call this 180 times a frame; two fresh
 * Vector3s per call was ~360 short-lived objects per frame, on the main
 * thread, in the middle of the frame.
 */
function writeLatLon(lat: number, lon: number, radius: number, out: Vector3): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return out.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function latLonToPos(lat: number, lon: number, radius: number): { pos: Vector3; normal: Vector3 } {
  const pos = writeLatLon(lat, lon, radius, new Vector3());
  const normal = pos.clone().normalize();
  return { pos, normal };
}

/**
 * Renders all city clusters on the planet as instanced boxes.
 * Only visible during FULL_WORLD, SUNSET, and MIND (late) phases.
 */
export function PlanetCities({
  visible,
  planetRadius,
  opacity,
}: {
  visible: boolean;
  planetRadius: number;
  opacity: number;
}) {
  const meshRef = useRef<InstancedMesh>(null);

  const cities = useMemo(() => generateCityClusters(mobile ? 12 : 18), []);
  const totalBuildings = useMemo(() => cities.reduce((sum, c) => sum + c.buildings.length, 0), [cities]);

  const dummy = useMemo(() => new Matrix4(), []);

  /*
   * CITIES DO NOT MOVE. Their instance matrices are built ONCE, when they
   * become visible — not rebuilt on every frame.
   *
   * This block used to run inside useFrame: ~200 buildings, each costing a
   * fresh Vector3 (twice), a fresh Quaternion per city, a fresh Color, and a
   * full instance-colour buffer re-upload — every frame, to produce exactly
   * the same numbers. That is the kind of cost that does not show up as
   * triangles in a renderer stat and does show up as a stalled main thread.
   * Building it in an effect also means the work is skipped entirely while
   * the phase hides the cities.
   */
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !visible) return;
    const up = new Vector3(0, 1, 0);
    const quat = new Quaternion();
    const local = new Vector3();
    const scale = new Vector3();
    const color = new Color();
    let idx = 0;

    for (const city of cities) {
      const { pos, normal } = latLonToPos(city.lat, city.lon, planetRadius);
      quat.setFromUnitVectors(up, normal);

      for (const b of city.buildings) {
        if (idx >= totalBuildings) break;

        local.set(b.x, b.y, b.z).applyQuaternion(quat).add(pos);
        scale.set(b.w, b.h, b.d);
        dummy.makeRotationFromQuaternion(quat);
        dummy.setPosition(local);
        dummy.scale(scale);
        mesh.setMatrixAt(idx, dummy);

        color.setHSL(0.08 + (idx % 7) * 0.01, 0.7, 0.5 + (idx % 5) * 0.04);
        mesh.setColorAt(idx, color);

        idx += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [cities, totalBuildings, visible, planetRadius, dummy]);

  if (!visible) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, totalBuildings]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          emissive={new Color(0.9, 0.5, 0.2)}
          emissiveIntensity={1.5}
          transparent
          opacity={opacity}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

// ── People (tiny dots moving on surface) ──

export function PlanetPopulation({
  visible,
  planetRadius,
  opacity,
}: {
  visible: boolean;
  planetRadius: number;
  opacity: number;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const count = mobile ? 60 : 120;
  const dummy = useMemo(() => new Matrix4(), []);

  const people = useMemo(() => {
    return Array.from({ length: count }, () => {
      const lat = (Math.random() - 0.5) * 140;
      const lon = Math.random() * 360;
      const speed = 0.001 + Math.random() * 0.003;
      return { lat, lon, speed, phase: Math.random() * Math.PI * 2 };
    });
  }, []);

  /*
   * Colours are constant per person, so they are written ONCE; only the
   * matrices move, and dots on a planet need 12 updates a second, not 60.
   *
   * Before: a fresh Color and Vector3 per instance per frame, the colour
   * buffer re-uploaded every frame to say what it already said, and a full
   * 120-matrix rewrite for motion too small to see at 60 Hz.
   */
  const scratch = useMemo(
    () => ({ position: new Vector3(), scale: new Vector3(0.004, 0.004, 0.004), color: new Color() }),
    [],
  );
  const elapsed = useRef(0);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !visible) return;
    for (let i = 0; i < count; i += 1) {
      scratch.color.setHSL(0.55 + (i % 5) * 0.02, 0.3, 0.8);
      mesh.setColorAt(i, scratch.color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, visible, scratch]);

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    if (!mesh || !visible) return;
    elapsed.current += delta;
    if (elapsed.current < 1 / 12) return;
    elapsed.current = 0;
    const t = clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      const p = people[i];
      const animLat = p.lat + Math.sin(t * p.speed + p.phase) * 2;
      const animLon = p.lon + Math.cos(t * p.speed * 0.7 + p.phase) * 2;
      writeLatLon(animLat, animLon, planetRadius + 0.008, scratch.position);

      dummy.makeTranslation(scratch.position.x, scratch.position.y, scratch.position.z);
      dummy.scale(scratch.scale);
      mesh.setMatrixAt(i, dummy);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!visible) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial
        color={new Color(0.9, 0.9, 1.0)}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

// ── Vehicles (moving dots on roads) ──

export function PlanetVehicles({
  visible,
  planetRadius,
  opacity,
}: {
  visible: boolean;
  planetRadius: number;
  opacity: number;
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const count = mobile ? 30 : 60;
  const dummy = useMemo(() => new Matrix4(), []);

  const vehicles = useMemo(() => {
    return Array.from({ length: count }, () => {
      const lat = (Math.random() - 0.5) * 100;
      const lon = Math.random() * 360;
      const speed = 0.005 + Math.random() * 0.015;
      const direction = Math.random() > 0.5 ? 1 : -1;
      return { lat, lon, speed, direction, phase: Math.random() * Math.PI * 2 };
    });
  }, []);

  // Same treatment as the population: one colour write, throttled matrices.
  const scratch = useMemo(
    () => ({ position: new Vector3(), scale: new Vector3(0.006, 0.003, 0.003), color: new Color() }),
    [],
  );
  const elapsed = useRef(0);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !visible) return;
    scratch.color.setHSL(0.12, 0.8, 0.8);
    for (let i = 0; i < count; i += 1) mesh.setColorAt(i, scratch.color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, visible, scratch]);

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    if (!mesh || !visible) return;
    elapsed.current += delta;
    if (elapsed.current < 1 / 12) return;
    elapsed.current = 0;
    const t = clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      const v = vehicles[i];
      const animLon = v.lon + t * v.speed * v.direction;
      const animLat = v.lat + Math.sin(t * 0.3 + v.phase) * 1.5;
      writeLatLon(animLat, animLon % 360, planetRadius + 0.01, scratch.position);

      dummy.makeTranslation(scratch.position.x, scratch.position.y, scratch.position.z);
      dummy.scale(scratch.scale);
      mesh.setMatrixAt(i, dummy);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!visible) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial
        color={new Color(1.0, 0.9, 0.7)}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

// ── Weather: Storms on planet surface ──

export function PlanetWeather({
  visible,
  planetRadius,
  opacity,
}: {
  visible: boolean;
  planetRadius: number;
  opacity: number;
}) {
  const groupRef = useRef<Group>(null);

  const storms = useMemo(() => {
    return Array.from({ length: 5 }, () => ({
      lat: (Math.random() - 0.5) * 120,
      lon: Math.random() * 360,
      radius: 0.04 + Math.random() * 0.06,
      speed: 0.3 + Math.random() * 0.5,
      rotSpeed: 1 + Math.random() * 2,
      intensity: 0.4 + Math.random() * 0.6,
    }));
  }, []);

  /*
   * Five storms, and this used to build two Vector3s per storm per frame —
   * plus a fresh `latLonToPos` result — to move a shape a few pixels. The
   * scratch pair is created once; the frame writes into it.
   */
  const scratch = useMemo(() => ({ position: new Vector3(), origin: new Vector3(0, 0, 0) }), []);

  useFrame(({ clock }) => {
    if (!groupRef.current || !visible) return;
    const t = clock.elapsedTime;

    groupRef.current.children.forEach((child, i) => {
      if (i >= storms.length) return;
      const s = storms[i];
      const animLon = s.lon + t * s.speed * 0.1;
      writeLatLon(s.lat, animLon, planetRadius + 0.02, scratch.position);

      child.position.copy(scratch.position);
      child.lookAt(scratch.origin);
      child.rotateZ(t * s.rotSpeed);
      child.scale.setScalar(s.radius);
    });
  });

  if (!visible) return null;

  return (
    <group ref={groupRef}>
      {storms.map((_s, i) => (
        <group key={i}>
          <mesh>
            <coneGeometry args={[1, 2, 8]} />
            <meshBasicMaterial
              color={new Color(0.3, 0.3, 0.4)}
              transparent
              opacity={opacity * 0.4}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[1.2, 8, 8]} />
            <meshBasicMaterial
              color={new Color(0.2, 0.3, 0.5)}
              transparent
              opacity={opacity * 0.15}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ── Floating Cities (above the planet) ──

export function PlanetFloatingCities({
  visible,
  planetRadius,
  opacity,
}: {
  visible: boolean;
  planetRadius: number;
  opacity: number;
}) {
  const groupRef = useRef<Group>(null);

  const floatingCities = useMemo(() => {
    return Array.from({ length: 4 }, (_, i) => {
      const lat = (Math.random() - 0.5) * 80;
      const lon = i * 90 + Math.random() * 30;
      const altitude = planetRadius + 0.3 + Math.random() * 0.3;
      const buildings = Array.from({ length: 6 + Math.floor(Math.random() * 6) }, () => ({
        x: (Math.random() - 0.5) * 0.2,
        y: Math.random() * 0.15,
        z: (Math.random() - 0.5) * 0.2,
        w: 0.02 + Math.random() * 0.04,
        h: 0.03 + Math.random() * 0.12,
        d: 0.02 + Math.random() * 0.04,
        hue: 0.55 + Math.random() * 0.15,
      }));
      return { lat, lon, altitude, buildings, bobPhase: Math.random() * Math.PI * 2 };
    });
  }, []);

  useFrame(({ clock }) => {
    if (!groupRef.current || !visible) return;
    const t = clock.elapsedTime;

    groupRef.current.children.forEach((cityGroup, ci) => {
      if (ci >= floatingCities.length) return;
      const fc = floatingCities[ci];
      const { pos } = latLonToPos(fc.lat, fc.lon, fc.altitude);
      const bob = Math.sin(t * 0.3 + fc.bobPhase) * 0.02;
      cityGroup.position.set(pos.x + bob, pos.y, pos.z);
    });
  });

  if (!visible) return null;

  return (
    <group ref={groupRef}>
      {floatingCities.map((fc, ci) => (
        <group key={ci}>
          <mesh position={[0, -0.01, 0]}>
            <boxGeometry args={[0.25, 0.008, 0.25]} />
            <meshStandardMaterial
              color={new Color(0.3, 0.35, 0.45)}
              emissive={new Color(0.1, 0.15, 0.25)}
              emissiveIntensity={0.3}
              transparent
              opacity={opacity * 0.8}
            />
          </mesh>
          {fc.buildings.map((b, bi) => (
            <mesh key={bi} position={[b.x, b.y, b.z]}>
              <boxGeometry args={[b.w, b.h, b.d]} />
              <meshStandardMaterial
                color={new Color().setHSL(b.hue, 0.5, 0.5)}
                emissive={new Color().setHSL(b.hue, 0.6, 0.3)}
                emissiveIntensity={0.8}
                transparent
                opacity={opacity * 0.85}
              />
            </mesh>
          ))}
          <mesh>
            <sphereGeometry args={[0.3, 8, 8]} />
            <meshBasicMaterial
              color={new Color(0.4, 0.6, 1.0)}
              transparent
              opacity={opacity * 0.06}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
