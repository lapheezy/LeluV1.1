/**
 * ==========================================================
 * LÉLU — A REPLY IS NEVER OPENED IN THE BROWSER'S VOICE
 *
 * CATEGORY: unit. The real VoiceEngine, a stubbed /api/voice broker
 * that answers the voice question LATE, a browser speechSynthesis that
 * really exists, and a fake HTMLAudioElement.
 *
 * The reported symptom (2026-11-11): "you put the old voice back, not
 * the new one". The cause was the gate, not the identity: the streamed
 * path waited for the server's answer to "do you have her voice?" only
 * when the browser had NO speech engine. On a machine that has browser
 * voices — the normal case — the probe was still in flight, elevenLabs
 * was still false, and the opening sentences of every reply were spoken
 * by the browser's voice. The rest of the reply, arriving after the
 * probe resolved, came back in her voice: two voices in one answer.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

const audios: FakeAudio[] = [];
const browserSpoken: string[] = [];

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

class FakeUtterance {
  text: string;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  constructor(text: string) {
    this.text = text;
  }
}

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.Audio = FakeAudio;
g.HTMLAudioElement = FakeAudio;
g.SpeechSynthesisUtterance = FakeUtterance;
g.isSecureContext = true;
// THE KEY OF THIS TEST: a browser that HAS a voice to fall back on.
g.speechSynthesis = {
  speak: (utterance: FakeUtterance) => {
    browserSpoken.push(utterance.text);
  },
  cancel: () => {},
  speaking: false,
  pending: false,
  paused: false,
  pause: () => {},
  resume: () => {},
  getVoices: () => [{ name: "Browser Voice", lang: "en-US", voiceURI: "browser:1", default: true }],
};

let statusAnswered = false;

g.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/voice/status")) {
    // The server takes a moment to say who she is. The reply starts first.
    await new Promise((resolve) => setTimeout(resolve, 180));
    statusAnswered = true;
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

test("the opening of a reply waits for her voice instead of using the browser's", async () => {
  engine.beginStreamingSpeech();
  engine.feedStreamingSpeech("First sentence of the reply.");

  // Long enough for the old code to have spoken it, far short of the
  // 180ms the server needs to answer.
  await wait(60);
  assert.deepEqual(
    browserSpoken,
    [],
    "the browser voice must not open the reply while her voice is still being confirmed",
  );
  assert.equal(statusAnswered, false, "the probe was still in flight when the sentence arrived");

  // Now the answer lands: she has her voice, so the same sentence is spoken
  // by her, once, and the browser engine is never used.
  await wait(400);
  engine.finishStreamingSpeech("First sentence of the reply.");
  await wait(200);

  assert.ok(audios.length >= 1, "her server voice spoke the reply");
  assert.deepEqual(browserSpoken, [], "no part of the reply was spoken in the browser's voice");
});
