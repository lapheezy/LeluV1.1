/**
 * ==========================================================
 * useLeluRuntime — React hook for the LÉLU Runtime
 *
 * Initializes all runtime subsystems and provides
 * reactive state to components.
 * ==========================================================
 */

import { useEffect, useState, useCallback } from "react";
import LeluRuntime from "./LeluRuntime";
import type { RuntimeSnapshot, RuntimeHealth } from "./LeluRuntime";
import Orchestrator from "../orchestrator/Orchestrator";
import TaskEngine from "../tasks/TaskEngine";
import BackgroundEngine from "../tasks/BackgroundEngine";
import ProactiveEngine from "../cognition/ProactiveEngine";
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
    const bgEngine = BackgroundEngine.getInstance();
    const proactive = ProactiveEngine.getInstance();
    const uiOrchestrator = UIOrchestrator.getInstance();

    // Initialize all subsystems
    void runtime.initialize();
    bgEngine.start();
    proactive.start();
    uiOrchestrator.initialize();

    // Start the world lifecycle
    const worldLifecycle = WorldLifecycle.getInstance();
    worldLifecycle.start();

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
      bgEngine.stop();
      proactive.stop();
      worldLifecycle.shutdown();
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
