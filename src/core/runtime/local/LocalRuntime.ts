/**
 * ==========================================================
 * LÉLU
 * LOCAL RUNTIME — the companion abstraction
 *
 * LÉLU WEB UI → LÉLU CONTROL BUS → LOCAL LÉLU RUNTIME → ENGINES
 *
 * The browser UI is the control surface; the LocalRuntime is the
 * single contract for whatever actually executes work nearby —
 * local HTTP inference servers (Ollama / llama.cpp / LM Studio /
 * vLLM), the local job queue, and future native companions
 * (Blender, video, simulation, game/film compilers).
 *
 * Every capability entry is REPORTED state (available / partial /
 * not-installed / not-implemented / error). Nothing is marked
 * available because an adapter exists — only a real probed
 * backend (or a genuinely working local system) marks it so.
 * ==========================================================
 */

import ModelRouter from "../../model/ModelRouter";
import LocalHardwareDetector from "./LocalHardwareDetector";
import LocalLLMAdapter from "./LocalLLMAdapter";
import LocalBlenderAdapter from "./LocalBlenderAdapter";
import LocalJobQueue from "./LocalJobQueue";
import type {
  LocalBackendStatus,
  LocalCapabilityMap,
  LocalJob,
  LocalJobType,
  LocalRuntimeStatus,
  LocalSelfTestResult,
} from "./LocalRuntimeTypes";
import type { AIRequest, AIResponse } from "../../../providers/AIProvider";

export default class LocalRuntime {
  private static instance: LocalRuntime | null = null;

  public static getInstance(): LocalRuntime {
    if (!LocalRuntime.instance) {
      LocalRuntime.instance = new LocalRuntime();
    }
    return LocalRuntime.instance;
  }

  private constructor() {}

  /* ---------- hardware ---------- */

  public getHardware() {
    return LocalHardwareDetector.getInstance().detect();
  }

  public async refreshHardware() {
    return await LocalHardwareDetector.getInstance().refresh();
  }

  /* ---------- backends ---------- */

  public llm() {
    return LocalLLMAdapter.getInstance();
  }

  public blender() {
    return LocalBlenderAdapter.getInstance();
  }

  /** Probe every local backend (HTTP discovery + Blender bridge). */
  public async detect(): Promise<{
    llm: LocalBackendStatus[];
    blender: LocalBackendStatus;
  }> {
    const [llm, blender] = await Promise.all([
      this.llm().discover(true),
      this.blender().detect(),
    ]);
    return { llm, blender };
  }

  public async getInstalledModels(): Promise<string[]> {
    return this.llm().installedModels();
  }

  /* ---------- capabilities ---------- */

  public getCapabilities(): LocalCapabilityMap {
    const llm = this.llm();
    const llmReachable = llm.isReachable();
    const blenderBackend = this.blender().status();

    const entry = (
      state: LocalCapabilityMap["inference"]["state"],
      label: string,
      description: string,
    ): LocalCapabilityMap["inference"] => ({ state, label, description });

    return {
      inference: entry(
        llmReachable ? "available" : "not-installed",
        "Local LLM inference",
        llmReachable
          ? "A local inference server is reachable on this machine — real generation works."
          : "No local inference server reachable. Start Ollama / llama.cpp / LM Studio / vLLM (with CORS) or set a custom endpoint.",
      ),
      vision: entry(
        "not-installed",
        "Local vision",
        "No local vision model is installed. A WebGPU runtime or a multimodal local server must be wired.",
      ),
      image: entry(
        "partial",
        "Local image",
        "Procedural local canvas generation works (RenderEngine). Photoreal local image generation is not installed.",
      ),
      video: entry(
        "partial",
        "Local video",
        "Video projects/scenes/shots/timeline scaffolding is real and saved. Frame encoding needs a local backend.",
      ),
      audio: entry(
        "partial",
        "Local audio",
        "Browser text-to-speech is available. Music/soundtrack generation is not implemented.",
      ),
      "3d": entry(
        "partial",
        "Local 3D",
        "The LÉLUVERSE renders live in Three.js. A procedural 3D authoring pipeline (Blender) is not installed.",
      ),
      simulation: entry(
        "partial",
        "Local simulation",
        "LÉLUVERSE engines (physics, weather, ocean, particles) run live. A configurable simulation-runner abstraction is not wired.",
      ),
      game: entry(
        "partial",
        "Local game",
        "Canvas game skeletons generate in the engineering sandbox. A full game compiler is not implemented.",
      ),
      film: entry(
        "not-implemented",
        "Local film",
        "Storyboard→shots→render→edit pipeline is not implemented.",
      ),
      universe: entry(
        "not-implemented",
        "Universe compiler",
        "Structured universe graph with snapshots/timelines/branches is not implemented yet.",
      ),
      blender: entry(
        blenderBackend?.reachable ? "available" : "not-installed",
        "Blender",
        blenderBackend?.reachable
          ? "Blender is reachable through the companion bridge — scene scripts can execute."
          : "Blender is a native application. No companion bridge is reachable on localhost:8081 (impossible inside a browser sandbox).",
      ),
      jobs: entry(
        "available",
        "Local job queue",
        "Sequential, cancellable, persistent job queue is operational.",
      ),
      memory: entry(
        "available",
        "Local memory",
        "Short/long-term memory and profile persist locally through the existing brain.",
      ),
    };
  }

  /* ---------- inference ---------- */

  public async inference(request: AIRequest): Promise<AIResponse> {
    return await this.llm().generate(request);
  }

  /* ---------- self-test ---------- */

  /**
   * Real automated health check: when a local backend is reachable
   * it runs an actual tiny inference; otherwise it reports
   * not-installed with the exact reason. Never fakes a pass.
   */
  public async selfTest(): Promise<LocalSelfTestResult> {
    const started = Date.now();
    await this.llm().discover(true);
    if (!this.llm().isReachable()) {
      const first = this.llm().backends()[0];
      return {
        ok: false,
        capability: "inference",
        detail:
          first?.error ??
          "No local inference backend reachable. Start Ollama (`ollama serve`), llama.cpp (`server --cors`), LM Studio or vLLM, then re-run.",
      };
    }
    try {
      const response = await this.llm().generate({
        messages: [],
        prompt: "Reply with exactly one word: OK",
        maxTokens: 8,
        temperature: 0,
      });
      return {
        ok: true,
        capability: "inference",
        detail: `Backend responded (${response.model}).`,
        latencyMs: response.processingTime,
        model: response.model,
      };
    } catch (error) {
      return {
        ok: false,
        capability: "inference",
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      };
    }
  }

  /* ---------- jobs ---------- */

  public submitJob(
    type: LocalJobType,
    label: string,
    runner: Parameters<LocalJobQueue["submit"]>[2],
  ): LocalJob {
    return LocalJobQueue.getInstance().submit(type, label, runner);
  }

  public jobs(): LocalJob[] {
    return LocalJobQueue.getInstance().list();
  }

  public getJobStatus(id: string): LocalJob | undefined {
    return LocalJobQueue.getInstance().get(id);
  }

  public cancelJob(id: string): boolean {
    return LocalJobQueue.getInstance().cancel(id);
  }

  /* ---------- status ---------- */

  public async status(): Promise<LocalRuntimeStatus> {
    const [hardware, llm] = await Promise.all([
      this.refreshHardware(),
      this.llm().status(),
    ]);
    const queue = LocalJobQueue.getInstance();
    return {
      updatedAt: Date.now(),
      hardware,
      capabilities: this.getCapabilities(),
      backends: llm.backends,
      offlineMode: ModelRouter.getInstance().isOfflineMode(),
      activeJobCount: queue.activeCount(),
      totalJobsRun: queue.totalRun(),
    };
  }
}