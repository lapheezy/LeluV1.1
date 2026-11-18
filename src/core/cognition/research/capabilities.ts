/**
 * ==========================================================
 * LÉLU
 * KNOWLEDGE → CAPABILITY (WP08)
 *
 * A verified discovery is not a capability. It becomes one only
 * when it is expressed as something that runs, with acceptance
 * criteria that can fail. This pipeline holds that line:
 *
 *   promote()  only accepts an entry whose status is `verified`
 *              and which carries measured evidence
 *   verify()   only accepts a recorded test outcome, and records
 *              the exact command, so the claim re-runs rather than
 *              being remembered
 *
 * A capability whose last verification is older than its acceptance
 * test is reported as stale, not as working.
 * ==========================================================
 */

import type { CapabilityRecord, EvidenceRef, ResearchEntry } from "./types";
import { MEASURED_EVIDENCE } from "./types";
import ResearchStore from "./store";

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityError";
  }
}

export interface CapabilityInput {
  name: string;
  acceptance: string[];
  testCommand: string;
  notes?: string[];
}

export default class CapabilityPipeline {
  constructor(
    private readonly store: ResearchStore,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  public all(): CapabilityRecord[] {
    return this.store
      .listDocs("capabilities")
      .map((name) => this.store.readDoc<CapabilityRecord>(`capabilities/${name}`))
      .filter((item): item is CapabilityRecord => item !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  public get(id: string): CapabilityRecord | null {
    return this.all().find((item) => item.id === id) ?? null;
  }

  /**
   * Turn a verified discovery into a candidate capability.
   *
   * Refused for anything that is not verified: promoting a hypothesis
   * is how "we think this works" becomes "this is a feature" without
   * a single test in between.
   */
  public promote(entry: ResearchEntry, input: CapabilityInput): CapabilityRecord {
    if (entry.status !== "verified") {
      throw new CapabilityError(`cannot promote ${entry.id}: status is "${entry.status}", not "verified"`);
    }
    if (!entry.evidence.some((item) => MEASURED_EVIDENCE.includes(item.kind))) {
      throw new CapabilityError(`cannot promote ${entry.id}: no measured evidence`);
    }
    if (input.acceptance.length === 0) throw new CapabilityError("a capability needs at least one acceptance criterion");
    if (!input.testCommand.trim()) throw new CapabilityError("a capability needs the command that proves it");

    const record: CapabilityRecord = {
      id: `C-${entry.id.replace(/^R-/, "")}`,
      name: input.name,
      fromEntryId: entry.id,
      status: "proposed",
      acceptance: input.acceptance,
      testCommand: input.testCommand,
      evidence: entry.evidence.filter((item: EvidenceRef) => MEASURED_EVIDENCE.includes(item.kind)),
      createdAt: this.clock(),
      verifiedAt: null,
      notes: input.notes ?? [],
    };
    this.store.writeDoc(`capabilities/${record.id}.json`, record);
    return record;
  }

  /** Record the outcome of the acceptance test. Failure is a valid outcome. */
  public verify(
    id: string,
    outcome: { passed: boolean; command: string; evidence: EvidenceRef[]; note?: string },
  ): CapabilityRecord {
    const record = this.get(id);
    if (!record) throw new CapabilityError(`no capability ${id}`);
    if (outcome.evidence.length === 0) throw new CapabilityError("a verification needs evidence");
    const next: CapabilityRecord = {
      ...record,
      status: outcome.passed ? "verified" : "proposed",
      verifiedAt: outcome.passed ? this.clock() : null,
      testCommand: outcome.command || record.testCommand,
      evidence: [...record.evidence, ...outcome.evidence],
      notes: outcome.note ? [...record.notes, outcome.note] : record.notes,
    };
    this.store.writeDoc(`capabilities/${id}.json`, next);
    return next;
  }

  /** Verified capabilities whose test has not been seen recently. */
  public stale(now = this.clock(), maxAgeDays = 30): CapabilityRecord[] {
    return this.all().filter(
      (record) =>
        record.status === "verified" &&
        record.verifiedAt !== null &&
        now - record.verifiedAt > maxAgeDays * 86_400_000,
    );
  }
}
