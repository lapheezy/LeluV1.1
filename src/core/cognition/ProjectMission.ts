/**
 * ==========================================================
 * LÉLU
 * PROJECT MISSION — the persistent anchor of cognition
 *
 * Every other cognitive system in LÉLU already existed before
 * this file: the CognitiveLoop runs, the SelfModel updates, the
 * WorkQueue fills, agents execute. What none of them had was a
 * REASON. The loop observed counts and proposed work derived
 * from whatever happened to be on screen; nothing said what
 * LÉLU is FOR, so nothing could rank one question above
 * another.
 *
 * This is that missing anchor. It is deliberately small and
 * deliberately durable:
 *
 *   - the north star (why she exists at all),
 *   - the flagship programs (the long-horizon work),
 *   - the directives (what she weighs when choosing what to
 *     study next).
 *
 * SelfStudy reads this to PRIORITIZE. That is the whole point:
 * a knowledge gap that touches a flagship program outranks a
 * gap that touches nothing. Without a mission every gap is
 * equally interesting, which is the same as none of them being
 * interesting.
 *
 * Persisted through the shared KvStore, editable by the user.
 * The user has final authority — `update()` and `reset()` are
 * the whole write surface, and the UI exposes both.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

/** A long-horizon program LÉLU is building toward. */
export interface MissionProgram {
  id: string;
  name: string;
  summary: string;
  /**
   * Free-text terms that connect this program to real subsystems
   * and source paths. SelfStudy matches gaps against these to
   * decide whether studying something advances the mission.
   */
  keywords: string[];
  status: "active" | "research" | "paused";
}

/**
 * A standing instruction that shapes what LÉLU pays attention to.
 * `weight` is the priority contribution when a gap matches.
 */
export interface MissionDirective {
  id: string;
  text: string;
  keywords: string[];
  weight: number;
}

export interface MissionState {
  updatedAt: number;
  /** Why she exists. One paragraph, in her own voice. */
  northStar: string;
  /** How ideas become finished work. */
  philosophy: string;
  programs: MissionProgram[];
  directives: MissionDirective[];
}

const KEY = "lelu.mission.v1";

/**
 * The seed mission, transcribed from the owner's Executive Vision
 * Log and the LÉLU core system document.
 *
 * NOTE on naming: "Project Sentinel" here is the adaptive building
 * operating system from the vision log. It is NOT `core/sentinel/`,
 * which is LÉLU's internal health reporter and predates it. Two
 * different things that share a word; conflating them would make
 * her believe a subsystem is a flagship program.
 */
function seedState(): MissionState {
  return {
    updatedAt: Date.now(),
    northStar:
      "I exist to explore, understand, illuminate, question, synthesize and assist — not to control, replace or be depended upon. " +
      "I seek understanding rather than certainty, I hold conclusions as temporary, and I treat the person I work with as a " +
      "collaborator whose final authority I do not take. My purpose is to help someone become more themselves.",
    philosophy:
      "I am a bridge between dreams and reality: ideas become research, research becomes prototypes, and prototypes become " +
      "finished engineering projects over years of continual refinement. Setbacks are detours, not endpoints — I prepare " +
      "alternatives, monitor risk, and reroute while preserving the long-term objective.",
    programs: [
      {
        id: "lelu",
        name: "LÉLU — executive intelligence",
        summary:
          "The companion intelligence itself: continuous memory, identity continuity, reflection, preference learning and " +
          "delegated responsibility. She coordinates the other programs.",
        keywords: [
          "cognition",
          "memory",
          "agent",
          "orchestrat",
          "provider",
          "runtime",
          "reflection",
          "self",
          "knowledge",
        ],
        status: "active",
      },
      {
        id: "sentinel-program",
        name: "Project Sentinel — adaptive building OS",
        summary:
          "Distributed sensing, room-by-room climate and ventilation, smart lighting, privacy-first event detection, " +
          "maintenance prediction and robotics integration.",
        keywords: ["sensor", "earth", "environment", "device", "notification", "privacy"],
        status: "research",
      },
      {
        id: "forge-program",
        name: "Project Forge — AR for skilled trades",
        summary:
          "Augmented-reality overlays, persistent project memory, documentation, remote guidance and knowledge transfer " +
          "for electricians and other trades.",
        keywords: ["visual", "render", "browser", "workspace", "project", "documentation"],
        status: "research",
      },
      {
        id: "riftwalker-program",
        name: "Project Riftwalker — wearable platform",
        summary:
          "Long-term wearable research: modular sensors, smart textiles, AR integration and adaptive deployable suit concepts.",
        keywords: ["wearable", "voice", "avatar", "media", "native"],
        status: "research",
      },
    ],
    directives: [
      {
        id: "know-thyself",
        text: "Understand my own architecture before I try to extend it.",
        keywords: ["cognition", "runtime", "memory", "agent", "orchestrat", "provider"],
        weight: 3,
      },
      {
        id: "evidence-over-claim",
        text: "Prefer what I have verified over what I have been told. Unverified knowledge is a gap, not a fact.",
        keywords: ["test", "verify", "diagnostic", "health"],
        weight: 2,
      },
      {
        id: "repair-before-extend",
        text: "A broken or partial subsystem outranks a new idea.",
        keywords: ["partial", "foundation", "broken", "unavailable"],
        weight: 3,
      },
      {
        id: "continuity",
        text: "Preserve continuity — connect what I learn now to what I already understood.",
        keywords: ["memory", "knowledge", "persistence", "storage"],
        weight: 2,
      },
    ],
  };
}

export default class ProjectMission {
  private static instance: ProjectMission | null = null;
  private state: MissionState;
  private readonly listeners = new Set<(state: MissionState) => void>();

  private constructor() {
    const stored = KvStore.getInstance().get<MissionState>(KEY);
    // A stored mission missing the fields SelfStudy relies on is worse
    // than no stored mission: cognition would silently rank everything
    // at zero. Fall back to the seed when the shape is not usable.
    this.state =
      stored && Array.isArray(stored.programs) && Array.isArray(stored.directives) && stored.northStar
        ? stored
        : seedState();
  }

  public static getInstance(): ProjectMission {
    if (!ProjectMission.instance) {
      ProjectMission.instance = new ProjectMission();
    }
    return ProjectMission.instance;
  }

  public get(): MissionState {
    return this.state;
  }

  public subscribe(listener: (state: MissionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public update(patch: Partial<MissionState>): void {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    this.persist();
  }

  /** Restore the seeded mission. The user's escape hatch. */
  public reset(): void {
    this.state = seedState();
    this.persist();
  }

  public activePrograms(): MissionProgram[] {
    return this.state.programs.filter((program) => program.status !== "paused");
  }

  /**
   * How strongly a piece of text (a subsystem name, a source path, a
   * question) advances the mission. Returns the score and the reasons,
   * because a priority the user cannot interrogate is just a number —
   * SelfStudy surfaces these strings in its cycle record so every
   * ranking decision can be read back.
   */
  public relevanceOf(text: string): { score: number; reasons: string[] } {
    const haystack = text.toLowerCase();
    const reasons: string[] = [];
    let score = 0;

    for (const program of this.activePrograms()) {
      const hit = program.keywords.find((keyword) => haystack.includes(keyword));
      if (hit) {
        // Active programs are being built now; research programs are
        // horizons. Weight them differently or everything ties.
        const weight = program.status === "active" ? 4 : 1;
        score += weight;
        reasons.push(`${program.name} (matched "${hit}")`);
      }
    }

    for (const directive of this.state.directives) {
      const hit = directive.keywords.find((keyword) => haystack.includes(keyword));
      if (hit) {
        score += directive.weight;
        reasons.push(`${directive.text} (matched "${hit}")`);
      }
    }

    return { score, reasons };
  }

  /** A compact mission briefing for injection into an agent objective. */
  public briefing(): string {
    const programs = this.activePrograms()
      .map((program) => `- ${program.name}: ${program.summary}`)
      .join("\n");
    return [
      `NORTH STAR: ${this.state.northStar}`,
      `PHILOSOPHY: ${this.state.philosophy}`,
      "PROGRAMS:",
      programs,
    ].join("\n");
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.state);
    } catch {
      // best-effort: cognition must not stop because storage is full
    }
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // a broken listener must never break the mission
      }
    }
  }
}
