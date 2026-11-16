/**
 * ==========================================================
 * useLeluRuntime — React hook for the LÉLU Runtime
 *
 * Hands the complete startup sequence to the single
 * self-bootstrapping Bootstrap pipeline — after the shell has
 * painted.
 *
 *   useLeluRuntime()
 *     → after first paint + idle
 *     → import("./runtimeKernel")    (dynamic, 3.3 MB subtree)
 *        → load environment
 *        → discover + health-check providers
 *        → initialize AI runtime + memory + cognition
 *        → start services (task / proactive / persistent / UI)
 *        → start cognitive loop + world lifecycle
 *     → subscribe to runtime snapshots
 *
 * WHY THIS FILE IS NOW THIN
 *
 * It used to import the whole engine tree statically — eleven modules,
 * including Bootstrap and every tool registrar behind it — to return
 * singletons that its one consumer (`LeluRuntimeBoot` in GenesisScene)
 * discards. Measured with scripts/map-static-graph.mjs: that import list kept
 * ~3.3 MB of the application's source graph, and ~1.6 MB even after the
 * surrounding components were split, on the cold-boot path — so the first
 * frame waited for the entire intelligence stack to download and parse.
 *
 * The startup sequence is unchanged and still runs exactly once; only the
 * download and the moment it begins moved. Everything the hook returns is
 * still available, resolved from the kernel once it exists: the state fields
 * fill from real snapshots, and the four commands below await the kernel
 * instead of assuming it was already loaded.
 * ==========================================================
 */

import { useEffect, useRef, useState } from "react";
import type { RuntimeSnapshot, RuntimeHealth } from "./LeluRuntime";
import type { RuntimeHandle, RuntimeKernel } from "./runtimeKernel";

export interface LeluRuntimeState {
  snapshot: RuntimeSnapshot | null;
  health: RuntimeHealth;
  initializing: boolean;
  ready: boolean;
}

const INITIAL_HEALTH: RuntimeHealth = {
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
};

/**
 * Run `fn` once the browser has painted the current frame.
 *
 * `requestIdleCallback` is the honest primitive: start-up work is not urgent,
 * and on a busy phone it is better to wait for an idle slice than to compete
 * with the first paint for the main thread. The timeout is the ceiling — the
 * runtime starts within 1.5 s even under constant load — and browsers without
 * it fall back to a macrotask, which runs after paint.
 */
function afterFirstPaint(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;

  if (typeof ric === "function") {
    const id = ric(fn, { timeout: 1500 });
    return () => (window as unknown as { cancelIdleCallback?: (id: number) => void })
      .cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(fn, 0);
  return () => window.clearTimeout(id);
}

/** The kernel module, fetched on demand and shared by every caller. */
const loadKernelModule = () => import("./runtimeKernel");

export function useLeluRuntime() {
  const [state, setState] = useState<LeluRuntimeState>({
    snapshot: null,
    health: INITIAL_HEALTH,
    initializing: true,
    ready: false,
  });

  const handle = useRef<RuntimeHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let retained: RuntimeHandle | null = null;

    const apply = (snapshot: RuntimeSnapshot) => {
      if (cancelled) return;
      setState({
        snapshot,
        health: snapshot.health,
        initializing: false,
        ready: snapshot.health.overall === "online",
      });
    };

    const cancel = afterFirstPaint(() => {
      if (cancelled) return;
      void loadKernelModule()
        .then((kernel) => {
          if (cancelled) return undefined;
          unsubscribe = kernel.onRuntimeSnapshot(apply);
          return kernel.retainRuntimeKernel();
        })
        .then((live) => {
          if (!live) return;
          if (cancelled) {
            live.release();
            return;
          }
          retained = live;
          handle.current = live;
        })
        .catch((error) => {
          console.warn("[useLeluRuntime] runtime start failed (contained)", error);
        });
    });

    return () => {
      cancelled = true;
      cancel();
      unsubscribe?.();
      retained?.release();
      retained = null;
      handle.current = null;
    };
  }, []);

  const kernel = (): Promise<RuntimeKernel> =>
    loadKernelModule().then((module) => module.loadRuntimeKernel());

  const openPanel = async (panel: string) => {
    const k = await kernel();
    k.ui.openPanel(panel as never);
  };

  const navigateTo = async (entityId: string) => {
    const k = await kernel();
    k.ui.navigateToEntity(entityId);
  };

  const createTask = async (
    goal: string,
    steps?: { title: string; description: string }[],
  ) => {
    const k = await kernel();
    return k.taskEngine.create({ goal, steps });
  };

  const processRequest = async (request: string) => {
    const k = await kernel();
    return k.orchestrator.process(request);
  };

  return {
    ...state,
    /*
     * Resolved on use, not at import: before the kernel exists these are
     * simply null, and every read of one goes through the awaited commands
     * above. There is exactly one consumer of this hook and it reads none of
     * them, so no call site changes behaviour — the fields stay here because
     * they are the hook's public surface, not because they are free.
     */
    runtime: handle.current?.kernel.runtime ?? null,
    orchestrator: handle.current?.kernel.orchestrator ?? null,
    taskEngine: handle.current?.kernel.taskEngine ?? null,
    tools: handle.current?.kernel.tools ?? null,
    selfHealing: handle.current?.kernel.selfHealing ?? null,
    proactive: handle.current?.kernel.proactive ?? null,
    worldLifecycle: handle.current?.kernel.worldLifecycle ?? null,
    openPanel,
    navigateTo,
    createTask,
    processRequest,
  };
}
