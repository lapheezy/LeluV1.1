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
  useMemo,
} from "react";


import GenesisBridge
  from "./GenesisBridge";


import VoiceBridge
  from "./VoiceBridge";


import GenesisRenderer
  from "./render/GenesisRenderer";


import GenesisCameraController
  from "./GenesisCameraController";

import CosmosLayer
  from "./cosmos/CosmosLayer";

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
      <CosmosLayer />
    </>
  );

}
