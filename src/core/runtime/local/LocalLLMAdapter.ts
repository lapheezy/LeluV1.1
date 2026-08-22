/**
 * ==========================================================
 * LÉLU
 * LOCAL LLM ADAPTER — real local inference over HTTP
 *
 * Phase 2 of the local runtime. This adapter speaks the
 * OpenAI-compatible /v1 protocol that local inference servers
 * expose, so LÉLU's existing provider contract (AIProvider) can
 * drive REAL on-device generation without any cloud key:
 *
 *   - Ollama        http://localhost:11434   (set OLLAMA_ORIGINS=* for cross-origin web apps)
 *   - llama.cpp     http://localhost:8080    (server --cors)
 *   - LM Studio     http://localhost:1234    (CORS enabled by default)
 *   - vLLM          http://localhost:8000
 *   - custom        any OpenAI-compatible URL configured via the API
 *
 * Honesty rules:
 *   - discovery PROBES each endpoint with a real GET /v1/models;
 *     nothing is assumed reachable.
 *   - generate() only runs after a reachable backend was found and
 *     throws a clear error otherwise. No placeholder output, ever.
 *   - probe results are cached 30s so the router doesn't stall on
 *     repeated requests; the cache is shared with ModelRouter and
 *     the settings panel so every surface reports the same truth.
 *
 * In a sandboxed browser preview localhost cannot reach a machine
 * outside the sandbox, so this honestly reports "not reachable"
 * until a local server is actually available to the browser (or a
 * native companion bridge is wired).
 * ==========================================================
 */

import KvStore from "../../storage/KvStore";
import type {
  AIRequest,
  AIResponse,
  AIMessage,
} from "../../../providers/AIProvider";
import type { LocalBackendKind, LocalBackendStatus } from "./LocalRuntimeTypes";

interface BackendSpec {
  kind: LocalBackendKind;
  name: string;
  baseUrl: string;
  /** OpenAI-compatible model to request when the backend lists none. */
  defaultModel: string;
}

const DEFAULT_BACKENDS: BackendSpec[] = [
  {
    kind: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.2",
  },
  {
    kind: "llamacpp",
    name: "llama.cpp server",
    baseUrl: "http://localhost:8080",
    defaultModel: "local-model",
  },
  {
    kind: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234",
    defaultModel: "",
  },
  {
    kind: "vllm",
    name: "vLLM",
    baseUrl: "http://localhost:8000",
    defaultModel: "",
  },
];

const DISCOVERY_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 1_500;
const GENERATE_TIMEOUT_MS = 120_000;
const CUSTOM_ENDPOINT_KEY = "runtime.local.llm.endpoint.v1";

interface CustomEndpoint {
  baseUrl: string;
  defaultModel?: string;
}

interface DiscoveryState {
  backends: LocalBackendStatus[];
  checkedAt: number;
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

export default class LocalLLMAdapter {
  private static instance: LocalLLMAdapter | null = null;

  private discovery: DiscoveryState | null = null;
  private inFlight: Promise<LocalBackendStatus[]> | null = null;

  public static getInstance(): LocalLLMAdapter {
    if (!LocalLLMAdapter.instance) {
      LocalLLMAdapter.instance = new LocalLLMAdapter();
    }
    return LocalLLMAdapter.instance;
  }

  private constructor() {}

  /* ---------- configuration ---------- */

  public setCustomEndpoint(baseUrl: string, defaultModel = ""): void {
    const cleaned = normalizeBaseUrl(baseUrl.trim());
    if (!/^https?:\/\//.test(cleaned)) {
      throw new Error("Custom local endpoint must be an http(s) URL.");
    }
    try {
      KvStore.getInstance().set<CustomEndpoint>(CUSTOM_ENDPOINT_KEY, {
        baseUrl: cleaned,
        defaultModel,
      });
    } catch {
      // persistence is best-effort
    }
    this.discovery = null; // force re-discovery
  }

  public getCustomEndpoint(): CustomEndpoint | null {
    try {
      return KvStore.getInstance().get<CustomEndpoint>(CUSTOM_ENDPOINT_KEY);
    } catch {
      return null;
    }
  }

  public clearCustomEndpoint(): void {
    try {
      KvStore.getInstance().remove(CUSTOM_ENDPOINT_KEY);
    } catch {
      // best-effort
    }
    this.discovery = null;
  }

  private endpointSpecs(): BackendSpec[] {
    const specs = [...DEFAULT_BACKENDS];
    const custom = this.getCustomEndpoint();
    if (custom?.baseUrl) {
      specs.push({
        kind: "custom",
        name: "Custom local endpoint",
        baseUrl: custom.baseUrl,
        defaultModel: custom.defaultModel ?? "",
      });
    }
    return specs;
  }

  /* ---------- discovery ---------- */

  /**
   * Probe every candidate backend with a real GET /v1/models.
   * Concurrent-safe (one shared in-flight probe) and TTL-cached.
   */
  public async discover(force = false): Promise<LocalBackendStatus[]> {
    if (!force && this.discovery && Date.now() - this.discovery.checkedAt < DISCOVERY_TTL_MS) {
      return this.discovery.backends;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.probeAll();
    try {
      const backends = await this.inFlight;
      this.discovery = { backends, checkedAt: Date.now() };
      return backends;
    } finally {
      this.inFlight = null;
    }
  }

  private async probeAll(): Promise<LocalBackendStatus[]> {
    const specs = this.endpointSpecs();
    const results: LocalBackendStatus[] = await Promise.all(
      specs.map((spec) => this.probeOne(spec)),
    );
    return results;
  }

  private async probeOne(spec: BackendSpec): Promise<LocalBackendStatus> {
    const base: LocalBackendStatus = {
      kind: spec.kind,
      name: spec.name,
      baseUrl: spec.baseUrl,
      models: [],
      reachable: false,
      checkedAt: Date.now(),
      defaultModel: spec.defaultModel || undefined,
    };
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${spec.baseUrl}/v1/models`, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
      } finally {
        window.clearTimeout(timer);
      }
      if (!response.ok) {
        return { ...base, reachable: false, error: `HTTP ${response.status}` };
      }
      const payload = (await response.json()) as { data?: { id?: string }[] };
      const models = (payload.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      return { ...base, reachable: true, models };
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Timed out (no local server on this endpoint)"
          : error instanceof Error
            ? error.message
            : String(error);
      return { ...base, reachable: false, error: message };
    }
  }

  /* ---------- state ---------- */

  public backends(): LocalBackendStatus[] {
    return this.discovery?.backends ?? [];
  }

  public reachableBackends(): LocalBackendStatus[] {
    return this.backends().filter((b) => b.reachable);
  }

  public isReachable(): boolean {
    return this.reachableBackends().length > 0;
  }

  public installedModels(): string[] {
    const seen = new Set<string>();
    for (const backend of this.reachableBackends()) {
      for (const model of backend.models) {
        seen.add(model);
      }
    }
    return [...seen];
  }

  public async status() {
    await this.discover();
    return {
      backends: this.backends(),
      reachable: this.isReachable(),
      installedModels: this.installedModels(),
      customEndpoint: this.getCustomEndpoint(),
      checkedAt: this.discovery?.checkedAt ?? null,
    };
  }

  /* ---------- generation ---------- */

  private pickModel(request: AIRequest): { backend: LocalBackendStatus; model: string } {
    const reachable = this.reachableBackends();
    if (reachable.length === 0) {
      throw new Error(
        "No local inference backend is reachable. Start Ollama (`ollama serve`), llama.cpp (`server --cors`), LM Studio, or vLLM on this machine and allow CORS, then retry.",
      );
    }

    const requested = request.model?.trim();
    for (const backend of reachable) {
      if (requested && backend.models.includes(requested)) {
        return { backend, model: requested };
      }
    }
    for (const backend of reachable) {
      if (backend.models.length > 0) {
        return { backend, model: backend.models[0] ?? backend.defaultModel };
      }
    }
    const backend = reachable[0];
    const model = requested || backend.defaultModel;
    if (!model) {
      throw new Error(
        `Local backend "${backend.name}" lists no models. Pull a model first (e.g. \`ollama pull llama3.2\`) or set a default model for the custom endpoint.`,
      );
    }
    return { backend, model };
  }

  public async generate(request: AIRequest): Promise<AIResponse> {
    await this.discover();
    const started = Date.now();
    const { backend, model } = this.pickModel(request);

    const messages: AIMessage[] =
      request.messages.length > 0
        ? request.messages
        : [{ role: "user", content: request.prompt }];

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.stop !== undefined && request.stop.length > 0) {
      body.stop = request.stop;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${backend.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `Local backend "${backend.name}" returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: Record<string, unknown>;
      model?: string;
    };

    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error(`Local backend "${backend.name}" returned an empty completion.`);
    }

    return {
      text,
      provider: "Local (on-device)",
      model: payload.model ?? model,
      processingTime: Date.now() - started,
      metadata: {
        local: true,
        backend: backend.name,
        baseUrl: backend.baseUrl,
        usage: payload.usage,
      },
    };
  }
}