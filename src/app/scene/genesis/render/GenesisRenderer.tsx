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
import CosmosPhaseLight from "../systems/CosmosPhaseLight";
import GenesisCore from "../materials/GenesisCore";
import CosmicField from "./CosmicField";
import CoreToPlanet from "./CoreToPlanet";

import { TestPlanet } from "./DebugPlanet";

import { useGenesisScene } from "../useGenesisScene";

export default function GenesisRenderer() {
  const root = useRef<Group>(null);
  const coreGroupRef = useRef<Group>(null);
  // The SCENE context, which never changes identity.
  //
  // This read `engineRuntime` from useGenesis(), whose value is rebuilt
  // whenever any part of the monolithic Genesis state changes — so the
  // component compositing the whole 3D world re-rendered, and with it
  // StarField, Cosmos, AuroraCosmos and CoreAtmosphere beneath it, for
  // reasons that had nothing to do with the scene. Measured with the
  // render ledger: 12 re-renders each per message, with EngineTick
  // already at zero, which is what pointed here.
  //
  // NOT destructured, for the same reason EngineTick does not: the
  // runtime is created in GenesisCore's own effect, which runs AFTER
  // this component's, so a value captured at render time can be null
  // for good once nothing re-renders this. The getter is read per
  // frame instead.
  const scene = useGenesisScene("GenesisRenderer");

  useFrame((_, delta) => {
    if (root.current) {
      root.current.rotation.y += delta * 0.002;
    }

    // The simulation heartbeat now runs in the app-level EngineTick so
    // the ONE Core keeps evolving while ANY workspace owns the viewport
    // (this v1 canvas unmounts when Genesis v2 or the LÉLU system opens).
    // The canvas only renders the shared state; it no longer advances it.
    if (scene.engineRuntime) {
      scene.engineRuntime.markRendererRead();
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
        <CosmosPhaseLight />
      </group>

      {/* ═══ TEST PLANET — lifecycle-connected, surrounds Core (r=2.0 vs Core r=0.9) ═══ */}
      <TestPlanet />

    </group>
  );
}
