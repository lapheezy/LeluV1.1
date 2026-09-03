/**
 * ==========================================================
 * LÉLU
 * MODEL ROUTER — local-first, model-agnostic routing
 * ==========================================================
 *
 * The model is NOT LÉLU. The model is one cognitive component LÉLU
 * uses, and it must be replaceable. This module is the routing layer
 * that sits above the existing AIProviderRegistry / ProviderResolver:
 *
 *   LÉLU CORE
 *     → COGNITION ORCHESTRATOR
 *       → MODEL ROUTER
 *         → LOCAL MODELS / OPTIONAL CLOUD MODELS
 *
 * It provides the three things the provider registry deliberately
 * does not own:
 *   1. Hardware awareness  — CPU cores, RAM, GPU/WebGPU, acceleration,
 *      mapped to a coarse tier and generation recommendations.
 *   2. A model catalog     — modality/quality/latency metadata per
 *      model, seeded from the real provider→model mappings, so routing
 *      can pick "vision" vs "text" without each provider re-inventing
 *      that logic.
 *   3. Explicit offline mode — a persisted LOCAL / OFFLINE switch that
 *      skips every remote API-key provider even when a key happens to
 *      be configured, keeping LÉLU operational on local capabilities.
 *
 * Nothing here fakes local inference. Local model slots are registered
 * as descriptors with `local: true`, but they report "not installed"
 * until a real local runtime (WebLLM / Transformers.js / a native
 * bridge) is wired. That honest degraded state is the whole point.
 * ==========================================================
 */

import type { AIRequest } from "../../providers/AIProvider";
import SystemEnvironment from "../cognition/SystemEnvironment";
import KvStore from "../storage/KvStore";
import LocalLLMAdapter from "../runtime/local/LocalLLMAdapter";

/* ------------------------------------------------------------
 * HARDWARE
 * ---------------------------------------------------------- */

export type HardwareTier =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "unknown";

export interface HardwareSnapshot {
  tier: HardwareTier;
  cpuCores: number | null;
  memoryGB: number | null;
  vramGB: number | null;
  webgl: boolean;
  webgpu: boolean;
  renderer: string | null;
  acceleration: "webgpu" | "webgl" | "cpu";
  recommendation: string;
}

/** Best-effort VRAM estimate from the unmasked GPU renderer string. */
function estimateVramGB(renderer: string | null): number | null {
  if (!renderer) {
    return null;
  }
  const r = renderer.toLowerCase();
  // Broad, conservative buckets — the browser does not expose real
  // VRAM, so this is a rough planning signal, never a precise value.
  if (/m2 ultra|m3 ultra|m4 max|rtx 4090|rtx 4080|rx 7900|a100|h100|m1 ultra|m2 max|m3 max/.test(r)) {
    return 48;
  }
  if (/rtx 3090|rtx 3080|rtx 4070|rtx 4060 ti|rx 6900|m1 max|m2 pro|m3 pro|m4 pro|a6000|v100/.test(r)) {
    return 24;
  }
  if (/rtx 3060|rtx 3070|rtx 4060|rtx 4050|rx 6700|rx 6800|m1 pro|m2|m3|m4|apple m1|apple m2|apple m3/.test(r)) {
    return 8;
  }
  if (/iris xe|iris plus|uhd graphics|radeon graphics|vega|intel hd/.test(r)) {
    return 4;
  }
  return null;
}

function detectHardware(): HardwareSnapshot {
  const env = SystemEnvironment.getInstance().get();
  const memoryGB = env.memoryGB;
  const cores = env.cpuCores;
  const webgpu = env.gpu.webgpu;
  const webgl = env.gpu.webgl;
  const renderer = env.gpu.renderer;
  const vramGB = estimateVramGB(renderer);

  let tier: HardwareTier = "unknown";
  if (memoryGB !== null) {
    if (memoryGB >= 16 || vramGB !== null && vramGB >= 24) {
      tier = "high";
    } else if (memoryGB >= 8 || vramGB !== null && vramGB >= 8) {
      tier = "medium";
    } else if (memoryGB >= 4) {
      tier = "low";
    } else {
      tier = "minimal";
    }
  } else if (cores !== null) {
    tier = cores >= 8 ? "medium" : cores >= 4 ? "low" : "minimal";
  }

  const acceleration: HardwareSnapshot["acceleration"] =
    webgpu ? "webgpu" : webgl ? "webgl" : "cpu";

  const recommendation =
    tier === "high"
      ? "Larger reasoning/vision/generation models are feasible."
      : tier === "medium"
        ? "Mid-size models are feasible; prefer quantized local models."
        : tier === "low" || tier === "minimal"
          ? "Prefer lightweight/quantized models and low-latency providers."
          : "Hardware could not be detected; default to conservative settings.";

  return {
    tier,
    cpuCores: cores,
    memoryGB,
    vramGB,
    webgl,
    webgpu,
    renderer,
    acceleration,
    recommendation,
  };
}

/* ------------------------------------------------------------
 * MODEL CATALOG
 * ---------------------------------------------------------- */

export type ModelModality =
  | "text"
  | "vision"
  | "audio"
  | "image"
  | "video"
  | "embedding"
  | "code";

export interface ModelDescriptor {
  /** Stable id, e.g. "groq.gpt-oss-120b". */
  id: string;
  /** Human display name. */
  name: string;
  /** Provider.name this model is served through. */
  provider: string;
  modalities: ModelModality[];
  /** true = runs on-device; false = remote API. */
  local: boolean;
  requiresApiKey: boolean;
  /** Relative quality 0..1 (planning signal only). */
  quality: number;
  latency: "low" | "medium" | "high";
  /** Optional rough hardware floor for local models. */
  minMemoryGB?: number;
  minVramGB?: number;
  /** "installed" only when a real local runtime is present. */
  installed?: boolean;
  capabilities: string[];
}

const LOCAL_MODEL_SLOTS: ModelDescriptor[] = [
  // Honest slots for future on-device runtimes. They are NOT fake
  // providers — `installed` stays false until a real local runtime is
  // registered, so routing never selects them to actually generate.
  {
    id: "local.llm.phi3-mini",
    name: "Phi-3 Mini (local)",
    provider: "local",
    modalities: ["text", "code"],
    local: true,
    requiresApiKey: false,
    quality: 0.45,
    latency: "medium",
    minMemoryGB: 4,
    minVramGB: 4,
    installed: false,
    capabilities: ["chat", "reasoning", "code"],
  },
  {
    id: "local.vision.llava",
    name: "LLaVA (local vision)",
    provider: "local",
    modalities: ["text", "vision"],
    local: true,
    requiresApiKey: false,
    quality: 0.4,
    latency: "low",
    minMemoryGB: 8,
    minVramGB: 6,
    installed: false,
    capabilities: ["chat", "vision"],
  },
  {
    id: "local.image.sdxl",
    name: "Stable Diffusion XL (local)",
    provider: "local",
    modalities: ["image"],
    local: true,
    requiresApiKey: false,
    quality: 0.6,
    latency: "high",
    minMemoryGB: 8,
    minVramGB: 8,
    installed: false,
    capabilities: ["image-generation"],
  },
];

const REMOTE_MODEL_CATALOG: ModelDescriptor[] = [
  {
    // Current production chat model on Groq (llama-3.3-70b was retired)
    id: "groq.gpt-oss-120b",
    name: "GPT-OSS 120B (Groq)",
    provider: "Groq",
    modalities: ["text", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.8,
    latency: "low",
    capabilities: ["chat", "reasoning", "fast", "code"],
  },
  {
    // Retired on Groq — kept only as a descriptor for accounts that
    // still expose legacy vision models through VITE_GROQ_MODEL.
    id: "groq.llama-3.2-11b-vision",
    name: "Llama 3.2 11B Vision (Groq, legacy)",
    provider: "Groq",
    modalities: ["text", "vision", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.72,
    latency: "low",
    capabilities: ["chat", "vision", "reasoning"],
  },
  {
    id: "openrouter.free",
    name: "OpenRouter free",
    provider: "OpenRouter",
    modalities: ["text", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.7,
    latency: "medium",
    capabilities: ["chat", "reasoning", "multi-model"],
  },
  {
    id: "openrouter.llama-3.2-11b-vision",
    name: "Llama 3.2 11B Vision (OpenRouter)",
    provider: "OpenRouter",
    modalities: ["text", "vision", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.72,
    latency: "medium",
    capabilities: ["chat", "vision"],
  },
  {
    id: "cerebras.llama-3.3-70b",
    name: "Llama 3.3 70B (Cerebras)",
    provider: "Cerebras",
    modalities: ["text", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.8,
    latency: "low",
    capabilities: ["chat", "reasoning", "fast", "code"],
  },
  {
    id: "mistral.large",
    name: "Mistral Large (Mistral)",
    provider: "Mistral",
    modalities: ["text", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.82,
    latency: "medium",
    capabilities: ["chat", "reasoning", "code"],
  },
  {
    id: "fireworks.llama-v3p1-70b",
    name: "Llama 3.1 70B (Fireworks)",
    provider: "Fireworks",
    modalities: ["text", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.78,
    latency: "low",
    capabilities: ["chat", "reasoning", "code"],
  },
  {
    id: "github-models.gpt-4o",
    name: "GPT-4o (GitHub Models)",
    provider: "GitHub Models",
    modalities: ["text", "vision", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.85,
    latency: "medium",
    capabilities: ["chat", "vision", "reasoning", "code"],
  },
  {
    id: "anthropic.claude-sonnet-4-5",
    name: "Claude Sonnet 4.5 (Anthropic)",
    provider: "Anthropic",
    modalities: ["text", "vision", "code"],
    local: false,
    requiresApiKey: true,
    quality: 0.95,
    latency: "medium",
    capabilities: ["chat", "vision", "reasoning", "code"],
  },
];

/* ------------------------------------------------------------
 * OFFLINE MODE
 * ---------------------------------------------------------- */

const OFFLINE_KEY = "model.offline.v1";

interface OfflineState {
  enabled: boolean;
  updatedAt: number;
}

function readOffline(): boolean {
  try {
    const stored = KvStore.getInstance().get<OfflineState>(OFFLINE_KEY);
    return stored?.enabled === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------
 * ROUTING
 * ---------------------------------------------------------- */

export interface RoutingDecision {
  offlineEnabled: boolean;
  /** true when LÉLU is degraded to local-only capabilities. */
  degraded: boolean;
  hardware: HardwareSnapshot;
  modality: ModelModality;
  /** Ordered provider names to try first. */
  preferredProviders: string[];
  /** Providers skipped because offline mode is on / they don't fit. */
  blockedProviders: string[];
  /** Recommended model override, if the router has a concrete pick. */
  model: string | null;
  reason: string;
}

export interface ModelSystemStatus {
  offlineEnabled: boolean;
  hardware: HardwareSnapshot;
  localInstalled: boolean;
  localModelCount: number;
  remoteModelCount: number;
  modalitiesAvailable: ModelModality[];
  blockedByOffline: string[];
}

function detectModality(request: AIRequest): ModelModality {
  if (request.media?.some((m) => m.kind === "image" || m.kind === "video")) {
    return "vision";
  }
  // Generation intents are capability signals for future local/cloud
  // generation adapters; the conversational route itself stays "text".
  return "text";
}

export default class ModelRouter {
  private static instance: ModelRouter | null = null;

  private readonly catalog = new Map<string, ModelDescriptor>();
  private offlineEnabled = false;

  private constructor() {
    for (const model of [...REMOTE_MODEL_CATALOG, ...LOCAL_MODEL_SLOTS]) {
      this.catalog.set(model.id, model);
    }
    this.offlineEnabled = readOffline();
  }

  public static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter();
    }
    return ModelRouter.instance;
  }

  /* ---------- catalog ---------- */

  public registerModel(model: ModelDescriptor): void {
    this.catalog.set(model.id, model);
  }

  public models(): ModelDescriptor[] {
    return [...this.catalog.values()];
  }

  public model(id: string): ModelDescriptor | undefined {
    return this.catalog.get(id);
  }

  public modelsForProvider(provider: string): ModelDescriptor[] {
    return this.models().filter((m) => m.provider === provider);
  }

  public localModels(): ModelDescriptor[] {
    return this.models().filter((m) => m.local);
  }

  /* ---------- offline mode ---------- */

  public isOfflineMode(): boolean {
    return this.offlineEnabled;
  }

  public setOfflineMode(enabled: boolean): void {
    this.offlineEnabled = enabled;
    try {
      KvStore.getInstance().set<OfflineState>(OFFLINE_KEY, {
        enabled,
        updatedAt: Date.now(),
      });
    } catch {
      // persistence is best-effort
    }
  }

  /* ---------- routing ---------- */

  /**
   * Decide how a request should route. The ProviderResolver still owns
   * the real fallback loop; this only reorders and filters the provider
   * set based on modality, hardware, and offline mode.
   */
  public route(request: AIRequest): RoutingDecision {
    const hardware = detectHardware();
    const modality = detectModality(request);

    // Vision-capable providers first when media is attached.
    const visionProviders = new Set(
      this.models()
        .filter((m) => m.modalities.includes("vision"))
        .map((m) => m.provider),
    );

    const preferred: string[] = [];

    if (modality === "vision") {
      for (const name of visionProviders) {
        preferred.push(name);
      }
    }

    // Low-memory devices prefer the fastest remote providers first.
    if (hardware.tier === "low" || hardware.tier === "minimal") {
      for (const name of ["Groq", "Cerebras", "Fireworks"]) {
        if (!preferred.includes(name)) {
          preferred.push(name);
        }
      }
    }

    // Explicit per-request provider preference always wins, then the
    // router's modality/hardware ordering is appended as a secondary
    // signal — the existing chain still applies afterward.
    const explicit = request.preferredProviders ?? [];
    const ordered = [...explicit];
    for (const name of preferred) {
      if (!ordered.includes(name)) {
        ordered.push(name);
      }
    }

    let model: string | null = null;
    if (request.model?.trim()) {
      model = request.model.trim();
    } else if (modality === "vision") {
      const pick = this.models().find(
        (m) => m.modalities.includes("vision") && !m.local,
      );
      model = pick ? pick.name : null;
    }

    const degraded = this.offlineEnabled;

    return {
      offlineEnabled: this.offlineEnabled,
      degraded,
      hardware,
      modality,
      preferredProviders: ordered,
      blockedProviders: [],
      model,
      reason: degraded
        ? "Offline mode is ON — remote API providers are skipped; local-only capabilities are used."
        : modality === "vision"
          ? "Media attached — vision-capable providers are preferred."
          : "Standard text route — provider priority chain applies.",
    };
  }

  /* ---------- status ---------- */

  /**
   * Real capability status. Local models are only reported as
   * "installed" when a live local inference backend is actually
   * reachable (Ollama / llama.cpp / LM Studio / vLLM probed via
   * LocalLLMAdapter, or an in-browser runtime is loaded). Never
   * proceeds based on descriptor metadata alone.
   */
  public status(): ModelSystemStatus {
    const adapter = LocalLLMAdapter.getInstance();
    const llmReachable = adapter.isReachable();
    const llmModels = adapter.installedModels();
    const local = this.localModels();

    // Sync real backend state into the local model descriptors so
    // reachability can be queried from a single place.
    const localRuntimeInstalled = llmReachable && llmModels.length > 0;
    if (localRuntimeInstalled) {
      for (const model of local) {
        if (model.id === "local.llm.phi3-mini") {
          model.installed = llmReachable;
        }
      }
    }

    const modalities = new Set<ModelModality>();
    for (const model of this.models()) {
      // A remote model is always available (modality-wise) unless
      // offline mode blocks it. A local model is available only when
      // the descriptor reports installed AND a real backend confirms it.
      const modelUsable =
        !model.local || (model.installed === true && llmReachable);
      if (modelUsable) {
        for (const modality of model.modalities) {
          modalities.add(modality);
        }
      }
    }

    // When a local backend is reachable, add its installed models as
    // real capabilities beyond the descriptor slots.
    const reachableBackends = adapter.reachableBackends();

    return {
      offlineEnabled: this.offlineEnabled,
      hardware: detectHardware(),
      localInstalled: localRuntimeInstalled,
      localModelCount: local.length,
      remoteModelCount: this.models().filter((m) => !m.local).length,
      modalitiesAvailable: [...modalities],
      blockedByOffline: this.offlineEnabled
        ? this.models().filter((m) => !m.local).map((m) => m.provider)
        : [],
      // Additional live runtime data surfaced so the settings panel
      // can show exactly which backends are reachable right now.
      ...(reachableBackends.length > 0
        ? {
            reachableBackends: reachableBackends.map((b) => ({
              name: b.name,
              models: b.models,
            })),
          }
        : {}),
    } as ModelSystemStatus & { reachableBackends?: { name: string; models: string[] }[] };
  }
}
