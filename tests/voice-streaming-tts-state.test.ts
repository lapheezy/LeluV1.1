/**
 * ==========================================================
 * LÉLU — STREAMED SPEECH IS SPEECH, AND FAILURE IS TOLD HONESTLY
 *
 * CATEGORY: unit. The real VoiceEngine with a stubbed /api/voice
 * broker and a fake HTMLAudioElement — no network, no audio device.
 *
 * Measured in the live run of Mission 11.2 (Chromium, virtual mic):
 *   - A streamed reply is spoken through her server voice, but the
 *     engine never counted those segments: `isSpeaking()` was false for
 *     the whole reply, so barge-in could not fire, and the phase stayed
 *     "speaking" after the last segment ended.
 *   - When her voice is refused upstream (the free ElevenLabs quota was
 *     exhausted: 401 quota_exceeded) the notice promised "the rest of the
 *     reply uses the browser voice" even on a browser with no voices,
 *     where nothing is spoken at all.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

const audios: FakeAudio[] = [];
let ttsStatus = 200;

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
    if (ttsStatus !== 200) return new Response("{}", { status: ttsStatus });
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

/** Let every queued segment play to its end, the way the audio element would. */
async function playOut(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    const pending = audios.find((audio) => !audio.ended);
    if (!pending) return;
    pending.ended = true;
    pending.onended?.();
    await wait(15);
  }
}

test("a streamed reply through her voice counts as speaking, then settles", async () => {
  engine.beginStreamingSpeech();
  engine.feedStreamingSpeech("First sentence.");
  await wait(20);

  assert.equal(
    engine.isSpeaking(),
    true,
    "her server voice is mid-segment, so a user talking over her can interrupt",
  );
  assert.ok(audios.length >= 1, "the segment was actually handed to the audio element");

  engine.finishStreamingSpeech("First sentence. Second sentence.");
  await wait(30);
  await playOut();

  assert.equal(engine.isSpeaking(), false, "the queue drained");
  assert.notEqual(engine.getState().phase, "speaking", "and the phase left 'speaking'");
  assert.ok(audios.length >= 2, "the trailing sentence was spoken too, once");
  assert.equal(
    new Set(audios.map((audio) => audio.src)).size,
    audios.length,
    "each segment plays through its own audio object — nothing is played twice",
  );
});

test("stopping her mid-stream ends the reply instead of leaving it speaking", async () => {
  engine.beginStreamingSpeech();
  engine.feedStreamingSpeech("This reply will be interrupted.");
  await wait(20);
  engine.cancelSpeech();
  await playOut();
  assert.equal(engine.isSpeaking(), false);
  assert.notEqual(engine.getState().phase, "speaking");
});

test("a refused voice is reported without promising a browser voice that is absent", async () => {
  ttsStatus = 401;
  engine.speakResponse("This reply cannot be spoken.");
  await wait(120);

  const failure = engine.getState().turnFailure;
  assert.equal(failure?.kind, "playback-failure", "the turn records why it went silent");
  assert.equal(
    /browser voice/.test(failure?.message ?? ""),
    false,
    "this runtime has no speechSynthesis, so it must not claim one spoke",
  );
  assert.match(failure?.message ?? "", /nothing was spoken/i);
  assert.equal(engine.getDiagnostics().ttsAvailable, false, "and diagnostics agree");
});

test("one refused segment does not silence her for the rest of the session", async () => {
  // The refused call above demoted her. The server is healthy again on the
  // next reply, and she must use her own voice for it rather than spend the
  // session on a browser voice — or on nothing, where there is no browser one.
  ttsStatus = 401;
  engine.speakResponse("This segment cannot be spoken.");
  await wait(150);
  assert.equal(engine.getState().turnFailure?.kind, "playback-failure", "the refusal is reported");

  const before = audios.length;
  ttsStatus = 200;
  engine.speakResponse("Her own voice is back on the next reply.");
  await wait(150);
  await playOut();

  assert.ok(
    audios.length > before,
    "the next reply asked the server again and played her voice instead of staying demoted",
  );
  assert.equal(engine.getDiagnostics().audioPlaying, false, "and playback settled afterwards");
});
