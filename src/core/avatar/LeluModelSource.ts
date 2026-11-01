/**
 * ==========================================================
 * LÉLU — THE ONE MODEL SOURCE
 *
 * Every surface that shows LÉLU in 3D — the Cosmos world, the
 * companion over chat and workspaces, the avatar panel — gets her
 * model from here. It asks the 3D Forge once for the approved
 * character (validated mesh or rig plus its animation slots),
 * keeps the bytes, and tells subscribers when a newer approved
 * version replaces it (FORGE_CHANGED_EVENT). There is no second
 * download path and no second character.
 *
 * Without a Forge server (static hosting) there is no model, and
 * subscribers are told so; nothing is invented in its place.
 * ==========================================================
 */

import ForgeClient, { FORGE_CHANGED_EVENT } from "../forge/ForgeClient";

export const LELU_FORGE_CHARACTER = "lelu_character";

export interface LeluModel {
  /** Identifies the approved version: model file plus its animation files. */
  key: string;
  glb: ArrayBuffer;
  clips: ArrayBuffer[];
}

export type LeluModelState =
  | { status: "loading" }
  | { status: "ready"; model: LeluModel }
  | { status: "unavailable"; reason: string };

type Listener = (state: LeluModelState) => void;

class LeluModelSourceImpl {
  private state: LeluModelState = { status: "loading" };
  private readonly listeners = new Set<Listener>();
  private started = false;
  private loading: Promise<void> | null = null;

  public get(): LeluModelState {
    this.start();
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.start();
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    void this.load();
    window.addEventListener(FORGE_CHANGED_EVENT, () => void this.load());
  }

  private load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const active = await ForgeClient.active(LELU_FORGE_CHARACTER);
        if (!active.model) {
          if (this.state.status !== "ready") this.set({ status: "unavailable", reason: "No approved 3D model in the Forge yet." });
          return;
        }
        const clipFiles = Object.values(active.animations).flatMap((a) => (a ? [a.file] : []));
        const key = [active.model.file, ...clipFiles].join("|");
        // A placement or mood changed, not her model: nothing to reload.
        if (this.state.status === "ready" && this.state.model.key === key) return;
        const [glb, ...clips] = await Promise.all([active.model.file, ...clipFiles].map((file) => ForgeClient.assetBytes(file)));
        this.set({ status: "ready", model: { key, glb, clips } });
      } catch (error) {
        // Keep a model already shown; only report absence when there is none.
        if (this.state.status !== "ready") {
          this.set({ status: "unavailable", reason: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  private set(next: LeluModelState): void {
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // one subscriber must not break the others
      }
    }
  }
}

const LeluModelSource = new LeluModelSourceImpl();
export default LeluModelSource;
