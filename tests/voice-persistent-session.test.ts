/**
 * ==========================================================
 * LÉLU — THE VOICE SESSION PERSISTS, RECOVERS, AND LETS GO (M22.9)
 *
 * CATEGORY: unit. The real VoiceEngine against fake browser primitives:
 * a MediaStreamTrack that can end, mute and be stopped; a getUserMedia the
 * test controls (delay, deny, no device, busy); a document whose visibility
 * the test flips; a SpeechRecognition stub the test drives; a
 * speechSynthesis that plays on timers. No audio device, no network.
 *
 * What these tests pin down (each was a real defect before M22.9-PR):
 *   - a microphone track that ENDED under a live session left `active: true`,
 *     phase "listening" and a dead stream — the UI claimed she was listening;
 *   - a second tap while the permission prompt was open opened a SECOND
 *     stream, and a stop during the prompt leaked the stream that arrived;
 *   - no page-lifecycle handling at all (hidden tab, pagehide, revoked
 *     permission);
 *   - a streamed sentence whose synthesis failed vanished silently.
 *
 * A simulated microphone cannot prove a physical one works; this file proves
 * the engine's lifecycle logic, nothing more.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

/* ------------------------------ fakes --------------------------------- */

class FakeTrack extends EventTarget {
  kind = "audio";
  readyState: "live" | "ended" = "live";
  stops = 0;
  stop() {
    this.stops += 1;
    this.readyState = "ended";
  }
  /** What the browser does when the device goes away or access is revoked. */
  endFromPlatform() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

type MicMode = "grant" | "deny" | "no-device" | "busy";
const micPlan: MicMode[] = [];
let micDelayMs = 0;
const streams: FakeStream[] = [];
let micRequests = 0;

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

async function getUserMedia(): Promise<FakeStream> {
  micRequests += 1;
  const mode = micPlan.shift() ?? "grant";
  if (micDelayMs) await new Promise((resolve) => setTimeout(resolve, micDelayMs));
  if (mode === "deny") throw domError("NotAllowedError");
  if (mode === "no-device") throw domError("NotFoundError");
  if (mode === "busy") throw domError("NotReadableError");
  const stream = new FakeStream();
  streams.push(stream);
  return stream;
}

const recognizers: FakeRecognition[] = [];
class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  aborted = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  constructor() {
    recognizers.push(this);
  }
  start() {
    this.onstart?.();
  }
  abort() {
    this.aborted = true;
  }
  hear(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: text } }] });
  }
}

class FakeUtterance extends EventTarget {
  voice: unknown = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event & { error?: string }) => void) | null = null;
  onboundary: unknown = null;
  constructor(public text: string) {
    super();
  }
}
let playing: FakeUtterance[] = [];
const spokenByBrowser: string[] = [];
const fakeSynth = {
  speak(utterance: FakeUtterance) {
    playing.push(utterance);
    spokenByBrowser.push(utterance.text);
    setTimeout(() => {
      if (!playing.includes(utterance)) return;
      utterance.dispatchEvent(new Event("start"));
      setTimeout(() => {
        if (!playing.includes(utterance)) return;
        playing = playing.filter((item) => item !== utterance);
        const end = new Event("end");
        utterance.dispatchEvent(end);
        utterance.onend?.(end);
      }, 40);
    }, 1);
  },
  cancel() {
    playing = [];
  },
  getVoices: () => [{ name: "Test", voiceURI: "test", lang: "en-US", localService: true }],
};

class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  setVisible(visible: boolean) {
    this.visibilityState = visible ? "visible" : "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
const fakeDocument = new FakeDocument();
const fakeWindow = new EventTarget();

class FakePermissionStatus extends EventTarget {
  state: "granted" | "denied" | "prompt" = "granted";
  revoke() {
    this.state = "denied";
    this.dispatchEvent(new Event("change"));
  }
}
const micPermission = new FakePermissionStatus();

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.addEventListener = fakeWindow.addEventListener.bind(fakeWindow);
g.removeEventListener = fakeWindow.removeEventListener.bind(fakeWindow);
g.document = fakeDocument;
// With a `document` present, the Supabase auth client (loaded with the app
// when a session stops and the in-flight turn is cancelled) believes it is in
// a browser and opens a cross-tab BroadcastChannel that keeps Node alive.
// The engine does not use it; the test environment removes it.
g.BroadcastChannel = undefined;
g.SpeechSynthesisUtterance = FakeUtterance;
g.speechSynthesis = fakeSynth;
g.SpeechRecognition = FakeRecognition;
g.isSecureContext = true;
Object.defineProperty(globalThis, "navigator", {
  value: {
    mediaDevices: { getUserMedia, enumerateDevices: async () => [] },
    permissions: { query: async () => micPermission },
    userAgent: "test",
  },
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
// Her server voice is "configured" but every synthesis fails (for the
// streamed-failure test); STT and LiveKit are not configured, so the
// session uses the (fake) browser recognizer.
let ttsRequests = 0;
g.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/voice/status")) {
    return new Response(JSON.stringify({ configured: true, stt: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/api/voice/tts")) {
    ttsRequests += 1;
    return new Response("synthesis failed", { status: 500 });
  }
  return new Response("{}", { status: 404 });
};

const { default: VoiceEngine } = await import("../src/core/voice/VoiceEngine");
const engine = VoiceEngine.getInstance();
(VoiceEngine as unknown as { RECOVERY_DELAYS_MS: number[] }).RECOVERY_DELAYS_MS = [0, 20, 40];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const diag = () => engine.getDiagnostics();

async function startSession(): Promise<void> {
  await engine.toggle();
  assert.equal(engine.getState().active, true, "session started");
}

async function endSession(): Promise<void> {
  if (engine.getState().active) await engine.toggle();
  await wait(5);
}

/* ------------------------------- tests -------------------------------- */

test("a started session holds exactly one live microphone stream and is listening", async () => {
  await startSession();
  assert.equal(engine.getState().phase, "listening");
  assert.equal(diag().micStreamsOpen, 1);
  assert.equal(diag().micStreamActive, true);
  assert.ok(recognizers.at(-1) && !recognizers.at(-1)!.aborted, "the recognizer is running");
  await endSession();
  assert.equal(diag().micStreamsOpen, 0);
  assert.equal(diag().micStreamActive, false, "the diagnostic no longer claims a live stream after stop");
  assert.equal(streams.at(-1)!.tracks[0].readyState, "ended", "the track was stopped");
});

test("20 start/stop cycles: no stream, recognizer or lifecycle listener accumulates", async () => {
  const before = { acquired: diag().micStreamsAcquired, released: diag().micStreamsReleased, listeners: diag().lifecycleListeners };
  const recognizersBefore = recognizers.length;
  for (let i = 0; i < 20; i += 1) {
    await startSession();
    await endSession();
  }
  assert.equal(diag().micStreamsAcquired - before.acquired, 20);
  assert.equal(diag().micStreamsReleased - before.released, 20);
  assert.equal(diag().micStreamsOpen, 0);
  assert.equal(diag().lifecycleListeners, before.listeners, "lifecycle listeners are bound once, not per session");
  assert.ok(recognizers.slice(recognizersBefore).every((recognizer) => recognizer.aborted), "every recognizer was released");
  assert.ok(streams.every((stream) => stream.tracks.every((track) => track.readyState === "ended")), "every track stopped");
});

test("a second tap while the session is still opening stops it; no stream is opened or kept", async () => {
  // Tap twice before the first tap's provider probe has answered.
  const requestsBefore = micRequests;
  const first = engine.toggle();
  const second = engine.toggle();
  await Promise.all([first, second]);
  await wait(20);
  assert.equal(micRequests - requestsBefore, 0, "the second tap stopped the session before the microphone was requested");
  assert.equal(engine.getState().active, false);
  assert.equal(diag().micStreamsOpen, 0);
});

test("a tap while the permission prompt is open stops; the late stream is released, never adopted", async () => {
  micDelayMs = 60;
  try {
    const requestsBefore = micRequests;
    const first = engine.toggle();
    await wait(20); // the prompt is open now
    assert.equal(micRequests - requestsBefore, 1, "the microphone was requested once");
    await engine.toggle(); // user taps again before answering the prompt
    await first;
    await wait(10);
    assert.equal(micRequests - requestsBefore, 1, "no second request");
    assert.equal(engine.getState().active, false, "the session the user closed stays closed");
    assert.equal(diag().micStreamsOpen, 0, "the stream that arrived late was released");
    assert.equal(streams.at(-1)!.tracks[0].readyState, "ended");
  } finally {
    micDelayMs = 0;
  }
});

test("permission denied at start: honest error, no session, nothing held", async () => {
  micPlan.push("deny");
  const requests = micRequests;
  await engine.toggle();
  assert.equal(micRequests - requests, 1, "a denial is not answered with a second permission prompt");
  assert.equal(engine.getState().active, false);
  assert.equal(engine.getState().errorKind, "permission");
  assert.equal(engine.getState().permission, "denied");
  assert.equal(diag().micStreamsOpen, 0);
});

test("no microphone at start: reported as no-device, not as a permission problem", async () => {
  micPlan.push("no-device");
  await engine.toggle();
  assert.equal(engine.getState().active, false);
  assert.equal(engine.getState().errorKind, "no-device");
});

test("the microphone ends mid-session (device unplugged): re-acquired, ears restarted, same session", async () => {
  await startSession();
  const recognizersBefore = recognizers.length;
  const lost = streams.at(-1)!;
  lost.tracks[0].endFromPlatform();
  await wait(20);
  assert.equal(engine.getState().active, true, "the session survived");
  assert.equal(engine.getState().captureSuspended, false);
  assert.equal(engine.getState().phase, "listening");
  assert.equal(diag().captureRecoveries, 1);
  assert.equal(diag().micStreamsOpen, 1, "exactly one stream after recovery");
  assert.notEqual(streams.at(-1), lost, "a NEW stream is held");
  assert.ok(recognizers.length > recognizersBefore, "the recognizer was restarted on the new stream");
  await endSession();
});

test("the microphone ends and cannot come back (permission revoked): session ends with the reason", async () => {
  await startSession();
  micPlan.push("deny");
  streams.at(-1)!.tracks[0].endFromPlatform();
  await wait(20);
  assert.equal(engine.getState().active, false, "no silent dead 'listening'");
  assert.equal(engine.getState().errorKind, "permission");
  assert.equal(diag().micStreamsOpen, 0);
});

test("a busy microphone (a phone call holds it) is waited out, then recovered", async () => {
  await startSession();
  micPlan.push("busy", "busy");
  streams.at(-1)!.tracks[0].endFromPlatform();
  await wait(10);
  assert.equal(engine.getState().captureSuspended, true, "while it waits, it does not claim to listen");
  assert.notEqual(engine.getState().phase, "listening");
  await wait(120);
  assert.equal(engine.getState().active, true);
  assert.equal(engine.getState().captureSuspended, false);
  assert.equal(engine.getState().phase, "listening");
  assert.equal(diag().micStreamsOpen, 1);
  await endSession();
});

test("a busy microphone that never frees ends the session honestly", async () => {
  await startSession();
  micPlan.push("busy", "busy", "busy");
  streams.at(-1)!.tracks[0].endFromPlatform();
  await wait(150);
  assert.equal(engine.getState().active, false);
  assert.equal(engine.getState().errorKind, "audio");
  assert.equal(diag().micStreamsOpen, 0);
});

test("a hidden page that loses the microphone waits, then recovers when it is visible again", async () => {
  await startSession();
  fakeDocument.setVisible(false);
  streams.at(-1)!.tracks[0].endFromPlatform();
  await wait(20);
  const requestsWhileHidden = micRequests;
  assert.equal(engine.getState().active, true, "the user's session intent is kept");
  assert.equal(engine.getState().captureSuspended, true);
  assert.equal(engine.getState().phase, "idle", "not 'listening' with no microphone");
  await wait(20);
  assert.equal(micRequests, requestsWhileHidden, "no re-acquire is attempted from a hidden page");
  fakeDocument.setVisible(true);
  await wait(20);
  assert.equal(engine.getState().captureSuspended, false);
  assert.equal(engine.getState().phase, "listening");
  assert.equal(diag().micStreamsOpen, 1);
  await endSession();
});

test("returning to a visible page restarts a recognizer the browser stopped", async () => {
  await startSession();
  const recognizer = recognizers.at(-1)!;
  const internals = engine as unknown as { recognitionRunning: boolean };
  let restarted = 0;
  const originalStart = recognizer.start.bind(recognizer);
  recognizer.start = () => {
    restarted += 1;
    originalStart();
  };
  fakeDocument.setVisible(false);
  internals.recognitionRunning = false; // the browser aborted it in the background
  fakeDocument.setVisible(true);
  assert.equal(restarted, 1);
  await endSession();
});

test("pagehide releases the microphone; nothing turns it back on by itself", async () => {
  await startSession();
  fakeWindow.dispatchEvent(new Event("pagehide"));
  await wait(5);
  assert.equal(engine.getState().active, false);
  assert.equal(diag().micStreamsOpen, 0);
  const requests = micRequests;
  fakeDocument.setVisible(false);
  fakeDocument.setVisible(true);
  await wait(10);
  assert.equal(micRequests, requests, "a returning page does not re-open the microphone without a tap");
});

test("permission revoked in site settings mid-session ends the session as a permission error", async () => {
  await startSession();
  micPermission.revoke();
  await wait(5);
  assert.equal(engine.getState().active, false);
  assert.equal(engine.getState().errorKind, "permission");
  assert.equal(diag().micStreamsOpen, 0);
  micPermission.state = "granted";
});

test("speech that ends while the microphone is suspended does not claim 'listening'", async () => {
  await startSession();
  fakeDocument.setVisible(false);
  streams.at(-1)!.tracks[0].endFromPlatform();
  await wait(5);
  const internals = engine as unknown as { elevenLabs: boolean; elevenLabsSettled: boolean };
  internals.elevenLabs = false;
  internals.elevenLabsSettled = true;
  engine.speakResponse("Short reply.");
  await wait(80);
  assert.equal(engine.isSpeaking(), false);
  assert.equal(engine.getState().phase, "idle");
  fakeDocument.setVisible(true);
  await wait(20);
  assert.equal(engine.getState().phase, "listening");
  await endSession();
});

test("repeated barge-in: each time the user talks over her she stops, and the session keeps listening", async () => {
  await startSession();
  const internals = engine as unknown as { elevenLabs: boolean; elevenLabsSettled: boolean };
  internals.elevenLabs = false;
  internals.elevenLabsSettled = true;
  const before = engine.getBargeInCount();
  for (let i = 0; i < 3; i += 1) {
    engine.speakResponse(`This is a long answer number ${i} that she is in the middle of saying right now.`);
    await wait(5);
    assert.equal(engine.isSpeaking(), true, `she is speaking (round ${i})`);
    recognizers.at(-1)!.hear(`hold on wait ${i}`);
    assert.equal(engine.isSpeaking(), false, `she stopped (round ${i})`);
    assert.equal(engine.getState().phase, "listening");
    assert.equal(engine.getState().active, true);
  }
  assert.equal(engine.getBargeInCount() - before, 3);
  assert.equal(diag().micStreamsOpen, 1, "barge-in never re-opens the microphone");
  await endSession();
});

test("a streamed sentence her voice cannot produce is reported and handed to the browser voice", async () => {
  const internals = engine as unknown as { elevenLabs: boolean; elevenLabsSettled: boolean; elevenLabsProbe: unknown };
  internals.elevenLabs = true;
  internals.elevenLabsSettled = true;
  internals.elevenLabsProbe = Promise.resolve();
  const owner = engine.beginStreamingSpeech();
  engine.feedStreamingSpeech("The first sentence fails on the server. ", owner);
  engine.finishStreamingSpeech("The first sentence fails on the server. ", owner);
  await wait(120);
  assert.ok(ttsRequests >= 1, "her server voice was asked");
  assert.equal(engine.getState().turnFailure?.kind, "playback-failure", "the failure is reported, not silent");
  assert.ok(spokenByBrowser.includes("The first sentence fails on the server."), "the browser voice said it instead");
  assert.notEqual(engine.getState().phase, "speaking", "the phase is not stuck in 'speaking'");
});

test("a streamed markdown block with no sentence punctuation is split, never sent as one oversized request", async () => {
  // Live M22.9 run: "Here's a quick overview:\n\n**Key Facts:**\n- Population: …"
  // arrived as one >900-character segment and the speech server refused it (413).
  const internals = engine as unknown as { elevenLabs: boolean; elevenLabsSettled: boolean };
  internals.elevenLabs = false;
  internals.elevenLabsSettled = true;
  const before = spokenByBrowser.length;
  const lines = ["Here's a quick overview:", "", "**Key Facts:**"];
  for (let i = 0; i < 30; i += 1) lines.push(`- Item number ${i} has a fairly long description without any full stop in it`);
  // One full stop at the very end: before the fix the sentence regex took the
  // whole block up to it as ONE segment.
  const text = `${lines.join("\n")}. Done.`;
  const owner = engine.beginStreamingSpeech();
  engine.feedStreamingSpeech(text, owner);
  engine.finishStreamingSpeech(text, owner);
  const sent = spokenByBrowser.slice(before);
  assert.ok(sent.length >= 30, `split per line (${sent.length} segments)`);
  assert.ok(sent.every((segment) => segment.length <= 200), "no segment exceeds the speech chunk size");
  engine.cancelSpeech();
  await wait(60);
});

test("a late 'playing' event from a superseded turn is not credited to the new turn", () => {
  const internals = engine as unknown as {
    turnLatency: { turnId: string; transcriptAt: number; firstTextAt: number | null; firstAudioAt: number | null; firstAudibleAt: number | null } | null;
    noteAudible: (owner?: unknown) => void;
    noteFirstAudio: (owner?: unknown) => void;
  };
  const old = { turnId: "old", transcriptAt: Date.now() - 5000, firstTextAt: null, firstAudioAt: null, firstAudibleAt: null };
  const current = { turnId: "new", transcriptAt: Date.now(), firstTextAt: null, firstAudioAt: null, firstAudibleAt: null };
  internals.turnLatency = current;
  internals.noteAudible(old);
  internals.noteFirstAudio(old);
  assert.equal(current.firstAudibleAt, null);
  assert.equal(current.firstAudioAt, null);
  internals.noteAudible(current);
  assert.notEqual(current.firstAudibleAt, null, "the turn's own audio is recorded");
  internals.turnLatency = null;
});

test("a remounting component starts from the engine's current turn", () => {
  assert.equal(typeof engine.getTurn, "function");
  assert.equal(engine.getTurn(), null, "after a stop the turn is cleared, and getTurn says so");
});

test.after(() => {
  engine.disposeLifecycle();
});
