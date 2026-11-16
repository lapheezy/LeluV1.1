/**
 * ==========================================================
 * LÉLU — DEPENDENCY DECLARATION COVERAGE
 *
 * The requirement table is hand-declared. That is acceptable; what
 * is not acceptable is a capability that has NO declaration being
 * read as "nothing to check, therefore ready".
 *
 * This module makes the third state explicit:
 *
 *   declared          at least one requirement edge exists
 *   no_dependencies   deliberately a leaf (a binary, a device, an
 *                     endpoint) — someone said so
 *   undeclared        nobody said anything; treat as unknown
 *
 * `undeclared` is never promoted to ready. It is reported so the
 * gap can be fixed, which is the only honest use of a missing
 * declaration.
 * ==========================================================
 */

import { REQUIREMENTS, type RequirementEdge } from "./dependencies.ts";

export type DependencyDeclaration = "declared" | "no_dependencies" | "undeclared";

/**
 * Capabilities that genuinely require nothing else to exist.
 *
 * Each entry is a leaf fact: a local binary, an endpoint, a device
 * or an artifact. Adding an id here is a claim that it can be
 * checked on its own.
 */
export const NO_DEPENDENCY: readonly string[] = [
  "security.policy.opa",
  "security.scanner.semgrep",
  "security.scanner.trivy",
  "security.scanner.gitleaks",
  "security.audit.trail",
  "engineering.openhands.runtime",
  "engineering.opencode.runtime",
  "engineering.workspace.runtime",
  "voice.whisper.service",
  "voice.kokoro.service",
  "voice.audio.input",
  "voice.audio.output",
  "voice.vad.energy",
  "voice.vad.silero",
  "infrastructure.litellm",
  "infrastructure.temporal",
  "infrastructure.opentelemetry",
  // Service-reachability probes: each is a single network question (does
  // this endpoint answer?) and needs nothing else inside LÉLU to be
  // answerable. That is why they are leaves rather than omissions.
  "infrastructure.litellm.service",
  "infrastructure.openfga.service",
  "infrastructure.temporal.service",
  "infrastructure.pipecat.service",
  "infrastructure.whisper.service",
  "infrastructure.kokoro.service",
  "infrastructure.openhands.service",
  "infrastructure.opencode.service",
  "infrastructure.infisical.service",
  "infrastructure.otel.service",
];

export function declarationOf(
  capabilityId: string,
  edges: readonly RequirementEdge[] = REQUIREMENTS,
  noDependency: readonly string[] = NO_DEPENDENCY,
): DependencyDeclaration {
  if (edges.some((edge) => edge.dependentCapability === capabilityId)) return "declared";
  if (noDependency.includes(capabilityId)) return "no_dependencies";
  return "undeclared";
}

export interface DeclarationCoverage {
  declared: string[];
  noDependencies: string[];
  /** Capabilities whose readiness cannot be trusted yet. */
  undeclared: string[];
  summary: string;
}

/**
 * Coverage for the capabilities a studio actually reported.
 *
 * Order is preserved so the report reads like the snapshot it came
 * from, and the summary states the count rather than implying full
 * coverage when there is none.
 */
export function dependencyCoverage(
  capabilityIds: readonly string[],
  edges: readonly RequirementEdge[] = REQUIREMENTS,
  noDependency: readonly string[] = NO_DEPENDENCY,
): DeclarationCoverage {
  const declared: string[] = [];
  const noDependencies: string[] = [];
  const undeclared: string[] = [];

  for (const id of capabilityIds) {
    const declaration = declarationOf(id, edges, noDependency);
    if (declaration === "declared") declared.push(id);
    else if (declaration === "no_dependencies") noDependencies.push(id);
    else undeclared.push(id);
  }

  const total = capabilityIds.length;
  return {
    declared,
    noDependencies,
    undeclared,
    summary:
      total === 0
        ? "No capabilities were reported, so nothing could be checked."
        : `${declared.length} declared, ${noDependencies.length} leaf, ${undeclared.length} undeclared of ${total}.` +
          (undeclared.length > 0
            ? " Undeclared capabilities are not treated as ready."
            : " Every reported capability has a stated dependency position."),
  };
}

/**
 * Should a capability be allowed to read as ready?
 *
 * A declared requirement set that is satisfied, or a deliberate leaf,
 * can. An undeclared capability cannot — the graph knows nothing
 * about it.
 */
export function mayReadAsReady(capabilityId: string): boolean {
  return declarationOf(capabilityId) !== "undeclared";
}
