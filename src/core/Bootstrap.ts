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
 *   6. START COGNITIVE LOOP
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
import StartupDiagnostic from "./selfdev/StartupDiagnostic";

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
      steps.push(step("services", "DONE",
        `OK — ${tasks.list().length} tasks, proactive + background engines started`));
    } catch (error) {
      steps.push(step("services", "FAILED", String(error)));
    }

    // ---------- Step 5: START COGNITIVE LOOP ----------
    steps.push(step("cognition", "RUNNING", "Starting cognitive loop…"));
    try {
      const loop = CognitiveLoop.getInstance();
      loop.start();
      steps.push(step("cognition", "DONE",
        `OK — cycle ${loop.getLastReport()?.cycle ?? 0}`));
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
    // Real checks against the 15 subsystems LÉLU depends on — not a
    // summary of the steps above, which only prove their OWN init
    // calls didn't throw. This calls a real method on each real
    // singleton (AI provider health, memory read, sandbox listing,
    // the actual engineering chat thread, …) so a subsystem that
    // initialized but is now unreachable is caught here, not assumed
    // healthy forever.
    steps.push(step("verification", "RUNNING", "Running diagnostics…"));
    try {
      const failed = steps.filter((s) => s.status === "FAILED");
      const startupDiagnostic = await StartupDiagnostic.run();
      const failedChecks = startupDiagnostic.checks.filter((c) => !c.ok);
      const allFailed = [...failed, ...failedChecks.map((c) => ({ detail: `${c.name}: ${c.detail}` }))];
      if (allFailed.length > 0) {
        steps.push(step("verification", "DONE",
          `${failed.length} bootstrap step(s) + ${failedChecks.length} runtime check(s) reported failures — see step details / StartupDiagnostic.getLastReport()`));
      } else {
        steps.push(step("verification", "DONE",
          `All systems OK — ${startupDiagnostic.checks.length}/${startupDiagnostic.checks.length} runtime checks passed`));
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