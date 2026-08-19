/**
 * ==========================================================
 * LÉLUVERSE
 * LIFE EVOLUTION — INTERNAL LIFE LAYER OF THE ONE CORE
 *
 * The second body that used to render over the Core — a separate
 * green sphere plus an independent green point light — is gone.
 * Life/evolution visualization now lives in two places, both part
 * of the ONE GenesisCore system:
 *
 *   - on the single Core surface (bio engine state, growth and
 *     emergence feeds of GenesisCoreMaterial), and
 *   - these internal life motes, which drift inside the Core and
 *     breathe, glow and tint with the SAME CoreVisualState that
 *     drives the surface — one color, one pulse, one mutation
 *     controller.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, Group, Mesh, MeshBasicMaterial } from "three";

import { useGenesis } from "../GenesisCore";

export default function LifeEvolutionVisualizer() {
  const { engineRuntime } = useGenesis();

  const lifeGroup = useRef<Group>(null);

  const growthGroup = useRef<Group>(null);

  const tint = useMemo(() => new Color("#8cffb8"), []);

  const white = useMemo(() => new Color("#ffffff"), []);

  const organisms = useMemo(() => Array.from({ length: 24 }), []);

  useFrame((_, delta) => {
    if (!lifeGroup.current || !growthGroup.current) {
      return;
    }

    // The ONE visual state — the motes are internal layers of the
    // same Core, never an independent system.
    const vs = engineRuntime?.getEngineBus().getVisualState();
    if (!vs) {
      return;
    }

    lifeGroup.current.scale.setScalar(
      1 +
        Math.sin(vs.time * 0.4) *
          (0.003 + vs.activity * 0.006),
    );

    growthGroup.current.rotation.y +=
      delta * (0.02 + vs.activity * 0.05);

    growthGroup.current.rotation.x =
      Math.sin(vs.time * 0.15) * 0.02 * vs.activity;

    // Life motes take the Core's current engine-state color, lifted
    // toward white, so they always match the surface's living state.
    tint.copy(vs.stateColor).lerp(white, 0.45);

    growthGroup.current.children.forEach((child) => {
      const mesh = child as Mesh;
      const material = mesh.material as MeshBasicMaterial;
      material.color.copy(tint);
      material.opacity = 0.22 + vs.activity * 0.32 + vs.life * 0.2;
    });
  });

  return (
    <group ref={lifeGroup} name="LifeEvolution" renderOrder={10}>
      <group ref={growthGroup} name="EvolutionNodes">
        {organisms.map((_, i) => (
          <mesh
            key={i}
            position={[
              Math.sin(i * 0.9) * 0.82,
              Math.cos(i * 1.3) * 0.82,
              Math.sin(i * 2.1) * 0.82,
            ]}
          >
            <sphereGeometry args={[0.022 + (i % 3) * 0.006, 10, 10]} />
            <meshBasicMaterial
              color="#8cffb8"
              transparent
              opacity={0.4}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
