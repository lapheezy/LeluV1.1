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

import GenesisRenderer
  from "./render/GenesisRenderer";

import GenesisCameraController
  from "./GenesisCameraController";

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
    );  return (
    <>
      <GenesisRenderer />

      <GenesisPlayground navigator={navigator} />
      <GenesisWorkspace navigator={navigator} />
      <GenesisCameraController navigator={navigator} />

      <Suspense fallback={null}>
        <CosmosLayer />
      </Suspense>
    </>
  );

}
