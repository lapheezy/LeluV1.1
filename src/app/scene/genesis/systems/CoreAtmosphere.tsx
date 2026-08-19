/**
 * ==========================================================
 * LÉLUVERSE
 * CORE ATMOSPHERE — THE CORE'S LIGHT SOURCE
 *
 * The Core's glow lives ON the single Core surface (the fresnel
 * rim in GenesisCoreMaterial). Nothing is wrapped around the Core
 * as a shell, halo, or cage — the aurora belongs to the cosmic
 * environment (AuroraCosmos + the cosmic ring field inside the
 * Universe group), never to the Core.
 *
 * This system owns ONE thing: the point light that illuminates
 * the Core and the nearby cosmos. It reads the same authoritative
 * CoreVisualState as the surface, so the light always matches the
 * Core's current engine-state color — one color controller.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group, PointLight } from "three";

import { useGenesis } from "../GenesisCore";

export default function CoreAtmosphere() {
  const { engineRuntime } = useGenesis();

  const field = useRef<Group>(null);

  const light = useRef<PointLight>(null);

  useFrame(() => {
    if (!field.current || !light.current) {
      return;
    }

    // ONE visual state — the same color/pulse as the Core surface.
    const vs = engineRuntime?.getEngineBus().getVisualState();
    if (!vs) {
      return;
    }

    light.current.color.copy(vs.stateColor);

    // Gentle light breathing on the same heartbeat as the Core surface.
    const breathe = 0.5 + 0.5 * Math.sin(vs.time * 1.4);
    light.current.intensity = 1.0 + vs.activity * 1.0 + breathe * 0.2;
  });

  return (
    <group ref={field} name="CoreAtmosphere" renderOrder={6}>
      <pointLight
        ref={light}
        color="#79e8ff"
        intensity={1.5}
        distance={4.5}
      />
    </group>
  );
}
