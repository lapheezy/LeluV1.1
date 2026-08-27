/**
 * ==========================================================
 * LÉLUVERSE — COSMOS PHASE LIGHT
 *
 * A point light that:
 * - Flashes brightly during the hurricane/lightning phase
 * - Changes color based on the current atmosphere phase
 * - Provides visual feedback that the cosmos lifecycle is active
 *
 * Mounted inside the GenesisRenderer scene graph.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PointLight } from "three";

import { sampleCosmosAtmosphere } from "../cosmos/CosmosAtmosphere";

const PHASE_COLORS: Record<string, [number, number, number]> = {
  "deep-black-space": [0.05, 0.05, 0.12],
  "core-colors": [0.15, 0.4, 0.9],
  "sunset": [0.95, 0.35, 0.15],
  "static": [0.4, 0.7, 0.95],
  "storm": [0.6, 0.3, 0.8],
  "hurricane": [0.9, 0.7, 1.0],
  "dissipation": [0.08, 0.08, 0.15],
  "rainbow": [0.85, 0.55, 1.0],
};

export default function CosmosPhaseLight() {
  const light = useRef<PointLight>(null);

  useFrame(({ clock }) => {
    if (!light.current) return;

    const atmosphere = sampleCosmosAtmosphere(clock.elapsedTime);
    const t = clock.elapsedTime;

    // Base intensity from the atmosphere cycle
    const baseIntensity = 0.3 + atmosphere.intensity * 2.0;

    // Lightning flashes during hurricane phase
    const flash1 = Math.pow(
      Math.max(0, Math.sin(t * 13.0 + 1.7)),
      20.0,
    );
    const flash2 = Math.pow(
      Math.max(0, Math.sin(t * 19.0 + 4.3)),
      26.0,
    );
    const lightningFlash =
      atmosphere.lightning * (flash1 * 12.0 + flash2 * 8.0);

    light.current.intensity = baseIntensity + lightningFlash;

    // Color from the current phase
    const phaseColor = PHASE_COLORS[atmosphere.phase] ?? [0.1, 0.1, 0.2];
    light.current.color.setRGB(phaseColor[0], phaseColor[1], phaseColor[2]);

    // Position shifts subtly with phase
    light.current.position.x = Math.sin(t * 0.07) * 3;
    light.current.position.y = 2 + Math.cos(t * 0.05) * 1.5;
    light.current.position.z = Math.sin(t * 0.09) * 2 - 1;
  });

  return (
    <pointLight
      ref={light}
      position={[0, 2, -1]}
      intensity={0.5}
      distance={15}
      decay={2}
    />
  );
}
