/**
 * ==========================================================
 * LÉLU — REPOSITORY CATALOG
 *
 * The open-source capabilities LÉLU intends to absorb, recorded
 * as verified provenance rather than a reading list.
 *
 * Two fields do the work that a "recommended projects" table
 * cannot:
 *
 *   upstream     — the exact repository, checked against the
 *                  project, never reconstructed from memory;
 *   integration  — how far the work has actually got:
 *                    PRESENT    a LÉLU adapter exists and has
 *                               produced real evidence
 *                    ADAPTED    a boundary exists, runtime not
 *                               configured
 *                    PLANNED    boundary identified, nothing built
 *                    UNVERIFIED the repository cannot be pinned
 *                               from the name alone
 *                    UNSUITABLE maintained badly, licensed
 *                               incompatibly, or duplicated
 *
 * A repository being in this catalog means "known and assessed".
 * It never means "installed", "operational" or "verified". The
 * collector, not this file, decides what is running.
 *
 * Browser-safe: pure data, no imports.
 * ==========================================================
 */

import type { StudioId } from "./types.ts";

export type RepositoryIntegration =
  | "PRESENT"
  | "ADAPTED"
  | "PLANNED"
  | "UNVERIFIED"
  | "UNSUITABLE";

export type RepositoryKind = "library" | "service" | "cli" | "model" | "ecosystem";

export interface RepositoryRecord {
  id: string;
  name: string;
  /** The exact upstream repository. Empty only when UNVERIFIED. */
  upstream: string;
  /** SPDX identifier, or the honest mixed/`NOASSERTION` description. */
  license: string;
  licenseNote?: string;
  kind: RepositoryKind;
  studio: StudioId | "cross";
  /** The LÉLU capability or subsystem this would provide. */
  role: string;
  /** Where it attaches inside the existing architecture. */
  boundary: string;
  integration: RepositoryIntegration;
  /** What LÉLU already has that overlaps, so nobody integrates twice. */
  overlap: string;
  /** Runtime facts that decide whether self-hosting is realistic. */
  requirements: string;
  /** Why this state and not a better one. */
  statusDetail: string;
  verifiedAt: string;
}

const V = "2026-11-06";

export const REPOSITORY_CATALOG: readonly RepositoryRecord[] = [
  /* ---------------------------- engineering ---------------------------- */
  {
    id: "qwen3-coder",
    name: "Qwen3-Coder",
    upstream: "https://github.com/QwenLM/Qwen3-Coder",
    license: "NOASSERTION",
    licenseNote: "Repository declares no SPDX license; the published weights (Qwen3-Coder-30B-A3B-Instruct) are Apache-2.0.",
    kind: "model",
    studio: "engineering",
    role: "Coding model: repository analysis, code generation and review.",
    boundary: "ProviderRegistry (an OpenAI-compatible endpoint), never a second model router.",
    integration: "PLANNED",
    overlap: "Existing provider registry already serves coding models; Qwen3-Coder would be one more provider entry.",
    requirements: "30B-A3B MoE weights need a GPU host or a hosted endpoint; CPU-only inference is not practical.",
    statusDetail: "Assessed only. No endpoint is configured on this machine, so the capability is NOT_CONFIGURED.",
    verifiedAt: V,
  },
  {
    id: "openhands",
    name: "OpenHands",
    upstream: "https://github.com/OpenHands/OpenHands",
    license: "MIT",
    kind: "service",
    studio: "engineering",
    role: "Autonomous engineering runtime: repository-level tasks in an isolated workspace.",
    boundary: "AdapterRegistry → EngineeringOrchestrator → SandboxRuntime. No new orchestrator.",
    integration: "ADAPTED",
    overlap: "EngineeringOrchestrator already owns dispatch, workspace locks, diff and test verification.",
    requirements: "Docker runtime plus a model endpoint; several GB of RAM and a Linux host.",
    statusDetail: "Adapter path exists; OPENHANDS_BASE_URL is unset and no backend is registered, so execution is NOT_CONFIGURED.",
    verifiedAt: V,
  },
  {
    id: "opencode",
    name: "OpenCode",
    upstream: "https://github.com/anomalyco/opencode",
    license: "MIT",
    kind: "cli",
    studio: "engineering",
    role: "Terminal-oriented coding agent for repository navigation and editing.",
    boundary: "AdapterRegistry → EngineeringOrchestrator as a second CodingBackend.",
    integration: "ADAPTED",
    overlap: "Same dispatch path as OpenHands; only the backend implementation differs.",
    requirements: "Node runtime and a model endpoint; runs locally without Docker.",
    statusDetail: "Registration path exists; OPENCODE_BASE_URL is unset, so it is NOT_CONFIGURED.",
    verifiedAt: V,
  },

  /* ------------------------------- voice ------------------------------- */
  {
    id: "pipecat",
    name: "Pipecat",
    upstream: "https://github.com/pipecat-ai/pipecat",
    license: "BSD-2-Clause",
    kind: "library",
    studio: "voice",
    role: "Realtime audio pipeline orchestration (capture → VAD → STT → TTS).",
    boundary: "VoiceEngine pipeline stage; the browser still owns microphone permission.",
    integration: "PLANNED",
    overlap: "VoiceEngine already gates capture and playback; Pipecat replaces neither.",
    requirements: "Python 3.10+ and a Python-capable host — this application serves through a Vite/Node plugin runtime.",
    statusDetail: "No Python sidecar exists in this deployment, so the pipeline is NOT_CONFIGURED.",
    verifiedAt: V,
  },
  {
    id: "whisper-cpp",
    name: "whisper.cpp",
    upstream: "https://github.com/ggml-org/whisper.cpp",
    license: "MIT",
    kind: "cli",
    studio: "voice",
    role: "Local speech recognition and transcription.",
    boundary: "VoiceEngine adapter over an HTTP transcription endpoint.",
    integration: "PLANNED",
    overlap: "The voice adapters already probe a Whisper-shaped endpoint; the engine itself is the missing half.",
    requirements: "CPU inference is practical for small models; model weights add 75 MB–1.5 GB.",
    statusDetail: "No Whisper server is reachable on this machine, so transcription is NOT_CONFIGURED.",
    verifiedAt: V,
  },
  {
    id: "silero-vad",
    name: "Silero VAD",
    upstream: "https://github.com/snakers4/silero-vad",
    license: "MIT",
    licenseNote: "The repository README badge conflicted with its LICENSE; a maintainer confirmed MIT for the model file.",
    kind: "model",
    studio: "voice",
    role: "Neural voice-activity detection for speech boundaries.",
    boundary: "VoiceEngine VAD stage, replacing the energy detector only where it demonstrably wins.",
    integration: "PLANNED",
    overlap: "A real energy detector with hysteresis already exists and is honest about its limits.",
    requirements: "ONNX weights (~2 MB) and an ONNX runtime; no GPU.",
    statusDetail: "Weights are not present, so the existing energy detector remains the only VAD.",
    verifiedAt: V,
  },
  {
    id: "kokoro",
    name: "Kokoro",
    upstream: "https://github.com/hexgrad/kokoro",
    license: "Apache-2.0",
    kind: "model",
    studio: "voice",
    role: "Local speech synthesis.",
    boundary: "VoiceEngine synthesis adapter; browser `speechSynthesis` stays the zero-dependency fallback.",
    integration: "PLANNED",
    overlap: "tss.speak via the browser already works where the platform provides a voice.",
    requirements: "82M parameter weights; CPU inference is feasible but not realtime on every machine.",
    statusDetail: "No Kokoro endpoint is configured, so synthesis beyond the browser fallback is NOT_CONFIGURED.",
    verifiedAt: V,
  },

  /* --------------------------- infrastructure -------------------------- */
  {
    id: "litellm",
    name: "LiteLLM",
    upstream: "https://github.com/BerriAI/litellm",
    license: "MIT",
    licenseNote: "The `ee/` directory carries a separate enterprise licence; the core proxy is MIT.",
    kind: "service",
    studio: "infrastructure",
    role: "Provider abstraction, fallback and usage accounting across model providers.",
    boundary: "ProviderRegistry — LÉLU's selection policy stays authoritative.",
    integration: "PLANNED",
    overlap: "ProviderRegistry, AIRouter and ProviderModels already do routing and fallback in-process.",
    requirements: "Python proxy service; adds a hop and a second place model policy could live.",
    statusDetail: "Not adopted: the existing registry already satisfies the need, so this is a redundancy decision, not a gap.",
    verifiedAt: V,
  },
  {
    id: "temporal",
    name: "Temporal",
    upstream: "https://github.com/temporalio/temporal",
    license: "MIT",
    kind: "service",
    studio: "infrastructure",
    role: "Durable workflow execution with retries and recovery for long-running work.",
    boundary: "Optional backend behind the existing workflow/execution interfaces — never a SHAMAN replacement.",
    integration: "PLANNED",
    overlap: "WorkflowStore and EngineeringOrchestrator already persist and resume local work.",
    requirements: "A server plus a database; meaningful operational weight for a single-node app.",
    statusDetail: "Assessed and deferred: the local runtime already completes the tasks that exist today.",
    verifiedAt: V,
  },
  {
    id: "opentelemetry",
    name: "OpenTelemetry Collector",
    upstream: "https://github.com/open-telemetry/opentelemetry-collector",
    license: "Apache-2.0",
    kind: "service",
    studio: "infrastructure",
    role: "Trace/metric export to an external backend.",
    boundary: "The existing telemetry buffer and trace correlation ids; the collector is an exporter target.",
    integration: "PLANNED",
    overlap: "IntegrationState already records correlated spans and exposes /api/integration/traces.",
    requirements: "A collector process and an export endpoint; the in-process buffer caps at its configured size.",
    statusDetail: "The exporter is unconfigured, so traces stay in the bounded local buffer.",
    verifiedAt: V,
  },

  /* ------------------------------ security ----------------------------- */
  {
    id: "infisical",
    name: "Infisical",
    upstream: "https://github.com/Infisical/infisical",
    license: "MIT",
    licenseNote: "The `ee/` directory carries a separate enterprise licence.",
    kind: "service",
    studio: "security",
    role: "Central secret storage, distribution and rotation.",
    boundary: "Server-side only; secret values never reach browser code.",
    integration: "PLANNED",
    overlap: "Environment loading already exists (`plugins/loadEnvFiles.ts`); rotation does not.",
    requirements: "A server plus PostgreSQL; local secret files remain simpler for a single owner.",
    statusDetail: "Not adopted: no rotation workflow exists yet to justify the service.",
    verifiedAt: V,
  },
  {
    id: "opa",
    name: "Open Policy Agent",
    upstream: "https://github.com/open-policy-agent/opa",
    license: "Apache-2.0",
    kind: "cli",
    studio: "security",
    role: "Policy evaluation for every capability call.",
    boundary: "The existing capability gateway (`src/core/security/policy.ts` → OPA or reference engine).",
    integration: "PRESENT",
    overlap: "None — this is the policy authority LÉLU already uses.",
    requirements: "A single static binary; no service required.",
    statusDetail: "OPA 1.22.2 answers on this machine and the policy gate evaluates against it.",
    verifiedAt: V,
  },
  {
    id: "openfga",
    name: "OpenFGA",
    upstream: "https://github.com/openfga/openfga",
    license: "Apache-2.0",
    kind: "service",
    studio: "security",
    role: "Relationship-based authorization at resource granularity.",
    boundary: "Only where RelationshipStore's tuples are not enough; not a second authorization system.",
    integration: "PLANNED",
    overlap: "RelationshipStore already enforces tuples; OPA already decides actions.",
    requirements: "A server plus a datastore.",
    statusDetail: "Not adopted: adding it now would duplicate authorization that already works.",
    verifiedAt: V,
  },
  {
    id: "semgrep",
    name: "Semgrep",
    upstream: "https://github.com/semgrep/semgrep",
    license: "LGPL-2.1-or-later",
    licenseNote: "Copyleft. Keep it as a separate executed binary; do not link it into LÉLU's distribution.",
    kind: "cli",
    studio: "security",
    role: "Static analysis and custom security rules.",
    boundary: "The existing scanner runner in `plugins/integration/scanners.ts`.",
    integration: "PRESENT",
    overlap: "None — this is the SAST scanner already wired into the gate.",
    requirements: "A Python-installed CLI; scan time grows with repository size.",
    statusDetail: "Installed and producing findings through the Security Center.",
    verifiedAt: V,
  },
  {
    id: "trivy",
    name: "Trivy",
    upstream: "https://github.com/aquasecurity/trivy",
    license: "Apache-2.0",
    kind: "cli",
    studio: "security",
    role: "Dependency and filesystem vulnerability scanning.",
    boundary: "The existing scanner runner; findings surface as Security Center evidence.",
    integration: "PRESENT",
    overlap: "None.",
    requirements: "A single binary plus a vulnerability database download (network on first run).",
    statusDetail: "Installed. 86 dependency findings remain open and are documented rather than upgraded blindly.",
    verifiedAt: V,
  },
  {
    id: "gitleaks",
    name: "Gitleaks",
    upstream: "https://github.com/gitleaks/gitleaks",
    license: "MIT",
    kind: "cli",
    studio: "security",
    role: "Secret detection across the repository and history.",
    boundary: "The existing scanner runner; matches are triaged and never echoed into UI.",
    integration: "PRESENT",
    overlap: "None.",
    requirements: "A single binary; scan scope must exclude dependency caches.",
    statusDetail: "Installed and running; scope noise from `.tools/trivy-cache` and `generation_logs` is still unexcluded.",
    verifiedAt: V,
  },

  /* ---------------------------- perception ----------------------------- */
  {
    id: "open-eagle-eye",
    name: "Open-Eagle-Eye MCP",
    upstream: "https://github.com/stuchapin909/Open-Eagle-Eye",
    license: "MIT",
    kind: "service",
    studio: "cross",
    role: "MCP server that retrieves snapshots from public camera feeds.",
    boundary: "Perception layer, behind explicit user authorization per source.",
    integration: "PLANNED",
    overlap: "The existing browser/earth stack already displays public imagery without a new runtime.",
    requirements: "Node MCP runtime plus outbound network access to public feeds.",
    statusDetail: "No MCP host is running in this deployment, so perception is NOT_CONFIGURED.",
    verifiedAt: V,
  },
  {
    id: "argus",
    name: "Argus (perception)",
    upstream: "",
    license: "UNVERIFIED",
    kind: "library",
    studio: "cross",
    role: "Camera source discovery and frame acquisition (claimed).",
    boundary: "Unassigned until the project is identified.",
    integration: "UNVERIFIED",
    overlap: "Unknown.",
    requirements: "Unknown.",
    statusDetail: "The name does not identify one project. Candidates are NVIDIA ISAAC ROS `isaac_ros_argus_camera` (Apache-2.0, Jetson-only) and `NVIDIA-AI-IOT/argus_camera` (BSD-3-Clause). Neither is confirmed as intended.",
    verifiedAt: V,
  },
  {
    id: "opencam",
    name: "OpenCam",
    upstream: "",
    license: "UNVERIFIED",
    kind: "library",
    studio: "cross",
    role: "iPhone-as-webcam receiver (candidate interpretation).",
    boundary: "Unassigned.",
    integration: "UNVERIFIED",
    overlap: "The existing Device Bridge already pairs devices under explicit authorization.",
    requirements: "Unknown.",
    statusDetail: "Name alone is ambiguous. The only candidate found is `MoffysDev/OpenCam` (GPL-3.0, Python) — copyleft and unconfirmed.",
    verifiedAt: V,
  },

  /* ------------------------ browser and devices ------------------------ */
  {
    id: "browser-use",
    name: "Browser Use",
    upstream: "https://github.com/browser-use/browser-use",
    license: "MIT",
    kind: "library",
    studio: "cross",
    role: "Model-driven browser navigation and form interaction.",
    boundary: "The existing BrowserTool/in-app browser, not a second browser stack.",
    integration: "PLANNED",
    overlap: "BrowserTool already implements authorized navigation and capture.",
    requirements: "Python runtime plus a model endpoint; its cloud service is separate and paid.",
    statusDetail: "Assessed only: no Python host, and the existing browser tool already covers the workflow.",
    verifiedAt: V,
  },
  {
    id: "neko",
    name: "Neko",
    upstream: "https://github.com/m1k1o/neko",
    license: "Apache-2.0",
    kind: "service",
    studio: "cross",
    role: "Self-hosted virtual browser streamed over WebRTC.",
    boundary: "The existing remote-browser integration (`plugins/nekoApi.ts`) — already present.",
    integration: "ADAPTED",
    overlap: "A Neko bridge already exists; it is the remote surface, not a replacement for the in-app browser.",
    requirements: "A container host with WebRTC ports and bandwidth.",
    statusDetail: "Bridge present; no Neko server is configured, so remote sessions are NOT_CONFIGURED.",
    verifiedAt: V,
  },
  {
    id: "livekit",
    name: "LiveKit",
    upstream: "https://github.com/livekit/livekit",
    license: "Apache-2.0",
    kind: "service",
    studio: "cross",
    role: "Realtime media transport for device and voice sessions.",
    boundary: "Device Bridge transport only; SHAMAN keeps orchestration.",
    integration: "PLANNED",
    overlap: "The Device Bridge already has an authenticated session model.",
    requirements: "A media server plus TURN/STUN; bandwidth cost is real even though the software is free.",
    statusDetail: "No media server is deployed, so transport is NOT_CONFIGURED.",
    verifiedAt: V,
  },
  {
    id: "livekit-agents",
    name: "LiveKit Agents",
    upstream: "https://github.com/livekit/agents",
    license: "Apache-2.0",
    licenseNote: "Framework is Apache-2.0; bundled model weights carry their own licences.",
    kind: "library",
    studio: "cross",
    role: "Server-side realtime media agents (transport and turn-taking).",
    boundary: "Only media/turn-taking primitives; never the agent hierarchy.",
    integration: "PLANNED",
    overlap: "SHAMAN and the Executive Board own agent coordination; this would be transport only.",
    requirements: "Python runtime alongside a LiveKit server.",
    statusDetail: "Not adopted: it would add a second agent runtime for transport that does not exist yet.",
    verifiedAt: V,
  },
  {
    id: "ios-replaykit-frameaccess",
    name: "iOS ReplayKit FrameAccess",
    upstream: "https://github.com/Iotric/iOS-ReplayKit-FrameAccess",
    license: "NOASSERTION",
    kind: "library",
    studio: "cross",
    role: "Sample: moving ReplayKit frames from a broadcast extension to a host app.",
    boundary: "Native shell only; a browser tab cannot request ReplayKit.",
    integration: "UNSUITABLE",
    overlap: "None, but it requires a native WKWebView shell LÉLU does not ship.",
    requirements: "Xcode, a broadcast extension, and App Store entitlements.",
    statusDetail: "Unmaintained since 2022 and unlicensed. Not usable without a native app and a licence grant.",
    verifiedAt: V,
  },
  {
    id: "webrtc-replaykit",
    name: "webrtc-replaykit",
    upstream: "https://github.com/zhangqibin/webrtc-replaykit",
    license: "BSD-3-Clause",
    licenseNote: "GitHub reports NOASSERTION; the repository bundles a BSD-3-Clause licence file.",
    kind: "library",
    studio: "cross",
    role: "Demo: ReplayKit broadcast extension over WebRTC.",
    boundary: "Native shell research only.",
    integration: "UNSUITABLE",
    overlap: "Duplicated by the LiveKit path if native capture is ever attempted.",
    requirements: "Xcode and a native host app.",
    statusDetail: "Unmaintained since 2020, and no 'Webbridge' upstream was verifiable. Reference reading only.",
    verifiedAt: V,
  },

  /* ------------------------------ spatial ------------------------------ */
  {
    id: "pmndrs-xr",
    name: "pmndrs/xr",
    upstream: "https://github.com/pmndrs/xr",
    license: "MIT",
    kind: "library",
    studio: "cross",
    role: "WebXR bindings for React Three Fiber.",
    boundary: "The existing R3F/Drei scene; optional and tiered, never a second renderer.",
    integration: "PLANNED",
    overlap: "Three.js, R3F and Drei are already the spatial stack.",
    requirements: "A WebXR-capable browser; iOS Safari does not expose immersive WebXR.",
    statusDetail: "Assessed for future expansion only; iPhone browser support is the blocker.",
    verifiedAt: V,
  },
];

export interface RepositoryCoverage {
  total: number;
  verified: number;
  unverified: string[];
  unverifiedDetail: Array<{ id: string; name: string; license: string; advertised: string; actual: string }>;
  present: string[];
  planned: string[];
}

/**
 * What the catalog can and cannot claim.
 *
 * `verified` means the repository identity and licence were checked
 * against upstream — NOT that LÉLU can run it. `present` is the only
 * set backed by adapters that produced real evidence.
 */
export function repositoryCoverage(
  catalog: readonly RepositoryRecord[] = REPOSITORY_CATALOG,
): RepositoryCoverage {
  return {
    total: catalog.length,
    verified: catalog.filter((record) => record.upstream && record.license !== "UNVERIFIED").length,
    unverified: catalog.filter((record) => !record.upstream).map((record) => record.id),
    unverifiedDetail: catalog
      .filter((record) => !record.upstream)
      .map((record) => ({
        id: record.id,
        name: record.name,
        license: record.license,
        advertised: record.role,
        actual: record.statusDetail,
      })),
    present: catalog.filter((record) => record.integration === "PRESENT").map((record) => record.id),
    planned: catalog.filter((record) => record.integration === "PLANNED" || record.integration === "ADAPTED").map((record) => record.id),
  };
}

/** Records for one studio, or everything when the studio is unknown. */
export function repositoriesFor(studio: StudioId | "cross" | "all"): RepositoryRecord[] {
  if (studio === "all") return [...REPOSITORY_CATALOG];
  return REPOSITORY_CATALOG.filter((record) => record.studio === studio);
}
