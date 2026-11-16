/**
 * ==========================================================
 * LÉLU — CAPABILITY MARKETPLACE
 *
 * One searchable inventory of the technologies LÉLU has actually
 * integrated. Every entry is derived from the acquisition record
 * CapabilityIntegrator wrote, never from a hand-maintained list.
 *
 * Activation is real:
 *   activate   → manifest available, registry available,
 *                registered tools offered again
 *   deactivate → manifest unavailable, registry disabled,
 *                registered tools refused by toolPermitted()
 *   remove     → registry entry removed, tools disabled, the
 *                knowledge base integration cleared, the
 *                acquisition marked removed. A named operator
 *                with a destructive grant is required.
 *
 * Updates are checked against the source repository's real HEAD
 * through the runtime's git client (no GitHub API quota needed).
 * ==========================================================
 */

import CapabilityManifest from "../capabilities/CapabilityManifest";
import CapabilityRegistry from "../selfdev/CapabilityRegistry";
import KvStore from "../storage/KvStore";
import ToolRegistry from "../tools/ToolRegistry";
import AcquisitionRuntime from "./AcquisitionRuntime";
import AcquisitionStore from "./AcquisitionStore";
import ApprovalGate from "./ApprovalGate";
import CapabilityActivation from "./CapabilityActivation";
import TechnologyKnowledgeBase from "./TechnologyKnowledgeBase";
import type { CapabilityRecord, PipelineRun } from "./AcquisitionTypes";

export interface MarketplaceUpdate {
  checkedAt: number;
  upstreamCommit: string | null;
  available: boolean;
  error?: string;
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  kind: "acquired";
  active: boolean;
  removed: boolean;
  status: string;
  source: {
    identifier: string;
    url: string;
    commit: string;
    acquiredAt: number;
  };
  license: {
    spdx: string;
    obligations: string[];
    attributionPath: string;
  };
  dependencies: string[];
  tools: string[];
  tests: Array<{ command: string; exitCode: number; ok: boolean; ranAt: number }>;
  approvedBy: string;
  approvalBasis: string;
  registeredAt: number;
  acquisitionId: string;
  update: MarketplaceUpdate | null;
}

export interface MarketplaceActionResult {
  ok: boolean;
  entry?: MarketplaceEntry;
  error?: string;
}

const UPDATES_KEY = "lelu.acquisition.marketplace.updates.v1";

export default class CapabilityMarketplace {
  private static instance: CapabilityMarketplace | null = null;

  static getInstance(): CapabilityMarketplace {
    if (!CapabilityMarketplace.instance) CapabilityMarketplace.instance = new CapabilityMarketplace();
    return CapabilityMarketplace.instance;
  }

  static resetForTests(): void {
    CapabilityMarketplace.instance = null;
  }

  private readonly store = AcquisitionStore.getInstance();
  private readonly activation = CapabilityActivation.getInstance();

  private registryStatus(record: CapabilityRecord): string {
    return CapabilityRegistry.getInstance().get(record.id)?.status ?? "unregistered";
  }

  private updates(): Record<string, MarketplaceUpdate> {
    try {
      const stored = KvStore.getInstance().get<Record<string, MarketplaceUpdate>>(UPDATES_KEY);
      if (stored && typeof stored === "object") return stored;
    } catch {
      /* no update cache is not an error */
    }
    return {};
  }

  private saveUpdate(id: string, update: MarketplaceUpdate): void {
    try {
      const all = this.updates();
      all[id] = update;
      KvStore.getInstance().set(UPDATES_KEY, all);
    } catch {
      /* best effort */
    }
  }

  private toEntry(record: CapabilityRecord): MarketplaceEntry {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      kind: "acquired",
      active: this.activation.isCapabilityActive(record.id),
      removed: this.activation.isRemoved(record.id),
      status: this.registryStatus(record),
      source: record.source,
      license: record.license,
      dependencies: ["repository-acquisition", record.source.identifier],
      tools: record.registeredTools,
      tests: record.tests.map((test) => ({
        command: test.command,
        exitCode: test.exitCode,
        ok: test.ok,
        ranAt: test.ranAt,
      })),
      approvedBy: record.approvedBy,
      approvalBasis: record.approvalBasis,
      registeredAt: record.registeredAt,
      acquisitionId: record.acquisitionId,
      update: this.updates()[record.id] ?? null,
    };
  }

  /** Every acquired capability, newest first, with an optional text filter. */
  inventory(query = "", options: { includeRemoved?: boolean } = {}): MarketplaceEntry[] {
    const needle = query.trim().toLowerCase();
    return this.store
      .capabilities()
      .map((record) => this.toEntry(record))
      .filter((entry) => options.includeRemoved || !entry.removed)
      .filter((entry) => {
        if (!needle) return true;
        const haystack = [
          entry.id,
          entry.name,
          entry.description,
          entry.source.identifier,
          entry.license.spdx,
          ...entry.tools,
          ...entry.dependencies,
        ]
          .join(" ")
          .toLowerCase();
        return needle.split(/\s+/).every((token) => haystack.includes(token));
      });
  }

  get(id: string): MarketplaceEntry | null {
    const record = this.store.getCapability(id);
    return record ? this.toEntry(record) : null;
  }

  /** Re-apply the durable activation state to the live registries. */
  reconcile(): void {
    for (const record of this.store.capabilities()) {
      const active = this.activation.isCapabilityActive(record.id);
      this.apply(record, active);
    }
  }

  private apply(record: CapabilityRecord, active: boolean): void {
    CapabilityManifest.getInstance().updateStatus(
      record.id,
      active ? "available" : "unavailable",
      active ? undefined : "Deactivated in the capability marketplace.",
    );
    const registry = CapabilityRegistry.getInstance();
    if (registry.get(record.id)) {
      registry.update(record.id, { status: active ? "available" : "disabled" });
    }
    for (const toolId of record.registeredTools) {
      ToolRegistry.getInstance().updateAvailability(toolId, active);
    }
  }

  activate(id: string): MarketplaceActionResult {
    const record = this.store.getCapability(id);
    if (!record) return { ok: false, error: `No acquired capability "${id}" is registered.` };
    if (this.activation.isRemoved(id)) {
      return {
        ok: false,
        error: `"${id}" was removed. Restore it from the registry history before activating it again.`,
      };
    }
    this.activation.setCapability(id, true, record.registeredTools);
    this.apply(record, true);
    return { ok: true, entry: this.toEntry(record) };
  }

  deactivate(id: string): MarketplaceActionResult {
    const record = this.store.getCapability(id);
    if (!record) return { ok: false, error: `No acquired capability "${id}" is registered.` };
    this.activation.setCapability(id, false, record.registeredTools);
    this.apply(record, false);
    return { ok: true, entry: this.toEntry(record) };
  }

  /**
   * Remove an integration. This is destructive and needs a named
   * operator plus a destructive grant; it never deletes the
   * acquisition workspace or its history.
   */
  async remove(id: string, approver: string): Promise<MarketplaceActionResult> {
    const record = this.store.getCapability(id);
    if (!record) return { ok: false, error: `No acquired capability "${id}" is registered.` };
    const gate = ApprovalGate.getInstance();
    const decision = gate.authorize(
      "destructive",
      `capability:${id}`,
      approver,
      `Remove the ${id} integration from LÉLU's registries`,
    );
    if (!decision.allowed) return { ok: false, error: decision.reason };

    this.activation.markRemoved(id, record.registeredTools);
    this.apply(record, false);
    const registry = CapabilityRegistry.getInstance();
    if (registry.get(id)) registry.remove(id);

    const knowledge = TechnologyKnowledgeBase.getInstance();
    const entry = knowledge.getByIdentifier(record.source.identifier);
    if (entry) knowledge.remove(entry.id);

    gate.consume("destructive", `capability:${id}`);

    // The acquisition record keeps the provenance, but stops claiming an
    // integration that no longer exists.
    const runtime = AcquisitionRuntime.getInstance();
    try {
      await runtime.update(record.acquisitionId, {
        status: "removed",
        notes: [`capability ${id} removed by ${approver || "unnamed operator"}`],
      });
    } catch {
      /* runtime may be offline; the local registries are already corrected */
    }

    return { ok: true, entry: this.toEntry(record) };
  }

  /** Restore a removed capability's registry entry from its stored record. */
  restore(id: string): MarketplaceActionResult {
    const record = this.store.getCapability(id);
    if (!record) return { ok: false, error: `No acquired capability "${id}" is registered.` };
    this.activation.restore(id);
    this.activation.setCapability(id, true, record.registeredTools);

    const registry = CapabilityRegistry.getInstance();
    if (!registry.get(id)) {
      registry.add({
        id,
        name: record.name,
        description: record.description,
        status: "available",
        requiredTools: record.registeredTools,
        requiredProviders: [],
        requiredAgents: [],
        requiredKnowledge: [record.source.identifier, `${record.license.spdx} obligations`],
        dependencies: ["repository-acquisition"],
        tests: record.tests.map((test) => `${test.command} → exit ${test.exitCode}`),
        limitations: [`Restored from acquisition ${record.acquisitionId}.`],
        version: "1.0",
      });
    }
    const knowledge = TechnologyKnowledgeBase.getInstance();
    if (!knowledge.getByIdentifier(record.source.identifier)) {
      knowledge.markIntegrated(record.source.identifier, {
        capabilityId: id,
        registeredTools: record.registeredTools,
      });
    }
    this.apply(record, true);
    return { ok: true, entry: this.toEntry(record) };
  }

  /** Ask the source repository for its current HEAD and compare. */
  async checkUpdates(id: string): Promise<MarketplaceUpdate> {
    const record = this.store.getCapability(id);
    if (!record) {
      return { checkedAt: Date.now(), upstreamCommit: null, available: false, error: "Unknown capability." };
    }
    const runtime = AcquisitionRuntime.getInstance();
    const upstream = await runtime.upstream(record.source.identifier);
    const update: MarketplaceUpdate = upstream.ok
      ? {
          checkedAt: Date.now(),
          upstreamCommit: upstream.commit,
          available: Boolean(upstream.commit && upstream.commit !== record.source.commit),
        }
      : {
          checkedAt: Date.now(),
          upstreamCommit: null,
          available: false,
          error: upstream.error,
        };
    this.saveUpdate(id, update);
    return update;
  }

  /** Integration history from the durable acquisition store. */
  history(): { capabilities: CapabilityRecord[]; runs: PipelineRun[] } {
    return {
      capabilities: [...this.store.capabilities()].sort((a, b) => b.registeredAt - a.registeredAt),
      runs: this.store.runs(),
    };
  }
}

