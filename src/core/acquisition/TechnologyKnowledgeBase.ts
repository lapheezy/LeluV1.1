/**
 * ==========================================================
 * LÉLU — TECHNOLOGY KNOWLEDGE BASE
 *
 * What she has actually learned about the technology she has
 * researched: repositories, their capabilities, licenses,
 * maintenance signals and integration outcomes.
 *
 * Search is the acquired fuzzy-search capability (Bitap,
 * adapted from Fuse — see capabilities/NOTICE.md). Without it
 * a query had to match a stored string exactly; with it the
 * base is searchable the way she actually asks questions
 * ("fuzzy search" → "Lightweight fuzzy-search library").
 *
 * Entries are written only from real research or integration
 * results; an entry always carries its source identifier and,
 * when known, the commit it was studied at.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { licenseObligations, licenseRisk, type LicenseRisk, type ResearchFindings } from "./AcquisitionTypes";
import { fuzzySearch, highlightMatch } from "./capabilities/FuzzyTextSearch";

const KEY = "lelu.technology.knowledge.v1";
const MAX_ENTRIES = 400;

export interface TechnologyEntry {
  id: string;
  title: string;
  sourceIdentifier: string;
  url: string;
  commit: string;
  license: string;
  licenseRisk: LicenseRisk;
  capabilities: string[];
  tags: string[];
  summary: string;
  buildSystem: string;
  dependencies: string[];
  maintenance: {
    lastCommitAt: string;
    commitsLast90Days: number;
    stars: number;
    openIssues: number;
    archived: boolean;
  };
  /** Set when LÉLU actually adapted and registered it. */
  integration: {
    capabilityId: string;
    registeredTools: string[];
    integratedAt: number;
  } | null;
  addedAt: number;
  updatedAt: number;
}

export interface KnowledgeSearchHit {
  entry: TechnologyEntry;
  score: number;
  field: string;
  /** Matched headline with its ranges marked, for surfacing in chat. */
  highlighted: string;
}

function entryId(identifier: string): string {
  return `tech:${identifier.toLowerCase()}`;
}

export default class TechnologyKnowledgeBase {
  private static instance: TechnologyKnowledgeBase | null = null;
  private entries: TechnologyEntry[];

  private constructor() {
    this.entries = this.load();
  }

  static getInstance(): TechnologyKnowledgeBase {
    if (!TechnologyKnowledgeBase.instance) {
      TechnologyKnowledgeBase.instance = new TechnologyKnowledgeBase();
    }
    return TechnologyKnowledgeBase.instance;
  }

  static resetForTests(): void {
    TechnologyKnowledgeBase.instance = null;
  }

  private load(): TechnologyEntry[] {
    try {
      const stored = KvStore.getInstance().get<TechnologyEntry[]>(KEY);
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.entries.slice(0, MAX_ENTRIES));
    } catch {
      /* local persistence is best-effort */
    }
  }

  size(): number {
    return this.entries.length;
  }

  list(): TechnologyEntry[] {
    return [...this.entries];
  }

  get(id: string): TechnologyEntry | null {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  getByIdentifier(identifier: string): TechnologyEntry | null {
    return this.get(entryId(identifier));
  }

  /** Record real research findings. */
  addFromResearch(candidate: {
    id: string;
    identifier: string;
    url: string;
    description: string;
    topics: string[];
    stars: number;
    license: string;
  }, findings: ResearchFindings, commit: string): TechnologyEntry {
    return this.upsert({
      id: entryId(candidate.identifier),
      title: candidate.identifier,
      sourceIdentifier: candidate.identifier,
      url: candidate.url,
      commit,
      license: findings.license.spdx || candidate.license,
      licenseRisk: findings.license.risk,
      capabilities: findings.capabilities,
      tags: [...new Set([...candidate.topics, findings.buildSystem, findings.compatibility.runtime])].filter(Boolean),
      summary: candidate.description || findings.summary,
      buildSystem: findings.buildSystem,
      dependencies: findings.dependencies,
      maintenance: {
        lastCommitAt: findings.maintenance.lastCommitAt,
        commitsLast90Days: findings.maintenance.commitsLast90Days,
        stars: findings.maintenance.stars,
        openIssues: findings.maintenance.openIssues,
        archived: findings.maintenance.archived,
      },
      integration: null,
    });
  }

  upsert(entry: Omit<TechnologyEntry, "addedAt" | "updatedAt">): TechnologyEntry {
    const existing = this.get(entry.id);
    const finished: TechnologyEntry = {
      ...entry,
      addedAt: existing?.addedAt ?? Date.now(),
      updatedAt: Date.now(),
      licenseRisk: entry.licenseRisk ?? licenseRisk(entry.license),
      integration: entry.integration ?? existing?.integration ?? null,
    };
    this.entries = [finished, ...this.entries.filter((candidate) => candidate.id !== finished.id)];
    this.persist();
    return finished;
  }

  /** Attach the real integration outcome to an entry. */
  markIntegrated(
    identifier: string,
    integration: { capabilityId: string; registeredTools: string[] },
  ): TechnologyEntry | null {
    const entry = this.getByIdentifier(identifier);
    if (!entry) return null;
    return this.upsert({
      ...entry,
      integration: { ...integration, integratedAt: Date.now() },
    });
  }

  remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.persist();
  }

  /** Obligations for an entry's license, or an honest "unknown". */
  obligations(identifier: string): string[] {
    const entry = this.getByIdentifier(identifier);
    return entry ? licenseObligations(entry.license) : ["Not researched yet."];
  }

  /**
   * Search — the acquired fuzzy matcher, ranked, with the matched range
   * marked. Empty query lists the most recent entries.
   */
  search(query: string, limit = 8): KnowledgeSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.entries.slice(0, limit).map((entry) => ({
        entry,
        score: 0,
        field: "recent",
        highlighted: entry.title,
      }));
    }

    const hits = fuzzySearch(this.entries, trimmed, {
      keys: (entry) => [
        entry.title,
        entry.summary,
        entry.capabilities.join(" "),
        entry.tags.join(" "),
        entry.dependencies.join(" "),
        entry.buildSystem,
      ],
      threshold: 0.55,
      limit,
      includeMatches: true,
    });

    return hits.map((hit) => ({
      entry: hit.item,
      score: hit.score,
      field: hit.field.slice(0, 160),
      highlighted: highlightMatch(hit.field, hit.indices),
    }));
  }

  /** Context block for cognition: what she knows, and what she integrated. */
  describe(limit = 6): string {
    if (this.entries.length === 0) {
      return "The technology knowledge base is empty: no repository has been researched yet.";
    }
    const recent = this.entries.slice(0, limit);
    const integrated = this.entries.filter((entry) => entry.integration);
    const lines = [
      `Technology knowledge base: ${this.entries.length} researched repositor${this.entries.length === 1 ? "y" : "ies"}, ` +
        `${integrated.length} integrated.`,
      ...recent.map(
        (entry) =>
          `- ${entry.title} (${entry.license}, ${licenseRisk(entry.license)}): ${
            entry.capabilities.slice(0, 4).join(", ") || "no capability signals"
          }${entry.integration ? ` — integrated as ${entry.integration.capabilityId}` : ""}`,
      ),
    ];
    return lines.join("\n");
  }
}
