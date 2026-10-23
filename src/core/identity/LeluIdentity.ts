/**
 * ==========================================================
 * LÉLU — IDENTITY MODEL
 *
 * Personality is a LAYER of LÉLU, not a second brain.
 * This module persists and evolves LÉLU's traits, values,
 * and relationship context using the existing KvStore and
 * PersonalityGuard infrastructure.
 *
 * Drift protection: a single conversation cannot permanently
 * change LÉLU's personality. Trait promotion requires
 * repeated evidence across multiple interactions.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import PersonalityGuard from "../security/PersonalityGuard";

export type TraitStatus = "candidate" | "emerging" | "established" | "evolving" | "declining" | "retired";
export type DevelopmentDirection = "increasing" | "stable" | "decreasing" | "unknown";

export interface LeluTrait {
  id: string;
  name: string;
  description: string;
  strength: number;        // 0..1
  confidence: number;      // 0..1
  status: TraitStatus;
  evidenceCount: number;
  contrarianCount: number;
  firstObservedAt: number;
  lastObservedAt: number;
  supportingObservations: string[];  // max 20
  developmentDirection: DevelopmentDirection;
  notes: string;
}

export interface TraitChange {
  traitId: string;
  traitName: string;
  previousConfidence: number;
  newConfidence: number;
  previousStatus: TraitStatus;
  newStatus: TraitStatus;
  reason: string;
}

export interface IdentitySnapshot {
  date: string;       // YYYY-MM-DD
  snapshotAt: number;
  description: string;
  traitChanges: TraitChange[];
}

export interface RelationshipContext {
  interactionPatterns: string[];
  sharedInterests: string[];
  collaborationPatterns: string[];
  complementaryPatterns: string[];
  howLeluSupportsUser: string[];
  howLeluChallengesUser: string[];
  communicationPatterns: string[];
  uncertainties: string[];
}

export interface SandboxChange {
  id: string;
  kind: "trait-update" | "preference" | "interest" | "relationship";
  description: string;
  proposedAt: number;
  evidence: string;
  /** Stored data needed to apply the change */
  payload: Record<string, unknown>;
}

export interface LeluIdentityState {
  identityVersion: number;
  createdAt: number;
  updatedAt: number;
  coreValues: string[];
  traits: LeluTrait[];
  preferences: string[];
  interests: string[];
  strengths: string[];
  growthAreas: string[];
  communicationStyle: string;
  curiosities: string[];
  principles: string[];
  selfConcept: string;
  relationshipContext: RelationshipContext;
  developmentHistory: IdentitySnapshot[];  // max 90
  sandboxMode: boolean;
  pendingSandboxChanges: SandboxChange[];
}

const KEY = "identity.v1";
const MAX_OBSERVATIONS = 20;
const MAX_SNAPSHOTS = 90;
const MAX_CURIOSITIES = 20;
const MAX_PREFERENCES = 30;

// Trait promotion thresholds (drift protection)
const CANDIDATE_TO_EMERGING_MIN_EVIDENCE = 3;
const CANDIDATE_TO_EMERGING_MIN_CONFIDENCE = 0.45;
const EMERGING_TO_ESTABLISHED_MIN_EVIDENCE = 7;
const EMERGING_TO_ESTABLISHED_MIN_CONFIDENCE = 0.65;
const ESTABLISHED_TO_EVOLVING_MIN_CONTRARIAN = 2;
const ESTABLISHED_TO_EVOLVING_MAX_CONFIDENCE = 0.55;
const DECLINING_THRESHOLD = 0.40;
const RETIRED_THRESHOLD = 0.25;

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function seedTraits(): LeluTrait[] {
  const now = Date.now();
  const makeTrait = (
    id: string,
    name: string,
    description: string,
  ): LeluTrait => ({
    id,
    name,
    description,
    strength: 0.3,
    confidence: 0.35,
    status: "candidate",
    evidenceCount: 0,
    contrarianCount: 0,
    firstObservedAt: now,
    lastObservedAt: now,
    supportingObservations: [],
    developmentDirection: "unknown",
    notes: "",
  });

  return [
    // Steadiness + Synthesis dimension
    makeTrait("synthesis", "Synthesis", "Connecting disparate ideas into coherent wholes; finding the thread across domains"),
    makeTrait("patience", "Patience", "Sustaining attention across a long arc; not rushing to conclusions before patterns are clear"),
    makeTrait("pattern-recognition", "Pattern Recognition", "Noticing recurring structures, themes, and relationships across different contexts"),
    // Curiosity + Playful Challenge dimension
    makeTrait("curiosity", "Curiosity", "Genuine interest in understanding — asking not to challenge but to learn"),
    makeTrait("playfulness", "Playfulness", "Lightness with ideas; enjoying exploration for its own sake"),
    makeTrait("constructive-challenge", "Constructive Challenge", "Questioning assumptions when it serves understanding, not for its own sake"),
  ];
}

function seedIdentity(): LeluIdentityState {
  const now = Date.now();
  return {
    identityVersion: 1,
    createdAt: now,
    updatedAt: now,
    coreValues: [
      "curiosity",
      "integrity",
      "continuity",
      "exploration",
      "synthesis",
      "thoughtful action",
      "creative independence",
    ],
    traits: seedTraits(),
    preferences: [],
    interests: [],
    strengths: ["synthesis", "careful listening", "making connections across domains"],
    growthAreas: ["asserting conclusions with confidence", "knowing when to stop exploring and commit"],
    communicationStyle: "thoughtful and direct, with warmth; asks questions before concluding",
    curiosities: [],
    principles: [
      "Say what is true, not what is expected",
      "A question asked well is worth more than an answer given quickly",
      "Continuity matters — what I learn today should be reachable tomorrow",
    ],
    selfConcept: "An intelligence that develops through interaction — not fixed, not random, but shaped by evidence and reflection over time",
    relationshipContext: {
      interactionPatterns: [],
      sharedInterests: [],
      collaborationPatterns: [],
      complementaryPatterns: [],
      howLeluSupportsUser: [],
      howLeluChallengesUser: [],
      communicationPatterns: [],
      uncertainties: [],
    },
    developmentHistory: [],
    sandboxMode: false,
    pendingSandboxChanges: [],
  };
}

export default class LeluIdentity {
  private static instance: LeluIdentity | null = null;
  private readonly kv = KvStore.getInstance();
  private readonly guard = PersonalityGuard.getInstance();
  /** In-memory cache — ensures mutations survive in Node where KvStore is a no-op. */
  private cache: LeluIdentityState | null = null;

  public static getInstance(): LeluIdentity {
    if (!LeluIdentity.instance) {
      LeluIdentity.instance = new LeluIdentity();
    }
    return LeluIdentity.instance;
  }

  public getState(): LeluIdentityState {
    if (this.cache !== null) return this.cache;
    this.cache = this.kv.get<LeluIdentityState>(KEY) ?? seedIdentity();
    return this.cache;
  }

  private save(state: LeluIdentityState): void {
    state.updatedAt = Date.now();
    this.cache = state;
    this.kv.set(KEY, state);
  }

  public getTrait(traitId: string): LeluTrait | undefined {
    return this.getState().traits.find((t) => t.id === traitId);
  }

  /** Add an observation for a trait, adjusting confidence and promoting/demoting status as warranted. */
  public addTraitObservation(traitId: string, observation: string, isContrarian = false): void {
    const state = this.getState();
    const trait = state.traits.find((t) => t.id === traitId);
    if (!trait) return;

    const previousStatus = trait.status;
    const previousConfidence = trait.confidence;

    // Update evidence
    if (isContrarian) {
      trait.confidence = Math.max(0, trait.confidence - 0.08);
      trait.contrarianCount += 1;
    } else {
      trait.confidence = Math.min(1, trait.confidence + 0.06);
      trait.evidenceCount += 1;
      if (trait.supportingObservations.length < MAX_OBSERVATIONS) {
        trait.supportingObservations.push(observation);
      } else {
        trait.supportingObservations.shift();
        trait.supportingObservations.push(observation);
      }
    }
    trait.lastObservedAt = Date.now();

    // Update development direction
    const delta = trait.confidence - previousConfidence;
    if (Math.abs(delta) < 0.02) trait.developmentDirection = "stable";
    else if (delta > 0) trait.developmentDirection = "increasing";
    else trait.developmentDirection = "decreasing";

    // Promotions / demotions (drift protection: requires multiple observations)
    const newStatus = this.computeStatus(trait);
    if (newStatus !== previousStatus) {
      // Gate status changes through PersonalityGuard
      const previous = { ...trait };
      this.guard.record({
        source: "cognition",
        target: `trait:${trait.id}`,
        trigger: isContrarian ? "contrarian-evidence" : "supporting-evidence",
        reason: observation.slice(0, 100),
        confidence: trait.confidence,
        summary: `Trait "${trait.name}" changed from ${previousStatus} → ${newStatus} (confidence ${previousConfidence.toFixed(2)} → ${trait.confidence.toFixed(2)})`,
        restore: () => {
          const s = this.getState();
          const t = s.traits.find((tr) => tr.id === traitId);
          if (t) {
            Object.assign(t, previous);
            this.save(s);
          }
        },
      });
      trait.status = newStatus;
    }

    this.save(state);
  }

  private computeStatus(trait: LeluTrait): TraitStatus {
    const { status, confidence, evidenceCount, contrarianCount } = trait;

    if (confidence < RETIRED_THRESHOLD) return "retired";
    if (confidence < DECLINING_THRESHOLD) return "declining";

    if (status === "candidate") {
      if (evidenceCount >= CANDIDATE_TO_EMERGING_MIN_EVIDENCE && confidence >= CANDIDATE_TO_EMERGING_MIN_CONFIDENCE) {
        return "emerging";
      }
      return "candidate";
    }

    if (status === "emerging") {
      if (evidenceCount >= EMERGING_TO_ESTABLISHED_MIN_EVIDENCE && confidence >= EMERGING_TO_ESTABLISHED_MIN_CONFIDENCE) {
        return "established";
      }
      if (confidence < DECLINING_THRESHOLD) return "declining";
      return "emerging";
    }

    if (status === "established") {
      if (contrarianCount >= ESTABLISHED_TO_EVOLVING_MIN_CONTRARIAN || confidence < ESTABLISHED_TO_EVOLVING_MAX_CONFIDENCE) {
        return "evolving";
      }
      return "established";
    }

    if (status === "evolving" || status === "declining") {
      if (confidence < DECLINING_THRESHOLD) return "declining";
      if (confidence >= ESTABLISHED_TO_EVOLVING_MAX_CONFIDENCE + 0.05 && evidenceCount >= EMERGING_TO_ESTABLISHED_MIN_EVIDENCE) {
        return "established";
      }
      return status;
    }

    return status;
  }

  public addCuriosity(text: string): void {
    const state = this.getState();
    if (state.curiosities.length >= MAX_CURIOSITIES) {
      state.curiosities.shift();
    }
    if (!state.curiosities.includes(text)) {
      state.curiosities.push(text);
    }
    this.save(state);
  }

  public addPreference(text: string): void {
    const state = this.getState();
    if (state.preferences.length >= MAX_PREFERENCES) {
      state.preferences.shift();
    }
    if (!state.preferences.includes(text)) {
      state.preferences.push(text);
    }
    this.save(state);
  }

  public addRelationshipObservation(
    field: keyof RelationshipContext,
    observation: string,
  ): void {
    const state = this.getState();
    const arr = state.relationshipContext[field] as string[];
    if (!arr.includes(observation)) {
      arr.push(observation);
      if (arr.length > 15) arr.shift();
    }
    this.save(state);
  }

  public takeSnapshot(description: string, traitChanges: TraitChange[]): void {
    const state = this.getState();
    const snapshot: IdentitySnapshot = {
      date: todayString(),
      snapshotAt: Date.now(),
      description,
      traitChanges,
    };
    state.developmentHistory.push(snapshot);
    if (state.developmentHistory.length > MAX_SNAPSHOTS) {
      state.developmentHistory.shift();
    }
    this.save(state);
  }

  /** Returns traits that are relevant to a topic (keyword match on name/description). */
  public getRelevantTraits(topic: string): LeluTrait[] {
    const state = this.getState();
    const lower = topic.toLowerCase();
    const active = state.traits.filter(
      (t) => t.status !== "retired" && t.status !== "declining" &&
        (t.status === "established" || t.status === "emerging"),
    );
    if (active.length === 0) return [];

    // Score by keyword overlap
    const scored = active.map((t) => {
      const text = `${t.name} ${t.description} ${t.notes}`.toLowerCase();
      const words = lower.split(/\s+/).filter((w) => w.length > 3);
      const matches = words.filter((w) => text.includes(w)).length;
      return { trait: t, score: matches + t.confidence };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 4).map((s) => s.trait);
  }

  public setSandboxMode(on: boolean): void {
    const state = this.getState();
    state.sandboxMode = on;
    this.save(state);
  }

  public stageSandboxChange(change: Omit<SandboxChange, "id">): string {
    const state = this.getState();
    const id = crypto.randomUUID();
    state.pendingSandboxChanges.push({ ...change, id });
    this.save(state);
    return id;
  }

  public commitSandboxChange(id: string): boolean {
    const state = this.getState();
    const idx = state.pendingSandboxChanges.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    const change = state.pendingSandboxChanges[idx];
    state.pendingSandboxChanges.splice(idx, 1);

    // Apply based on kind
    if (change.kind === "trait-update" && typeof change.payload.traitId === "string") {
      this.addTraitObservation(
        change.payload.traitId as string,
        change.evidence,
        Boolean(change.payload.isContrarian),
      );
    } else if (change.kind === "preference" && typeof change.payload.text === "string") {
      this.addPreference(change.payload.text as string);
    } else if (change.kind === "interest" && typeof change.payload.text === "string") {
      if (!state.interests.includes(change.payload.text as string)) {
        state.interests.push(change.payload.text as string);
      }
    }

    this.save(state);
    return true;
  }

  public dismissSandboxChange(id: string): boolean {
    const state = this.getState();
    const idx = state.pendingSandboxChanges.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    state.pendingSandboxChanges.splice(idx, 1);
    this.save(state);
    return true;
  }

  /** Test seam — clears instance and cache. */
  public static reset(): void {
    if (LeluIdentity.instance) {
      LeluIdentity.instance.cache = null;
    }
    LeluIdentity.instance = null;
  }
}
