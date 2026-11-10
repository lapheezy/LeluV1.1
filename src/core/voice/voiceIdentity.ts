/**
 * ==========================================================
 * LÉLU — VOICE IDENTITY (shared, runtime-agnostic)
 *
 * The declaration of whose voice LÉLU speaks in, and the exact
 * recording it is derived from. Kept free of browser and Node
 * APIs deliberately: the server route must be able to import it
 * without pulling DOM types into the Node build, and the browser
 * adapter must be able to import it without reading the file.
 *
 * The recording itself is committed and never modified:
 *   public/audio/voice/lelu-voice-reference.m4a
 * ==========================================================
 */

export interface VoiceIdentity {
  id: string;
  /** Browser-accessible path (served from public/). */
  publicPath: string;
  /** Repository path, resolved from the app root. */
  repositoryPath: string;
  /** Verified transcript of the reference audio. VoxCPM2 needs it for prompt pairing. */
  promptTranscript: string;
  language: string;
  /** VoxCPM2 emits 48 kHz; declared so playback/resampling is not guessed. */
  outputSampleRate: number;
}

/**
 * Frozen: one session must never synthesise with a different
 * reference than the one it verified. Changing her voice means
 * changing this object deliberately, not drifting at runtime.
 *
 * The transcript is a machine transcription of the committed
 * recording (Whisper base + small agreed); see
 * docs/voice/MISSION_2_VOICE_IDENTITY_REPORT.md for how it was
 * obtained and which word remains uncertain. It is not a
 * hand-invented description of a voice.
 */
export const LELU_VOICE_IDENTITY: Readonly<VoiceIdentity> = Object.freeze({
  id: "lelu-reference-v1",
  publicPath: "/audio/voice/lelu-voice-reference.m4a",
  repositoryPath: "public/audio/voice/lelu-voice-reference.m4a",
  promptTranscript:
    "To bring them tribute from the temple to guide them here. My only wish is to serve the gods. " +
    "Before the High Priest, honey, you're gonna need it. Oh no, don't worry about me, boys. " +
    "My only wish is to serve the gods. Remember? Well, if you guys want the gold and you don't want " +
    "to get caught, right? You're going to need my help. Are you serious? I want it in on this game " +
    "so I can get out. So when you guys are ready to go back to where you came from... Deal. " +
    "Then I suppose that means you'll want these back.",
  language: "en",
  outputSampleRate: 48_000,
});
