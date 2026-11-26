/**
 * ==========================================================
 * LÉLU — DEVELOPMENT JOURNAL
 *
 * Her memory of her own engineering, assembled from the records
 * that already exist — not a second diary that can disagree with
 * them:
 *
 *   VersionHistory   → what was changed, with the checks that ran
 *   EngineeringMemory→ attempts, upgrades, lessons, regressions
 *   ImprovementQueue → runs and their measured checks
 *   DailyRecord      → what the day actually contained
 *   MISSION_LEDGER   → missions, their commits and their evidence
 *
 * Every entry carries where it came from and whether it is
 * VERIFIED (a named check passed) or merely recorded. The journal
 * is what lets the improvement system compare a new idea against
 * work already done, instead of recommending it again.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import DailyRecord from "../identity/DailyRecord";
import EngineeringMemory from "./EngineeringMemory";
import VersionHistory, { type VersionRecord } from "./VersionHistory";
import ImprovementQueue, { type ImprovementProposal } from "./ImprovementQueue";

export type JournalKind = "mission" | "improvement" | "upgrade" | "verification" | "lesson" | "daily" | "explicit";

export interface MissionRecord {
  id: string;
  title: string;
  /** The commit the mission landed in, when it is known. */
  commit?: string;
  /** Capability ids the mission changed or proved. */
  capabilities: string[];
  /** Test files that verify it. */
  evidence: string[];
  at: number;
  summary: string;
}

export interface JournalEntry {
  id: string;
  at: number;
  kind: JournalKind;
  title: string;
  detail: string;
  capabilities: string[];
  evidence: string[];
  missionId?: string;
  commit?: string;
  improvementId?: string;
  /** True only when a named check measured the outcome. */
  verified: boolean;
  source: "version" | "memory" | "execution" | "daily" | "ledger" | "explicit";
}

const KEY = "lelu.selfdev.journal.v1";
const MAX_EXPLICIT = 200;

/**
 * Missions that are traceable to a commit and to checks in this
 * repository. `npm test` runs the evidence files; a mission whose
 * evidence files are missing is caught by tests/self-awareness.test.ts
 * rather than trusted here.
 */
export const MISSION_LEDGER: MissionRecord[] = [
  {
    id: "mission-16",
    title: "Cosmos object ecosystem",
    capabilities: ["cosmos-navigation", "visual"],
    evidence: [
      "tests/cosmos-objects.test.ts",
      "tests/cosmos-object-placement.test.ts",
      "tests/cosmos-object-verification.test.ts",
    ],
    at: Date.parse("2026-11-19T00:00:00Z"),
    summary: "Objects in the Cosmos are pointers to real records, placed and verified rather than copied.",
  },
  {
    id: "mission-17",
    title: "Cosmos object experience",
    capabilities: ["cosmos-navigation", "visual"],
    evidence: ["tests/cosmos-object-experience.test.ts", "tests/cosmos-object-continuity.test.ts"],
    at: Date.parse("2026-11-21T00:00:00Z"),
    summary: "Objects keep their identity across visits and the camera remembers where they are.",
  },
  {
    id: "mission-41",
    title: "Orbital navigation & self-awareness reconciliation",
    capabilities: ["cosmos-navigation", "self-model", "self-development", "self-diagnostics"],
    evidence: ["tests/spatial-orbit.test.ts", "tests/self-awareness.test.ts", "tests/spatial-experience.test.ts"],
    at: Date.parse("2026-11-26T00:00:00Z"),
    summary:
      "The Cosmos is navigated by an orbit of category orbs around LÉLU Core; the improvement queue is reconciled against capability evidence and the journal.",
  },
];

function parsePassed(results: string): { passed: number; total: number } | null {
  const match = results.match(/(\d+)\s*\/\s*(\d+)\s+passed/i);
  if (!match) return null;
  return { passed: Number(match[1]), total: Number(match[2]) };
}

function versionEntry(record: VersionRecord): JournalEntry {
  const parsed = parsePassed(record.results);
  const verified = Boolean(parsed && parsed.total > 0 && parsed.passed === parsed.total);
  return {
    id: `version-${record.id}`,
    at: record.createdAt,
    kind: "upgrade",
    title: record.changeDescription || "Self-development change",
    detail: [record.tests && `checks: ${record.tests}`, record.results && `result: ${record.results}`]
      .filter(Boolean)
      .join(" · "),
    capabilities: [],
    evidence: [record.improvementId ? `improvement ${record.improvementId}` : "", record.filesChanged.join(", ")]
      .filter(Boolean),
    improvementId: record.improvementId,
    verified,
    source: "version",
  };
}

function executionEntry(proposal: ImprovementProposal): JournalEntry[] {
  return (proposal.executions ?? []).map((execution) => {
    const verified = execution.checks.length > 0 && execution.checks.every((check) => check.ok === true);
    return {
      id: `execution-${execution.executionId}`,
      at: execution.finished ?? execution.started,
      kind: "verification",
      title: `${execution.kind === "apply" ? "Applied" : "Developed"}: ${proposal.title}`,
      detail: execution.checks.map((check) => `${check.name}: ${check.ok === true ? "ok" : check.ok === false ? "failed" : "not run"}`).join(" · "),
      capabilities: proposal.capabilityId ? [proposal.capabilityId] : [],
      evidence: execution.filesChanged,
      improvementId: proposal.id,
      verified,
      source: "execution",
    };
  });
}

export default class DevelopmentJournal {
  private static instance: DevelopmentJournal | null = null;
  private explicit: JournalEntry[];

  private constructor() {
    this.explicit = KvStore.getInstance().get<JournalEntry[]>(KEY) ?? [];
  }

  public static getInstance(): DevelopmentJournal {
    if (!DevelopmentJournal.instance) DevelopmentJournal.instance = new DevelopmentJournal();
    return DevelopmentJournal.instance;
  }

  /** Test seam: drop the singleton and its in-memory cache. */
  public static reset(): void {
    DevelopmentJournal.instance = null;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.explicit);
    } catch {
      // best-effort
    }
  }

  /** Record something that has no other home (a reconciliation, a decision). */
  public record(input: Omit<JournalEntry, "id" | "at" | "source" | "kind"> & { kind?: JournalKind; at?: number }): JournalEntry {
    const entry: JournalEntry = {
      ...input,
      id: crypto.randomUUID(),
      at: input.at ?? Date.now(),
      kind: input.kind ?? "explicit",
      source: "explicit",
    };
    this.explicit = [entry, ...this.explicit].slice(0, MAX_EXPLICIT);
    this.persist();
    return entry;
  }

  /**
   * The whole journal, newest first: ledger, versions, real runs,
   * engineering memory, the day's own record and explicit entries.
   */
  public entries(): JournalEntry[] {
    const fromLedger: JournalEntry[] = MISSION_LEDGER.map((mission) => ({
      id: `mission-${mission.id}`,
      at: mission.at,
      kind: "mission",
      title: mission.title,
      detail: mission.summary,
      capabilities: mission.capabilities,
      evidence: mission.evidence,
      missionId: mission.id,
      commit: mission.commit,
      verified: mission.evidence.length > 0,
      source: "ledger",
    }));

    const fromVersions = VersionHistory.getInstance().listVersions().map(versionEntry);

    const queue = ImprovementQueue.getInstance();
    const fromExecutions = queue.list().flatMap(executionEntry);

    const fromMemory: JournalEntry[] = EngineeringMemory.getInstance()
      .list()
      .map((entry) => ({
        id: `memory-${entry.id}`,
        at: entry.timestamp,
        kind: entry.kind === "upgrade" ? "upgrade" : entry.kind === "regression" ? "verification" : "lesson",
        title: entry.summary.slice(0, 140),
        detail: entry.detail ?? entry.topic,
        capabilities: [],
        evidence: [entry.topic, entry.version].filter(Boolean) as string[],
        improvementId: entry.improvementId,
        verified: entry.kind === "upgrade" && /verified/i.test(entry.summary),
        source: "memory",
      }));

    const fromDaily = DailyRecord.getInstance()
      .getAll()
      .flatMap((record) =>
        [...record.lessons, ...record.selfReflection, ...record.experiences].map((line, index) => ({
          id: `daily-${record.date}-${index}-${line.slice(0, 12)}`,
          at: record.generatedAt,
          kind: "daily" as JournalKind,
          title: line.slice(0, 140),
          detail: `Daily record ${record.date}`,
          capabilities: [] as string[],
          evidence: [] as string[],
          verified: false,
          source: "daily" as const,
        })),
      );

    const all = [...this.explicit, ...fromLedger, ...fromVersions, ...fromExecutions, ...fromMemory, ...fromDaily];
    const seen = new Set<string>();
    return all
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .sort((a, b) => b.at - a.at);
  }

  public latest(limit = 10): JournalEntry[] {
    return this.entries().slice(0, limit);
  }

  public since(timestamp: number): JournalEntry[] {
    return this.entries().filter((entry) => entry.at >= timestamp);
  }

  public forCapability(capabilityId: string): JournalEntry[] {
    return this.entries().filter((entry) => entry.capabilities.includes(capabilityId));
  }

  public forImprovement(improvementId: string): JournalEntry[] {
    return this.entries().filter((entry) => entry.improvementId === improvementId);
  }

  /** Was this work already done — verified, not merely attempted? */
  public alreadyDone(topic: string): JournalEntry | null {
    const tokens = topic.toLowerCase().split(/\s+/).filter((token) => token.length > 3);
    return (
      this.entries().find((entry) => {
        if (!entry.verified) return false;
        const haystack = `${entry.title} ${entry.detail}`.toLowerCase();
        return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
      }) ?? null
    );
  }

  /** The mission that names this capability, most recent first. */
  public missionsFor(capabilityId: string): JournalEntry[] {
    return this.entries().filter((entry) => entry.kind === "mission" && entry.capabilities.includes(capabilityId));
  }
}
