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
import CoreToPlanet from "./CoreToPlanet";

import { TestPlanet } from "./DebugPlanet";

import { useGenesis } from "../GenesisCore";

export default function GenesisRenderer() {
  const root = useRef<Group>(null);
  const coreGroupRef = useRef<Group>(null);
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

      <group ref={coreGroupRef} name="BlueGenesisCore" position={[0, 1.15, 0]}>
        {/* Core ↔ Planet transition driven by WorldLifecycle */}
        <CoreToPlanet coreRef={coreGroupRef} />
        <GenesisCore>
          <LifeEvolutionVisualizer />
        </GenesisCore>
        <CoreOrbitalRings />
        <CoreEmission />
        <CoreAtmosphere />
      </group>

      {/* ═══ TEST PLANET — lifecycle-connected, surrounds Core (r=2.0 vs Core r=0.9) ═══ */}
      <TestPlanet />

    </group>
  );
}
