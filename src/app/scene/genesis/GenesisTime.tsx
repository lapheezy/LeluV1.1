/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS TIME
 *
 * Master simulation heartbeat.
 *
 * Runs:
 * - engine runtime
 * - universe updates
 * - cosmic clock
 *
 * ==========================================================
 */


import { useFrame } from "@react-three/fiber";
import { useGenesis } from "./GenesisCore";

export default function GenesisTime() {
  const { updateUniverse, engineRuntime } = useGenesis();

  useFrame((_, delta) => {
    if (!engineRuntime) {
      return;
    }

    updateUniverse((state) => {
      engineRuntime.update(state, delta);
    });
  });

  return null;
}