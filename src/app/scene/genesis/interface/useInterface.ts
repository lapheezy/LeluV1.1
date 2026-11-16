/**
 * React binding for the Interface Orchestration Engine. The engine's
 * view() is referentially stable between changes, so it works directly
 * as an external store.
 */

import { useSyncExternalStore } from "react";
import InterfaceOrchestrator, { type InterfaceSnapshotView } from "../../../../core/interface/InterfaceOrchestrator";

export default function useInterface(): InterfaceSnapshotView {
  const orchestrator = InterfaceOrchestrator.getInstance();
  return useSyncExternalStore(
    (onChange) => orchestrator.subscribe(() => onChange()),
    () => orchestrator.view(),
    () => orchestrator.view(),
  );
}
