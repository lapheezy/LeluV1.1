/**
 * ==========================================================
 * LÉLUVERSE — PLANET SURFACE LAYERS
 *
 * Camera-facing tangent-patch environments streamed in by
 * PlanetSurfaceLOD. Every layer lives in a LOCAL tangent frame:
 *   · origin sits on the planet surface
 *   · +Y points away from the planet (the surface normal)
 *   · ground is a plane at y ≈ 0
 * The orchestrator positions + orients the parent group, so these
 * components only describe what the ground looks like underfoot.
 *
 * All geometry is deterministic (seeded), so the same biome always
 * regenerates identically — no popping as the camera pans.
 * ==========================================================
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  InstancedMesh,
  Object3D,
} from "three";
import { seededRng } from "./PlanetBiomes";

const PATCH = 5; // patch edge length in world units

interface Placement {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
}

/** Instanced scatter helper — writes matrices once (stable seed). */
function useScatter<T>(items: T[], place: (item: T, i: number) => Placement) {
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, i) => {
      const p = place(item, i);
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.rotation.set(0, p.ry, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [items, place, dummy]);

  return ref;
}

/* ------------------------------------------------------------------
 * VEGETATION — forest / jungle / grassland / savanna
 * ------------------------------------------------------------------ */

interface VegetationVariant {
  ground: string;
  treeDensity: number;
  treeHeight: number;
  trunk: boolean;
  grassDensity: number;
  grassColor: string;
  mist: boolean;
  treeColor: string;
}

const VEGETATION: Record<"forest" | "jungle" | "grassland" | "savanna", VegetationVariant> = {
  forest: {
    ground: "#1c2f1a", treeDensity: 46, treeHeight: 0.5, trunk: true,
    grassDensity: 90, grassColor: "#3f7d3a", mist: false, treeColor: "#2f6b3a",
  },
  jungle: {
    ground: "#12301c", treeDensity: 64, treeHeight: 0.8, trunk: true,
    grassDensity: 110, grassColor: "#2f9a4c", mist: true, treeColor: "#1e6b3e",
  },
  grassland: {
    ground: "#3c5a28", treeDensity: 4, treeHeight: 0.4, trunk: true,
    grassDensity: 220, grassColor: "#7fb85a", mist: false, treeColor: "#3f7d3a",
  },
  savanna: {
    ground: "#7a6a3c", treeDensity: 12, treeHeight: 0.5, trunk: true,
    grassDensity: 120, grassColor: "#b3a352", mist: false, treeColor: "#7a8a3c",
  },
};

export function VegetationSurface({ variant }: { variant: "forest" | "jungle" | "grassland" | "savanna" }) {
  const v = VEGETATION[variant];

  const trees = useMemo(() => {
    const rnd = seededRng(variant === "jungle" ? 202 : variant === "forest" ? 201 : variant === "grassland" ? 203 : 204);
    return Array.from({ length: v.treeDensity }, () => ({
      x: (rnd() - 0.5) * (PATCH - 0.4),
      z: (rnd() - 0.5) * (PATCH - 0.4),
      s: 0.7 + rnd() * 0.8,
      ry: rnd() * Math.PI * 2,
      trunk: v.trunk && rnd() > 0.25,
    }));
  }, [v.treeDensity, v.trunk, variant]);

  const grass = useMemo(() => {
    const rnd = seededRng(variant === "jungle" ? 302 : 301);
    return Array.from({ length: v.grassDensity }, () => ({
      x: (rnd() - 0.5) * PATCH,
      z: (rnd() - 0.5) * PATCH,
      s: 0.3 + rnd() * 0.5,
      ry: rnd() * Math.PI * 2,
    }));
  }, [v.grassDensity, variant]);

  const treeRef = useScatter(trees, (t) => ({
    x: t.x, y: 0.09 * t.s, z: t.z,
    sx: 0.09 * t.s, sy: 0.3 * t.s * v.treeHeight, sz: 0.09 * t.s, ry: t.ry,
  }));
  const grassRef = useScatter(grass, (g) => ({
    x: g.x, y: 0.012, z: g.z, sx: 0.02 * g.s, sy: 0.05 * g.s, sz: 0.02 * g.s, ry: g.ry,
  }));

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[PATCH, PATCH]} />
        <meshStandardMaterial color={v.ground} roughness={0.95} metalness={0} />
      </mesh>

      <instancedMesh ref={treeRef} args={[undefined, undefined, trees.length]} frustumCulled={false}>
        <coneGeometry args={[1, 2, 7]} />
        <meshStandardMaterial color={v.treeColor} roughness={0.85} />
      </instancedMesh>

      <instancedMesh ref={grassRef} args={[undefined, undefined, grass.length]} frustumCulled={false}>
        <coneGeometry args={[0.5, 2, 4]} />
        <meshStandardMaterial color={v.grassColor} roughness={0.9} />
      </instancedMesh>

      {v.mist && (
        <group>
          {Array.from({ length: 6 }).map((_, i) => (
            <mesh
              key={i}
              position={[Math.sin(i * 2.3) * 1.4, 0.35, Math.cos(i * 1.9) * 1.4]}
            >
              <sphereGeometry args={[0.7, 10, 10]} />
              <meshBasicMaterial color="#8fe0c8" transparent opacity={0.06} blending={AdditiveBlending} depthWrite={false} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------
 * DESERT — dunes, rocks, sparse dry shrubs
 * ------------------------------------------------------------------ */

export function DesertSurface() {
  const dunes = useMemo(() => {
    const rnd = seededRng(401);
    return Array.from({ length: 26 }, () => ({
      x: (rnd() - 0.5) * PATCH,
      z: (rnd() - 0.5) * PATCH,
      s: 0.5 + rnd() * 1.1,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);

  const rocks = useMemo(() => {
    const rnd = seededRng(402);
    return Array.from({ length: 16 }, () => ({
      x: (rnd() - 0.5) * PATCH,
      z: (rnd() - 0.5) * PATCH,
      s: 0.15 + rnd() * 0.3,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);

  const duneRef = useScatter(dunes, (d) => ({
    x: d.x, y: 0.02, z: d.z, sx: d.s, sy: d.s * 0.14, sz: d.s * 0.7, ry: d.ry,
  }));
  const rockRef = useScatter(rocks, (r) => ({
    x: r.x, y: r.s * 0.4, z: r.z, sx: r.s, sy: r.s * 0.8, sz: r.s, ry: r.ry,
  }));

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[PATCH, PATCH]} />
        <meshStandardMaterial color="#c9a35e" roughness={1} />
      </mesh>
      <instancedMesh ref={duneRef} args={[undefined, undefined, dunes.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#d7b273" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={rockRef} args={[undefined, undefined, rocks.length]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#8a6a4a" roughness={1} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------
 * MOUNTAIN — rocky peaks + snow caps + boulders
 * ------------------------------------------------------------------ */

export function MountainSurface() {
  const peaks = useMemo(() => {
    const rnd = seededRng(501);
    return Array.from({ length: 14 }, () => ({
      x: (rnd() - 0.5) * PATCH,
      z: (rnd() - 0.5) * PATCH,
      s: 0.5 + rnd() * 1.4,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);

  const peakRef = useScatter(peaks, (p) => ({
    x: p.x, y: p.s * 0.3, z: p.z, sx: p.s, sy: p.s * 0.8, sz: p.s, ry: p.ry,
  }));

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[PATCH, PATCH]} />
        <meshStandardMaterial color="#6a7380" roughness={1} />
      </mesh>
      <instancedMesh ref={peakRef} args={[undefined, undefined, peaks.length]} frustumCulled={false}>
        <coneGeometry args={[1, 1.6, 6]} />
        <meshStandardMaterial color="#7d8794" roughness={1} />
      </instancedMesh>
      {/* Snow caps */}
      {peaks.map((p, i) => (
        <mesh key={`snow-${i}`} position={[p.x, p.s * 0.62, p.z]} scale={[p.s * 0.55, p.s * 0.18, p.s * 0.55]}>
          <coneGeometry args={[1, 1.6, 6]} />
          <meshStandardMaterial color="#eaf6ff" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------
 * POLAR — snow fields + ice shards
 * ------------------------------------------------------------------ */

export function PolarSurface() {
  const ice = useMemo(() => {
    const rnd = seededRng(601);
    return Array.from({ length: 40 }, () => ({
      x: (rnd() - 0.5) * PATCH,
      z: (rnd() - 0.5) * PATCH,
      s: 0.1 + rnd() * 0.4,
      h: 0.15 + rnd() * 0.5,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);

  const iceRef = useScatter(ice, (i) => ({
    x: i.x, y: i.h / 2, z: i.z, sx: i.s, sy: i.h, sz: i.s, ry: i.ry,
  }));

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[PATCH, PATCH]} />
        <meshStandardMaterial color="#dff2ff" roughness={0.5} />
      </mesh>
      <instancedMesh ref={iceRef} args={[undefined, undefined, ice.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#bfe6ff" roughness={0.3} emissive="#7fb8d8" emissiveIntensity={0.15} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------
 * COAST — sand, shallow water strip, rocks, palms
 * ------------------------------------------------------------------ */

export function CoastSurface() {
  const rocks = useMemo(() => {
    const rnd = seededRng(701);
    return Array.from({ length: 10 }, () => ({
      x: (rnd() - 0.5) * PATCH,
      z: (rnd() - 0.5) * PATCH,
      s: 0.15 + rnd() * 0.25,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);

  const palms = useMemo(() => {
    const rnd = seededRng(702);
    return Array.from({ length: 7 }, () => ({
      x: (rnd() - 0.5) * (PATCH - 1),
      z: (rnd() - 0.5) * (PATCH - 1),
      s: 0.6 + rnd() * 0.5,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);

  const rockRef = useScatter(rocks, (r) => ({
    x: r.x, y: r.s * 0.4, z: r.z, sx: r.s, sy: r.s * 0.8, sz: r.s, ry: r.ry,
  }));
  const palmRef = useScatter(palms, (p) => ({
    x: p.x, y: 0.08 * p.s, z: p.z, sx: 0.08 * p.s, sy: 0.22 * p.s, sz: 0.08 * p.s, ry: p.ry,
  }));

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[PATCH, PATCH]} />
        <meshStandardMaterial color="#d9bd82" roughness={1} />
      </mesh>
      {/* Shallow water toward one edge */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 2]} >
        <planeGeometry args={[PATCH, 1.6]} />
        <meshStandardMaterial color="#3f8cff" transparent opacity={0.55} roughness={0.2} />
      </mesh>
      <instancedMesh ref={rockRef} args={[undefined, undefined, rocks.length]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#6a7266" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={palmRef} args={[undefined, undefined, palms.length]} frustumCulled={false}>
        <coneGeometry args={[1, 2, 7]} />
        <meshStandardMaterial color="#2f7a45" roughness={0.85} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------
 * OCEAN — animated water surface + seabed + bioluminescent motes
 * ------------------------------------------------------------------ */

export function OceanSurface() {
  const waterRef = useRef<any>(null);
  const kelp = useMemo(() => {
    const rnd = seededRng(801);
    return Array.from({ length: 30 }, () => ({
      x: (rnd() - 0.5) * PATCH,
      z: (rnd() - 0.5) * PATCH,
      h: 0.15 + rnd() * 0.4,
      ry: rnd() * Math.PI * 2,
    }));
  }, []);

  const kelpRef = useScatter(kelp, (k) => ({
    x: k.x, y: k.h / 2 - 0.25, z: k.z, sx: 0.02, sy: k.h, sz: 0.02, ry: k.ry,
  }));

  useFrame(({ clock }) => {
    if (!waterRef.current) return;
    // Subtle wave pulse on the water material.
    const m = waterRef.current.material;
    if (m) m.opacity = 0.5 + Math.sin(clock.elapsedTime * 1.4) * 0.06;
  });

  return (
    <group>
      {/* Seabed */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.3}>
        <planeGeometry args={[PATCH, PATCH]} />
        <meshStandardMaterial color="#123a4a" roughness={1} />
      </mesh>

      {/* Water surface */}
      <mesh ref={waterRef} rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[PATCH, PATCH]} />
        <meshStandardMaterial color="#2f7ce0" transparent opacity={0.5} roughness={0.15} />
      </mesh>

      {/* Kelp */}
      <instancedMesh ref={kelpRef} args={[undefined, undefined, kelp.length]} frustumCulled={false}>
        <cylinderGeometry args={[0.4, 1, 1, 5]} />
        <meshStandardMaterial color="#2f9a6a" roughness={0.9} />
      </instancedMesh>

      {/* Bioluminescent motes */}
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh key={i} position={[Math.sin(i * 2.1) * 1.7, -0.12, Math.cos(i * 1.6) * 1.7]}>
          <sphereGeometry args={[0.02, 6, 6]} />
          <meshBasicMaterial color="#7ef2ff" transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
