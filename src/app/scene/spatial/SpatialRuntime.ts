/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL EXPERIENCE ENGINE
 *
 * The ONE runtime that coordinates spatial change. Every scene
 * change goes through it:
 *
 *   current scene      previous scene     destination scene
 *   camera pose        transition progress / direction
 *   transition kind    interrupt / resume / reverse
 *   lighting           particles            geometry morph
 *   avatar anchor      active workspace     interaction state
 *   spatial UI state   render backend
 *
 * Before this, camera movement was requested from five places
 * (the Cosmos panel's `cosmos-navigate` event, `planet-navigate`,
 * the zoom/reset intent bus, ExplorationController and the v2 rig)
 * and nothing owned "where are we and what is happening". The
 * scene could be mid-flight in two directions at once.
 *
 * It does NOT replace anything:
 *   - the camera is still the one GenesisCameraController drives
 *     (OrbitControls remains the only controller; this publishes a
 *     pose the controller applies);
 *   - the Cosmos entities, the Core and the panels are untouched —
 *     transitions arrange the camera around the geometry that is
 *     already there;
 *   - workspaces are still opened through GenesisCore's module
 *     actions (SpatialExperience does that half).
 *
 * GSAP drives progress; `seek()` is pure so it can be tested and
 * scrubbed without timers.
 * ==========================================================
 */

import { gsapDriving, tweenProgress, tweenScalar, type TweenHandle } from "./tweenDriver";
import {
  TRANSITIONS,
  destinationFor,
  sampleCameraPath,
  transitionFor,
  type CameraPose,
  type SpatialSceneId,
  type TransitionKind,
  type TransitionSpec,
  type Vec3,
} from "./SpatialScenes";

export interface SpatialTransitionState {
  kind: TransitionKind;
  spec: TransitionSpec;
  from: SpatialSceneId;
  to: SpatialSceneId;
  /** 0..1 along the path. */
  progress: number;
  direction: 1 | -1;
  startedAt: number;
  interrupted: boolean;
}

export type SpatialInteractionMode = "observe" | "travelling" | "interrupted" | "workspace";

export interface SpatialAvatarState {
  /** Scene she is currently anchored to. */
  scene: SpatialSceneId;
  /** World position of the interface she faces. */
  anchor: Vec3;
  /** Yaw in radians toward that interface. */
  facing: number;
}

export interface SpatialState {
  current: SpatialSceneId;
  previous: SpatialSceneId | null;
  destination: SpatialSceneId | null;
  transition: SpatialTransitionState | null;
  camera: CameraPose;
  /** Scene lighting level driven by the transition (0..1). */
  lighting: number;
  /** Peak particle burst (0..1) — the portals read this. */
  particles: number;
  /** Geometry morph amount (0..1) — the Core reads this. */
  geometryMorph: number;
  avatar: SpatialAvatarState;
  activeWorkspace: SpatialSceneId | null;
  interaction: {
    mode: SpatialInteractionMode;
    hovered: SpatialSceneId | null;
    lastInputAt: number;
  };
  /** Spatial interface visibility. */
  spatialUI: "ambient" | "focused" | "hidden";
  backend: "webgpu" | "webgl";
  lastEvent: string | null;
  updatedAt: number;
}

export type SpatialEvent =
  | "travel:start"
  | "travel:progress"
  | "travel:end"
  | "travel:interrupted"
  | "travel:resumed"
  | "travel:reversed"
  | "scene:instant"
  | "hover"
  | "workspace";

type Listener = (state: SpatialState, event: SpatialEvent) => void;

/** Clamp to 0..1. */
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Is a real WebGPU adapter available in this browser? */
export function detectBackend(): "webgpu" | "webgl" {
  if (typeof navigator === "undefined") return "webgl";
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: unknown } }).gpu;
  return gpu && typeof gpu.requestAdapter === "function" ? "webgpu" : "webgl";
}

export class SpatialRuntime {
  private static instance: SpatialRuntime | null = null;

  private listeners = new Set<Listener>();
  private tween: TweenHandle | null = null;
  private state: SpatialState;
  /** Live anchors fed from the running Cosmos store (one source of truth). */
  private anchors = new Map<SpatialSceneId, Vec3>();
  private startPose: CameraPose;

  public constructor() {
    const core = destinationFor("core");
    this.state = {
      current: "core",
      previous: null,
      destination: null,
      transition: null,
      camera: core.camera,
      lighting: 1,
      particles: 0,
      geometryMorph: 0,
      avatar: { scene: "core", anchor: core.anchor, facing: 0 },
      activeWorkspace: null,
      interaction: { mode: "observe", hovered: null, lastInputAt: 0 },
      spatialUI: "ambient",
      backend: detectBackend(),
      lastEvent: null,
      updatedAt: 0,
    };
    this.startPose = core.camera;
  }

  public static getInstance(): SpatialRuntime {
    if (!SpatialRuntime.instance) SpatialRuntime.instance = new SpatialRuntime();
    return SpatialRuntime.instance;
  }

  /** Test-only: forget the singleton. */
  public static resetForTests(): void {
    SpatialRuntime.instance?.killTween();
    SpatialRuntime.instance = null;
  }

  public getState(): SpatialState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * The camera pose for a scene, with any live anchor override applied
   * (the real galaxy / agent positions in the Cosmos store).
   */
  public poseFor(scene: SpatialSceneId): CameraPose {
    const destination = destinationFor(scene);
    const anchor = this.anchors.get(scene);
    if (!anchor) return destination.camera;
    const dx = anchor.x - destination.anchor.x;
    const dy = anchor.y - destination.anchor.y;
    const dz = anchor.z - destination.anchor.z;
    return {
      position: {
        x: destination.camera.position.x + dx,
        y: destination.camera.position.y + dy,
        z: destination.camera.position.z + dz,
      },
      target: {
        x: destination.camera.target.x + dx,
        y: destination.camera.target.y + dy,
        z: destination.camera.target.z + dz,
      },
      fov: destination.camera.fov,
    };
  }

  /** Live anchors from the running Cosmos store (galaxy and agent universes). */
  public setAnchors(anchors: Partial<Record<SpatialSceneId, Vec3>>): void {
    let changed = false;
    for (const [scene, anchor] of Object.entries(anchors)) {
      if (!anchor) continue;
      const previous = this.anchors.get(scene as SpatialSceneId);
      if (previous && previous.x === anchor.x && previous.y === anchor.y && previous.z === anchor.z) {
        continue;
      }
      this.anchors.set(scene as SpatialSceneId, anchor);
      changed = true;
    }
    if (changed && !this.state.transition) {
      this.state = {
        ...this.state,
        camera: this.poseFor(this.state.current),
        avatar: this.avatarFor(this.state.current),
      };
    }
  }

  /**
   * Travel to a scene through a named (or edge-appropriate) transition.
   * `instant` commits immediately (used for boot and for tests).
   */
  public travel(
    to: SpatialSceneId,
    options: { kind?: TransitionKind; instant?: boolean; durationMs?: number; replace?: boolean } = {},
  ): SpatialState {
    if (to === this.state.current && !this.state.transition) {
      return this.state;
    }
    // One camera, one owner: a second request for the destination already in
    // flight must not start a competing flight. Previously every call killed
    // the tween and restarted from the mid-flight pose, so a repeated click
    // (or an event plus a click) re-based the path on top of itself.
    if (this.state.transition && this.state.destination === to && !options.replace) {
      return this.state;
    }
    const from = this.state.current;
    const kind = options.kind ?? transitionFor(from, to);
    const spec = TRANSITIONS[kind];
    const durationMs = options.durationMs ?? spec.durationMs;

    this.killTween();
    this.startPose = options.replace ? this.poseFor(from) : this.state.camera;

    if (options.instant || durationMs <= 0) {
      this.seek(1, { to, kind, spec, from, progress: 0, direction: 1, startedAt: Date.now(), interrupted: false });
      this.commit();
      return this.state;
    }

    this.state = {
      ...this.state,
      destination: to,
      transition: {
        kind,
        spec,
        from,
        to,
        progress: 0,
        direction: 1,
        startedAt: Date.now(),
        interrupted: false,
      },
      interaction: { ...this.state.interaction, mode: "travelling" },
      lastEvent: "travel:start",
      updatedAt: Date.now(),
    };
    this.applyProgress(0);
    this.emit("travel:start");

    this.tween = tweenProgress(
      durationMs,
      spec.ease,
      (progress) => this.applyProgress(progress),
      () => {
        this.tween = null;
        this.commit();
      },
    );
    return this.state;
  }

  /**
   * Stop a transition where it is (interruptible). The scene stays at the
   * pose actually reached, the destination is kept so it can be resumed,
   * and the interaction state says so honestly.
   */
  public interrupt(): SpatialState {
    const transition = this.state.transition;
    if (!transition || transition.interrupted) return this.state;
    this.killTween();
    this.state = {
      ...this.state,
      transition: { ...transition, interrupted: true },
      interaction: { ...this.state.interaction, mode: "interrupted" },
      lastEvent: "travel:interrupted",
      updatedAt: Date.now(),
    };
    this.emit("travel:interrupted");
    return this.state;
  }

  /** Continue an interrupted transition from the pose actually reached. */
  public resume(): SpatialState {
    const transition = this.state.transition;
    if (!transition || !transition.interrupted) return this.state;
    const spec = transition.spec;
    const remaining = Math.max(0.02, 1 - transition.progress);
    const durationMs = Math.max(220, spec.durationMs * remaining);
    this.state = {
      ...this.state,
      transition: { ...transition, interrupted: false },
      interaction: { ...this.state.interaction, mode: "travelling" },
      lastEvent: "travel:resumed",
      updatedAt: Date.now(),
    };
    this.emit("travel:resumed");
    this.tween = tweenScalar(
      transition.progress,
      1,
      durationMs,
      (progress) => this.applyProgress(progress),
      () => {
        this.tween = null;
        this.commit();
      },
    );
    return this.state;
  }

  /**
   * Run the transition backwards to where it started, restoring the
   * previous scene and camera. Workspaces opened by the destination are
   * the caller's business: state is preserved by minimizing, never by
   * discarding (SpatialExperience does that).
   */
  public reverse(): SpatialState {
    const transition = this.state.transition;
    if (!transition) {
      if (this.state.previous) return this.travel(this.state.previous, { kind: "return-to-core" });
      return this.state;
    }
    if (!transition.spec.reversible) {
      return this.interrupt();
    }
    this.killTween();
    const spec = transition.spec;
    this.state = {
      ...this.state,
      transition: { ...transition, direction: -1, interrupted: false },
      interaction: { ...this.state.interaction, mode: "travelling" },
      lastEvent: "travel:progress",
      updatedAt: Date.now(),
    };
    this.tween = tweenScalar(
      transition.progress,
      0,
      Math.max(180, spec.durationMs * transition.progress),
      (progress) => this.applyProgress(progress),
      () => {
        this.tween = null;
        this.returnToStart();
      },
    );
    return this.state;
  }

  /** Scrub a transition to a specific progress without timers. */
  public seek(progress: number, transition = this.state.transition): SpatialState {
    if (transition) {
      this.state = { ...this.state, transition };
    }
    this.applyProgress(progress);
    return this.state;
  }

  /** Finish the active transition now (arrival). */
  public arrive(): SpatialState {
    this.killTween();
    if (this.state.transition) this.commit();
    return this.state;
  }

  public returnToCore(): SpatialState {
    return this.travel("core", { kind: "return-to-core" });
  }

  public hover(scene: SpatialSceneId | null): SpatialState {
    if (this.state.interaction.hovered === scene) return this.state;
    this.state = {
      ...this.state,
      interaction: { ...this.state.interaction, hovered: scene, lastInputAt: Date.now() },
      updatedAt: Date.now(),
    };
    this.emit("hover");
    return this.state;
  }

  /** Mark a real workspace as active (opened through GenesisCore's actions). */
  public setActiveWorkspace(scene: SpatialSceneId | null): SpatialState {
    if (this.state.activeWorkspace === scene) return this.state;
    this.state = {
      ...this.state,
      activeWorkspace: scene,
      interaction: {
        ...this.state.interaction,
        mode: scene ? "workspace" : this.state.interaction.mode,
        lastInputAt: Date.now(),
      },
      updatedAt: Date.now(),
    };
    this.emit("workspace");
    return this.state;
  }

  public setSpatialUI(visibility: SpatialState["spatialUI"]): SpatialState {
    if (this.state.spatialUI === visibility) return this.state;
    this.state = { ...this.state, spatialUI: visibility, updatedAt: Date.now() };
    this.emit("hover");
    return this.state;
  }

  /** Record that the user grabbed the camera — a transition yields to them. */
  public noteUserInput(): SpatialState {
    if (this.state.transition && !this.state.transition.interrupted) {
      return this.interrupt();
    }
    this.state = {
      ...this.state,
      interaction: { ...this.state.interaction, lastInputAt: Date.now() },
    };
    return this.state;
  }

  /** Boot: arrive at a scene with no cinematic (used on first mount). */
  public start(scene: SpatialSceneId = "core"): SpatialState {
    this.killTween();
    this.state = {
      ...this.state,
      current: scene,
      previous: null,
      destination: null,
      transition: null,
      camera: this.poseFor(scene),
      avatar: this.avatarFor(scene),
      lighting: 1,
      particles: 0,
      geometryMorph: 0,
      interaction: { mode: "observe", hovered: null, lastInputAt: Date.now() },
      lastEvent: "scene:instant",
      updatedAt: Date.now(),
    };
    this.emit("scene:instant");
    return this.state;
  }

  /* ------------------------------- internals ------------------------------ */

  private avatarFor(scene: SpatialSceneId): SpatialAvatarState {
    const destination = destinationFor(scene);
    const anchor = this.anchors.get(scene) ?? destination.anchor;
    const pose = this.poseFor(scene);
    // She faces from her anchor toward the interface the camera is looking at.
    const facing = Math.atan2(pose.target.x - anchor.x, pose.target.z - anchor.z);
    return { scene, anchor, facing };
  }

  private applyProgress(progress: number): void {
    const transition = this.state.transition;
    if (!transition) return;
    const p = clamp01(progress);
    const targetPose = this.poseFor(transition.to);
    const camera = sampleCameraPath(this.startPose, targetPose, p, transition.spec.path);
    const [lightFrom, lightTo] = transition.spec.light;
    this.state = {
      ...this.state,
      transition: { ...transition, progress: p },
      camera,
      lighting: lightFrom + (lightTo - lightFrom) * p,
      particles: Math.sin(Math.PI * p) * transition.spec.burst,
      geometryMorph: transition.spec.morph * p,
      avatar: {
        scene: p >= 0.5 ? transition.to : transition.from,
        anchor: p >= 0.5 ? destinationFor(transition.to).anchor : destinationFor(transition.from).anchor,
        facing: Math.atan2(
          camera.target.x - (p >= 0.5 ? destinationFor(transition.to).anchor.x : destinationFor(transition.from).anchor.x),
          camera.target.z - (p >= 0.5 ? destinationFor(transition.to).anchor.z : destinationFor(transition.from).anchor.z),
        ),
      },
      lastEvent: "travel:progress",
      updatedAt: Date.now(),
    };
    this.emit("travel:progress");
  }

  private commit(): void {
    const transition = this.state.transition;
    const to = transition?.to ?? this.state.destination ?? this.state.current;
    const from = transition?.from ?? this.state.previous;
    this.state = {
      ...this.state,
      current: to,
      previous: from ?? null,
      destination: null,
      transition: null,
      camera: this.poseFor(to),
      lighting: 1,
      particles: 0,
      geometryMorph: 0,
      avatar: this.avatarFor(to),
      interaction: {
        ...this.state.interaction,
        mode: destinationFor(to).panel ? "workspace" : "observe",
      },
      lastEvent: "travel:end",
      updatedAt: Date.now(),
    };
    this.emit("travel:end");
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("lelu:spatial-arrived", {
          detail: { scene: to, from, previous: this.state.previous },
        }),
      );
    }
  }

  private returnToStart(): void {
    const transition = this.state.transition;
    const from = transition?.from ?? this.state.previous ?? "core";
    this.state = {
      ...this.state,
      current: from,
      previous: transition?.to ?? null,
      destination: null,
      transition: null,
      camera: this.poseFor(from),
      lighting: 1,
      particles: 0,
      geometryMorph: 0,
      avatar: this.avatarFor(from),
      interaction: { ...this.state.interaction, mode: "observe" },
      lastEvent: "travel:reversed",
      updatedAt: Date.now(),
    };
    this.emit("travel:reversed");
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("lelu:spatial-arrived", { detail: { scene: from, from: transition?.to ?? null, reversed: true } }),
      );
    }
  }

  private killTween(): void {
    if (this.tween) {
      this.tween.kill();
      this.tween = null;
    }
  }

  private emit(event: SpatialEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, event);
      } catch (error) {
        console.error("[SpatialRuntime] listener threw (contained)", error);
      }
    }
    const bridge = (globalThis as { __leluSpatial?: unknown }).__leluSpatial;
    if (bridge) {
      (bridge as { _state?: SpatialState })._state = this.state;
    }
  }
}

export default SpatialRuntime;

/**
 * The diagnostic bridge the demo and the tests drive (`window.__leluSpatial`).
 * Read-only from outside: travel/return call the same public methods the
 * spatial HUD calls, so nothing can bypass the runtime.
 */
export interface SpatialBridge {
  /** Which animation driver is live: real GSAP, or the rAF fallback. */
  driver: "gsap" | "raf";
  getState: () => SpatialState;
  travel: (scene: SpatialSceneId) => void;
  returnToCore: () => void;
  interrupt: () => void;
  resume: () => void;
  reverse: () => void;
}

export function installSpatialBridge(): () => void {
  if (typeof window === "undefined") return () => {};
  const runtime = SpatialRuntime.getInstance();
  const bridge: SpatialBridge = {
    driver: gsapDriving ? "gsap" : "raf",
    getState: () => runtime.getState(),
    travel: (scene) => {
      runtime.travel(scene);
    },
    returnToCore: () => {
      runtime.returnToCore();
    },
    interrupt: () => {
      runtime.interrupt();
    },
    resume: () => {
      runtime.resume();
    },
    reverse: () => {
      runtime.reverse();
    },
  };
  (globalThis as { __leluSpatial?: SpatialBridge }).__leluSpatial = bridge;
  return () => {
    if ((globalThis as { __leluSpatial?: SpatialBridge }).__leluSpatial === bridge) {
      delete (globalThis as { __leluSpatial?: SpatialBridge }).__leluSpatial;
    }
  };
}
