/**
 * ==========================================================
 * LÉLU
 * LOCAL INFERENCE PROVIDER — local-first model adapter
 * ==========================================================
 *
 * The model is NOT LÉLU. This adapter is the LOCAL-FIRST slot in
 * the existing AIProviderRegistry fallback chain (priority 0,
 * tried before every remote API). It implements the exact same
 * AIProvider contract as Groq/OpenRouter/etc., and now drives
 * REAL on-device generation through the LocalLLMAdapter — the
 * HTTP bridge to Ollama / llama.cpp / LM Studio / vLLM.
 *
 * It NEVER fakes inference. `isAvailable()` returns true only
 * when a REAL local path exists: either a reachable local
 * inference server (probed with a real HTTP request), or a
 * loaded in-browser runtime (@huggingface/transformers /
 * @mlc-ai/web-llm). Until then it reports "not installed" —
 * which is exactly what keeps offline mode honest.
 *
 * The platform-specific detection is isolated here on purpose:
 * swap this adapter's probe for a native/desktop/edge bridge
 * later without touching ProviderResolver, ModelRouter, or UI.
 * ==========================================================
 */

import type AIProvider from "./AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "./AIProvider";
import LocalLLMAdapter from "../core/runtime/local/LocalLLMAdapter";

/**
 * Candidate in-browser runtimes, probed by dynamic import so their
 * (large) bundles are never pulled into the application entry. The
 * `@vite-ignore` tells Vite to leave the import native: if the
 * package is not installed the import rejects and we report
 * "not installed".
 */
const WEB_RUNTIMES = [
  "@huggingface/transformers",
  "@mlc-ai/web-llm",
] as const;

type RuntimeProbe =
  | { status: "probing" }
  | { status: "installed"; runtime: string }
  | { status: "not-installed"; error: string };

async function probeWebRuntimes(): Promise<RuntimeProbe> {
  for (const specifier of WEB_RUNTIMES) {
    try {
      await import(/* @vite-ignore */ specifier);
      return { status: "installed", runtime: specifier };
    } catch {
      // Package not installed / not loadable — keep probing the next one.
    }
  }
  return {
    status: "not-installed",
    error:
      "No in-browser inference runtime detected (install @huggingface/transformers or @mlc-ai/web-llm) and no local inference server is reachable.",
  };
}

export default class LocalInferenceProvider implements AIProvider {
  readonly name = "Local (on-device)";
  readonly priority = 0; // local-first: tried before every remote API
  readonly enabled = true;
  readonly timeout = 120_000; // local model load + first token can be slow
  readonly requiresApiKey = false;

  readonly capabilities = ["chat", "reasoning", "local", "offline"] as const;

  private webProbe: RuntimeProbe = { status: "probing" };
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
    this.webProbe = { status: "probing" };
    try {
      this.webProbe = await probeWebRuntimes();
    } catch {
      this.webProbe = {
        status: "not-installed",
        error: "In-browser runtime probe threw unexpectedly.",
      };
    }
    // Kick a background discovery of local HTTP inference servers
    // (Ollama / llama.cpp / LM Studio / vLLM). Never awaited here so
    // app startup stays fast; the first isAvailable() call joins the
    // same shared probe.
    void LocalLLMAdapter.getInstance()
      .discover()
      .catch(() => undefined);
    console.info("[LocalInferenceProvider] Initialized", {
      webRuntime: this.webProbe.status,
      localBackends: LocalLLMAdapter.getInstance().backends().map((b) => b.name),
    });
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Only available when a REAL local path exists: a reachable local
   * inference server, or a loaded in-browser runtime. This is the
   * single honest gate — no local runtime, no local generation.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }
    if (this.webProbe.status === "installed") {
      return true;
    }
    try {
      return LocalLLMAdapter.getInstance().isReachable();
    } catch {
      return false;
    }
  }

  async health(): Promise<AIProviderHealth> {
    const available = await this.isAvailable();
    const adapter = LocalLLMAdapter.getInstance();
    const reachableBackends = adapter.reachableBackends();

    return {
      available,
      initialized: this.initialized,
      lastChecked: Date.now(),
      lastError: available
        ? undefined
        : this.webProbe.status === "not-installed"
          ? this.webProbe.error
          : "No local inference backend is reachable.",
      ...(reachableBackends.length > 0
        ? { backends: reachableBackends.map((b) => ({ name: b.name, baseUrl: b.baseUrl })) }
        : {}),
    } as AIProviderHealth & { backends?: { name: string; baseUrl: string }[] };
  }

  canHandle(_input: string): boolean {
    // Text/chat is the baseline a local LLM can handle once available.
    return true;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const adapter = LocalLLMAdapter.getInstance();

    if (adapter.isReachable()) {
      // REAL local generation through the HTTP bridge.
      return await adapter.generate(request);
    }

    if (this.webProbe.status === "installed") {
      throw new Error(
        `In-browser runtime "${this.webProbe.runtime}" is present but its inference adapter is not bound yet (platform adapter pending).`,
      );
    }

    throw new Error(
      this.webProbe.status === "not-installed"
        ? this.webProbe.error
        : "Local inference runtime is not loaded.",
    );
  }
}