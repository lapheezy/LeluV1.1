/**
 * ==========================================================
 * LÉLUVERSE
 * CORE MEMORY VEINS — MEMORY LATTICE OF THE COSMOS
 *
 * The memory lattice used to render as thin rings hugging the
 * Core surface (radius ~1.16), which read as a shell/cage around
 * the ONE Genesis Core. It no longer does: the lattice now lives
 * in the cosmic ENVIRONMENT, among the stars and aurora, so the
 * Core stays visually dominant and clearly readable.
 *
 * Each ring is a wide, faint orbit at a different azimuth and
 * depth tier. The whole lattice still represents the Core's
 * memory — opacity follows the universe memory energy — and its
 * color follows the SAME EngineBus CoreVisualState as the Core
 * surface, so the environment coordinates with the one living
 * system instead of wearing an independent palette.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, Group, Mesh, MeshBasicMaterial } from "three";

import { useGenesis } from "../GenesisCore";

export default function CoreMemoryVeins() {
  const { getLiveUniverse, engineRuntime } = useGenesis();

  const group = useRef<Group>(null);

  const tint = useMemo(() => new Color("#a7f6ff"), []);

  const white = useMemo(() => new Color("#ffffff"), []);

  const veins = useMemo(
    () =>
      Array.from({ length: 2 }, (_, index) => {
        // One orbit per memory ring, fanned around the whole environment:
        // different azimuth, depth tier and tilt so the lattice flows
        // through the cosmos instead of circling the Core.
        const azimuth = (index / 8) * Math.PI * 2 + 0.35;
        const tier = index % 2;
        const radius = (tier === 0 ? 8.5 : 13) + (index % 4) * 1.7;
        return {
          position: [
            Math.cos(azimuth) * radius * 0.45,
            (index % 3) * 1.4 - 1.4 + Math.sin(index * 1.7) * 1.2,
            Math.sin(azimuth) * radius * 0.45 - (tier === 0 ? 2 : 6),
          ] as [number, number, number],
          tiltX: 0.35 + (index % 3) * 0.3,
          tiltY: azimuth + Math.PI / 2,
          tiltZ: ((index % 5) - 2) * 0.14,
          orbitRadius: (tier === 0 ? 7.5 : 11.5) + (index % 3) * 1.4,
        };
      }),
    [],
  );

  useFrame((_, delta) => {
    if (!group.current) {
      return;
    }

    const liveUniverse = getLiveUniverse();
    const memoryEnergy =
      (liveUniverse.memory.shortTerm +
        liveUniverse.memory.longTerm +
        liveUniverse.memory.archived) *
      0.33;
    const emergence = liveUniverse.evolutionSystem.emergence;

    // ONE visual state — the lattice is part of the same living system
    // as the Core, so it takes the Core's current engine-state color.
    const vs = engineRuntime?.getEngineBus().getVisualState();

    group.current.rotation.y +=
      delta * (0.008 + memoryEnergy * 0.02 + emergence * 0.01);
    group.current.rotation.x =
      Math.sin(performance.now() * 0.00006) * 0.02;

    const liveOpacity = Math.min(
      0.5,
      0.12 +
        liveUniverse.memory.importance * 0.2 +
        emergence * 0.1 +
        (liveUniverse.pulse.intensity ?? 0) * 0.08 +
        (vs ? vs.activity * 0.1 : 0),
    );

    if (vs) {
      tint.copy(vs.stateColor).lerp(white, 0.4);
    }

    group.current.children.forEach((child) => {
      const mesh = child as Mesh;
      const material = mesh.material as MeshBasicMaterial;
      material.color.copy(tint);
      material.opacity = liveOpacity;
    });
  });

  return (
    <group ref={group} name="CoreMemoryVeins" renderOrder={6}>
      {veins.map((vein, index) => (
        <mesh
          key={index}
          position={vein.position}
          rotation={[vein.tiltX, vein.tiltY, vein.tiltZ]}
        >
          <torusGeometry args={[vein.orbitRadius, 0.012, 12, 160]} />
          <meshBasicMaterial
            color="#a7f6ff"
            transparent
            opacity={0.16}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
