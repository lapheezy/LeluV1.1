/**
 * ==========================================================
 * LÉLU — DETERMINISTIC CONTINUITY TRANSPORT
 *
 * This is a TEST FIXTURE, not a cloud. Every result it produces is
 * labelled `kind: "simulated"` and must never be reported as real
 * Supabase acceptance.
 *
 * It exists to exercise the failure modes the mission names:
 * stale revisions, duplicate delivery, a lost acknowledgement after
 * a successful write, authentication loss and cloud unavailability.
 * ==========================================================
 */

import type {
  ContinuityAuthority,
  ContinuityOutboxOperation,
  ContinuityPullResult,
  ContinuityPushResult,
  ContinuityRecord,
  ContinuityTransport,
} from "./ContinuityTypes";

export type SimulatedAvailability = "ready" | "authentication_required" | "cloud_unavailable";

interface StoredRecord {
  record: ContinuityRecord;
  cloudRevision: string;
}

export default class SimulatedTransport implements ContinuityTransport {
  public readonly kind = "simulated" as const;

  private records = new Map<ContinuityAuthority, Map<string, StoredRecord>>();
  private acknowledged = new Map<string, string>();
  private revisionCounter = 0;

  public availabilityMode: SimulatedAvailability = "ready";
  public loseNextAcknowledgement = false;
  public failNextPush = false;
  public pushes = 0;

  public availability(): SimulatedAvailability {
    return this.availabilityMode;
  }

  public seed(authority: ContinuityAuthority, records: ContinuityRecord[], revisionPrefix = "cloud"): void {
    const bucket = this.ensure(authority);
    for (const record of records) {
      bucket.set(record.id, {
        record,
        cloudRevision: `${revisionPrefix}-${++this.revisionCounter}`,
      });
    }
  }

  public cloudRecords(authority: ContinuityAuthority): Array<ContinuityRecord & { cloudRevision: string }> {
    return [...this.ensure(authority).values()].map((stored) => ({
      ...stored.record,
      cloudRevision: stored.cloudRevision,
    }));
  }

  public async push(operation: ContinuityOutboxOperation): Promise<ContinuityPushResult> {
    this.pushes += 1;
    if (this.availabilityMode === "authentication_required") {
      return { status: "authentication_required", reason: "simulated session expired" };
    }
    if (this.availabilityMode === "cloud_unavailable") {
      return { status: "cloud_unavailable", reason: "simulated network unavailable" };
    }
    if (this.failNextPush) {
      this.failNextPush = false;
      return { status: "retry_required", reason: "simulated transient write failure", retryAfterMs: 1 };
    }

    const bucket = this.ensure(operation.authority);
    const existing = bucket.get(operation.recordId);
    const alreadyAcknowledged = this.acknowledged.get(operation.idempotencyKey);
    if (alreadyAcknowledged) {
      // Duplicate delivery after a lost acknowledgement: no second write.
      return { status: "applied", cloudRevision: alreadyAcknowledged };
    }

    if (operation.expectedCloudRevision !== null && existing?.cloudRevision !== operation.expectedCloudRevision) {
      return {
        status: "conflict",
        cloudRevision: existing?.cloudRevision ?? null,
        remote: existing?.record ?? null,
        reason: "simulated cloud revision differs from the expected revision",
      };
    }
    if (operation.expectedCloudRevision === null && existing) {
      return {
        status: "conflict",
        cloudRevision: existing.cloudRevision,
        remote: existing.record,
        reason: "simulated record already exists with no base revision",
      };
    }

    const cloudRevision = `cloud-${++this.revisionCounter}`;
    bucket.set(operation.recordId, { record: operation.payload, cloudRevision });
    this.acknowledged.set(operation.idempotencyKey, cloudRevision);

    if (this.loseNextAcknowledgement) {
      this.loseNextAcknowledgement = false;
      // The write happened. The client never sees the ack and retries.
      throw new Error("simulated acknowledgement lost after the cloud write");
    }
    return { status: "applied", cloudRevision };
  }

  public async pull(authority: ContinuityAuthority): Promise<ContinuityPullResult> {
    return {
      records: this.cloudRecords(authority).map((record) => ({
        ...record,
        cloudRevision: record.cloudRevision,
      })),
    };
  }

  private ensure(authority: ContinuityAuthority): Map<string, StoredRecord> {
    let bucket = this.records.get(authority);
    if (!bucket) {
      bucket = new Map();
      this.records.set(authority, bucket);
    }
    return bucket;
  }
}
