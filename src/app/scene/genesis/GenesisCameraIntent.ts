/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CAMERA INTENT
 *
 * A tiny module-level event bus that lets UI chrome (the
 * spatial controls: zoom in / zoom out / reset) request camera
 * motion from inside the Three canvas, without reaching into
 * R3F from outside it. GenesisCameraController subscribes and
 * applies the intents to the real OrbitControls — the buttons
 * control the actual view, not a mocked state.
 * ==========================================================
 */

export type GenesisCameraIntent =
  | { type: "zoom-in" }
  | { type: "zoom-out" }
  | { type: "reset" };

type GenesisCameraIntentListener = (intent: GenesisCameraIntent) => void;

class GenesisCameraIntentBus {
  private listeners = new Set<GenesisCameraIntentListener>();

  public emit(intent: GenesisCameraIntent): void {
    for (const listener of this.listeners) {
      listener(intent);
    }
  }

  public subscribe(listener: GenesisCameraIntentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const genesisCameraIntentBus = new GenesisCameraIntentBus();
