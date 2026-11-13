/**
 * ==========================================================
 * LÉLU — LIVEKIT VOICE TRANSPORT (browser side)
 *
 * Carries audio, nothing else. Her microphone goes up to the voice agent
 * (services/livekit-agent); her synthesised voice comes back as one remote
 * audio track; transcripts and reply text cross a data channel. All
 * thinking stays in VoiceEngine → AIService, the same conversation as text.
 *
 * Owned by VoiceEngine; loaded with a dynamic import so livekit-client is
 * not in the main bundle for anyone who never starts a voice session.
 *
 * Connection life:
 *   connect()     → POST /api/livekit/token (Supabase session as bearer),
 *                   join the user's own room, publish the mic
 *   LiveKit's own reconnect handles short drops (Reconnecting/Reconnected);
 *   a full disconnect that the user did not ask for is retried with a NEW
 *   token (tokens are short-lived) up to MAX_REJOINS times with backoff.
 *   disconnect()  → leave, release the mic, no retry.
 * ==========================================================
 */
import {
  ConnectionState,
  DisconnectReason,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

export const VOICE_TOPIC = "lelu.voice";
const MAX_REJOINS = 5;

export type AgentMessage =
  | { type: "ready" }
  | { type: "user_speaking" }
  | { type: "transcript"; turnId: number; text: string; audioSeconds?: number }
  | { type: "speaking"; turnId: number }
  | { type: "spoke"; turnId: number }
  | { type: "stopped"; turnId: number | null; reason: string }
  | { type: "error"; where: string; detail: string };

export type LivekitConnection = "idle" | "connecting" | "connected" | "reconnecting" | "rejoining" | "disconnected" | "failed";

export interface LivekitStatus {
  connection: LivekitConnection;
  room: string | null;
  agentPresent: boolean;
  micMuted: boolean;
  error: string | null;
  rejoins: number;
}

export interface LivekitTransportHandlers {
  onMessage: (message: AgentMessage) => void;
  onStatus: (status: LivekitStatus) => void;
  /** Mic could not be opened (permission, no device, insecure context). */
  onMicError: (error: unknown) => void;
  authHeader: () => Record<string, string>;
}

export class LivekitVoiceTransport {
  private room: Room | null = null;
  private audio: HTMLAudioElement | null = null;
  private wanted = false;
  private status: LivekitStatus = { connection: "idle", room: null, agentPresent: false, micMuted: false, error: null, rejoins: 0 };

  constructor(private readonly handlers: LivekitTransportHandlers) {}

  getStatus(): LivekitStatus {
    return { ...this.status };
  }

  isConnected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  private patch(next: Partial<LivekitStatus>): void {
    this.status = { ...this.status, ...next };
    this.handlers.onStatus(this.getStatus());
  }

  private async fetchToken(): Promise<{ url: string; token: string; room: string }> {
    const response = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.handlers.authHeader() },
      body: "{}",
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; url?: string; token?: string; room?: string; error?: string };
    if (!response.ok || !body.token || !body.url || !body.room) {
      throw new Error(body.error ?? `voice session refused (HTTP ${response.status})`);
    }
    return { url: body.url, token: body.token, room: body.room };
  }

  async connect(): Promise<void> {
    this.wanted = true;
    this.patch({ connection: "connecting", error: null });
    try {
      await this.join();
    } catch (error) {
      this.patch({ connection: "failed", error: (error as Error).message });
      throw error;
    }
  }

  private async join(): Promise<void> {
    const { url, token, room: roomName } = await this.fetchToken();
    const room = new Room({ adaptiveStream: false, dynacast: false });
    this.room = room;
    this.wireRoom(room);
    await room.connect(url, token);
    this.patch({ connection: "connected", room: roomName, agentPresent: this.agentIn(room) });
    try {
      // The browser's echo cancellation is what keeps her own voice, played
      // through the speaker, from barging in on herself.
      await room.localParticipant.setMicrophoneEnabled(!this.status.micMuted, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    } catch (error) {
      this.handlers.onMicError(error);
      throw error;
    }
  }

  private agentIn(room: Room): boolean {
    return [...room.remoteParticipants.values()].some((p) => p.identity === "lelu-voice-agent");
  }

  private wireRoom(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio || participant.identity !== "lelu-voice-agent") return;
      const element = (track as RemoteAudioTrack).attach();
      element.setAttribute("data-lelu-voice", "agent");
      element.style.display = "none";
      document.body.appendChild(element);
      this.audio?.remove();
      this.audio = element;
      void element.play().catch(() => {
        // iOS needs a gesture: VoiceEngine.unlockAudio() runs on the Start tap,
        // and LiveKit's startAudio() is retried there too.
      });
    });
    room.on(RoomEvent.ParticipantConnected, () => this.patch({ agentPresent: this.agentIn(room) }));
    room.on(RoomEvent.ParticipantDisconnected, () => this.patch({ agentPresent: this.agentIn(room) }));
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== VOICE_TOPIC || participant?.identity !== "lelu-voice-agent") return;
      try {
        const message = JSON.parse(new TextDecoder().decode(payload)) as AgentMessage;
        if (message.type === "speaking" && this.audio) this.audio.muted = false;
        this.handlers.onMessage(message);
      } catch {
        // not ours
      }
    });
    room.on(RoomEvent.Reconnecting, () => this.patch({ connection: "reconnecting" }));
    room.on(RoomEvent.Reconnected, () => this.patch({ connection: "connected", error: null }));
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      this.audio?.remove();
      this.audio = null;
      if (!this.wanted || reason === DisconnectReason.CLIENT_INITIATED) {
        this.patch({ connection: "disconnected", agentPresent: false });
        return;
      }
      void this.rejoin(String(reason ?? "unknown"));
    });
  }

  /** A drop LiveKit could not resume: come back to the same room with a fresh token. */
  private async rejoin(reason: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_REJOINS && this.wanted; attempt += 1) {
      this.patch({ connection: "rejoining", error: `connection lost (${reason}); rejoining`, rejoins: this.status.rejoins + 1 });
      await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** (attempt - 1))));
      if (!this.wanted) return;
      try {
        await this.join();
        return;
      } catch (error) {
        this.patch({ error: (error as Error).message });
      }
    }
    if (this.wanted) this.patch({ connection: "failed" });
  }

  private async send(message: Record<string, unknown>): Promise<void> {
    if (!this.isConnected() || !this.room) return;
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: VOICE_TOPIC });
  }

  sendReply(turnId: number, text: string): void {
    void this.send({ type: "reply", turnId, text });
  }

  /** STOP: silence here at once, and make the agent drop its audio and generation. */
  stop(): void {
    if (this.audio) this.audio.muted = true;
    void this.send({ type: "stop" });
  }

  async setMicMuted(muted: boolean): Promise<void> {
    this.patch({ micMuted: muted });
    await this.room?.localParticipant.setMicrophoneEnabled(!muted).catch((error) => this.handlers.onMicError(error));
  }

  /** Called from a user gesture: iOS will not start remote audio otherwise. */
  async unlock(): Promise<void> {
    await this.room?.startAudio().catch(() => {});
    await this.audio?.play().catch(() => {});
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    const room = this.room;
    this.room = null;
    await room?.disconnect();
    this.audio?.remove();
    this.audio = null;
    this.patch({ connection: "disconnected", agentPresent: false, room: null });
  }
}
