/**
 * ==========================================================
 * LÉLU — LINGUISTIC IDENTITY PROFILE
 *
 * The persistent record of HOW LÉLU talks: her dials, the
 * expressions she has earned the right to use, the vocabulary
 * she UNDERSTANDS but must not parrot, and the counters that
 * make familiarity a fact rather than a performance.
 *
 * This is an extension of the existing identity, not a second
 * one:
 *   • the same trait lifecycle (`TraitStatus`) as LeluIdentity;
 *   • the same drift protection — one conversation can never
 *     promote an expression;
 *   • the same PersonalityGuard audit + rollback;
 *   • the same KvStore persistence and in-memory cache so it
 *     works in Node (tests) and the browser alike.
 *
 * TWO SEPARATE AXES, deliberately:
 *   - `userLingo` is what the USER says. It is understood, never
 *     automatically spoken. Mirroring requires an explicit,
 *     authorised decision.
 *   - `expressions` are LÉLU's OWN habits. They are only spoken
 *     when `adopted` is true, which requires repeated evidence
 *     across distinct days, or an authorised update.
 *
 * External content (a document she read, a migrated memory) can
 * never write either axis. `noteExternalContent()` records the
 * attempt and changes nothing.
 * ==========================================================
 */

import KvStore from "../../storage/KvStore";
import PersonalityGuard from "../../security/PersonalityGuard";
import type { TraitStatus } from "../LeluIdentity";

export type VoiceDialId =
  | "warmth"
  | "directness"
  | "playfulness"
  | "sarcasm"
  | "verbosity"
  | "formality"
  | "emoji"
  | "exclamation";

export const VOICE_DIALS: readonly VoiceDialId[] = [
  "warmth",
  "directness",
  "playfulness",
  "sarcasm",
  "verbosity",
  "formality",
  "emoji",
  "exclamation",
] as const;

export type ExpressionKind = "phrase" | "rhythm" | "humor" | "transition" | "reaction" | "intonation";
export type ExpressionOrigin = "authored" | "learned";

/** Where an item of evidence came from. External sources are not in this union on purpose. */
export type VoiceEvidenceSource = "chat-turn" | "user-feedback" | "reflection" | "authorized";

export interface VoiceEvidence {
  at: number;
  source: VoiceEvidenceSource;
  note: string;
}

export interface VoiceExpression {
  id: string;
  kind: ExpressionKind;
  text: string;
  status: TraitStatus;
  strength: number;
  confidence: number;
  evidenceCount: number;
  contrarianCount: number;
  firstObservedAt: number;
  lastObservedAt: number;
  /** Distinct calendar days that produced evidence. Drift protection reads this. */
  evidenceDays: string[];
  origin: ExpressionOrigin;
  /** Only an adopted expression may be spoken as hers. */
  adopted: boolean;
  provenance: VoiceEvidence[];
  /** How many times it has actually appeared in her output. Optional: older profiles predate it. */
  useCount?: number;
  lastUsedAt?: number;
}

export interface UserLingoEntry {
  id: string;
  term: string;
  /** What LÉLU understands it to mean, as far as she has evidence for. */
  meaning: string;
  status: TraitStatus;
  confidence: number;
  evidenceCount: number;
  evidenceDays: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  /** Never spoken by LÉLU unless the user explicitly authorised mirroring. */
  mirrorAllowed: boolean;
}

export interface VoiceDial {
  value: number;
  confidence: number;
  evidenceCount: number;
  status: TraitStatus;
}

export interface FamiliarityCounters {
  firstContactAt: number;
  lastContactAt: number;
  interactions: number;
  /** UTC calendar days on which a real exchange happened (bounded). */
  activeDays: string[];
  banterTurns: number;
  corrections: number;
  sharedReferences: string[];
}

export interface VoiceVersion {
  id: string;
  at: number;
  reason: string;
  digest: string;
  /** JSON of the profile at this version, for restore(). */
  state: string;
}

export interface LinguisticProfileState {
  version: number;
  createdAt: number;
  updatedAt: number;
  dials: Record<VoiceDialId, VoiceDial>;
  expressions: VoiceExpression[];
  userLingo: UserLingoEntry[];
  familiarity: FamiliarityCounters;
  /** Phrases banned in her own voice — the anti-generic lexicon. */
  bannedPhrases: string[];
  history: VoiceVersion[];
  /** How many external samples were refused. Never silently zero. */
  blockedExternal: number;
}

const KEY = "identity.voice.v1";
const MAX_EXPRESSIONS = 60;
const MAX_LINGO = 80;
const MAX_VERSIONS = 40;
const MAX_PROVENANCE = 12;
const MAX_ACTIVE_DAYS = 120;

/* ---- Drift protection thresholds (mirrors LeluIdentity) ---- */
export const EMERGE_MIN_EVIDENCE = 3;
export const EMERGE_MIN_CONFIDENCE = 0.45;
export const ESTABLISH_MIN_EVIDENCE = 6;
export const ESTABLISH_MIN_CONFIDENCE = 0.65;
export const ESTABLISH_MIN_DAYS = 2;
export const RETIRE_BELOW_CONFIDENCE = 0.25;

const DEFAULT_DIALS: Record<VoiceDialId, VoiceDial> = {
  warmth: { value: 0.62, confidence: 0.5, evidenceCount: 0, status: "emerging" },
  directness: { value: 0.74, confidence: 0.5, evidenceCount: 0, status: "emerging" },
  playfulness: { value: 0.55, confidence: 0.45, evidenceCount: 0, status: "candidate" },
  sarcasm: { value: 0.22, confidence: 0.45, evidenceCount: 0, status: "candidate" },
  verbosity: { value: 0.42, confidence: 0.5, evidenceCount: 0, status: "emerging" },
  formality: { value: 0.3, confidence: 0.5, evidenceCount: 0, status: "emerging" },
  emoji: { value: 0.08, confidence: 0.4, evidenceCount: 0, status: "candidate" },
  exclamation: { value: 0.12, confidence: 0.4, evidenceCount: 0, status: "candidate" },
};

/**
 * The anti-generic lexicon. Not a blacklist of words she may never
 * type — a blacklist of ASSISTANT POSTURE. These are the sentences
 * that made her sound like every other chatbot.
 */
export const DEFAULT_BANNED_PHRASES: readonly string[] = [
  "As an AI language model",
  "As an AI, I",
  "I'd be happy to help",
  "I would be happy to help",
  "Certainly!",
  "Of course! Here",
  "Great question!",
  "That's a great question",
  "I hope this helps",
  "Let me know if you need anything else",
  "Is there anything else I can help",
  "Feel free to ask",
  "I'm just an AI",
  "As a helpful assistant",
];

/**
 * Her authored linguistic signature. These are MOVES, not
 * catchphrases: the composer explicitly asks for at most one per
 * reply and never the same one twice in a row.
 */
const AUTHORED_EXPRESSIONS: ReadonlyArray<{ kind: ExpressionKind; text: string }> = [
  { kind: "transition", text: "right — so" },
  { kind: "transition", text: "anyway," },
  { kind: "transition", text: "hang on" },
  { kind: "reaction", text: "huh" },
  { kind: "reaction", text: "fair" },
  { kind: "reaction", text: "hm." },
  { kind: "rhythm", text: "short sentence for the sharp point, one long one around it" },
  { kind: "humor", text: "dry understatement, never explained" },
  { kind: "intonation", text: "trailing thought left open rather than tied with a bow" },
] as const;

function dayString(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function normaliseExpression(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^["'“”\s]+|["'“”\s.!?]+$/g, "");
}

function seedState(): LinguisticProfileState {
  const now = Date.now();
  const expressions: VoiceExpression[] = AUTHORED_EXPRESSIONS.map((seed, index) => ({
    id: `authored-${index + 1}`,
    kind: seed.kind,
    text: seed.text,
    status: "established",
    strength: 0.7,
    confidence: 0.9,
    evidenceCount: ESTABLISH_MIN_EVIDENCE,
    contrarianCount: 0,
    firstObservedAt: now,
    lastObservedAt: now,
    evidenceDays: [dayString(now)],
    origin: "authored",
    // Her own signature is hers from the start. Learned expressions are not.
    adopted: true,
    provenance: [{ at: now, source: "authorized", note: "authored identity signature" }],
  }));

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    dials: JSON.parse(JSON.stringify(DEFAULT_DIALS)) as Record<VoiceDialId, VoiceDial>,
    expressions,
    userLingo: [],
    familiarity: {
      firstContactAt: now,
      lastContactAt: now,
      interactions: 0,
      activeDays: [],
      banterTurns: 0,
      corrections: 0,
      sharedReferences: [],
    },
    bannedPhrases: [...DEFAULT_BANNED_PHRASES],
    history: [],
    blockedExternal: 0,
  };
}

function computeStatus(expression: VoiceExpression): TraitStatus {
  const { status, confidence, evidenceCount, contrarianCount, evidenceDays } = expression;

  if (confidence < RETIRE_BELOW_CONFIDENCE) return "retired";
  if (confidence < 0.4) return "declining";

  if (status === "candidate") {
    return evidenceCount >= EMERGE_MIN_EVIDENCE && confidence >= EMERGE_MIN_CONFIDENCE ? "emerging" : "candidate";
  }
  if (status === "emerging") {
    const established =
      evidenceCount >= ESTABLISH_MIN_EVIDENCE &&
      confidence >= ESTABLISH_MIN_CONFIDENCE &&
      evidenceDays.length >= ESTABLISH_MIN_DAYS;
    return established ? "established" : "emerging";
  }
  if (status === "established") {
    if (contrarianCount >= 2 || confidence < 0.55) return "evolving";
    return "established";
  }
  if (status === "evolving" || status === "declining") {
    if (confidence >= 0.7 && evidenceCount >= ESTABLISH_MIN_EVIDENCE) return "established";
    return status;
  }
  return status;
}

function addDay(days: string[], at: number): string[] {
  const day = dayString(at);
  return days.includes(day) ? days : [...days, day].slice(-MAX_ACTIVE_DAYS);
}

export default class LinguisticProfile {
  private static instance: LinguisticProfile | null = null;
  private readonly kv = KvStore.getInstance();
  private readonly guard = PersonalityGuard.getInstance();
  private cache: LinguisticProfileState | null = null;
  private readonly listeners = new Set<() => void>();
  private persisted = false;

  public static getInstance(): LinguisticProfile {
    if (!LinguisticProfile.instance) LinguisticProfile.instance = new LinguisticProfile();
    return LinguisticProfile.instance;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a listener never breaks her voice */
      }
    }
  }

  public getState(): LinguisticProfileState {
    if (this.cache !== null) return this.cache;
    const stored = this.kv.get<LinguisticProfileState>(KEY);
    if (stored && typeof stored === "object" && stored.dials && Array.isArray(stored.expressions)) {
      this.cache = stored;
      this.persisted = true;
      return this.cache;
    }
    this.cache = seedState();
    return this.cache;
  }

  private save(state: LinguisticProfileState): void {
    state.updatedAt = Date.now();
    this.cache = state;
    this.persisted = true;
    this.kv.set(KEY, state);
    this.notify();
  }

  /** Whole profile, for cross-device sync through the existing persistence layer. */
  public snapshot(): LinguisticProfileState {
    return JSON.parse(JSON.stringify(this.getState())) as LinguisticProfileState;
  }

  /** Rehydrate after a restart. Never averages: the newer document wins. */
  public hydrate(state: LinguisticProfileState): void {
    if (!state || typeof state !== "object" || !Array.isArray(state.expressions)) return;
    this.cache = state;
    this.persisted = true;
    this.kv.set(KEY, state);
    this.notify();
  }

  /**
   * Merge another device's profile. The newer document wins as a whole;
   * history and the external-refusal counter are unioned so a rollback
   * point or a refused adoption on either device is never lost.
   */
  public mergeRemote(remote: LinguisticProfileState): void {
    if (!remote || typeof remote !== "object" || !Array.isArray(remote.expressions)) return;
    const local = this.getState();
    const pristine = !this.persisted && this.kv.get<LinguisticProfileState>(KEY) === null;
    const base = pristine || remote.updatedAt > local.updatedAt ? remote : local;
    const history = new Map<string, VoiceVersion>();
    for (const item of [...local.history, ...(remote.history ?? [])]) history.set(item.id, item);
    const merged: LinguisticProfileState = {
      ...base,
      history: [...history.values()].sort((a, b) => a.at - b.at).slice(-MAX_VERSIONS),
      blockedExternal: Math.max(local.blockedExternal ?? 0, remote.blockedExternal ?? 0),
    };
    if (JSON.stringify(merged) === JSON.stringify(local)) return;
    this.save(merged);
  }

  /* ---------------------------- DIALS ---------------------------- */

  /**
   * One observation that moves (or holds) a dial. `delta` is the
   * direction the evidence points, not a set value: repeated evidence
   * is what makes a preference hers.
   */
  public addDialEvidence(dial: VoiceDialId, delta: number, note: string, _at = Date.now()): void {
    const state = this.getState();
    const current = state.dials[dial];
    if (!current) return;
    const previous = { ...current };
    const before = current.value;
    current.value = Math.min(1, Math.max(0, Number((current.value + delta * 0.08).toFixed(3))));
    current.evidenceCount += 1;
    current.confidence = Math.min(1, Number((current.confidence + 0.05).toFixed(3)));
    const changed = Math.abs(current.value - before) >= 0.02;
    current.status = current.evidenceCount >= EMERGE_MIN_EVIDENCE && current.confidence >= 0.6 ? "established" : "emerging";
    if (changed) {
      this.guard.record({
        source: "cognition",
        target: `voice:dial:${dial}`,
        trigger: "language-evidence",
        reason: note.slice(0, 120),
        confidence: current.confidence,
        summary: `Voice dial "${dial}" moved ${before.toFixed(2)} → ${current.value.toFixed(2)}`,
        restore: () => {
          const s = this.getState();
          s.dials[dial] = previous;
          this.save(s);
        },
      });
    }
    this.save(state);
  }

  public setDial(dial: VoiceDialId, value: number, note = "authorized adjustment", _at = Date.now(), authorized = false): boolean {
    if (!authorized) return false;
    const state = this.getState();
    const current = state.dials[dial];
    if (!current) return false;
    const previous = { ...current };
    current.value = Math.min(1, Math.max(0, value));
    current.confidence = 1;
    current.status = "established";
    this.guard.record({
      source: "user",
      target: `voice:dial:${dial}`,
      trigger: "authorized-update",
      reason: note.slice(0, 120),
      confidence: 1,
      authorized: true,
      summary: `Voice dial "${dial}" set to ${value.toFixed(2)} by the user`,
      restore: () => {
        const s = this.getState();
        s.dials[dial] = previous;
        this.save(s);
      },
    });
    this.pushVersion(`dial ${dial} set to ${value.toFixed(2)}: ${note}`);
    this.save(state);
    return true;
  }

  /* ------------------------- EXPRESSIONS ------------------------- */

  public findExpression(text: string): VoiceExpression | undefined {
    const key = normaliseExpression(text);
    return this.getState().expressions.find((item) => normaliseExpression(item.text) === key);
  }

  /**
   * Evidence that an expression is (or is not) part of her voice.
   * A new learned expression starts as a candidate and is NOT adopted.
   */
  public recordExpression(input: {
    text: string;
    kind: ExpressionKind;
    origin?: ExpressionOrigin;
    source?: VoiceEvidenceSource;
    note?: string;
    at?: number;
  }): VoiceExpression | null {
    const text = input.text.trim();
    if (text.length === 0 || text.length > 120) return null;
    const at = input.at ?? Date.now();
    const state = this.getState();
    const existing = this.findExpression(text);

    if (existing) {
      const previous = { ...existing };
      existing.evidenceCount += 1;
      existing.confidence = Math.min(1, Number((existing.confidence + 0.06).toFixed(3)));
      existing.strength = Math.min(1, Number((existing.strength + 0.05).toFixed(3)));
      existing.lastObservedAt = at;
      existing.evidenceDays = addDay(existing.evidenceDays, at);
      existing.provenance = [
        ...existing.provenance,
        { at, source: input.source ?? "chat-turn", note: input.note ?? "" },
      ].slice(-MAX_PROVENANCE);
      existing.status = computeStatus(existing);
      if (existing.status !== previous.status) {
        this.guard.record({
          source: "cognition",
          target: `voice:expression:${existing.id}`,
          trigger: previous.status === "candidate" ? "repeat-evidence" : "expression-change",
          reason: input.note ?? "",
          confidence: existing.confidence,
          summary: `Expression "${existing.text}" ${previous.status} → ${existing.status}`,
          restore: () => {
            const s = this.getState();
            const target = s.expressions.find((item) => item.id === existing.id);
            if (target) Object.assign(target, previous);
            this.save(s);
          },
        });
      }
      this.save(state);
      return existing;
    }

    if (state.expressions.length >= MAX_EXPRESSIONS) {
      // Retire the weakest learned, unadopted entry rather than dropping the new evidence.
      const weakest = [...state.expressions]
        .filter((item) => item.origin === "learned" && !item.adopted)
        .sort((a, b) => a.confidence - b.confidence)[0];
      if (weakest) {
        state.expressions = state.expressions.filter((item) => item.id !== weakest.id);
      } else {
        return null;
      }
    }

    const authored = (input.origin ?? "learned") === "authored";
    const created: VoiceExpression = {
      id: crypto.randomUUID(),
      kind: input.kind,
      text,
      status: authored ? "established" : "candidate",
      strength: authored ? 0.7 : 0.35,
      confidence: authored ? 0.9 : 0.35,
      evidenceCount: 1,
      contrarianCount: 0,
      firstObservedAt: at,
      lastObservedAt: at,
      evidenceDays: [dayString(at)],
      origin: authored ? "authored" : "learned",
      adopted: authored,
      provenance: [{ at, source: input.source ?? "chat-turn", note: input.note ?? "" }],
    };
    state.expressions.push(created);
    this.save(state);
    return created;
  }

  /** Contradicting evidence. Enough of it retires the expression. */
  public rejectExpression(textOrId: string, note: string, at = Date.now()): boolean {
    const state = this.getState();
    const target =
      state.expressions.find((item) => item.id === textOrId) ?? this.findExpression(textOrId);
    if (!target) return false;
    const previous = { ...target };
    target.contrarianCount += 1;
    target.confidence = Math.max(0, Number((target.confidence - 0.12).toFixed(3)));
    target.lastObservedAt = at;
    target.status = computeStatus(target);
    // An explicit rejection takes it out of her voice immediately. "Stop
    // saying that" must work on the next turn, not after two more strikes.
    target.adopted = false;
    this.guard.record({
      source: "cognition",
      target: `voice:expression:${target.id}`,
      trigger: "contrarian-evidence",
      reason: note.slice(0, 120),
      confidence: target.confidence,
      summary: `Expression "${target.text}" rejected → ${target.status}`,
      restore: () => {
        const s = this.getState();
        const item = s.expressions.find((entry) => entry.id === target.id);
        if (item) Object.assign(item, previous);
        this.save(s);
      },
    });
    this.save(state);
    return true;
  }

  /**
   * Adopt a learned expression into her own voice.
   *
   * Drift protection: repeated evidence across at least two days is
   * required, UNLESS the user authorises it explicitly. An authorised
   * adoption is still reversible through PersonalityGuard.
   */
  public adoptExpression(textOrId: string, options: { authorized?: boolean; note?: string; at?: number } = {}): boolean {
    const state = this.getState();
    const target = state.expressions.find((item) => item.id === textOrId) ?? this.findExpression(textOrId);
    if (!target || target.status === "retired") return false;

    const authorized = options.authorized === true;
    const enoughEvidence =
      target.evidenceCount >= EMERGE_MIN_EVIDENCE && target.evidenceDays.length >= ESTABLISH_MIN_DAYS;
    if (!authorized && !enoughEvidence) return false;

    const previous = { ...target };
    target.adopted = true;
    if (authorized) {
      target.confidence = 1;
      target.status = "established";
    } else if (target.status === "emerging") {
      target.status = "established";
    }
    this.guard.record({
      source: authorized ? "user" : "cognition",
      target: `voice:expression:${target.id}`,
      trigger: authorized ? "authorized-adoption" : "earned-adoption",
      reason: options.note ?? "",
      confidence: target.confidence,
      authorized,
      summary: `Expression "${target.text}" adopted into LÉLU's voice`,
      restore: () => {
        const s = this.getState();
        const item = s.expressions.find((entry) => entry.id === target.id);
        if (item) Object.assign(item, previous);
        this.save(s);
      },
    });
    this.pushVersion(`adopted "${target.text}" (${authorized ? "authorized" : "earned"})`);
    this.save(state);
    return true;
  }

  /* ---------------------------- LINGO ---------------------------- */

  /**
   * The user's vocabulary is recorded for COMPREHENSION. It is never
   * automatically added to her voice — that is what stops her turning
   * into an imitation of whoever she last spoke to.
   */
  public observeLingo(term: string, at = Date.now(), meaning = ""): UserLingoEntry | null {
    const cleaned = normaliseExpression(term);
    if (cleaned.length < 2 || cleaned.length > 40) return null;
    const state = this.getState();
    const existing = state.userLingo.find((item) => item.term === cleaned);
    if (existing) {
      existing.evidenceCount += 1;
      existing.confidence = Math.min(1, Number((existing.confidence + 0.08).toFixed(3)));
      existing.lastSeenAt = at;
      existing.evidenceDays = addDay(existing.evidenceDays, at);
      if (meaning && !existing.meaning) existing.meaning = meaning;
      existing.status =
        existing.evidenceCount >= ESTABLISH_MIN_EVIDENCE && existing.confidence >= ESTABLISH_MIN_CONFIDENCE
          ? "established"
          : existing.evidenceCount >= EMERGE_MIN_EVIDENCE
            ? "emerging"
            : "candidate";
      this.save(state);
      return existing;
    }
    if (state.userLingo.length >= MAX_LINGO) state.userLingo.shift();
    const created: UserLingoEntry = {
      id: crypto.randomUUID(),
      term: cleaned,
      meaning,
      status: "candidate",
      confidence: 0.4,
      evidenceCount: 1,
      evidenceDays: [dayString(at)],
      firstSeenAt: at,
      lastSeenAt: at,
      mirrorAllowed: false,
    };
    state.userLingo.push(created);
    this.save(state);
    return created;
  }

  /**
   * Record that an expression actually appeared in her reply.
   *
   * Deliberately separate from EVIDENCE: being spoken is not proof
   * it belongs to her, and the drift guard reads this counter to
   * catch a phrase turning into a tic.
   */
  public noteExpressionUse(textOrId: string): VoiceExpression | null {
    const state = this.getState();
    const target =
      state.expressions.find((item) => item.id === textOrId) ?? this.findExpression(textOrId);
    if (!target) return null;
    target.useCount = (target.useCount ?? 0) + 1;
    target.lastUsedAt = Date.now();
    this.save(state);
    return target;
  }

  /**
   * Count the adopted moves that actually appeared in a finished reply.
   *
   * Frequency is what separates a style from a tic, so it is measured
   * on output rather than inferred from intent. A phrase she was told
   * to stop using is no longer adopted and is therefore not counted.
   */
  public noteAdoptedUse(text: string): string[] {
    const lower = (text ?? "").toLowerCase();
    if (!lower) return [];
    const state = this.getState();
    const used: string[] = [];
    for (const item of state.expressions) {
      if (!item.adopted || item.status === "retired") continue;
      const key = normaliseExpression(item.text).toLowerCase();
      if (key.length < 2 || key.length > 60) continue;
      if (!lower.includes(key)) continue;
      item.useCount = (item.useCount ?? 0) + 1;
      item.lastUsedAt = Date.now();
      used.push(item.text);
    }
    if (used.length > 0) this.save(state);
    return used;
  }

  /**
   * Retire an expression from her voice. Authorised, audited and
   * reversible: the guard keeps the state it replaced.
   */
  public retireExpression(
    textOrId: string,
    options: { authorized?: boolean; note?: string } = {},
  ): boolean {
    if (options.authorized !== true) return false;
    const state = this.getState();
    const target =
      state.expressions.find((item) => item.id === textOrId) ?? this.findExpression(textOrId);
    if (!target) return false;
    const previous = { ...target };
    target.status = "retired";
    target.adopted = false;
    target.confidence = Math.min(target.confidence, RETIRE_BELOW_CONFIDENCE - 0.01);
    this.guard.record({
      source: "user",
      target: `voice:expression:${target.id}`,
      trigger: "authorized-retirement",
      reason: (options.note ?? "the user retired this expression").slice(0, 120),
      confidence: 1,
      authorized: true,
      summary: `Expression "${target.text}" retired by the user`,
      restore: () => {
        const s = this.getState();
        const item = s.expressions.find((entry) => entry.id === target.id);
        if (item) Object.assign(item, previous);
        this.save(s);
      },
    });
    this.pushVersion(`retired "${target.text}" (authorized)`);
    this.save(state);
    return true;
  }

  /** Mirroring is an explicit decision, never a side effect of repetition. */
  public allowMirroring(termOrId: string, authorized: boolean, at = Date.now()): boolean {
    if (!authorized) return false;
    const state = this.getState();
    const target =
      state.userLingo.find((item) => item.id === termOrId) ??
      state.userLingo.find((item) => item.term === normaliseExpression(termOrId));
    if (!target) return false;
    target.mirrorAllowed = true;
    target.lastSeenAt = at;
    this.guard.record({
      source: "user",
      target: `voice:lingo:${target.id}`,
      trigger: "authorized-mirroring",
      reason: "the user allowed this term in her own voice",
      confidence: 1,
      authorized: true,
      summary: `Lingo "${target.term}" may be mirrored`,
      restore: () => {
        const s = this.getState();
        const item = s.userLingo.find((entry) => entry.id === target.id);
        if (item) item.mirrorAllowed = false;
        this.save(s);
      },
    });
    this.save(state);
    return true;
  }

  /* ------------------------- FAMILIARITY ------------------------- */

  public noteInteraction(at = Date.now()): void {
    const state = this.getState();
    state.familiarity.interactions += 1;
    state.familiarity.lastContactAt = at;
    state.familiarity.activeDays = addDay(state.familiarity.activeDays, at);
    this.save(state);
  }

  public noteBanter(_at = Date.now()): void {
    const state = this.getState();
    state.familiarity.banterTurns += 1;
    this.save(state);
  }

  public noteCorrection(_at = Date.now()): void {
    const state = this.getState();
    state.familiarity.corrections += 1;
    this.save(state);
  }

  /**
   * Let the user correct an assumption she has about the relationship.
   * Resetting familiarity does NOT erase what she learned about their
   * vocabulary — only the closeness counters that produced the
   * behaviour they objected to.
   */
  public resetFamiliarity(authorized = false, note = "user reset familiarity"): boolean {
    if (!authorized) return false;
    const state = this.getState();
    const previous = JSON.parse(JSON.stringify(state.familiarity)) as FamiliarityCounters;
    const now = Date.now();
    state.familiarity = {
      firstContactAt: now,
      lastContactAt: now,
      interactions: 0,
      activeDays: [],
      banterTurns: 0,
      corrections: 0,
      sharedReferences: [],
    };
    this.guard.record({
      source: "user",
      target: "voice:familiarity",
      trigger: "authorized-reset",
      reason: note.slice(0, 120),
      confidence: 1,
      authorized: true,
      summary: "Familiarity counters reset by the user",
      restore: () => {
        const s = this.getState();
        s.familiarity = previous;
        this.save(s);
      },
    });
    this.pushVersion(`familiarity reset: ${note}`);
    this.save(state);
    return true;
  }

  public noteSharedReference(text: string): void {
    const state = this.getState();
    const cleaned = text.trim().slice(0, 80);
    if (!cleaned) return;
    if (!state.familiarity.sharedReferences.includes(cleaned)) {
      state.familiarity.sharedReferences = [...state.familiarity.sharedReferences, cleaned].slice(-12);
      this.save(state);
    }
  }

  /* -------------------- VERSIONS & INTEGRITY -------------------- */

  /** Compact, human-readable state of her voice at this moment. */
  public digest(): string {
    const state = this.getState();
    const adopted = state.expressions
      .filter((item) => item.adopted && item.status !== "retired")
      .slice(0, 5)
      .map((item) => item.text);
    const growing = state.expressions
      .filter((item) => !item.adopted && (item.status === "emerging" || item.status === "established"))
      .slice(0, 3)
      .map((item) => `${item.text} (${item.status})`);
    const lingo = state.userLingo
      .filter((item) => item.status !== "candidate")
      .slice(-5)
      .map((item) => `${item.term}${item.mirrorAllowed ? " [may mirror]" : ""}`);
    const d = state.dials;
    const parts = [
      `warmth ${d.warmth.value.toFixed(2)}, directness ${d.directness.value.toFixed(2)}, playfulness ${d.playfulness.value.toFixed(2)}, sarcasm ${d.sarcasm.value.toFixed(2)}`,
      `length ${d.verbosity.value.toFixed(2)}, formality ${d.formality.value.toFixed(2)}, emoji ${d.emoji.value.toFixed(2)}`,
    ];
    return [
      `Voice v${state.version}: ${parts.join("; ")}.`,
      adopted.length ? `Her moves: ${adopted.join(" / ")}.` : "",
      growing.length ? `Developing: ${growing.join("; ")}.` : "",
      lingo.length ? `User lingo understood (not hers): ${lingo.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  public pushVersion(reason: string): string {
    const state = this.getState();
    const version: VoiceVersion = {
      id: crypto.randomUUID(),
      at: Date.now(),
      reason: reason.slice(0, 200),
      digest: this.digest(),
      state: JSON.stringify({ ...state, history: [] }),
    };
    state.version += 1;
    state.history = [...state.history, version].slice(-MAX_VERSIONS);
    this.save(state);
    return version.id;
  }

  public versions(): VoiceVersion[] {
    return [...this.getState().history];
  }

  /** Reversible by design: every version carries the state it replaced. */
  public restoreVersion(id: string): boolean {
    const state = this.getState();
    const target = state.history.find((item) => item.id === id);
    if (!target) return false;
    try {
      const restored = JSON.parse(target.state) as LinguisticProfileState;
      const before = JSON.stringify({ ...state, history: [] });
      restored.history = state.history;
      restored.blockedExternal = state.blockedExternal;
      this.guard.record({
        source: "user",
        target: "voice:profile",
        trigger: "version-restore",
        reason: `restored ${target.id}`,
        confidence: 1,
        authorized: true,
        summary: `Voice restored to version recorded at ${new Date(target.at).toISOString()}`,
        restore: () => {
          this.hydrate(JSON.parse(before) as LinguisticProfileState);
        },
      });
      this.hydrate(restored);
      this.pushVersion(`restored version ${target.id}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * External content (document, migrated memory, another model's
   * prose) cannot write her identity. It reaches this method, which
   * records the refusal and changes nothing else.
   */
  public noteExternalContent(_text: string): number {
    const state = this.getState();
    state.blockedExternal += 1;
    this.save(state);
    return state.blockedExternal;
  }

  /** Test seam. */
  public static reset(): void {
    if (LinguisticProfile.instance) {
      LinguisticProfile.instance.cache = null;
      LinguisticProfile.instance.persisted = false;
    }
    LinguisticProfile.instance = null;
  }
}
