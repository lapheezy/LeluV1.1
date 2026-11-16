/**
 * ==========================================================
 * LÉLU — DURABLE ACQUISITION MANAGEMENT
 *
 * The client face of `.lelu-acquisitions/` as a managed system:
 * persistent records (the runtime writes acquisition.json + an
 * index), integrity verification, recovery of interrupted
 * acquisitions, quotas, and cleanup that can only ever remove
 * experimental work.
 *
 * Integrated acquisitions are protected: cleanup refuses them, and
 * only a named operator with a destructive grant can ask at all.
 * ==========================================================
 */

import AcquisitionRuntime from "./AcquisitionRuntime";
import ApprovalGate from "./ApprovalGate";
import type { AcquisitionRecord } from "./AcquisitionTypes";

export interface DurabilityPolicy {
  /** Remove experimental acquisitions older than this. */
  maxAgeDays: number;
  /** Keep at least this many acquisitions regardless of age. */
  keepRecent: number;
  /** Never remove anything with a registered capability. */
  keepIntegrated: boolean;
}

export const DEFAULT_DURABILITY_POLICY: DurabilityPolicy = {
  maxAgeDays: 30,
  keepRecent: 5,
  keepIntegrated: true,
};

export interface IntegrityFinding {
  id: string;
  identifier: string;
  status: "ok" | "missing-repo" | "missing-record" | "fingerprint-mismatch" | "commit-mismatch";
  detail: string;
}

export interface DurabilityReport {
  ok: boolean;
  runtime: string;
  records: AcquisitionRecord[];
  totalBytes: number;
  quotas: {
    maxAcquisitions: number;
    maxRepositoryBytes: number;
    maxTotalBytes: number;
  };
  experimental: number;
  integrated: number;
  overQuota: boolean;
  integrity: IntegrityFinding[];
  recovered: string[];
  error?: string;
  verifiedAt: number;
}

export interface CleanupResult {
  ok: boolean;
  removed: string[];
  kept: string[];
  error?: string;
}

export default class DurableAcquisitions {
  private static instance: DurableAcquisitions | null = null;

  static getInstance(): DurableAcquisitions {
    if (!DurableAcquisitions.instance) DurableAcquisitions.instance = new DurableAcquisitions();
    return DurableAcquisitions.instance;
  }

  static resetForTests(): void {
    DurableAcquisitions.instance = null;
  }

  private readonly runtime = AcquisitionRuntime.getInstance();

  async report(): Promise<DurabilityReport> {
    const status = await this.runtime.status();
    if (!status.ok) {
      return {
        ok: false,
        runtime: "unreachable",
        records: [],
        totalBytes: 0,
        quotas: { maxAcquisitions: 0, maxRepositoryBytes: 0, maxTotalBytes: 0 },
        experimental: 0,
        integrated: 0,
        overQuota: false,
        integrity: [],
        recovered: [],
        error: status.error,
        verifiedAt: Date.now(),
      };
    }

    const [list, verification] = await Promise.all([
      this.runtime.list(),
      this.runtime.maintenance("verify"),
    ]);
    const records = list.ok ? list.acquisitions : [];
    const totalBytes = records.reduce((sum, record) => sum + record.sizeBytes, 0);
    const maxTotalBytes = status.limits.maxTotalBytes ?? 512 * 1024 * 1024;
    return {
      ok: true,
      runtime: status.runtime,
      records,
      totalBytes,
      quotas: {
        maxAcquisitions: status.limits.maxAcquisitions,
        maxRepositoryBytes: status.limits.maxRepositoryBytes,
        maxTotalBytes,
      },
      experimental: records.filter((record) => record.status !== "integrated").length,
      integrated: records.filter((record) => record.status === "integrated").length,
      overQuota: records.length > status.limits.maxAcquisitions || totalBytes > maxTotalBytes,
      integrity: verification.ok ? (verification.findings as IntegrityFinding[]) : [],
      recovered: [],
      error: verification.ok ? undefined : verification.error,
      verifiedAt: Date.now(),
    };
  }

  async verify(): Promise<{ ok: boolean; findings: IntegrityFinding[]; error?: string }> {
    const result = await this.runtime.maintenance("verify");
    return result.ok
      ? { ok: true, findings: result.findings as IntegrityFinding[] }
      : { ok: false, findings: [], error: result.error };
  }

  /** Reconcile the on-disk record directory after an interrupted run. */
  async recover(): Promise<{ ok: boolean; recovered: string[]; error?: string }> {
    return this.runtime.maintenance("recover");
  }

  async cleanup(approver: string, policy: DurabilityPolicy = DEFAULT_DURABILITY_POLICY): Promise<CleanupResult> {
    if (!approver.trim()) return { ok: false, removed: [], kept: [], error: "Cleanup requires a named operator." };
    const decision = ApprovalGate.getInstance().authorize(
      "destructive",
      "acquisition-maintenance",
      approver,
      `Clean experimental acquisitions older than ${policy.maxAgeDays} days`,
    );
    if (!decision.allowed) return { ok: false, removed: [], kept: [], error: decision.reason };

    const grant = await this.runtime.approve({ scope: "destructive", targetId: "acquisition-maintenance" });
    if (!grant.ok) {
      return { ok: false, removed: [], kept: [], error: `The runtime refused the cleanup approval: ${grant.error}` };
    }
    const result = await this.runtime.maintenance("cleanup", {
      policy,
      approval: grant.nonce,
    });
    ApprovalGate.getInstance().consume("destructive", "acquisition-maintenance");
    return result;
  }
}
