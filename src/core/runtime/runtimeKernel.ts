/**
 * ==========================================================
 * LÉLU — RUNTIME KERNEL
 *
 * This is the engine tree, loaded on purpose instead of by
 * being imported.
 *
 * It used to live inside useLeluRuntime.ts as eleven top-level
 * imports (Bootstrap, LeluRuntime, Orchestrator, TaskEngine,
 * BackgroundEngine, ProactiveEngine, PersistentRuntime,
 * CognitiveLoop, SelfHealing, ToolRegistry, UIOrchestrator,
 * WorldLifecycle). Every one of them is imported for its SIDE
 * EFFECTS at start-up — getInstance().start() — never for the
 * landing screen to paint, yet all of them sat on the cold-boot
 * graph: measured at 3.3 MB of the app's source graph and the
 * majority of its requests. The interface could not appear until
 * the whole intelligence stack had been fetched and parsed.
 *
 * Now it is one dynamic module. The shell paints first, then the
 * kernel is fetched and started. Nothing about what starts, in
 * what order, or what it does has changed — the sequence below is
 * the one Bootstrap has always run; only the moment its code is
 * downloaded moved past the first frame.
 *
 * Two invariants this file has to keep:
 *
 *   1. ONE start. The module-level promise is the lock: React
 *      StrictMode mounts the hook twice, and two concurrent
 *      loaders would otherwise both start the engines and both
 *      subscribe. Concurrent callers get the same promise.
 *   2. A teardown that belongs to the last consumer. The refcount
 *      below means the first mount's cleanup in StrictMode cannot
 *      stop the engines the second mount is about to use.
 * ==========================================================
 */

import LeluRuntime from "./LeluRuntime";
import type { RuntimeSnapshot } from "./LeluRuntime";
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
import { exposeReadinessOnWindow, readiness } from "./readiness";
import { startReadinessProbes } from "./domProbes";

export interface RuntimeKernel {
  runtime: LeluRuntime;
  orchestrator: Orchestrator;
  taskEngine: TaskEngine;
  tools: ToolRegistry;
  selfHealing: SelfHealing;
  proactive: ProactiveEngine;
  worldLifecycle: WorldLifecycle;
  ui: UIOrchestrator;
}

export type SnapshotListener = (snapshot: RuntimeSnapshot) => void;

export interface RuntimeHandle {
  kernel: RuntimeKernel;
  /** Drop this consumer; the engines stop when the last one lets go. */
  release(): void;
}

const listeners = new Set<SnapshotListener>();
let load: Promise<RuntimeKernel> | null = null;
let started = false;
let refs = 0;

function kernel(): RuntimeKernel {
  return {
    runtime: LeluRuntime.getInstance(),
    orchestrator: Orchestrator.getInstance(),
    taskEngine: TaskEngine.getInstance(),
    tools: ToolRegistry.getInstance(),
    selfHealing: SelfHealing.getInstance(),
    proactive: ProactiveEngine.getInstance(),
    worldLifecycle: WorldLifecycle.getInstance(),
    ui: UIOrchestrator.getInstance(),
  };
}

/**
 * Fetch + start the engine tree. Idempotent, safe under concurrent calls and
 * under a StrictMode remount: the second caller joins the first's promise.
 */
export function loadRuntimeKernel(): Promise<RuntimeKernel> {
  if (load) return load;

  load = (async () => {
    const k = kernel();
    const runtime = k.runtime;

    /*
     * Readiness starts reporting with the kernel, not with a page reload. The
     * snapshot is mirrored on `window.__leluReadiness` so the real state can
     * be read from a browser without a build flag, and the probes watch for
     * the composer and the world actually being laid out.
     */
    exposeReadinessOnWindow();
    readiness().confirm(
      "shell",
      typeof performance !== "undefined"
        ? `React root mounted; kernel started at ${Math.round(performance.now())} ms.`
        : "React root mounted; kernel started.",
    );
    startReadinessProbes();
    installBootstrapReadiness();

    // Snapshots are pushed to whoever is listening now, not captured once:
    // subscribers may attach before or after the first snapshot resolves.
    runtime.subscribe((snapshot) => {
      for (const fn of listeners) {
        try { fn(snapshot); } catch { /* one bad listener must not stop the rest */ }
      }
    });

    // Single self-bootstrapping pipeline — the ONE startup path, unchanged.
    // Idempotent: safe under React StrictMode double-mount.
    if (!started) {
      started = true;
      void Bootstrap.getInstance().start();
    }

    // Initial snapshot, published to whoever is subscribed by the time it
    // arrives rather than returned to one caller.
    void runtime.getSnapshot().then((snapshot) => {
      for (const fn of listeners) {
        try { fn(snapshot); } catch { /* contained */ }
      }
    });

    return k;
  })();

  // A failed load must be retryable instead of pinning a rejected promise.
  load.catch(() => { load = null; started = false; });

  return load;
}

/** Attach a snapshot listener. Returns its own unsubscribe. */
export function onRuntimeSnapshot(fn: SnapshotListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Hold the kernel for one consumer's lifetime. The engines start on the first
 * retain and stop when the last consumer releases — the same start/stop pair
 * the hook used to run inline, now shared.
 */
export async function retainRuntimeKernel(): Promise<RuntimeHandle> {
  const k = await loadRuntimeKernel();
  refs += 1;

  let released = false;
  return {
    kernel: k,
    release() {
      if (released) return;
      released = true;
      refs -= 1;
      if (refs > 0) return;
      // Same stop order the hook used inline, lowest-level service first.
      BackgroundEngine.getInstance().stop();
      ProactiveEngine.getInstance().stop();
      PersistentRuntime.getInstance().stop();
      CognitiveLoop.getInstance().stop();
      WorldLifecycle.getInstance().shutdown();
      k.runtime.shutdown();
      // A stopped runtime is not a ready one: the next mount must re-verify
      // everything rather than inherit a READY claim nothing checked.
      readiness().reset("Runtime stopped.");
      started = false;
      load = null;
    },
  };
}

let readinessWired = false;

/**
 * Translate Bootstrap's own step report into readiness states.
 *
 * Bootstrap already runs each subsystem and RECORDS the outcome per step, so
 * this reads that record instead of re-deciding anything: no second scheduler,
 * no duplicated health checks. Each mapping is deliberately conservative —
 * DONE means the step's own call returned, which for providers, tools and
 * agents is an investment of code, not yet proof of a working turn. Those stay
 * INITIALIZING until a real event confirms them (a provider reply for
 * cognition, a tool result for tools, orchestration output for agents).
 *
 * Subscribed once; Bootstrap publishes one report per start.
 */
function installBootstrapReadiness(): void {
  if (readinessWired) return;
  readinessWired = true;

  Bootstrap.getInstance().subscribe((report) => {
    const r = readiness();

    // The report carries both RUNNING and final entries per step; the last one
    // for a name is the outcome.
    const latest = new Map<string, { status: string; detail: string }>();
    for (const step of report.steps) {
      latest.set(step.step, { status: step.status, detail: step.detail });
    }

    for (const [step, outcome] of latest) {
      const { status, detail } = outcome;
      switch (step) {
        case "environment":
          if (status === "FAILED") r.fail("network", detail);
          break;
        case "providers":
          if (status === "FAILED") r.fail("cognition", detail);
          else if (status === "DONE") {
            r.begin("cognition", `Provider runtime initialized (${detail}). Awaiting a verified reply.`);
          } else r.begin("cognition", detail);
          break;
        case "runtime":
          if (status === "FAILED") r.fail("memory", detail);
          else if (status === "DONE") {
            // The runtime's own health check is not a read/write proof.
            r.degrade("memory", `Runtime health: ${detail}. No read/write verified.`);
          } else r.begin("memory", detail);
          break;
        case "services":
          if (status === "FAILED") r.fail("tools", detail);
          else if (status === "DONE") {
            r.begin("tools", `Tool registrars ran (${detail}). Awaiting a real invocation.`);
          } else r.begin("tools", detail);
          break;
        case "cognition":
          if (status === "FAILED") r.fail("agents", detail);
          else if (status === "DONE") {
            r.begin("agents", `Cognition loop started (${detail}). Awaiting orchestration.`);
          } else r.begin("agents", detail);
          break;
        case "world":
          if (status === "FAILED") r.fail("cosmos", detail);
          else r.begin("cosmos", `World lifecycle: ${detail}. Awaiting the mounted canvas.`);
          break;
        default:
          break;
      }
    }
  });
}
