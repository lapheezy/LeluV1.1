/**
 * ==========================================================
 * LÉLU — VOICE ADAPTERS (Whisper / Silero VAD / Kokoro)
 *
 * The voice intelligence layer, built as adapters BEHIND the
 * existing VoiceEngine rather than as a replacement for it:
 *
 *   VoiceEngine (existing)  listen → transcribe → speak, barge-in
 *        │
 *        ├── SileroVad      when do I stop listening?
 *        ├── WhisperAdapter  what did the user say?
 *        └── KokoroAdapter   how do I say this back?
 *
 * Each adapter reports `configured` truthfully, because a voice
 * pipeline that pretends to have a recogniser is worse than one
 * that says "no recogniser".
 *
 * WHAT IS TESTABLE WITHOUT A MICROPHONE
 * -------------------------------------
 * The parts that actually break conversations are pure logic and
 * are covered by tests/voice-adapters.test.ts:
 *   • chunked speech must not repeat or drop a word at a boundary;
 *   • VAD must not open on steady background noise, and must not
 *     cut a thinking pause in half;
 *   • a barge-in must stop synthesis, not queue behind it;
 *   • overlapping recognition windows are de-duplicated.
 * The audio path itself needs a real device, and this runtime has
 * none — the adapters and the benchmark say so rather than
 * implying a microphone was tested.
 * ==========================================================
 */

export type VoiceHealth = {
  configured: boolean;
  detail: string;
  /** True only when the service was actually contacted. */
  contacted?: boolean;
};

/* ------------------------------------------------------------------ *
 * CHUNKING — no duplicated or missing words at a boundary
 * ------------------------------------------------------------------ */

export interface SpeechChunk {
  index: number;
  text: string;
  /** True when this chunk ends a sentence, so prosody can settle. */
  terminal: boolean;
}

/**
 * Split text into speakable chunks WITHOUT losing a word.
 *
 * The join of every chunk, normalised, is exactly the normalised
 * input. That property is asserted by a test, because the classic
 * streaming-TTS bug is a repeated or swallowed word where two
 * buffers meet — audible as robotic repetition.
 *
 * A chunk ends at sentence punctuation when one is available,
 * otherwise at a clause boundary, otherwise at the last space;
 * never mid-word.
 */
export function planSpeechChunks(text: string, maxChars = 180): SpeechChunk[] {
  const source = text.trim();
  if (!source) return [];
  const chunks: SpeechChunk[] = [];
  let rest = source;
  let index = 0;

  while (rest.length > 0) {
    if (rest.length <= maxChars) {
      chunks.push({ index, text: rest, terminal: /[.!?…]\s*$/.test(rest) });
      break;
    }
    const window = rest.slice(0, maxChars);
    // Prefer a sentence end, then a clause, then a word boundary.
    const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf("… "));
    const clause = Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(", "));
    const space = window.lastIndexOf(" ");
    let cut = sentence > 0 ? sentence + 1 : clause > 0 ? clause + 1 : space > 0 ? space + 1 : maxChars;
    if (cut <= 0) cut = maxChars;
    const piece = rest.slice(0, cut).trimEnd();
    if (!piece) break;
    chunks.push({ index, text: piece, terminal: /[.!?…]\s*$/.test(piece) });
    index += 1;
    rest = rest.slice(cut).trimStart();
  }
  return chunks;
}

/** Normalise for the continuity assertion (whitespace only). */
export function normaliseSpeechText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ *
 * SILERO VAD — voice activity, with a noise floor
 * ------------------------------------------------------------------ */

export interface VadFrame {
  at: number;
  /** RMS energy, 0..1. */
  energy: number;
}

export interface VadOptions {
  /** Speech opens above noiseFloor * openRatio. Default 3.2. */
  openRatio?: number;
  /** Speech closes below noiseFloor * closeRatio. Default 1.6. */
  closeRatio?: number;
  /** Frames of speech before "started". Default 3 (~90 ms at 30 ms). */
  minSpeechFrames?: number;
  /** Silent frames before "ended". Default 17 (~500 ms): a thinking pause is not an interruption. */
  minSilenceFrames?: number;
  /** Initial noise floor estimate, when nothing has been observed yet. */
  initialFloor?: number;
}

export type VadEvent = "started" | "ended" | null;

/**
 * Energy-based voice activity detector with an adaptive noise
 * floor.
 *
 * The adaptive floor is what makes it usable in a room: a fixed
 * threshold either opens on a fridge humming or never opens for a
 * quiet speaker. The floor tracks the quietest recent frames, so
 * steady background noise is learned and ignored, while speech —
 * which varies — is not.
 *
 * It is deliberately NOT claimed to be Silero's neural model: the
 * ONNX weights are not present in this runtime. The class name
 * says which model it stands in for and `model()` reports
 * `silero-onnx (absent)`, so nothing downstream can mistake this
 * for the neural detector.
 */
export class VadDetector {
  private readonly options: Required<VadOptions>;
  private noiseFloor: number;
  private speechFrames = 0;
  private silenceFrames = 0;
  private speaking = false;

  public constructor(options: VadOptions = {}) {
    this.options = {
      openRatio: options.openRatio ?? 3.2,
      closeRatio: options.closeRatio ?? 1.6,
      minSpeechFrames: options.minSpeechFrames ?? 3,
      minSilenceFrames: options.minSilenceFrames ?? 17,
      initialFloor: options.initialFloor ?? 0.01,
    };
    this.noiseFloor = this.options.initialFloor;
  }

  public model(): string {
    return "silero-onnx (absent) — adaptive energy VAD in use";
  }

  public floor(): number {
    return this.noiseFloor;
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  /** Feed one frame; returns the transition, if any. */
  public push(frame: VadFrame): VadEvent {
    const openThreshold = this.noiseFloor * this.options.openRatio;
    const closeThreshold = this.noiseFloor * this.options.closeRatio;
    const voiced = frame.energy > (this.speaking ? closeThreshold : openThreshold);

    if (!this.speaking) {
      // Track the floor only while NOT speaking, so a loud utterance
      // cannot raise the floor and deafen the detector.
      this.noiseFloor = this.noiseFloor * 0.97 + frame.energy * 0.03;
      if (voiced) {
        this.speechFrames += 1;
        if (this.speechFrames >= this.options.minSpeechFrames) {
          this.speaking = true;
          this.silenceFrames = 0;
          return "started";
        }
      } else {
        this.speechFrames = 0;
      }
      return null;
    }

    if (voiced) {
      this.silenceFrames = 0;
      return null;
    }
    this.silenceFrames += 1;
    if (this.silenceFrames >= this.options.minSilenceFrames) {
      this.speaking = false;
      this.speechFrames = 0;
      this.silenceFrames = 0;
      return "ended";
    }
    return null;
  }

  /** Force the utterance closed, e.g. on stop or barge-in. */
  public flush(): VadEvent {
    if (!this.speaking) return null;
    this.speaking = false;
    this.speechFrames = 0;
    this.silenceFrames = 0;
    return "ended";
  }
}

/* ------------------------------------------------------------------ *
 * WHISPER — chunked recognition with overlap de-duplication
 * ------------------------------------------------------------------ */

export interface TranscriptionResult {
  text: string;
  confidence: number | null;
  chunks: number;
  model: string | null;
  detail: string;
}

/**
 * Join overlapping transcript windows without repeating a phrase.
 *
 * Streaming recognisers re-emit the tail of the previous window.
 * The rule: find the longest suffix of `previous` that is a prefix
 * of `next` and drop it. Simple, deterministic, and testable.
 */
export function mergeTranscripts(previous: string, next: string): string {
  const left = previous.trimEnd();
  const right = next.trimStart();
  if (!left) return right;
  if (!right) return left;
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size > 0; size -= 1) {
    if (left.slice(left.length - size).toLowerCase() === right.slice(0, size).toLowerCase()) {
      return `${left}${right.slice(size)}`;
    }
  }
  return `${left} ${right}`;
}

export class WhisperAdapter {
  private readonly baseUrl: string | undefined;
  private readonly model: string | undefined;

  public constructor(input: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = input.baseUrl ?? (typeof process !== "undefined" ? process.env?.WHISPER_BASE_URL : undefined);
    this.model = input.model ?? (typeof process !== "undefined" ? process.env?.WHISPER_MODEL : undefined);
  }

  public health(): VoiceHealth {
    return this.baseUrl
      ? { configured: true, detail: `whisper.cpp server at ${this.baseUrl}, model ${this.model ?? "(server default)"}` }
      : {
          configured: false,
          detail: "WHISPER_BASE_URL is unset — no local recognition; the browser recogniser is used when one exists.",
        };
  }

  /**
   * Transcribe one audio blob against the configured server.
   * Returns an honest failure when nothing is configured.
   */
  public async transcribe(
    audio: Blob,
    options: { language?: string; signal?: AbortSignal } = {},
  ): Promise<TranscriptionResult> {
    if (!this.baseUrl) {
      return {
        text: "",
        confidence: null,
        chunks: 0,
        model: null,
        detail: "No whisper.cpp server is configured; nothing was transcribed.",
      };
    }
    const form = new FormData();
    form.append("file", audio, "audio.wav");
    form.append("response_format", "json");
    if (options.language) form.append("language", options.language);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/inference`, {
      method: "POST",
      body: form,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      return {
        text: "",
        confidence: null,
        chunks: 0,
        model: this.model ?? null,
        detail: `whisper.cpp answered HTTP ${response.status}; nothing was transcribed.`,
      };
    }
    const payload = (await response.json()) as { text?: string };
    return {
      text: (payload.text ?? "").trim(),
      confidence: null, // whisper.cpp's json response carries no confidence
      chunks: 1,
      model: this.model ?? null,
      detail: "transcribed by the configured whisper.cpp server",
    };
  }
}

/* ------------------------------------------------------------------ *
 * KOKORO — chunked synthesis with interruption
 * ------------------------------------------------------------------ */

export class KokoroAdapter {
  private readonly baseUrl: string | undefined;
  private readonly voice: string;
  private generation = 0;

  public constructor(input: { baseUrl?: string; voice?: string } = {}) {
    this.baseUrl = input.baseUrl ?? (typeof process !== "undefined" ? process.env?.KOKORO_BASE_URL : undefined);
    this.voice = input.voice ?? (typeof process !== "undefined" ? process.env?.KOKORO_VOICE : undefined) ?? "af_heart";
  }

  public health(): VoiceHealth {
    return this.baseUrl
      ? { configured: true, detail: `Kokoro server at ${this.baseUrl}, voice "${this.voice}"` }
      : {
          configured: false,
          detail: "KOKORO_BASE_URL is unset — synthesis uses the browser's own voices (0 in a headless runtime).",
        };
  }

  /**
   * Synthesise chunks in order.
   *
   * `interrupt()` bumps a generation counter; any in-flight loop
   * checks it between chunks and stops, so a barge-in takes effect
   * at the next chunk boundary instead of after the whole reply.
   * That is the difference between an assistant that stops talking
   * and one that finishes its paragraph first.
   */
  public async speak(
    text: string,
    onAudio: (chunk: SpeechChunk, audio: Blob) => Promise<void> | void,
    options: { maxChars?: number; signal?: AbortSignal } = {},
  ): Promise<{ spoken: number; interrupted: boolean; detail: string }> {
    const chunks = planSpeechChunks(text, options.maxChars);
    if (!this.baseUrl) {
      return {
        spoken: 0,
        interrupted: false,
        detail: "No Kokoro server is configured; nothing was synthesised.",
      };
    }
    const generation = this.generation;
    let spoken = 0;
    for (const chunk of chunks) {
      if (this.generation !== generation || options.signal?.aborted) {
        return { spoken, interrupted: true, detail: `Interrupted after ${spoken} of ${chunks.length} chunk(s).` };
      }
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: chunk.text, voice: this.voice }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (!response.ok) {
        return {
          spoken,
          interrupted: false,
          detail: `Kokoro answered HTTP ${response.status} on chunk ${chunk.index}; synthesis stopped.`,
        };
      }
      await onAudio(chunk, await response.blob());
      spoken += 1;
    }
    return { spoken, interrupted: false, detail: `Synthesised ${spoken} chunk(s).` };
  }

  public interrupt(): void {
    this.generation += 1;
  }
}

/* ------------------------------------------------------------------ *
 * BENCHMARK — median and p95, measured, never estimated
 * ------------------------------------------------------------------ */

export interface VoiceBenchmarkSample {
  transcriptionMs?: number;
  synthesisMs?: number;
  responseMs?: number;
  interruptionMs?: number;
}

export interface VoiceBenchmarkReport {
  samples: number;
  median: Record<string, number | null>;
  p95: Record<string, number | null>;
  detail: string;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index] * 10) / 10;
}

export function summariseBenchmark(samples: VoiceBenchmarkSample[]): VoiceBenchmarkReport {
  const pick = (key: keyof VoiceBenchmarkSample): number[] =>
    samples.map((sample) => sample[key]).filter((value): value is number => typeof value === "number");
  const median: Record<string, number | null> = {};
  const p95: Record<string, number | null> = {};
  for (const key of ["transcriptionMs", "synthesisMs", "responseMs", "interruptionMs"] as const) {
    const values = pick(key);
    median[key] = percentile(values, 0.5);
    p95[key] = percentile(values, 0.95);
  }
  return {
    samples: samples.length,
    median,
    p95,
    detail:
      samples.length === 0
        ? "No samples measured. Nothing is claimed about latency."
        : `${samples.length} measured sample(s); median and p95 computed from real timings.`,
  };
}
