/**
 * ==========================================================
 * LÉLU — OPERATIONAL SELF-MODEL
 *
 * Mission 14, Phase 1.
 *
 * There are already two different things in this codebase:
 *
 *   SelfModel            the persistent NARRATIVE (what she says
 *                        about herself, editable by the user)
 *   OperationalModel     whether one capability can run
 *
 * Neither answers the question this mission actually asks:
 * "Right now, from real sources, what is true about me, and HOW
 * WELL IS EACH CLAIM SUPPORTED?"
 *
 * This assembler answers that. It is deliberately NOT a store:
 * it owns no state, writes nothing, and recomputes from the
 * existing singletons every time. That is what keeps it from
 * becoming a fourth competing self-model.
 *
 * Each claim carries one Mission evidence label. If a source
 * cannot be read, the claim says UNAVAILABLE with the real
 * error — never a silently missing row, and never a fabricated
 * GREEN.
 * ==========================================================
 */

import SelfModel, { type SelfModelState } from "./SelfModel.ts";
import CapabilityManifest, { type CapabilityDef } from "../capabilities/CapabilityManifest.ts";
import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry.ts";
import AgentStore from "../agents/AgentStore.ts";
import ProjectStore, { type LeluProject } from "../projects/ProjectStore.ts";
import WorkspaceEngine from "../workspace/WorkspaceEngine.ts";
import AutonomyGate from "./AutonomyGate.ts";
import SystemEnvironment, { type SystemEnvironmentState } from "./SystemEnvironment.ts";
import { APPS } from "../../app/scene/genesis/home/homeCatalog.ts";
import MissionLedgerStore, { type MissionRecord } from "../projects/MissionLedger.ts";
import CognitivePulseStore, { type PulseEntry } from "./CognitivePulse.ts";
import {
  BrokerHealthStore,
  type BrokerHealthSnapshot,
  type BrokerProviderObservation,
} from "../model/ProviderHealth.ts";
import SkillRegistryStore, { type RuntimeSkill } from "../skills/SkillRegistry.ts";
import {
  countEvidence,
  evidenceClaim,
  type EvidenceClaim,
  type MissionEvidence,
} from "../operational-intelligence/evidence.ts";

/** Minimal structural source shapes, so tests can inject real fixtures. */
export interface SelfCapability {
  id: string;
  name: string;
  status: CapabilityDef["status"];
  providers: string[];
  lastSuccessful: number | null;
  error?: string;
}

export interface SelfTool {
  id: string;
  category: string;
  available: boolean;
  riskLevel: ToolDefinition["riskLevel"];
}

export interface SelfAgent {
  id: string;
  name: string;
  role: string;
  status: string;
}

export interface SelfProject {
  id: string;
  name: string;
  status: LeluProject["status"];
}

export interface SelfApplication {
  id: string;
  label: string;
  group: string;
}

export interface SelfWorkspace {
  views: Array<{ id: string; kind: string; title: string }>;
  focusId: string | null;
}

export interface SelfModelSources {
  self: () => SelfModelState;
  capabilities: () => SelfCapability[];
  tools: () => SelfTool[];
  agents: () => SelfAgent[];
  projects: () => SelfProject[];
  workspaces: () => SelfWorkspace;
  missions: () => MissionRecord[];
  pulse: () => PulseEntry[];
  providers: () => BrokerHealthSnapshot | null;
  skills: () => RuntimeSkill[];
  environment: () => SystemEnvironmentState;
  applications: () => SelfApplication[];
  autonomyLevel: () => number;
}

export interface OperationalSelfSnapshot {
  at: number;
  identity: {
    name: string;
    summary: string;
    evidence: MissionEvidence;
  };
  autonomyLevel: number | null;
  environment: {
    online: boolean | null;
    os: string | null;
    browser: string | null;
    storageQuotaBytes: number | null;
    webgl: boolean | null;
  };
  claims: EvidenceClaim[];
  counts: Record<MissionEvidence, number>;
  missions: Array<{
    id: string;
    title: string;
    status: MissionRecord["status"];
    evidence: MissionEvidence;
    nextSafeAction: string | null;
    openBlockers: number;
    durability: MissionRecord["durability"];
  }>;
  recentObservations: PulseEntry[];
  /** Sources that threw while being read. Empty means every read succeeded. */
  sourceFailures: Array<{ source: string; error: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultSources(): SelfModelSources {
  return {
    self: () => SelfModel.getInstance().get(),
    capabilities: () => CapabilityManifest.getInstance().getAll(),
    tools: () => ToolRegistry.getInstance().all(),
    agents: () => AgentStore.getInstance().list(),
    projects: () => ProjectStore.getInstance().list(),
    workspaces: () => WorkspaceEngine.getInstance().getState(),
    missions: () => MissionLedgerStore.getInstance().list(),
    pulse: () => CognitivePulseStore.getInstance().recent(20),
    providers: () => BrokerHealthStore.getInstance().get(),
    skills: () => SkillRegistryStore.getInstance().list(),
    environment: () => SystemEnvironment.getInstance().get(),
    applications: () => APPS.map((app) => ({ id: app.id, label: app.label, group: app.group })),
    autonomyLevel: () => AutonomyGate.getInstance().getLevel(),
  };
}

/** Conservative mapping from an existing capability status to evidence. */
function capabilityEvidence(capability: SelfCapability, now: number): MissionEvidence {
  if (capability.status === "unavailable") return "UNAVAILABLE";
  if (capability.status === "not_configured") return "BLOCKED";
  if (capability.status === "degraded") return "PARTIAL";
  // "available" is a declaration plus, at best, a past success.
  if (capability.lastSuccessful !== null && now - capability.lastSuccessful <= DAY_MS) return "VERIFIED";
  return "PARTIAL";
}

/** Evidence for one observed provider row. */
function providerEvidence(provider: BrokerProviderObservation): MissionEvidence {
  switch (provider.availability) {
    case "verified":
      return "VERIFIED";
    case "unverified":
      return "PARTIAL";
    case "failing":
      return "UNAVAILABLE";
    case "blocked":
      return "BLOCKED";
    default:
      return "UNAVAILABLE";
  }
}

function readSource<T>(
  name: string,
  reader: () => T,
  failures: Array<{ source: string; error: string }>,
): T | null {
  try {
    return reader();
  } catch (error) {
    failures.push({ source: name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Build one evidence-labelled snapshot from real sources.
 *
 * Every section is isolated: one broken source produces an
 * UNAVAILABLE claim and does not hide the rest of the system.
 */
export function assembleOperationalSelf(
  overrides: Partial<SelfModelSources> = {},
  at: number = Date.now(),
): OperationalSelfSnapshot {
  const sources: SelfModelSources = { ...defaultSources(), ...overrides };
  const failures: Array<{ source: string; error: string }> = [];
  const claims: EvidenceClaim[] = [];

  /* ------------------------------ identity ----------------------------- */
  const self = readSource("SelfModel", sources.self, failures);
  const identity = self?.identity ?? { name: "LÉLU", summary: "Identity source unreadable." };
  claims.push(
    evidenceClaim(
      "identity.self-model",
      `${identity.name}: ${identity.summary}`,
      self ? "REPORTED" : "UNAVAILABLE",
      "src/core/cognition/SelfModel.ts",
      at,
      self ? "Stored self-description; re-read this snapshot." : "The self-model could not be read.",
    ),
  );

  /* ---------------------------- capabilities --------------------------- */
  const capabilities = readSource("CapabilityManifest", sources.capabilities, failures);
  if (capabilities) {
    const healthy = capabilities.filter(
      (capability) => capability.status === "available" || capability.status === "degraded",
    );
    const blocked = capabilities.filter((capability) => capability.status === "not_configured");
    const absent = capabilities.filter((capability) => capability.status === "unavailable");
    const state: MissionEvidence =
      capabilities.length === 0
        ? "UNAVAILABLE"
        : blocked.length + absent.length === capabilities.length
          ? "UNAVAILABLE"
          : blocked.length > 0 || absent.length > 0
            ? "PARTIAL"
            : "PARTIAL";
    claims.push(
      evidenceClaim(
        "capabilities.manifest",
        `${healthy.length} of ${capabilities.length} declared capabilities are available or degraded; ` +
          `${blocked.length} need configuration and ${absent.length} are unavailable.`,
        state,
        "src/core/capabilities/CapabilityManifest.ts",
        at,
        "Declared status is not a live end-to-end probe; individual capabilities named below carry their own evidence.",
      ),
    );

    const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability]));
    const named: Array<{ id: string; label: string }> = [
      { id: "ai-chat", label: "AI provider chain" },
      { id: "long-term-memory", label: "Long-term memory" },
      { id: "short-term-memory", label: "Short-term memory" },
      { id: "agent-registry", label: "Agent registry" },
      { id: "executive-board", label: "Executive board" },
      { id: "task-engine", label: "Task engine" },
      { id: "cosmos-navigation", label: "Cosmos navigation" },
      { id: "engineering-sandbox", label: "Engineering sandbox" },
    ];
    for (const item of named) {
      const capability = capabilityById.get(item.id);
      if (!capability) {
        claims.push(
          evidenceClaim(
            `capability.${item.id}`,
            `${item.label} was not reported by the capability manifest.`,
            "UNAVAILABLE",
            "src/core/capabilities/CapabilityManifest.ts",
            at,
          ),
        );
        continue;
      }
      claims.push(
        evidenceClaim(
          `capability.${item.id}`,
          `${item.label} is ${capability.status}` +
            (capability.providers.length > 0 ? ` (via ${capability.providers.join(", ")})` : ""),
          capabilityEvidence(capability, at),
          "src/core/capabilities/CapabilityManifest.ts",
          at,
          capability.error,
        ),
      );
    }
  } else {
    claims.push(
      evidenceClaim(
        "capabilities.manifest",
        "The capability manifest could not be read.",
        "UNAVAILABLE",
        "src/core/capabilities/CapabilityManifest.ts",
        at,
      ),
    );
  }

  /* ------------------------------ providers ---------------------------- */
  // A configured key, a registered provider and a working provider are three
  // different facts. Only the broker's observed 2xx is allowed to reach
  // VERIFIED; everything else stays partial, failing or blocked.
  const providers = readSource("ProviderHealth", sources.providers, failures);
  if (providers && providers.providers.length > 0) {
    const configured = providers.providers.filter((provider) => provider.configured);
    const verified = configured.filter((provider) => provider.availability === "verified");
    const failing = configured.filter((provider) => provider.availability === "failing");
    claims.push(
      evidenceClaim(
        "providers.health",
        `${verified.length} of ${configured.length} configured provider(s) have an observed successful completion; ` +
          `${failing.length} are currently failing. Last probe: ${new Date(providers.at).toISOString()}.`,
        providers.probeError ? "UNAVAILABLE" : "PARTIAL",
        `GET ${providers.endpoint}`,
        providers.at,
        providers.probeError
          ? `The health probe itself failed (${providers.probeError}). Rows below are the last real observation, not a fresh one.`
          : "A provider is VERIFIED only from an observed 2xx completion, never from a configured key.",
      ),
    );
    for (const provider of providers.providers) {
      claims.push(
        evidenceClaim(
          `provider.${provider.id}`,
          `${provider.id}: ${provider.availability} (${provider.state}); ` +
            `last success ${provider.lastSuccessAt ? new Date(provider.lastSuccessAt).toISOString() : "never observed"}` +
            (provider.lastFailureAt
              ? `; last failure ${new Date(provider.lastFailureAt).toISOString()}` +
                `${provider.lastFailureStatus ? ` HTTP ${provider.lastFailureStatus}` : ""}` +
                `${provider.lastFailureNote ? ` — ${provider.lastFailureNote}` : ""}`
              : "; no failure observed") +
            `.`,
          providerEvidence(provider),
          `GET ${providers.endpoint}`,
          provider.observedAt,
          `Observed at ${new Date(provider.observedAt).toISOString()}; server availability=${provider.available}; configured=${provider.configured}.`,
        ),
      );
    }
  } else {
    claims.push(
      evidenceClaim(
        "providers.health",
        providers
          ? `No provider health observation exists${providers.probeError ? `: ${providers.probeError}` : ""}.`
          : "Provider health has not been probed in this runtime.",
        "UNAVAILABLE",
        "src/core/model/ProviderHealth.ts → GET /api/model/status",
        providers?.at ?? at,
        "Configuration is not a working-provider claim; nothing is asserted until the broker answers.",
      ),
    );
  }

  /* -------------------------------- tools ------------------------------ */
  const tools = readSource("ToolRegistry", sources.tools, failures);
  if (tools) {
    const available = tools.filter((tool) => tool.available);
    claims.push(
      evidenceClaim(
        "tools.registry",
        `${available.length} of ${tools.length} registered tools are marked available. ` +
          `Registration is not execution; only tool calls recorded in the pulse count as run.`,
        tools.length === 0 ? "UNAVAILABLE" : "PARTIAL",
        "src/core/tools/ToolRegistry.ts",
        at,
      ),
    );
    const byCategory = new Map<string, { total: number; available: number }>();
    for (const tool of tools) {
      const entry = byCategory.get(tool.category) ?? { total: 0, available: 0 };
      entry.total += 1;
      if (tool.available) entry.available += 1;
      byCategory.set(tool.category, entry);
    }
    for (const [category, counts] of [...byCategory.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)) {
      claims.push(
        evidenceClaim(
          `tools.${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          `${category}: ${counts.available}/${counts.total} tools available`,
          counts.available > 0 ? "PARTIAL" : "UNAVAILABLE",
          "src/core/tools/ToolRegistry.ts",
          at,
        ),
      );
    }
  } else {
    claims.push(evidenceClaim("tools.registry", "The tool registry could not be read.", "UNAVAILABLE", "src/core/tools/ToolRegistry.ts", at));
  }

  /* -------------------------------- skills ----------------------------- */
  const skills = readSource("SkillRegistry", sources.skills, failures);
  if (skills && skills.length > 0) {
    const invocable = skills.filter((skill) => skill.invocable);
    claims.push(
      evidenceClaim(
        "skills.registry",
        `${skills.length} runtime skill(s) catalogued from .agents/skills; ${invocable.length} invocable. ` +
          `Catalogue: ${skills.map((skill) => skill.name).join(", ")}.`,
        "PARTIAL",
        "src/core/skills/SkillRegistry.ts → .agents/skills",
        at,
        "A skill body is authoring guidance, not a dispatcher executor. The catalogue is real; invocation is not offered.",
      ),
    );
  } else {
    claims.push(
      evidenceClaim(
        "skills.registry",
        "No runtime skill registry is exposed to cognition. Authoring-time skills exist under .agents/skills, " +
          "but they are not discoverable or invocable by LÉLU at runtime.",
        "UNAVAILABLE",
        ".agents/skills + skills-lock.json",
        at,
        "This is a real gap, not a configured skill system. Capabilities and skills are not the same thing.",
      ),
    );
  }

  /* ------------------------------- agents ------------------------------ */
  const agents = readSource("AgentStore", sources.agents, failures);
  if (agents) {
    const active = agents.filter((agent) => agent.status === "active" || agent.status === "running");
    claims.push(
      evidenceClaim(
        "agents.registry",
        `${agents.length} agent(s) stored; ${active.length} currently active or running.`,
        agents.length === 0 ? "UNAVAILABLE" : "PARTIAL",
        "src/core/agents/AgentStore.ts",
        at,
        agents.length > 0 ? agents.slice(0, 6).map((agent) => `${agent.name} (${agent.role})`).join(", ") : undefined,
      ),
    );
  } else {
    claims.push(evidenceClaim("agents.registry", "The agent store could not be read.", "UNAVAILABLE", "src/core/agents/AgentStore.ts", at));
  }

  /* --------------------------- applications ---------------------------- */
  const applications = readSource("ApplicationCatalog", sources.applications, failures);
  claims.push(
    evidenceClaim(
      "applications.catalog",
      applications
        ? `${applications.length} applications are catalogued in the home (${new Set(applications.map((app) => app.group)).size} groups). ` +
            "A catalog entry means the panel is registered, not that every workflow inside it has been exercised."
        : "The application catalog could not be read.",
      applications && applications.length > 0 ? "REPORTED" : "UNAVAILABLE",
      "src/app/scene/genesis/home/homeCatalog.ts",
      at,
    ),
  );

  /* ----------------------------- workspaces ---------------------------- */
  const workspace = readSource("WorkspaceEngine", sources.workspaces, failures);
  if (workspace) {
    const views = workspace.views;
    claims.push(
      evidenceClaim(
        "workspace.runtime",
        views.length === 0
          ? "The workspace runtime is present; no panes are open in this snapshot."
          : `${views.length} workspace pane(s) are open: ${views.slice(0, 6).map((view) => view.title).join(", ")}.`,
        "VERIFIED",
        "src/core/workspace/WorkspaceEngine.ts",
        at,
        "Read directly from the live workspace state.",
      ),
    );
  } else {
    claims.push(evidenceClaim("workspace.runtime", "The workspace engine could not be read.", "UNAVAILABLE", "src/core/workspace/WorkspaceEngine.ts", at));
  }

  /* ------------------------------ projects ----------------------------- */
  const projects = readSource("ProjectStore", sources.projects, failures);
  if (projects) {
    const active = projects.filter((project) => project.status === "active");
    claims.push(
      evidenceClaim(
        "projects.store",
        `${projects.length} project(s) stored; ${active.length} active.`,
        projects.length === 0 ? "UNAVAILABLE" : "VERIFIED",
        "src/core/projects/ProjectStore.ts",
        at,
        active.length > 0 ? active.slice(0, 6).map((project) => project.name).join(", ") : undefined,
      ),
    );
  } else {
    claims.push(evidenceClaim("projects.store", "The project store could not be read.", "UNAVAILABLE", "src/core/projects/ProjectStore.ts", at));
  }

  /* --------------------------- runtime facts --------------------------- */
  const environment = readSource("SystemEnvironment", sources.environment, failures);
  const autonomyLevel = readSource("AutonomyGate", sources.autonomyLevel, failures);
  claims.push(
    evidenceClaim(
      "runtime.environment",
      environment
        ? `${environment.os} / ${environment.browser}; ${environment.online ? "online" : "offline"}; ` +
            `${environment.cpuCores ?? "unknown"} cores; WebGL ${environment.gpu.webgl ? "present" : "absent"}; ` +
            `storage quota ${environment.storage?.quotaBytes ?? "unknown"} bytes.`
        : "The environment model could not be read.",
      environment ? "VERIFIED" : "UNAVAILABLE",
      "src/core/cognition/SystemEnvironment.ts",
      at,
      environment ? "Collected from browser APIs; null means the browser did not expose it." : undefined,
    ),
  );
  claims.push(
    evidenceClaim(
      "permissions.autonomy",
      autonomyLevel === null
        ? "The autonomy gate could not be read."
        : `Autonomy is at L${autonomyLevel}; actions above it require approval or are refused.`,
      autonomyLevel === null ? "UNAVAILABLE" : "VERIFIED",
      "src/core/cognition/AutonomyGate.ts",
      at,
    ),
  );

  /* --------------------------- memory/intent --------------------------- */
  if (self) {
    const goals = self.goals.slice(0, 5);
    const unfinished = self.unfinished.slice(0, 8);
    claims.push(
      evidenceClaim(
        "intentions.goals",
        goals.length === 0 ? "No active goals are recorded." : `Active goals: ${goals.join(" · ")}`,
        goals.length === 0 ? "UNAVAILABLE" : "REPORTED",
        "src/core/cognition/SelfModel.ts → goals",
        at,
      ),
    );
    claims.push(
      evidenceClaim(
        "intentions.unfinished",
        unfinished.length === 0 ? "No unfinished work is recorded." : `Unfinished: ${unfinished.join(" · ")}`,
        unfinished.length === 0 ? "UNAVAILABLE" : "REPORTED",
        "src/core/cognition/SelfModel.ts → unfinished",
        at,
      ),
    );

    for (const limitation of self.limitations.slice(0, 6)) {
      claims.push(
        evidenceClaim(
          `limitation.${claims.length}`,
          limitation,
          "UNAVAILABLE",
          "src/core/cognition/SelfModel.ts → limitations",
          at,
          "Reported by the self-model as a known limitation.",
        ),
      );
    }
    for (const hypothesis of self.hypotheses.slice(0, 5)) {
      claims.push(
        evidenceClaim(`hypothesis.${claims.length}`, hypothesis, "PROPOSED", "src/core/cognition/SelfModel.ts → hypotheses", at),
      );
    }
  }

  /* ----------------------------- missions ------------------------------ */
  const missions = readSource("MissionLedger", sources.missions, failures) ?? [];
  const openMissions = missions.filter(
    (mission) => mission.status !== "completed" && mission.status !== "abandoned",
  );
  const openBlockers = openMissions.flatMap((mission) =>
    mission.blockers.filter((blocker) => blocker.clearedAt === undefined),
  );
  claims.push(
    evidenceClaim(
      "missions.continuity",
      missions.length === 0
        ? "No mission continuity records exist yet; open work would be lost between sessions."
        : `${openMissions.length} open workstream(s) in the continuity ledger, ${openBlockers.length} open blocker(s).`,
      missions.length === 0 ? "UNAVAILABLE" : "VERIFIED",
      "src/core/projects/MissionLedger.ts",
      at,
      missions.length === 0
        ? "The ledger is readable; it is simply empty. This is an absence, not a failure."
        : undefined,
    ),
  );
  for (const mission of openMissions.slice(0, 6)) {
    claims.push(
      evidenceClaim(
        `mission.${mission.id}`,
        `${mission.title} — ${mission.status}; next safe action: ${mission.nextSafeAction ?? "none recorded"}`,
        mission.evidence,
        "src/core/projects/MissionLedger.ts",
        at,
        mission.objective || undefined,
      ),
    );
  }

  /* ------------------------------- pulse ------------------------------- */
  const pulse = readSource("CognitivePulse", sources.pulse, failures) ?? [];
  if (pulse.length === 0) {
    claims.push(
      evidenceClaim(
        "observations.pulse",
        "No meaningful runtime events have been observed by the cognitive pulse yet.",
        "UNAVAILABLE",
        "src/core/cognition/CognitivePulse.ts",
        at,
      ),
    );
  } else {
    const failuresInPulse = pulse.filter((entry) => entry.kind === "failure" || entry.kind === "degradation");
    claims.push(
      evidenceClaim(
        "observations.pulse",
        `${pulse.length} recent event(s); ${failuresInPulse.length} failure/degradation record(s). Latest: ${pulse[0]?.summary ?? "none"}`,
        failuresInPulse.length > 0 ? "PARTIAL" : "REPORTED",
        "src/core/cognition/CognitivePulse.ts",
        at,
      ),
    );
    for (const entry of failuresInPulse.slice(0, 4)) {
      claims.push(
        evidenceClaim(
          `observation.${entry.id}`,
          entry.summary,
          entry.severity === "critical" ? "BLOCKED" : "PARTIAL",
          "src/core/cognition/CognitivePulse.ts",
          at,
          `${entry.kind} observed at ${new Date(entry.at).toISOString()}`,
        ),
      );
    }
  }

  for (const failure of failures) {
    claims.push(
      evidenceClaim(
        `source.${failure.source.toLowerCase()}`,
        `The ${failure.source} source could not be read: ${failure.error}`,
        "UNAVAILABLE",
        failure.source,
        at,
        "Nothing is claimed about this subsystem; it was not observable.",
      ),
    );
  }

  return {
    at,
    identity: {
      name: identity.name,
      summary: identity.summary,
      evidence: self ? "REPORTED" : "UNAVAILABLE",
    },
    autonomyLevel,
    environment: environment
      ? {
          online: environment.online,
          os: environment.os,
          browser: environment.browser,
          storageQuotaBytes: environment.storage?.quotaBytes ?? null,
          webgl: environment.gpu.webgl,
        }
      : { online: null, os: null, browser: null, storageQuotaBytes: null, webgl: null },
    claims,
    counts: countEvidence(claims),
    missions: openMissions.slice(0, 12).map((mission) => ({
      id: mission.id,
      title: mission.title,
      status: mission.status,
      evidence: mission.evidence,
      nextSafeAction: mission.nextSafeAction,
      openBlockers: mission.blockers.filter((blocker) => blocker.clearedAt === undefined).length,
      durability: mission.durability,
    })),
    recentObservations: pulse.slice(0, 8),
    sourceFailures: failures,
  };
}

/** A compact, prompt-safe rendering. Detail stays in the claims. */
export function formatOperationalSelf(snapshot: OperationalSelfSnapshot, maxClaims = 28): string {
  const c = snapshot.counts;
  const lines = [
    `OPERATIONAL SELF — ${snapshot.identity.name} at ${new Date(snapshot.at).toISOString()}`,
    `evidence: ${c.VERIFIED} verified · ${c.REPORTED} reported · ${c.PARTIAL} partial · ` +
      `${c.BLOCKED} blocked · ${c.UNAVAILABLE} unavailable · ${c.PROPOSED} proposed · ${c.SIMULATED} simulated`,
    `autonomy: ${snapshot.autonomyLevel === null ? "unreadable" : `L${snapshot.autonomyLevel}`} · ` +
      `network: ${snapshot.environment.online === null ? "unknown" : snapshot.environment.online ? "online" : "offline"}`,
    "CLAIMS:",
    ...snapshot.claims.slice(0, maxClaims).map((claim) => `  [${claim.state}] ${claim.statement}`),
  ];
  if (snapshot.claims.length > maxClaims) {
    lines.push(`  … ${snapshot.claims.length - maxClaims} more claim(s) not shown.`);
  }
  if (snapshot.missions.length > 0) {
    lines.push("OPEN WORKSTREAMS:");
    for (const mission of snapshot.missions) {
      lines.push(
        `  [${mission.status.toUpperCase()} · ${mission.evidence}] ${mission.title} — next: ${mission.nextSafeAction ?? "none recorded"}`,
      );
    }
  }
  if (snapshot.sourceFailures.length > 0) {
    lines.push(`UNREADABLE SOURCES: ${snapshot.sourceFailures.map((failure) => failure.source).join(", ")}`);
  }
  return lines.join("\n");
}

let instance: OperationalSelfModel | null = null;

/** A thin facade over the pure assembler, with an injectable source map. */
export class OperationalSelfModel {
  private sources: Partial<SelfModelSources>;

  constructor(sources: Partial<SelfModelSources> = {}) {
    this.sources = sources;
  }

  public snapshot(at: number = Date.now()): OperationalSelfSnapshot {
    return assembleOperationalSelf(this.sources, at);
  }

  public report(at: number = Date.now()): string {
    return formatOperationalSelf(this.snapshot(at));
  }

  /** Replace one source (used by integration tests and future adapters). */
  public use(source: Partial<SelfModelSources>): void {
    this.sources = { ...this.sources, ...source };
  }

  public static getInstance(): OperationalSelfModel {
    if (!instance) instance = new OperationalSelfModel();
    return instance;
  }

  public static setForTests(model: OperationalSelfModel | null): void {
    instance = model;
  }
}

export default OperationalSelfModel;
