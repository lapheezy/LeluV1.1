/**
 * ==========================================================
 * useLeluRuntime — React hook for the LÉLU Runtime
 *
 * Delegates the complete startup sequence to the single
 * self-bootstrapping Bootstrap pipeline, then exposes
 * reactive runtime state to components.
 *
 *   useLeluRuntime()
 *     → Bootstrap.start()
 *        → load environment
 *        → discover + health-check providers
 *        → initialize AI runtime + memory + cognition
 *        → start services (task / proactive / persistent / UI)
 *        → start cognitive loop + world lifecycle
 *     → subscribe to runtime snapshots
 * ==========================================================
 */

import { useEffect, useState, useCallback } from "react";
import LeluRuntime from "./LeluRuntime";
import type { RuntimeSnapshot, RuntimeHealth } from "./LeluRuntime";
import Bootstrap from "../Bootstrap";
import Orchestrator from "../orchestrator/Orchestrator";
import TaskEngine from "../tasks/TaskEngine";
import BackgroundEngine from "../tasks/BackgroundEngine";
import ProactiveEngine from "../cognition/ProactiveEngine";
import PersistentRuntime from "../proactive/PersistentRuntime";
import CognitiveLoop from "../cognition/CognitiveLoop";
import SelfHealing from "../cognition/SelfHealing";
import ToolRegistry from "../tools/ToolRegistry";
import UIOrchestrator from "../ui/UIOrchestrator";
import WorldLifecycle from "../../app/scene/genesis/engines/WorldLifecycle";

export interface LeluRuntimeState {
  snapshot: RuntimeSnapshot | null;
  health: RuntimeHealth;
  initializing: boolean;
  ready: boolean;
}

export function useLeluRuntime() {
  const [state, setState] = useState<LeluRuntimeState>({
    snapshot: null,
    health: {
      cognition: "initializing",
      memory: "initializing",
      providers: "initializing",
      ui: "online",
      voice: "online",
      cosmos: "online",
      tasks: "online",
      engines: "initializing",
      world: "initializing",
      overall: "initializing",
      lastCheck: 0,
    },
    initializing: true,
    ready: false,
  });

  useEffect(() => {
    const runtime = LeluRuntime.getInstance();

    // Single self-bootstrapping pipeline — the ONE startup path.
    // Idempotent: safe under React StrictMode double-mount.
    void Bootstrap.getInstance().start();

    // Subscribe to runtime changes
    const unsubRuntime = runtime.subscribe(async (snapshot) => {
      setState({
        snapshot,
        health: snapshot.health,
        initializing: false,
        ready: snapshot.health.overall === "online",
      });
    });

    // Initial snapshot
    void runtime.getSnapshot().then((snapshot) => {
      setState({
        snapshot,
        health: snapshot.health,
        initializing: false,
        ready: snapshot.health.overall === "online",
      });
    });

    return () => {
      unsubRuntime();
      BackgroundEngine.getInstance().stop();
      ProactiveEngine.getInstance().stop();
      PersistentRuntime.getInstance().stop();
      CognitiveLoop.getInstance().stop();
      WorldLifecycle.getInstance().shutdown();
      runtime.shutdown();
    };
  }, []);

  const openPanel = useCallback((panel: string) => {
    UIOrchestrator.getInstance().openPanel(panel as any);
  }, []);

  const navigateTo = useCallback((entityId: string) => {
    UIOrchestrator.getInstance().navigateToEntity(entityId);
  }, []);

  const createTask = useCallback((goal: string, steps?: { title: string; description: string }[]) => {
    return TaskEngine.getInstance().create({ goal, steps });
  }, []);

  const processRequest = useCallback((request: string) => {
    return Orchestrator.getInstance().process(request);
  }, []);

  return {
    ...state,
    openPanel,
    navigateTo,
    createTask,
    processRequest,
    runtime: LeluRuntime.getInstance(),
    orchestrator: Orchestrator.getInstance(),
    taskEngine: TaskEngine.getInstance(),
    tools: ToolRegistry.getInstance(),
    selfHealing: SelfHealing.getInstance(),
    proactive: ProactiveEngine.getInstance(),
    worldLifecycle: WorldLifecycle.getInstance(),
  };
}