/**
 * ==========================================================
 * LÉLU — CAPABILITY INTEGRATOR
 *
 * Turns a tested adaptation into a capability LÉLU can actually
 * use. Registration is not a note in a file: it writes into the
 * three registries the rest of the system already reads —
 *
 *   CapabilityManifest   (cognition: "what can I do right now")
 *   CapabilityRegistry   (self-development: dependencies, tests,
 *                         limitations, status)
 *   ToolRegistry         (what may be offered to a model)
 *
 * and records the provenance (source, commit, license, tests,
 * approver) in the acquisition store.
 *
 * It refuses to register anything without a passing test whose
 * exit code it saw, and without a live approval — the two things
 * that separate an integration from a claim.
 * ==========================================================
 */

import CapabilityManifest, { type CapabilityCategory } from "../capabilities/CapabilityManifest";
import CapabilityRegistry from "../selfdev/CapabilityRegistry";
import ToolRegistry from "../tools/ToolRegistry";
import AcquisitionStore from "./AcquisitionStore";
import ApprovalGate from "./ApprovalGate";
import TechnologyKnowledgeBase from "./TechnologyKnowledgeBase";
import {
  licenseObligations,
  type AdaptationEvidence,
  type CapabilityRecord,
  type TestEvidence,
} from "./AcquisitionTypes";

export interface RegistrationInput {
  capabilityId: string;
  name: string;
  description: string;
  category?: CapabilityCategory;
  source: {
    identifier: string;
    url: string;
    commit: string;
    acquiredAt: number;
  };
  license: string;
  evidence: AdaptationEvidence;
  tests: TestEvidence[];
  /** Tool ids this capability becomes reachable through. */
  tools: string[];
  acquisitionId: string;
  limitations?: string[];
}

export type RegistrationResult =
  | { ok: true; capability: CapabilityRecord }
  | { ok: false; error: string };

const APPROVAL_TARGET = "lelu-capability-registry";

export default class CapabilityIntegrator {
  private static instance: CapabilityIntegrator | null = null;
  private readonly store = AcquisitionStore.getInstance();

  static getInstance(): CapabilityIntegrator {
    if (!CapabilityIntegrator.instance) CapabilityIntegrator.instance = new CapabilityIntegrator();
    return CapabilityIntegrator.instance;
  }

  static resetForTests(): void {
    CapabilityIntegrator.instance = null;
  }

  /**
   * Record the operator's authorization to change LÉLU's capability
   * registries. Kept separate from register() so the decision is always
   * an explicit, named act rather than a side effect of integration.
   */
  authorize(approver: string, detail: string) {
    return ApprovalGate.getInstance().authorize("canonical-write", APPROVAL_TARGET, approver, detail);
  }

  register(input: RegistrationInput): RegistrationResult {
    const approval = ApprovalGate.getInstance().require("canonical-write", APPROVAL_TARGET);
    if (!approval.allowed || !approval.grant) {
      return { ok: false, error: `Registration refused: ${approval.reason}` };
    }

    const passing = input.tests.filter((test) => test.ok);
    if (passing.length === 0) {
      return {
        ok: false,
        error:
          "Registration refused: no passing test evidence was supplied. " +
          "A capability is registered only after a command exited zero and that result was recorded.",
      };
    }

    const missingTools = input.tools.filter((id) => !ToolRegistry.getInstance().get(id));
    if (missingTools.length === input.tools.length && input.tools.length > 0) {
      return {
        ok: false,
        error: `Registration refused: none of the declared tools exist in the registry (${missingTools.join(", ")}).`,
      };
    }

    const obligations = licenseObligations(input.license);
    const now = Date.now();
    const record: CapabilityRecord = {
      id: input.capabilityId,
      name: input.name,
      description: input.description,
      source: input.source,
      license: {
        spdx: input.license,
        obligations,
        attributionPath: `${input.evidence.capability}/ATTRIBUTION.md`,
      },
      adaptedFrom: input.evidence.extracted,
      registeredTools: input.tools,
      tests: input.tests,
      approvedBy: approval.grant.approver,
      approvalBasis: approval.grant.basis,
      registeredAt: now,
      acquisitionId: input.acquisitionId,
    };

    CapabilityManifest.getInstance().register({
      id: input.capabilityId,
      name: input.name,
      category: input.category ?? "knowledge",
      description: input.description,
      status: "available",
      providers: [`acquired:${input.source.identifier}`],
      lastSuccessful: now,
      lastChecked: now,
    });

    const registry = CapabilityRegistry.getInstance();
    const existing = registry.get(input.capabilityId);
    const registryEntry = {
      name: input.name,
      description: input.description,
      status: "available" as const,
      requiredTools: input.tools,
      requiredProviders: [],
      requiredAgents: [],
      requiredKnowledge: [input.source.identifier, `${input.license} obligations`],
      dependencies: ["repository-acquisition"],
      tests: input.tests.map((test) => `${test.command} → exit ${test.exitCode}`),
      limitations: [
        ...(input.limitations ?? []),
        `Adapted from ${input.source.identifier}@${input.source.commit.slice(0, 10)}; upstream changes are not tracked automatically.`,
        ...obligations,
      ],
      version: "1.0",
    };
    if (existing) {
      registry.update(existing.id, registryEntry);
    } else {
      registry.add({ id: input.capabilityId, ...registryEntry });
    }

    for (const toolId of input.tools) {
      ToolRegistry.getInstance().updateAvailability(toolId, true);
    }

    TechnologyKnowledgeBase.getInstance().markIntegrated(input.source.identifier, {
      capabilityId: input.capabilityId,
      registeredTools: input.tools,
    });

    this.store.saveCapability(record);
    ApprovalGate.getInstance().consume("canonical-write", APPROVAL_TARGET);

    return { ok: true, capability: record };
  }

  /** The capability's own report, including the real test evidence. */
  describe(capabilityId: string): string {
    const record = this.store.getCapability(capabilityId);
    if (!record) return `No acquired capability "${capabilityId}" is registered.`;
    return [
      `${record.name} (${record.id}) — ${record.description}`,
      `Source: ${record.source.identifier}@${record.source.commit.slice(0, 10)} (${record.license.spdx}).`,
      `Adapted files: ${record.adaptedFrom.join(", ")}.`,
      `Tools: ${record.registeredTools.join(", ")}.`,
      `Tests: ${record.tests.map((test) => `${test.command} exit ${test.exitCode}`).join("; ")}.`,
      `Approved by ${record.approvedBy} (${record.approvalBasis}).`,
    ].join("\n");
  }
}
