/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS RENDERER
 *
 * Master visual compositor.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group } from "three";

import Cosmos from "../environment/Cosmos";
import StarField from "../environment/stars/StarField";
import CoreEmission from "./CoreEmission";
import CoreOrbitalRings from "./CoreOrbitalRings";
import LifeEvolutionVisualizer from "./LifeEvolutionVisualizer";
import CoreMemoryVeins from "./CoreMemoryVeins";
import CoreAtmosphere from "../systems/CoreAtmosphere";
import GenesisCore from "../materials/GenesisCore";
import CosmicField from "./CosmicField";
import { useGenesis } from "../GenesisCore";

export default function GenesisRenderer() {
  const root = useRef<Group>(null);
  const { engineRuntime } = useGenesis();

  useFrame((_, delta) => {
    if (root.current) {
      root.current.rotation.y += delta * 0.002;
    }

    // The simulation heartbeat now runs in the app-level EngineTick so
    // the ONE Core keeps evolving while ANY workspace owns the viewport
    // (this v1 canvas unmounts when Genesis v2 or the LÉLU system opens).
    // The canvas only renders the shared state; it no longer advances it.
    if (engineRuntime) {
      engineRuntime.markRendererRead();
    }
  });

  return (
    <group ref={root} name="GenesisWorld">
      <group name="Universe">
        <StarField />
        <Cosmos />
        {/* The cosmic ring/nodes field and the memory lattice are part of the
            ENVIRONMENT — distributed through the star field with depth —
            never a shell wrapped around the Core. */}
        <CosmicField />
        <CoreMemoryVeins />
      </group>

      <group name="BlueGenesisCore" position={[0, 1.15, 0]}>
        {/* ONE Core — one origin, one transform, one mutation controller.
            The single mesh material carries every engine state (ocean,
            plasma, electric, crystal, halo, bio) weighted by the EngineBus
            channels, and CoreEmission is energy leaving that same surface
            — particles, electric arcs, ocean rings. The old second
            controller (CoreLayer / LivingCoreController) that used to
            rotate and breathe the same core with its own formula has been
            merged into this one body: the mesh is the ONLY transform
            controller of the ONLY core object. The life motes are nested
            inside the same mesh so they share the one transform.

            The cluster sits at [0, 1.15, 0] so the real Core anchors the
            workspace-preview diamond (top-center), with Creation Studio
            to its left and Research Lab to its right (see
            GenesisWorkspace.tsx) — the reference composition. */}
        <GenesisCore>
          <LifeEvolutionVisualizer />
        </GenesisCore>
        {/* Transparent geometric/orbital rings around the ONE Core — the
            reference's ring family. Pure visual layer, raycast-free, driven
            by the same CoreVisualState so it breathes with the surface. */}
        <CoreOrbitalRings />
        <CoreEmission />

        {/* The Core's light source, driven by the same palette. The aurora
            lives in the cosmic environment (AuroraCosmos inside the Universe
            group), never wrapped around the Core. */}
        <CoreAtmosphere />
      </group>
    </group>
  );
}
