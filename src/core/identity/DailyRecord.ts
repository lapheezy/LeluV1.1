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
}

export type DailyRecordField = Exclude<keyof LeluDailyRecord, "date" | "generatedAt" | "traitChanges">;

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
  };
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
