/**
 * ==========================================================
 * LÉLU — DAILY DEVELOPMENT RECORD
 *
 * A running log of what happened each day. No fabrication:
 * fields are only populated when actual activity happens.
 * getOrCreateToday() creates an empty record — nothing is
 * invented to make it look populated.
 *
 * Max 180 daily records. Keyed by YYYY-MM-DD date string.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { TraitChange } from "./LeluIdentity";

export interface LeluDailyRecord {
  date: string;                      // YYYY-MM-DD
  experiences: string[];
  meaningfulInteractions: string[];
  observations: string[];
  preferencesObserved: string[];
  selfReflection: string[];
  lessons: string[];
  emergingTraits: string[];
  traitChanges: TraitChange[];
  questions: string[];
  relationshipObservations: string[];
  creativeIdeas: string[];
  tomorrowFocus: string[];
  generatedAt: number;
  /**
   * Behaviour a LÉLU system actually observed, as structured evidence for
   * DailyReflection. One entry per (trait, unit) — a unit is one line of
   * inquiry — so a single investigation can never cast several votes.
   * Optional so records written before it existed still load.
   */
  developmentalEvidence?: DevelopmentalEvidence[];
  /** Set once DailyReflection has processed this day. Days are reflected once. */
  reflection?: DailyReflectionOutcome;
}

export interface DevelopmentalEvidence {
  traitId: string;
  /** The line of inquiry (curiosity chain root) this came from. */
  unitId: string;
  source: "curiosity";
  observation: string;
  at: number;
}

export interface DailyReflectionOutcome {
  at: number;
  meaningful: boolean;
  observations: string[];
  traitChanges: TraitChange[];
  staged: number;
}

export type DailyRecordField = Exclude<
  keyof LeluDailyRecord,
  "date" | "generatedAt" | "traitChanges" | "developmentalEvidence" | "reflection"
>;

/**
 * Provenance of text lines, so reflection can tell behaviour from prose.
 *  - ACCOUNTED: written by a system that ALSO records structured evidence
 *    for the same event (curiosity); counting the text again would double it.
 *  - INTAKE: text read from a document or migrated memory — not LÉLU's
 *    experience at all, and never evidence about her.
 */
export const ACCOUNTED_PREFIXES = ["Curiosity —", "Curious:", "Asked Heru:", "Unresolved:", "Re-checked:", "Assumption changed:", "Strategy:", "Proposed:", "Heru clarified"];
export const INTAKE_PREFIX = "Read in memory intake:";

export function isAccountedOrIntake(line: string): boolean {
  return line.startsWith(INTAKE_PREFIX) || ACCOUNTED_PREFIXES.some((prefix) => line.startsWith(prefix));
}

interface DailyStore {
  records: Record<string, LeluDailyRecord>;
}

const KEY = "daily.v1";
const MAX_RECORDS = 180;

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyRecord(date: string): LeluDailyRecord {
  return {
    date,
    experiences: [],
    meaningfulInteractions: [],
    observations: [],
    preferencesObserved: [],
    selfReflection: [],
    lessons: [],
    emergingTraits: [],
    traitChanges: [],
    questions: [],
    relationshipObservations: [],
    creativeIdeas: [],
    tomorrowFocus: [],
    generatedAt: Date.now(),
    developmentalEvidence: [],
  };
}

function dateOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export default class DailyRecord {
  private static instance: DailyRecord | null = null;
  private readonly kv = KvStore.getInstance();
  /** In-memory cache — ensures mutations survive in Node where KvStore is a no-op. */
  private cache: DailyStore | null = null;

  public static getInstance(): DailyRecord {
    if (!DailyRecord.instance) {
      DailyRecord.instance = new DailyRecord();
    }
    return DailyRecord.instance;
  }

  private load(): DailyStore {
    if (this.cache !== null) return this.cache;
    this.cache = this.kv.get<DailyStore>(KEY) ?? { records: {} };
    return this.cache;
  }

  private save(store: DailyStore): void {
    // Cap at MAX_RECORDS — remove oldest first
    const dates = Object.keys(store.records).sort();
    while (dates.length > MAX_RECORDS) {
      const oldest = dates.shift();
      if (oldest) delete store.records[oldest];
    }
    this.cache = store;
    this.kv.set(KEY, store);
  }

  /** Returns today's record, creating an empty one if none exists. */
  public getOrCreateToday(): LeluDailyRecord {
    const today = todayString();
    const store = this.load();
    if (!store.records[today]) {
      store.records[today] = emptyRecord(today);
      this.save(store);
    }
    return store.records[today];
  }

  /** Append a text item to a string-array field on today's record. */
  public appendToday(field: DailyRecordField, text: string): void {
    const today = todayString();
    const store = this.load();
    if (!store.records[today]) {
      store.records[today] = emptyRecord(today);
    }
    const record = store.records[today];
    const arr = record[field] as string[];
    if (!arr.includes(text)) {
      arr.push(text);
    }
    this.save(store);
  }

  public appendTraitChange(change: TraitChange): void {
    const today = todayString();
    const store = this.load();
    if (!store.records[today]) {
      store.records[today] = emptyRecord(today);
    }
    store.records[today].traitChanges.push(change);
    this.save(store);
  }

  /**
   * Record one unit of observed behaviour for tonight's reflection.
   * Returns false when this (trait, unit) is already recorded — the same
   * line of inquiry never counts twice.
   */
  public recordEvidence(entry: DevelopmentalEvidence, now = Date.now()): boolean {
    const date = dateOf(now);
    const store = this.load();
    if (!store.records[date]) store.records[date] = emptyRecord(date);
    const record = store.records[date];
    const list = record.developmentalEvidence ?? (record.developmentalEvidence = []);
    if (list.some((item) => item.unitId === entry.unitId && item.traitId === entry.traitId)) return false;
    list.push(entry);
    this.save(store);
    return true;
  }

  /** Completed days that have content and have not been reflected yet, oldest first. */
  public awaitingReflection(now = Date.now(), maxDays = 7): LeluDailyRecord[] {
    const today = dateOf(now);
    return this.getAll()
      .filter((record) => record.date < today && !record.reflection)
      .slice(-maxDays);
  }

  public markReflected(date: string, outcome: DailyReflectionOutcome): void {
    const store = this.load();
    const record = store.records[date];
    if (!record) return;
    record.reflection = outcome;
    this.save(store);
  }

  public getByDate(date: string): LeluDailyRecord | null {
    const store = this.load();
    return store.records[date] ?? null;
  }

  public getRecent(days = 7): LeluDailyRecord[] {
    const store = this.load();
    const dates = Object.keys(store.records).sort().reverse().slice(0, days);
    return dates.map((d) => store.records[d]);
  }

  public getAll(): LeluDailyRecord[] {
    const store = this.load();
    return Object.values(store.records).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Test seam — clears instance and cache. */
  public static reset(): void {
    if (DailyRecord.instance) {
      DailyRecord.instance.cache = null;
    }
    DailyRecord.instance = null;
  }
}
