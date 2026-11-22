/**
 * ==========================================================
 * LÉLU
 * VOICE ENGINE — Full two-way voice pipeline
 * ==========================================================
 *
 * Singleton that manages:
 * - Text-to-speech via speechSynthesis (chunked, barge-in)
 * - Speech recognition via Web Speech API
 * - Groq Whisper fallback for Safari / browsers without Web Speech API
 * - Audio context unlock (iOS Safari)
 * - Voice state management with React subscriptions
 * ==========================================================
 */

import { postTranscription, transcriptionAvailable, WHISPER_NAME_HINT } from "./transcriptionTransport";

import { mapMediaError } from "./speechToText";
import { detectTurnOnAudioThread } from "./vadWorklet";
import { resolveFirst } from "../resolveEnv";
import {
  audioContextState,
  elevenLabsReady,
  forgetElevenLabsStatus,
  getLastSynthesis,
  speakText,
  stopSpeaking,
  ttsQueueDepth,
} from "./elevenLabsTts";
import { toSpokenText } from "./spokenText";
import { resolveSpeechDelivery } from "./speechDelivery";
import { DEFAULT_SPEECH_PROFILE, type SpeechProfileId } from "./speechProfile";
import LeluIdentity from "../identity/LeluIdentity";
import { failureFromError, failureFromResponse, type VoiceTurnFailure } from "./turnFailure";
import { elevenLabsSttReady, transcribeWithElevenLabs } from "./elevenLabsStt";
import UsageBudgetGate, { BudgetExhaustedError, budgetNotice } from "../observability/UsageBudgetGate";

/* ---------------------------------------------------------
 * Types
 * --------------------------------------------------------- */

export type VoicePhase =
  | "idle"
  | "listening"
  | "processing"
  | "responding"
  | "speaking";

export type VoiceErrorKind =
  | "permission"
  | "insecure"
  | "blocked-embed"
  | "no-device"
  | "service"
  | "audio"
  | "offline"
  | "unsupported"
  | "network"
  | "recognition"
  | "error"
  | "tts";

const SPEECH_CHUNK_SIZE = 200;

/**
 * Split text into chunks speechSynthesis can speak smoothly — long
 * single utterances get cut off or stall on some engines. Splits on
 * sentence boundaries first; a single "sentence" longer than the
 * target size (no spaces to break on) is hard-split so no chunk ever
 * exceeds the limit. A pure function so TTS chunking is testable
 * without a SpeechSynthesis implementation.
 */
export function chunkForSpeech(text: string): string[] {
  if (!text) return [];
  if (text.length <= SPEECH_CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";

  const flush = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const sentence of sentences) {
    if (sentence.length > SPEECH_CHUNK_SIZE) {
      // No spaces to break on (or one very long token) — hard-split.
      flush();
      for (let i = 0; i < sentence.length; i += SPEECH_CHUNK_SIZE) {
        chunks.push(sentence.slice(i, i + SPEECH_CHUNK_SIZE));
      }
      continue;
    }
    if (current.length + sentence.length + 1 > SPEECH_CHUNK_SIZE) {
      flush();
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [text];
}

const ECHO_MIN_TOKEN_OVERLAP = 0.7;

/**
 * Is `candidate` (a freshly recognized "user" utterance) actually an
 * echo of LÉLU's own `spoken` TTS output picked back up by the still-
 * open microphone? Without this check, an open-mic voice loop reliably
 * talks to itself: it speaks a reply, the mic hears it, and that gets
 * fed back in as if the user said it. A pure string heuristic — exact
 * match, substring in either direction, or high word-token overlap —
 * so it's testable without a live audio pipeline.
 */
export function isEchoUtterance(candidate: string, spoken: string): boolean {
  const a = candidate.trim().toLowerCase();
  const b = spoken.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;

  // Tiny fragments ("the", "um") are near-useless as genuine barge-in
  // and very commonly a recognizer's mis-hearing of trailing TTS audio.
  if (a.length <= 3) return true;

  if (b.includes(a) || a.includes(b)) return true;

  const tokenize = (s: string) => s.split(/\W+/).filter((t) => t.length > 0);
  const aTokens = tokenize(a);
  const bTokens = new Set(tokenize(b));
  if (aTokens.length === 0) return false;

  const overlap = aTokens.filter((t) => bTokens.has(t)).length / aTokens.length;
  return overlap >= ECHO_MIN_TOKEN_OVERLAP;
}

/**
 * Classify a browser SpeechRecognition `error` code into a diagnosis
 * LÉLU can act on and explain honestly. Pulled out of the onerror
 * handler as a pure function so the mapping is unit-testable and has
 * exactly one implementation.
 *
 * The critical distinction this exists to preserve: "permission" must
 * mean the user actually denied the mic — never a stand-in for "the
 * platform's speech service is off" (service-not-allowed) or "the
 * mic hardware is busy/unavailable" (audio-capture, busy). Blaming
 * permission for those sends the user to re-grant a permission they
 * already have, which never fixes anything.
 */
export function mapRecognitionError(
  code: string,
): { kind: VoiceErrorKind; message: string } | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      // Not failures — no speech detected, or recognition was
      // intentionally stopped. The caller just continues.
      return null;
    case "not-allowed":
    case "permission-denied":
      return { kind: "permission", message: "Microphone permission denied." };
    case "service-not-allowed":
      return {
        kind: "service",
        message: "Speech recognition service is unavailable — check your system's dictation/speech settings.",
      };
    case "audio-capture":
    case "busy":
      return {
        kind: "audio",
        message: "Microphone is unavailable — it may be in use by another app.",
      };
    case "network":
      return { kind: "offline", message: "Speech recognition network error." };
    default:
      return { kind: "error", message: `Recognition error: ${code}` };
  }
}

export interface VoiceState {
  active: boolean;
  phase: VoicePhase;
  permission: "unknown" | "granted" | "denied";
  error: string | null;
  errorKind: VoiceErrorKind | null;
  /**
   * The last turn-level failure, told apart: provider timeout, transcription
   * failure, playback failure, user cancellation, network failure, provider
   * unavailable. Shown, never spoken as her answer.
   */
  turnFailure?: (VoiceTurnFailure & { at: number }) | null;
  /**
   * The user's voice session is still on, but the microphone is not being
   * captured right now: the page went to the background, the OS took the
   * microphone (a call, Siri) or the device disappeared and is being
   * re-acquired. The UI must not claim she is listening while this is true.
   */
  captureSuspended?: boolean;
}

/**
 * How a spoken sentence became text.
 *
 * Source and confidence are recorded because they are facts about the turn,
 * not decoration: a later reader must be able to tell browser recognition
 * from Whisper from the LiveKit agent, and must not be shown a confidence the
 * engine never produced. `confidence` is therefore optional and only ever set
 * from a value the recogniser actually returned.
 */
export interface TranscriptProvenance {
  source: "browser-recognition" | "groq-whisper" | "elevenlabs-scribe" | "livekit-agent";
  /** 0–1, only when the recognition engine reported one. */
  confidence?: number;
  /** Whether this was a final transcript or a partial one. */
  final: boolean;
  at: number;
}

export interface VoiceTurn {
  id: string;
  user: string;
  response: string | null;
  timestamp: number;
  /** Set when the turn ended in a failure rather than an answer. */
  failure?: VoiceTurnFailure | null;
  /** Which recogniser produced `user`, and whether it gave a confidence. */
  transcript?: TranscriptProvenance;
}

/** How far the text-to-speech pipeline actually got for the last
 *  response. Distinct from `ttsSupported`, which is only a capability
 *  claim about the runtime. */
export type VoiceTtsStage =
  | "idle"
  | "requested"
  | "generated"
  | "playing"
  | "ended"
  | "failed";

export interface VoiceDiagnostics {
  /* ---- static capability (what this runtime CAN do) ---- */
  sttSupported: boolean;
  ttsSupported: boolean;
  micAvailable: boolean;
  groqKeyAvailable: boolean;
  secureContext: boolean;

  /* ---- live pipeline state (what actually HAPPENED) ----
   * These mirror the real voice pipeline stage by stage, so a failure
   * can be located precisely instead of being reported as a single
   * opaque "voice didn't work". Reset per session by stop(). */
  /** Real mic permission as last observed. */
  micPermission: VoiceState["permission"];
  /** A recognition API (not just the Whisper fallback) is present. */
  recognitionSupported: boolean;
  /** TTS is genuinely usable right now, not merely "supported". */
  ttsAvailable: boolean;
  /** A live mic MediaStream is currently held. */
  micStreamActive: boolean;
  /** The recognizer is currently running. */
  recognitionActive: boolean;
  /** At least one transcript arrived this session. */
  transcriptReceived: boolean;
  /** A response was handed to the speech layer this session. */
  responseReceived: boolean;
  /** Speech was actually requested of the TTS engine. */
  ttsRequested: boolean;
  /** The TTS engine produced an utterance. */
  audioGenerated: boolean;
  /** Audio is currently playing. */
  audioPlaying: boolean;
  /** Furthest stage the TTS pipeline reached for the last response. */
  ttsStage: VoiceTtsStage;

  /* ---- conversational responsiveness ---- */
  /** A streamed reply is being spoken right now (begin → feed… → finish). */
  streaming: boolean;
  /**
   * Streamed text dropped because a newer turn owned the conversation.
   * A superseded turn that kept streaming is what used to speak over the
   * user's latest question; this number is the proof it no longer does.
   */
  staleStreamsDropped: number;
  /** Transcript → first streamed text, this turn (null before it happens). */
  firstTextLatencyMs: number | null;
  /** Transcript → first audible speech, this turn (null before it happens). */
  firstAudioLatencyMs: number | null;
  /** Segments synthesised ahead of playback and still waiting. */
  ttsQueueDepth: number;
  /** Transcript → sound the output device reported playing (M22.9). */
  firstAudibleLatencyMs: number | null;
  /** Whether an output context exists and in what state. */
  audioContextState: "suspended" | "running" | "closed" | "unknown";
  /** Output devices the browser enumerated; null means it was never asked. */
  speakerDevices: number | null;
  /**
   * What the server's speech runtime reported for the last sentence — the
   * warm worker's own numbers, read from its headers, never estimated here.
   */
  warmSynthesis: {
    ms: number;
    synthesisMs: number | null;
    modelLoads: number | null;
    streaming: string | null;
    profile: string | null;
    coldStart: boolean;
  } | null;
  /** Times the user spoke over her and she stopped, this session. */
  bargeIns: number;
  /**
   * The mic stays open while she speaks (full-duplex capture). Without a
   * physical device this is the simulated path — the hardware gate is
   * separate and stays blocked until a real microphone is used.
   */
  fullDuplex: boolean;

  /* ---- persistent session lifecycle (M22.9 persistent runtime) ---- */
  /** Microphone streams currently held by the engine (must be 0 or 1). */
  micStreamsOpen: number;
  /** Total microphone streams acquired / released since load. */
  micStreamsAcquired: number;
  micStreamsReleased: number;
  /** The OS muted the captured track (phone call, Siri, another app). */
  micInterrupted: boolean;
  /** Times the microphone was lost mid-session and re-acquired. */
  captureRecoveries: number;
  /** Times the microphone was lost mid-session (ended track, revoked permission). */
  captureLosses: number;
  /** Page visibility as last observed by the engine. */
  pageVisible: boolean;
  /** Lifecycle listeners the engine holds (bound once; never accumulates). */
  lifecycleListeners: number;
}

/**
 * One turn's responsiveness, kept after the turn so it can be read (and
 * measured) instead of guessed. All times are milliseconds since the
 * transcript that started the turn.
 */
export interface TurnLatency {
  turnId: string;
  transcriptAt: number;
  firstTextAt: number | null;
  /** Audio was handed to a player. */
  firstAudioAt: number | null;
  /**
   * The output device reported that sound was actually playing (M22.9).
   * Separated from `firstAudioAt` because the two are not the same moment:
   * a latency report that shows only the earlier one flatters the pipeline.
   */
  firstAudibleAt: number | null;
}

type StateListener = (state: VoiceState) => void;
type InterimListener = (text: string) => void;
type TurnListener = (turn: VoiceTurn | null) => void;
type DiagnosticsListener = (diag: VoiceDiagnostics) => void;
type UtteranceListener = (text: string) => void;
type ErrorListener = (message: string) => void;

/* ---------------------------------------------------------
 * Groq Whisper helpers (imported lazily to avoid circular deps)
 * --------------------------------------------------------- */

/**
 * A Groq key held by THIS runtime, if any.
 *
 * `import.meta.env.VITE_GROQ_API_KEY` is deliberately not read: Vite
 * inlines it into the client bundle, which is how transcription keys
 * ended up in the shipped VoiceEngine chunk. When nothing is held here
 * the request is relayed instead and the SERVER attaches the credential
 * (see voice/transcriptionTransport.ts). The injected global remains for runtimes
 * that legitimately supply a key at runtime — verification scripts, and
 * native shells that hold their own credential.
 */
function getGroqApiKey(): string {
  const runtimeEnv = globalThis as typeof globalThis & {
    __LELU_GROQ_API_KEY__?: string;
  };

  return runtimeEnv.__LELU_GROQ_API_KEY__?.trim() || "";
}

/**
 * Transcribe a Blob of audio via the Groq Whisper API.
 * Accepts webm, ogg, wav, mp4, and m4a formats.
 */
/**
 * Groq Whisper, metered like every other billed call (UsageBudgetGate,
 * kind "api", source "groq-whisper"). Before Phase 10 it was not counted.
 */
async function transcribeViaWhisper(audioBlob: Blob): Promise<string> {
  const gate = UsageBudgetGate.getInstance();
  const reservation = await gate.reserve("api", "groq-whisper");
  const started = Date.now();
  try {
    const text = await transcribeViaWhisperUnmetered(audioBlob);
    await gate.settle(reservation, { operation: "stt", model: "whisper-large-v3-turbo", ok: true, latencyMs: Date.now() - started });
    return text;
  } catch (error) {
    await gate.settle(reservation, { operation: "stt", model: "whisper-large-v3-turbo", ok: false, latencyMs: Date.now() - started, error: (error as Error).message });
    throw error;
  }
}

async function transcribeViaWhisperUnmetered(audioBlob: Blob): Promise<string> {
  const apiKey = getGroqApiKey();

  const mime = audioBlob.type || "audio/webm";
  const ext = mime.includes("wav")
    ? "wav"
    : mime.includes("ogg")
      ? "ogg"
      : mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : "webm";

  const formData = new FormData();
  formData.append("file", audioBlob, `recording.${ext}`);
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "verbose_json");
  // Whisper spells unfamiliar names by sound ("Lou", "Lulu"); a prompt with
  // her name biases it to the right spelling. Not a language hint.
  formData.append("prompt", WHISPER_NAME_HINT);

  // No local key is the normal case: the request is relayed same-origin
  // and the server attaches the credential (see voice/transcriptionTransport.ts).
  const response = await postTranscription(formData, {
    apiKey,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Whisper transcription failed (${response.status}): ${errorText}`,
    );
  }

  const data = await response.json();
  const text = typeof data?.text === "string" ? data.text.trim() : "";

  // An empty transcript is silence, not a failure: the loop goes back to
  // listening. (Throwing here logged an error for every quiet moment.)

  return text;
}

/**
 * What LÉLU's voice is doing right now, for anything that has to move
 * WITH it (the companion avatar's mouth and body). Emitted from the real
 * speech engine's own events — utterance start, word boundary, end — never
 * from a timer that guesses.
 */
export interface SpeechActivity {
  /** True from the first utterance's start until the queue has drained. */
  speaking: boolean;
  /** "start" | "word" | "end" — what just happened. */
  kind: "start" | "word" | "end";
  /** The text of the utterance this event belongs to. */
  text: string;
  /** For "word": the character index of the word within `text`. */
  charIndex?: number;
  at: number;
}
type SpeechActivityListener = (activity: SpeechActivity) => void;

/** Recognition errors after which restarting would only repeat the error. */
const FATAL_RECOGNITION_KINDS: ReadonlySet<VoiceErrorKind> = new Set(["permission", "insecure", "no-device", "unsupported", "blocked-embed"]);

/**
 * Should what the mic heard while LÉLU is speaking interrupt her?
 * Two words or more that are not her own voice coming back through the
 * mic. Pure, so the rule is testable without audio.
 */
export function isBargeIn(heard: string, spoken: string): boolean {
  const text = heard.trim();
  if (!text) return false;
  if (text.split(/\s+/).filter(Boolean).length < 2) return false;
  return !isEchoUtterance(text, spoken);
}

/* ---------------------------------------------------------
 * VoiceEngine
 * --------------------------------------------------------- */

class VoiceEngine {
  private static instance: VoiceEngine | null = null;

  private audioUnlocked = false;
  private cancelFlag = false;

  private _state: VoiceState = {
    active: false,
    phase: "idle",
    permission: "unknown",
    error: null,
    errorKind: null,
  };

  private _turn: VoiceTurn | null = null;
  /** LÉLU's most recent spoken TTS text, used to catch the mic hearing itself. */
  private lastSpokenText = "";
  /**
   * Whether the SERVER can supply the Groq credential for transcription.
   * Resolved asynchronously (one same-origin request) and cached here so
   * computeDiagnostics() stays synchronous for its existing callers.
   */
  private relayGroqAvailable = false;
  /**
   * Live pipeline facts, kept ACROSS the capability poll.
   *
   * The 5 s poll rebuilt diagnostics from static capability alone, which
   * reset ttsStage/audioPlaying/transcriptReceived to their defaults while
   * the pipeline was mid-reply — so the panel reported "idle" during speech.
   * Capability is recomputed; what actually happened is preserved here.
   */
  private live: Partial<VoiceDiagnostics> = {};
  private _diagnostics: VoiceDiagnostics = this.computeDiagnostics();

  /** The turn whose latency is being measured (see TurnLatency). */
  private turnLatency: TurnLatency | null = null;
  /** Total streamed deltas dropped as belonging to a superseded turn. */
  private staleStreamDrops = 0;
  /** Output devices the browser reported; null until it has been asked. */
  private speakerDevices: number | null = null;
  /** The turn that owns streamed speech right now (see beginStreamingSpeech). */
  private streamOwner: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private mediaStream: MediaStream | null = null;

  /** Groq Whisper fallback: active when Web Speech API is unavailable. */
  private whisperFallbackActive = false;
  private whisperLoopBusy = false;
  /** Last submitted utterance, to drop an identical one arriving moments later. */
  private lastUtterance: { text: string; at: number } | null = null;
  private whisperFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Web Speech watchdog: a recognizer that neither returns results nor
   * raises an error (seen when the browser's speech service is unreachable)
   * would otherwise leave the user talking into a dead mic. The watchdog
   * listens to the mic level; speech energy with no recognition result
   * shortly after means the recognizer is not working -> switch to Whisper.
   */
  private webSpeechWatchdog: { stop: () => void } | null = null;
  private webSpeechGotResult = false;

  private readonly stateListeners = new Set<StateListener>();
  private readonly interimListeners = new Set<InterimListener>();
  private readonly turnListeners = new Set<TurnListener>();
  private readonly diagnosticsListeners = new Set<DiagnosticsListener>();
  private readonly utteranceListeners = new Set<UtteranceListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly speechActivityListeners = new Set<SpeechActivityListener>();

  /** Utterances queued in speechSynthesis that have not ended yet. */
  private pendingUtterances = 0;
  /** Streamed speech deferred until the server says which voice speaks. */
  private awaitingVoice = 0;
  /** A streamed reply is being spoken (begin → feed… → finish). */
  private streaming = false;
  /** speakResponse() is walking its chunk chain. */
  private chainActive = false;
  /** Streamed segments handed to her server voice that have not finished. */
  private streamSegmentsPending = 0;
  /** The recognizer is currently running (between onstart and onend). */
  private recognitionRunning = false;
  /** Barge-ins this session (diagnostics). */
  private bargeIns = 0;

  /* ---- persistent session lifecycle ----
   * One session = one intentional start … one stop. `sessionEpoch` changes on
   * every stop, so anything that was awaiting (a getUserMedia prompt, a
   * re-acquire, a provider probe) can tell its session has ended and release
   * what it got instead of reviving a session the user closed. */
  private sessionEpoch = 0;
  /** A start() is awaiting the microphone; a second tap must not open another. */
  private starting: Promise<void> | null = null;
  /** A capture re-acquire is in progress (single flight). */
  private recovering: Promise<void> | null = null;
  /** Listeners on the current stream's tracks, removed when it is released. */
  private trackCleanup: (() => void) | null = null;
  private streamsAcquired = 0;
  private streamsReleased = 0;
  private captureRecoveries = 0;
  private captureLosses = 0;
  /** Document/window listeners: bound once for the singleton's life. */
  private lifecycleCleanup: Array<() => void> = [];
  private lifecycleBound = false;

  /* LiveKit transport mode (see livekitTransport.ts). When set, the mic is
   * LiveKit's, transcripts arrive from the voice agent, and replies are spoken
   * by the agent through the VoxCPM2 worker. Cognition does not move. */
  private livekit: import("./livekitTransport").LivekitVoiceTransport | null = null;
  private livekitStatus: import("./livekitTransport").LivekitStatus | null = null;
  private livekitSpeaking = false;
  private livekitTurn = 0;
  private readonly livekitListeners = new Set<(status: import("./livekitTransport").LivekitStatus | null) => void>();

  /** How long each recording chunk is (ms) before sending to Whisper. */
  private static readonly WHISPER_CHUNK_MS = 5000;

  /* ---------------------------------------------------------
   * Singleton
   * --------------------------------------------------------- */

  static getInstance(): VoiceEngine {
    if (!VoiceEngine.instance) {
      VoiceEngine.instance = new VoiceEngine();
    }
    return VoiceEngine.instance;
  }

  private constructor() {
    if (typeof window !== "undefined") {
      void this.refreshRelayDiagnostics();
      const poll = setInterval(() => {
        this._diagnostics = this.computeDiagnostics();
      }, 5000);
      // A diagnostics poll must never be what keeps a process alive
      // (Node runtimes, tests). No-op in browsers.
      (poll as unknown as { unref?: () => void }).unref?.();
    }
  }

  /**
   * Ask the server once whether it holds a Groq credential, then
   * recompute diagnostics so `groqKeyAvailable` / `sttSupported` report
   * the real capability instead of assuming a browser-side key.
   */
  private async refreshRelayDiagnostics(): Promise<void> {
    try {
      this.relayGroqAvailable = await transcriptionAvailable();
    } catch {
      this.relayGroqAvailable = false;
    }
    this._diagnostics = this.computeDiagnostics();
    for (const listener of this.diagnosticsListeners) {
      try {
        listener(this._diagnostics);
      } catch {
        // a broken listener must never break the voice engine
      }
    }
  }

  /* ---------------------------------------------------------
   * Public API
   * --------------------------------------------------------- */

  getState(): VoiceState {
    return this._state;
  }

  getDiagnostics(): VoiceDiagnostics {
    return this._diagnostics;
  }

  /**
   * Static capability snapshot — what this browser/runtime can do,
   * independent of whether voice is currently active. Distinct from
   * getState().permission, which only reflects the mic's actual grant
   * once requested.
   */
  getCapabilities(): {
    recognition: "available" | "unsupported";
    tts: boolean;
    micPermission: VoiceState["permission"];
  } {
    return {
      recognition: VoiceEngine.hasSpeechRecognitionAPI() ? "available" : "unsupported",
      tts: this._diagnostics.ttsSupported,
      micPermission: this._state.permission,
    };
  }

  /** True if voice (recognition or Whisper fallback, plus TTS) can run at all here. */
  isSupported(): boolean {
    return (this._diagnostics.sttSupported || this._diagnostics.micAvailable) && this._diagnostics.ttsSupported;
  }

  async toggle(): Promise<void> {
    if (this.livekit) {
      await this.endLivekitSession();
      return;
    }
    // iOS: audio may only be unlocked inside the tap itself, before any await.
    this.unlockAudio();
    // A second tap while the first is still opening the session (provider
    // probe, permission prompt) is "stop", not a second session. Decided
    // synchronously, before any await: two taps used to both reach
    // getUserMedia and open two streams.
    if (this.starting) {
      this.stop();
      return;
    }
    if (this._state.active) {
      this.stop();
      return;
    }
    await this.start();
  }

  /** The current (or last) voice turn, for a component that mounts mid-session. */
  getTurn(): VoiceTurn | null {
    return this._turn;
  }

  /** End the voice session (public alias of the stop half of toggle). */
  end(): void {
    if (this.livekit) {
      void this.endLivekitSession();
      return;
    }
    this.stop();
  }

  /* ---------------------------------------------------------
   * Subscriptions
   * --------------------------------------------------------- */

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onInterim(listener: InterimListener): () => void {
    this.interimListeners.add(listener);
    return () => {
      this.interimListeners.delete(listener);
    };
  }

  onTurn(listener: TurnListener): () => void {
    this.turnListeners.add(listener);
    return () => {
      this.turnListeners.delete(listener);
    };
  }

  onDiagnostics(listener: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(listener);
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  onUtterance(listener: UtteranceListener): () => void {
    this.utteranceListeners.add(listener);
    return () => {
      this.utteranceListeners.delete(listener);
    };
  }

  /** LÉLU's speech as it actually plays: start, each word, end. */
  onSpeechActivity(listener: SpeechActivityListener): () => void {
    this.speechActivityListeners.add(listener);
    return () => {
      this.speechActivityListeners.delete(listener);
    };
  }

  /**
   * Whether she is speaking right now: browser utterances queued, OR her
   * ElevenLabs reply chain running (synthesising or playing a segment).
   * Counting only browser utterances made this false for the whole of her
   * real voice, so barge-in never fired on it (found live, 2026-11-07).
   */
  isSpeaking(): boolean {
    return (
      this.pendingUtterances > 0 ||
      this.awaitingVoice > 0 ||
      (this.chainActive && this.elevenLabs) ||
      this.livekitSpeaking
    );
  }

  /** How many times the user has interrupted her this session. */
  getBargeInCount(): number {
    return this.bargeIns;
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /* ---------------------------------------------------------
   * LiveKit voice session (transport only)
   * --------------------------------------------------------- */

  onLivekitStatus(listener: (status: import("./livekitTransport").LivekitStatus | null) => void): () => void {
    this.livekitListeners.add(listener);
    listener(this.livekitStatus);
    return () => {
      this.livekitListeners.delete(listener);
    };
  }

  private livekitProbe: Promise<boolean> | null = null;
  private livekitProbedAt = 0;

  /**
   * Is a LiveKit voice transport configured on this server? Asked once and
   * re-asked after a minute if the answer was no, so every existing voice
   * entry point (composer mic, navigator mic, holding the planet) uses LiveKit
   * where it exists and the browser voice where it does not.
   */
  livekitPreferred(): Promise<boolean> {
    if (this.livekitProbe && (Date.now() - this.livekitProbedAt < 60_000)) return this.livekitProbe;
    this.livekitProbedAt = Date.now();
    this.livekitProbe = (typeof fetch === "undefined"
      ? Promise.resolve(false)
      : fetch("/api/livekit/status")
          .then((response) => (response.ok ? response.json() : null))
          .then((body: { configured?: boolean } | null) => Boolean(body?.configured))
          .catch(() => false)).then((configured) => {
      if (configured) this.livekitProbedAt = Number.POSITIVE_INFINITY; // stable: do not re-ask
      return configured;
    });
    return this.livekitProbe;
  }

  /** Called from a tap when iOS refused to start her audio. */
  async enableLivekitAudio(): Promise<void> {
    this.unlockAudio();
    await this.livekit?.unlock();
  }

  getLivekitStatus(): import("./livekitTransport").LivekitStatus | null {
    return this.livekitStatus;
  }

  private publishLivekitStatus(status: import("./livekitTransport").LivekitStatus | null): void {
    this.livekitStatus = status;
    for (const listener of this.livekitListeners) listener(status);
  }

  /**
   * Start a voice session over LiveKit. Must be called from a user gesture
   * (iOS audio). The browser-voice session, if running, is stopped first: one
   * microphone, one engine.
   */
  async startLivekitSession(): Promise<void> {
    if (this.livekit) return;
    if (this._state.active) this.stop();
    this.unlockAudio();
    if (typeof window !== "undefined" && !window.isSecureContext) {
      this.setError("Microphone requires HTTPS. Open this page over HTTPS.", "insecure");
      return;
    }
    const [{ LivekitVoiceTransport }, { sessionAuthHeader }] = await Promise.all([
      import("./livekitTransport"),
      import("../persistence/sessionAuth"),
    ]);
    const transport = new LivekitVoiceTransport({
      authHeader: sessionAuthHeader,
      onStatus: (status) => {
        this.publishLivekitStatus(status);
        if (status.connection === "failed" && this.livekit === transport) {
          this.setError(status.error ?? "Voice session failed.", "network");
        }
      },
      onMicError: (error) => {
        const diagnosis = mapMediaError(error instanceof DOMException || error instanceof Error ? error : { name: String(error) });
        this.updateState({ ...this._state, permission: diagnosis.kind === "permission" ? "denied" : this._state.permission });
        this.setError(diagnosis.message, diagnosis.kind);
      },
      onMessage: (message) => this.onAgentMessage(message),
    });
    this.livekit = transport;
    try {
      await transport.connect();
      await transport.unlock();
      this.patchDiagnostics({ micStreamActive: true, micPermission: "granted" });
      this.updateState({ ...this._state, active: true, phase: "listening", permission: "granted", error: null, errorKind: null });
    } catch (error) {
      this.livekit = null;
      await transport.disconnect().catch(() => {});
      if (!this._state.error) this.setError((error as Error).message || "Voice session failed.", "network");
    }
  }

  /** End the voice session. The conversation stays where it is: text chat continues it. */
  async endLivekitSession(): Promise<void> {
    const transport = this.livekit;
    if (!transport) return;
    transport.stop();
    this.cancelInFlightTurn("voice session ended");
    this.livekit = null;
    this.livekitSpeaking = false;
    await transport.disconnect();
    this.updateState({ ...this._state, active: false, phase: "idle", error: null, errorKind: null });
    this.emitInterim("");
    this.emitTurn(null);
  }

  async setMicMuted(muted: boolean): Promise<void> {
    await this.livekit?.setMicMuted(muted);
  }

  /**
   * STOP button: she stops talking now (local audio muted at once, the agent
   * drops queued audio and its generation) and any reply still being
   * thought about is cancelled.
   */
  stopSpeakingNow(): void {
    this.cancelSpeech();
    this.cancelInFlightTurn("stopped by user");
  }

  private onAgentMessage(message: import("./livekitTransport").AgentMessage): void {
    switch (message.type) {
      case "transcript":
        this.emitInterim("");
        void this.handleUserSpeech(message.text, {
          source: "livekit-agent",
          final: true,
          at: Date.now(),
        });
        break;
      case "user_speaking":
        if (this.livekitSpeaking) {
          this.bargeIns += 1;
          this.patchDiagnostics({ bargeIns: this.bargeIns });
        }
          this.patchDiagnostics({ bargeIns: this.bargeIns });
        break;
      case "speaking":
        this.livekitSpeaking = true;
        this.patchDiagnostics({ ttsRequested: true, audioGenerated: true, audioPlaying: true, ttsStage: "playing" });
        this.updateState({ ...this._state, phase: "speaking" });
        this.emitSpeechActivity({ speaking: true, kind: "start", text: this.lastSpokenText, at: Date.now() });
        break;
      case "spoke":
      case "stopped":
        // Only the reply we are waiting on may end "speaking": a late notice
        // about an older, superseded turn must not flip a new reply to listening.
        if (message.turnId !== null && message.turnId !== undefined && message.turnId !== this.livekitTurn) break;
        if (this.livekitSpeaking) this.emitSpeechActivity({ speaking: false, kind: "end", text: "", at: Date.now() });
        this.livekitSpeaking = false;
        this.patchDiagnostics({ audioPlaying: false, ttsStage: "idle" });
        if (this._state.phase === "speaking") this.updateState({ ...this._state, phase: this._state.active ? "listening" : "idle" });
        break;
      case "error":
        this.noteFailure({ kind: message.where === "stt" ? "transcription-failure" : "playback-failure", message: `Voice ${message.where} failed: ${message.detail}` });
        if (message.where === "tts" && this._state.phase === "speaking") this.updateState({ ...this._state, phase: "listening" });
        break;
      default:
        break;
    }
  }

  /** Hand a finished reply to the agent to be spoken in her VoxCPM2 voice. */
  private speakThroughLivekit(text: string): void {
    const clean = toSpokenText(text);
    this.patchDiagnostics({ responseReceived: true });
    if (!clean || !this.livekit) {
      this.updateState({ ...this._state, phase: "listening" });
      return;
    }
    this.lastSpokenText = clean;
    this.livekitTurn += 1;
    this.patchDiagnostics({ ttsRequested: true, ttsStage: "requested" });
    this.updateState({ ...this._state, phase: "speaking" });
    this.livekit.sendReply(this.livekitTurn, clean);
  }

  /* ---------------------------------------------------------
   * Start / Stop
   * --------------------------------------------------------- */

  private start(): Promise<void> {
    if (this.starting) return this.starting;
    const epoch = this.sessionEpoch;
    const run = (async () => {
      if (await this.livekitPreferred()) {
        if (epoch !== this.sessionEpoch) return;
        await this.startLivekitSession();
        return;
      }
      await this.startSession(epoch);
    })().finally(() => {
      if (this.starting === run) this.starting = null;
    });
    this.starting = run;
    return run;
  }

  private async startSession(epoch: number): Promise<void> {
    if (epoch !== this.sessionEpoch) return;
    this.bindLifecycle();
    // Learn now whether the server holds her voice, so the first reply
    // rarely has to wait for the answer.
    void this.probeElevenLabs();
    this.unlockAudio();
    this.updateState({
      ...this._state,
      error: null,
      errorKind: null,
    });

    // Check secure context
    if (typeof window !== "undefined" && !window.isSecureContext) {
      this.setError("Microphone requires HTTPS. Open this page over HTTPS.", "insecure");
      return;
    }

    // Check mic availability
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setError("Microphone is not available in this browser.", "no-device");
      return;
    }

        // Request microphone.
    //
    // Echo cancellation, noise suppression and automatic gain control are
    // asked for explicitly: the mic now stays open while she speaks (real
    // barge-in), so the browser must remove her own output from the capture.
    // Without this the loop transcribed her voice back as a user turn. A
    // browser that refuses the constraints still gets a plain stream, and
    // the echo guard in handleUserSpeech remains the second line of defence.
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        // Only a browser that rejects the CONSTRAINTS gets the plain retry.
        // Retrying after a denial asked the user a second time (Safari does
        // not remember a "Don't Allow") and turned "no" into a second prompt.
        .catch((error: unknown) => {
          const name = (error as { name?: string } | null)?.name;
          if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError" || name === "TypeError") {
            return navigator.mediaDevices.getUserMedia({ audio: true });
          }
          throw error;
        });
      this.streamsAcquired += 1;
      if (epoch !== this.sessionEpoch) {
        // The user ended the session while the permission prompt was open:
        // the stream that just arrived is released, not adopted.
        this.releaseStream(stream);
        return;
      }
      // Never two: a stream somehow still held is released first.
      if (this.mediaStream && this.mediaStream !== stream) this.releaseStream(this.mediaStream);
      this.adoptStream(stream);
      this.patchDiagnostics({ micStreamActive: true, micPermission: "granted" });
      // How many output devices this runtime can actually see. Zero before
      // permission is granted is the browser hiding labels, not an absence of
      // speakers, so this is only recorded once the mic is held. A VM with no
      // audio hardware reports 0 — the honest answer for the hardware gate.
      void navigator.mediaDevices
        .enumerateDevices?.()
        .then((devices) => {
          this.speakerDevices = devices.filter((device) => device.kind === "audiooutput").length;
          this.patchDiagnostics({ speakerDevices: this.speakerDevices });
          return undefined;
        })
        .catch(() => undefined);
      this.updateState({
        ...this._state,
        active: true,
        phase: "listening",
        permission: "granted",
        error: null,
        errorKind: null,
        captureSuspended: false,
      });
    } catch (error) {
      if (epoch !== this.sessionEpoch) return;
      const diagnosis = mapMediaError(error instanceof DOMException || error instanceof Error ? error : { name: String(error) });
      console.warn("[VoiceEngine] Microphone error:", error, "→", diagnosis.kind);
      if (diagnosis.kind === "permission") this.updateState({ ...this._state, permission: "denied" });
      this.patchDiagnostics({ micPermission: diagnosis.kind === "permission" ? "denied" : this._state.permission });
      this.setError(diagnosis.message, diagnosis.kind);
      return;
    }

    // Which ears: ElevenLabs when the server has it (unless the browser
    // recognizer is explicitly preferred), else Web Speech, else Whisper.
    const sttPreference = (resolveFirst("LELU_VOICE_STT") ?? "").trim().toLowerCase();
    this.preferElevenLabsStt = sttPreference !== "browser" && (await elevenLabsSttReady().catch(() => false));
    // Stopped while the provider answered: do not start ears for a closed session.
    if (epoch !== this.sessionEpoch || !this._state.active) return;
    this.startRecognition();
  }

  private stop(): void {
    // Everything still awaiting on behalf of this session is now stale.
    this.sessionEpoch += 1;
    this.recovering = null;
    this.cancelSpeech();
    this.cancelInFlightTurn("voice stopped");
    this.stopRecognition();
    this.stopWhisperFallback();

    if (this.mediaStream) {
      this.releaseStream(this.mediaStream);
      this.mediaStream = null;
    }
    this.patchDiagnostics({ micStreamActive: false, recognitionActive: false, micInterrupted: false });

    this._turn = null;        // interim cleared
    this.updateState({
      active: false,
      phase: "idle",
      permission: this._state.permission,
      error: null,
      errorKind: null,
      captureSuspended: false,
    });
    this.emitInterim("");
    this.emitTurn(null);
  }

  /* ---------------------------------------------------------
   * Persistent capture lifecycle
   *
   * The session is the user's intent ("I am talking with her"); the
   * MediaStream is only the current means. A stream can end under the
   * session — device unplugged, permission revoked in site settings, iOS
   * taking the microphone for a call, a backgrounded page — and the
   * session must then either get a new stream or end honestly. It used to
   * do neither: `active` stayed true over a dead track, the indicator said
   * "listening", and the recorder loop failed once a second.
   * --------------------------------------------------------- */

  private adoptStream(stream: MediaStream): void {
    this.trackCleanup?.();
    this.trackCleanup = null;
    this.mediaStream = stream;
    const cleanups: Array<() => void> = [];
    for (const track of VoiceEngine.audioTracks(stream)) {
      const onEnded = () => this.onCaptureLost("track-ended", stream);
      const onMute = () => this.patchDiagnostics({ micInterrupted: true });
      const onUnmute = () => this.patchDiagnostics({ micInterrupted: false });
      track.addEventListener?.("ended", onEnded);
      track.addEventListener?.("mute", onMute);
      track.addEventListener?.("unmute", onUnmute);
      cleanups.push(() => {
        track.removeEventListener?.("ended", onEnded);
        track.removeEventListener?.("mute", onMute);
        track.removeEventListener?.("unmute", onUnmute);
      });
    }
    this.trackCleanup = () => {
      for (const cleanup of cleanups) cleanup();
    };
    this.patchDiagnostics({ micInterrupted: false, ...this.streamCounters() });
  }

  /** Stop every track of a stream and forget its listeners. Idempotent per stream. */
  private releaseStream(stream: MediaStream): void {
    if (stream === this.mediaStream) {
      this.trackCleanup?.();
      this.trackCleanup = null;
    }
    const released = (stream as MediaStream & { __leluReleased?: boolean });
    if (released.__leluReleased) return;
    released.__leluReleased = true;
    for (const track of stream.getTracks?.() ?? []) {
      try {
        track.stop();
      } catch {
        // already stopped
      }
    }
    this.streamsReleased += 1;
    this.patchDiagnostics(this.streamCounters());
  }

  private streamCounters(): Pick<VoiceDiagnostics, "micStreamsOpen" | "micStreamsAcquired" | "micStreamsReleased" | "captureRecoveries" | "captureLosses"> {
    return {
      micStreamsOpen: Math.max(0, this.streamsAcquired - this.streamsReleased),
      micStreamsAcquired: this.streamsAcquired,
      micStreamsReleased: this.streamsReleased,
      captureRecoveries: this.captureRecoveries,
      captureLosses: this.captureLosses,
    };
  }

  /** Audio tracks of a stream (tolerant of minimal stream objects). */
  private static audioTracks(stream: MediaStream): MediaStreamTrack[] {
    const tracks = (stream.getAudioTracks?.() ?? stream.getTracks?.() ?? []) as MediaStreamTrack[];
    return tracks.filter((track) => !track.kind || track.kind === "audio");
  }

  private static pageHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }

  /**
   * The microphone stopped delivering under a live session. Ears that depend
   * on it stop; then it is re-acquired now (page visible) or when the page
   * comes back (page hidden — a background tab cannot be relied on to keep a
   * microphone, and on iOS it cannot).
   */
  private onCaptureLost(reason: string, stream: MediaStream): void {
    if (stream !== this.mediaStream || !this._state.active || this.livekit) return;
    console.info(`[VoiceEngine] microphone lost (${reason}) — ${VoiceEngine.pageHidden() ? "waiting for the page to return" : "re-acquiring"}.`);
    this.captureLosses += 1;
    this.stopRecognition();
    this.stopWhisperFallback();
    this.releaseStream(stream);
    this.mediaStream = null;
    this.patchDiagnostics({ micStreamActive: false, recognitionActive: false, ...this.streamCounters() });
    this.emitInterim("");
    // Speech already playing is not the microphone's business: she finishes
    // her sentence. Only the listening claim is withdrawn.
    this.updateState({
      ...this._state,
      captureSuspended: true,
      phase: this._state.phase === "listening" ? "idle" : this._state.phase,
    });
    if (!VoiceEngine.pageHidden()) void this.recoverCapture(reason);
  }

  /** Delays between re-acquire attempts when the device is busy (a call). */
  private static readonly RECOVERY_DELAYS_MS = [0, 1000, 3000];

  /**
   * Get the microphone back for the session that is still on. Single flight;
   * abandoned the moment the session ends. A denial or a missing device ends
   * the session with that reason — never a silent dead "listening".
   */
  private recoverCapture(reason: string): Promise<void> {
    if (this.recovering) return this.recovering;
    const epoch = this.sessionEpoch;
    const run = (async () => {
      let lastError: unknown = null;
      for (const delay of VoiceEngine.RECOVERY_DELAYS_MS) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (epoch !== this.sessionEpoch || !this._state.active) return;
        if (VoiceEngine.pageHidden()) return; // resumed on visibilitychange
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          this.streamsAcquired += 1;
          if (epoch !== this.sessionEpoch || !this._state.active) {
            this.releaseStream(stream);
            return;
          }
          if (this.mediaStream) this.releaseStream(this.mediaStream);
          this.adoptStream(stream);
          this.captureRecoveries += 1;
          this.patchDiagnostics({ micStreamActive: true, micPermission: "granted", ...this.streamCounters() });
          this.updateState({
            ...this._state,
            permission: "granted",
            captureSuspended: false,
            phase: this._state.phase === "idle" ? "listening" : this._state.phase,
            error: null,
            errorKind: null,
          });
          this.startRecognition();
          console.info(`[VoiceEngine] microphone re-acquired after ${reason}.`);
          return;
        } catch (error) {
          lastError = error;
          const diagnosis = mapMediaError(error instanceof DOMException || error instanceof Error ? error : { name: String(error) });
          // Busy (a call holds it) is worth waiting out; anything else is final.
          if (diagnosis.kind !== "audio") break;
        }
      }
      if (epoch !== this.sessionEpoch || !this._state.active) return;
      const diagnosis = mapMediaError(lastError instanceof DOMException || lastError instanceof Error ? lastError : { name: String(lastError) });
      this.endSessionWithError(diagnosis.message, diagnosis.kind);
    })().finally(() => {
      if (this.recovering === run) this.recovering = null;
    });
    this.recovering = run;
    return run;
  }

  /** End the session because the platform took the microphone away for good. */
  private endSessionWithError(message: string, kind: VoiceErrorKind): void {
    this.stop();
    if (kind === "permission") {
      this.updateState({ ...this._state, permission: "denied" });
      this.patchDiagnostics({ micPermission: "denied" });
    }
    this.setError(message, kind);
  }

  /**
   * Page lifecycle, bound ONCE for the engine's life (a singleton), so start
   * and stop cycles never add listeners.
   */
  private bindLifecycle(): void {
    if (this.lifecycleBound || typeof window === "undefined" || typeof document === "undefined") return;
    this.lifecycleBound = true;
    const on = (target: EventTarget, type: string, handler: (event: Event) => void) => {
      target.addEventListener(type, handler);
      this.lifecycleCleanup.push(() => target.removeEventListener(type, handler));
    };
    on(document, "visibilitychange", () => this.onVisibilityChange());
    // Leaving the page (navigation, close, bfcache) releases the microphone.
    // A session is never resumed without a new tap: reloading must not turn
    // the microphone back on by itself.
    on(window, "pagehide", () => {
      if (this._state.active && !this.livekit) this.stop();
    });
    on(window, "online", () => {
      if (!this._state.active || this.livekit) return;
      if (this.whisperFallbackActive && !this.whisperLoopBusy && this.whisperFallbackTimer === null) {
        void this.whisperFallbackLoop();
      }
    });
    // Permission revoked in site settings while talking (Chrome, Safari 16+).
    try {
      void navigator.permissions
        ?.query({ name: "microphone" as PermissionName })
        .then((status) => {
          const onChange = () => {
            if (status.state === "denied" && this._state.active && !this.livekit) {
              this.endSessionWithError("Microphone permission was revoked.", "permission");
            }
          };
          status.addEventListener?.("change", onChange);
          this.lifecycleCleanup.push(() => status.removeEventListener?.("change", onChange));
          this.patchDiagnostics({ lifecycleListeners: this.lifecycleCleanup.length });
          return undefined;
        })
        .catch(() => undefined);
    } catch {
      // permissions API absent: the track's "ended" still covers revocation.
    }
    this.patchDiagnostics({ lifecycleListeners: this.lifecycleCleanup.length, pageVisible: !VoiceEngine.pageHidden() });
  }

  private onVisibilityChange(): void {
    const visible = !VoiceEngine.pageHidden();
    this.patchDiagnostics({ pageVisible: visible });
    if (!visible || !this._state.active || this.livekit) return;
    const live = this.mediaStream ? VoiceEngine.audioTracks(this.mediaStream).some((track) => track.readyState === "live") : false;
    if (!live) {
      if (this.mediaStream) this.onCaptureLost("hidden-page", this.mediaStream);
      else void this.recoverCapture("page returned");
      return;
    }
    // Stream survived; the ears may not have (Web Speech is aborted by
    // several browsers when a tab is hidden). Restart whichever is down.
    if (this.recognition && !this.recognitionRunning) {
      try {
        this.recognition.start();
        this.recognitionRunning = true;
      } catch {
        // already running
      }
    } else if (!this.recognition && !this.whisperFallbackActive) {
      this.startRecognition();
    } else if (this.whisperFallbackActive && !this.whisperLoopBusy && this.whisperFallbackTimer === null) {
      void this.whisperFallbackLoop();
    }
  }

  /** Test/teardown hook: remove the page-lifecycle listeners. */
  disposeLifecycle(): void {
    for (const cleanup of this.lifecycleCleanup.splice(0)) cleanup();
    this.lifecycleBound = false;
    this.patchDiagnostics({ lifecycleListeners: 0 });
  }

  private setError(message: string, kind: VoiceErrorKind): void {
    this.updateState({
      ...this._state,
      error: message,
      errorKind: kind,
    });
    this.emitError(message);
  }

  /* ---------------------------------------------------------
   * Audio Unlock (iOS)
   * --------------------------------------------------------- */

  unlockAudio(): void {
    if (this.audioUnlocked) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      const Ctx =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;

      if (Ctx) {
        const ctx = new Ctx();
        ctx.resume().catch(() => {});
        setTimeout(() => ctx.close().catch(() => {}), 200);
      }
    } catch {
      // continue
    }

    if (typeof speechSynthesis !== "undefined") {
      try {
        const silent = new SpeechSynthesisUtterance(" ");
        silent.volume = 0;
        silent.rate = 10;
        speechSynthesis.speak(silent);
      } catch {
        // ignore
      }
    }

    this.audioUnlocked = true;
  }

  /* ---------------------------------------------------------
   * Speech Recognition — Web Speech API
   * --------------------------------------------------------- */

  private static hasSpeechRecognitionAPI(): boolean {
    if (typeof window === "undefined") return false;
    const w = window as unknown as Record<string, unknown>;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  /**
   * Set at session start: the server can transcribe with ElevenLabs (her
   * selected ears). Then LÉLU records and transcribes with it from the first
   * sentence, the same on every browser — instead of trying the browser's
   * recognizer first, which on a browser where it fails SILENTLY costs the
   * user's first sentence to discover the failure (found live, 2026-11-07).
   * LELU_VOICE_STT=browser keeps the browser recognizer first (live partials).
   */
  private preferElevenLabsStt = false;

  private startRecognition(): void {
    if (this.preferElevenLabsStt) {
      console.info("[VoiceEngine] ElevenLabs transcription is configured — recording turns for it directly.");
      this.startWhisperFallback();
      return;
    }
    if (VoiceEngine.hasSpeechRecognitionAPI()) {
      this.startWebSpeechRecognition();
    } else {
      // Safari and other browsers without Web Speech API:
      // use Groq Whisper fallback for real transcription
      console.info("[VoiceEngine] Web Speech API not available — using Groq Whisper fallback.");
      this.startWhisperFallback();
    }
  }

  private startWebSpeechRecognition(): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const w = typeof window !== "undefined" ? window : ({} as Record<string, unknown>);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const SpeechRecognitionAPI =
      (w as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (w as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn("[VoiceEngine] SpeechRecognition not available in this browser.");
      this.startWhisperFallback();
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
      const recognition = new (SpeechRecognitionAPI as any)();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: {
        resultIndex: number;
        results: Array<{ isFinal: boolean; 0: { transcript: string; confidence?: number } }>;
      }) => {
        let interimText = "";
        let finalText = "";
        let finalConfidence: number | undefined;

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcript;
            // Chrome reports a confidence here; some engines report 0 or
            // omit it. Only a real reported value is kept.
            const reported = event.results[i][0].confidence;
            if (typeof reported === "number" && reported > 0) finalConfidence = reported;
          } else {
            interimText += transcript;
          }
        }

        if (interimText || finalText) {
          // The browser recognizer works — the watchdog is no longer needed.
          this.webSpeechGotResult = true;
          this.stopWebSpeechWatchdog();
        }

        // BARGE-IN. The mic stays open while she speaks; when what it hears
        // is the user (not her own voice coming back), she stops talking
        // and the user's words become the next turn.
        const heard = (finalText || interimText).trim();
        if (this.isSpeaking() && isBargeIn(heard, this.lastSpokenText)) {
          this.bargeIns += 1;
          this.patchDiagnostics({ bargeIns: this.bargeIns });
          this.cancelSpeech();
          this.noteFailure({ kind: "user-cancellation", message: "You spoke over her, so she stopped." });
        }

        if (interimText) {
          this.emitInterim(interimText);
        }

        if (finalText.trim()) {
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          this.emitInterim("");
          this.handleUserSpeech(finalText.trim(), {
            source: "browser-recognition",
            final: true,
            at: Date.now(),
            ...(finalConfidence !== undefined ? { confidence: finalConfidence } : {}),
          });
        }
      };

      recognition.onerror = (event: { error: string }) => {
        const diagnosis = mapRecognitionError(event.error);
        if (!diagnosis) {
          // No speech detected, or intentionally aborted — not an error.
          return;
        }
        if (diagnosis.kind !== "permission") {
          console.warn("[VoiceEngine] Recognition error:", event.error);
        }
        // The browser's recognizer is a remote service (Google in Chrome,
        // Apple/Siri in Safari). When IT fails — not the microphone — the
        // microphone stream is still good: switch to Whisper through the
        // server instead of leaving the user with a dead mic button.
        // "audio-capture" while OUR microphone stream is live means the
        // browser's recognizer could not open its own capture (seen in
        // embedded/headless Chromium), not that the mic is busy: the stream
        // LÉLU records from works, so switch now. Before, the engine kept
        // retrying the recognizer and lost the user's first sentence (live
        // run, 2026-11-07: ~54 s until the watchdog switched).
        const ownMicLive = Boolean(this.mediaStream?.getAudioTracks().some((track) => track.readyState === "live"));
        const recognizerOnly = event.error === "audio-capture" && ownMicLive;
        if ((diagnosis.kind === "service" || diagnosis.kind === "offline" || recognizerOnly) && this._state.active) {
          console.info("[VoiceEngine] Browser speech service unavailable — switching to Whisper.");
          this.stopRecognition();
          this.startWhisperFallback();
          return;
        }
        this.setError(diagnosis.message, diagnosis.kind);
      };

      recognition.onstart = () => {
        this.recognitionRunning = true;
      };

      recognition.onend = () => {
        this.recognitionRunning = false;
        // Browsers end recognition on their own (silence, network blips).
        // While the session is active the mic must come back — in EVERY
        // phase, not only "listening": it used to restart only then, so a
        // recognizer that ended while she was thinking or speaking stayed
        // dead, and the "continuous" session silently stopped hearing.
        // Listening during her speech is also what makes barge-in work.
        // A fatal error (denied, no device) is not retried in a loop.
        if (!this._state.active || this.recognition !== recognition) return;
        if (this._state.errorKind && FATAL_RECOGNITION_KINDS.has(this._state.errorKind)) return;
        setTimeout(() => {
          if (!this._state.active || this.recognition !== recognition || this.recognitionRunning) return;
          try {
            recognition.start();
            this.recognitionRunning = true;
          } catch {
            // already started
          }
        }, 250);
      };

      recognition.start();
      this.recognitionRunning = true;
      this.recognition = recognition;
      if (!this.webSpeechGotResult) this.startWebSpeechWatchdog();
    } catch (error) {
      console.warn("[VoiceEngine] Could not start recognition:", error);
      this.setError("Speech recognition is not supported in this browser.", "unsupported");
    }
  }

  /** Speech heard on the mic but no recognition result within this window -> fallback. */
  private static readonly WEB_SPEECH_SILENT_MS = 6000;

  private startWebSpeechWatchdog(): void {
    this.stopWebSpeechWatchdog();
    const stream = this.mediaStream;
    const Ctx =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : typeof window !== "undefined"
          ? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
    if (!stream || !Ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctx();
      void ctx.resume().catch(() => {});
    } catch {
      return;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = Date.now();
    const floorSamples: number[] = [];
    let threshold = 0.02;
    let speechMs = 0;
    let heardAt = 0;
    let last = started;
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      if (!this._state.active || this._state.phase !== "listening") {
        // LÉLU speaking or thinking: her own voice must not count as the user's.
        speechMs = 0;
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const level = Math.sqrt(sum / buf.length);
      if (now - started < 300) {
        floorSamples.push(level);
        return;
      }
      if (floorSamples.length) {
        const sorted = [...floorSamples].sort((a, b) => a - b);
        threshold = Math.min(0.06, Math.max(0.012, sorted[Math.floor(sorted.length / 2)] * 2.5));
        floorSamples.length = 0;
      }
      if (level > threshold) {
        speechMs += dt;
        if (speechMs >= 400 && !heardAt) heardAt = now;
      } else {
        speechMs = 0;
      }
      if (heardAt && !this.webSpeechGotResult && now - heardAt > VoiceEngine.WEB_SPEECH_SILENT_MS) {
        console.info("[VoiceEngine] Browser recognizer heard speech but returned nothing — switching to Whisper.");
        this.stopRecognition();
        this.startWhisperFallback();
      }
    }, 50);
    this.webSpeechWatchdog = {
      stop: () => {
        clearInterval(timer);
        setTimeout(() => ctx.close().catch(() => {}), 0);
      },
    };
  }

  private stopWebSpeechWatchdog(): void {
    if (this.webSpeechWatchdog) {
      this.webSpeechWatchdog.stop();
      this.webSpeechWatchdog = null;
    }
  }

  private stopRecognition(): void {
    this.stopWebSpeechWatchdog();
    this.recognitionRunning = false;
    if (this.recognition) {
      // onend restarts recognition while voice is active; detach it first so
      // an intentional stop (or a switch to Whisper) is not undone.
      try {
        (this.recognition as unknown as { onend: unknown; onerror: unknown; onresult: unknown }).onend = null;
        (this.recognition as unknown as { onerror: unknown }).onerror = null;
        (this.recognition as unknown as { onresult: unknown }).onresult = null;
      } catch {
        // ignore
      }
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
  }

  /* ---------------------------------------------------------
   * Groq Whisper Fallback — record → transcribe → loop
   *
   * Used when Web Speech API is unavailable (Safari, embeds, etc.)
   * Records short audio chunks and sends them to Groq Whisper
   * for transcription. Runs in a loop while voice is active.
   * --------------------------------------------------------- */

  private startWhisperFallback(): void {
    if (this.whisperFallbackActive) return;
    // Claim the loop now so a second caller (e.g. a recognition error racing
    // the availability check) cannot start a parallel one.
    this.whisperFallbackActive = true;
    void (async () => {
      // The key normally lives on the SERVER (the broker attaches it), so the
      // browser holding none is the expected case, not a missing key. Only
      // when neither this runtime nor the relay can transcribe is it an error.
      if (!getGroqApiKey() && !(await elevenLabsSttReady())) {
        if (!this.relayGroqAvailable) await this.refreshRelayDiagnostics();
        if (!this.relayGroqAvailable) {
          this.whisperFallbackActive = false;
          this.setError(
            "Voice transcription is not available: the server has no GROQ_API_KEY configured.",
            "offline",
          );
          return;
        }
      }
      if (!this.whisperFallbackActive) return;
      this.whisperFallbackLoop();
    })();
  }

  /** Last transcriber used and how long it took (diagnostics, evidence). */
  private lastTranscription: { engine: "elevenlabs" | "whisper"; ms: number; at: number } | null = null;

  getLastTranscription(): { engine: "elevenlabs" | "whisper"; ms: number; at: number } | null {
    return this.lastTranscription;
  }

  /**
   * One utterance → text. ElevenLabs Scribe first when the server has it;
   * Groq Whisper only when ElevenLabs fails TECHNICALLY. A spent budget is
   * rethrown: it is not a reason to spend on a different transcriber.
   */
  private async transcribeUtterance(
    chunk: Blob,
  ): Promise<{ text: string; provenance: TranscriptProvenance }> {
    const started = Date.now();
    if (await elevenLabsSttReady()) {
      try {
        const text = await transcribeWithElevenLabs(chunk);
        this.lastTranscription = { engine: "elevenlabs", ms: Date.now() - started, at: Date.now() };
        // Scribe's current response shape carries no per-turn confidence, so
        // none is invented here.
        return {
          text,
          provenance: { source: "elevenlabs-scribe", final: true, at: Date.now() },
        };
      } catch (error) {
        if (error instanceof BudgetExhaustedError) throw error;
        console.warn("[VoiceEngine] ElevenLabs transcription failed; using Whisper.", (error as Error).message);
      }
    }
    const text = await transcribeViaWhisper(chunk);
    this.lastTranscription = { engine: "whisper", ms: Date.now() - started, at: Date.now() };
    return {
      text,
      provenance: { source: "groq-whisper", final: true, at: Date.now() },
    };
  }

  private stopWhisperFallback(): void {
    this.whisperFallbackActive = false;
    if (this.whisperFallbackTimer !== null) {
      clearTimeout(this.whisperFallbackTimer);
      this.whisperFallbackTimer = null;
    }
  }

  /**
   * Continuous loop: record a short chunk of audio, check for speech,
   * transcribe via Groq Whisper, feed to handleUserSpeech, repeat.
   */
  private async whisperFallbackLoop(): Promise<void> {
    if (!this.whisperFallbackActive || !this.mediaStream) return;
    // Single flight. The loop is (re)started from several places — after a
    // reply is spoken, after every cancelled utterance's end event (iOS
    // fires those too), after errors — and each extra call used to start a
    // parallel recorder, so one sentence was transcribed and submitted
    // several times (measured: 8 identical transcriptions in 0.5 s).
    if (this.whisperLoopBusy) return;
    this.whisperLoopBusy = true;
    let again = false;

    try {
      // Record a chunk of audio
      // One spoken turn (voice-activity detected), not a fixed slice of time.
      const chunk = await this.recordUtterance();

      // If voice was stopped during recording, bail out
      if (!this.whisperFallbackActive || !this._state.active) return;

      if (!chunk || chunk.size === 0) {
        // Nothing said — keep listening
        again = true;
        return;
      }

      // Transcribe: ElevenLabs Scribe when configured, Groq Whisper otherwise.
      // While she speaks or thinks, the phase is hers to show, not ours.
      const busy = this.isSpeaking() || (this._turn !== null && this._turn.response === null);
      if (!busy) this.updateState({ ...this._state, phase: "processing" });
      const { text: transcript, provenance } = await this.transcribeUtterance(chunk);

      if (!this.whisperFallbackActive || !this._state.active) return;

      if (transcript.trim()) {
        this.emitInterim("");
        const heard = transcript.trim();
        // BARGE-IN on the recording path. The loop keeps listening while she
        // speaks; what it hears is either the user (she stops, their words
        // become the next turn) or her own voice coming back through the mic
        // (handleUserSpeech's echo filter drops it). Same rule as the Web
        // Speech path. Before, this path stopped listening while she spoke,
        // so she could not be interrupted at all.
        if (this.isSpeaking() && isBargeIn(heard, this.lastSpokenText)) {
          this.bargeIns += 1;
          this.patchDiagnostics({ bargeIns: this.bargeIns });
          this.cancelSpeech();
          this.noteFailure({ kind: "user-cancellation", message: "You spoke over her, so she stopped." });
        }
        this.handleUserSpeech(heard, provenance);
        // Keep listening through her thinking and speaking.
        again = true;
      } else {
        // Silence — go back to listening (unless she is speaking or thinking)
        if (!busy) this.updateState({ ...this._state, phase: "listening" });
        again = true;
      }
    } catch (error) {
      if (!this.whisperFallbackActive) return;
      if (error instanceof BudgetExhaustedError) {
        // A spent transcription budget is not a transient error: say so and
        // stop listening, rather than recording utterances it may not send.
        this.stopWhisperFallback();
        this.setError(budgetNotice(error), "service");
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[VoiceEngine] Whisper fallback error:", msg);
      // The person spoke and nothing could transcribe it: say so (on screen).
      this.noteFailure({ kind: "transcription-failure", message: "I couldn't make out what you said — transcription failed. Please say it again." });

      // Don't treat transient errors as fatal — retry after a short delay
      if (this._state.active) {
        this.updateState({ ...this._state, phase: "listening" });
        this.whisperFallbackTimer = setTimeout(() => {
          this.whisperFallbackTimer = null;
          this.whisperFallbackLoop();
        }, 1000);
      }
    } finally {
      this.whisperLoopBusy = false;
      if (again) setTimeout(() => this.whisperFallbackLoop(), 0);
    }
  }

  /**
   * Record audio from the microphone for the given duration.
   * Uses MediaRecorder (supported in Safari 14.5+) or WAV capture
   * as a fallback. Returns a Blob of the recorded audio.
   */
  /**
   * Record ONE spoken turn: start when the person starts speaking, stop after
   * a short silence. Replaces fixed 5 s chunks on the Whisper path, which cut
   * sentences in half and uploaded silence (Whisper then invents "Thank you."
   * on empty audio, and LÉLU answered a sentence nobody said).
   *
   * Energy-based voice activity on the live stream (AnalyserNode): the noise
   * floor is learned from the first ~300 ms, speech is energy above it for
   * ≥150 ms, the turn ends after 900 ms below it. No speech within 10 s →
   * nothing is uploaded. A turn is capped at 20 s. Falls back to a fixed
   * chunk when Web Audio is unavailable.
   */
  private async recordUtterance(): Promise<Blob | null> {
    if (!this.mediaStream) return null;
    const Ctx =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || typeof MediaRecorder === "undefined") return this.recordAudioChunk(VoiceEngine.WHISPER_CHUNK_MS);

    const stream = this.mediaStream;
    let ctx: AudioContext;
    try {
      ctx = new Ctx();
      await ctx.resume().catch(() => {});
    } catch {
      return this.recordAudioChunk(VoiceEngine.WHISPER_CHUNK_MS);
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const rms = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    };

    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => resolve();
    });
    recorder.start(250);

    const STEP = 50;
    const started = Date.now();
    let last = started;
    let peak = 0;
    let lastLevel = 0;
    let minLevel = 1;
    const floorSamples: number[] = [];
    let threshold = 0.015;
    let speechMs = 0;
    let silenceMs = 0;
    let spoke = false;
    // Audio-thread detection first: measured in audio time, so a busy page
    // cannot cut a turn short or run it past its end (vadWorklet.ts).
    const onAudioThread = await detectTurnOnAudioThread(
      ctx,
      source,
      () => !this.whisperFallbackActive || !this._state.active || !this.mediaStream,
    );
    let detectedOn = "main";
    if (onAudioThread) {
      detectedOn = "audio";
      spoke = onAudioThread.spoke;
      peak = onAudioThread.peak;
      threshold = onAudioThread.threshold;
      silenceMs = Math.round(onAudioThread.silenceMs);
    } else await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const now = Date.now();
        const elapsed = now - started;
        // Real elapsed time, not ticks: a busy page delays intervals.
        const dt = Math.min(500, now - last);
        last = now;
        if (!this.whisperFallbackActive || !this._state.active || !this.mediaStream) {
          clearInterval(timer);
          resolve();
          return;
        }
        const level = rms();
        lastLevel = level;
        if (elapsed > 300 && level < minLevel) minLevel = level;
        if (elapsed < 300) {
          floorSamples.push(level);
          return;
        }
        if (floorSamples.length && threshold === 0.015) {
          const sorted = [...floorSamples].sort((a, b) => a - b);
          // Capped: if the user is already talking when the turn starts, the "floor" is speech.
          threshold = Math.min(0.06, Math.max(0.012, sorted[Math.floor(sorted.length / 2)] * 2.5));
        }
        // Silence is judged against the speaker's own loudness too: automatic
        // gain control lifts room noise in pauses, so a fixed floor alone can
        // miss the end of a sentence.
        const speaking = level > threshold && (!spoke || level > peak * 0.2);
        if (speaking) {
          speechMs += dt;
          silenceMs = 0;
          if (speechMs >= 150) spoke = true;
          if (level > peak) peak = level;
        } else {
          silenceMs += dt;
          if (!spoke) speechMs = 0;
        }
        const done =
          (spoke && silenceMs >= 900) || // end of the turn
          elapsed >= 20_000 || // cap
          (!spoke && elapsed >= 10_000); // nothing said
        if (done) {
          clearInterval(timer);
          resolve();
        }
      }, STEP);
    });
    if (recorder.state === "recording") recorder.stop();
    await stopped;
    try {
      source.disconnect();
      await ctx.close();
    } catch {
      // ignore
    }
    console.debug("[VoiceEngine] turn", JSON.stringify({ on: detectedOn, audioMs: onAudioThread ? Math.round(onAudioThread.ms) : undefined, spoke, ms: Date.now() - started, peak: +peak.toFixed(4), threshold: +threshold.toFixed(4), lastLevel: +lastLevel.toFixed(4), minLevel: +minLevel.toFixed(4), silenceMs }));
    if (!spoke || parts.length === 0) return null;
    return new Blob(parts, { type: mime || "audio/webm" });
  }

  private async recordAudioChunk(durationMs: number): Promise<Blob | null> {
    if (!this.mediaStream) return null;

    // Try MediaRecorder first (Safari 14.5+, Chrome, Firefox)
    if (typeof MediaRecorder !== "undefined") {
      return this.recordViaMediaRecorder(durationMs);
    }

    // Fallback: WAV capture via AudioContext + ScriptProcessor
    return this.recordViaWav(durationMs);
  }

  private recordViaMediaRecorder(durationMs: number): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaStream) {
        resolve(null);
        return;
      }

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
      ];

      let selectedMime = "";
      for (const mime of mimeCandidates) {
        if (MediaRecorder.isTypeSupported(mime)) {
          selectedMime = mime;
          break;
        }
      }

      const chunks: Blob[] = [];
      const opts: MediaRecorderOptions = selectedMime
        ? { mimeType: selectedMime }
        : {};
      const recorder = new MediaRecorder(this.mediaStream, opts);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunks, {
          type: selectedMime || "audio/webm",
        });
        resolve(blob);
      };

      recorder.onerror = () => {
        resolve(null);
      };

      recorder.start();

      setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, durationMs);
    });
  }

  private async recordViaWav(durationMs: number): Promise<Blob | null> {
    if (!this.mediaStream) return null;

    try {
      const Ctx =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;

      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(this.mediaStream);
      const bufferSize = 4096;
      const channels = 1;
      const recorder = ctx.createScriptProcessor(bufferSize, channels, channels);

      const samples: Float32Array[] = [];

      recorder.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        samples.push(new Float32Array(input));
      };

      source.connect(recorder);
      recorder.connect(ctx.destination);

      await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

      recorder.disconnect();
      source.disconnect();
      ctx.close().catch(() => {});

      let totalLength = 0;
      for (const s of samples) {
        totalLength += s.length;
      }
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const s of samples) {
        merged.set(s, offset);
        offset += s.length;
      }

      return float32ToWav(merged, ctx.sampleRate, channels);
    } catch {
      return null;
    }
  }

  /** Stop the AI turn in flight, if any (see AIService.cancelActiveTurn). */
  /** Record a turn-level failure on the state (visible, not spoken). */
  private noteFailure(failure: VoiceTurnFailure): void {
    this.updateState({ ...this._state, turnFailure: { ...failure, at: Date.now() } });
  }

  /**
   * The first audible sound of this turn. Recorded once, from the engine's
   * real play/start event — never from a timer that assumes it played.
   */
  private noteFirstAudio(owner: TurnLatency | null = this.turnLatency): void {
    const latency = this.turnLatency;
    // Audio from an older turn (still finishing, or a late "playing" event
    // after a barge-in) is not the new turn's first audio.
    if (!latency || owner !== latency) return;
    if (latency.firstAudioAt === null) latency.firstAudioAt = Date.now();
    this.patchDiagnostics({
      firstAudioLatencyMs: latency.firstAudioAt - latency.transcriptAt,
      firstTextLatencyMs: latency.firstTextAt === null ? null : latency.firstTextAt - latency.transcriptAt,
    });
  }

  /**
   * The output device says it is playing. Recorded separately from
   * noteFirstAudio so the report can show both moments.
   */
  private noteAudible(owner: TurnLatency | null = this.turnLatency): void {
    const latency = this.turnLatency;
    if (!latency || owner !== latency || latency.firstAudibleAt !== null) return;
    latency.firstAudibleAt = Date.now();
    this.patchDiagnostics({ firstAudibleLatencyMs: latency.firstAudibleAt - latency.transcriptAt });
  }

  /**
   * Which delivery this sentence gets, from the identity she has developed
   * (speechDelivery.ts). A reply's words are decided upstream; this only
   * decides pace, variation and the air after a sentence.
   */
  private deliveryFor(text: string): SpeechProfileId {
    try {
      const identity = LeluIdentity.getInstance().getState();
      return resolveSpeechDelivery(text, {
        traits: identity.traits,
        communicationStyle: identity.communicationStyle,
      }).profile;
    } catch {
      return DEFAULT_SPEECH_PROFILE;
    }
  }

  /** The last turn's measured responsiveness (transcript → text → audio). */
  getTurnLatency(): TurnLatency | null {
    return this.turnLatency;
  }

  private cancelInFlightTurn(reason: string): void {
    if (this._turn && this._turn.response === null) {
      this.noteFailure({ kind: "user-cancellation", message: `Stopped (${reason}).` });
    }
    void import("../../core/AIService")
      .then(({ default: AIService }) => AIService.getInstance().cancelActiveTurn(reason))
      .catch(() => {});
  }

  /* ---------------------------------------------------------
   * User Speech Handling
   * --------------------------------------------------------- */

  private async handleUserSpeech(text: string, transcript?: TranscriptProvenance): Promise<void> {
    // The mic stays open while LÉLU is speaking (real barge-in support),
    // which means it can hear her own TTS output and misreport it as new
    // user speech. Catch that here, once, before it becomes a fake turn
    // that gets sent back to the AI as if the user said it.
    if (this.lastSpokenText && isEchoUtterance(text, this.lastSpokenText)) {
      this.lastSpokenText = "";
      return;
    }

    // Never submit the same sentence twice in a row within a few seconds
    // (a restarted recognizer or a duplicated audio chunk re-delivering it).
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
    if (this.lastUtterance && this.lastUtterance.text === normalized && Date.now() - this.lastUtterance.at < 4000) {
      return;
    }
    this.lastUtterance = { text: normalized, at: Date.now() };

    // Emit the utterance so VoiceBridge can persist it
    this.emitUtterance(text);

    // Barge-in on THINKING, not only on speech: if the previous turn is
    // still being processed, the user has moved on. Its reply was already
    // going to be discarded (the turnId check below); stopping it also
    // stops its model call and any further tool runs.
    if (this._turn && this._turn.response === null) {
      this.cancelInFlightTurn("superseded by new speech");
    }

    const turnId = crypto.randomUUID();
    // The clock this turn's responsiveness is measured from: the moment the
    // transcriber finished, not the moment she started speaking.
    this.turnLatency = {
      turnId,
      transcriptAt: this.lastTranscription?.at ?? Date.now(),
      firstTextAt: null,
      firstAudioAt: null,
      firstAudibleAt: null,
    };
    this._turn = {
      id: turnId,
      user: text,
      response: null,
      timestamp: Date.now(),
      ...(transcript ? { transcript } : {}),
    };
    this.emitTurn(this._turn);
    this.updateState({ ...this._state, phase: "processing" });

    try {
      // Dynamic import to avoid circular deps
      const { default: AIService } = await import("../../core/AIService");
      const { default: MultiChatStore } = await import("../multichat/MultiChatStore");
      const ai = AIService.getInstance();
      // The conversation the user was in when they spoke owns the reply,
      // even if they switch before it arrives.
      const conversationId = MultiChatStore.getInstance().getActiveId();
      // STREAMING SPEECH FOR A SPOKEN TURN.
      //
      // This path used to await chat() and speak the finished reply, so a
      // spoken turn heard nothing until the whole answer had been generated
      // (M22.7: transcript → first TTS request median 3.0 s, worst 9.82 s).
      // Every sentence the model completes is now spoken while the rest is
      // still being written, exactly as a typed reply already was.
      //
      // OWNERSHIP: a delta is spoken only while THIS turn is the current one
      // and only for its conversation. A superseded turn's stream keeps
      // arriving for a moment after its abort; without this check it spoke
      // over the newer question (the M22.7 reply-drift defect).
      const streamOwner = crypto.randomUUID();
      let streamStarted = false;
      const unsubscribeStream = ai.subscribeStream((event) => {
        if (this._turn?.id !== turnId) return;
        if (event.conversationId && conversationId && event.conversationId !== conversationId) return;
        if (!event.text) return;
        const latency = this.turnLatency;
        if (latency?.turnId === turnId && latency.firstTextAt === null) {
          latency.firstTextAt = Date.now();
          this.patchDiagnostics({ firstTextLatencyMs: latency.firstTextAt - latency.transcriptAt });
        }
        if (!streamStarted) {
          streamStarted = true;
          this.beginStreamingSpeech(streamOwner);
        }
        this.feedStreamingSpeech(event.text, streamOwner);
      });
      // A shared screen rides along with the spoken turn, as with typed ones.
      const { default: ScreenShare } = await import("../perception/ScreenShare");
      const seen = ScreenShare.getInstance().attachmentsFor(text);
      // Spoken words are the user's own: the second (and last) consent source.
      const { captureSpendConsent } = await import("../spend/SpendConsent");
      const consent = await captureSpendConsent(text, "spoken").catch(() => null);
      const { captureCapabilityDecision } = await import("../acquisition/CapabilityLedgerClient");
      const decision = await captureCapabilityDecision(text, "spoken").catch(() => null);
      const note = [consent?.note, decision?.note].filter(Boolean).join("\n\n") || undefined;
      // The conversation and the transcript's provenance travel with the
      // turn: memory consolidation records which recogniser produced the
      // words, so a later reader can tell speech from typing.
      const chatOptions = {
        ...(conversationId ? { conversationId } : {}),
        ...(transcript ? { transcript } : {}),
      };
      let response: Awaited<ReturnType<typeof ai.chat>>;
      try {
        response = await ai.chat(
          text,
          seen.length > 0 ? seen : undefined,
          note,
          Object.keys(chatOptions).length > 0 ? chatOptions : undefined,
        );
      } finally {
        // The stream is this turn's; it ends when the turn does.
        unsubscribeStream();
      }

      if (this._turn?.id === turnId) {
        // A failure notice is not her answer: it is shown in the
        // conversation and on the voice state, and she goes back to
        // listening without reading it out (Mission 10.3: the offline notice
        // was spoken as the answer on 18 of 20 turns).
        const failure = failureFromResponse(response as { text?: string; provider?: string; metadata?: Record<string, unknown> });
        if (failure) {
          // A failure notice is not spoken, and anything already spoken from
          // a partial stream stops: the notice is shown, never read aloud.
          if (streamStarted) this.cancelSpeech();
          this._turn = { ...this._turn, response: response.text, failure };
          this.emitTurn(this._turn);
          this.updateState({ ...this._state, phase: "listening", turnFailure: { ...failure, at: Date.now() } });
          return;
        }
        this._turn = { ...this._turn, response: response.text };
        this.emitTurn(this._turn);
        this.updateState({ ...this._state, phase: "speaking" });
        // A reply that already streamed is FINISHED, not restarted: the
        // sentences behind the cursor were spoken, only the tail is left.
        if (streamStarted) this.finishStreamingSpeech(response.text, streamOwner);
        else this.speakResponse(response.text);
      }
    } catch (error) {
      console.error("[VoiceEngine] Chat failed:", error);
      if (this._turn?.id === turnId) {
        const failure = failureFromError(error);
        this._turn = { ...this._turn, response: failure.message, failure };
        this.emitTurn(this._turn);
        this.updateState({ ...this._state, phase: this._state.active ? "listening" : this._state.phase, turnFailure: { ...failure, at: Date.now() } });
      }
    }
  }

  /* ---------------------------------------------------------
   * Text-to-Speech
   * --------------------------------------------------------- */

  /* ---- Her own voice: ElevenLabs, brokered by the server ---- */

  /** The server holds an ElevenLabs key and it answered. */
  private elevenLabs = false;

  /**
   * Ask the server once per session whether her voice is available.
   *
   * Deliberately not awaited: the first reply may still use the browser
   * engine while this resolves, but nothing is ever claimed as working
   * before the server has said so.
   */
  private elevenLabsProbe: Promise<void> | null = null;

  /**
   * Ask the server once whether it holds her voice. Returns the pending
   * answer so speakResponse can WAIT for it: fire-and-forget meant the first
   * reply of every session was decided before the answer arrived and was
   * spoken by the browser's voice, not hers (found live, 2026-11-07).
   */
  private probeElevenLabs(): Promise<void> {
    if (this.elevenLabsProbe) return this.elevenLabsProbe;
    this.elevenLabsProbe = elevenLabsReady().then((ready) => {
      this.elevenLabs = ready;
    });
    return this.elevenLabsProbe;
  }

  /**
   * Her voice failed mid-reply. This reply falls back to the browser engine,
   * but the session is NOT written off: the cached probe and the cached
   * status answer are both cleared, so the next reply asks the server again.
   *
   * Found live (2026-11-11): one refused segment set elevenLabs = false and
   * left elevenLabsProbe resolved for the rest of the session, so every later
   * answer was handed to a browser voice — and on a runtime that has none, she
   * stayed silent until the page was reloaded even though the server was fine.
   */
  private demoteFromElevenLabs(): void {
    this.elevenLabs = false;
    this.elevenLabsProbe = null;
    this.elevenLabsSettled = false;
    forgetElevenLabsStatus();
  }

  private elevenLabsSettled = false;

  /**
   * Run `speak` once the one-time "does her server hold her voice?" answer is
   * known, so a streamed reply is never split across two engines.
   */
  private whenVoiceSettled(speak: () => void): void {
    if (this.elevenLabsSettled) {
      speak();
      return;
    }
    // A reply waiting on "which voice?" is already committed to be spoken.
    // Counted as speaking so barge-in and the echo guard cover that window
    // too, instead of reading "silent" until the probe answers.
    this.awaitingVoice += 1;
    void this.probeElevenLabs()
      .catch(() => {
        // An unanswerable probe means "no server voice known": the browser
        // fallback speaks, and settling here keeps speak() from re-deferring.
      })
      .finally(() => {
        this.elevenLabsSettled = true;
        this.awaitingVoice = Math.max(0, this.awaitingVoice - 1);
        speak();
      });
  }

  /**
   * Speak the whole reply through ElevenLabs, one segment at a time.
   *
   * Segments are chained rather than queued blind so barge-in — which
   * sets cancelFlag — stops the NEXT segment too, and a failure demotes
   * the pipeline to the browser engine instead of going silent.
   */
  private speakThroughElevenLabs(text: string): void {
    const segments = chunkForSpeech(text);
    if (segments.length === 0) {
      this.patchDiagnostics({ ttsRequested: false, ttsStage: "idle" });
      this.settleSpeech();
      return;
    }
    this.patchDiagnostics({ ttsRequested: true });
    let index = 0;
    this.chainActive = true;
    const turn = this.turnLatency;

    const next = (): void => {
      if (this.cancelFlag || index >= segments.length) {
        this.chainActive = false;
        this.patchDiagnostics({ audioPlaying: false, ttsStage: "ended" });
        this.settleSpeech();
        if (this._state.active) {
          this.updateState({ ...this._state, phase: "listening" });
          if (this.whisperFallbackActive && !this.whisperFallbackTimer) {
            this.whisperFallbackLoop();
          }
        }
        return;
      }
      const segment = segments[index];
      index += 1;
      void speakText(segment, {
        onStart: () => {
          this.noteFirstAudio(turn);
          this.patchDiagnostics({ audioGenerated: true, audioPlaying: true, ttsStage: "playing" });
        },
        onAudible: () => this.noteAudible(turn),
        onEnd: () => next(),
        onFail: () => {
          // Her voice failed mid-reply: say the rest with the browser engine
          // rather than leaving the reply unspoken, and report the failure.
          this.demoteFromElevenLabs();
          this.patchDiagnostics({ audioPlaying: false, ttsStage: "failed" });
          // Only promise a browser voice when the browser actually has one.
          // On a machine with no speech engine the old wording told the user
          // the rest of the reply was being spoken while nothing played at all.
          const browserVoice = typeof speechSynthesis !== "undefined" && (speechSynthesis.getVoices?.().length ?? 0) > 0;
          if (!browserVoice) this.patchDiagnostics({ ttsAvailable: false });
          this.noteFailure({
            kind: "playback-failure",
            message: browserVoice
              ? "Her voice could not be played; the rest of the reply uses the browser voice. The answer itself is in the conversation."
              : "Her own voice could not be played, and this browser has no speech engine — so nothing was spoken. The answer itself is in the conversation.",
          });
          const rest = segments.slice(index - 1).join(" ").trim();
          index = segments.length;
          if (typeof speechSynthesis !== "undefined" && rest) {
            for (const chunk of chunkForSpeech(rest)) {
              try {
                speechSynthesis.speak(this.createUtterance(chunk));
              } catch {
                // ignore
              }
            }
          }
          next();
        },
      }, this.deliveryFor(segment));
    };
    next();
  }

  speakResponse(text: string): void {
    if (this.livekit) {
      this.speakThroughLivekit(text);
      return;
    }
    // Decide the voice only once the server has answered whether it holds
    // hers (bounded: an unreachable server is a "no" after the fetch fails).
    if (!this.elevenLabsSettled) {
      void this.probeElevenLabs().then(() => {
        this.elevenLabsSettled = true;
        this.speakResponse(text);
      });
      return;
    }
    // A response reached the speech layer — true regardless of whether
    // TTS then works, which is exactly what makes this diagnosable.
    this.patchDiagnostics({ responseReceived: true });

    if (typeof speechSynthesis === "undefined" && !this.elevenLabs) {
      // Neither a browser engine nor a server voice: nothing was ever
      // requested of a provider that does not exist, and the stage is
      // honestly failed.
      this.patchDiagnostics({
        ttsAvailable: false,
        ttsRequested: false,
        audioGenerated: false,
        audioPlaying: false,
        ttsStage: "failed",
      });
      this.updateState({ ...this._state, phase: "listening" });
      return;
    }

    this.cancelSpeech();
    if (!text || !text.trim()) {
      this.patchDiagnostics({ ttsRequested: false, ttsStage: "idle" });
      this.updateState({ ...this._state, phase: "listening" });
      return;
    }
    // WHAT IS RENDERED IS NOT WHAT IS SPEAKEN (spokenText.ts): an emoji, a
    // heading or "**bold**" is visual, and reading the characters aloud was
    // one of the M22.7 defects.
    const spoken = toSpokenText(text);
    if (!spoken) {
      // Nothing pronounceable at all (a reply that was only an emoji or only
      // a code block): no provider is asked to synthesise silence.
      this.patchDiagnostics({ ttsRequested: false, ttsStage: "idle" });
      this.updateState({ ...this._state, phase: "listening" });
      return;
    }

    this.lastSpokenText = spoken;
    this.cancelFlag = false;
    // speaking flag is managed by cancelFlag and phase state

    // One voice everywhere: if her server holds the ElevenLabs key, this is
    // the speaker, on every machine. The browser engine stays the fallback.
    void this.probeElevenLabs();
    if (this.elevenLabs) {
      this.speakThroughElevenLabs(spoken);
      return;
    }

    const chunks = chunkForSpeech(spoken);
    let index = 0;
    this.chainActive = true;

    const speakNext = () => {
      if (this.cancelFlag || index >= chunks.length) {
        this.chainActive = false;
        this.settleSpeech();
        if (this._state.active) {
          this.updateState({ ...this._state, phase: "listening" });
          // If Whisper fallback is active, restart the loop after speaking
          if (this.whisperFallbackActive && !this.whisperFallbackTimer) {
            this.whisperFallbackLoop();
          }
        }
        return;
      }

      const chunk = chunks[index];
      index += 1;

      const utterance = this.createUtterance(chunk);
      this.patchDiagnostics({
        ttsRequested: true,
        audioGenerated: true,
        audioPlaying: true,
        ttsStage: "playing",
      });
      utterance.onend = () => {
        this.patchDiagnostics({ audioPlaying: false, ttsStage: "ended" });
        speakNext();
      };
      utterance.onerror = (e) => {
        if (e.error === "canceled" || this.cancelFlag) {
          this.patchDiagnostics({ audioPlaying: false });
          return;
        }
        this.patchDiagnostics({ audioPlaying: false, ttsStage: "failed" });
        speakNext();
      };

      speechSynthesis.speak(utterance);
    };

    speakNext();
  }

  cancelSpeech(): void {
    // LiveKit: mute locally now and tell the agent to drop audio + generation.
    if (this.livekit) {
      this.livekit.stop();
      if (this.livekitSpeaking) this.emitSpeechActivity({ speaking: false, kind: "end", text: "", at: Date.now() });
      this.livekitSpeaking = false;
    }
    this.cancelFlag = true;
    this.chainActive = false;
    this.streaming = false;
    this.patchDiagnostics({ streaming: false });
    // Real audio, not just the browser queue: barge-in must stop a playing
    // MP3 too, or she keeps talking over the user.
    stopSpeaking();
    if (typeof speechSynthesis !== "undefined") {
      try {
        speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    // Cancelled utterances do not always fire "end" (engine-dependent), so
    // the queue is drained here, and the stop is announced exactly once.
    if (this.pendingUtterances > 0) {
      this.pendingUtterances = 0;
      this.emitSpeechActivity({ speaking: false, kind: "end", text: "", at: Date.now() });
    }
    // Real state: interrupted speech returns the pipeline to listening.
    if (this._state.phase === "speaking") {
      this.updateState({ ...this._state, phase: this._state.active ? "listening" : "idle" });
    }
    this.streamFinalizing = false;
    this.streamCursor = 0;
    this.streamSegmentsPending = 0;
  }

  /* ---------------------------------------------------------
   * Streaming speech — LÉLU speaks WHILE the response streams.
   *
   * begin → feed(accumulated text)… → finish. Only COMPLETE
   * sentences are enqueued, so prosody stays natural without
   * waiting for the whole response (no robotic full-file pauses).
   * speechSynthesis plays its queue in order automatically.
   * --------------------------------------------------------- */

  private streamCursor = 0;
  private streamFinalizing = false;

  /**
   * Open a streamed reply. `owner` names the turn that owns it; every
   * subsequent feed/finish from a DIFFERENT owner is dropped, so a reply
   * that was superseded can never speak over the newer one.
   *
   * Returns the owner actually in force (a generated one when the caller
   * does not name itself, which keeps older callers working).
   */
  beginStreamingSpeech(owner?: string): string {
    const ownerId = owner ?? crypto.randomUUID();
    this.streamOwner = ownerId;
    if (this.livekit) {
      // The agent speaks whole replies; nothing is queued per token here.
      this.cancelSpeech();
      return ownerId;
    }
    this.cancelSpeech();
    this.cancelFlag = false;
    this.streamCursor = 0;
    this.streamFinalizing = false;
    this.streaming = true;
    this.lastSpokenText = "";
    this.patchDiagnostics({ streaming: true });
    this.updateState({ ...this._state, phase: "speaking" });
    return ownerId;
  }

  /**
   * Is this feed still allowed to speak? A reply whose turn has been
   * superseded is dropped AND counted, so the drop is visible evidence
   * rather than silence that looks like a bug.
   */
  private ownsStream(owner?: string): boolean {
    if (!owner || !this.streamOwner) return true;
    if (owner === this.streamOwner) return true;
    this.staleStreamDrops += 1;
    this.patchDiagnostics({ staleStreamsDropped: this.staleStreamDrops });
    return false;
  }

  feedStreamingSpeech(fullText: string, owner?: string): void {
    if (!this.ownsStream(owner)) return;
    if (this.livekit) return;
    // Which speaker to use is answered by the server ONCE per session. Before
    // that answer arrives the browser engine used to take the first
    // sentences — a different voice, on a machine that may have none at all —
    // exactly the bug speakResponse already waits out. Wait for the same
    // answer here, then speak the same text: the cursor has not moved, so
    // nothing is said twice.
    // WHICH SPEAKER — decided before the first sentence, not after it.
    //
    // This used to wait only when the browser had NO speech engine, so on a
    // machine that has browser voices the probe (async, below) had not
    // answered yet, `this.elevenLabs` was still false, and the opening
    // sentences of every reply were spoken in the browser's voice. That is
    // the wrong voice, and it is what a listener hears as "the old voice".
    // On a server without her voice the fallback is unchanged: the probe
    // settles false and the browser engine speaks.
    if (!this.elevenLabsSettled) {
      void this.probeElevenLabs();
      this.whenVoiceSettled(() => this.feedStreamingSpeech(fullText));
      return;
    }
    if (
      (typeof speechSynthesis === "undefined" && !this.elevenLabs) ||
      this.cancelFlag ||
      this.streamFinalizing
    ) {
      return;
    }
    const rest = fullText.slice(this.streamCursor);
    // First complete boundary in the not-yet-spoken tail: a sentence end, or
    // a line break. Markdown replies (headings, "**Key Facts:**", list items)
    // often carry no sentence punctuation for many lines; with only [.!?] as
    // a boundary the whole block became ONE request, which the speech server
    // refuses over 900 characters (413, found in the live M22.9 run) — and
    // that part of the answer was never spoken.
    const match = rest.match(/^[\s\S]*?(?:[.!?](?:\s+|$)|\n+)/);
    if (!match) return;
    const block = match[0].trim();
    this.streamCursor += match[0].length;
    if (!block) return;
    // A single sentence longer than a segment is split like any other reply.
    if (block.length > SPEECH_CHUNK_SIZE) {
      for (const piece of chunkForSpeech(block)) this.speakStreamPiece(piece);
    } else {
      this.speakStreamPiece(block);
    }
    // More complete boundaries may already be waiting in the tail.
    if (fullText.length > this.streamCursor) this.feedStreamingSpeech(fullText, owner);
  }

  /** Speak one bounded piece of a streamed reply (see feedStreamingSpeech). */
  private speakStreamPiece(segment: string): void {
    // WHAT IS SPOKEN IS NOT WHAT IS RENDERED. Markdown, emoji, list markers
    // and numeric notation are visual; the speaker gets the words a person
    // would say (spokenText.ts). A segment with nothing pronounceable
    // ("🚀" alone) advances the cursor and is not sent to a provider.
    const spoken = toSpokenText(segment);
    if (!spoken) return;
    // What she actually said is what the echo check compares against;
    // streamed replies used to record the rendered text instead.
    this.lastSpokenText = `${this.lastSpokenText} ${spoken}`.trim().slice(-800);
    void this.probeElevenLabs();
    if (this.elevenLabs) {
      // speakText() queues in order, and synthesises ahead, so streamed
      // sentences stay in order, in the same voice, without a gap between
      // them while the next one is being generated.
      this.speakStreamSegment(spoken);
      return;
    }
    try {
      speechSynthesis.speak(this.createUtterance(spoken));
    } catch {
      // Speech queue failures must never break chat.
    }
  }

  finishStreamingSpeech(fullText: string, owner?: string): void {
    if (!this.ownsStream(owner)) return;
    if (this.livekit) {
      this.speakThroughLivekit(fullText);
      return;
    }
    // Same rule as feedStreamingSpeech: never let the browser's voice take
    // the tail of a reply because the server's answer had not arrived yet.
    if (!this.elevenLabsSettled) {
      void this.probeElevenLabs();
      this.whenVoiceSettled(() => this.finishStreamingSpeech(fullText));
      return;
    }
    this.streamFinalizing = true;
    this.streaming = false;
    this.patchDiagnostics({ streaming: false });
    if ((typeof speechSynthesis === "undefined" && !this.elevenLabs) || this.cancelFlag) {
      this.settleSpeech();
      return;
    }
    const rest = fullText.slice(this.streamCursor).trim();
    if (!rest) {
      // Everything was already queued — or nothing was said at all. Either
      // way the phase must not stay "speaking" once the queue drains.
      this.settleSpeech();
      return;
    }
    for (const chunk of chunkForSpeech(rest)) {
      const spoken = toSpokenText(chunk);
      if (!spoken) continue;
      this.lastSpokenText = `${this.lastSpokenText} ${spoken}`.trim().slice(-800);
      if (this.elevenLabs) {
        this.speakStreamSegment(spoken);
        continue;
      }
      try {
        speechSynthesis.speak(this.createUtterance(spoken));
      } catch {
        // ignore
      }
    }
  }

  /**
   * Speak one streamed segment through her server voice, and COUNT it.
   *
   * Streamed playback used to be fire-and-forget: `isSpeaking()` stayed
   * false for the whole of a streamed reply, so a user talking over one
   * could not interrupt it (barge-in only worked for speakResponse), and
   * nothing cleared the "speaking" phase when the last segment ended.
   * Counting the segment makes both true for the path every typed reply
   * and every streamed answer actually takes.
   */
  private speakStreamSegment(segment: string): void {
    const turn = this.turnLatency;
    this.streamSegmentsPending += 1;
    this.chainActive = true;
    void speakText(
      segment,
      {
        onStart: () => {
          this.noteFirstAudio(turn);
          this.patchDiagnostics({ audioGenerated: true, audioPlaying: true, ttsStage: "playing" });
        },
        onAudible: () => this.noteAudible(turn),
        onEnd: () => this.patchDiagnostics({ audioPlaying: false, ttsStage: "ended" }),
        // A streamed sentence her voice could not produce used to vanish
        // without a trace (no onFail was given): the reply went silent
        // mid-answer and nothing said why. It is now reported, and spoken by
        // the browser's own voice where one exists. The text is in the chat.
        onFail: () => this.onStreamSegmentFailed(segment),
      },
      this.deliveryFor(segment),
    ).finally(() => {
      this.streamSegmentsPending = Math.max(0, this.streamSegmentsPending - 1);
      if (this.streamSegmentsPending === 0) {
        this.chainActive = false;
        this.settleSpeech();
      }
    });
  }

  private onStreamSegmentFailed(segment: string): void {
    if (this.cancelFlag) return;
    this.demoteFromElevenLabs();
    const browserVoice = typeof speechSynthesis !== "undefined" && (speechSynthesis.getVoices?.().length ?? 0) > 0;
    this.patchDiagnostics({ audioPlaying: false, ttsStage: "failed", ...(browserVoice ? {} : { ttsAvailable: false }) });
    this.noteFailure({
      kind: "playback-failure",
      message: browserVoice
        ? "Her voice could not be produced for part of this reply; the browser voice is saying it instead. The full answer is in the conversation."
        : "Her voice could not be produced for part of this reply, and this browser has no speech engine. The full answer is in the conversation.",
    });
    if (!browserVoice) return;
    try {
      speechSynthesis.speak(this.createUtterance(segment));
    } catch {
      // the text stays in the conversation
    }
  }

  /* ---------------------------------------------------------
   * Voice registry — real system voices, user selection that
   * persists, honest offline availability. No fake voices.
   * --------------------------------------------------------- */

  private static readonly VOICE_PREF_KEY = "lelu.voice.uri";

  private getPreferredVoiceUri(): string | null {
    try {
      return localStorage.getItem(VoiceEngine.VOICE_PREF_KEY);
    } catch {
      return null;
    }
  }

  /** Every voice the runtime actually exposes, with offline truth. */
  listVoices(): Array<{
    name: string;
    uri: string;
    lang: string;
    /** true = installed on device — genuinely works offline */
    localService: boolean;
    selected: boolean;
  }> {
    if (typeof speechSynthesis === "undefined") return [];
    const preferred = this.getPreferredVoiceUri();
    return speechSynthesis.getVoices().map((v) => ({
      name: v.name,
      uri: v.voiceURI,
      lang: v.lang,
      localService: v.localService,
      selected: v.voiceURI === preferred,
    }));
  }

  setPreferredVoice(uri: string | null): void {
    try {
      if (uri) localStorage.setItem(VoiceEngine.VOICE_PREF_KEY, uri);
      else localStorage.removeItem(VoiceEngine.VOICE_PREF_KEY);
    } catch {
      // Persistence is best-effort; selection still applies this session.
    }
  }

  /** OFFLINE VOICE — AVAILABLE / NOT AVAILABLE, from real inventory. */
  offlineVoiceAvailability(): "available" | "not-available" | "unsupported" {
    if (typeof speechSynthesis === "undefined") return "unsupported";
    return speechSynthesis.getVoices().some((v) => v.localService)
      ? "available"
      : "not-available";
  }

  /* ---------------------------------------------------------
   * TTS Helpers
   * --------------------------------------------------------- */

  private selectVoice(): SpeechSynthesisVoice | null {
    if (typeof speechSynthesis === "undefined") return null;
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return null;

    // User's persisted selection always wins when actually available.
    const preferred = this.getPreferredVoiceUri();
    if (preferred) {
      const match = voices.find((v) => v.voiceURI === preferred);
      if (match) return match;
    }

    const premium = voices.find(
      (v) =>
        v.localService === false &&
        (v.name.includes("Natural") || v.name.includes("Premium") || v.name.includes("Enhanced")),
    );
    if (premium) return premium;

    const english = voices.find((v) => v.lang.startsWith("en"));
    if (english) return english;

    return voices[0] ?? null;
  }

  private createUtterance(text: string): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.selectVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    // Word timing for the 3D avatar's mouth and nods (SPEECH_BOUNDARY_EVENT in core/avatar/AvatarBehaviour).
    utterance.onboundary = (event) => {
      if (event.name && event.name !== "word") return;
      if (typeof window === "undefined") return;
      window.dispatchEvent(new CustomEvent("lelu:speech-boundary", { detail: { charLength: event.charLength || 4 } }));
    };
    // Every utterance is counted from queue to end, so "speaking" means
    // audio is actually queued or playing — and the avatar can move with
    // the real start, word boundaries and end of her speech. Listeners
    // (not the on* properties) so speakResponse's own handlers still run.
    this.pendingUtterances += 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.pendingUtterances = Math.max(0, this.pendingUtterances - 1);
      // Deferred one tick: speakResponse queues its next chunk in its own
      // end handler, and the gap between two chunks is not "done".
      setTimeout(() => this.settleSpeech(), 0);
    };
    utterance.addEventListener("start", () => {
      this.noteFirstAudio();
      this.emitSpeechActivity({ speaking: true, kind: "start", text, at: Date.now() });
    });
    utterance.addEventListener("boundary", (event: Event) => {
      const boundary = event as SpeechSynthesisEvent;
      if (boundary.name && boundary.name !== "word") return;
      this.emitSpeechActivity({ speaking: true, kind: "word", text, charIndex: boundary.charIndex, at: Date.now() });
    });
    utterance.addEventListener("end", finish);
    utterance.addEventListener("error", finish);
    return utterance;
  }

  /**
   * Once nothing is queued and no more is coming, speech is over: say so,
   * and leave "speaking". The phase used to stay "speaking" forever after
   * a streamed reply — including every typed reply, which streams too.
   */
  private settleSpeech(): void {
    if (this.pendingUtterances > 0 || this.chainActive || this.streaming) return;
    this.emitSpeechActivity({ speaking: false, kind: "end", text: "", at: Date.now() });
    if (this._state.phase === "speaking") {
      this.updateState({ ...this._state, phase: this._state.active ? "listening" : "idle" });
    }
  }

  private emitSpeechActivity(activity: SpeechActivity): void {
    for (const listener of this.speechActivityListeners) {
      try {
        listener(activity);
      } catch {
        // a listener must never break speech
      }
    }
  }


  /* ---------------------------------------------------------
   * Diagnostics
   * --------------------------------------------------------- */

  private computeDiagnostics(): VoiceDiagnostics {
    const hasSpeechRecognition =
      typeof window !== "undefined" &&
      (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window));

    const hasTTS =
      typeof window !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      typeof speechSynthesis !== "undefined";

    const hasMic =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia);

    // A locally-held key, or one the SERVER holds on our behalf. Reading
    // import.meta.env here would inline the key into the client bundle,
    // which is exactly the leak the relay removes; `relayGroqAvailable`
    // is refreshed asynchronously by refreshRelayDiagnostics() so this
    // stays synchronous for every existing caller.
    const groqKey = Boolean(getGroqApiKey()) || this.relayGroqAvailable;

    const secure =
      typeof window !== "undefined" && window.isSecureContext === true;

    return {
      sttSupported: hasSpeechRecognition || groqKey,
      ttsSupported: hasTTS,
      micAvailable: hasMic,
      groqKeyAvailable: groqKey,
      secureContext: secure,

      micPermission: this._state?.permission ?? "unknown",
      recognitionSupported: hasSpeechRecognition,
      ttsAvailable: hasTTS,
      micStreamActive: Boolean(this.mediaStream),
      recognitionActive: false,
      transcriptReceived: false,
      responseReceived: false,
      ttsRequested: false,
      audioGenerated: false,
      audioPlaying: false,
      ttsStage: "idle",

      streaming: false,
      staleStreamsDropped: this.staleStreamDrops,
      firstTextLatencyMs: null,
      firstAudioLatencyMs: null,
      ttsQueueDepth: ttsQueueDepth(),
      firstAudibleLatencyMs: null,
      audioContextState: audioContextState(),
      speakerDevices: this.speakerDevices,
      warmSynthesis: getLastSynthesis(),
      bargeIns: this.bargeIns,
      fullDuplex: this.whisperFallbackActive,

      micStreamsOpen: Math.max(0, this.streamsAcquired - this.streamsReleased),
      micStreamsAcquired: this.streamsAcquired,
      micStreamsReleased: this.streamsReleased,
      micInterrupted: false,
      captureRecoveries: this.captureRecoveries,
      captureLosses: this.captureLosses,
      pageVisible: typeof document === "undefined" || document.visibilityState !== "hidden",
      lifecycleListeners: this.lifecycleCleanup?.length ?? 0,

      // What actually happened outranks the defaults above: capability is
      // recomputed on every poll, the pipeline's own facts are preserved.
      ...this.live,
    };
  }

  /** Patch live diagnostics and notify listeners — the ONE place the
   *  pipeline reports what it actually did. */
  private patchDiagnostics(patch: Partial<VoiceDiagnostics>): void {
    // Kept so a capability poll cannot reset what the pipeline just did.
    this.live = { ...this.live, ...patch };
    this._diagnostics = { ...this._diagnostics, ...patch };
    for (const listener of this.diagnosticsListeners) {
      try {
        listener(this._diagnostics);
      } catch {
        // a broken diagnostics listener must never break voice
      }
    }
  }

  /* ---------------------------------------------------------
   * State / Event Emitters
   * --------------------------------------------------------- */

  private updateState(partial: VoiceState): void {
    // One rule for every path that returns to "listening" (speech ended, a
    // turn failed, silence): with no microphone captured, she is not
    // listening, and the state must not say so.
    this._state =
      partial.active && partial.captureSuspended && partial.phase === "listening"
        ? { ...partial, phase: "idle" }
        : partial;
    for (const listener of this.stateListeners) {
      try {
        listener(this._state);
      } catch {
        // listener error must not break the engine
      }
    }
  }

  private emitInterim(text: string): void {
    for (const listener of this.interimListeners) {
      try {
        listener(text);
      } catch {
        // ignore
      }
    }
  }

  private emitTurn(turn: VoiceTurn | null): void {
    for (const listener of this.turnListeners) {
      try {
        listener(turn);
      } catch {
        // ignore
      }
    }
  }

  private emitUtterance(text: string): void {
    for (const listener of this.utteranceListeners) {
      try {
        listener(text);
      } catch {
        // ignore
      }
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      try {
        listener(message);
      } catch {
        // ignore
      }
    }
  }
}

/* ---------------------------------------------------------
 * WAV encoding helper
 * --------------------------------------------------------- */

function float32ToWav(
  samples: Float32Array,
  sampleRate: number,
  numChannels: number,
): Blob {
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataLength = samples.length * (bitsPerSample / 8);
  const bufferLength = 44 + dataLength;

  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, bufferLength - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let pos = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    pos += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i += 1) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export default VoiceEngine;
