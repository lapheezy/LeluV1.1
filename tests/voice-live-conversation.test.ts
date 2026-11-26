/**
 * ==========================================================
 * LÉLU — LIVE CONVERSATION: ONE SESSION, MANY TURNS, REAL BARGE-IN
 *
 * CATEGORY: unit, offline. elevenLabsTts.ts with a stubbed broker and a
 * fake HTMLAudioElement; the engine's pure rules directly.
 *
 * What the live session needs, and what used to be wrong:
 *
 *   1. She stops when the person STARTS talking over her. Barge-in waited
 *      for their whole sentence plus its transcription. Now the voice
 *      detector holds her playback on onset, and the transcript decides:
 *      stop (a real interruption) or resume (her own echo, a cough, nothing).
 *   2. An interrupted reply can never come back. A pump still awaiting an
 *      aborted sentence saw the NEXT reply clear the global "halted" flag,
 *      called that sentence's onFail, and the engine handed it to a
 *      different voice. Cancellation is now per sentence.
 *   3. Her first word sooner on a slow worker: the first piece of a reply
 *      ends at a clause, not at the end of the first sentence.
 *   4. She knows a turn was spoken, and what of her reply was actually heard.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audios: FakeAudio[] = [];
let requests: string[] = [];
let synthesisDelayMs = 20;

class FakeAudio {
  src: string;
  paused = false;
  plays = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    audios.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    this.plays += 1;
    queueMicrotask(() => this.onplaying?.());
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  removeAttribute(): void {}
  load(): void {}
}

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.Audio = FakeAudio;
g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/voice/status")) {
    return new Response(JSON.stringify({ configured: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/api/voice/tts")) {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { text?: string }) : {};
    requests.push(String(body.text ?? ""));
    const signal = init?.signal;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, synthesisDelayMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "audio/wav" } });
  }
  return new Response("{}", { status: 404 });
};

const tts = await import("../src/core/voice/elevenLabsTts");
const { firstSpeechBoundary, nextSpeechBoundary, spokenTurnNote, isBargeIn } = await import("../src/core/voice/VoiceEngine");
const { voiceStatus } = await import("../src/core/voice/voiceStatus");
const { toSpokenText } = await import("../src/core/voice/spokenText");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------ hold ------------------------------ */

test("a hold pauses her where she is, and nothing plays until it is released", async () => {
  requests = [];
  audios.length = 0;
  tts.stopSpeaking();
  synthesisDelayMs = 10;
  const ended: string[] = [];
  void tts.speakText("First sentence.", { onEnd: () => ended.push("first") });
  void tts.speakText("Second sentence.", { onEnd: () => ended.push("second") });
  await wait(40);
  assert.equal(audios.length, 1, "the first sentence is playing");

  assert.equal(tts.holdSpeaking(), true, "there was audio to hold");
  assert.equal(audios[0].paused, true, "the playing sentence is paused, not discarded");
  assert.equal(tts.isSpeechHeld(), true);

  // The held sentence finishing (or being already over) must not let the
  // next one start while the person is still talking.
  audios[0].onended?.();
  await wait(40);
  assert.equal(audios.length, 1, "the next sentence waits out the hold");
  assert.deepEqual(ended, ["first"]);

  tts.resumeSpeaking();
  await wait(20);
  assert.equal(tts.isSpeechHeld(), false);
  assert.equal(audios.length, 2, "released: she carries on with the next sentence");
  audios[1].onended?.();
  await wait(10);
  assert.deepEqual(ended, ["first", "second"]);
});

test("resuming a held sentence plays it on from where it paused", async () => {
  audios.length = 0;
  tts.stopSpeaking();
  void tts.speakText("Only sentence.");
  await wait(40);
  const audio = audios[0];
  const playsBefore = audio.plays;
  tts.holdSpeaking();
  tts.resumeSpeaking();
  assert.equal(audio.plays, playsBefore + 1, "the same element is played again (no new request, no restart)");
  assert.equal(audio.paused, false);
  audio.onended?.();
});

test("a stop during a hold drops the held audio and everything behind it", async () => {
  requests = [];
  audios.length = 0;
  tts.stopSpeaking();
  const fails: string[] = [];
  void tts.speakText("Held one.", { onFail: () => fails.push("held") });
  void tts.speakText("Behind it.", { onFail: () => fails.push("behind") });
  await wait(40);
  tts.holdSpeaking();
  tts.stopSpeaking();
  assert.equal(tts.isSpeechHeld(), false, "a stop ends the hold");
  await wait(60);
  assert.equal(audios.length, 1, "nothing that was queued plays after the stop");
  assert.deepEqual(fails, [], "a stopped sentence is not a failed one");
});

test("holding with nothing to say holds nothing", () => {
  tts.stopSpeaking();
  assert.equal(tts.holdSpeaking(), false);
  assert.equal(tts.isSpeechHeld(), false);
});

/* --------------------------- stale audio --------------------------- */

test("an interrupted reply never plays, nor 'fails', after the next reply has begun", async () => {
  requests = [];
  audios.length = 0;
  tts.stopSpeaking();
  synthesisDelayMs = 80;
  const events: string[] = [];
  // Old reply: its sentence is still being synthesised when the person cuts in.
  void tts.speakText("Old reply sentence.", {
    onStart: () => events.push("old:start"),
    onFail: () => events.push("old:fail"),
  });
  await wait(10);
  tts.stopSpeaking();
  // The new reply's first sentence arrives at once (this cleared the global flag).
  void tts.speakText("New reply sentence.", {
    onStart: () => events.push("new:start"),
    onFail: () => events.push("new:fail"),
  });
  await wait(250);
  assert.deepEqual(events, ["new:start"], "only the new reply is heard; the old one neither plays nor reports a failure");
  audios.at(-1)?.onended?.();
  synthesisDelayMs = 20;
});

/* --------------------------- first clause --------------------------- */

test("on a slow voice the first piece ends at the first clause", () => {
  const reply = "The ocean covers about seventy percent of the planet, and most of it is still unexplored. Want more?";
  const end = firstSpeechBoundary(reply);
  assert.equal(reply.slice(0, end ?? 0).trim(), "The ocean covers about seventy percent of the planet,");
  // Too short to stand alone: wait for the sentence.
  assert.equal(firstSpeechBoundary("Sure, I can help with that. "), nextSpeechBoundary("Sure, I can help with that. "));
  // The comma inside a number is not a clause; the one after it is.
  assert.equal(firstSpeechBoundary("It costs 1,000 dollars, give or take a little bit. "), "It costs 1,000 dollars, ".length);
  // Found in the live run: an unspaced em dash ends a clause too.
  assert.equal(firstSpeechBoundary("Roughly 300 m tall—about 1,000 ft (the total is 324 m). "), "Roughly 300 m tall—".length);
  // Nothing complete yet: nothing to say yet.
  assert.equal(firstSpeechBoundary("The ocean covers about"), null);
  // A clause break that arrives while the sentence is still streaming is enough.
  assert.equal(firstSpeechBoundary("Honestly, I think the ocean is wonderful; it calms me"), "Honestly, I think the ocean is wonderful; ".length);
});

/* --------------------------- context --------------------------- */

test("a spoken turn says it was spoken, and what of her reply was heard", () => {
  const now = 1_000_000;
  assert.match(spokenTurnNote(null, now), /spoken aloud in a live voice conversation/);
  assert.doesNotMatch(spokenTurnNote(null, now), /interrupted/);
  const cut = spokenTurnNote({ heard: "The ocean covers about seventy percent of the planet,", at: now - 5000 }, now);
  assert.match(cut, /interrupted you/);
  assert.match(cut, /"The ocean covers about seventy percent of the planet,"/);
  // Found live: told only what was heard, she went on with the interrupted
  // answer instead of answering the new question.
  assert.match(cut, /Answer what they have just said; do not continue/);
  assert.match(spokenTurnNote({ heard: "", at: now - 1000 }, now), /before they heard any/);
  // An old interruption is not this turn's context.
  assert.doesNotMatch(spokenTurnNote({ heard: "x", at: now - 10 * 60_000 }, now), /interrupted/);
});

test("one word interrupts her only when it is a word people interrupt with", () => {
  assert.equal(isBargeIn("Stop.", "Here is a long answer about the sea"), true);
  assert.equal(isBargeIn("wait", "Here is a long answer about the sea"), true);
  assert.equal(isBargeIn("okay", "Here is a long answer about the sea"), false);
  assert.equal(isBargeIn("What about Mars?", "Here is a long answer about the sea"), true);
  // Her own words coming back through the mic are not the person.
  assert.equal(isBargeIn("a long answer about the sea", "Here is a long answer about the sea"), false);
});

/* --------------------------- states --------------------------- */

test("the session shows hearing, and shows that it ended", () => {
  const base = { active: true, captureSuspended: false, audioPlaying: false, phase: "listening", ttsStage: "idle" } as const;
  assert.equal(voiceStatus({ ...base, userSpeaking: true }).key, "hearing");
  const held = voiceStatus({ ...base, phase: "speaking", ttsStage: "playing", audioPlaying: false, speechHeld: true });
  assert.equal(held.key, "hearing", "held for an interruption is not 'Speaking'");
  assert.equal(held.canStopSpeech, true, "the held reply can still be stopped");
  assert.equal(voiceStatus({ ...base, active: false, phase: "idle", justEnded: true }).key, "ended");
  // Holding the stream is not listening: until speech capture runs, say so.
  assert.equal(voiceStatus({ ...base, earsReady: false }).key, "starting");
  assert.equal(voiceStatus({ ...base, earsReady: true }).key, "listening");
  assert.equal(voiceStatus({ ...base, active: false, phase: "idle" }).key, "off");
});

/* --------------------------- capture loop --------------------------- */

test("the microphone records the next utterance while the last one is transcribed", () => {
  const source = readFileSync(new URL("../src/core/voice/VoiceEngine.ts", import.meta.url), "utf8");
  const loop = source.slice(source.indexOf("private async whisperFallbackLoop"), source.indexOf("private transcriptChain"));
  assert.ok(loop.length > 0);
  assert.doesNotMatch(loop, /await this\.transcribeUtterance/, "the loop must not wait for transcription before recording again");
  assert.match(loop, /this\.transcribeInOrder\(chunk/);
  assert.match(source, /this\.transcriptChain = this\.transcriptChain/, "transcripts are handled in the order they were spoken");
});

/* ------------------- slow worker: one request at a time ------------------- */

test("against a worker slower than real time, sentences are requested one after another, in order", async () => {
  // The status the page reads says the worker runs at RTF 6.
  g.fetch = ((orig: typeof fetch) => async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/voice/status")) {
      return new Response(JSON.stringify({ configured: true, workerRtf: 6 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return orig(input, init);
  })(g.fetch as typeof fetch);
  tts.forgetElevenLabsStatus();
  await tts.elevenLabsReady();
  requests = [];
  audios.length = 0;
  tts.stopSpeaking();
  synthesisDelayMs = 40;
  void tts.speakText("One.");
  void tts.speakText("Two.");
  await wait(15);
  assert.deepEqual(requests, ["One."], "the second request waits for the first answer");
  await wait(60);
  assert.deepEqual(requests, ["One.", "Two."], "then it goes, so the worker receives them in order");
  tts.stopSpeaking();
  synthesisDelayMs = 20;
});

test("a hold that lands before the audio starts is a pause, not a failure", async () => {
  audios.length = 0;
  tts.stopSpeaking();
  // play() that stays pending (the page is busy) and rejects when paused, as browsers do.
  const proto = FakeAudio.prototype as unknown as { play: () => Promise<void>; pause: () => void };
  const realPlay = proto.play;
  const realPause = proto.pause;
  let reject: ((e: unknown) => void) | null = null;
  proto.play = function (this: FakeAudio) {
    this.plays += 1;
    return new Promise<void>((_, r) => (reject = r));
  };
  proto.pause = function (this: FakeAudio) {
    this.paused = true;
    reject?.(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"));
  };
  const events: string[] = [];
  void tts.speakText("Pending start.", { onFail: () => events.push("fail"), onEnd: () => events.push("end") });
  await wait(120);
  assert.equal(audios.length, 1);
  tts.holdSpeaking();
  await wait(10);
  assert.deepEqual(events, [], "the AbortError from the hold is not reported as a failure");
  proto.play = realPlay;
  proto.pause = realPause;
  tts.resumeSpeaking();
  await wait(10);
  audios[0].onended?.();
  await wait(10);
  assert.deepEqual(events, ["end"], "resumed and finished normally");
});

/* ------------------- noise is not speech (voice detector) ------------------- */

const { TURN_DETECTOR_SOURCE } = await import("../src/core/voice/vadWorklet");

function runDetector(samples: Float32Array, rate: number): { onset: boolean; result: Record<string, number | boolean> | null } {
  let onset = false;
  let result: Record<string, number | boolean> | null = null;
  class Port {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    postMessage(data: Record<string, number | boolean>) {
      if ("onset" in data) onset = true;
      else result = data;
    }
  }
  class AudioWorkletProcessor {
    port = new Port();
  }
  let Processor: (new () => { process: (inputs: Float32Array[][]) => boolean; port: Port }) | null = null;
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", TURN_DETECTOR_SOURCE)(
    AudioWorkletProcessor,
    (_name: string, cls: typeof Processor) => (Processor = cls),
    rate,
  );
  const node = new (Processor as unknown as new () => { process: (inputs: Float32Array[][]) => boolean; port: Port })();
  // 300 ms of silence first (the noise floor), then the sound, then 1.2 s of silence.
  const lead = new Float32Array(Math.round(rate * 0.3));
  const tail = new Float32Array(Math.round(rate * 1.2));
  const all = new Float32Array(lead.length + samples.length + tail.length);
  all.set(lead);
  all.set(samples, lead.length);
  for (let i = 0; i < all.length; i += 128) {
    if (!node.process([[all.subarray(i, i + 128)]])) break;
  }
  return { onset, result };
}

function wav(path: string): { samples: Float32Array; rate: number } {
  const b = readFileSync(new URL(path, import.meta.url));
  let off = 12;
  let rate = 48000;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "fmt ") rate = b.readUInt32LE(off + 12);
    if (id === "data") {
      const data = b.subarray(off + 8, off + 8 + len);
      const samples = new Float32Array(data.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
      return { samples, rate };
    }
    off += 8 + len;
  }
  throw new Error("no data chunk");
}

test("speech is voiced; noise, a clatter and a fan are not, and do not hold her", () => {
  // A spoken question (test speaker) and one of her own VoxCPM2 replies.
  const question = wav("../docs/missions/live-voice-evidence/mic/a3.wav");
  const spoken = runDetector(question.samples, question.rate);
  assert.equal(spoken.result?.spoke, true);
  assert.ok(Number(spoken.result?.voicedMs) >= 300, `speech is voiced (${spoken.result?.voicedMs} ms)`);
  assert.equal(spoken.onset, true, "speech holds her");
  const hers = wav("../docs/missions/voice-evidence/audio/run1-voice-tts-01.wav");
  assert.ok(Number(runDetector(hers.samples, hers.rate).result?.voicedMs) >= 100, "a real voice clears the bar");

  // Loud noise: as loud as speech, but with no pitch in it.
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const rate = 48000;
  const white = new Float32Array(rate).map(() => 0.25 * random());
  let level = 0;
  const brown = new Float32Array(rate).map(() => (level = Math.max(-0.5, Math.min(0.5, level + 0.03 * random()))));
  for (const [name, noise] of [["white", white], ["brown", brown]] as const) {
    const heard = runDetector(noise, rate);
    assert.equal(heard.result?.spoke, true, `${name} noise is loud enough to be a turn by energy alone`);
    assert.ok(Number(heard.result?.voicedMs) < 100, `${name} noise is not voiced (${heard.result?.voicedMs} ms)`);
    assert.equal(heard.onset, false, `${name} noise does not hold her`);
  }
});

test("a bracketed aside is said as an aside, and a piece never starts with a bracket", () => {
  // From the live run: the reply's second piece was "(roughly 984 feet)."
  assert.equal(toSpokenText("About 300 meters tall (roughly 984 feet)."), "About three hundred meters tall, roughly nine hundred eighty-four feet,.".replace(",.", "."));
  assert.doesNotMatch(toSpokenText("(roughly 984 feet)."), /[()]/);
  assert.match(toSpokenText("≈1,063 feet"), /^about /);
  assert.equal(toSpokenText("Paris is the capital of France."), "Paris is the capital of France.");
});
