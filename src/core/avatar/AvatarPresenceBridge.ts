/**
 * ==========================================================
 * LÉLU
 * AVATAR PRESENCE BRIDGE — live cognition drives the avatar
 *
 * The avatar's presence had no connection to what LÉLU was
 * actually doing. Its PresenceConfig held static prose, and its
 * runtime flags were set by hand from the UI — so a "thinking"
 * avatar was a display decision, not an observation of anything.
 *
 * Meanwhile AIService ALREADY emits the real signals on every
 * turn: subscribeThinking, subscribeSpeaking, subscribeListening
 * fire from inside chat() as cognition actually starts and stops.
 * Nothing consumed them for the avatar.
 *
 * This bridge is the missing wire, and only that. It creates no
 * state of its own: it subscribes to the existing emitters and
 * writes the resulting dialogue state into the existing
 * AvatarStore. If a turn never happens, nothing moves — the
 * avatar cannot show thinking that did not occur.
 * ==========================================================
 */

import AIService from "../AIService";
import AvatarStore, { type AvatarDialogueState } from "./AvatarProfile";

type Listener = (state: AvatarDialogueState) => void;

export default class AvatarPresenceBridge {
  private static instance: AvatarPresenceBridge | null = null;

  private unsubscribers: Array<() => void> = [];
  private listeners = new Set<Listener>();

  /** The three live signals, as last reported by AIService. */
  private thinking = false;
  private speaking = false;
  private listening = false;

  private current: AvatarDialogueState = "idle";
  private started = false;

  private constructor() {}

  public static getInstance(): AvatarPresenceBridge {
    if (!AvatarPresenceBridge.instance) {
      AvatarPresenceBridge.instance = new AvatarPresenceBridge();
    }
    return AvatarPresenceBridge.instance;
  }

  /** Begin following the live runtime. Idempotent. */
  public start(): void {
    if (this.started) return;
    this.started = true;

    const ai = AIService.getInstance();
    this.unsubscribers = [
      ai.subscribeThinking((value) => {
        this.thinking = value;
        this.settle();
      }),
      ai.subscribeSpeaking((value) => {
        this.speaking = value;
        this.settle();
      }),
      ai.subscribeListening((value) => {
        this.listening = value;
        this.settle();
      }),
    ];

    // Mark the state live from now on, without inventing a state.
    void AvatarStore.getInstance().updateRuntime({ dialogueLive: true });
  }

  public stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      try {
        unsubscribe();
      } catch {
        /* a failed unsubscribe must not block teardown */
      }
    }
    this.unsubscribers = [];
    this.started = false;
    // Nothing is driving the state any more, so it stops being live.
    // The last value remains readable, but never as a current fact.
    void AvatarStore.getInstance().updateRuntime({ dialogueLive: false });
  }

  public isRunning(): boolean {
    return this.started;
  }

  public getState(): AvatarDialogueState {
    return this.current;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /**
   * Resolve the three booleans into one state.
   *
   * Speaking wins over thinking, which wins over listening: a turn
   * raises all three at once, and what the avatar should show is the
   * outermost thing happening, not the first flag that arrived.
   */
  private settle(): void {
    const next: AvatarDialogueState = this.speaking
      ? "speaking"
      : this.thinking
        ? "thinking"
        : this.listening
          ? "listening"
          : "idle";

    if (next === this.current) return;
    this.current = next;

    void AvatarStore.getInstance().updateRuntime({
      dialogueState: next,
      dialogueStateAt: Date.now(),
      dialogueLive: true,
      lastAction: `Live cognition: ${next}`,
    });

    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        /* a listener must never break the bridge */
      }
    }
  }
}
