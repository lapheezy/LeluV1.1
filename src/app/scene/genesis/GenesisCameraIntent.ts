/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CAMERA INTENT
 *
 * A tiny module-level event bus that lets UI chrome (the
 * spatial controls: zoom in / zoom out / reset) and LÉLU's
 * own activity (surface controller, exploration controller)
 * request camera motion from inside the Three canvases,
 * without reaching into R3F from outside them.
 *
 * GenesisCameraController (v1) and GenesisV2CameraRig (v2)
 * subscribe and apply the intents to the real cameras — the
 * buttons and agent events control the actual view, never a
 * mocked state.
 *
 * A DOM bridge (`genesis-v2-camera`) carries v2 camera
 * commands from chat/exploration into the v2 rig through the
 * same window-event path the v1 world already uses
 * (`planet-navigate`), so LÉLU can drive the camera from
 * conversation.
 * ==========================================================
 */

export type GenesisV2FocusTarget = "lelu" | "core" | "studio" | "lab" | "vault" | "world";

export type GenesisCameraIntent =
  | { type: "zoom-in" }
  | { type: "zoom-out" }
  | { type: "reset" }
  | { type: "focus"; target: GenesisV2FocusTarget }
  | { type: "fly"; position: [number, number, number]; lookAt?: [number, number, number] }
  | { type: "fullscreen" };

export type GenesisV2CameraCommand =
  | { intent: "focus"; target: GenesisV2FocusTarget }
  | { intent: "fly"; position: [number, number, number]; lookAt?: [number, number, number] }
  | { intent: "reset" }
  | { intent: "fullscreen" };

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

/* ------------------------- v2 camera DOM bridge ------------------------- */

/**
 * Dispatch a v2 camera command through the shared window event bridge.
 * The v2 camera rig listens for `genesis-v2-camera` and applies the
 * command to the real camera. Safe to call from chat controllers,
 * the exploration controller, or the surface controller — the rig is
 * the only consumer, so this is inert while Gen V2 is unmounted.
 */
export function dispatchV2CameraCommand(command: GenesisV2CameraCommand): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("genesis-v2-camera", {
      detail: command,
    }),
  );
}

/**
 * Request the browser to make the Gen V2 viewport fullscreen. Browsers
 * require a user gesture (or an agent action that originates from one),
 * so callers that cannot prove a gesture get a silent no-op.
 */
export function requestV2Fullscreen(): void {
  if (typeof document === "undefined") return;
  const el = (document.fullscreenElement ? document : document.documentElement) as Element & {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
  if (document.fullscreenElement) {
    void document.exitFullscreen?.().catch(() => {});
    return;
  }
  if (el.requestFullscreen) {
    void el.requestFullscreen().catch(() => {});
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  }
}
