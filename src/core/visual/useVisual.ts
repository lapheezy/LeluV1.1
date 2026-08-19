/**
 * React mirror of the VisualEngine singleton — same pattern as
 * useVoice/useWorkspace. One engine, one source of truth.
 */

import { useEffect, useState } from "react";
import VisualEngine, { type VisualState } from "./VisualEngine";

const engine = VisualEngine.getInstance();

export interface VisualHandle {
  state: VisualState;
  engine: VisualEngine;
}

export function useVisual(): VisualHandle {
  const [state, setState] = useState<VisualState>(() => engine.getState());

  useEffect(() => {
    return engine.subscribe(setState);
  }, []);

  return { state, engine };
}

export default useVisual;
