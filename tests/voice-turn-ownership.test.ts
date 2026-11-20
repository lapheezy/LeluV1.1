/**
 * ==========================================================
 * LÉLU — A SUPERSEDED REPLY CANNOT SPEAK OVER THE NEWER ONE
 *
 * CATEGORY: unit. The real VoiceEngine, a stubbed /api/voice broker and
 * a fake HTMLAudioElement. No network, no audio device.
 *
 * The M22.7 defect: a response could become detached from the input that
 * asked for it. A streamed reply was fed to the speech layer with no
 * owner at all, so deltas belonging to a turn the user had already left
 * kept being spoken while the next answer was being written — the speech
 * no longer matched the transcript on screen.
 *
 * The fix is ownership: every streamed reply names its turn, and the
 * engine speaks only for the turn that currently owns the conversation.
 * The number of dropped deltas is reported, so the protection is visible
 * rather than indistinguishable from silence.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

const audios: FakeAudio[] = [];

class FakeAudio {
  src: string;
  ended = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    audios.push(this);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {
    this.ended = true;
  }
  removeAttribute(): void {}
  load(): void {}
}

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.Audio = FakeAudio;
g.isSecureContext = true;
g.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/voice/status")) {
    return new Response(JSON.stringify({ configured: true, stt: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/api/voice/tts")) {
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  }
  return new Response("{}", { status: 404 });
};

const { default: VoiceEngine } = await import("../src/core/voice/VoiceEngine");
const engine = VoiceEngine.getInstance();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function playOut(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const pending = audios.find((audio) => !audio.ended);
    if (!pending) return;
    pending.ended = true;
    pending.onended?.();
    await wait(10);
  }
}

test("a new turn takes the stream, and the old turn's deltas are dropped", async () => {
  // Turn A opens the stream and says its first sentence.
  engine.beginStreamingSpeech("turn-a");
  engine.feedStreamingSpeech("The first answer begins here.", "turn-a");
  await wait(30);
  const spokenForA = audios.length;
  assert.equal(spokenForA, 1, "turn A's first sentence was spoken");

  // The user moves on. Turn B takes ownership and cancels A's playback.
  engine.beginStreamingSpeech("turn-b");
  await playOut();
  const afterTakeover = audios.length;

  // A's stream keeps arriving for a moment after it was superseded. None
  // of it may be spoken: it answers a question that is no longer current.
  engine.feedStreamingSpeech("The first answer begins here. And continues late.", "turn-a");
  engine.finishStreamingSpeech("The first answer begins here. And continues late.", "turn-a");
  await wait(40);
  assert.equal(audios.length, afterTakeover, "a superseded reply produced no audio");
  assert.ok(
    engine.getDiagnostics().staleStreamsDropped >= 2,
    "the drops are counted, not silently swallowed",
  );

  // Turn B speaks normally, with its own tail.
  engine.feedStreamingSpeech("The second answer is the current one.", "turn-b");
  await wait(30);
  engine.finishStreamingSpeech("The second answer is the current one. It ends here.", "turn-b");
  await wait(40);
  await playOut();
  assert.ok(audios.length > afterTakeover, "the current reply was spoken");
  assert.notEqual(engine.getState().phase, "speaking", "and the engine settled out of 'speaking'");
});

test("a reply that names no owner is still spoken (older callers keep working)", async () => {
  const before = audios.length;
  engine.beginStreamingSpeech();
  engine.feedStreamingSpeech("An anonymous reply still speaks.", undefined);
  await wait(30);
  await playOut();
  assert.ok(audios.length > before, "the unowned reply was spoken");
});

test("cancelling speech leaves the next turn free to speak", async () => {
  engine.beginStreamingSpeech("turn-c");
  engine.feedStreamingSpeech("This sentence will be interrupted.", "turn-c");
  await wait(30);
  engine.cancelSpeech();
  await playOut();
  assert.equal(engine.isSpeaking(), false, "interruption stops playback");

  const before = audios.length;
  engine.beginStreamingSpeech("turn-d");
  engine.feedStreamingSpeech("The next turn speaks normally.", "turn-d");
  await wait(30);
  assert.ok(audios.length > before, "the conversation recovered into the next turn");
  engine.cancelSpeech();
});

test("latency is reported as unknown until a real turn measures it", async () => {
  // No spoken turn has run in this process: the honest answer is null, not
  // a fabricated zero. The live acceptance run supplies the real numbers.
  assert.equal(engine.getTurnLatency(), null, "no turn, no number");
  const diagnostics = engine.getDiagnostics();
  assert.equal(diagnostics.firstAudioLatencyMs, null);
  assert.equal(diagnostics.firstTextLatencyMs, null);
  assert.equal(typeof diagnostics.staleStreamsDropped, "number");
  assert.equal(typeof diagnostics.ttsQueueDepth, "number");
  assert.equal(typeof diagnostics.fullDuplex, "boolean");

  engine.beginStreamingSpeech("turn-e");
  engine.feedStreamingSpeech("A measured sentence.", "turn-e");
  await wait(40);
  assert.equal(engine.getTurnLatency(), null, "streamed speech alone does not invent a latency");
  engine.cancelSpeech();
});
