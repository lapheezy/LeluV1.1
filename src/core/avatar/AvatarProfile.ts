/**
 * ==========================================================
 * LÉLU
 * AVATAR PROFILE — LÉLU's persistent visual identity
 *
 * The Avatar is NOT a separate AI — it is LÉLU's visual
 * embodiment. This profile stores her persistent identity
 * (connected to the existing LeluIdentity memory seed),
 * appearance direction, and presence states.
 *
 * Text fields persist in KvStore (localStorage).
 * referenceImage persists in IndexedDB (no ~5MB quota limit).
 *
 * Everything is local and offline-first; the architecture is
 * designed to evolve 2D → animated → 3D → real-time embodied.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { LELU_IDENTITY_STATEMENT } from "../../brain/LeluIdentity";
import PersonalityGuard from "../security/PersonalityGuard";
import {
  getReferenceImage,
  setReferenceImage as setImageInDb,
  removeReferenceImage as removeImageFromDb,
} from "./AvatarImageStore";

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

/**
 * What LÉLU is actually doing right now, as the runtime reports it.
 *
 * These are not UI moods. Each value is set from a signal AIService
 * already emits during a real turn, so the avatar reflects cognition
 * rather than a separately maintained display state.
 */
export type AvatarDialogueState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export interface AvatarRuntimeConfig {
  /** Whether the avatar portrait animates (breathing / floating motion). */
  animationActive: boolean;
  /** Whether ambient simulation effects are active (aurora shimmer, particle drift). */
  simulationActive: boolean;
  /** Human-readable summary of the last runtime action applied to the avatar. */
  lastAction: string;
  /** When the runtime state last changed. */
  updatedAt: number;

  /**
   * LIVE dialogue state, driven by AIService's own signals.
   *
   * The avatar previously had no connection to what LÉLU was doing: its
   * presence config held static prose ("Direct, warm gaze…") and its
   * runtime flags were set by hand from the UI. Nothing carried the
   * thinking/speaking/listening signals that a real turn already emits,
   * so a "thinking" avatar was a UI decision rather than an observation.
   */
  dialogueState: AvatarDialogueState;
  /** When that state last changed, from the live signal. */
  dialogueStateAt: number;
  /**
   * Whether a live source is currently driving the state. False means
   * the value below is the last known one, not a current observation —
   * the UI must not present stale state as live.
   */
  dialogueLive: boolean;
}

export interface AvatarProfile {
  /** Visual reference image (data URL) — the reference the user supplied.
   *  Persisted in IndexedDB, never stored in KvStore/localStorage. */
  referenceImage: string | null;
  appearance: AppearanceConfig;
  identity: IdentityConfig;
  presence: PresenceConfig;
  /** Live runtime state — the avatar's current render/animation/simulation
   *  mode. Persisted with the profile so the embodiment survives refresh. */
  runtime: AvatarRuntimeConfig;
  updatedAt: number;
}

type Listener = (profile: AvatarProfile) => void;

/** Fields persisted in KvStore (everything except referenceImage). */
type KvProfile = Omit<AvatarProfile, "referenceImage">;

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
    runtime: {
      animationActive: false,
      simulationActive: false,
      lastAction: "Initialized",
      updatedAt: Date.now(),
      dialogueState: "idle",
      dialogueStateAt: 0,
      dialogueLive: false,
    },
    updatedAt: Date.now(),
  };
}

export default class AvatarStore {
  private static instance: AvatarStore | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly listeners = new Set<Listener>();

  /** referenceImage loaded from IndexedDB — populated asynchronously
   *  when the store is first constructed. Until then, get() returns null. */
  private _referenceImage: string | null = null;

  private constructor() {
    // Older builds stored the image in KvStore before IndexedDB was added.
    // Read that legacy value only as a migration fallback so a saved avatar
    // is not silently replaced by the default SVG after an upgrade.
    const stored = this.kv.get<Partial<AvatarProfile>>(AvatarStore.KEY);
    const legacyImage =
      typeof stored?.referenceImage === "string" && stored.referenceImage.length > 0
        ? stored.referenceImage
        : null;

    getReferenceImage()
      .then((img) => {
        const resolved = img ?? legacyImage;
        this._referenceImage = resolved;

        if (!img && legacyImage) {
          void setImageInDb(legacyImage)
            .then(() => {
              if (stored) {
                const { referenceImage: _legacy, ...kvPayload } = stored;
                this.kv.set(AvatarStore.KEY, kvPayload as KvProfile);
              }
            })
            .catch(() => {
              // Keep the legacy in-memory value if IndexedDB is unavailable.
            });
        }

        this.notify();
      })
      .catch(() => {
        // IndexedDB unavailable — the legacy value still renders when present.
        this._referenceImage = legacyImage;
        this.notify();
      });
  }

  public static getInstance(): AvatarStore {
    if (!AvatarStore.instance) {
      AvatarStore.instance = new AvatarStore();
    }
    return AvatarStore.instance;
  }

  private static readonly KEY = "avatar.v1";

  /** Set only while something is actually driving the dialogue state. */
  private liveDialogue = false;

  /** Returns the current profile — text fields from KvStore merged
   *  with the referenceImage loaded from IndexedDB. */
  public get(): AvatarProfile {
    const kvProfile = this.kv.get<KvProfile>(AvatarStore.KEY);
    const base = kvProfile ?? defaultAvatarProfile();
    // Profiles saved before the runtime field existed have no `runtime` —
    // backfill the default so readers never crash on undefined state.
    const runtimeBase = base.runtime ?? {};
    return {
      ...base,
      runtime: {
        ...runtimeBase,
        animationActive: runtimeBase.animationActive ?? false,
        simulationActive: runtimeBase.simulationActive ?? false,
        lastAction: runtimeBase.lastAction ?? "Initialized",
        updatedAt: runtimeBase.updatedAt ?? base.updatedAt ?? Date.now(),
        dialogueState: runtimeBase.dialogueState ?? "idle",
        dialogueStateAt: runtimeBase.dialogueStateAt ?? 0,
        // Liveness is a RUNTIME fact, not a stored one.
        //
        // It is deliberately not read back from storage: a persisted
        // "true" would survive a reload and make a remembered state look
        // like a current observation. It is held in memory instead, so a
        // fresh process starts not-live and only a running bridge can
        // set it — which is the whole point of the flag.
        dialogueLive: this.liveDialogue,
      },
      // KvStore may have an old referenceImage key from before the
      // IndexedDB migration — always use IndexedDB as the source of truth.
      referenceImage: this._referenceImage ?? null,
    };
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

  /** Persist changes. Text fields go to KvStore; referenceImage goes to
   *  IndexedDB (throws on failure so the UI can show "SAVE FAILED"). */
  public async update(patch: Partial<AvatarProfile>): Promise<AvatarProfile> {
    const base = this.get();
    const profile: AvatarProfile = { ...base, ...patch, updatedAt: Date.now() };

    // Persist the referenceImage to IndexedDB first — this is the
    // operation that can fail (quota, storage blocked). If it fails
    // we propagate the error so the UI can report it.
    if ("referenceImage" in patch) {
      if (patch.referenceImage) {
        await setImageInDb(patch.referenceImage);
        this._referenceImage = patch.referenceImage;
      } else {
        await removeImageFromDb();
        this._referenceImage = null;
      }
    }

    // Persist text fields to KvStore (strip referenceImage so it never
    // hits localStorage's ~5MB quota).
    const { referenceImage: _img, ...kvPayload } = profile;
    this.kv.set(AvatarStore.KEY, kvPayload);

    this.notify();
    return profile;
  }

  public async updateAppearance(patch: Partial<AppearanceConfig>): Promise<AvatarProfile> {
    return this.update({ appearance: { ...this.get().appearance, ...patch } });
  }

  public async updateIdentity(patch: Partial<IdentityConfig>): Promise<AvatarProfile> {
    const previous = this.get();
    const next = await this.update({ identity: { ...this.get().identity, ...patch } });

    // Personality/identity changes are protected, traceable and reversible.
    PersonalityGuard.getInstance().record({
      source: "user",
      target: "avatar-identity",
      summary: "Avatar identity/personality updated",
      restore: () => {
        const { referenceImage: _r, ...kvRestore } = previous;
        this.kv.set(AvatarStore.KEY, kvRestore);
        this.notify();
      },
    });

    return next;
  }

  public async updatePresence(patch: Partial<PresenceConfig>): Promise<AvatarProfile> {
    return this.update({ presence: { ...this.get().presence, ...patch } });
  }

  public async setReferenceImage(dataUrl: string | null): Promise<AvatarProfile> {
    return this.update({ referenceImage: dataUrl });
  }

  /**
   * Apply a runtime state change (animation/simulation mode) to the ONE
   * avatar profile. Persisted with the profile so the embodiment keeps
   * its mode across refresh. Never creates a second avatar system — this
   * is the same AvatarStore the portrait and panels already subscribe to.
   */
  public async updateRuntime(patch: Partial<Omit<AvatarRuntimeConfig, "updatedAt">>): Promise<AvatarProfile> {
    // Liveness is applied to the in-memory flag before the read below,
    // so the returned profile reports the state the caller just set.
    if (typeof patch.dialogueLive === "boolean") {
      this.liveDialogue = patch.dialogueLive;
    }
    const previous = this.get().runtime;
    return this.update({
      runtime: {
        ...previous,
        ...patch,
        updatedAt: Date.now(),
      },
    });
  }

  public reset(): AvatarProfile {
    const profile = defaultAvatarProfile();
    const { referenceImage: _img, ...kvPayload } = profile;
    this.kv.set(AvatarStore.KEY, kvPayload);
    this._referenceImage = null;
    removeImageFromDb().catch(() => {});
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