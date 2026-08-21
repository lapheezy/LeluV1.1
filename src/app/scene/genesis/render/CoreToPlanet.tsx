/**
 * ==========================================================
 * LÉLUVERSE — CORE TO PLANET
 *
 * THE CORE IS NEVER HIDDEN.
 *
 * During CORE_SEED: Original Core renders alone.
 * During FORMATION+: Planet layers are ADDED as children.
 *   The Core itself scales and shifts color to become the planet.
 *   Ocean, continents, atmosphere, clouds layer ON TOP of the Core.
 * During COLLAPSE: Layers fade away, Core contracts.
 * During REBIRTH: Core flashes, layers gone, ready for next cycle.
 *
 * THE CORE IS THE PLANET. THE PLANET IS THE CORE.
 * ==========================================================
 */

import React, { useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, Color } from "three";
import WorldLifecycle from "../engines/WorldLifecycle";
import { WorldPhase } from "../engines/EngineDomains";
import PlanetVisualLayers from "./PlanetVisual";

interface CoreToPlanetProps {
  coreRef: React.RefObject<Group | null>;
}

export default function CoreToPlanet({ coreRef }: CoreToPlanetProps) {
  const [lifecycleState, setLifecycleState] = React.useState(() =>
    WorldLifecycle.getInstance().getState()
  );

  useEffect(() => {
    return WorldLifecycle.getInstance().subscribe(setLifecycleState);
  }, []);

  const { phase, phaseProgress } = lifecycleState;

  // THE CORE IS NEVER HIDDEN.
  // It scales and changes color to become the planet.

  useFrame((_, delta) => {
    if (!coreRef.current) return;

    // ── SCALE: Core grows during formation, full during planet, shrinks during collapse ──
    let targetScale: number;
    switch (phase) {
      case WorldPhase.CORE_SEED:
        targetScale = 1.0;
        break;
      case WorldPhase.FORMATION:
        targetScale = 1.0 + phaseProgress * 0.4; // 1.0 → 1.4
        break;
      case WorldPhase.EXPANSION:
        targetScale = 1.3 + phaseProgress * 0.3; // 1.3 → 1.6
        break;
      case WorldPhase.PLANET:
      case WorldPhase.LIFE:
      case WorldPhase.MIND:
      case WorldPhase.FULL_WORLD:
      case WorldPhase.SUNSET:
        targetScale = 1.5;
        break;
      case WorldPhase.COLLAPSE:
        targetScale = 1.5 * (1 - phaseProgress * 0.6); // 1.5 → 0.6
        break;
      case WorldPhase.REBIRTH:
        targetScale = 0.6 + Math.sin(phaseProgress * Math.PI * 3) * 0.3; // pulse
        break;
      default:
        targetScale = 1.0;
    }

    const currentScale = coreRef.current.scale.x;
    const lerp = Math.min(1, delta * 2.5);
    const newScale = currentScale + (targetScale - currentScale) * lerp;
    coreRef.current.scale.setScalar(newScale);

    // ── COLOR: Core shifts hue based on phase ──
    let targetEmissive: Color;
    let targetEmissiveIntensity: number;
    switch (phase) {
      case WorldPhase.CORE_SEED:
        targetEmissive = new Color(0x00aaff); // original cyan
        targetEmissiveIntensity = 0.6;
        break;
      case WorldPhase.FORMATION:
        targetEmissive = new Color(0x0088dd); // cosmic blue
        targetEmissiveIntensity = 0.5;
        break;
      case WorldPhase.EXPANSION:
        targetEmissive = new Color(0x0066aa); // deeper blue
        targetEmissiveIntensity = 0.4;
        break;
      case WorldPhase.PLANET:
      case WorldPhase.LIFE:
        targetEmissive = new Color(0x005588); // oceanic
        targetEmissiveIntensity = 0.25;
        break;
      case WorldPhase.MIND:
      case WorldPhase.FULL_WORLD:
        targetEmissive = new Color(0x004466); // muted blue
        targetEmissiveIntensity = 0.15;
        break;
      case WorldPhase.SUNSET:
        targetEmissive = new Color(0xcc6600); // orange sunset
        targetEmissiveIntensity = 0.3;
        break;
      case WorldPhase.COLLAPSE:
        targetEmissive = new Color(0xff3300); // red
        targetEmissiveIntensity = 0.6 + phaseProgress * 0.4;
        break;
      case WorldPhase.REBIRTH:
        targetEmissive = new Color(0x88ddff); // bright cyan flash
        targetEmissiveIntensity = 0.8;
        break;
      default:
        targetEmissive = new Color(0x00aaff);
        targetEmissiveIntensity = 0.6;
    }

    // Apply color to all child meshes
    coreRef.current.traverse((child) => {
      if (child instanceof Mesh && child.material) {
        const mat = child.material as any;
        if (mat.emissive && mat.emissive.lerp) {
          mat.emissive.lerp(targetEmissive, lerp);
          if (mat.emissiveIntensity !== undefined) {
            mat.emissiveIntensity +=
              (targetEmissiveIntensity - mat.emissiveIntensity) * lerp;
          }
        }
      }
    });
  });

  return (
    <>
      {/* Planet layers rendered as children of the core group */}
      {/* They layer ON TOP of the Core mesh — the Core is never hidden */}
      <PlanetVisualLayers />
    </>
  );
}
