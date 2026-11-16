/**
 * ==========================================================
 * LÉLU — OPERATIONAL INTELLIGENCE, SERVER SIDE
 *
 * The four studio sources the collector reads. Every fact here
 * comes from something that already exists and already answers
 * honestly: probeAllServices(), detectOpa(), the scanner
 * binaries on disk, the engineering runtime probe, and the
 * orchestrator's registered backends.
 *
 * What this file deliberately does NOT do:
 *   • import AdapterRegistry or any adapter — intelligence is
 *     read-only and cannot execute;
 *   • invent a probe for a service that has none;
 *   • treat a repository's existence as an installed engine.
 * ==========================================================
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { detectOpa } from "./opa.ts";
import { probeAllServices } from "./services.ts";
import { integrationState } from "./state.ts";
import { OperationalCollector, OperationalPlanner, type StudioSource } from "../../src/core/operational-intelligence/index.ts";
import type {
  OperationalSnapshot,
  RawCapability,
  RawStudioPayload,
  StudioId,
} from "../../src/core/operational-intelligence/types.ts";
import type { OperationalPlan } from "../../src/core/operational-intelligence/planner.ts";

export interface IntelligenceOptions {
  workspaceRoot: string;
  /** Snapshot cache TTL. */
  ttlMs?: number;
  /**
   * This server's own origin, so the engineering API can be probed over
   * HTTP. Absent means "not probed", which is reported as such rather
   * than assumed reachable.
   */
  baseUrl?: string;
}

interface RuntimeProbe {
  available: boolean;
  runtime: string;
  workspace?: string;
  operations: string[];
  error?: string;
}

/**
 * Ask the engineering API which runtime is serving this app.
 *
 * A real request, with a 1.5s ceiling. It is not imported directly
 * because doing so pulls the browser-facing engineering modules into the
 * server typecheck graph, where they do not belong.
 */
async function probeEngineeringRuntime(baseUrl: string | undefined): Promise<RuntimeProbe> {
  if (!baseUrl) {
    return {
      available: false,
      runtime: "unknown",
      operations: [],
      error: "No base URL was supplied, so the engineering API was not probed.",
    };
  }
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/engineer/status`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = (await response.json()) as {
      ok?: boolean;
      runtime?: string | { name?: string };
      workspace?: string;
      operations?: string[];
    };
    const runtime = typeof body.runtime === "string" ? body.runtime : body.runtime?.name ?? "unknown";
    return {
      available: response.ok && body.ok !== false,
      runtime,
      ...(body.workspace ? { workspace: body.workspace } : {}),
      operations: Array.isArray(body.operations) ? body.operations : [],
    };
  } catch (error) {
    return {
      available: false,
      runtime: "unavailable",
      operations: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Scanner presence, by the same rule the security studio uses: an explicit path wins. */
function scannerPresence(workspaceRoot: string): { gitleaks: boolean; trivy: boolean; semgrep: boolean } {
  const present = (tool: string): boolean => {
    const explicit = process.env[`LELU_${tool.toUpperCase()}_BINARY`]?.trim();
    if (explicit) return existsSync(explicit);
    return [join(workspaceRoot, ".tools", tool), join(workspaceRoot, "node_modules", ".bin", tool)].some((candidate) =>
      existsSync(candidate),
    );
  };
  return { gitleaks: present("gitleaks"), trivy: present("trivy"), semgrep: present("semgrep") };
}

function capability(
  capabilityId: string,
  label: string,
  flags: Partial<Omit<RawCapability, "capabilityId" | "label">> & { detail: string },
): RawCapability {
  return {
    capabilityId,
    label,
    configured: flags.configured ?? false,
    available: flags.available ?? false,
    authorized: flags.authorized ?? false,
    selectable: flags.selectable ?? false,
    executable: flags.executable ?? false,
    verified: flags.verified ?? false,
    detail: flags.detail,
    provenance: flags.provenance ?? "local",
    source: flags.source ?? "plugins/integration/intelligence.ts",
  };
}

export function createSources(options: IntelligenceOptions): StudioSource[] {
  const { workspaceRoot } = options;

  const engineering: StudioSource = {
    studioId: "engineering",
    async read(): Promise<RawStudioPayload> {
      const at = Date.now();
      const services = await probeAllServices();
      const healthOf = (id: string) =>
        services.find((service) => service.id === id)?.health ?? {
          state: "not_configured" as const,
          detail: `No probe exists for "${id}".`,
        };
      const registered = new Set(integrationState.orchestrator.backends_().map((backend) => backend.id));
      const runtime = await probeEngineeringRuntime(options.baseUrl);

      const engine = (id: "openhands" | "opencode", name: string, env: string): RawCapability[] => {
        const health = healthOf(id);
        const configured = health.state !== "not_configured";
        const available = health.state === "healthy" || health.state === "degraded";
        return [
          capability(`engineering.${id}.runtime`, `${name} runtime`, {
            configured,
            available,
            detail: `${env}: ${configured ? "configured" : "unset"}. ${health.detail}`,
            provenance: configured ? (health.contacted ? "external" : "local") : "local",
            source: "GET /api/integration/engineering",
            verified: available,
          }),
          capability(`engineering.${id}.execute`, `${name} task execution`, {
            configured,
            available,
            authorized: registered.has(id),
            selectable: registered.has(id),
            executable: available && registered.has(id) && runtime.available,
            verified: false,
            detail: registered.has(id)
              ? `A ${id} backend is registered with the orchestrator.`
              : `No ${id} backend is registered with the orchestrator, so a task cannot be dispatched.`,
            provenance: configured ? "api" : "local",
            source: "GET /api/integration/engineering",
          }),
        ];
      };

      return {
        ok: true,
        readAt: at,
        capabilities: [
          ...engine("openhands", "OpenHands", "OPENHANDS_BASE_URL"),
          ...engine("opencode", "OpenCode", "OPENCODE_BASE_URL"),
          capability("engineering.workspace.runtime", "Whitelisted engineering runtime", {
            configured: true,
            available: runtime.available,
            authorized: true,
            selectable: runtime.available,
            executable: runtime.available,
            verified: runtime.available,
            detail: runtime.available
              ? `${runtime.runtime} runtime answered /api/engineer/status at ${runtime.workspace ?? "the workspace"}; operations: ${runtime.operations.join(", ") || "none reported"}`
              : `Engineering runtime not reachable: ${runtime.error ?? "the probe did not answer"}`,
            provenance: runtime.available ? "api" : "unavailable",
            source: "GET /api/engineer/status",
          }),
          capability("engineering.local.execute", "Local engineering execution", {
            configured: true,
            available: runtime.available,
            authorized: registered.has("local"),
            selectable: registered.has("local"),
            executable: runtime.available && registered.has("local"),
            verified: false,
            detail: registered.has("local")
              ? "Local backend registered; commands run through the whitelisted runtime."
              : "Runtime mounted but not registered as an orchestrator backend — no task can be dispatched.",
            provenance: "local",
          }),
        ],
        dependencies: ["engineering.workspace.runtime", "security.policy.opa"],
        evidence: [
          {
            id: "ev-engineering-source",
            source: "GET /api/integration/engineering + GET /api/engineer/status",
            provenance: "api",
            detail: `${services.length} service probes, ${registered.size} registered backend(s)`,
            at,
          },
        ],
        findings: registered.size === 0
          ? [
              {
                id: "no-backend",
                severity: "high",
                category: "availability",
                description: "No CodingBackend is registered with the orchestrator, so no engineering task can execute.",
                affectedCapability: "engineering.local.execute",
                remediation: "Register a CodingBackend (openhands, opencode or local) before planning execution.",
              },
            ]
          : [],
      };
    },
  };

  const voice: StudioSource = {
    studioId: "voice",
    async read(): Promise<RawStudioPayload> {
      const at = Date.now();
      const services = await probeAllServices();
      const healthOf = (id: string) =>
        services.find((service) => service.id === id)?.health ?? {
          state: "not_configured" as const,
          detail: `No probe exists for "${id}".`,
          contacted: false,
        };
      const whisper = healthOf("whisper");
      const kokoro = healthOf("kokoro");
      const whisperUp = whisper.state === "healthy" || whisper.state === "degraded";
      const kokoroUp = kokoro.state === "healthy" || kokoro.state === "degraded";

      return {
        ok: true,
        readAt: at,
        capabilities: [
          capability("voice.whisper.service", "Whisper recognition service", {
            configured: whisper.state !== "not_configured",
            available: whisperUp,
            detail: whisper.detail,
            provenance: whisperUp ? "external" : "local",
            source: "GET /api/integration/voice",
          }),
          capability("voice.kokoro.service", "Kokoro synthesis service", {
            configured: kokoro.state !== "not_configured",
            available: kokoroUp,
            detail: kokoro.detail,
            provenance: kokoroUp ? "external" : "local",
            source: "GET /api/integration/voice",
          }),
          capability("voice.audio.input", "Audio input device", {
            configured: false,
            available: false,
            detail: "No audio device can be inspected from a headless server runtime; nothing is claimed about a microphone.",
            provenance: "unavailable",
            source: "server runtime",
          }),
          capability("voice.audio.output", "Audio output device", {
            configured: false,
            available: false,
            detail: "No speaker can be inspected from a headless server runtime.",
            provenance: "unavailable",
            source: "server runtime",
          }),
          capability("voice.recognition.transcribe", "Speech recognition", {
            configured: whisper.state !== "not_configured",
            available: whisperUp,
            authorized: true,
            selectable: whisperUp,
            executable: false,
            detail: whisperUp
              ? "The recognition service answers, but no microphone is available, so a live transcription cannot be verified."
              : whisper.detail,
            provenance: whisperUp ? "external" : "local",
            source: "GET /api/integration/voice",
          }),
          capability("voice.synthesis.speak", "Speech synthesis", {
            configured: kokoro.state !== "not_configured",
            available: kokoroUp,
            authorized: true,
            selectable: kokoroUp,
            executable: false,
            detail: kokoroUp
              ? "The synthesis service answers; playback cannot be verified without an output device."
              : kokoro.detail,
            provenance: kokoroUp ? "external" : "local",
            source: "GET /api/integration/voice",
          }),
        ],
        dependencies: ["voice.whisper.service", "voice.kokoro.service"],
        evidence: [
          { id: "ev-voice-source", source: "GET /api/integration/voice", provenance: "api", detail: `whisper=${whisper.state}, kokoro=${kokoro.state}`, at },
        ],
      };
    },
  };

  const infrastructure: StudioSource = {
    studioId: "infrastructure",
    async read(): Promise<RawStudioPayload> {
      const at = Date.now();
      const services = await probeAllServices();
      const capabilities = services.map((service) =>
        capability(`infrastructure.${service.id}.service`, service.name, {
          configured: service.health.state !== "not_configured",
          available: service.health.state === "healthy" || service.health.state === "degraded",
          detail: service.health.detail,
          provenance: service.health.contacted ? "external" : "local",
          source: "GET /api/integration/status",
          verified: service.health.state === "healthy",
        }),
      );
      return {
        ok: true,
        readAt: at,
        capabilities,
        evidence: [
          { id: "ev-infrastructure-source", source: "GET /api/integration/status", provenance: "api", detail: `${services.length} services probed`, at },
        ],
        findings: services
          .filter((service) => service.health.state === "unavailable")
          .map((service) => ({
            id: `unavailable-${service.id}`,
            severity: "medium" as const,
            category: "availability" as const,
            description: `${service.name} is configured but did not answer: ${service.health.detail}`,
            affectedCapability: `infrastructure.${service.id}.service`,
            remediation: `Check the service behind ${service.env.join("/")}.`,
          })),
      };
    },
  };

  const security: StudioSource = {
    studioId: "security",
    async read(): Promise<RawStudioPayload> {
      const at = Date.now();
      const opa = await detectOpa(workspaceRoot);
      const binaries = scannerPresence(workspaceRoot);
      const lastScan = integrationState.lastScan();
      const scanCount = integrationState.scans_().length;
      const findings = lastScan?.results.reduce((total, result) => total + result.findings.length, 0) ?? 0;

      return {
        ok: true,
        readAt: at,
        capabilities: [
          capability("security.policy.opa", "Open Policy Agent", {
            configured: opa.available,
            available: opa.available,
            authorized: true,
            selectable: opa.available,
            executable: opa.available,
            verified: opa.available,
            detail: opa.available ? `${opa.version} at ${opa.policyDir}, fail-closed` : opa.detail,
            provenance: opa.available ? "local" : "unavailable",
            source: "detectOpa()",
          }),
          ...(["gitleaks", "semgrep", "trivy"] as const).map((tool) =>
            capability(`security.scanner.${tool}`, `${tool} scanner`, {
              configured: binaries[tool],
              available: binaries[tool],
              authorized: true,
              selectable: binaries[tool],
              executable: binaries[tool],
              verified: scanCount > 0,
              detail: binaries[tool]
                ? `${tool} found on disk; ${scanCount > 0 ? `last scan reported ${findings} finding(s)` : "no scan has run in this runtime"}`
                : `${tool} is not present at an explicit path, .tools/ or node_modules/.bin`,
              provenance: binaries[tool] ? "local" : "unavailable",
              source: "scannerPresence()",
            }),
          ),
          capability("security.audit.trail", "Policy decision audit trail", {
            configured: true,
            available: integrationState.audit_().length >= 0,
            authorized: true,
            selectable: true,
            executable: true,
            verified: integrationState.audit_().length > 0,
            detail: `${integrationState.decisions_().length} decision(s), ${integrationState.audit_().length} audit entr(ies) recorded in this process.`,
            provenance: "local",
            source: "integrationState.audit_()",
          }),
        ],
        evidence: [
          {
            id: "ev-security-source",
            source: "detectOpa() + scannerPresence() + integrationState",
            provenance: "local",
            detail: `opa=${opa.available ? "available" : "absent"}, scanners=${Object.entries(binaries).filter(([, present]) => present).length}/3, lastScan=${lastScan ? lastScan.gatePassed ? "PASS" : "FAIL" : "none"}`,
            at,
          },
        ],
        findings: lastScan
          ? lastScan.results
              .filter((result) => result.findings.length > 0)
              .map((result) => ({
                id: `scan-${result.scanner}`,
                severity: "high" as const,
                category: "security" as const,
                description: `${result.scanner} reported ${result.findings.length} finding(s); the gate ${lastScan.gatePassed ? "passed" : "failed"}.`,
                affectedCapability: "security.audit.trail",
                remediation: "Classify each finding; do not lower the threshold to make the gate green.",
              }))
          : [],
      };
    },
  };

  return [engineering, voice, infrastructure, security];
}

const collectors = new Map<string, OperationalCollector>();

function collectorFor(options: IntelligenceOptions): OperationalCollector {
  const key = options.workspaceRoot;
  const existing = collectors.get(key);
  if (existing) return existing;
  const created = new OperationalCollector(createSources(options), { ttlMs: options.ttlMs ?? 15_000 });
  collectors.set(key, created);
  return created;
}

/** Read all four studios. Cached for the TTL so this is never a polling loop. */
export async function collectOperationalSnapshot(
  options: IntelligenceOptions & { force?: boolean } = { workspaceRoot: process.cwd() },
): Promise<OperationalSnapshot> {
  return collectorFor(options).collect({ force: options.force === true });
}

const planner = new OperationalPlanner();

/** Build an activation plan from the current snapshot. Never executes. */
export async function planActivation(
  goal: string,
  options: IntelligenceOptions,
): Promise<{ plan: OperationalPlan; snapshot: OperationalSnapshot }> {
  const snapshot = await collectOperationalSnapshot(options);
  return { plan: planner.createActivationPlan(goal, snapshot), snapshot };
}

/** A capability explanation, deterministic and provider-free. */
export async function explainOperationalState(
  capabilityId: string,
  options: IntelligenceOptions,
): Promise<{ capabilityId: string; state: string; reasons: string[]; requirements: Array<{ required: string; state: string; reason: string }> }> {
  const snapshot = await collectOperationalSnapshot(options);
  const capability = snapshot.capabilities.find((item) => item.capabilityId === capabilityId);
  const requirements = snapshot.dependencies
    .filter((dependency) => dependency.dependentCapability === capabilityId)
    .map((dependency) => ({
      required: dependency.requiredCapability,
      state: dependency.state,
      reason: dependency.blockingReason ?? "satisfied",
    }));
  return {
    capabilityId,
    state: capability?.state ?? "NOT_REPORTED",
    reasons: capability ? capability.blockingReasons : ["no studio reported this capability"],
    requirements,
  };
}

export type { StudioId };
