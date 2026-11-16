/**
 * ==========================================================
 * LÉLU
 * AVATAR COMMAND BUS
 *
 * The DOWN-link of the avatar control loop. AgentEventBus carries
 * telemetry UP (tool events, render frames); this bus carries
 * executable commands DOWN from the executive/chat layer to the
 * live 3D presence — and brings a VERIFIED observation back.
 *
 *   AvatarResolver / ExecutiveRuntime
 *     → issue(command)            [intent]
 *     → 3D presence executes it    [execution]
 *     → confirm(id, observation)   [measured transform deltas]
 *     → issue() resolves           [verified success]
 *     → or rejects after timeout   [honest failure — never faked]
 *
 * A command is only "successful" if the renderer itself reports
 * that its transforms actually changed. If the presence is not
 * mounted, frozen, or ignores the command, issue() rejects —
 * the caller must report failure, never claim success.
 * ==========================================================
 */

export type AvatarCommandKind =
  | "wave"
  | "move"
  | "look"
  | "dance"
  | "nod"
  | "bow"
  | "agree"
  | "shrug"
  | "heart"
  | "cheer"
  | "jump"
  | "sit"
  | "stand"
  | "leave"
  | "return";

/**
 * Where a "move" goes, or what a "look" faces. Named places are resolved by
 * whichever presence is in view: in a world, places in the room (the Core,
 * the Studio, the Lab, the Vault, her own spot, the person); over the
 * interface, sides of the screen.
 */
export type AvatarPlace =
  | "viewer"
  | "home"
  | "core"
  | "studio"
  | "lab"
  | "vault"
  | "away"
  | "left"
  | "right"
  | "center";

export interface AvatarTarget {
  place: AvatarPlace;
}

export const AVATAR_PLACES: readonly AvatarPlace[] = ["viewer", "home", "core", "studio", "lab", "vault", "away", "left", "right", "center"];

export interface AvatarCommand {
  id: string;
  kind: AvatarCommandKind;
  label: string;
  issuedAt: number;
  /** How long the gesture runs before the presence confirms. */
  durationMs: number;
  /** For "move" and "look": where to, or what to face. */
  target?: AvatarTarget;
  /**
   * The bus's own deadline for this command (ms after `issuedAt`, same
   * Date.now clock). A presence that reports progress instead of an outcome
   * does so just before THIS, not on a guess of its own (M15.3 WP04).
   */
  timeoutMs: number;
}

type CommandListener = (command: AvatarCommand) => void;

interface PendingRequest {
  resolve: (observation: string) => void;
  reject: (reason: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 6_000;

class AvatarCommandBusImpl {
  private static instance: AvatarCommandBusImpl | null = null;

  private listeners = new Set<CommandListener>();
  private pending = new Map<string, PendingRequest>();
  private active: AvatarCommand | null = null;
  /** Commands a presence has taken on (it will answer them itself). */
  private accepted = new Set<string>();
  private seq = 0;

  private constructor() {}

  public static getInstance(): AvatarCommandBusImpl {
    if (!AvatarCommandBusImpl.instance) {
      AvatarCommandBusImpl.instance = new AvatarCommandBusImpl();
    }
    return AvatarCommandBusImpl.instance;
  }

  /** The presence reads this every frame to see what to perform. */
  public get current(): AvatarCommand | null {
    return this.active;
  }

  public subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Issue one command and wait for the renderer's VERIFIED
   * confirmation. Resolves with a measured observation string,
   * rejects with a reason on timeout (presence absent/frozen).
   */
  public issue(
    kind: AvatarCommandKind,
    label: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    target?: AvatarTarget,
  ): Promise<string> {
    // One command at a time — supersede any still-active one honestly.
    if (this.active) {
      const stale = this.active;
      this.active = null;
      this.pending.get(stale.id)?.reject(`Superseded by a newer avatar command.`);
      this.pending.delete(stale.id);
    }

    const id = `avatar-cmd-${++this.seq}-${Date.now()}`;
    const command: AvatarCommand = {
      id,
      kind,
      label,
      issuedAt: Date.now(),
      durationMs: kind === "dance" ? 3_200 : kind === "sit" || kind === "stand" ? 3_000 : kind === "move" && target ? 9_000 : 2_200,
      timeoutMs,
      ...(target ? { target } : {}),
    };

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.accepted.delete(id);
        if (this.active?.id === id) this.active = null;
        reject(
          `No renderer confirmed the “${label}” command within ${Math.round(timeoutMs / 1000)}s.`,
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.active = command;
      for (const listener of this.listeners) {
        try {
          listener(command);
        } catch {
          // a broken listener must never block execution
        }
      }
    });
  }

  /**
   * Called by the live 3D presence AFTER it measured that its own
   * transforms actually changed while performing the command.
   */
  /**
   * Called by a live presence that CANNOT do what was asked, with the real
   * reason (e.g. every spot on that side covers a control). The request
   * fails at once and honestly, instead of timing out as if she froze.
   */
  /**
   * A presence has taken this command on and will answer it (M15.3 WP05).
   * Lets another surface tell "nobody could act on it" (her world was never
   * opened) apart from "she is doing it".
   */
  public accept(id: string): void {
    if (this.pending.has(id)) this.accepted.add(id);
  }

  public isAccepted(id: string): boolean {
    return this.accepted.has(id);
  }

  public decline(id: string, reason: string): void {
    this.accepted.delete(id);
    const pending = this.pending.get(id);
    if (this.active?.id === id) this.active = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(reason);
  }

  public confirm(id: string, observation: string): void {
    this.accepted.delete(id);
    const pending = this.pending.get(id);
    if (this.active?.id === id) this.active = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(observation);
  }
}

/** Public API type (keeps consumers decoupled from the impl class name). */
export type AvatarCommandBusApi = AvatarCommandBusImpl;

const AvatarCommandBus = AvatarCommandBusImpl;
export default AvatarCommandBus;
