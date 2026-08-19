/**
 * ==========================================================
 * LÉLU
 * VOICE ENGINE — REAL TWO-WAY VOICE CONVERSATION
 *
 * ONE voice session for the whole application. The engine is a
 * module singleton (same pattern as AIService) so voice survives
 * navigation between LÉLU's sections: it is owned by the
 * application runtime, never by a single visual component.
 *
 * STT — no browser SpeechRecognition dependency:
 *
 *   User speaks
 *     → getUserMedia stream (REQUIRED — the mic must actually send
 *       audio; a probe that only proves the mic exists is not enough)
 *     → VAD level meter (AnalyserNode RMS) detects speech/silence
 *     → recording starts when speech begins, stops after silence
 *     → MediaRecorder blob (WAV fallback for older iOS)
 *     → Groq Whisper transcription (same key as the Groq chat
 *       provider — the STT path that works on iPhone Safari)
 *     → transcript → AIService.chat()  ← the ONE existing pipeline
 *     → cognition / memory / providers / fallback
 *     → response text
 *     → speechSynthesis (chunked TTS, gesture-warmed)
 *     → back to listening
 *
 * Turn-taking:
 *   - While LÉLU speaks, sustained speech from the mic is a
 *     barge-in: her speech is cancelled and the new utterance is
 *     recorded from that moment.
 *   - Echo prevention: her TTS text is captured the moment a
 *     recording starts; if the transcript matches it, the audio was
 *     her own voice leaking through the mic and is discarded.
 *
 * LIFECYCLE SAFETY (single controlled session):
 *   - start()/stop() are idempotent: start twice never creates two
 *     streams or two recorders; stop twice never crashes.
 *   - Every voice/audio boundary is wrapped: VAD callbacks, recorder
 *     events, TTS events, timers and listener dispatch can never
 *     throw an unhandled exception that would take down the React
 *     app.
 *   - Generation tokens invalidate stale TTS callbacks; a session
 *     epoch invalidates stale async recording/transcription results.
 *   - iOS: speechSynthesis is gesture-locked, so start() (a real
 *     tap) warms the audio session with a silent utterance.
 *
 * Every stage of the response→TTS path is logged under [LELU VOICE]
 * and mirrored into a safe VoiceDiagnostics state.
 * ==========================================================
 */

import AIService from "../AIService";
import {
  MediaRecorderCapture,
  WavCapture,
  createLevelMeter,
  mediaRecorderSupported,
  pickRecorderMimeType,
  recorderSupported,
  wavCaptureSupported,
  type LevelMeterHandle,
} from "./audioRecorder";
import { mapMediaError, transcribeAudio } from "./speechToText";

export type VoicePhase = "idle" | "listening" | "processing" | "speaking";

/**
 * Why voice is unavailable, so the UI can say the exact fix instead of
 * a generic "failed". All values are safe diagnostics — never secrets.
 */
export type VoiceErrorKind =
  | "unsupported"
  | "insecure"
  | "permission"
  | "no-device"
  | "blocked-embed"
  | "service"
  | "audio"
  | "offline"
  | "error";

export interface VoiceState {
  phase: VoicePhase;
  active: boolean;
  error: string | null;
  errorKind: VoiceErrorKind | null;
}

/** What this browser can actually do — checked separately from permission. */
export interface VoiceCapabilities {
  recognition: "supported" | "unsupported";
  tts: boolean;
  micPermission: "granted" | "denied" | "prompt" | "unknown";
}

/** One voice turn: what the user said + LÉLU's reply (once ready). */
export interface VoiceTurn {
  id: number;
  user: string;
  response: string;
}

export type TtsStage =
  | "idle"
  | "requested"
  | "generated"
  | "playing"
  | "ended"
  | "failed";

/**
 * Live diagnostic mirror of the real voice pipeline. Safe values only —
 * never credentials. Mirrors what is ACTUALLY happening.
 */
export interface VoiceDiagnostics {
  micPermission: "granted" | "denied" | "prompt" | "unknown";
  recognitionSupported: boolean;
  ttsAvailable: boolean;
  micStreamActive: boolean;
  recognitionActive: boolean;
  transcriptReceived: boolean;
  responseReceived: boolean;
  ttsRequested: boolean;
  audioGenerated: boolean;
  audioPlaying: boolean;
  ttsStage: TtsStage;
  lastError: string | null;
  lastErrorAt: number | null;
}

/* ----------------------------------------------------------
 * Pure helpers (exported for verification).
 * ---------------------------------------------------------- */

const SILENCE_COMMIT_MS = 1100;
const SPEECH_RMS = 0.02;
const START_RECORDING_MS = 300;
const BARGE_IN_MS = 350;
const MAX_RECORDING_MS = 15000;

/** How long to wait for the browser's microphone prompt before diagnosing. */
const MIC_PROMPT_TIMEOUT_MS = 10000;

/**
 * Reject with a dedicated error if the promise does not settle in time.
 * A microphone prompt that never appears (silently blocked embed) would
 * otherwise hang the flow forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      const error = new Error(
        "The microphone prompt did not appear. The page hosting LÉLU must allow microphone access — " +
          "open the app in its own tab, or make sure the preview runs over HTTPS with microphone permission " +
          "enabled for the frame.",
      );
      error.name = "MicPromptTimeout";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (error) => {
        clearTimeout(id);
        reject(error);
      },
    );
  });
}

/**
 * Legacy recognition-code mapping kept for compatibility and diagnostics
 * of error codes surfaced by browser speech services. The engine itself
 * no longer uses SpeechRecognition — it records audio and transcribes it.
 */
export function mapRecognitionError(
  code: string,
): { kind: VoiceErrorKind; message: string } | null {
  if (code === "no-speech" || code === "aborted") {
    return null;
  }
  switch (code) {
    case "not-allowed":
    case "permission-denied":
      return {
        kind: "permission",
        message:
          "Microphone access was denied or blocked. If iOS shows Microphone = Allowed, open LÉLU in its own " +
          "tab (not an embedded preview) and tap the mic directly from the page.",
      };
    case "service-not-allowed":
      return {
        kind: "service",
        message:
          "Speech recognition could not start — the system speech service rejected the request. This is NOT a " +
          "microphone permission problem. On iPhone/iPad make sure Siri & Dictation is enabled, then tap the mic " +
          "again. If it persists, LÉLU still works through text — tap the Core and type.",
      };
    case "audio-capture":
      return {
        kind: "audio",
        message:
          "The microphone could not be opened — it may be in use by another app or the audio session failed. " +
          "Close other apps using the mic and try again.",
      };
    case "busy":
      return {
        kind: "audio",
        message: "Speech recognition is busy right now. Try again in a moment.",
      };
    case "language-not-supported":
      return {
        kind: "error",
        message: "Speech recognition language is not supported on this device.",
      };
    case "network":
      return {
        kind: "offline",
        message: "Speech recognition is offline right now. Text chat still works.",
      };
    default:
      return { kind: "error", message: `Speech recognition error: ${code}` };
  }
}

function normalizeForEcho(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when a transcribed utterance is almost certainly LÉLU's own
 * TTS output leaking into the microphone. Tiny fragments, substring
 * containment, and high token overlap are all treated as echo.
 */
export function isEchoUtterance(text: string, ttsText: string): boolean {
  const a = normalizeForEcho(text);
  const b = normalizeForEcho(ttsText);
  if (!a || !b) {
    return false;
  }
  if (a.length < 4) {
    return true;
  }
  if (b.includes(a) || a.includes(b)) {
    return true;
  }
  const tokensA = a.split(" ");
  const tokensB = new Set(b.split(" "));
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      overlap += 1;
    }
  }
  return overlap / tokensA.length > 0.7;
}

/**
 * Split long text into speech-friendly chunks (~200 chars, sentence
 * aligned). Chrome's speechSynthesis stalls on very long utterances,
 * and smaller chunks make interruption feel responsive.
 */
export function chunkForSpeech(text: string, max = 200): string[] {
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < sentence.length; index += max) {
        chunks.push(sentence.slice(index, index + max));
      }
      continue;
    }
    if (current && current.length + sentence.length + 1 > max) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : text ? [text] : [];
}

/* ----------------------------------------------------------
 * Engine
 * ---------------------------------------------------------- */

type Listener<T> = (value: T) => void;

class VoiceEngine {
  private static instance: VoiceEngine | null = null;

  private phase: VoicePhase = "idle";
  private active = false;
  private stopping = false;
  private error: string | null = null;
  private errorKind: VoiceErrorKind | null = null;

  /* Microphone + recording session (single instance, always). */
  private stream: MediaStream | null = null;
  private meter: LevelMeterHandle | null = null;
  private recorder: MediaRecorderCapture | WavCapture | null = null;
  private recording = false;
  private recordingStartedAt = 0;
  /** Echo guard: LÉLU's speech text at the moment recording started. */
  private echoGuardText = "";

  /* VAD state. */
  private vadSpeech = false;
  private speechStart = 0;
  private silenceStart = 0;

  /** Stale async recording/transcription results can never act. */
  private sessionEpoch = 0;
  private transcribing = false;

  private processing = false;
  private currentTurnId: number | null = null;

  /* TTS state. */
  private ttsText = "";
  private ttsChunks: string[] = [];
  private ttsIndex = 0;
  private speaking = false;
  /** Incremented on every speak()/cancel — stale onend/watchdog from an
   *  older utterance can never speak from the new queue. */
  private ttsGeneration = 0;
  private preferredVoice: SpeechSynthesisVoice | null = null;
  private micPermission: "granted" | "denied" | "prompt" | "unknown" = "unknown";

  private diag: VoiceDiagnostics = {
    micPermission: "unknown",
    recognitionSupported: false,
    ttsAvailable: false,
    micStreamActive: false,
    recognitionActive: false,
    transcriptReceived: false,
    responseReceived: false,
    ttsRequested: false,
    audioGenerated: false,
    audioPlaying: false,
    ttsStage: "idle",
    lastError: null,
    lastErrorAt: null,
  };

  private readonly stateListeners = new Set<Listener<VoiceState>>();
  private readonly interimListeners = new Set<Listener<string>>();
  private readonly utteranceListeners = new Set<Listener<string>>();
  private readonly responseListeners = new Set<Listener<string>>();
  private readonly turnListeners = new Set<Listener<VoiceTurn>>();
  private readonly errorListeners = new Set<Listener<string>>();
  private readonly diagnosticsListeners = new Set<Listener<VoiceDiagnostics>>();

  private constructor() {
    if (typeof window === "undefined") {
      return;
    }
    // Closing the app must release the microphone session.
    window.addEventListener("pagehide", () => {
      try {
        this.stop();
      } catch (error) {
        console.error("[Lélu Voice] stop during pagehide threw (contained):", error);
      }
    });
    // Warm the mic-permission cache early so start() can distinguish
    // "already denied" from "recording unsupported" precisely.
    void this.diagnosePermissions();
    if (typeof speechSynthesis !== "undefined") {
      const pickVoice = () => {
        try {
          const voices = speechSynthesis.getVoices();
          this.preferredVoice =
            voices.find((voice) => /google us english/i.test(voice.name)) ??
            voices.find((voice) => /aria|jenny|samantha|zira|susan/i.test(voice.name)) ??
            voices.find((voice) => voice.lang?.toLowerCase().startsWith("en")) ??
            voices[0] ??
            null;
        } catch (error) {
          console.error("[Lélu Voice] getVoices() threw (contained):", error);
        }
      };
      pickVoice();
      try {
        speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
      } catch {
        // Older WebKit — no event, the pick above already ran.
      }
    }
    this.diag.recognitionSupported = this.sttPathSupported();
    this.diag.ttsAvailable = this.ttsAvailable();
  }

  public static getInstance(): VoiceEngine {
    if (!VoiceEngine.instance) {
      VoiceEngine.instance = new VoiceEngine();
    }
    return VoiceEngine.instance;
  }

  /* ----- subscriptions (listener dispatch is crash-proof) ----- */

  public onStateChange(listener: Listener<VoiceState>): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public onInterim(listener: Listener<string>): () => void {
    this.interimListeners.add(listener);
    return () => {
      this.interimListeners.delete(listener);
    };
  }

  public onUtterance(listener: Listener<string>): () => void {
    this.utteranceListeners.add(listener);
    return () => {
      this.utteranceListeners.delete(listener);
    };
  }

  public onResponse(listener: Listener<string>): () => void {
    this.responseListeners.add(listener);
    return () => {
      this.responseListeners.delete(listener);
    };
  }

  public onTurn(listener: Listener<VoiceTurn>): () => void {
    this.turnListeners.add(listener);
    return () => {
      this.turnListeners.delete(listener);
    };
  }

  public onError(listener: Listener<string>): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public onDiagnostics(listener: Listener<VoiceDiagnostics>): () => void {
    this.diagnosticsListeners.add(listener);
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  /* ----- public API ----- */

  public getState(): VoiceState {
    return {
      phase: this.phase,
      active: this.active,
      error: this.error,
      errorKind: this.errorKind,
    };
  }

  public getDiagnostics(): VoiceDiagnostics {
    return { ...this.diag };
  }

  /**
   * The full STT path must be available: microphone capture + a recorder
   * (MediaRecorder or WAV fallback) + the Groq Whisper key.
   */
  private sttPathSupported(): boolean {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    if (!recorderSupported()) {
      return false;
    }
    return this.hasSttKey();
  }

  private hasSttKey(): boolean {
    const runtimeEnv = globalThis as typeof globalThis & {
      __LELU_GROQ_API_KEY__?: string;
    };
    const windowEnv =
      typeof window !== "undefined"
        ? (window as Window & { __LELU_GROQ_API_KEY__?: string })
        : undefined;
    return Boolean(
      (import.meta.env.VITE_GROQ_API_KEY as string | undefined)?.trim() ||
        runtimeEnv.__LELU_GROQ_API_KEY__?.trim() ||
        windowEnv?.__LELU_GROQ_API_KEY__?.trim(),
    );
  }

  public isSupported(): boolean {
    return this.sttPathSupported();
  }

  /**
   * What this browser can actually do — independent of permission. Lets
   * the UI say "voice unsupported" without ever blaming the microphone.
   */
  public getCapabilities(): VoiceCapabilities {
    return {
      recognition: this.sttPathSupported() ? "supported" : "unsupported",
      tts: this.ttsAvailable(),
      micPermission: this.micPermission,
    };
  }

  private ttsAvailable(): boolean {
    return (
      typeof speechSynthesis !== "undefined" &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
  }

  /**
   * Speak any response aloud through the ONE TTS system. Used by the voice
   * loop AND the invisible text dialogue, so every LÉLU response is spoken
   * automatically — never manual, never a duplicate TTS path.
   */
  public speakResponse(text: string): void {
    const reply = (text ?? "").trim();
    if (!reply) {
      return;
    }
    console.info("[LELU VOICE] response received (speakResponse)");
    this.diag.responseReceived = true;
    this.emitDiagnostics();
    this.speak(reply);
  }

  /**
   * Unlock the iOS speechSynthesis audio session inside a user gesture.
   * Called on the mic tap AND whenever the Core activates the dialogue,
   * so typed responses are spoken too.
   */
  public unlockAudio(): void {
    this.warmTts();
  }

  public async toggle(): Promise<void> {
    if (this.active) {
      this.stop();
    } else {
      await this.start();
    }
  }

  public async start(): Promise<void> {
    if (this.active) {
      return;
    }

    // Capability first — the mic prompt should not appear when the path
    // is impossible (no recorder / no STT key). Permission is a separate
    // axis and is never blamed for a capability gap.
    if (!this.sttPathSupported()) {
      const reasons: string[] = [];
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        reasons.push("microphone capture is not available");
      } else if (!recorderSupported()) {
        reasons.push("audio recording is not supported in this browser");
      } else if (!this.hasSttKey()) {
        reasons.push("the Groq API key (VITE_GROQ_API_KEY) is not configured");
      }
      this.setError(
        `Voice conversation is not available — ${reasons.join(", ")}. This is not a microphone permission ` +
          "problem. Text chat still works — tap the Core and type.",
        "unsupported",
      );
      return;
    }

    // If the browser already reports the mic as denied, say so before
    // requesting anything.
    if (this.micPermission === "denied") {
      this.setError(
        "Microphone permission is denied for this site. Click the lock icon next to the address bar, allow " +
          "the microphone, then try again.",
        "permission",
      );
      return;
    }

    // Microphone capture only exists in secure contexts.
    if (typeof window !== "undefined" && typeof window.isSecureContext === "boolean" && !window.isSecureContext) {
      this.setError(
        "Microphone access requires a secure connection (HTTPS). Open LÉLU over https:// (or localhost) to use voice.",
        "insecure",
      );
      return;
    }

    this.active = true;
    this.stopping = false;
    this.error = null;
    this.errorKind = null;
    this.sessionEpoch += 1;
    const epoch = this.sessionEpoch;
    this.emitState();

    // iOS: speechSynthesis only produces audio after a user gesture.
    // Warm the audio session with a silent utterance synchronously inside
    // THIS tap, so every later speak (async, after the LLM replies) works.
    this.warmTts();

    console.info("[Lélu Voice] capabilities:", JSON.stringify(this.getCapabilities()));
    void this.diagnosePermissions();

    // Open the microphone for REAL — the stream stays alive for the whole
    // voice session and feeds the recorder. If this fails, the exact
    // reason is reported (permission / no device / busy / embed-blocked).
    const opened = await this.openMicrophone(epoch);
    if (!opened || !this.active || this.stopping || epoch !== this.sessionEpoch) {
      return;
    }

    this.beginListening();
  }

  /**
   * REQUIRED microphone capture. The stream is kept for the session and
   * every track is stopped on stop() — getUserMedia is never just a
   * "is the mic active" probe.
   */
  private async openMicrophone(epoch: number): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.setError("Microphone capture is not available in this browser.", "unsupported");
      this.active = false;
      return false;
    }
    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: true }),
        MIC_PROMPT_TIMEOUT_MS,
      );
      if (epoch !== this.sessionEpoch || !this.active || this.stopping) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // Already ended.
          }
        }
        return false;
      }
      this.stream = stream;
      this.diag.micStreamActive = true;
      this.emitDiagnostics();
      console.info("[Lélu Voice] Microphone stream OPEN — recording will capture real audio.");
      return true;
    } catch (error) {
      const mapped = mapMediaError(error);
      this.active = false;
      this.setError(mapped.message, mapped.kind);
      this.diag.micStreamActive = false;
      this.emitDiagnostics();
      return false;
    }
  }

  /** Non-blocking diagnostic: log and cache the browser's mic permission state. */
  private async diagnosePermissions(): Promise<void> {
    try {
      if (typeof navigator !== "undefined" && navigator.permissions?.query) {
        const status = await navigator.permissions.query({
          name: "microphone",
        } as PermissionDescriptor);
        this.micPermission = status.state;
        this.diag.micPermission = status.state;
        this.emitDiagnostics();
        console.info("[Lélu Voice] Permissions API microphone state:", status.state);
      }
    } catch {
      // Permissions API unavailable — the mic probe is authoritative.
    }
  }

  /**
   * iOS WebKit only allows speechSynthesis audio inside (or after) a user
   * gesture. Speaking a silent empty utterance synchronously during the
   * tap unlocks the audio session for every later asynchronous speak.
   * Swallowed entirely — this can never fail voice startup.
   */
  private warmTts(): void {
    if (!this.ttsAvailable() || typeof speechSynthesis === "undefined") {
      return;
    }
    try {
      speechSynthesis.cancel();
      speechSynthesis.resume();
      const warm = new SpeechSynthesisUtterance(" ");
      warm.volume = 0;
      warm.onend = () => {
        // Audio session unlocked.
      };
      speechSynthesis.speak(warm);
      console.info("[LELU VOICE] TTS audio session warmed inside user gesture");
    } catch (error) {
      console.info("[Lélu Voice] TTS warm-up failed (non-fatal):", String(error));
    }
  }

  public stop(): void {
    if (!this.active && this.phase === "idle") {
      return;
    }
    this.stopping = true;
    this.active = false;
    this.sessionEpoch += 1;
    this.stopRecording(true);
    this.stopMeter();
    this.closeMicrophone();
    this.cancelSpeech();
    this.resetVad();
    this.transcribing = false;
    this.phase = "idle";
    this.error = null;
    this.errorKind = null;
    this.stopping = false;
    this.diag.recognitionActive = false;
    this.emitDiagnostics();
    this.emitState();
  }

  /* ----- microphone + VAD loop ----- */

  private beginListening(): void {
    if (!this.active || this.stopping || !this.stream) {
      return;
    }
    this.resetVad();
    if (!this.meter) {
      this.meter = createLevelMeter(this.stream, (rms) => {
        try {
          this.handleLevel(rms);
        } catch (error) {
          console.error("[Lélu Voice] level handler threw (contained):", error);
        }
      });
    }
    this.meter.start();
    this.setPhase("listening");
    console.info("[Lélu Voice] Listening — VAD active, recording when speech begins.");
  }

  private stopMeter(): void {
    if (this.meter) {
      try {
        this.meter.stop();
      } catch (error) {
        console.error("[Lélu Voice] meter stop threw (contained):", error);
      }
      this.meter = null;
    }
  }

  private closeMicrophone(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Already ended.
        }
      }
      this.stream = null;
    }
    this.diag.micStreamActive = false;
  }

  private resetVad(): void {
    this.vadSpeech = false;
    this.speechStart = 0;
    this.silenceStart = 0;
  }

  /**
   * VAD state machine, driven by the AnalyserNode RMS meter.
   *
   *   rms ≥ SPEECH_RMS sustained for START_RECORDING_MS → start recorder
   *   silence after speech for SILENCE_COMMIT_MS            → commit + transcribe
   *   speech sustained while LÉLU is speaking               → barge-in
   *   recording longer than MAX_RECORDING_MS                → commit (safety)
   */
  private handleLevel(rms: number): void {
    if (!this.active || this.stopping || this.transcribing || this.processing) {
      return;
    }
    const now = performance.now();

    if (rms >= SPEECH_RMS) {
      if (!this.vadSpeech) {
        this.vadSpeech = true;
        this.speechStart = now;
        this.silenceStart = 0;
      }
      if (this.phase === "speaking" && !this.recording && now - this.speechStart >= BARGE_IN_MS) {
        // User interrupted LÉLU: remember what she was saying (echo guard),
        // stop her speech, then record the user.
        this.echoGuardText = this.ttsText;
        this.cancelSpeech();
        this.startRecording();
      } else if (this.phase !== "speaking" && !this.recording && now - this.speechStart >= START_RECORDING_MS) {
        this.startRecording();
      }
      this.silenceStart = 0;
    } else if (this.vadSpeech) {
      if (this.silenceStart === 0) {
        this.silenceStart = now;
      } else if (now - this.silenceStart >= SILENCE_COMMIT_MS) {
        this.vadSpeech = false;
        this.silenceStart = 0;
        this.stopRecording(false);
      }
    }

    // Max-length guard so a rambling user cannot record forever.
    if (this.recording && now - this.recordingStartedAt >= MAX_RECORDING_MS) {
      this.stopRecording(false);
    }
  }

  private startRecording(): void {
    if (this.recording || !this.active || this.stopping || !this.stream) {
      return;
    }
    const mime = pickRecorderMimeType();
    let recorder: MediaRecorderCapture | WavCapture | null = null;
    if (mediaRecorderSupported()) {
      recorder = new MediaRecorderCapture(this.stream, mime);
    } else if (wavCaptureSupported()) {
      recorder = new WavCapture(this.stream);
    }
    if (!recorder) {
      return;
    }
    recorder.start();
    this.recorder = recorder;
    this.recording = true;
    this.recordingStartedAt = performance.now();
    this.diag.recognitionActive = true;
    this.emitDiagnostics();
    console.info("[Lélu Voice] Recording started — mic audio is being captured.");
  }

  private stopRecording(discard: boolean): void {
    const recorder = this.recorder;
    this.recorder = null;
    this.recording = false;
    this.recordingStartedAt = 0;
    this.diag.recognitionActive = false;
    this.emitDiagnostics();
    if (!recorder) {
      return;
    }
    if (discard) {
      recorder.dispose();
      return;
    }
    void recorder.stop().then((blob) => {
      if (blob && blob.size > 0) {
        void this.transcribeBlob(blob);
      } else {
        // Empty capture (very short noise) — just keep listening.
        this.beginListening();
      }
    });
  }

  /** Send the recorded audio to the STT service, then into the chat brain. */
  private async transcribeBlob(blob: Blob): Promise<void> {
    this.transcribing = true;
    this.setPhase("processing");
    const epoch = this.sessionEpoch;

    try {
      const transcript = await transcribeAudio(blob);
      if (!this.active || this.stopping || epoch !== this.sessionEpoch) {
        return;
      }
      const text = transcript.trim();
      if (!text) {
        this.resumeListening();
        return;
      }
      // If the audio was actually LÉLU's own voice leaking through the
      // mic, discard it — never send her speech back to her brain.
      if (this.echoGuardText && isEchoUtterance(text, this.echoGuardText)) {
        console.info("[Lélu Voice] transcript matched LÉLU's own speech — discarded as echo.");
        this.resumeListening();
        return;
      }
      this.echoGuardText = "";

      this.diag.transcriptReceived = true;
      this.emitDiagnostics();
      console.info("[Lélu Voice] transcript received:", text.slice(0, 120));

      this.currentTurnId = Date.now();
      this.emitUtterance(text);
      this.emitTurn({ id: this.currentTurnId, user: text, response: "" });
      await this.processUtterance(text);
    } catch (error) {
      console.error("[Lélu Voice] transcription failed:", error);
      this.emitError(error instanceof Error ? error.message : String(error));
      if (this.active && !this.stopping && epoch === this.sessionEpoch) {
        this.resumeListening();
      }
    } finally {
      this.transcribing = false;
    }
  }

  /* ----- conversation loop (the ONE pipeline) ----- */

  private async processUtterance(text: string): Promise<void> {
    this.processing = true;
    this.setPhase("processing");

    let spoke = false;

    try {
      // The EXACT same entry point as the text dialogue — providers,
      // fallback, cognition and memory all live behind this call.
      const response = await AIService.getInstance().chat(text);
      const reply = (response.text ?? "").trim();

      if (!reply) {
        this.emitError("Lélu returned an empty response.");
      } else {
        console.info("[LELU VOICE] response received");
        this.diag.responseReceived = true;
        this.emitDiagnostics();
        this.emitResponse(reply);
        this.emitTurn({ id: this.currentTurnId ?? Date.now(), user: text, response: reply });
        if (this.active && !this.stopping) {
          spoke = true;
          try {
            this.speak(reply);
          } catch (error) {
            // A TTS failure must never fail the turn or crash the app.
            spoke = false;
            console.error("[LELU VOICE] TTS request threw (contained):", error);
            this.diag.ttsStage = "failed";
            this.emitDiagnostics();
          }
        }
      }
    } catch (error) {
      console.error("[Lélu Voice] processUtterance error:", error);
      this.emitError(error instanceof Error ? error.message : String(error));
    } finally {
      this.processing = false;
      if (!spoke && this.active && !this.stopping) {
        this.resumeListening();
      }
    }
  }

  private resumeListening(): void {
    if (!this.active || this.stopping || this.processing || this.transcribing) {
      return;
    }
    this.resetVad();
    this.setPhase("listening");
    if (this.meter) {
      this.meter.start();
    } else if (this.stream) {
      this.beginListening();
    }
  }

  /* ----- speech output -----
   *
   * One TTS pipeline, shared by voice turns and text-chat responses.
   * Deliberately independent of `active` (voice mode): speaking must work
   * even when the mic session is off, so a typed response is still spoken.
   *
   * iOS hardening:
   *   - warmTts() (called inside the mic tap / Core tap) unlocks the session
   *   - cancel() gets a settle delay before the first chunk (iOS drops
   *     speech issued immediately after cancel)
   *   - resume() clears iOS's paused-synthesis state
   *   - every chunk gets an onend watchdog so TTS can never hang silently
   *   - generation tokens: stale onend/watchdog from an older utterance
   *     can never speak from the new queue
   *   - every speechSynthesis call is wrapped — a throw here can never
   *     escape into a timer/event callback and crash the app
   */

  private speak(text: string): void {
    if (!this.ttsAvailable() || typeof speechSynthesis === "undefined") {
      console.info("[LELU VOICE] TTS unavailable — response text still shown in scene");
      this.diag.ttsStage = "failed";
      this.emitDiagnostics();
      if (this.active && !this.stopping) {
        this.resumeListening();
      }
      return;
    }

    console.info("[LELU VOICE] TTS requested");
    console.info("[LELU VOICE] TTS provider/function selected: speechSynthesis");
    this.diag.ttsRequested = true;
    this.diag.ttsStage = "requested";
    this.emitDiagnostics();

    this.ttsGeneration += 1;
    const generation = this.ttsGeneration;

    try {
      speechSynthesis.cancel();
      speechSynthesis.resume();
    } catch (error) {
      console.error("[LELU VOICE] speechSynthesis.cancel/resume threw (contained):", error);
    }

    this.ttsText = text;
    this.ttsChunks = chunkForSpeech(text);
    this.ttsIndex = 0;
    this.speaking = true;
    this.setPhase("speaking");

    // iOS: let the cancel settle before the first chunk is queued. The
    // audio session is already unlocked by warmTts, so the timer cannot
    // silently block audio.
    setTimeout(() => {
      if (this.speaking && generation === this.ttsGeneration && !this.stopping) {
        this.speakNextChunk(generation);
      }
    }, 80);
  }

  private speakNextChunk(generation: number): void {
    if (
      !this.speaking ||
      this.stopping ||
      generation !== this.ttsGeneration ||
      typeof speechSynthesis === "undefined" ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      return;
    }
    if (this.ttsIndex >= this.ttsChunks.length) {
      this.speaking = false;
      this.ttsText = "";
      console.info("[LELU VOICE] audio playback ended");
      this.diag.audioPlaying = false;
      this.diag.ttsStage = "ended";
      this.emitDiagnostics();
      if (this.active && !this.stopping) {
        this.resumeListening();
      } else {
        this.setPhase("idle");
      }
      return;
    }

    const chunk = this.ttsChunks[this.ttsIndex];
    this.ttsIndex += 1;

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (this.preferredVoice) {
      utterance.voice = this.preferredVoice;
    }

    // Watchdog: if the browser never fires onend (known iOS/Chrome quirk),
    // advance anyway so speech is never left hanging.
    const estimate = Math.min(30000, 1200 + (chunk.length / 14) * 1000);
    const watchdog = setTimeout(() => {
      if (generation === this.ttsGeneration && this.speaking && !this.stopping) {
        this.speakNextChunk(generation);
      }
    }, estimate);
    const clearWatchdog = () => clearTimeout(watchdog);

    utterance.onstart = () => {
      if (generation !== this.ttsGeneration) {
        return;
      }
      console.info("[LELU VOICE] audio playback started");
      this.diag.audioPlaying = true;
      this.diag.ttsStage = "playing";
      this.emitDiagnostics();
    };

    utterance.onend = () => {
      clearWatchdog();
      if (generation !== this.ttsGeneration) {
        return;
      }
      this.speakNextChunk(generation);
    };

    utterance.onerror = (event) => {
      clearWatchdog();
      if (generation !== this.ttsGeneration) {
        return;
      }
      // "canceled" / "interrupted" are expected on barge-in — the chunk
      // queue was already reset by cancelSpeech(). Anything else: log the
      // REAL error, skip this chunk and continue, keeping the conversation
      // functional.
      if (event.error === "canceled" || event.error === "interrupted") {
        return;
      }
      console.error("[LELU VOICE] TTS chunk error:", event.error);
      this.speakNextChunk(generation);
    };

    console.info(`[LELU VOICE] audio generated (chunk ${this.ttsIndex}/${this.ttsChunks.length})`);
    console.info("[LELU VOICE] audio playback starting");
    this.diag.audioGenerated = true;
    this.diag.ttsStage = "playing";
    this.emitDiagnostics();

    try {
      speechSynthesis.resume();
      speechSynthesis.speak(utterance);
    } catch (error) {
      // A synchronous throw here (e.g. iOS racing a stale utterance)
      // must not escape into the watchdog/onend callback that called us.
      clearWatchdog();
      console.error("[LELU VOICE] speechSynthesis.speak threw:", error);
      this.diag.audioPlaying = false;
      this.diag.ttsStage = "failed";
      this.emitDiagnostics();
      // Invalidate this generation so stale callbacks stop, then finish.
      this.ttsGeneration += 1;
      this.speaking = false;
      this.ttsText = "";
      if (this.active && !this.stopping) {
        this.resumeListening();
      } else {
        this.setPhase("idle");
      }
    }
  }

  private cancelSpeech(): void {
    this.ttsGeneration += 1;
    this.speaking = false;
    this.ttsText = "";
    this.ttsChunks = [];
    this.ttsIndex = 0;
    if (typeof speechSynthesis !== "undefined") {
      try {
        speechSynthesis.cancel();
      } catch (error) {
        console.error("[Lélu Voice] speechSynthesis.cancel threw (contained):", error);
      }
    }
    this.diag.audioPlaying = false;
    this.emitDiagnostics();
  }

  /* ----- errors / state ----- */

  private setError(message: string, kind: VoiceErrorKind = "error"): void {
    this.error = message;
    this.errorKind = kind;
    this.diag.lastError = message;
    this.diag.lastErrorAt = Date.now();
    this.emitDiagnostics();
    for (const listener of this.errorListeners) {
      try {
        listener(message);
      } catch (error) {
        console.error("[Lélu Voice] error listener threw (contained):", error);
      }
    }
    this.emitState();
  }

  private setPhase(phase: VoicePhase): void {
    if (this.phase !== phase) {
      this.phase = phase;
      this.emitState();
    }
  }

  private emitState(): void {
    const state = this.getState();
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("[Lélu Voice] state listener threw (contained):", error);
      }
    }
  }

  private emitUtterance(text: string): void {
    for (const listener of this.utteranceListeners) {
      try {
        listener(text);
      } catch (error) {
        console.error("[Lélu Voice] utterance listener threw (contained):", error);
      }
    }
  }

  private emitResponse(text: string): void {
    for (const listener of this.responseListeners) {
      try {
        listener(text);
      } catch (error) {
        console.error("[Lélu Voice] response listener threw (contained):", error);
      }
    }
  }

  private emitTurn(turn: VoiceTurn): void {
    for (const listener of this.turnListeners) {
      try {
        listener(turn);
      } catch (error) {
        console.error("[Lélu Voice] turn listener threw (contained):", error);
      }
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      try {
        listener(message);
      } catch (error) {
        console.error("[Lélu Voice] error listener threw (contained):", error);
      }
    }
  }

  private emitDiagnostics(): void {
    for (const listener of this.diagnosticsListeners) {
      try {
        listener(this.getDiagnostics());
      } catch (error) {
        console.error("[Lélu Voice] diagnostics listener threw (contained):", error);
      }
    }
  }
}

export default VoiceEngine;
