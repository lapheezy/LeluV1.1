/**
 * ==========================================================
 * LÉLU
 * STUDY AGENT ROUTER — which of her existing agents/tools
 * actually answers this question
 *
 * A knowledge gap is not one generic model call. Each kind of
 * question has a system inside LÉLU that can genuinely answer
 * it, and the router picks it:
 *
 *   architecture question → ArchitectureMap  (Engineering Agent)
 *   source investigation  → SourceAccess     (Engineering Agent)
 *   external research     → knowledge providers (Researcher)
 *   memory question       → Brain recall     (LÉLU herself)
 *   testing question      → SelfTestRunner / real `bun test`
 *   runtime question      → engineering runtime + provider status
 *   capability question   → CapabilityRegistry + CapabilityManifest
 *
 * Every route returns EVIDENCE — concrete observations from real
 * state — back to central cognition, which is what evaluates it.
 * The router never decides what was learned; it only gathers.
 *
 * Agents come from the ONE AgentStore the Agents panel uses; the
 * router never invents an agent, and reports honestly when the
 * expected one is missing or disabled.
 * ==========================================================
 */

import AIService from "../AIService";
import AgentStore from "../agents/AgentStore";
import ArchitectureMap from "../selfdev/ArchitectureMap";
import CapabilityRegistry from "../selfdev/CapabilityRegistry";
import CapabilityManifest from "../capabilities/CapabilityManifest";
import SelfTestRunner from "../selfdev/SelfTestRunner";
import SelfDiagnostics from "../selfdev/SelfDiagnostics";
import SourceAccess, { type SourceOrigin } from "../selfdev/SourceAccess";
import AutonomyGate from "./AutonomyGate";
import type { KnowledgeResult } from "../../providers/Provider";
import type { StudyDomain, StudyObjective } from "./StudyObjectives";

export interface Investigation {
  ok: boolean;
  /** The existing agent that owns this kind of work, when there is one. */
  agentId: string | null;
  agentName: string;
  /** The concrete tool/system that produced the evidence. */
  tool: string;
  /** For source/runtime work: development runtime vs static snapshot. */
  origin: SourceOrigin | "none";
  /** Real observations, one per line, for cognition to evaluate. */
  evidence: string[];
  /** Short factual summary of what the tool did. */
  summary: string;
  /** Concrete follow-up targets the tool noticed (files, subsystems, …). */
  leads: string[];
  error?: string;
}

/** Agent names, in preference order, for each kind of question. */
const AGENT_FOR_DOMAIN: Record<StudyDomain, string[]> = {
  architecture: ["Engineering Agent", "Builder"],
  source: ["Engineering Agent", "Builder"],
  research: ["Researcher"],
  memory: [],
  testing: ["Engineering Agent", "Builder"],
  runtime: ["Engineering Agent"],
  capability: ["Engineering Agent", "Builder"],
};

const RESEARCH_TIMEOUT_MS = 6_000;
/**
 * A knowledge provider that just failed is skipped for this long. The AI
 * provider registry already quarantines failures this way; the knowledge
 * chain had no such memory, so every cognitive cycle paid the full
 * timeout again for the same dead endpoint.
 */
const PROVIDER_COOLDOWN_MS = 120_000;
/** Knowledge providers tried per research objective before giving up. */
const MAX_RESEARCH_PROVIDERS = 6;
/**
 * Total wall-clock budget for one research objective. Without it, six
 * unreachable providers at eight seconds each would hold a cognitive
 * cycle for the better part of a minute; the remaining providers are
 * recorded as untried rather than silently dropped.
 */
const RESEARCH_BUDGET_MS = 20_000;

export default class StudyAgentRouter {
  private static instance: StudyAgentRouter | null = null;

  /** provider name → time until which it is skipped after failing. */
  private readonly researchCooldowns = new Map<string, number>();

  private constructor() {}

  public static getInstance(): StudyAgentRouter {
    if (!StudyAgentRouter.instance) {
      StudyAgentRouter.instance = new StudyAgentRouter();
    }
    return StudyAgentRouter.instance;
  }

  /** The existing agent that owns this domain, or null when none does. */
  public agentFor(domain: StudyDomain): { id: string; name: string } | null {
    const wanted = AGENT_FOR_DOMAIN[domain];
    if (!wanted || wanted.length === 0) return null;
    try {
      const agents = AgentStore.getInstance()
        .list()
        .filter((agent) => agent.status !== "archived" && agent.enabled);
      for (const name of wanted) {
        const agent = agents.find((candidate) => candidate.name === name);
        if (agent) return { id: agent.id, name: agent.name };
      }
    } catch {
      // A missing agent store is reported as "no agent", never a crash.
    }
    return null;
  }

  /** Run the investigation this objective calls for. Never throws. */
  public async investigate(objective: StudyObjective): Promise<Investigation> {
    const agent = this.agentFor(objective.domain);
    const base = {
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? "LÉLU (direct)",
    };

    try {
      switch (objective.domain) {
        case "architecture":
          return { ...base, ...(await this.investigateArchitecture(objective)) };
        case "source":
          return { ...base, ...(await this.investigateSource(objective)) };
        case "research":
          return { ...base, ...(await this.investigateResearch(objective)) };
        case "memory":
          return { ...base, ...(await this.investigateMemory(objective)) };
        case "testing":
          return { ...base, ...(await this.investigateTesting()) };
        case "runtime":
          return { ...base, ...(await this.investigateRuntime()) };
        case "capability":
          return { ...base, ...(await this.investigateCapability(objective)) };
      }
    } catch (error) {
      return {
        ...base,
        ok: false,
        tool: objective.domain,
        origin: "none",
        evidence: [],
        leads: [],
        summary: "The investigation could not be completed.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /* --------------------------- architecture --------------------------- */

  private async investigateArchitecture(
    objective: StudyObjective,
  ): Promise<Omit<Investigation, "agentId" | "agentName">> {
    const map = ArchitectureMap.getInstance();
    const subsystem =
      (objective.target ? map.get(objective.target) : undefined) ??
      map.list().find((item) => objective.question.toLowerCase().includes(item.name.toLowerCase()));

    if (!subsystem) {
      const snapshot = map.snapshot();
      return {
        ok: snapshot.subsystems.length > 0,
        tool: "architecture-map",
        origin: "none",
        evidence: snapshot.subsystems.map(
          (item) => `${item.id} — ${item.name}: ${item.status}, ${item.files.length} file(s), provides [${item.provides.join(", ") || "—"}]`,
        ),
        leads: snapshot.subsystems.filter((item) => item.status !== "working").map((item) => item.id),
        summary: `Architecture map: ${snapshot.subsystems.length} subsystem(s) across ${snapshot.totalSourceFiles} source file(s).`,
      };
    }

    const dependents = map.dependentsOf(subsystem.id);
    return {
      ok: true,
      tool: "architecture-map",
      origin: "none",
      evidence: [
        `${subsystem.name} (${subsystem.id}) — kind ${subsystem.kind}, status ${subsystem.status}.`,
        `Description: ${subsystem.description}`,
        `Files (${subsystem.files.length}): ${subsystem.files.slice(0, 12).join(", ")}${subsystem.files.length > 12 ? ", …" : ""}`,
        `Depends on: ${subsystem.dependsOn.join(", ") || "nothing"}.`,
        `Depended on by: ${dependents.map((item) => item.id).join(", ") || "nothing"}.`,
        `Provides capabilities: ${subsystem.provides.join(", ") || "none declared"}.`,
      ],
      // The subsystem's own files are the next things worth reading.
      leads: subsystem.files.slice(0, 6),
      summary: `Inspected subsystem “${subsystem.name}”: ${subsystem.status}, ${subsystem.files.length} file(s).`,
    };
  }

  /* ------------------------------ source ------------------------------ */

  private async investigateSource(
    objective: StudyObjective,
  ): Promise<Omit<Investigation, "agentId" | "agentName">> {
    const access = SourceAccess.getInstance();
    const status = await access.status();
    // Only a real path can be read. Anything else (a prose title, a
    // subsystem name) would produce a guaranteed-failed read, so it is
    // treated as "no specific file" and answered by listing instead.
    const target = objective.target && /\.[a-z]+$/i.test(objective.target) ? objective.target : undefined;

    if (!target) {
      const listing = await access.list("src/core");
      return {
        ok: listing.entries.length > 0,
        tool: "source-list",
        origin: listing.origin,
        evidence: [
          access.describe(status),
          `src/core contains ${listing.entries.length} entr(y/ies): ${listing.entries.slice(0, 20).map((entry) => entry.name).join(", ")}`,
        ],
        leads: listing.entries.filter((entry) => entry.type === "file").map((entry) => entry.path).slice(0, 6),
        summary: `Listed src/core from the ${listing.origin === "development-runtime" ? "REAL DEVELOPMENT RUNTIME" : "STATIC SNAPSHOT"}.`,
      };
    }

    const read = await access.read(target);
    if (read.content === null) {
      return {
        ok: false,
        tool: "source-read",
        origin: read.origin,
        evidence: [access.describe(status)],
        leads: [],
        summary: `Could not read ${target}.`,
        error: read.error,
      };
    }

    const facts = this.describeSource(target, read.content);
    return {
      ok: true,
      tool: "source-read",
      origin: read.origin,
      evidence: [
        read.origin === "development-runtime"
          ? `Read ${target} from the REAL DEVELOPMENT RUNTIME (${read.runtime}) — this is the file on disk right now.`
          : `Read ${target} from the STATIC SNAPSHOT — build-time content, may be behind the working tree.`,
        ...facts.evidence,
      ],
      leads: facts.imports.slice(0, 6),
      summary: `Read ${target} (${read.content.length} bytes) from the ${read.origin === "development-runtime" ? "development runtime" : "static snapshot"}.`,
    };
  }

  /** Structural facts about a source file — real parsing, not a summary. */
  private describeSource(path: string, content: string): { evidence: string[]; imports: string[] } {
    const lines = content.split("\n");
    const imports = [
      ...content.matchAll(/^\s*import\s+(?:type\s+)?[^"']*from\s+["']([^"']+)["']/gm),
    ]
      .map((match) => match[1])
      .filter((specifier) => specifier.startsWith("."));
    const exports = [
      ...content.matchAll(/^\s*export\s+(?:default\s+)?(?:abstract\s+)?(class|function|interface|type|const)\s+([A-Za-z0-9_]+)/gm),
    ].map((match) => `${match[1]} ${match[2]}`);
    const publicMethods = [
      ...content.matchAll(/^\s{2}public\s+(?:async\s+)?([A-Za-z0-9_]+)\s*[(<]/gm),
    ].map((match) => match[1]);
    const todos = lines.filter((line) => /\b(TODO|FIXME|HACK|not implemented)\b/i.test(line));

    return {
      evidence: [
        `${path}: ${lines.length} line(s).`,
        `Exports: ${exports.join(", ") || "none detected"}.`,
        `Public methods: ${publicMethods.join(", ") || "none detected"}.`,
        `Local imports: ${imports.join(", ") || "none"}.`,
        todos.length > 0
          ? `Unfinished markers (${todos.length}): ${todos.slice(0, 3).map((line) => line.trim().slice(0, 90)).join(" | ")}`
          : "No unfinished markers found.",
      ],
      imports: imports.map((specifier) => this.resolveRelative(path, specifier)),
    };
  }

  private resolveRelative(fromPath: string, specifier: string): string {
    const segments = fromPath.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") segments.pop();
      else segments.push(part);
    }
    const joined = segments.join("/");
    return /\.[a-z]+$/.test(joined) ? joined : `${joined}.ts`;
  }

  /* ----------------------------- research ----------------------------- */

  private async investigateResearch(
    objective: StudyObjective,
  ): Promise<Omit<Investigation, "agentId" | "agentName">> {
    const registry = AIService.getInstance().getKnowledgeProviderRegistry();
    const query = objective.target || objective.question;

    const candidates = registry
      .all()
      .filter(
        (provider) =>
          provider.enabled &&
          provider.capabilities.some(
            (capability) =>
              capability === "knowledge" || capability === "news" || capability === "encyclopedia" || capability === "research",
          ),
      )
      .sort((a, b) => b.priority - a.priority)
      .slice(0, MAX_RESEARCH_PROVIDERS);

    const evidence: string[] = [];
    const attempted: string[] = [];
    let results: KnowledgeResult[] = [];
    let usedProvider = "";

    // Walk the whole chain: a provider failing is a fact to record, not
    // a reason to abandon the question.
    const deadline = Date.now() + RESEARCH_BUDGET_MS;
    const untried: string[] = [];
    const cooling: string[] = [];
    for (const provider of candidates) {
      if (provider.canSearch && !provider.canSearch(query)) continue;

      const coolUntil = this.researchCooldowns.get(provider.name) ?? 0;
      if (Date.now() < coolUntil) {
        cooling.push(provider.name);
        continue;
      }
      if (Date.now() >= deadline) {
        untried.push(provider.name);
        continue;
      }

      attempted.push(provider.name);
      try {
        const found = await Promise.race([
          provider.search(query),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), RESEARCH_TIMEOUT_MS),
          ),
        ]);
        this.researchCooldowns.delete(provider.name);
        if (Array.isArray(found) && found.length > 0) {
          results = found;
          usedProvider = provider.name;
          break;
        }
        evidence.push(`${provider.name}: no results.`);
      } catch (error) {
        // Remember the failure so the next cycle does not pay for it again.
        this.researchCooldowns.set(provider.name, Date.now() + PROVIDER_COOLDOWN_MS);
        evidence.push(`${provider.name} failed: ${error instanceof Error ? error.message : String(error)}.`);
      }
    }

    if (cooling.length > 0) {
      evidence.push(`Skipped during failure cooldown: ${cooling.join(", ")}.`);
    }

    if (untried.length > 0) {
      evidence.push(
        `Research budget of ${RESEARCH_BUDGET_MS / 1000}s was spent before reaching: ${untried.join(", ")}.`,
      );
    }

    if (results.length === 0) {
      return {
        ok: false,
        tool: "knowledge-providers",
        origin: "none",
        evidence,
        leads: [],
        summary:
          attempted.length === 0
            ? "No knowledge provider was able to take this query."
            : `Tried ${attempted.length} provider(s) (${attempted.join(", ")}) — none returned results${
                untried.length > 0 ? `; ${untried.length} not reached within the time budget` : ""
              }.`,
        error: "no-research-results",
      };
    }

    for (const result of results.slice(0, 5)) {
      evidence.push(
        `${usedProvider} — ${result.title}: ${(result.content ?? "").replace(/\s+/g, " ").slice(0, 240)}${result.url ? ` (${result.url})` : ""}`,
      );
    }

    return {
      ok: true,
      tool: "knowledge-providers",
      origin: "none",
      evidence,
      leads: results.slice(0, 3).map((result) => result.title),
      summary: `${usedProvider} returned ${results.length} result(s) for “${query}” (tried: ${attempted.join(", ")}).`,
    };
  }

  /* ------------------------------ memory ------------------------------ */

  private async investigateMemory(
    objective: StudyObjective,
  ): Promise<Omit<Investigation, "agentId" | "agentName">> {
    const ai = AIService.getInstance();
    const recalled = await ai.recall(objective.target || objective.question);
    const recent = await ai.getMemories(40);

    const evidence = recalled
      .slice(0, 6)
      .map((memory) => `recall (${memory.confidence.toFixed(2)}): ${memory.prompt} → ${memory.response.slice(0, 200)}`);

    if (evidence.length === 0 && recent.length > 0) {
      evidence.push(
        ...recent
          .slice(0, 5)
          .map((memory) => `recent [${memory.category}]: ${memory.prompt.slice(0, 80)} → ${memory.response.slice(0, 160)}`),
      );
    }

    return {
      ok: recalled.length > 0 || recent.length > 0,
      tool: "memory-recall",
      origin: "none",
      evidence,
      leads: [],
      summary: `Memory: ${recalled.length} directly relevant, ${recent.length} recent record(s) held.`,
    };
  }

  /* ------------------------------ testing ----------------------------- */

  private async investigateTesting(): Promise<Omit<Investigation, "agentId" | "agentName">> {
    const evidence: string[] = [];
    const leads: string[] = [];

    // The in-browser self-test suite is always available: it exercises
    // the real stores and needs no runtime or authorization.
    const suite = await SelfTestRunner.getInstance().run();
    evidence.push(
      `Self-test suite: ${suite.summary.passed}/${suite.summary.total} passed, ${suite.summary.failed} failed.`,
    );
    for (const failure of suite.results.filter((result) => !result.passed).slice(0, 6)) {
      evidence.push(`FAILING ${failure.category}/${failure.name}: ${failure.detail}`);
      leads.push(failure.name);
    }

    // The real workspace test command needs the development runtime AND
    // execute authorization — an ACTION, so the gate applies here only.
    let origin: SourceOrigin | "none" = "none";
    const access = SourceAccess.getInstance();
    const status = await access.status();
    if (!status.reachable) {
      evidence.push(
        "The real `bun test` suite could not be run: no development runtime (STATIC SNAPSHOT only).",
      );
    } else if (!AutonomyGate.getInstance().can(3)) {
      evidence.push(
        `Development runtime is live (${status.runtime}), but running the real test suite needs autonomy L3 — evidence limited to the in-browser suite.`,
      );
      origin = "development-runtime";
    } else {
      const outcome = await access.command("test");
      origin = outcome.origin;
      evidence.push(
        outcome.ok
          ? `Real workspace test run passed in ${outcome.durationMs}ms: ${outcome.stdout.trim().split("\n").slice(-3).join(" | ")}`
          : `Real workspace test run failed: ${(outcome.stderr || outcome.error || outcome.stdout).trim().slice(0, 400)}`,
      );
    }

    return {
      ok: true,
      tool: "self-test-runner",
      origin,
      evidence,
      leads,
      summary: `Testing: ${suite.summary.passed}/${suite.summary.total} in-browser tests passed${
        origin === "development-runtime" ? " (development runtime reachable)" : " (no development runtime)"
      }.`,
    };
  }

  /* ------------------------------ runtime ----------------------------- */

  private async investigateRuntime(): Promise<Omit<Investigation, "agentId" | "agentName">> {
    const access = SourceAccess.getInstance();
    const status = await access.status(true);
    const evidence: string[] = [access.describe(status)];

    try {
      const api = await AIService.getInstance().getApiStatus();
      evidence.push(`Active AI provider: ${api.activeProvider ?? "none has succeeded yet"}.`);
      for (const provider of api.runtime.providers) {
        evidence.push(
          `provider ${provider.name} — priority ${provider.priority}, ${provider.enabled ? "enabled" : "disabled"}, ${
            provider.inCooldown ? "IN COOLDOWN" : "ready"
          }${provider.failure ? `, last failure: ${provider.failure.reason}` : ""}${
            provider.lastSuccess ? `, last success ${new Date(provider.lastSuccess).toISOString()}` : ", never succeeded"
          }.`,
        );
      }
    } catch (error) {
      evidence.push(`Provider status unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const diagnostics = await SelfDiagnostics.getInstance().run();
    evidence.push(
      `Self-diagnostics: ${diagnostics.summary.ok} ok, ${diagnostics.summary.warn} warning(s), ${diagnostics.summary.error} error(s).`,
    );
    const leads: string[] = [];
    for (const finding of diagnostics.findings.filter((item) => item.severity === "error" || item.severity === "warn")) {
      evidence.push(`${finding.severity.toUpperCase()} ${finding.category}: ${finding.message} — ${finding.evidence}`);
      leads.push(finding.category);
    }

    return {
      ok: true,
      tool: "runtime-status",
      origin: status.reachable ? "development-runtime" : "static-snapshot",
      evidence,
      leads,
      summary: status.reachable
        ? `Runtime reachable: ${status.runtime}, ${diagnostics.summary.error} diagnostic error(s).`
        : `No development runtime; ${diagnostics.summary.error} diagnostic error(s).`,
    };
  }

  /* ---------------------------- capability ---------------------------- */

  private async investigateCapability(
    objective: StudyObjective,
  ): Promise<Omit<Investigation, "agentId" | "agentName">> {
    const registry = CapabilityRegistry.getInstance();
    const manifest = CapabilityManifest.getInstance();
    const capability = objective.target ? registry.get(objective.target) : undefined;
    const evidence: string[] = [];
    const leads: string[] = [];

    if (capability) {
      evidence.push(
        `Capability “${capability.name}” (${capability.id}) — status ${capability.status}.`,
        `Description: ${capability.description}`,
        `Limitations: ${capability.limitations.join("; ") || "none recorded"}.`,
        `Dependencies: ${capability.dependencies.join(", ") || "none"}.`,
        `Required tools: ${capability.requiredTools.join(", ") || "none"}; required agents: ${capability.requiredAgents.join(", ") || "none"}.`,
      );
      leads.push(...capability.dependencies);
    } else {
      const counts = registry.statusCounts();
      evidence.push(
        `Capability registry: ${Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(", ")}.`,
      );
      for (const item of [...registry.lacking(), ...registry.partial()].slice(0, 8)) {
        evidence.push(`${item.status}: ${item.name} — ${item.limitations.join("; ") || item.description}`);
        leads.push(item.id);
      }
    }

    const live = manifest.getAll();
    const unavailable = live.filter((item) => item.status !== "available");
    evidence.push(
      `Live capability manifest: ${live.length - unavailable.length}/${live.length} available.`,
      ...unavailable.slice(0, 8).map((item) => `manifest ${item.status}: ${item.name}${item.error ? ` — ${item.error}` : ""}`),
    );

    return {
      ok: true,
      tool: "capability-registry",
      origin: "none",
      evidence,
      leads,
      summary: capability
        ? `Inspected capability “${capability.name}” (${capability.status}).`
        : `Inspected the capability registry and live manifest (${unavailable.length} not available).`,
    };
  }
}
