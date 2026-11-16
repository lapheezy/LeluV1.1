/**
 * The Neural Map's view state as a React hook, with nothing else attached:
 * the shell reads it to decide whether to fetch the Neural Map views at all,
 * so it must not import the map (or the stores it indexes) itself.
 */

import { useSyncExternalStore } from "react";
import { NeuralView, type NeuralViewState } from "./neuralView";

const sub = (l: () => void) => NeuralView.subscribe(() => l());
const snap = () => NeuralView.get();

export function useNeuralView(): NeuralViewState {
  return useSyncExternalStore(sub, snap, snap);
}
