/**
 * Logic verification for the LÉLU VoiceEngine.
 *
 * Browser APIs (SpeechRecognition / speechSynthesis / getUserMedia)
 * do not exist in this sandbox, so this verifies the framework-free
 * core: singleton identity, echo prevention, speech chunking, and
 * graceful degradation when voice is unsupported — the engine must
 * report a safe error, never throw, and keep the app alive.
 */

import assert from "node:assert/strict";
import {
  encodeWav,
  mediaRecorderSupported,
  pickRecorderMimeType,
  wavCaptureSupported,
} from "../src/core/voice/audioRecorder";
import {
  buildTranscriptionForm,
  mapMediaError,
  mapSttHttpError,
  parseTranscriptionResponse,
} from "../src/core/voice/speechToText";
import VoiceEngine, {
  chunkForSpeech,
  isEchoUtterance,
  mapRecognitionError,
} from "../src/core/voice/VoiceEngine";

/**
 * Every call site MUST `await` this.
 *
 * These checks share ONE VoiceEngine singleton. When the async checks
 * were fired without await, they became floating promises: an async
 * check would suspend at `await engine.start()`, a LATER synchronous
 * check would call `engine.stop()` on the same singleton (clearing
 * `error`/phase), and the suspended assertion would then read state
 * that a different test had already reset — producing a failure that
 * looked flaky but was deterministic test interleaving, not a
 * VoiceEngine bug. Sequential execution removes the race without
 * weakening a single assertion.
 */
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

console.log("1. Singleton identity");
await check("getInstance is stable", () => {
  assert.equal(VoiceEngine.getInstance(), VoiceEngine.getInstance());
});

console.log("2. Echo prevention (LÉLU's voice must never become a user message)");
await check("identical TTS text is echo", () => {
  assert.equal(isEchoUtterance("Hello there, how can I help you today?", "Hello there, how can I help you today?"), true);
});
await check("substring of TTS text is echo", () => {
  assert.equal(isEchoUtterance("how can I help", "Hello there, how can I help you today?"), true);
});
await check("TTS text containing the utterance is echo", () => {
  assert.equal(isEchoUtterance("I remember you said you like coffee", "Yes, I remember you said you like coffee"), true);
});
await check("tiny fragments are echo", () => {
  assert.equal(isEchoUtterance("the", "The Genesis core is evolving"), true);
});
await check("high token overlap is echo", () => {
  assert.equal(isEchoUtterance("Lélu is a companion with memory", "Lélu is a companion with memory and identity"), true);
});
await check("genuine user speech is NOT echo", () => {
  assert.equal(isEchoUtterance("What is the weather in Tampa today?", "The Genesis core is a living simulation"), false);
});
await check("barge-in with different topic is NOT echo", () => {
  assert.equal(isEchoUtterance("Stop, I need to ask you something important", "Lélu is a companion with memory and identity"), false);
});

console.log("3. TTS chunking");
await check("short text stays one chunk", () => {
  assert.deepEqual(chunkForSpeech("Hello there."), ["Hello there."]);
});
await check("sentences split into ~200-char chunks", () => {
  const long = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} has some words in it.`).join(" ");
  const chunks = chunkForSpeech(long);
  assert.ok(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 220, `chunk too long: ${chunk.length}`);
    assert.ok(chunk.length > 0, "chunk must not be empty");
  }
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), long);
});
await check("very long single word gets hard-split", () => {
  const chunks = chunkForSpeech("a".repeat(600));
  assert.ok(chunks.length >= 3);
});
await check("empty text yields no chunks", () => {
  assert.deepEqual(chunkForSpeech(""), []);
});

console.log("4. Recognition error mapping (never blame permission for audio/service failures)");
await check("true permission denial maps to permission", () => {
  assert.equal(mapRecognitionError("not-allowed")?.kind, "permission");
  assert.equal(mapRecognitionError("permission-denied")?.kind, "permission");
});
await check("audio-capture (AVAudioSession-style failure) is NOT permission", () => {
  const mapped = mapRecognitionError("audio-capture");
  assert.ok(mapped, "audio-capture must map to a diagnosis");
  assert.equal(mapped.kind, "audio");
  assert.ok(!mapped.message.includes("permission"), "message must not claim permission is denied");
});
await check("service-not-allowed (dictation service off) is NOT permission", () => {
  const mapped = mapRecognitionError("service-not-allowed");
  assert.ok(mapped);
  assert.equal(mapped.kind, "service");
  assert.ok(!mapped.message.includes("denied"), "message must not claim the mic permission was denied");
});
await check("busy maps to audio, not permission", () => {
  assert.equal(mapRecognitionError("busy")?.kind, "audio");
});
await check("network maps to offline", () => {
  assert.equal(mapRecognitionError("network")?.kind, "offline");
});
await check("language-not-supported maps to a generic error", () => {
  assert.equal(mapRecognitionError("language-not-supported")?.kind, "error");
});
await check("no-speech and aborted are not failures", () => {
  assert.equal(mapRecognitionError("no-speech"), null);
  assert.equal(mapRecognitionError("aborted"), null);
});
await check("unknown codes map to a generic error", () => {
  assert.equal(mapRecognitionError("some-weird-code")?.kind, "error");
});

console.log("5. Capabilities are reported separately from permission");
await check("getCapabilities works without a browser", () => {
  const caps = VoiceEngine.getInstance().getCapabilities();
  assert.equal(caps.recognition, "unsupported");
  assert.equal(caps.tts, false);
  assert.ok(["granted", "denied", "prompt", "unknown"].includes(caps.micPermission));
});
await check("speakResponse never throws without TTS", () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  engine.speakResponse("Hello from the test.");
  engine.speakResponse("");
  assert.ok(true);
});

console.log("6. Graceful degradation without browser APIs");
await check("start() without recognition reports a safe error, never throws", async () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  await engine.start();
  const state = engine.getState();
  assert.equal(state.active, false);
  assert.ok(state.error && state.error.length > 0, "expected a safe error message");
});
await check("stop() is idempotent", () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  engine.stop();
  const state = engine.getState();
  assert.equal(state.active, false);
  assert.equal(state.phase, "idle");
});
await check("toggle() after unsupported start leaves the engine idle", async () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  await engine.toggle();
  assert.equal(engine.getState().phase, "idle");
});
await check("isSupported() is false in a non-browser runtime", () => {
  assert.equal(VoiceEngine.getInstance().isSupported(), false);
});

console.log("7. Crash containment — a throwing listener can never take down the app");
await check("throwing state/error listeners never propagate out of the engine", async () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  const boom = () => {
    throw new Error("listener exploded");
  };
  const unsubState = engine.onStateChange(boom);
  const unsubError = engine.onError(boom);
  const unsubDiag = engine.onDiagnostics(boom);
  try {
    // start() calls setError + emitState internally (unsupported browser);
    // if containment failed, this would reject with the listener's error.
    await engine.start();
    engine.speakResponse("containment test");
    engine.stop();
    assert.ok(true, "listener throws were contained");
  } finally {
    unsubState();
    unsubError();
    unsubDiag();
  }
});
await check("error state is still set after a throwing listener", async () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  const boom = () => {
    throw new Error("listener exploded");
  };
  const unsubError = engine.onError(boom);
  try {
    await engine.start();
    assert.ok(engine.getState().error, "error message survives containment");
  } finally {
    unsubError();
  }
});

console.log("8. Voice diagnostics mirror the real pipeline");
await check("getDiagnostics exposes the full safe shape", () => {
  const diag = VoiceEngine.getInstance().getDiagnostics();
  assert.equal(typeof diag.micPermission, "string");
  assert.equal(typeof diag.recognitionSupported, "boolean");
  assert.equal(typeof diag.ttsAvailable, "boolean");
  assert.equal(typeof diag.micStreamActive, "boolean");
  assert.equal(typeof diag.recognitionActive, "boolean");
  assert.equal(typeof diag.transcriptReceived, "boolean");
  assert.equal(typeof diag.responseReceived, "boolean");
  assert.equal(typeof diag.ttsRequested, "boolean");
  assert.equal(typeof diag.audioGenerated, "boolean");
  assert.equal(typeof diag.audioPlaying, "boolean");
  assert.ok(["idle", "requested", "generated", "playing", "ended", "failed"].includes(diag.ttsStage));
});
await check("speakResponse records response + TTS outcome in diagnostics", () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  engine.speakResponse("Say this aloud.");
  const diag = engine.getDiagnostics();
  assert.equal(diag.responseReceived, true);
  // No TTS in this runtime — the stage must say failed, never "playing",
  // and nothing was ever requested of a provider that does not exist.
  assert.equal(diag.ttsStage, "failed");
  assert.equal(diag.ttsRequested, false);
});
await check("diagnostics listeners receive updates", () => {
  const engine = VoiceEngine.getInstance();
  engine.stop();
  let seen: unknown = null;
  const unsub = engine.onDiagnostics((diag) => {
    seen = diag;
  });
  try {
    engine.speakResponse("Update me.");
    assert.ok(seen !== null, "diagnostics listener fired");
  } finally {
    unsub();
  }
});
await check("start() twice while inactive cannot double-activate the session", async () => {
  // In this non-browser runtime start() short-circuits at the capability
  // check; the important contract is that a second call cannot create a
  // second stream or recorder (guarded by this.active).
  const engine = VoiceEngine.getInstance();
  engine.stop();
  await engine.start();
  await engine.start();
  assert.equal(engine.getState().active, false);
  assert.equal(engine.getState().phase, "idle");
});

console.log("9. Audio recording helpers (real mic capture, not SpeechRecognition)");
await check("recorder support is correctly reported without a browser", () => {
  assert.equal(mediaRecorderSupported(), false);
  assert.equal(wavCaptureSupported(), false);
});
await check("pickRecorderMimeType returns empty without MediaRecorder", () => {
  assert.equal(pickRecorderMimeType(), "");
});
await check("encodeWav produces a valid mono 16-bit PCM WAV header", async () => {
  const channels = [new Float32Array([0, 0.5, -0.5, 1, -1, 0])];
  const blob = encodeWav(channels, 48000);
  assert.equal(blob.type, "audio/wav");
  assert.ok(blob.size > 44, "WAV must include the 44-byte header + samples");
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const ascii = (offset: number, length: number) => {
    let out = "";
    for (let index = 0; index < length; index += 1) {
      out += String.fromCharCode(view.getUint8(offset + index));
    }
    return out;
  };
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(ascii(12, 4), "fmt ");
  assert.equal(ascii(36, 4), "data");
  assert.equal(view.getUint16(20, true), 1, "PCM format");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 48000, "sample rate");
  assert.equal(view.getUint16(34, true), 16, "16-bit samples");
  assert.equal(view.getUint32(40, true), 6 * 2, "data chunk size = samples × 2 bytes");
});
await check("encodeWav handles empty input without throwing", () => {
  const blob = encodeWav([], 48000);
  assert.equal(blob.size, 0);
});

console.log("10. Speech-to-text helpers (Groq Whisper, no browser dependency)");
await check("buildTranscriptionForm appends file and model", () => {
  const form = buildTranscriptionForm(new Blob(["audio"], { type: "audio/webm" }), "whisper-large-v3");
  assert.ok(form.has("file"));
  assert.equal(form.get("model"), "whisper-large-v3");
});
await check("parseTranscriptionResponse extracts the transcript", () => {
  assert.equal(parseTranscriptionResponse({ text: "  hello there  " }), "hello there");
});
await check("parseTranscriptionResponse throws when no transcript exists", () => {
  assert.throws(() => parseTranscriptionResponse({ foo: "bar" }));
  assert.throws(() => parseTranscriptionResponse(null));
});
await check("mapSttHttpError distinguishes auth, credits, rate limit, and generic", () => {
  assert.equal(mapSttHttpError(401).kind, "permission");
  assert.equal(mapSttHttpError(402).kind, "service");
  assert.equal(mapSttHttpError(429).kind, "service");
  assert.equal(mapSttHttpError(500).kind, "error");
});
await check("mapMediaError never blames permission for hardware/embed failures", () => {
  assert.equal(mapMediaError({ name: "NotAllowedError" }).kind, "permission");
  assert.equal(mapMediaError({ name: "NotFoundError" }).kind, "no-device");
  assert.equal(mapMediaError({ name: "NotReadableError" }).kind, "audio");
  assert.equal(mapMediaError({ name: "TrackStartError" }).kind, "audio");
  assert.equal(mapMediaError({ name: "SecurityError" }).kind, "blocked-embed");
  assert.equal(mapMediaError({ name: "WeirdError" }).kind, "error");
});

console.log("Done.");
