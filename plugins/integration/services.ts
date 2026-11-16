/**
 * ==========================================================
 * LÉLU — EXTERNAL SERVICE ADAPTERS (server side)
 *
 * One honest adapter per integrated service. Each one answers the
 * same questions the browser-side protocol asks, and REFUSES to
 * claim health it did not observe.
 *
 * The rule this file exists to enforce: an unconfigured service
 * reports `not_configured`, a configured-but-unreachable one
 * reports `unavailable` with the real error, and only a service
 * that actually answered a request reports `healthy`. There is no
 * code path here that reports healthy without a network round
 * trip.
 *
 * Services that are genuinely optional (a LiteLLM gateway, an
 * OpenFGA server, a Temporal cluster, Pipecat, Infisical, the
 * OpenHands/OpenCode backends, a whisper.cpp server, Kokoro)
 * therefore appear in the product as their real state rather than
 * as a list of impressive names.
 * ==========================================================
 */

import type { AdapterHealth } from "../../src/core/integration/protocol.ts";

export interface ServiceProbe {
  /** Stable id used by the control surfaces. */
  id: string;
  name: string;
  /** The audited source this integrates. */
  source: string;
  /** Environment variables that configure it. */
  env: string[];
  /** What breaks when it is absent. */
  degradesTo: string;
  probe: (signal: AbortSignal) => Promise<{ state: AdapterHealth["state"]; detail: string; latencyMs?: number }>;
}

function configured(...names: string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

async function get(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; body: string; error?: string; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(init.timeoutMs ?? 4000),
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body: body.slice(0, 2000), latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: "",
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

const unconfigured = (detail: string): AdapterHealth => ({
  state: "not_configured",
  detail,
  checkedAt: Date.now(),
  contacted: false,
});

export function healthOf(result: {
  state: AdapterHealth["state"];
  detail: string;
  latencyMs?: number;
}): AdapterHealth {
  return {
    state: result.state,
    detail: result.detail,
    checkedAt: Date.now(),
    contacted: result.state === "healthy" || result.state === "degraded",
    ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * THE PROBES
 * ------------------------------------------------------------------ */

export const SERVICE_PROBES: ServiceProbe[] = [
  {
    id: "litellm",
    name: "LiteLLM model gateway",
    source: "https://github.com/BerriAI/litellm",
    env: ["LITELLM_BASE_URL", "LITELLM_API_KEY", "LITELLM_MODEL"],
    degradesTo:
      "LÉLU's existing AIProviderRegistry talks to each provider directly. No second registry is created; the gateway is only a routing layer in front of it.",
    probe: async () => {
      const base = configured("LITELLM_BASE_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "LITELLM_BASE_URL is unset — provider routing uses the existing registry directly.",
        };
      }
      const key = configured("LITELLM_API_KEY");
      const result = await get(`${base.value.replace(/\/$/, "")}/models`, {
        headers: key ? { authorization: `Bearer ${key.value}` } : {},
      });
      if (result.ok) {
        return { state: "healthy", detail: `Gateway answered /models (${result.status}).`, latencyMs: result.latencyMs };
      }
      return {
        state: "unavailable",
        detail: `Gateway at ${base.name} did not answer /models: ${result.error ?? `HTTP ${result.status}`}`,
        latencyMs: result.latencyMs,
      };
    },
  },
  {
    id: "openfga",
    name: "OpenFGA relationship authorization",
    source: "https://github.com/openfga/openfga",
    env: ["OPENFGA_API_URL", "OPENFGA_STORE_ID", "OPENFGA_MODEL_ID"],
    degradesTo:
      "The in-process RelationshipStore (same tuple shape) enforces device/session/owner relationships. Server-side tuple writes are not shared between instances.",
    probe: async () => {
      const base = configured("OPENFGA_API_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "OPENFGA_API_URL is unset — relationship checks use the in-process store.",
        };
      }
      const result = await get(`${base.value.replace(/\/$/, "")}/healthz`);
      if (result.ok) {
        return { state: "healthy", detail: `OpenFGA answered /healthz (${result.status}).`, latencyMs: result.latencyMs };
      }
      return {
        state: "unavailable",
        detail: `OpenFGA at ${base.name} did not answer: ${result.error ?? `HTTP ${result.status}`}`,
        latencyMs: result.latencyMs,
      };
    },
  },
  {
    id: "temporal",
    name: "Temporal durable workflows",
    source: "https://github.com/temporalio/temporal",
    env: ["TEMPORAL_ADDRESS", "TEMPORAL_NAMESPACE", "TEMPORAL_API_KEY"],
    degradesTo:
      "WorkflowEngine runs durably in LÉLU's own store with checkpoints and recorded step state; there is no distributed worker recovery across processes.",
    probe: async () => {
      const address = configured("TEMPORAL_ADDRESS");
      if (!address) {
        return {
          state: "not_configured",
          detail: "TEMPORAL_ADDRESS is unset — long-running work stays on the in-process workflow engine.",
        };
      }
      // Temporal's HTTP API is on 7243 in its default dev configuration;
      // a gRPC address alone is not probeable from here, and saying so is
      // more useful than a fabricated healthy state.
      const http = configured("TEMPORAL_HTTP_URL");
      if (!http) {
        return {
          state: "degraded",
          detail:
            `TEMPORAL_ADDRESS is set (${address.name}) but no TEMPORAL_HTTP_URL is configured, ` +
            "so reachability cannot be verified from the web runtime.",
        };
      }
      const result = await get(`${http.value.replace(/\/$/, "")}/api/v1/system-info`);
      if (result.ok) {
        return { state: "healthy", detail: `Temporal answered system-info (${result.status}).`, latencyMs: result.latencyMs };
      }
      return {
        state: "unavailable",
        detail: `Temporal did not answer: ${result.error ?? `HTTP ${result.status}`}`,
        latencyMs: result.latencyMs,
      };
    },
  },
  {
    id: "pipecat",
    name: "Pipecat voice pipeline",
    source: "https://github.com/pipecat-ai/pipecat",
    env: ["PIPECAT_BASE_URL"],
    degradesTo:
      "VoiceEngine (the existing Web Speech path) handles listen/speak with barge-in; no streaming WebRTC transport is available.",
    probe: async () => {
      const base = configured("PIPECAT_BASE_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "PIPECAT_BASE_URL is unset — voice uses the existing browser speech engines.",
        };
      }
      const result = await get(`${base.value.replace(/\/$/, "")}/health`);
      if (result.ok) {
        return { state: "healthy", detail: `Pipecat answered /health (${result.status}).`, latencyMs: result.latencyMs };
      }
      return {
        state: "unavailable",
        detail: `Pipecat did not answer: ${result.error ?? `HTTP ${result.status}`}`,
        latencyMs: result.latencyMs,
      };
    },
  },
  {
    id: "whisper",
    name: "whisper.cpp speech recognition",
    source: "https://github.com/ggml-org/whisper.cpp",
    env: ["WHISPER_BASE_URL", "WHISPER_MODEL"],
    degradesTo: "Browser speech recognition (VoiceEngine.transcriptionTransport), which needs the platform's own recogniser.",
    probe: async () => {
      const base = configured("WHISPER_BASE_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "WHISPER_BASE_URL is unset — transcription uses the browser recogniser when one exists.",
        };
      }
      // whisper.cpp's server exposes /inference; a GET there is a
      // 405/400 rather than a health document, so any HTTP reply at
      // all proves the server is listening.
      const result = await get(`${base.value.replace(/\/$/, "")}/`);
      if (result.status > 0) {
        return {
          state: result.status < 500 ? "healthy" : "degraded",
          detail: `whisper.cpp server answered HTTP ${result.status}.`,
          latencyMs: result.latencyMs,
        };
      }
      return { state: "unavailable", detail: `whisper.cpp unreachable: ${result.error}`, latencyMs: result.latencyMs };
    },
  },
  {
    id: "kokoro",
    name: "Kokoro text-to-speech",
    source: "https://huggingface.co/hexgrad/Kokoro-82M",
    env: ["KOKORO_BASE_URL", "KOKORO_VOICE"],
    degradesTo: "Browser speech synthesis, which is what LÉLU speaks through today.",
    probe: async () => {
      const base = configured("KOKORO_BASE_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "KOKORO_BASE_URL is unset — speech synthesis uses the browser's own voices (0 in a headless runtime).",
        };
      }
      const result = await get(`${base.value.replace(/\/$/, "")}/health`);
      if (result.status > 0) {
        return {
          state: result.status < 500 ? "healthy" : "degraded",
          detail: `Kokoro server answered HTTP ${result.status}.`,
          latencyMs: result.latencyMs,
        };
      }
      return { state: "unavailable", detail: `Kokoro unreachable: ${result.error}`, latencyMs: result.latencyMs };
    },
  },
  {
    id: "openhands",
    name: "OpenHands engineering backend",
    source: "https://github.com/OpenHands/OpenHands",
    env: ["OPENHANDS_BASE_URL", "OPENHANDS_API_KEY"],
    degradesTo: "The local engineering runtime: sandbox copies, whitelisted commands, real test execution on this machine.",
    probe: async () => {
      const base = configured("OPENHANDS_BASE_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "OPENHANDS_BASE_URL is unset — engineering runs on the local runtime backend.",
        };
      }
      const result = await get(`${base.value.replace(/\/$/, "")}/health`);
      if (result.ok) {
        return { state: "healthy", detail: `OpenHands answered /health (${result.status}).`, latencyMs: result.latencyMs };
      }
      return {
        state: "unavailable",
        detail: `OpenHands did not answer: ${result.error ?? `HTTP ${result.status}`}`,
        latencyMs: result.latencyMs,
      };
    },
  },
  {
    id: "opencode",
    name: "OpenCode coding engine",
    source: "https://github.com/anomalyco/opencode",
    env: ["OPENCODE_BASE_URL", "OPENCODE_MODEL"],
    degradesTo: "OpenHands when configured, otherwise the local engineering runtime.",
    probe: async () => {
      const base = configured("OPENCODE_BASE_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "OPENCODE_BASE_URL is unset — OpenCode is not an available execution backend.",
        };
      }
      const result = await get(`${base.value.replace(/\/$/, "")}/health`);
      if (result.status > 0) {
        return {
          state: result.status < 500 ? "healthy" : "degraded",
          detail: `OpenCode server answered HTTP ${result.status}.`,
          latencyMs: result.latencyMs,
        };
      }
      return { state: "unavailable", detail: `OpenCode unreachable: ${result.error}`, latencyMs: result.latencyMs };
    },
  },
  {
    id: "infisical",
    name: "Infisical secrets management",
    source: "https://github.com/Infisical/infisical",
    env: ["INFISICAL_API_URL", "INFISICAL_TOKEN", "INFISICAL_PROJECT_ID"],
    degradesTo:
      "LÉLU's existing env-file contract (.env / .env.local, server-owned credentials). No secret is copied anywhere by this adapter.",
    probe: async () => {
      const base = configured("INFISICAL_API_URL");
      if (!base) {
        return {
          state: "not_configured",
          detail: "INFISICAL_API_URL is unset — credentials stay in the existing server environment.",
        };
      }
      const result = await get(`${base.value.replace(/\/$/, "")}/api/status`);
      if (result.ok) {
        return { state: "healthy", detail: `Infisical answered /api/status (${result.status}).`, latencyMs: result.latencyMs };
      }
      return {
        state: "unavailable",
        detail: `Infisical did not answer: ${result.error ?? `HTTP ${result.status}`}`,
        latencyMs: result.latencyMs,
      };
    },
  },
  {
    id: "otel",
    name: "OpenTelemetry collector",
    source: "https://github.com/open-telemetry/opentelemetry-collector",
    env: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
    degradesTo:
      "Traces stay in LÉLU's in-process ring buffer, visible in the monitor and exportable as JSON. Nothing is shipped off-machine.",
    probe: async () => {
      const endpoint = configured("OTEL_EXPORTER_OTLP_ENDPOINT");
      if (!endpoint) {
        return {
          state: "not_configured",
          detail: "OTEL_EXPORTER_OTLP_ENDPOINT is unset — traces are local only, and the monitor says so.",
        };
      }
      const result = await get(`${endpoint.value.replace(/\/$/, "")}/v1/traces`, { method: "POST", body: "{}" });
      if (result.status > 0 && result.status < 500) {
        return {
          state: result.ok ? "healthy" : "degraded",
          detail: `Collector answered HTTP ${result.status}.`,
          latencyMs: result.latencyMs,
        };
      }
      return { state: "unavailable", detail: `Collector unreachable: ${result.error}`, latencyMs: result.latencyMs };
    },
  },
];

export async function probeAllServices(): Promise<
  Array<{ id: string; name: string; source: string; env: string[]; degradesTo: string; health: AdapterHealth }>
> {
  const results = [];
  for (const service of SERVICE_PROBES) {
    const controller = new AbortController();
    try {
      const outcome = await service.probe(controller.signal);
      results.push({
        id: service.id,
        name: service.name,
        source: service.source,
        env: service.env,
        degradesTo: service.degradesTo,
        health: healthOf(outcome),
      });
    } catch (error) {
      results.push({
        id: service.id,
        name: service.name,
        source: service.source,
        env: service.env,
        degradesTo: service.degradesTo,
        health: {
          state: "unavailable" as const,
          detail: `probe threw: ${error instanceof Error ? error.message : String(error)}`,
          checkedAt: Date.now(),
          contacted: false,
        },
      });
    }
  }
  return results;
}

export { unconfigured };
