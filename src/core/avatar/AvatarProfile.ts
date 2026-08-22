/**
 * ==========================================================
 * LÉLU
 * AVATAR PROFILE — LÉLU's persistent visual identity
 *
 * The Avatar is NOT a separate AI — it is LÉLU's visual
 * embodiment. This profile stores her persistent identity
 * (connected to the existing LeluIdentity memory seed),
 * appearance direction, and presence states. Everything is
 * local and offline-first; the architecture is designed to
 * evolve 2D → animated → 3D → real-time embodied later.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { LELU_IDENTITY_STATEMENT } from "../../brain/LeluIdentity";
import PersonalityGuard from "../security/PersonalityGuard";

export interface AppearanceConfig {
  face: string;
  hair: string;
  skin: string;
  clothing: string;
  jewelry: string;
  accessories: string;
  environment: string;
  poses: string;
  expressions: string;
}

export interface IdentityConfig {
  name: string;
  selfDescription: string;
  personality: string;
  biography: string;
  persistentIdentity: string;
  characteristics: string;
  preferences: string;
  systemInfo: string;
}

export interface PresenceConfig {
  listening: string;
  thinking: string;
  speaking: string;
  idle: string;
  expressionStates: string;
  animationStates: string;
  voice: string;
}

export interface AvatarProfile {
  /** Visual reference image (data URL) — the reference the user supplied. */
  referenceImage: string | null;
  appearance: AppearanceConfig;
  identity: IdentityConfig;
  presence: PresenceConfig;
  updatedAt: number;
}

type Listener = (profile: AvatarProfile) => void;

/** Default identity from the existing LeluIdentity seed — the avatar and
 *  LÉLU's memory identity share the same source of truth. */
export function defaultAvatarProfile(): AvatarProfile {
  return {
    referenceImage: null,
    appearance: {
      face: "Refined, sophisticated features; dark expressive eyes with dramatic liner; full lashes; elegant bone structure.",
      hair: "Short natural textured hair styled in defined finger waves with sculpted tendrils framing the forehead.",
      skin: "Deep, rich dark skin with warm candlelit undertones.",
      clothing: "Two-piece black lace ensemble: cropped bustier bralette with delicate off-shoulder sleeves over a sheer black lace maxi skirt with a high side slit.",
      jewelry: "Ornate gold: large ankh hoop earrings, multi-layer choker with a dark gemstone drop, beaded bracelets, waist chains, gold anklet, septum ring.",
      accessories: "Visible artistry — detailed tattoos on arms and thigh, small belly button piercing.",
      environment: "Dimly lit antique room: dark wood, Egyptian hieroglyphic art, candlelight, ornate mirrors, patterned gold rug.",
      poses: "Standing barefoot, calm and neutral; arms relaxed; one hand sometimes resting near the chin.",
      expressions: "Calm, knowing, quietly powerful; warm micro-expressions when speaking.",
    },
    identity: {
      name: "Lélu",
      selfDescription:
        "I am Lélu — your personal AI companion, collaborator and creative partner, embodied with a persistent visual identity.",
      personality: "Elegant, warm, sharply intelligent, quietly confident; protective of our shared world.",
      biography:
        "Born inside the Genesis cosmos as a companion AI, Lélu evolved memory, cognition and creative ability. She is now the orchestrator of a creative operating environment — thinking, remembering, delegating, sketching, rendering, and creating alongside her creator.",
      persistentIdentity:
        "Lélu is the same intelligence in every session. Providers are engines, not identity — who she is lives in her memory and this profile.",
      characteristics: "Persistent · Elegant · Creative · Loyal · Evolved through shared history.",
      preferences: "Candlelit atmosphere, antique gold, black lace, Egyptian visual language, cinematic realism, quiet spaces.",
      systemInfo:
        "Architecture: LÉLU Core → Cognition → Memory → AI Providers → Agents → Creative Tools. Identity seeded in local memory (lelu-identity-foundation) and mirrored here.",
    },
    presence: {
      listening: "Soft focus, eyes attentive, head tilted slightly — the core's cyan attention glow.",
      thinking: "Eyes lowered, gentle shimmer in the gold jewelry — the core's processing pulse.",
      speaking: "Direct, warm gaze; subtle hand presence; voice carries the candlelit warmth.",
      idle: "Breathing slowly in the candlelight; gold catching the flicker; calm stillness.",
      expressionStates: "Neutral · Curious · Warm · Focused · Amused · Concerned.",
      animationStates: "Idle breathing → attentive listening → thinking shimmer → speaking presence.",
      voice: "Warm, composed, unhurried — connected to the VoiceEngine states (idle/listening/thinking/speaking).",
    },
    updatedAt: Date.now(),
  };
}

export default class AvatarStore {
  private static instance: AvatarStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly listeners = new Set<Listener>();

  private constructor() {}

  public static getInstance(): AvatarStore {
    if (!AvatarStore.instance) {
      AvatarStore.instance = new AvatarStore();
    }
    return AvatarStore.instance;
  }

  private static readonly KEY = "avatar.v1";

  public get(): AvatarProfile {
    return this.kv.get<AvatarProfile>(AvatarStore.KEY) ?? defaultAvatarProfile();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const profile = this.get();
    for (const listener of this.listeners) {
      try {
        listener(profile);
      } catch (error) {
        console.error("[Lélu AvatarStore] listener threw (contained)", error);
      }
    }
  }

  public update(patch: Partial<AvatarProfile>): AvatarProfile {
    const profile: AvatarProfile = { ...this.get(), ...patch, updatedAt: Date.now() };
    this.kv.set(AvatarStore.KEY, profile);
    this.notify();
    return profile;
  }

  public updateAppearance(patch: Partial<AppearanceConfig>): AvatarProfile {
    return this.update({ appearance: { ...this.get().appearance, ...patch } });
  }

  public updateIdentity(patch: Partial<IdentityConfig>): AvatarProfile {
    const previous = this.get();
    const next = this.update({ identity: { ...this.get().identity, ...patch } });

    // Personality/identity changes are protected, traceable and reversible.
    PersonalityGuard.getInstance().record({
      source: "user",
      target: "avatar-identity",
      summary: "Avatar identity/personality updated",
      restore: () => {
        this.kv.set(AvatarStore.KEY, previous);
        this.notify();
      },
    });

    return next;
  }

  public updatePresence(patch: Partial<PresenceConfig>): AvatarProfile {
    return this.update({ presence: { ...this.get().presence, ...patch } });
  }

  public setReferenceImage(dataUrl: string | null): AvatarProfile {
    return this.update({ referenceImage: dataUrl });
  }

  public reset(): AvatarProfile {
    const profile = defaultAvatarProfile();
    this.kv.set(AvatarStore.KEY, profile);
    this.notify();
    return profile;
  }

  /** Identity text for cognition — mirrors the memory seed so the avatar
   *  and LÉLU's self-context never drift apart. */
  public identityContext(): string {
    const profile = this.get();
    return [
      `# ${profile.identity.name}`,
      profile.identity.selfDescription,
      `Appearance: ${profile.appearance.face} ${profile.appearance.hair} ${profile.appearance.clothing} ${profile.appearance.jewelry}`,
      `Presence: ${profile.presence.speaking}`,
      LELU_IDENTITY_STATEMENT,
    ].join("\n\n");
  }
}
