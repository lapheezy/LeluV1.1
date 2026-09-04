/**
 * ==========================================================
 * LÉLU — SELF-BOOTSTRAPPING STARTUP
 *
 * Single idempotent entry point for the complete LÉLU
 * initialization pipeline.
 *
 * Flow:
 *   1. LOAD ENVIRONMENT
 *   2. VALIDATE CONFIGURATION
 *   3. REGISTER PROVIDERS (AI + knowledge)
 *   4. INITIALIZE AI RUNTIME (health check, memory, cognition)
 *   5. INITIALIZE SERVICES (task engine, proactive, UI, etc.)
 *   6. START COGNITION (observation loop + continuous self-study)
 *   7. VERIFY CONNECTIONS
 *
 * The bootstrap is idempotent — calling it twice is safe
 * (no duplicate providers, listeners, timers, or agents).
 *
 * After bootstrap, the project is fully self-bootstrapping:
 *   PROVIDE .env → START → LÉLU READY
 * ==========================================================
 */

import { getEnvironment, environmentDiagnostics } from "./Environment";
import AIService from "./AIService";
import CognitiveLoop from "./cognition/CognitiveLoop";
import SelfStudyEngine from "./cognition/SelfStudyEngine";
import TaskEngine from "./tasks/TaskEngine";
import BackgroundEngine from "./tasks/BackgroundEngine";
import ProactiveEngine from "./cognition/ProactiveEngine";
import UIOrchestrator from "./ui/UIOrchestrator";
import LeluRuntime from "./runtime/LeluRuntime";
import WorldLifecycle from "../app/scene/genesis/engines/WorldLifecycle";
import PersistentRuntime from "./proactive/PersistentRuntime";
import SupabasePersistence from "./persistence/SupabasePersistence";
import { registerEarthTools } from "./earth/EarthTools";
import { markPerf } from "./perf/StartupTelemetry";
import ToolRegistry from "./tools/ToolRegistry";
import AnthropicEngineeringAgent from "./engineering/AnthropicEngineeringAgent";

// -- types ---------------------------------------------------------------

export type BootstrapStep =
  | "environment"
  | "providers"
  | "runtime"
  | "services"
  | "cognition"
  | "world"
  | "verification";

export type StepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

export interface BootstrapStepResult {
  step: BootstrapStep;
  status: StepStatus;
  time: number;
  detail: string;
}

export interface BootstrapReport {
  startedAt: number;
  finishedAt: number;
  steps: BootstrapStepResult[];
  overall: StepStatus;
  diagnostics: Record<string, string>;
}

export type BootstrapListener = (report: BootstrapReport) => void;

// -- implementation ------------------------------------------------------

export default class Bootstrap {
  private static instance: Bootstrap | null = null;

  private listeners = new Set<BootstrapListener>();
  private report: BootstrapReport | null = null;
  private _running = false;
  private _complete = false;

  private constructor() {}

  static getInstance(): Bootstrap {
    if (!Bootstrap.instance) {
      Bootstrap.instance = new Bootstrap();
    }
    return Bootstrap.instance;
  }

  get complete(): boolean { return this._complete; }
  get lastReport(): BootstrapReport | null { return this.report; }

  subscribe(fn: BootstrapListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Run the full bootstrap pipeline. Idempotent — calling
   * repeatedly re-runs health checks without duplicating
   * providers or listeners.
   */
  async start(): Promise<BootstrapReport> {
    if (this._running) {
      // If already complete, return cached report
      return this.report ?? this.emptyReport();
    }

    this._running = true;
    const startedAt = Date.now();
    const steps: BootstrapStepResult[] = [];

    function step(
      s: BootstrapStep,
      status: StepStatus,
      detail: string,
      time = Date.now(),
    ): BootstrapStepResult {
      return { step: s, status, time, detail };
    }

    // ---------- Step 1: LOAD & VALIDATE ENVIRONMENT ----------
    steps.push(step("environment", "RUNNING", "Loading environment…"));
    try {
      const env = getEnvironment();
      steps.push(step("environment", "DONE",
        `${env.warnings.length > 0 ? `${env.warnings.length} warning(s) — see diagnostics` : "OK"}`));
      for (const w of env.warnings) {
        console.warn(`[Bootstrap] ${w}`);
      }
    } catch (error) {
      steps.push(step("environment", "FAILED", String(error)));
    }

    // ---------- Step 2: INITIALIZE AI PROVIDER RUNTIME ----------
    steps.push(step("providers", "RUNNING", "Initializing AI providers…"));
    try {
      const ai = AIService.getInstance();
      await ai.initialize();
      const persistenceStatus = SupabasePersistence.getInstance().getStatus();
      steps.push(step("providers", "DONE",
        `OK — ${ai.getProviders().ai.length} AI, ${ai.getProviders().knowledge.length} knowledge providers; persistence: ${persistenceStatus}`));
    } catch (error) {
      steps.push(step("providers", "FAILED", String(error)));
    }

    // ---------- Step 3: START LÉLU RUNTIME ----------
    steps.push(step("runtime", "RUNNING", "Starting LÉLU runtime…"));
    try {
      const runtime = LeluRuntime.getInstance();
      await runtime.initialize();
      const health = await runtime.checkHealth();
      steps.push(step("runtime", "DONE",
        `Overall: ${health.overall} | cognition: ${health.cognition} | memory: ${health.memory} | providers: ${health.providers}`));
    } catch (error) {
      steps.push(step("runtime", "FAILED", String(error)));
    }

    // ---------- Step 4: START SERVICES ----------
    steps.push(step("services", "RUNNING", "Starting services…"));
    try {
      // Background event loop (proactive notifications)
      BackgroundEngine.getInstance().start();
      // Proactive engine
      ProactiveEngine.getInstance().start();
      // Persistent runtime (autonomous evaluation loop)
      PersistentRuntime.getInstance().start();
      // UI orchestrator
      UIOrchestrator.getInstance().initialize();
      // Task engine
      const tasks = TaskEngine.getInstance();
      // Earth Core tool registry (spatial capabilities for cognition)
      registerEarthTools();

      // The remote engineering capability advertises itself ONLY when it
      // can actually run. Both credentials must be present: the Anthropic
      // key that starts the session, and a repository token for the clone.
      // Declaring it available without them would put a capability in the
      // catalogue that fails the moment cognition tries to use it.
      try {
        const engineering = AnthropicEngineeringAgent.getInstance().availability();
        ToolRegistry.getInstance().updateAvailability("engineering.remote", engineering.available);
        if (!engineering.available) {
          console.info("[Bootstrap] Remote engineering agent unavailable —", engineering.reason);
        }
      } catch (error) {
        ToolRegistry.getInstance().updateAvailability("engineering.remote", false);
        console.warn("[Bootstrap] Remote engineering availability check failed (contained)", error);
      }
      steps.push(step("services", "DONE",
        `OK — ${tasks.list().length} tasks, proactive + background engines started`));
    } catch (error) {
      steps.push(step("services", "FAILED", String(error)));
    }

    // ---------- Step 5: START COGNITION ----------
    // Two distinct processes, both independent of chat:
    //   CognitiveLoop   — observes the environment and proposes work.
    //   SelfStudyEngine — the continuous mission → gaps → investigation
    //                     → learning → new gaps process. It does not wait
    //                     for a user message and does not stop when its
    //                     work buffer empties; an empty buffer only means
    //                     the next objectives are generated from the
    //                     mission and from what the last cycle learned.
    steps.push(step("cognition", "RUNNING", "Starting cognition…"));
    try {
      const loop = CognitiveLoop.getInstance();
      loop.start();
      const study = SelfStudyEngine.getInstance();
      study.start();
      steps.push(step("cognition", "DONE",
        `OK — observation cycle ${loop.getLastReport()?.cycle ?? 0}, self-study ${study.isRunning() ? "running" : "idle"} at cycle ${study.getCycle()}`));
    } catch (error) {
      steps.push(step("cognition", "FAILED", String(error)));
    }

    // ---------- Step 6: START WORLD LIFECYCLE ----------
    steps.push(step("world", "RUNNING", "Starting world lifecycle…"));
    try {
      const world = WorldLifecycle.getInstance();
      world.start();
      steps.push(step("world", "DONE",
        `Phase: ${world.getPhase()} | Engines: ${world.getActiveEngines().length}`));
    } catch (error) {
      steps.push(step("world", "FAILED", String(error)));
    }

    // ---------- Step 7: VERIFICATION ----------
    steps.push(step("verification", "RUNNING", "Running diagnostics…"));
    try {
      const failed = steps.filter((s) => s.status === "FAILED");
      if (failed.length > 0) {
        steps.push(step("verification", "DONE",
          `${failed.length} step(s) reported failures — see step details`));
      } else {
        steps.push(step("verification", "DONE", "All systems OK"));
      }
    } catch (error) {
      steps.push(step("verification", "FAILED", String(error)));
    }

    // ---------- Build final report ----------
    const finishedAt = Date.now();
    const overall = steps.some((s) => s.status === "FAILED") ? "FAILED" : "DONE";

    this.report = {
      startedAt,
      finishedAt,
      steps,
      overall,
      diagnostics: environmentDiagnostics(),
    };

    this._complete = overall !== "FAILED";
    this._running = false;

    // Real measurement: the full pipeline finished.
    markPerf("BOOTSTRAP_DONE");

    for (const fn of this.listeners) {
      try { fn(this.report); } catch { /* contained */ }
    }

    return this.report;
  }

  /**
   * Run lelu:doctor — comprehensive diagnostics of the live runtime.
   * Returns PASS / FAIL / NOT CONFIGURED / DEGRADED for every subsystem.
   */
  async doctor(): Promise<BootstrapReport> {
    // Ensure bootstrap has run first
    if (!this._complete) {
      return this.start();
    }
    // Re-run environment + health checks
    return this.start();
  }

  private emptyReport(): BootstrapReport {
    return {
      startedAt: 0,
      finishedAt: 0,
      steps: [],
      overall: "PENDING",
      diagnostics: {},
    };
  }
}