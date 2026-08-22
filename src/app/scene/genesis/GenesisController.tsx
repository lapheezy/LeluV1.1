/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CONTROLLER
 *
 * Master Genesis composition layer.
 *
 * Connects:
 * - time
 * - AI bridge
 * - renderer
 * - interface
 * - playground
 * - navigator
 * - workspace
 * ==========================================================
 */


import {
  lazy,
  Suspense,
  useMemo,
} from "react";


import GenesisBridge
  from "./GenesisBridge";


import VoiceBridge
  from "./VoiceBridge";


import ProactiveBridge
  from "./ProactiveBridge";


import GenesisRenderer
  from "./render/GenesisRenderer";


import GenesisCameraController
  from "./GenesisCameraController";

// The cosmos background (stars, nebulae, galaxies, clouds, lightning,
// vehicles, entities) is code-split so the v1 core canvas paints first
// and the universe streams in as its own chunk.
const CosmosLayer = lazy(() => import("./cosmos/CosmosLayer"));

import GenesisPlayground
  from "./GenesisPlayground";


import GenesisWorkspace
  from "./GenesisWorkspace";


import GenesisNavigator
  from "./GenesisNavigator";




export default function GenesisController() {


  const navigator =
    useMemo(
      () => new GenesisNavigator(),
      [],
    );


  return (
    <>
      {/* ==========================================
          AI → GENESIS
      ========================================== */}

      <GenesisBridge />

      <ProactiveBridge />

      <VoiceBridge />

      {/* ==========================================
          LIVING WORLD
      ========================================== */}

      <GenesisRenderer />

      {/* ==========================================
          NAVIGATION & PLAYGROUND
      ========================================== */}

      <GenesisPlayground navigator={navigator} />
      <GenesisWorkspace navigator={navigator} />
      <GenesisCameraController navigator={navigator} />

      {/* ==========================================
          COSMOS LAYER — living universe background
      ========================================== */}
      <Suspense fallback={null}>
        <CosmosLayer />
      </Suspense>
    </>
  );

}
