/**
 * ==========================================================
 * LÉLU
 * LOCAL RUNTIME TYPES — companion architecture vocabulary
 *
 * LÉLU WEB UI → LÉLU CONTROL BUS → LOCAL LÉLU RUNTIME → ENGINES
 *
 * The browser is the control surface. The LocalRuntime
 * abstraction describes what companion runtimes (Ollama,
 * llama.cpp, LM Studio, vLLM, Blender on the same machine,
 * or a native bridge) can do. Every field below is REPORTED
 * state — never a promise. Adapters probe reality and fill
 * these in honestly.
 * ==========================================================
 */

export type InfoSource = "detected" | "estimated" | "unavailable";

export interface TypedValue<T> {
  value: T | null;
  source: InfoSource;
}

export interface LocalHardware {
  updatedAt: number;
  os: TypedValue<string>;
  browser: TypedValue<string>;
  platform: TypedValue<string>;
  cpuCores: TypedValue<number>;
  memoryGB: TypedValue<number>;
  gpu: {
    vendor: TypedValue<string>;
    webgl: boolean;
    webgpu: boolean;
    accelerator: "webgpu" | "webgl" | "cpu";
    renderer: TypedValue<string>;
    vramGB: TypedValue<number>;
  };
  storage: {
    quotaBytes: TypedValue<number>;
    usedBytes: TypedValue<number>;
  };
  screen: TypedValue<{
    width: number;
    height: number;
    dpr: number;
    touch: boolean;
  }>;
  environment: "browser" | "standalone";
}

export type LocalBackendKind =
  | "ollama"
  | "llamacpp"
  | "lmstudio"
  | "vllm"
  | "custom"
  | "web-runtime"
  | "blender"
  | "companion";

export interface LocalBackendStatus {
  kind: LocalBackendKind;
  name: string;
  baseUrl: string;
  reachable: boolean;
  models: string[];
  checkedAt: number;
  error?: string;
  defaultModel?: string;
}

export type LocalCapabilityState =
  | "available"
  | "partial"
  | "not-installed"
  | "not-implemented"
  | "error";

export interface LocalCapabilityEntry {
  state: LocalCapabilityState;
  label: string;
  description: string;
}

export interface LocalCapabilityMap {
  inference: LocalCapabilityEntry;
  vision: LocalCapabilityEntry;
  image: LocalCapabilityEntry;
  video: LocalCapabilityEntry;
  audio: LocalCapabilityEntry;
  "3d": LocalCapabilityEntry;
  simulation: LocalCapabilityEntry;
  game: LocalCapabilityEntry;
  film: LocalCapabilityEntry;
  universe: LocalCapabilityEntry;
  blender: LocalCapabilityEntry;
  jobs: LocalCapabilityEntry;
  memory: LocalCapabilityEntry;
}

export type LocalJobType =
  | "inference"
  | "image-generation"
  | "video-generation"
  | "3d-build"
  | "blender-render"
  | "simulation"
  | "game-build"
  | "film-build"
  | "universe-build";

export type LocalJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface LocalJob {
  id: string;
  type: LocalJobType;
  label: string;
  status: LocalJobStatus;
  progress: number;
  startedAt: number | null;
  completedAt: number | null;
  logs: string[];
  output?: unknown;
  error?: string;
}

export interface LocalRuntimeStatus {
  updatedAt: number;
  hardware: LocalHardware;
  capabilities: LocalCapabilityMap;
  backends: LocalBackendStatus[];
  offlineMode: boolean;
  activeJobCount: number;
  totalJobsRun: number;
}

export interface LocalSelfTestResult {
  ok: boolean;
  capability: string;
  detail: string;
  latencyMs?: number;
  model?: string;
}

/** Contract for a runtime adapter that probes a backend. */
export interface LocalRuntimeAdapter {
  readonly kind: LocalBackendKind;
  readonly name: string;
  detect(): Promise<LocalBackendStatus>;
}