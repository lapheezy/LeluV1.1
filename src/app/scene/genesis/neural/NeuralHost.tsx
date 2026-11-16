/**
 * Where the Neural Map's views mount (M17.2): the embedded inspector and
 * the standalone map. Lazy, mounted by InterfaceShell only once one of
 * them is wanted, and unmounted when both close.
 */

import NeuralInspector from "./NeuralInspector";
import NeuralMapView from "./NeuralMapView";
import { ensureNeuralMap } from "./useNeural";
import { useNeuralView } from "./useNeuralViewLite";

ensureNeuralMap();

export default function NeuralHost() {
  const view = useNeuralView();
  return (
    <>
      <NeuralInspector />
      {view.standalone.open ? <NeuralMapView /> : null}
    </>
  );
}
