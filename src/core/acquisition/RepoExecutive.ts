/**
 * ==========================================================
 * LÉLU — REPO EXECUTIVE
 *
 * The strategic half of the acquisition workforce. It answers:
 * what does LÉLU lack, which open-source project supplies it,
 * is that project safe, licensed and alive, does it fit this
 * architecture, and is it worth an Executor's time?
 *
 * Every judgement is grounded in a real API read or a real
 * capability registry entry — priorities are not vibes:
 *
 *   gaps        ← CapabilityRegistry (partial/planned/broken) and
 *                 CapabilityManifest (unavailable capabilities)
 *   fit         ← ArchitectureMap subsystems + the requested objective
 *   maintenance ← real commits, stars, archive flag
 *   license     ← real license endpoint / LICENSE file
 *   security    ← real observations (lockfile, install scripts, age)
 *
 * It assigns work to the Repo Executor and keeps the technology
 * knowledge base current.
 * ==========================================================
 */

import CapabilityManifest from "../capabilities/CapabilityManifest";
import CapabilityRegistry from "../selfdev/CapabilityRegistry";
import ArchitectureMap from "../selfdev/ArchitectureMap";
import AcquisitionRuntime from "./AcquisitionRuntime";
import AcquisitionSource from "./AcquisitionSource";
import AcquisitionStore from "./AcquisitionStore";
import GitHubSource, { type GitHubJson } from "./GitHubSource";
import RepositorySourceRegistry, { type RepositorySource } from "./RepositorySource";
import TechnologyKnowledgeBase from "./TechnologyKnowledgeBase";
import {
  licenseObligations,
  licenseRisk,
  type AcquisitionAssignment,
  type AcquisitionProposal,
  type CapabilityGap,
  type RepositoryCandidate,
  type ResearchFindings,
} from "./AcquisitionTypes";

export interface DiscoveryOptions {
  keywords: string;
  language?: string;
  minStars?: number;
  limit?: number;
}

export interface DiscoveryResult {
  candidates: RepositoryCandidate[];
  errors: Array<{ sourceId: string; error: string }>;
}

interface PackageManifest {
  name?: string;
  license?: string | { type?: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  type?: string;
  main?: string;
  module?: string;
  browser?: string | Record<string, string>;
  exports?: unknown;
}

const KNOWN_BUILD_SYSTEMS: Array<[string, string]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["Cargo.toml", "cargo"],
  ["pyproject.toml", "python"],
  ["go.mod", "go"],
  ["Makefile", "make"],
];

function dedupe(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function daysSince(iso: string): number | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((Date.now() - time) / 86_400_000));
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** Capability words worth looking for in a README / tree / manifest. */
const CAPABILITY_SIGNALS = [
  "fuzzy search", "full text search", "vector search", "embeddings",
  "pdf", "ocr", "image", "video", "audio", "speech", "transcription",
  "markdown", "parser", "compiler", "ast", "syntax", "schema", "validation",
  "chart", "graph", "visualization", "3d", "webgl", "shader", "animation",
  "auth", "oauth", "encryption", "security", "rate limit", "queue", "cron",
  "cache", "database", "sql", "orm", "migration", "realtime", "websocket",
  "workflow", "automation", "scraper", "crawler", "browser", "testing",
  "benchmark", "diff", "git", "zip", "archive", "compression", "export",
];

export default class RepoExecutive {
  private static instance: RepoExecutive | null = null;
  private readonly runtime = AcquisitionRuntime.getInstance();
  private readonly store = AcquisitionStore.getInstance();
  private readonly knowledge = TechnologyKnowledgeBase.getInstance();
  private sourcesReady = false;

  static getInstance(): RepoExecutive {
    if (!RepoExecutive.instance) RepoExecutive.instance = new RepoExecutive();
    return RepoExecutive.instance;
  }

  static resetForTests(): void {
    RepoExecutive.instance = null;
  }

  /**
   * Register the repository sources.
   *
   * When the acquisition runtime is reachable, GitHub reads are proxied
   * through it so the API token stays server-side; otherwise the public
   * anonymous API is used and its rate limit is reported honestly.
   */
  private ensureSources(): void {
    if (this.sourcesReady) return;
    const registry = RepositorySourceRegistry.getInstance();
    const proxy = this.runtime.isReachable()
      ? async (path: string) => this.runtime.github<GitHubJson>(path)
      : undefined;
    if (!registry.get("github")) registry.register(new GitHubSource({ proxy }));
    this.sourcesReady = true;
    if (this.runtime.isReachable()) {
      const manifest = CapabilityManifest.getInstance();
      for (const id of ["repository-acquisition", "capability-pipeline"]) {
        if (manifest.get(id)) manifest.updateStatus(id, "available");
      }
    }
  }

  /** Recreate connectors after a runtime probe changes the transport. */
  refreshSources(): void {
    this.sourcesReady = false;
    this.ensureSources();
  }

  async discover(options: DiscoveryOptions): Promise<DiscoveryResult> {
    this.ensureSources();
    const registry = RepositorySourceRegistry.getInstance();
    const { candidates, errors } = await registry.searchAll({
      keywords: options.keywords,
      language: options.language,
      minStars: options.minStars,
      limit: options.limit ?? 10,
    });
    return { candidates, errors };
  }

  private sourceFor(candidate: RepositoryCandidate): RepositorySource {
    this.ensureSources();
    const registry = RepositorySourceRegistry.getInstance();
    const source =
      registry.get(candidate.source) ??
      registry.list().find((entry) => entry.supports("github.com"));
    if (!source) throw new Error(`No repository connector is registered for "${candidate.source}".`);
    return source;
  }

  /** Research one repository — every field below comes from a real read. */
  async research(candidate: RepositoryCandidate, override?: RepositorySource): Promise<ResearchFindings> {
    const source = override ?? this.sourceFor(candidate);
    const observations: string[] = [];

    let metadata: RepositoryCandidate;
    try {
      metadata = await source.metadata(candidate.identifier);
    } catch (error) {
      // The search result already carries real metadata; a metadata fetch
      // failure is reported, not papered over.
      observations.push(
        `Repository metadata could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
      );
      metadata = candidate;
    }

    const [commits, tree] = await Promise.all([
      source.commits(candidate.identifier, metadata.defaultBranch, 30).catch((error: unknown) => {
        observations.push(`Commit history unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }),
      source.tree(candidate.identifier, metadata.defaultBranch).catch((error: unknown) => {
        observations.push(`Tree unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }),
    ]);

    const paths = tree.map((entry) => entry.path);
    const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
    const commitsLast90Days = commits.filter((commit) => Date.parse(commit.date) >= ninetyDaysAgo).length;

    /* ------------------------------ license ------------------------------ */
    let license = {
      spdx: metadata.license || "UNKNOWN",
      name: metadata.license || "No declared license",
      excerpt: "",
      url: "",
    };
    try {
      const response = await source.license(candidate.identifier);
      license = { ...license, ...response };
    } catch (error) {
      observations.push(`License lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    /* ------------------------------ manifest ----------------------------- */
    const manifestPath = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"].find((path) => paths.includes(path));
    let manifestText = "";
    if (manifestPath) {
      manifestText = await source.file(candidate.identifier, manifestPath, metadata.defaultBranch).catch(() => "");
    }
    let manifest: PackageManifest = {};
    if (manifestPath === "package.json" && manifestText) {
      try {
        manifest = JSON.parse(manifestText) as PackageManifest;
      } catch {
        observations.push("package.json exists but could not be parsed as JSON.");
      }
    }

    const readmePath = paths.find((path) => /^readme(\.md|\.txt|\.rst)?$/i.test(path));
    const readme = readmePath
      ? await source.file(candidate.identifier, readmePath, metadata.defaultBranch).catch(() => "")
      : "";
    if (!readmePath) observations.push("No README at the repository root.");

    const buildSystem =
      KNOWN_BUILD_SYSTEMS.find(([lockfile]) => paths.includes(lockfile))?.[1] ??
      (manifestPath === "package.json" ? "npm" : manifestPath ? manifestPath : "unknown");

    /* ---------------------------- capabilities --------------------------- */
    const haystack = `${metadata.description}\n${readme.slice(0, 12_000)}\n${paths.join("\n")}\n${manifestText.slice(0, 8_000)}`.toLowerCase();
    const capabilities = CAPABILITY_SIGNALS.filter((signal) => haystack.includes(signal)).slice(0, 12);
    const languageCounts = new Map<string, number>();
    for (const path of paths) {
      const extension = path.split(".").pop()?.toLowerCase();
      if (!extension) continue;
      const language =
        { ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", mjs: "JavaScript", py: "Python", rs: "Rust", go: "Go", java: "Java", kt: "Kotlin", swift: "Swift", rb: "Ruby" }[
          extension
        ] ?? "";
      if (!language) continue;
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    }
    const languages = [...languageCounts.entries()].sort((a, b) => b[1] - a[1]).map(([language]) => language);
    const entryPoints = paths.filter((path) => /(^|\/)(index|main|mod|lib|app|fuse)\.[a-z]+$/i.test(path)).slice(0, 8);

    /* ----------------------------- security ------------------------------ */
    if (metadata.archived) observations.push("The repository is archived: no maintenance is expected.");
    const lastCommit = commits[0]?.date ?? "";
    const ageDays = daysSince(lastCommit || metadata.updatedAt);
    if (ageDays !== null && ageDays > 730) observations.push(`Last commit was ${ageDays} days ago.`);
    const installScripts = ["preinstall", "install", "postinstall"].filter((script) => manifest.scripts?.[script]);
    if (installScripts.length > 0) {
      observations.push(
        `Declares lifecycle scripts (${installScripts.join(", ")}); the acquisition runtime installs with --ignore-scripts.`,
      );
    }
    const hasLockfile = ["package-lock.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "go.sum", "poetry.lock"].some(
      (lockfile) => paths.includes(lockfile),
    );
    if (!hasLockfile) observations.push("No dependency lockfile: installs are not reproducible.");
    const dependencies = dedupe(
      [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ],
      60,
    );
    if (dependencies.length > 40) observations.push(`${dependencies.length} declared dependencies increase review surface.`);
    const licenseRiskLevel = licenseRisk(license.spdx);
    if (licenseRiskLevel === "copyleft") observations.push("Copyleft license: distribution obligations are significant.");
    if (licenseRiskLevel === "unknown") observations.push("No recognised license: cannot be integrated until clarified.");
    if (paths.length > 4000) observations.push("Large tree: reviewing every file is impractical; extraction must be targeted.");

    const riskLevel: ResearchFindings["security"]["riskLevel"] =
      licenseRiskLevel === "copyleft" || metadata.archived || licenseRiskLevel === "unknown"
        ? "high"
        : installScripts.length > 0 || !hasLockfile
          ? "medium"
          : "low";

    /* --------------------------- compatibility --------------------------- */
    const reasons: string[] = [];
    let runtimeKind: ResearchFindings["compatibility"]["runtime"] = "unknown";
    if (manifest.browser !== undefined || manifest.module !== undefined || manifest.type === "module") {
      runtimeKind = "browser";
      reasons.push("Publishes an ESM/browser entry point, so it can be adapted into LÉLU's Vite bundle.");
    }
    if (manifest.main && !manifest.module && !manifest.browser) {
      runtimeKind = "node";
      reasons.push("CommonJS/Node entry point only; adaptation is needed before browser use.");
    }
    if (manifest.module && manifest.main) {
      runtimeKind = "isomorphic";
      reasons.push("Ships both Node and ESM entry points.");
    }
    if (runtimeKind === "unknown" && languages[0] === "TypeScript") {
      runtimeKind = "unknown";
      reasons.push("TypeScript sources with no declared entry point; the executor must inspect imports.");
    }
    if (languages[0] === "TypeScript") reasons.push("Written in TypeScript: types can be carried into LÉLU as-is.");
    if (dependencies.length === 0) reasons.push("No runtime dependencies, so the adaptation is self-contained.");
    if (languages.length > 0) reasons.push(`Primary languages: ${languages.slice(0, 3).join(", ")}.`);

    const compatibilityScore = clamp(
      0.25 +
        (languages[0] === "TypeScript" ? 0.25 : languages[0] === "JavaScript" ? 0.2 : 0.05) +
        (runtimeKind === "browser" || runtimeKind === "isomorphic" ? 0.2 : 0) +
        (dependencies.length === 0 ? 0.15 : dependencies.length < 10 ? 0.08 : 0) +
        (licenseRiskLevel === "permissive" ? 0.1 : 0) +
        (metadata.archived ? -0.2 : 0.05),
    );

    const findings: ResearchFindings = {
      candidateId: metadata.id,
      identifier: metadata.identifier,
      provenance: override ? "acquired-repository" : "github-api",
      summary: metadata.description || (readme ? readme.split("\n").find((line) => line.trim().length > 40)?.trim().slice(0, 300) ?? "" : ""),
      capabilities,
      dependencies,
      buildSystem,
      entryPoints,
      license: {
        spdx: license.spdx,
        name: license.name,
        risk: licenseRiskLevel,
        obligations: licenseObligations(license.spdx),
      },
      maintenance: {
        lastCommit: commits[0]?.sha.slice(0, 10) ?? "",
        lastCommitAt: lastCommit || metadata.updatedAt,
        commitsLast90Days,
        archived: metadata.archived,
        stars: metadata.stars,
        openIssues: metadata.openIssues,
      },
      security: { observations, riskLevel },
      compatibility: {
        runtime: runtimeKind,
        languages,
        score: Number(compatibilityScore.toFixed(2)),
        reasons,
      },
      researchedAt: Date.now(),
    };

    this.knowledge.addFromResearch(
      {
        id: metadata.id,
        identifier: metadata.identifier,
        url: metadata.url,
        description: metadata.description,
        topics: metadata.topics,
        stars: metadata.stars,
        license: metadata.license,
      },
      findings,
      commits[0]?.sha ?? "",
    );

    return findings;
  }

  /** What LÉLU is missing, from her own registries. */
  capabilityGaps(): CapabilityGap[] {
    const gaps: CapabilityGap[] = [];
    const registry = CapabilityRegistry.getInstance();
    for (const capability of registry.list()) {
      if (["planned", "broken", "disabled"].includes(capability.status)) {
        gaps.push({
          capabilityId: capability.id,
          name: capability.name,
          status: capability.status,
          reason: capability.limitations[0] ?? `Capability is ${capability.status}.`,
        });
      } else if (["partial", "experimental"].includes(capability.status)) {
        gaps.push({
          capabilityId: capability.id,
          name: capability.name,
          status: capability.status,
          reason: capability.limitations[0] ?? `Capability is ${capability.status}.`,
        });
      }
    }
    for (const manifestCapability of CapabilityManifest.getInstance().getAll()) {
      if (manifestCapability.status === "unavailable" || manifestCapability.status === "not_configured") {
        gaps.push({
          capabilityId: manifestCapability.id,
          name: manifestCapability.name,
          status: manifestCapability.status,
          reason: manifestCapability.error ?? `Capability is ${manifestCapability.status}.`,
        });
      }
    }
    return gaps;
  }

  /** A factual description of the architecture this must fit into. */
  architectureContext(): string {
    const architecture = ArchitectureMap.getInstance();
    const subsystems = architecture.list();
    const manifest = CapabilityManifest.getInstance();
    const gaps = this.capabilityGaps();
    return [
      `Architecture: ${subsystems.length} mapped subsystems, ${architecture.countFiles()} source files.`,
      `Subsystems: ${subsystems
        .slice(0, 12)
        .map((entry) => entry.name)
        .join(", ")}.`,
      `Capabilities: ${manifest.getAvailable().length} available of ${manifest.getAll().length} declared.`,
      `Gaps: ${gaps
        .slice(0, 8)
        .map((gap) => `${gap.name} (${gap.status})`)
        .join(", ") || "none recorded"}.`,
    ].join(" ");
  }

  /** Rank a researched candidate against the objective and the real gaps. */
  evaluate(
    candidate: RepositoryCandidate,
    findings: ResearchFindings,
    objective: string,
  ): { priority: number; reasons: string[]; risks: string[] } {
    const reasons: string[] = [];
    const risks: string[] = [];

    const objectiveWords = objective.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
    const capabilityFit = findings.capabilities.filter((capability) =>
      objectiveWords.some((word) => capability.includes(word) || word.includes(capability.split(" ")[0])),
    ).length;
    const gapText = this.capabilityGaps().map((gap) => `${gap.name} ${gap.reason}`).join(" ").toLowerCase();
    const gapFit = findings.capabilities.filter((capability) => gapText.includes(capability.split(" ")[0])).length;

    const stars = Math.log10(Math.max(1, candidate.stars)) / 5;
    const recency = findings.maintenance.archived
      ? 0
      : findings.maintenance.commitsLast90Days > 0
        ? 1
        : clamp(1 - (daysSince(findings.maintenance.lastCommitAt) ?? 365) / 730);
    const license = findings.license.risk === "permissive" ? 1 : findings.license.risk === "weak-copyleft" ? 0.5 : 0;
    const security = findings.security.riskLevel === "low" ? 1 : findings.security.riskLevel === "medium" ? 0.5 : 0;
    const fit = clamp((capabilityFit * 2 + gapFit * 2) / 4);

    const priority = Math.round(
      100 *
        (0.3 * fit +
          0.2 * findings.compatibility.score +
          0.15 * license +
          0.15 * security +
          0.1 * recency +
          0.1 * clamp(stars)),
    );

    if (capabilityFit > 0) reasons.push(`Capability signals overlap the objective: ${findings.capabilities.slice(0, 4).join(", ")}.`);
    if (gapFit > 0) reasons.push("Supplies a capability LÉLU's registry marks as missing or partial.");
    reasons.push(`Compatibility ${Math.round(findings.compatibility.score * 100)}% — ${findings.compatibility.reasons[0] ?? "no runtime signals"}.`);
    reasons.push(
      `License ${findings.license.spdx} (${findings.license.risk}); ` +
        `${findings.maintenance.commitsLast90Days} commits in the last 90 days; ${candidate.stars} stars.`,
    );

    if (findings.license.risk === "unknown") risks.push("License is unrecognised: integration is blocked until clarified.");
    if (findings.license.risk === "copyleft") risks.push("Copyleft obligations apply to any derivative.");
    if (findings.security.riskLevel === "high") risks.push("Security review found unresolved risk factors.");
    if (findings.maintenance.archived) risks.push("Archived upstream: LÉLU would own maintenance after acquisition.");
    if (findings.compatibility.runtime === "node") risks.push("Node-only entry point needs adaptation for the browser bundle.");

    return { priority, reasons, risks };
  }

  /** Discover, research and rank; returns proposals in priority order. */
  async proposals(objective: string, options: DiscoveryOptions): Promise<{
    proposals: AcquisitionProposal[];
    errors: Array<{ sourceId: string; error: string }>;
    gaps: CapabilityGap[];
  }> {
    this.ensureSources();
    const gaps = this.capabilityGaps();
    const discovery = await this.discover(options);
    const proposals: AcquisitionProposal[] = [];

    for (const candidate of discovery.candidates) {
      try {
        const findings = await this.research(candidate);
        const { priority, reasons, risks } = this.evaluate(candidate, findings, objective);
        proposals.push({
          candidate,
          findings,
          priority,
          reasons,
          risks,
          requestedCapability: options.keywords,
          recommendedIntegration:
            findings.compatibility.runtime === "browser" || findings.compatibility.runtime === "isomorphic"
              ? "Vendor the relevant module and wire it into a LÉLU capability adapter."
              : "Extract the algorithm into a portable adapter before wiring it in.",
        });
      } catch (error) {
        discovery.errors.push({
          sourceId: candidate.source,
          error: `${candidate.identifier}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    proposals.sort((a, b) => b.priority - a.priority);
    return { proposals, errors: discovery.errors, gaps };
  }

  /**
   * Build a proposal for one known repository, without a discovery search.
   *
   * When the registry API is unavailable (unauthenticated quota, outage),
   * the run does not stop and no metadata is invented: the repository is
   * cloned over git and research is grounded in that real workspace. The
   * findings carry `provenance: "acquired-repository"` and the missing
   * registry fields are recorded as missing.
   */
  async proposeFor(identifier: string, objective: string, requestedCapability: string): Promise<AcquisitionProposal> {
    this.ensureSources();
    const source = RepositorySourceRegistry.getInstance().get("github");
    if (!source) throw new Error("No GitHub connector is registered, so nothing could be researched.");

    let candidate: RepositoryCandidate;
    let findings: ResearchFindings;
    try {
      candidate = await source.metadata(identifier);
      findings = await this.research(candidate);
    } catch (error) {
      const apiError = error instanceof Error ? error.message : String(error);
      const repoSlug = identifier
        .replace(/^https?:\/\/github\.com\//i, "")
        .replace(/^git@github\.com:/i, "")
        .replace(/\.git$/i, "")
        .replace(/^\/+|\/+$/g, "");
      const clone = await this.runtime.clone({ url: `https://github.com/${repoSlug}` });
      if (!clone.ok) {
        throw new Error(
          `GitHub metadata for ${identifier} failed (${apiError}), and the fallback clone also failed: ${clone.error}`,
        );
      }
      const local = new AcquisitionSource(clone.acquisition);
      candidate = await local.metadata(repoSlug);
      findings = await this.research(candidate, local);
      findings.security.observations.unshift(
        `GitHub metadata was unavailable (${apiError}). This research is grounded in a real clone of ` +
          `${repoSlug}@${clone.acquisition.commit.slice(0, 10)}; stars, open issues and archived status were ` +
          `unavailable and are recorded as 0/false rather than estimated.`,
      );
      this.store.saveAcquisition(clone.acquisition);
    }

    const { priority, reasons, risks } = this.evaluate(candidate, findings, objective);
    return {
      candidate,
      findings,
      priority,
      reasons,
      risks,
      requestedCapability,
      recommendedIntegration:
        findings.compatibility.runtime === "browser" || findings.compatibility.runtime === "isomorphic"
          ? "Vendor the relevant module and wire it into a LÉLU capability adapter."
          : "Extract the algorithm into a portable adapter before wiring it in.",
    };
  }

  /** Hand an approved proposal to the Repo Executor. */
  assign(proposal: AcquisitionProposal, objective: string, assignedBy = "repo-executive"): AcquisitionAssignment {
    const assignment: AcquisitionAssignment = {
      id: `asg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      objective,
      requestedCapability: proposal.requestedCapability,
      proposal,
      executive: "engineering",
      assignedBy,
      status: "assigned",
    };
    this.store.saveAssignment(assignment);
    return assignment;
  }

  /** Executive summary for cognition and the workspace UI. */
  report(): string {
    const gaps = this.capabilityGaps();
    const assignments = this.store.assignments();
    const integrated = this.store.capabilities();
    return [
      this.architectureContext(),
      `Assignments: ${assignments.length} (${assignments.filter((assignment) => assignment.status === "running").length} running).`,
      `Integrated capabilities: ${integrated.map((capability) => capability.name).join(", ") || "none yet"}.`,
      `Knowledge base: ${this.knowledge.size()} entries.`,
      `Open gaps: ${gaps.slice(0, 5).map((gap) => `${gap.name} [${gap.status}]`).join(", ") || "none"}.`,
    ].join("\n");
  }
}
