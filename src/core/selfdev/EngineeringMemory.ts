/**
 * ==========================================================
 * LÉLU
 * ENGINEERING MEMORY — retrievable self-development history
 *
 * Explicit records of what LÉLU has attempted and learned while
 * engineering herself and her projects: improvement attempts,
 * successful/failed upgrades, rollbacks, regressions, UI
 * experiments, architecture decisions, performance findings and
 * engineering lessons. Cognition can query this so she does not
 * rediscover her own architecture or repeat failed experiments.
 *
 * Persisted through the shared KvStore, offline-first.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type EngineeringMemoryKind =
  | "attempt"
  | "upgrade"
  | "rollback"
  | "regression"
  | "lesson"
  | "architecture"
  | "ui-experiment"
  | "performance"
  | "tool-run";

export interface EngineeringMemoryEntry {
  id: string;
  kind: EngineeringMemoryKind;
  /** Normalized subject — e.g. "memory-retrieval-indexing". */
  topic: string;
  summary: string;
  outcome: "success" | "failure" | "neutral";
  detail?: string;
  improvementId?: string;
  version?: string;
  timestamp: number;
}

const KEY = "lelu.selfdev.engineering-memory.v1";
const MAX_ENTRIES = 200;

export function normalizeTopic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default class EngineeringMemory {
  private static instance: EngineeringMemory | null = null;
  private entries: EngineeringMemoryEntry[];

  private constructor() {
    this.entries = KvStore.getInstance().get<EngineeringMemoryEntry[]>(KEY) ?? [];
  }

  public static getInstance(): EngineeringMemory {
    if (!EngineeringMemory.instance) {
      EngineeringMemory.instance = new EngineeringMemory();
    }
    return EngineeringMemory.instance;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.entries);
    } catch {
      // best-effort
    }
  }

  public record(input: Omit<EngineeringMemoryEntry, "id" | "timestamp">): EngineeringMemoryEntry {
    const entry: EngineeringMemoryEntry = {
      ...input,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES);
    this.persist();
    return entry;
  }

  public list(): EngineeringMemoryEntry[] {
    return [...this.entries].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Has LÉLU attempted something on this topic before? */
  public hasAttempted(topic: string): boolean {
    const key = normalizeTopic(topic);
    if (!key) {
      return false;
    }
    return this.entries.some((entry) => entry.topic === key || entry.topic.includes(key) || key.includes(entry.topic));
  }

  /** Retrievable by cognition — fuzzy match over topic + text. */
  public retrieve(query: string, limit = 20): EngineeringMemoryEntry[] {
    const key = normalizeTopic(query);
    const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
    return this.list()
      .filter((entry) => {
        if (!key) {
          return false;
        }
        const haystack = `${entry.topic} ${entry.summary} ${entry.detail ?? ""}`.toLowerCase();
        if (haystack.includes(key)) {
          return true;
        }
        return tokens.some((token) => haystack.includes(token));
      })
      .slice(0, limit);
  }

  public remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.persist();
  }

  public clear(): void {
    this.entries = [];
    this.persist();
  }
}
