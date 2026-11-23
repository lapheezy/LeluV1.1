/**
 * ==========================================================
 * LÉLU — WHICH OF HER LOOKS, AND IN WHAT FORM
 *
 * One choice for every surface: her look (one of the outfits built from
 * the owner's references), her form (embodied: as she is; hologram: the
 * same her, projected — a material, not another character) and her
 * framing (all of her, or head and shoulders).
 *
 * Form and framing default to "auto": the interface she is in decides
 * (avatar/presentationProfile.ts, read by her one presence, LeluCompanion).
 * A choice she or the person makes ("hologram", "face") is kept and wins
 * over the interface until it is set back to "auto".
 *
 * `asre` links her to a persistent ASRE character (server side:
 * plugins/asreCharacters.ts) — which character and which version is
 * "her" in the spatial workspace. The look/form/framing above are
 * unchanged by it.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { LeluForm, LeluFraming, LeluLookId } from "./LeluRig";

/** Her form: one of her forms, or "auto" (the interface decides). */
export type LeluFormChoice = LeluForm | "auto";
/** Her framing: one of her framings, or "auto" (the interface decides). */
export type LeluFramingChoice = LeluFraming | "auto";

export interface AsreCharacterLink {
  characterId: string;
  version: string;
}

export interface LeluCharacterState {
  look: LeluLookId;
  form: LeluFormChoice;
  framing: LeluFramingChoice;
  /** Her persistent ASRE character and the version selected as "her", if any. */
  asre: AsreCharacterLink | null;
  updatedAt: number;
}

function validAsreLink(v: unknown): AsreCharacterLink | null {
  if (!v || typeof v !== "object") return null;
  const { characterId, version } = v as Record<string, unknown>;
  return typeof characterId === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(characterId) && typeof version === "string" && /^v\d{4}$/.test(version) ? { characterId, version } : null;
}

const KEY = "lelu.character.v1";
const LOOKS: readonly LeluLookId[] = ["gothic", "earthy"];
const FORMS: readonly LeluFormChoice[] = ["auto", "embodied", "hologram"];
const FRAMINGS: readonly LeluFramingChoice[] = ["auto", "full", "face"];

export function defaultCharacterState(): LeluCharacterState {
  return { look: "gothic", form: "auto", framing: "auto", asre: null, updatedAt: 0 };
}

type Listener = (state: LeluCharacterState) => void;

export default class LeluCharacterStore {
  private static instance: LeluCharacterStore | null = null;
  private state: LeluCharacterState;
  private readonly listeners = new Set<Listener>();

  private constructor() {
    const saved = KvStore.getInstance().get<Partial<LeluCharacterState>>(KEY) ?? {};
    const base = defaultCharacterState();
    this.state = {
      look: LOOKS.includes(saved.look as LeluLookId) ? (saved.look as LeluLookId) : base.look,
      form: FORMS.includes(saved.form as LeluFormChoice) ? (saved.form as LeluFormChoice) : base.form,
      framing: FRAMINGS.includes(saved.framing as LeluFramingChoice) ? (saved.framing as LeluFramingChoice) : base.framing,
      asre: validAsreLink(saved.asre),
      updatedAt: saved.updatedAt ?? 0,
    };
  }

  public static getInstance(): LeluCharacterStore {
    if (!LeluCharacterStore.instance) LeluCharacterStore.instance = new LeluCharacterStore();
    return LeluCharacterStore.instance;
  }

  /** Test-only. */
  public static resetForTests(): void {
    LeluCharacterStore.instance = null;
  }

  public get(): LeluCharacterState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setLook(look: LeluLookId): LeluCharacterState {
    return LOOKS.includes(look) ? this.patch({ look }) : this.state;
  }

  public setForm(form: LeluFormChoice): LeluCharacterState {
    return FORMS.includes(form) ? this.patch({ form }) : this.state;
  }

  public setFraming(framing: LeluFramingChoice): LeluCharacterState {
    return FRAMINGS.includes(framing) ? this.patch({ framing }) : this.state;
  }

  /** Link (or unlink with null) her persistent ASRE character version. */
  public setAsreCharacter(link: AsreCharacterLink | null): LeluCharacterState {
    if (link === null) return this.patch({ asre: null });
    const valid = validAsreLink(link);
    return valid ? this.patch({ asre: valid }) : this.state;
  }

  private patch(patch: Partial<LeluCharacterState>): LeluCharacterState {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    KvStore.getInstance().set(KEY, this.state);
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        console.error("[LeluCharacterStore] listener threw (contained)", error);
      }
    }
    return this.state;
  }
}
