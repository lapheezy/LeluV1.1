/**
 * React mirror of the WorkspaceEngine singleton — same pattern as
 * useVoice. One engine, one source of truth; components subscribe.
 */

import { useEffect, useState } from "react";
import WorkspaceEngine, { type WorkspaceState } from "./WorkspaceEngine";

const engine = WorkspaceEngine.getInstance();

export interface WorkspaceHandle {
  state: WorkspaceState;
  engine: WorkspaceEngine;
}

export function useWorkspace(): WorkspaceHandle {
  const [state, setState] = useState<WorkspaceState>(() => engine.getState());

  useEffect(() => {
    return engine.subscribe(setState);
  }, []);

  return { state, engine };
}

export default useWorkspace;
