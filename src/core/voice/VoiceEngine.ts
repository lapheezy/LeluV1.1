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
  | "tts";

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

export interface VoiceDiagnostics {
  sttSupported: boolean;
  ttsSupported: boolean;
  micAvailable: boolean;
  groqKeyAvailable: boolean;
  secureContext: boolean;
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

  private static readonly CHUNK_SIZE = 200;

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
      this.updateState({
        ...this._state,
        active: true,
        phase: "listening",
        permission: "granted",
        error: null,
        errorKind: null,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn("[VoiceEngine] Microphone denied:", msg);
      this.setError("Microphone permission denied. Please allow mic access.", "permission");
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
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          this.setError("Microphone permission denied.", "permission");
        } else if (event.error === "network") {
          this.setError("Speech recognition network error.", "network");
        } else if (event.error === "no-speech") {
          // No speech detected — not an error, just continue
        } else {
          console.warn("[VoiceEngine] Recognition error:", event.error);
          this.setError(`Recognition error: ${event.error}`, "recognition");
        }
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
    if (typeof speechSynthesis === "undefined") {
      this.updateState({ ...this._state, phase: "listening" });
      return;
    }

    this.cancelSpeech();
    if (!text || !text.trim()) {
      this.updateState({ ...this._state, phase: "listening" });
      return;
    }

    this.cancelFlag = false;
    // speaking flag is managed by cancelFlag and phase state

    const chunks = this.chunkText(text.trim());
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
      utterance.onend = () => speakNext();
      utterance.onerror = (e) => {
        if (e.error === "canceled" || this.cancelFlag) {
          return;
        }
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
    for (const chunk of this.chunkText(rest)) {
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

  private chunkText(text: string): string[] {
    if (text.length <= VoiceEngine.CHUNK_SIZE) return [text];

    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = "";

    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 > VoiceEngine.CHUNK_SIZE) {
        if (current) chunks.push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [text];
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
    };
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
