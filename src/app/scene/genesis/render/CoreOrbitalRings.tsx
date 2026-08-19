/**
 * ==========================================================
 * LÉLUVERSE
 * CORE ORBITAL RINGS — THE SPHERE'S GEOMETRIC RINGS
 *
 * The reference's central sphere carries multiple transparent
 * geometric/orbital rings: bright white/cyan core, blue outer
 * glow, violet/pink surrounding glow, and a family of fine
 * luminous rings turning around it at different tilts.
 *
 * This layer adds ONLY the rings — the sphere itself remains
 * the ONE GenesisCore mesh. Each ring is a thin transparent
 * torus at its own tilt/radius; they rotate slowly, breathe
 * with the same CoreVisualState as the surface, and stay out
 * of the raycast path so clicking the Core keeps working.
 *
 * Tilted orbits: the rings sweep through the whole sphere —
 * never a flat hula-hoop, and never a cage (no two rings sit
 * on the same plane; radii grow outward so each is readable).
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, Group, MeshBasicMaterial } from "three";

import { useGenesis } from "../GenesisCore";

interface RingSeed {
  radius: number;
  tiltX: number;
  tiltY: number;
  tiltZ: number;
  speed: number;
  phase: number;
  thickness: number;
  color: string;
  baseOpacity: number;
}

const RING_SEEDS: RingSeed[] = [
  { radius: 1.28, tiltX: 1.18, tiltY: 0.42, tiltZ: 0.12, speed: 0.22, phase: 0.0, thickness: 0.006, color: "#7df9ff", baseOpacity: 0.4 },
  { radius: 1.52, tiltX: 1.62, tiltY: -0.35, tiltZ: 0.3, speed: 0.16, phase: 1.7, thickness: 0.007, color: "#38bdf8", baseOpacity: 0.32 },
  { radius: 1.78, tiltX: 0.78, tiltY: 1.15, tiltZ: -0.22, speed: 0.12, phase: 3.2, thickness: 0.006, color: "#c084fc", baseOpacity: 0.26 },
  { radius: 2.05, tiltX: 1.92, tiltY: 0.62, tiltZ: 0.42, speed: 0.09, phase: 4.9, thickness: 0.005, color: "#f472b6", baseOpacity: 0.2 },
];

export default function CoreOrbitalRings() {
  const { engineRuntime } = useGenesis();
  const root = useRef<Group>(null);
  const ringsRef = useRef<(Group | null)[]>([]);

  const rings = useMemo(
    () =>
      RING_SEEDS.map((seed, index) => ({
        seed,
        material: new MeshBasicMaterial({
          color: new Color(seed.color),
          transparent: true,
          opacity: seed.baseOpacity,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
        sparkPhase: index * 2.1,
      })),
    [],
  );

  const white = useMemo(() => new Color("#ffffff"), []);

  useFrame((_, delta) => {
    if (!root.current) {
      return;
    }

    const vs = engineRuntime?.getEngineBus().getVisualState();
    const activity = vs?.activity ?? 0.3;
    const time = vs?.time ?? performance.now() * 0.001;

    root.current.rotation.y += delta * 0.03;
    root.current.rotation.x = Math.sin(time * 0.06) * 0.03;

    rings.forEach(({ seed, material }, index) => {
      const group = ringsRef.current[index];
      if (!group) {
        return;
      }

      // Slow independent orbit per ring (the spark is a child of the ring
      // mesh, so it travels the circle as the ring turns).
      group.rotation.y += delta * seed.speed;

      // Breathe with the Core surface: activity lifts opacity and brightness.
      const breathe = 0.82 + 0.18 * Math.sin(time * 1.4 + seed.phase);
      material.opacity = seed.baseOpacity * (0.62 + activity * 0.55) * breathe;

      if (vs) {
        material.color.copy(vs.stateColor).lerp(white, 0.25).lerp(new Color(seed.color), 0.5);
      }

      // Rings grow slightly with activity so the whole sphere swells together.
      const scale = 1 + activity * 0.06 + Math.sin(time * 1.1 + seed.phase) * 0.012;
      group.scale.setScalar(scale);
    });
  });

  return (
    <group ref={root} name="CoreOrbitalRings" renderOrder={205}>
      {rings.map(({ seed, material, sparkPhase }, index) => (
        <group
          key={index}
          ref={(object) => {
            ringsRef.current[index] = object;
          }}
          rotation={[seed.tiltX, seed.tiltY, seed.tiltZ]}
        >
          <mesh material={material} raycast={() => null}>
            <torusGeometry args={[seed.radius, seed.thickness, 12, 180]} />
          </mesh>
          {/* tiny spark travelling the ring */}
          <mesh
            raycast={() => null}
            position={[Math.cos(sparkPhase) * seed.radius, 0, Math.sin(sparkPhase) * seed.radius]}
          >
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.85}
              blending={AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
