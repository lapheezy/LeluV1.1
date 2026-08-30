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

import { mapMediaError } from "./speechToText";

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
}

export interface VoiceTurn {
  id: string;
  user: string;
  response: string | null;
  timestamp: number;
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

function getGroqApiKey(): string {
  const runtimeEnv = globalThis as typeof globalThis & {
    __LELU_GROQ_API_KEY__?: string;
  };

  return (
    (
      (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env ?? {}
    )["VITE_GROQ_API_KEY"]?.trim() ||
    runtimeEnv.__LELU_GROQ_API_KEY__?.trim() ||
    ""
  );
}

/**
 * Transcribe a Blob of audio via the Groq Whisper API.
 * Accepts webm, ogg, wav, mp4, and m4a formats.
 */
async function transcribeViaWhisper(audioBlob: Blob): Promise<string> {
  const apiKey = getGroqApiKey();

  if (!apiKey) {
    throw new Error(
      "No Groq API key configured. Set VITE_GROQ_API_KEY to enable voice.",
    );
  }

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

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Whisper transcription failed (${response.status}): ${errorText}`,
    );
  }

  const data = await response.json();
  const text = typeof data?.text === "string" ? data.text.trim() : "";

  if (!text) {
    throw new Error("Whisper returned empty transcription.");
  }

  return text;
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
  private _diagnostics: VoiceDiagnostics = this.computeDiagnostics();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private mediaStream: MediaStream | null = null;

  /** Groq Whisper fallback: active when Web Speech API is unavailable. */
  private whisperFallbackActive = false;
  private whisperFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly stateListeners = new Set<StateListener>();
  private readonly interimListeners = new Set<InterimListener>();
  private readonly turnListeners = new Set<TurnListener>();
  private readonly diagnosticsListeners = new Set<DiagnosticsListener>();
  private readonly utteranceListeners = new Set<UtteranceListener>();
  private readonly errorListeners = new Set<ErrorListener>();

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
      setInterval(() => {
        this._diagnostics = this.computeDiagnostics();
      }, 5000);
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
    if (this._state.active) {
      this.stop();
    } else {
      await this.start();
    }
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

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /* ---------------------------------------------------------
   * Start / Stop
   * --------------------------------------------------------- */

  private async start(): Promise<void> {
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

    // Request microphone
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;
      this.patchDiagnostics({ micStreamActive: true, micPermission: "granted" });
      this.updateState({
        ...this._state,
        active: true,
        phase: "listening",
        permission: "granted",
        error: null,
        errorKind: null,
      });
    } catch (error) {
      const diagnosis = mapMediaError(error instanceof DOMException || error instanceof Error ? error : { name: String(error) });
      console.warn("[VoiceEngine] Microphone error:", error, "→", diagnosis.kind);
      this.setError(diagnosis.message, diagnosis.kind);
      return;
    }

    // Start speech recognition — Web Speech API or Groq Whisper fallback
    this.startRecognition();
  }

  private stop(): void {
    this.cancelSpeech();
    this.stopRecognition();
    this.stopWhisperFallback();

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    this._turn = null;        // interim cleared
    this.updateState({
      active: false,
      phase: "idle",
      permission: this._state.permission,
      error: null,
      errorKind: null,
    });
    this.emitInterim("");
    this.emitTurn(null);
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

  private startRecognition(): void {
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

      recognition.onresult = (event: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => {
        let interimText = "";
        let finalText = "";

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcript;
          } else {
            interimText += transcript;
          }
        }

        if (interimText) {
          this.emitInterim(interimText);
        }

        if (finalText.trim()) {
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          this.emitInterim("");
          this.handleUserSpeech(finalText.trim());
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
        this.setError(diagnosis.message, diagnosis.kind);
      };

      recognition.onend = () => {
        // Restart if still active
        if (this._state.active && this._state.phase === "listening") {
          try {
            recognition.start();
          } catch {
            // already started
          }
        }
      };

      recognition.start();
      this.recognition = recognition;
    } catch (error) {
      console.warn("[VoiceEngine] Could not start recognition:", error);
      this.setError("Speech recognition is not supported in this browser.", "unsupported");
    }
  }

  private stopRecognition(): void {
    if (this.recognition) {
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

    if (!getGroqApiKey()) {
      this.setError(
        "Voice requires a Groq API key for transcription. Set VITE_GROQ_API_KEY.",
        "offline",
      );
      return;
    }

    this.whisperFallbackActive = true;
    this.whisperFallbackLoop();
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

    try {
      // Record a chunk of audio
      const chunk = await this.recordAudioChunk(VoiceEngine.WHISPER_CHUNK_MS);

      // If voice was stopped during recording, bail out
      if (!this.whisperFallbackActive || !this._state.active) return;

      if (!chunk || chunk.size === 0) {
        // No audio captured — loop again
        this.whisperFallbackLoop();
        return;
      }

      // Transcribe via Groq Whisper
      this.updateState({ ...this._state, phase: "processing" });
      const transcript = await transcribeViaWhisper(chunk);

      if (!this.whisperFallbackActive || !this._state.active) return;

      if (transcript.trim()) {
        this.emitInterim("");
        this.handleUserSpeech(transcript.trim());
      } else {
        // Silence — go back to listening
        this.updateState({ ...this._state, phase: "listening" });
        this.whisperFallbackLoop();
      }
    } catch (error) {
      if (!this.whisperFallbackActive) return;
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[VoiceEngine] Whisper fallback error:", msg);

      // Don't treat transient errors as fatal — retry after a short delay
      if (this._state.active) {
        this.updateState({ ...this._state, phase: "listening" });
        this.whisperFallbackTimer = setTimeout(() => {
          this.whisperFallbackLoop();
        }, 1000);
      }
    }
  }

  /**
   * Record audio from the microphone for the given duration.
   * Uses MediaRecorder (supported in Safari 14.5+) or WAV capture
   * as a fallback. Returns a Blob of the recorded audio.
   */
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

  /* ---------------------------------------------------------
   * User Speech Handling
   * --------------------------------------------------------- */

  private async handleUserSpeech(text: string): Promise<void> {
    // The mic stays open while LÉLU is speaking (real barge-in support),
    // which means it can hear her own TTS output and misreport it as new
    // user speech. Catch that here, once, before it becomes a fake turn
    // that gets sent back to the AI as if the user said it.
    if (this.lastSpokenText && isEchoUtterance(text, this.lastSpokenText)) {
      this.lastSpokenText = "";
      return;
    }

    // Emit the utterance so VoiceBridge can persist it
    this.emitUtterance(text);

    const turnId = crypto.randomUUID();
    this._turn = { id: turnId, user: text, response: null, timestamp: Date.now() };
    this.emitTurn(this._turn);
    this.updateState({ ...this._state, phase: "processing" });

    try {
      // Dynamic import to avoid circular deps
      const { default: AIService } = await import("../../core/AIService");
      const ai = AIService.getInstance();
      const response = await ai.chat(text);

      if (this._turn?.id === turnId) {
        this._turn = { ...this._turn, response: response.text };
        this.emitTurn(this._turn);
        this.updateState({ ...this._state, phase: "speaking" });
        this.speakResponse(response.text);
      }
    } catch (error) {
      console.error("[VoiceEngine] Chat failed:", error);
      if (this._turn?.id === turnId) {
        const errorMsg = "I couldn't process that. Please try again.";
        this._turn = { ...this._turn, response: errorMsg };
        this.emitTurn(this._turn);
        this.speakResponse(errorMsg);
      }
    }
  }

  /* ---------------------------------------------------------
   * Text-to-Speech
   * --------------------------------------------------------- */

  speakResponse(text: string): void {
    // A response reached the speech layer — true regardless of whether
    // TTS then works, which is exactly what makes this diagnosable.
    this.patchDiagnostics({ responseReceived: true });

    if (typeof speechSynthesis === "undefined") {
      // No TTS engine in this runtime: nothing was ever requested of a
      // provider that does not exist, and the stage is honestly failed.
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

    this.lastSpokenText = text.trim();
    this.cancelFlag = false;
    // speaking flag is managed by cancelFlag and phase state

    const chunks = chunkForSpeech(text.trim());
    let index = 0;

    const speakNext = () => {
      if (this.cancelFlag || index >= chunks.length) {
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
    this.cancelFlag = true;
    if (typeof speechSynthesis !== "undefined") {
      try {
        speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    // Real state: interrupted speech returns the pipeline to listening.
    if (this._state.phase === "speaking") {
      this.updateState({ ...this._state, phase: this._state.active ? "listening" : "idle" });
    }
    this.streamFinalizing = false;
    this.streamCursor = 0;
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

  beginStreamingSpeech(): void {
    this.cancelSpeech();
    this.cancelFlag = false;
    this.streamCursor = 0;
    this.streamFinalizing = false;
    this.updateState({ ...this._state, phase: "speaking" });
  }

  feedStreamingSpeech(fullText: string): void {
    if (typeof speechSynthesis === "undefined" || this.cancelFlag || this.streamFinalizing) {
      return;
    }
    const rest = fullText.slice(this.streamCursor);
    // First complete sentence boundary in the not-yet-spoken tail.
    const match = rest.match(/^[\s\S]*?[.!?](\s+|$)/);
    if (!match) return;
    const segment = match[0].trim();
    this.streamCursor += match[0].length;
    if (!segment) return;
    try {
      speechSynthesis.speak(this.createUtterance(segment));
    } catch {
      // Speech queue failures must never break chat.
    }
  }

  finishStreamingSpeech(fullText: string): void {
    this.streamFinalizing = true;
    if (typeof speechSynthesis === "undefined" || this.cancelFlag) return;
    const rest = fullText.slice(this.streamCursor).trim();
    if (!rest) return;
    for (const chunk of chunkForSpeech(rest)) {
      try {
        speechSynthesis.speak(this.createUtterance(chunk));
      } catch {
        // ignore
      }
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
    return utterance;
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

    const groqKey = Boolean(
      (
        (import.meta as unknown as { env?: Record<string, string | undefined> })
          .env ?? {}
      )["VITE_GROQ_API_KEY"]?.trim(),
    );

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
    };
  }

  /** Patch live diagnostics and notify listeners — the ONE place the
   *  pipeline reports what it actually did. */
  private patchDiagnostics(patch: Partial<VoiceDiagnostics>): void {
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
    this._state = partial;
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
