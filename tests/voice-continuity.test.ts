/**
 * ==========================================================
 * LÉLU — THE VOICE LOOP STAYS TRUE: SPEAKS, STOPS, HEARS, RESUMES
 *
 * CATEGORY: unit. The real VoiceEngine against fake browser speech
 * engines (speechSynthesis plays queued utterances on timers and fires
 * start / boundary / end like Chrome; SpeechRecognition is a stub the
 * test drives). No audio, no network.
 *
 * Measured before these fixes, by reading the engine's own state:
 *   - A streamed reply (every typed AND spoken reply streams) set the
 *     phase to "speaking" and nothing ever set it back.
 *   - Streamed speech never recorded what was said, so the echo check
 *     compared the mic against "" — her own voice could come back as a
 *     user turn.
 *   - "Barge-in" was claimed in the header; nothing cancelled speech when
 *     the user talked over her.
 *   - The recognizer restarted only if it ended while "listening"; one
 *     that ended while she thought or spoke stayed dead for the session.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

/* ------------------------------ fakes --------------------------------- */

class FakeUtterance extends EventTarget {
  voice: unknown = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event & { error?: string }) => void) | null = null;
  constructor(public text: string) {
    super();
  }
}

const spoken: string[] = [];
let playing: FakeUtterance[] = [];
let cancels = 0;
const fakeSynth = {
  speak(utterance: FakeUtterance) {
    playing.push(utterance);
    spoken.push(utterance.text);
    setTimeout(() => {
      if (!playing.includes(utterance)) return;
      utterance.dispatchEvent(new Event("start"));
      const boundary = Object.assign(new Event("boundary"), { name: "word", charIndex: 0 });
      utterance.dispatchEvent(boundary);
      setTimeout(() => {
        if (!playing.includes(utterance)) return;
        playing = playing.filter((item) => item !== utterance);
        const end = new Event("end");
        utterance.dispatchEvent(end);
        utterance.onend?.(end);
      }, 5);
    }, 1);
  },
  cancel() {
    cancels += 1;
    playing = [];
  },
  getVoices: () => [],
};

let recognizer: FakeRecognition | null = null;
let recognitionStarts = 0;
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() {
    recognizer = this;
  }
  start() {
    recognitionStarts += 1;
    this.onstart?.();
  }
  abort() {}
  /** What the browser does: deliver one interim result. */
  hear(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text } }] });
  }
}

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.SpeechSynthesisUtterance = FakeUtterance;
g.speechSynthesis = fakeSynth;
g.SpeechRecognition = FakeRecognition;
g.isSecureContext = true;
Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, userAgent: "test" },
  configurable: true,
});
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  g.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => {},
    get length() { return Object.keys(store).length; },
    key: () => null,
  };
}
g.fetch = async () => new Response("{}", { status: 404 });

const { default: VoiceEngine, isBargeIn } = await import("../src/core/voice/VoiceEngine");
const engine = VoiceEngine.getInstance();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const internals = engine as unknown as { lastSpokenText: string; _state: { phase: string; active: boolean } };

/* ------------------------------- tests -------------------------------- */

test("a streamed reply ends in 'listening'/'idle', never stuck in 'speaking'", async () => {
  const activity: string[] = [];
  const off = engine.onSpeechActivity((event) => activity.push(`${event.kind}:${event.speaking}`));
  engine.beginStreamingSpeech();
  assert.equal(engine.getState().phase, "speaking");
  engine.feedStreamingSpeech("Hello there. How are");
  engine.finishStreamingSpeech("Hello there. How are you today?");
  assert.equal(engine.isSpeaking(), true, "audio is queued");
  await wait(60);
  assert.equal(engine.isSpeaking(), false);
  assert.equal(engine.getState().phase, "idle", "voice session inactive → idle, not 'speaking'");
  assert.deepEqual(spoken.slice(-2), ["Hello there.", "How are you today?"]);
  assert.ok(activity.includes("start:true") && activity.includes("word:true"), "the avatar sees real start and word boundaries");
  assert.equal(activity.at(-1), "end:false", "and the real end");
  off();
});

test("a streamed reply records what she said, so the echo check works", () => {
  assert.equal(internals.lastSpokenText, "Hello there. How are you today?");
});

test("a reply with nothing left to say still settles", async () => {
  engine.beginStreamingSpeech();
  engine.finishStreamingSpeech("");
  await wait(5);
  assert.notEqual(engine.getState().phase, "speaking");
});

test("barge-in: the user talking over her stops her; her own echo does not", async () => {
  assert.equal(isBargeIn("wait stop", "Here is the full weather report for today."), true);
  assert.equal(isBargeIn("weather report for today", "Here is the full weather report for today."), false, "echo");
  assert.equal(isBargeIn("um", "anything"), false, "one word is not an interruption");

  await engine.toggle(); // start a voice session (fake mic + recognizer)
  assert.equal(engine.getState().active, true);
  assert.ok(recognizer, "recognizer started");

  engine.speakResponse("Here is the full weather report for today. It will be sunny with light wind.");
  await wait(2);
  assert.equal(engine.isSpeaking(), true);

  const cancelsBefore = cancels;
  recognizer!.hear("weather report for today"); // her own voice through the mic
  assert.equal(cancels, cancelsBefore, "echo does not interrupt");
  assert.equal(engine.isSpeaking(), true);

  recognizer!.hear("hold on a second");
  assert.equal(cancels, cancelsBefore + 1, "the user's words stop her speech");
  assert.equal(engine.isSpeaking(), false);
  assert.equal(engine.getBargeInCount(), 1);
  assert.equal(engine.getState().phase, "listening", "and she is listening again");
});

test("a recognizer that ends mid-reply is restarted — the session keeps hearing", async () => {
  internals._state = { ...engine.getState(), phase: "processing" } as typeof internals._state;
  const before = recognitionStarts;
  recognizer!.onend?.();
  await wait(300);
  assert.equal(recognitionStarts, before + 1, "restarted although the phase was not 'listening'");

  await engine.toggle(); // stop the session
  const afterStop = recognitionStarts;
  recognizer?.onend?.();
  await wait(300);
  assert.equal(recognitionStarts, afterStop, "a stopped session is not restarted");
});
