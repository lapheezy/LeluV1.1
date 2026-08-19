/**
 * ==========================================================
 * LÉLUVERSE
 * COSMOS
 *
 * Master living universe environment. Atmospheric motion is owned by
 * AuroraCosmos; this component keeps the environment's slow orbital drift
 * synchronized with the canonical universe snapshot.
 *
 * Also owns the deep-space backdrop — the full-viewport procedural sky that
 * carries depth, nebula color, and dust across the entire screen so no
 * region reads as dead black.
 * ==========================================================
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group } from "three";

import { useGenesis } from "../GenesisCore";
import AuroraCosmos from "./AuroraCosmos";
import CosmicBackdrop from "./CosmicBackdrop";

export default function Cosmos() {
  const { getLiveUniverse } = useGenesis();
  const universe = useRef<Group>(null);

  useFrame(({ clock }, delta) => {
    if (!universe.current) {
      return;
    }

    const liveUniverse = getLiveUniverse();
    const cosmicEnergy = liveUniverse.celestial.cosmicEnergy;
    const activity = Math.min(
      1,
      0.18 +
        cosmicEnergy * 0.4 +
        liveUniverse.evolutionSystem.emergence * 0.28 +
        liveUniverse.astrology.transit * 0.18,
    );

    universe.current.position.x = Math.sin(clock.elapsedTime * 0.02) * (0.25 + activity * 0.18);
    universe.current.position.y = Math.cos(clock.elapsedTime * 0.015) * (0.16 + activity * 0.12);
    universe.current.rotation.z = Math.sin(clock.elapsedTime * 0.01) * 0.018;
    universe.current.rotation.y += delta * (0.0015 + activity * 0.003);
  });

  return (
    <group ref={universe} name="CosmicEnvironment" renderOrder={4}>
      {/* Deep-space backdrop: full-viewport procedural sky behind every layer. */}
      <CosmicBackdrop />

      <AuroraCosmos />
    </group>
  );
}
