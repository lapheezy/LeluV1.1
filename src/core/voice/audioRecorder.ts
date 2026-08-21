/**
 * ==========================================================
 * LÉLU
 * AUDIO RECORDER
 * ==========================================================
 */

export function mediaRecorderSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function"
  );
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

export function pickRecorderMimeType(): string {
  if (!mediaRecorderSupported()) {
    return "";
  }
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

export interface LevelMeterHandle {
  start(): void;
  stop(): void;
}

export function createLevelMeter(
  stream: MediaStream,
  onRms: (rms: number) => void,
): LevelMeterHandle {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const data = new Float32Array(analyser.fftSize);
  let raf: number | null = null;

  function tick() {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);
    onRms(rms);
    raf = requestAnimationFrame(tick);
  }

  return {
    start() {
      tick();
    },
    stop() {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      source.disconnect();
      ctx.close().catch(() => {});
    },
  };
}

export class MediaRecorderCapture {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(
    private readonly stream: MediaStream,
    private readonly mimeType: string,
  ) {}

  start(): void {
    this.chunks = [];
    const opts: MediaRecorderOptions = this.mimeType
      ? { mimeType: this.mimeType }
      : {};
    this.recorder = new MediaRecorder(this.stream, opts);

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.recorder.start();
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        resolve(null);
        return;
      }
      this.recorder.onstop = () => {
        const blob =
          this.chunks.length > 0
            ? new Blob(this.chunks, {
                type: this.mimeType || "audio/webm",
              })
            : null;
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}

export function wavCaptureSupported(): boolean {
  return (
    typeof AudioContext !== "undefined" ||
    typeof (window as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext !== "undefined"
  );
}

export async function captureWav(
  stream: MediaStream,
  durationMs: number,
): Promise<Blob> {
  const Ctx =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;

  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
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
}

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
