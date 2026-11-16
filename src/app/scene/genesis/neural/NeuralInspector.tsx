/**
 * ==========================================================
 * LÉLU — THE NEURAL MAP, EMBEDDED (M17.2)
 *
 * A quiet side card over whatever interface hosts it (first: the
 * Cosmos, from an object's own controls). It shows the entity's place
 * in the Neural Map and lets you follow its relationships without
 * leaving the interface, or open the same entity in the standalone
 * Neural Map. Nothing is drawn into the scene: the Cosmos stays the
 * Cosmos; the structure is one tap away, not a web of lines over it.
 * ==========================================================
 */

import { NeuralView } from "./neuralView";
import { useNeuralView } from "./useNeural";
import EntityPanel from "./EntityPanel";
import "./neural.css";

export default function NeuralInspector() {
  const view = useNeuralView();
  const id = view.inspecting;
  if (!id || view.standalone.open) return null;
  return (
    <aside className="nm-inspector" aria-label="Neural Map — this object" data-neural-inspector>
      <div className="nm-inspector-bar">
        <span className="nm-title">Neural Map</span>
        <button type="button" data-open-standalone onClick={() => NeuralView.openStandalone(id)} title="Open this in the Neural Map">
          Open map
        </button>
        <button type="button" aria-label="Close the Neural Map card" onClick={() => NeuralView.inspect(null)}>
          ✕
        </button>
      </div>
      <EntityPanel id={id} compact onFollow={(next) => NeuralView.inspect(next)} />
    </aside>
  );
}
