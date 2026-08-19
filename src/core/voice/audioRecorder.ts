/**
 * ==========================================================
 * LÉLU
 * AUDIO CAPTURE — REAL MICROPHONE RECORDING
 *
 * The capture half of the voice pipeline. No Safari
 * SpeechRecognition here: we record actual audio from the
 * microphone and send it to the STT service (speechToText.ts).
 *
 *   getUserMedia stream
 *     → MediaRecorder (webm/mp4)  — modern browsers, incl. iOS
 *       Safari 16.4+
 *     → WavCapture (PCM WAV)      — fallback for iOS versions
 *       without MediaRecorder
 *     → Blob → transcribeAudio()  → transcript → existing chat
 *
 * LevelMeter (AnalyserNode) drives VAD: it reports RMS levels so
 * the engine can start recording when the user speaks and commit
 * after a silence gap — no push-to-talk, no partial transcripts.
 * ==========================================================
 */

/* ----------------------------------------------------------
 * Capability detection
 * ---------------------------------------------------------- */

export function mediaRecorderSupported(): boolean {
  return typeof MediaRecorder !== "undefined";
}

export function wavCaptureSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return Boolean(w.AudioContext || w.webkitAudioContext);
}

/** Pick the best MediaRecorder container this browser can record. */
export function pickRecorderMimeType(): string {
  if (!mediaRecorderSupported()) {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "",
  ];
  for (const mime of candidates) {
    try {
      if (mime === "" || MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // Unknown mime — try the next candidate.
    }
  }
  return "";
}

export function recorderSupported(): boolean {
  return mediaRecorderSupported() || wavCaptureSupported();
}

/* ----------------------------------------------------------
 * MediaRecorder capture (primary — works on iOS Safari 16.4+)
 * ---------------------------------------------------------- */

export class MediaRecorderCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopResolve: ((blob: Blob | null) => void) | null = null;

  constructor(
    private readonly stream: MediaStream,
    private readonly mimeType: string,
  ) {}

  public start(): void {
    if (this.recorder) {
      return;
    }
    try {
      const recorder = new MediaRecorder(
        this.stream,
        this.mimeType ? { mimeType: this.mimeType } : undefined,
      );
      this.chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        const resolve = this.stopResolve;
        this.stopResolve = null;
        this.recorder = null;
        if (resolve) {
          resolve(
            new Blob(this.chunks, {
              type: this.mimeType || "audio/webm",
            }),
          );
        }
      };
      recorder.onerror = () => {
        const resolve = this.stopResolve;
        this.stopResolve = null;
        this.recorder = null;
        if (resolve) {
          resolve(null);
        }
      };
      // Timeslice so chunks are flushed regularly (Safari quirk: without
      // it ondataavailable can be delayed until stop).
      recorder.start(250);
      this.recorder = recorder;
    } catch (error) {
      console.error("[Lélu Voice] MediaRecorder start threw (contained):", error);
      this.recorder = null;
    }
  }

  public stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder) {
      return Promise.resolve(null);
    }
    if (recorder.state === "inactive") {
      this.recorder = null;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      try {
        recorder.stop();
      } catch (error) {
        console.error("[Lélu Voice] MediaRecorder stop threw (contained):", error);
        this.stopResolve = null;
        this.recorder = null;
        resolve(null);
      }
    });
  }

  public dispose(): void {
    const recorder = this.recorder;
    this.recorder = null;
    this.stopResolve = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already stopped or unusable.
      }
    }
  }
}

/* ----------------------------------------------------------
 * WAV capture fallback (iOS Safari without MediaRecorder)
 * ---------------------------------------------------------- */

function getAudioContextConstructor(): typeof AudioContext | null {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Encode mono Float32 PCM channels into a 16-bit WAV blob (pure). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  let total = 0;
  for (const channel of channels) {
    total += channel.length;
  }
  if (total === 0) {
    return new Blob([], { type: "audio/wav" });
  }
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + total * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, total * 2, true);

  let offset = 44;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class WavCapture {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private samples: Float32Array[] = [];
  private capturing = false;

  constructor(private readonly stream: MediaStream) {}

  public start(): void {
    if (this.capturing) {
      return;
    }
    const Constructor = getAudioContextConstructor();
    if (!Constructor) {
      return;
    }
    try {
      const context = new Constructor();
      const source = context.createMediaStreamSource(this.stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      // Silent gain keeps the graph alive so onaudioprocess fires without
      // ever routing the microphone to the speakers (echo!).
      const gain = context.createGain();
      gain.gain.value = 0;

      this.samples = [];
      processor.onaudioprocess = (event) => {
        if (this.capturing) {
          this.samples.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        }
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);

      this.context = context;
      this.source = source;
      this.processor = processor;
      this.capturing = true;
    } catch (error) {
      console.error("[Lélu Voice] WavCapture start threw (contained):", error);
      this.cleanup();
    }
  }

  public stop(): Promise<Blob | null> {
    if (!this.capturing) {
      return Promise.resolve(null);
    }
    this.capturing = false;
    const sampleRate = this.context?.sampleRate ?? 48000;
    const blob = encodeWav(this.samples, sampleRate);
    this.cleanup();
    return Promise.resolve(blob);
  }

  public dispose(): void {
    this.capturing = false;
    this.cleanup();
  }

  private cleanup(): void {
    try {
      this.processor?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      this.source?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      void this.context?.close();
    } catch {
      // Already closed.
    }
    this.processor = null;
    this.source = null;
    this.context = null;
  }
}

/* ----------------------------------------------------------
 * Level meter (VAD input)
 * ---------------------------------------------------------- */

export interface LevelMeterHandle {
  start(): void;
  stop(): void;
}

/**
 * AnalyserNode-based RMS meter. Calls `onSample(rms)` roughly once per
 * animation frame. The engine decides speech/silence from the levels.
 */
export function createLevelMeter(
  stream: MediaStream,
  onSample: (rms: number) => void,
): LevelMeterHandle {
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let raf = 0;
  let running = false;

  const Constructor = getAudioContextConstructor();
  if (!Constructor) {
    return { start: () => {}, stop: () => {} };
  }

  const stop = () => {
    running = false;
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    try {
      source?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      void context?.close();
    } catch {
      // Already closed.
    }
    source = null;
    analyser = null;
    context = null;
  };

  const start = () => {
    if (running || !Constructor) {
      return;
    }
    try {
      const ctx = new Constructor();
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.25;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyserNode);

      context = ctx;
      analyser = analyserNode;
      source = src;
      running = true;

      const samples = new Float32Array(analyserNode.fftSize);
      const loop = () => {
        if (!running || !analyser) {
          return;
        }
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          sum += samples[index] * samples[index];
        }
        const rms = Math.sqrt(sum / samples.length);
        try {
          onSample(rms);
        } catch (error) {
          console.error("[Lélu Voice] level callback threw (contained):", error);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } catch (error) {
      console.error("[Lélu Voice] level meter start threw (contained):", error);
      stop();
    }
  };

  return { start, stop };
}
