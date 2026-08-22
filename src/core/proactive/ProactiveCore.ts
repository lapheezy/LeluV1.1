/**
 * ==========================================================
 * LÉLU
 * PROACTIVE CORE — the proactive-intelligence orchestrator
 *
 * This is NOT a second brain and NOT a second memory. It is an
 * orchestration layer on top of the existing architecture:
 *
 *   Existing Memory (Brain / PatternMemory)
 *     → Context Retrieval (MemoryBridge)
 *     → Pattern Detection (this file)
 *     → Priority Engine   (this file)
 *     → Proactive Orchestrator (this file)
 *     → Action / Media layer    (ProactiveBridge + chat)
 *
 * It persists its own *small* working state (settings, pattern
 * counts, an event log, and a session-continuity snapshot) through
 * the existing KvStore — the same persistence layer used by the
 * project/agent/avatar stores — and reads durable facts through the
 * existing memory path. It never writes to, duplicates, or replaces
 * the Brain's PatternMemory.
 *
 * Every proactive item is traceable to a real source (memory,
 * project, routine, location, world state). When there is nothing
 * meaningful to say, the briefing is empty and LÉLU stays quiet.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

/* ------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------ */

export type NotificationLevel = "quiet" | "normal" | "proactive" | "highly-proactive";

/** Categories LÉLU is allowed to proactively discuss. */
export const PROACTIVE_CATEGORIES = [
  "projects",
  "memory",
  "routine",
  "suggestions",
  "location",
  "world",
] as const;

export type ProactiveCategory = (typeof PROACTIVE_CATEGORIES)[number];

export interface ProactiveSettings {
  enabled: boolean;
  sessionBriefing: boolean;
  routineLearning: boolean;
  suggestions: boolean;
  projectUpdates: boolean;
  locationContext: boolean;
  mediaDiscovery: boolean;
  videoAutoplay: boolean;
  notificationLevel: NotificationLevel;
  categories: ProactiveCategory[];
}

const DEFAULT_SETTINGS: ProactiveSettings = {
  enabled: false,
  sessionBriefing: true,
  routineLearning: true,
  suggestions: true,
  projectUpdates: true,
  locationContext: false,
  mediaDiscovery: false,
  videoAutoplay: false,
  notificationLevel: "normal",
  categories: [...PROACTIVE_CATEGORIES],
};

/* ------------------------------------------------------------------
 * Pattern / routine state
 * ------------------------------------------------------------------ */

interface PatternStat {
  key: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Distinct session start-times this topic appeared in. */
  sessions: number[];
  /** Hour-of-day distribution (0–23) for time-sensitive routines. */
  hours: number[];
  /** Set true only when the user explicitly confirms it. */
  confirmed: boolean;
}

export type PatternLevel = "observed" | "pattern" | "routine" | "preference";

interface CategoryWeight {
  engaged: number;
  dismissed: number;
}

/* ------------------------------------------------------------------
 * Session continuity
 * ------------------------------------------------------------------ */

interface SessionSnapshot {
  startedAt: number;
  lastActiveAt: number;
  lastTopic: string;
  recentMessages: string[];
  locationName: string;
  planetaryContext: string;
  /** True once a briefing has been presented for this boot. */
  briefed: boolean;
}

/* ------------------------------------------------------------------
 * Event log
 * ------------------------------------------------------------------ */

export interface ProactiveEvent {
  id: string;
  trigger: string;
  source: string;
  priority: number;
  confidence: number;
  timestamp: number;
  presented: string;
  engaged: boolean | null;
  dismissed: boolean;
}

/* ------------------------------------------------------------------
 * Briefing
 * ------------------------------------------------------------------ */

export interface BriefingItem {
  priority: number;
  section: string;
  text: string;
  source: string;
  confidence: number;
}

export interface Briefing {
  greeting: string;
  sections: { title: string; items: BriefingItem[] }[];
  isEmpty: boolean;
}

export interface BriefingSignals {
  memories: {
    id: string;
    category: string;
    response: string;
    confidence: number;
    timestamp: number;
  }[];
  projects: {
    name: string;
    description: string;
    status: string;
    itemCount: number;
    updatedAt: number;
  }[];
  userName?: string;
  locationName?: string;
  planetaryContext?: string;
  lastTopic?: string;
  lastSessionEndedAt?: number;
}

/* ------------------------------------------------------------------
 * Persistence keys
 * ------------------------------------------------------------------ */

const KEY_SETTINGS = "proactive.settings.v1";
const KEY_SESSION = "proactive.session.v1";
const KEY_PATTERNS = "proactive.patterns.v1";
const KEY_EVENTS = "proactive.events.v1";
const KEY_WEIGHTS = "proactive.weights.v1";
const KEY_WATCHES = "proactive.watches.v1";
const KEY_MUTES = "proactive.mutes.v1";

const MAX_RECENT_MESSAGES = 12;
const MAX_EVENTS = 120;
const MAX_PATTERNS = 160;

/* ------------------------------------------------------------------
 * The engine
 * ------------------------------------------------------------------ */

export default class ProactiveCore {
  private static instance: ProactiveCore | null = null;

  private readonly kv = KvStore.getInstance();

  private settings: ProactiveSettings;
  private session: SessionSnapshot;
  private patterns: PatternStat[] = [];
  private events: ProactiveEvent[] = [];
  private weights: Record<string, CategoryWeight> = {};
  private watches: string[] = [];
  private mutes: string[] = [];

  private loaded = false;

  private constructor() {
    this.settings = this.readSettings();
    this.session = this.readSession();
  }

  public static getInstance(): ProactiveCore {
    if (!ProactiveCore.instance) {
      ProactiveCore.instance = new ProactiveCore();
    }
    return ProactiveCore.instance;
  }

  /* ---------------------------- settings ---------------------------- */

  private readSettings(): ProactiveSettings {
    const stored = this.kv.get<Partial<ProactiveSettings>>(KEY_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}), categories: stored?.categories?.length ? stored.categories : [...DEFAULT_SETTINGS.categories] };
  }

  public getSettings(): ProactiveSettings {
    return { ...this.settings, categories: [...this.settings.categories] };
  }

  public updateSettings(patch: Partial<ProactiveSettings>): ProactiveSettings {
    this.settings = {
      ...this.settings,
      ...patch,
      categories: patch.categories ?? this.settings.categories,
    };
    this.kv.set(KEY_SETTINGS, this.settings);
    return this.getSettings();
  }

  public toggleCategory(category: ProactiveCategory): ProactiveSettings {
    const has = this.settings.categories.includes(category);
    const categories = has
      ? this.settings.categories.filter((item) => item !== category)
      : [...this.settings.categories, category];
    return this.updateSettings({ categories });
  }

  /* ------------------------ persistence load ------------------------ */

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.patterns = this.kv.get<PatternStat[]>(KEY_PATTERNS) ?? [];
    this.events = this.kv.get<ProactiveEvent[]>(KEY_EVENTS) ?? [];
    this.weights = this.kv.get<Record<string, CategoryWeight>>(KEY_WEIGHTS) ?? {};
    this.watches = this.kv.get<string[]>(KEY_WATCHES) ?? [];
    this.mutes = this.kv.get<string[]>(KEY_MUTES) ?? [];
    this.loaded = true;
  }

  private readSession(): SessionSnapshot {
    const stored = this.kv.get<Partial<SessionSnapshot>>(KEY_SESSION);
    return {
      startedAt: stored?.startedAt ?? Date.now(),
      lastActiveAt: stored?.lastActiveAt ?? 0,
      lastTopic: stored?.lastTopic ?? "",
      recentMessages: stored?.recentMessages ?? [],
      locationName: stored?.locationName ?? "",
      planetaryContext: stored?.planetaryContext ?? "",
      briefed: false,
    };
  }

  private persistSession(): void {
    this.kv.set(KEY_SESSION, {
      startedAt: this.session.startedAt,
      lastActiveAt: this.session.lastActiveAt,
      lastTopic: this.session.lastTopic,
      recentMessages: this.session.recentMessages,
      locationName: this.session.locationName,
      planetaryContext: this.session.planetaryContext,
      briefed: this.session.briefed,
    });
  }

  private persistPatterns(): void {
    this.kv.set(KEY_PATTERNS, this.patterns.slice(0, MAX_PATTERNS));
  }

  private persistEvents(): void {
    this.kv.set(KEY_EVENTS, this.events.slice(0, MAX_EVENTS));
  }

  private persistWeights(): void {
    this.kv.set(KEY_WEIGHTS, this.weights);
  }

  private persistWatches(): void {
    this.kv.set(KEY_WATCHES, this.watches);
  }

  private persistMutes(): void {
    this.kv.set(KEY_MUTES, this.mutes);
  }

  /* ------------------------- session lifecycle ---------------------- */

  public beginSession(): void {
    this.ensureLoaded();
    // Keep the previous session's continuity (lastTopic / recent messages /
    // location) but mark this boot as a fresh, un-briefed session.
    this.session = {
      ...this.readSession(),
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      briefed: false,
    };
    this.persistSession();
  }

  public endSession(): void {
    this.session.lastActiveAt = Date.now();
    this.persistSession();
  }

  public markBriefed(): void {
    this.session.briefed = true;
    this.persistSession();
  }

  public isBriefed(): boolean {
    return this.session.briefed;
  }

  /* ----------------------- interaction recording -------------------- */

  /**
   * Record a genuine user interaction. Updates session continuity and,
   * when routine learning is enabled, feeds the pattern engine. One
   * observation is never treated as a permanent preference.
   */
  public recordInteraction(text: string): void {
    this.ensureLoaded();
    const now = Date.now();
    const clean = text.trim();
    if (!clean) {
      return;
    }

    this.session.lastActiveAt = now;
    this.session.lastTopic = this.detectTopic(clean);
    this.session.recentMessages = [...this.session.recentMessages, clean].slice(-MAX_RECENT_MESSAGES);
    this.persistSession();

    // The user just took control — any proactive item presented this
    // session is effectively superseded by real conversation
    // (interruption rule). This also feeds the feedback-learning signal.
    this.markEngagedSince(this.session.startedAt);

    if (this.settings.enabled && this.settings.routineLearning) {
      this.recordPatterns(clean, now);
    }

    this.applyDirective(clean, now);
  }

  /** Mark recent, non-dismissed events as engaged (user took over). */
  private markEngagedSince(after: number): void {
    let changed = false;
    for (const event of this.events) {
      if (event.timestamp >= after && event.engaged === null) {
        event.engaged = true;
        changed = true;
      }
    }
    if (changed) {
      this.persistEvents();
    }
  }

  /* -------------------------- pattern engine ------------------------ */

  private recordPatterns(text: string, now: number): void {
    const keys = this.extractKeywords(text);
    const sessionStart = this.session.startedAt;
    const hour = new Date(now).getHours();

    for (const key of keys) {
      const existing = this.patterns.find((pattern) => pattern.key === key);
      if (existing) {
        existing.count += 1;
        existing.lastSeen = now;
        if (!existing.sessions.includes(sessionStart)) {
          existing.sessions.push(sessionStart);
        }
        existing.hours.push(hour);
        if (existing.hours.length > 40) {
          existing.hours = existing.hours.slice(-40);
        }
      } else {
        this.patterns.push({
          key,
          count: 1,
          firstSeen: now,
          lastSeen: now,
          sessions: [sessionStart],
          hours: [hour],
          confirmed: false,
        });
      }
    }

    if (this.patterns.length > MAX_PATTERNS) {
      // Drop the least-recently-seen patterns to keep the store bounded.
      this.patterns = this.patterns
        .slice()
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, MAX_PATTERNS);
    }

    this.persistPatterns();
  }

  private extractKeywords(text: string): string[] {
    const STOP = new Set([
      "about", "after", "again", "also", "always", "been", "before", "being",
      "could", "does", "doing", "from", "have", "having", "into", "just",
      "know", "like", "make", "more", "much", "never", "please", "really",
      "should", "some", "that", "them", "then", "there", "these", "they",
      "this", "those", "want", "what", "when", "where", "which", "will",
      "with", "would", "your", "yours", "youre", "tell", "keep", "update",
    ]);

    const seen = new Set<string>();
    const keys: string[] = [];
    for (const raw of text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/)) {
      const word = raw.replace(/^'+|'+$/g, "");
      if (word.length < 4 || STOP.has(word)) {
        continue;
      }
      if (!seen.has(word)) {
        seen.add(word);
        keys.push(word);
      }
    }
    // A pair of adjacent significant words is stronger evidence than
    // either word alone — capture the most informative one.
    const words = keys.slice(0, 12);
    for (let index = 0; index < words.length - 1; index += 1) {
      const phrase = `${words[index]}-${words[index + 1]}`;
      if (!seen.has(phrase)) {
        seen.add(phrase);
        keys.push(phrase);
      }
    }
    return keys.slice(0, 16);
  }

  /** Confidence level of a single pattern, purely from its evidence. */
  private levelOf(pattern: PatternStat): PatternLevel {
    if (pattern.confirmed || this.watches.includes(pattern.key)) {
      return "preference";
    }
    const sessions = new Set(pattern.sessions).size;
    if (pattern.count >= 3 && sessions >= 2) {
      return "routine";
    }
    if (pattern.count >= 2 && sessions >= 2) {
      return "pattern";
    }
    return "observed";
  }

  /* ---------------------- explicit user directives ------------------- */

  private applyDirective(text: string, now: number): void {
    const lower = text.toLowerCase();

    const muteMatch = lower.match(/(?:don'?t|stop|never)\s+(?:bring|tell|mention|show|notify)\s+(?:me\s+)?(?:about|again|anymore|this)?\s*[:,]?\s*(.+)/i)
      ?? lower.match(/forget\s+(?:about\s+)?(.+)/i);
    if (muteMatch) {
      const topic = this.normalizeTopic(muteMatch[1]);
      if (topic && !this.mutes.includes(topic)) {
        this.mutes.push(topic);
        if (this.mutes.length > 80) {
          this.mutes = this.mutes.slice(-80);
        }
        this.persistMutes();
      }
      return;
    }

    const watchMatch = lower.match(/(?:always|keep)\s+(?:me\s+)?(?:updated\s+about|informed\s+about|tell\s+me\s+about)\s+(.+)/i);
    if (watchMatch) {
      const topic = this.normalizeTopic(watchMatch[1]);
      if (topic && !this.watches.includes(topic)) {
        this.watches.push(topic);
        this.persistWatches();
        // An explicit "always tell me about X" is a confirmed preference.
        const pattern = this.patterns.find((item) => item.key === topic) ?? {
          key: topic,
          count: 1,
          firstSeen: now,
          lastSeen: now,
          sessions: [this.session.startedAt],
          hours: [new Date(now).getHours()],
          confirmed: false,
        };
        pattern.confirmed = true;
        if (!this.patterns.includes(pattern)) {
          this.patterns.push(pattern);
        }
        this.persistPatterns();
      }
    }
  }

  private normalizeTopic(raw: string): string {
    const keys = this.extractKeywords(raw);
    return keys[keys.length - 1] ?? raw.trim().toLowerCase().slice(0, 32);
  }

  /* ---------------------------- location ---------------------------- */

  public setLocation(name: string, country?: string): void {
    this.session.locationName = country ? `${name}, ${country}` : name;
    this.persistSession();
  }

  public getLocation(): string {
    return this.session.locationName;
  }

  public setPlanetaryContext(name: string): void {
    this.session.planetaryContext = name;
    this.persistSession();
  }

  public getPlanetaryContext(): string {
    return this.session.planetaryContext;
  }

  public getLastTopic(): string {
    return this.session.lastTopic;
  }

  /* ----------------------------- briefing --------------------------- */

  public buildBriefing(signals: BriefingSignals): Briefing {
    this.ensureLoaded();

    const items: BriefingItem[] = [];

    if (this.settings.enabled) {
      if (this.settings.projectUpdates && signals.projects.length > 0) {
        for (const project of this.activeProjects(signals.projects).slice(0, 3)) {
          items.push({
            priority: 3,
            section: "Active projects",
            text: this.projectLine(project),
            source: `project:${project.name}`,
            confidence: 0.9,
          });
        }
      }

      if (this.settings.routineLearning) {
        const routines = this.establishedRoutines();
        for (const routine of routines.slice(0, 3)) {
          const nearNow = this.nearCurrentHour(routine);
          items.push({
            priority: nearNow ? 2 : 4,
            section: nearNow ? "Time-sensitive" : "Your routines",
            text: nearNow
              ? `You usually work on "${routine.key}" around this time.`
              : `You've been returning to "${routine.key}" regularly.`,
            source: `routine:${routine.key}`,
            confidence: this.routineConfidence(routine),
          });
        }
      }

      if (this.settings.categories.includes("memory")) {
        for (const memory of this.durableMemories(signals.memories).slice(0, 3)) {
          items.push({
            priority: 5,
            section: "What matters now",
            text: memory.response.slice(0, 180),
            source: `memory:${memory.category}`,
            confidence: memory.confidence,
          });
        }
      }

      if (signals.lastTopic && this.settings.categories.includes("memory")) {
        items.push({
          priority: 5,
          section: "Where you left off",
          text: `Last time you were discussing: ${signals.lastTopic}.`,
          source: "session_continuity",
          confidence: 0.7,
        });
      }

      if (this.settings.categories.includes("location") && this.settings.locationContext && this.session.locationName) {
        items.push({
          priority: 5,
          section: "Where you are",
          text: `Your last known location was ${this.session.locationName}.`,
          source: "location",
          confidence: 0.8,
        });
      }

      if (this.settings.categories.includes("world") && this.session.planetaryContext) {
        items.push({
          priority: 5,
          section: "In the cosmos",
          text: `You were last exploring ${this.session.planetaryContext}.`,
          source: "world",
          confidence: 0.85,
        });
      }

      if (this.settings.suggestions && signals.projects.length > 0) {
        const suggestion = this.nextStep(signals.projects);
        if (suggestion) {
          items.push({
            priority: 6,
            section: "Suggestions",
            text: suggestion,
            source: "suggestion",
            confidence: 0.6,
          });
        }
      }
    }

    // Apply learned feedback: a repeatedly-dismissed source drops priority
    // (and can be dropped entirely at the highest dismissal ratio).
    const ranked = items
      .map((item) => this.applyFeedback(item))
      .filter((item) => item.priority <= 6)
      .sort((a, b) => a.priority - b.priority || b.confidence - a.confidence);

    const sections = this.groupSections(ranked);

    return {
      greeting: this.greeting(signals, ranked.length > 0),
      sections,
      isEmpty: ranked.length === 0,
    };
  }

  private activeProjects(projects: BriefingSignals["projects"]) {
    return projects
      .filter((project) => project.status === "active")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private projectLine(project: BriefingSignals["projects"][number]): string {
    const base = `${project.name}${project.description ? ` — ${project.description}` : ""}`;
    return project.itemCount > 0 ? `${base} (${project.itemCount} item(s))` : base;
  }

  private establishedRoutines(): PatternStat[] {
    const now = Date.now();
    return this.patterns
      .filter((pattern) => !this.mutes.includes(pattern.key))
      .filter((pattern) => this.levelOf(pattern) === "routine" || this.levelOf(pattern) === "preference")
      .filter((pattern) => now - pattern.lastSeen < 45 * 24 * 3600 * 1000)
      .sort((a, b) => b.count - a.count);
  }

  private nearCurrentHour(pattern: PatternStat): boolean {
    const hour = new Date().getHours();
    return pattern.hours.slice(-12).some((item) => Math.abs(item - hour) <= 1);
  }

  /** Routines that are active near the current hour — used by the
   *  PersistentRuntime to surface time-sensitive context without the
   *  user asking. Empty when there is no established evidence. */
  public timeSensitiveRoutines(): { key: string; confidence: number }[] {
    this.ensureLoaded();
    return this.establishedRoutines()
      .filter((pattern) => this.nearCurrentHour(pattern))
      .slice(0, 3)
      .map((pattern) => ({ key: pattern.key, confidence: this.routineConfidence(pattern) }));
  }

  private routineConfidence(pattern: PatternStat): number {
    const sessions = new Set(pattern.sessions).size;
    return Math.min(0.95, 0.5 + pattern.count * 0.08 + sessions * 0.08);
  }

  private durableMemories(memories: BriefingSignals["memories"]) {
    const durableCategories = new Set(["preference", "goal", "project", "relationship", "skill"]);
    const watched = memories.filter((memory) =>
      this.watches.some((watch) => memory.response.toLowerCase().includes(watch) || memory.category.toLowerCase().includes(watch)),
    );
    const durable = memories
      .filter((memory) => durableCategories.has(memory.category))
      .sort((a, b) => b.timestamp - a.timestamp);
    return [...watched, ...durable].slice(0, 6);
  }

  private nextStep(projects: BriefingSignals["projects"]): string | null {
    const active = this.activeProjects(projects);
    const mostActive = active[0];
    if (!mostActive) {
      return null;
    }
    if (mostActive.itemCount === 0) {
      return `"${mostActive.name}" is empty — a good next step is to add the first idea, note, or reference.`;
    }
    return `"${mostActive.name}" is your most active project — want to continue where you left off?`;
  }

  private applyFeedback(item: BriefingItem): BriefingItem {
    const weight = this.weights[item.source];
    if (!weight) {
      return item;
    }
    const total = weight.engaged + weight.dismissed;
    if (total < 3) {
      return item;
    }
    const dismissalRatio = weight.dismissed / total;
    if (dismissalRatio > 0.66) {
      // Heavily dismissed — demote to discovery or drop entirely.
      return { ...item, priority: item.priority + 2 };
    }
    if (dismissalRatio > 0.5) {
      return { ...item, priority: item.priority + 1 };
    }
    if (weight.engaged >= 2 && dismissalRatio < 0.25) {
      return { ...item, priority: Math.max(1, item.priority - 1) };
    }
    return item;
  }

  private groupSections(items: BriefingItem[]): Briefing["sections"] {
    const order: string[] = [];
    const groups = new Map<string, BriefingItem[]>();
    for (const item of items) {
      const existing = groups.get(item.section) ?? [];
      if (existing.length === 0) {
        order.push(item.section);
      }
      existing.push(item);
      groups.set(item.section, existing);
    }
    return order.map((title) => ({ title, items: groups.get(title) ?? [] }));
  }

  private greeting(signals: BriefingSignals, hasContent: boolean): string {
    const name = signals.userName ? `, ${signals.userName}` : "";
    if (!hasContent) {
      return `Good to see you${name}. Everything looks settled — no updates to report right now.`;
    }
    return `Good to see you${name}. Here's what's most relevant right now.`;
  }

  /* ------------------------------ feedback -------------------------- */

  public recordFeedback(source: string, engaged: boolean): void {
    this.ensureLoaded();
    const weight = this.weights[source] ?? { engaged: 0, dismissed: 0 };
    if (engaged) {
      weight.engaged += 1;
    } else {
      weight.dismissed += 1;
    }
    this.weights[source] = weight;
    this.persistWeights();
  }

  /* ---------------------------- event log --------------------------- */

  public logEvent(event: Omit<ProactiveEvent, "id" | "timestamp" | "engaged" | "dismissed">): ProactiveEvent {
    this.ensureLoaded();
    const full: ProactiveEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      engaged: null,
      dismissed: false,
    };
    this.events.push(full);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    this.persistEvents();
    return full;
  }

  public dismissEvent(id: string): void {
    this.ensureLoaded();
    const event = this.events.find((item) => item.id === id);
    if (event && !event.engaged) {
      event.dismissed = true;
      this.recordFeedback(event.source, false);
      this.persistEvents();
    }
  }

  public getEventLog(): ProactiveEvent[] {
    this.ensureLoaded();
    return this.events.slice().reverse();
  }

  /* ---------------------------- utilities --------------------------- */

  private detectTopic(text: string): string {
    const words = text
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 4);
    return words.slice(0, 3).join(" ") || "general";
  }
}
