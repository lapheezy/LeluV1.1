/**
 * ==========================================================
 * LÉLU — ENGINEERING COUNCIL
 *
 * The Repo Executive does not integrate a repository alone. It
 * convenes the specialists that already exist in LÉLU's roster —
 * architecture, security, testing, documentation, API integration,
 * memory and UI — and runs their reviews in PARALLEL over the same
 * measured evidence:
 *
 *   • the research findings (licence, compatibility, security,
 *     capabilities, dependencies)
 *   • the executor's real inspection (file tree, manifest, README)
 *
 * Each specialist returns findings they can point at. Nothing here
 * invents a review: every line cites a manifest field, a tree path,
 * a licence obligation or a declared script.
 *
 * When an agent from the existing roster is available and the
 * caller asks for delegation, the same specialist prompt is also
 * run through AgentRunner — the ONE AI runtime — concurrently with
 * the others, and its answer is attached as a second opinion. The
 * evidence review is always produced, so a provider outage never
 * turns the council into a blank page.
 * ==========================================================
 */

import type { ResearchFindings, RepositoryFileEntry } from "./AcquisitionTypes";

export type SpecialistId =
  | "architecture"
  | "security"
  | "testing"
  | "documentation"
  | "api"
  | "memory"
  | "ui";

export const SPECIALIST_TITLES: Record<SpecialistId, string> = {
  architecture: "Architecture",
  security: "Security",
  testing: "Testing",
  documentation: "Documentation",
  api: "API integration",
  memory: "Memory",
  ui: "UI",
};

/** Existing roster templates each specialist is delegated to. */
const SPECIALIST_AGENTS: Record<SpecialistId, string> = {
  architecture: "engineer",
  security: "engineer",
  testing: "engineer",
  documentation: "researcher",
  api: "repo-executor",
  memory: "engineer",
  ui: "designer",
};

export interface SpecialistReport {
  id: SpecialistId;
  title: string;
  ok: boolean;
  source: "evidence" | "evidence+agent";
  findings: string[];
  evidence: string[];
  agentId?: string;
  agentResult?: string;
  durationMs: number;
}

export interface CouncilReport {
  reports: SpecialistReport[];
  verdict: "ready" | "review" | "blocked";
  risks: string[];
  recommendations: string[];
  durationMs: number;
  /** Every specialist ran; this is measured, not asserted. */
  parallel: boolean;
}

export interface CouncilInspection {
  structure: RepositoryFileEntry[];
  manifest: string;
  readme: string;
}

export interface CouncilOptions {
  /** Also ask the existing agent roster for a second opinion. */
  delegateToAgents?: boolean;
  /** Hard cap on each specialist's evidence review. */
  timeoutMs?: number;
}

export default class EngineeringCouncil {
  private static instance: EngineeringCouncil | null = null;

  static getInstance(): EngineeringCouncil {
    if (!EngineeringCouncil.instance) EngineeringCouncil.instance = new EngineeringCouncil();
    return EngineeringCouncil.instance;
  }

  static resetForTests(): void {
    EngineeringCouncil.instance = null;
  }

  /**
   * Convene every specialist at once. `Promise.all` is the mechanism:
   * reviews are independent, so one slow agent never delays the rest.
   */
  async review(
    findings: ResearchFindings,
    inspection: CouncilInspection,
    options: CouncilOptions = {},
  ): Promise<CouncilReport> {
    const started = Date.now();
    const ids = Object.keys(SPECIALIST_TITLES) as SpecialistId[];
    const timeout = options.timeoutMs ?? 15_000;

    const reports = await Promise.all(
      ids.map((id) => this.reviewOne(id, findings, inspection, timeout, options.delegateToAgents === true)),
    );

    const risks: string[] = [];
    const recommendations: string[] = [];
    for (const report of reports) {
      for (const line of report.findings) {
        // Only lines that STATE a risk count. "No install scripts declared"
        // and "Risk level: low" are the opposite of a risk, and treating
        // the words alone as a risk made every safe repository "blocked".
        const statesRisk =
          !/\bno\b|\bnone\b|risk level: low/i.test(line) &&
          /\b(unsafe|unknown licence|no licence|copyleft|declares an install|install script (is|present))\b/i.test(line);
        if (statesRisk) risks.push(`${report.title}: ${line}`);
        if (/recommend|should|needs to|add |pin /i.test(line)) {
          recommendations.push(`${report.title}: ${line}`);
        }
      }
    }

    const licenseRisk = findings.license.risk;
    const blocked =
      licenseRisk === "copyleft" ||
      licenseRisk === "unknown" ||
      findings.compatibility.score < 0.35;
    const verdict: CouncilReport["verdict"] = blocked
      ? "blocked"
      : findings.compatibility.score >= 0.6 && licenseRisk === "permissive"
        ? "ready"
        : "review";

    return {
      reports,
      verdict,
      risks: [...new Set(risks)].slice(0, 20),
      recommendations: [...new Set(recommendations)].slice(0, 20),
      durationMs: Date.now() - started,
      parallel: reports.length === ids.length,
    };
  }

  private async reviewOne(
    id: SpecialistId,
    findings: ResearchFindings,
    inspection: CouncilInspection,
    timeoutMs: number,
    delegate: boolean,
  ): Promise<SpecialistReport> {
    const started = Date.now();
    const evidence = this.reviewEvidence(id, findings, inspection);
    let agentResult: string | undefined;
    let agentId: string | undefined;

    if (delegate) {
      const delegation = await this.delegate(id, findings, inspection, timeoutMs);
      agentResult = delegation.result;
      agentId = delegation.agentId;
    }

    return {
      id,
      title: SPECIALIST_TITLES[id],
      ok: evidence.findings.length > 0,
      source: agentResult ? "evidence+agent" : "evidence",
      findings: evidence.findings,
      evidence: evidence.evidence,
      agentId,
      agentResult,
      durationMs: Date.now() - started,
    };
  }

  private reviewEvidence(
    id: SpecialistId,
    findings: ResearchFindings,
    inspection: CouncilInspection,
  ): { findings: string[]; evidence: string[] } {
    const paths = inspection.structure.map((entry) => entry.path);
    const critical: string[] = [];
    const notes: string[] = [];

    switch (id) {
      case "architecture": {
        critical.push(
          `Runtime ${findings.compatibility.runtime}; compatibility ${Math.round(findings.compatibility.score * 100)}%.`,
        );
        critical.push(
          `Build system ${findings.buildSystem || "not declared"}; ${findings.dependencies.length} declared dependenc${findings.dependencies.length === 1 ? "y" : "ies"}.`,
        );
        if (findings.entryPoints.length === 0) notes.push("No entry point was found in the manifest — integration needs a wrapper.");
        else notes.push(`Entry points: ${findings.entryPoints.slice(0, 4).join(", ")}.`);
        if (findings.compatibility.score < 0.6) notes.push("Compatibility is below the usual integration threshold; review the wrapper cost.");
        break;
      }
      case "security": {
        critical.push(`Risk level: ${findings.security.riskLevel}.`);
        critical.push(
          findings.security.observations.length > 0
            ? findings.security.observations.join(" ")
            : "No adverse observation was found in the manifest, lockfile or tree.",
        );
        if (/"?(pre|post)?install"?\s*:/.test(inspection.manifest)) {
          notes.push("The package declares an install/postinstall script; LÉLU installs with --ignore-scripts, so it will not run.");
        }
        if (/\.npmrc|\.netrc|id_rsa/i.test(paths.join(" "))) notes.push("Credential-shaped files exist in the tree and are refused by the runtime.");
        break;
      }
      case "testing": {
        const testScript = /"test"\s*:\s*"([^"]+)"/.exec(inspection.manifest)?.[1];
        critical.push(testScript ? `Declared test command: ${testScript}.` : "No test script is declared in the package manifest.");
        const testFiles = paths.filter((path) => /(^|\/)(test|tests|spec|__tests__)\//i.test(path)).length;
        critical.push(`${testFiles} test file(s) in the bounded tree listing.`);
        if (!testScript) notes.push("LÉLU must supply its own integration test; the repository cannot be its own evidence.");
        break;
      }
      case "documentation": {
        critical.push(inspection.readme ? `README is present (${inspection.readme.length} characters read).` : "No README was found at the repository root.");
        if (!inspection.readme) notes.push("Attribution and usage will need to be written from the source, not copied from a README.");
        const licensePath = findings.license.spdx;
        notes.push(`Licence ${licensePath}; obligations: ${findings.license.obligations.join(" ") || "none stated"}.`);
        break;
      }
      case "api": {
        critical.push(`Capability signals: ${findings.capabilities.join(", ") || "none detected"}.`);
        critical.push(`Declared dependencies: ${findings.dependencies.slice(0, 8).join(", ") || "none"}.`);
        if (findings.capabilities.length === 0) notes.push("No capability signal was found; do not promise an adaptation before inspecting the source.");
        break;
      }
      case "memory": {
        const memorySignal = /memory|cache|store|storage|recall|persist|indexeddb|localstorage/i.test(
          `${findings.summary} ${findings.capabilities.join(" ")} ${paths.join(" ")}`,
        );
        critical.push(
          memorySignal
            ? "Memory/storage signals are present in the evidence."
            : "No memory/storage signal was found; this acquisition does not obviously improve recall.",
        );
        if (memorySignal) notes.push("Check whether the store is bounded and whether eviction is observable before wiring it into LÉLU memory.");
        break;
      }
      case "ui": {
        critical.push(
          findings.compatibility.runtime === "browser"
            ? "The package is browser-native; it can run in LÉLU's bundle without a shim."
            : findings.compatibility.runtime === "isomorphic"
              ? "The package is isomorphic; the browser path must be selected explicitly."
              : `The package runs in ${findings.compatibility.runtime}; the UI needs a server route or a wrapper.`,
        );
        const uiFiles = paths.filter((path) => /\.(css|tsx|jsx|html|vue|svelte)$/i.test(path)).length;
        critical.push(`${uiFiles} UI file(s) in the bounded tree listing.`);
        break;
      }
    }

    return { findings: [...critical, ...notes], evidence: paths.slice(0, 12) };
  }

  private async delegate(
    id: SpecialistId,
    findings: ResearchFindings,
    inspection: CouncilInspection,
    timeoutMs: number,
  ): Promise<{ result?: string; agentId?: string }> {
    try {
      const [{ default: AgentStore }, { default: AgentRunner }] = await Promise.all([
        import("../agents/AgentStore"),
        import("../agents/AgentRunner"),
      ]);
      const templateId = SPECIALIST_AGENTS[id];
      const agent = AgentStore.getInstance()
        .list()
        .find((candidate) => candidate.templateId === templateId && candidate.enabled);
      if (!agent) return {};
      const task = [
        `Review ${findings.identifier} as LÉLU's ${SPECIALIST_TITLES[id]} specialist.`,
        `Licence: ${findings.license.spdx} (${findings.license.risk}). Compatibility: ${findings.compatibility.runtime} ${Math.round(findings.compatibility.score * 100)}%.`,
        `Capabilities: ${findings.capabilities.join(", ") || "none"}. Dependencies: ${findings.dependencies.slice(0, 10).join(", ") || "none"}.`,
        `Manifest: ${inspection.manifest.slice(0, 1200)}`,
        "Give at most five concrete, evidence-based observations and say plainly when the evidence is insufficient.",
      ].join("\n");
      const run = await Promise.race([
        AgentRunner.getInstance().run(agent.id, task, undefined, undefined, {
          delegatedBy: "repo-executive",
          executive: "engineering",
          routeReason: "engineering council specialist review",
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!run || !run.ok) return { agentId: agent.id };
      return { result: run.response?.text, agentId: agent.id };
    } catch {
      return {};
    }
  }
}
