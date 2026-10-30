/**
 * ==========================================================
 * LÉLU — WHICH OF HER LOOKS, AND IN WHAT FORM
 *
 * One choice for every surface: her look (one of the outfits built from
 * the owner's references), her form (embodied: as she is; hologram: the
 * same her, projected — a material, not another character).
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { LeluForm, LeluLookId } from "./LeluRig";

export interface LeluCharacterState {
  look: LeluLookId;
  form: LeluForm;
  updatedAt: number;
}

const KEY = "lelu.character.v1";
const LOOKS: readonly LeluLookId[] = ["gothic", "earthy"];
const FORMS: readonly LeluForm[] = ["embodied", "hologram"];

export function defaultCharacterState(): LeluCharacterState {
  return { look: "gothic", form: "embodied", updatedAt: 0 };
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
      form: FORMS.includes(saved.form as LeluForm) ? (saved.form as LeluForm) : base.form,
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

  public setForm(form: LeluForm): LeluCharacterState {
    return FORMS.includes(form) ? this.patch({ form }) : this.state;
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
