/**
 * ==========================================================
 * LÉLU — VOICE STUDIO
 *
 * Voice is where it is easiest to lie: a browser always has *some*
 * speech synthesis, so a panel can look alive while the real
 * pipeline (Whisper → VAD → Kokoro over Pipecat) is absent.
 *
 * This panel therefore separates three things and never merges
 * them:
 *   1. the SERVER adapters and their real configured state;
 *   2. the DEVICE's own capabilities (capture devices, voices,
 *      permission), read from the browser;
 *   3. what has been MEASURED — which is nothing until samples
 *      exist, so latency says "no samples".
 *
 * Nothing here displays a latency figure that was not measured on
 * this device.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import GenesisWindowFrame from "../GenesisWindowFrame";
import { useIntegrationResource, type VoicePayload } from "./useIntegration";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  MetricGrid,
  Pill,
  Row,
  Section,
  SourceNote,
  codeText,
  ghostButton,
  studioFrame,
  studioScroll,
} from "./StudioShell";

interface BrowserFacts {
  mediaDevices: boolean;
  audioInputs: number | null;
  audioOutputs: number | null;
  speechVoices: number | null;
  speechSynthesis: boolean;
  secureContext: boolean;
  permission: string | null;
  error: string | null;
  probedAt: number | null;
}

const INITIAL: BrowserFacts = {
  mediaDevices: false,
  audioInputs: null,
  audioOutputs: null,
  speechVoices: null,
  speechSynthesis: false,
  secureContext: false,
  permission: null,
  error: null,
  probedAt: null,
};

export default function VoiceStudioPanel({ onClose }: { onClose: () => void }) {
  const voice = useIntegrationResource<VoicePayload>("/api/integration/voice", 20_000);
  const [facts, setFacts] = useState<BrowserFacts>(INITIAL);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      const base: BrowserFacts = {
        ...INITIAL,
        secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
        mediaDevices: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.enumerateDevices),
        speechSynthesis: typeof speechSynthesis !== "undefined",
        speechVoices: typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices().length : 0,
      };
      try {
        if (base.mediaDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          base.audioInputs = devices.filter((device) => device.kind === "audioinput").length;
          base.audioOutputs = devices.filter((device) => device.kind === "audiooutput").length;
        }
      } catch (error) {
        base.error = error instanceof Error ? error.message : String(error);
      }
      try {
        const permissions = navigator.permissions as unknown as
          | { query: (descriptor: { name: string }) => Promise<{ state: string }> }
          | undefined;
        if (permissions?.query) {
          const status = await permissions.query({ name: "microphone" });
          base.permission = status.state;
        }
      } catch {
        // The Permissions API does not describe microphone in every
        // browser. Unknown is the honest answer, not "granted".
      }
      base.probedAt = Date.now();
      if (!cancelled) setFacts(base);
    }
    void probe();
    const onVoices = () => setFacts((current) => ({ ...current, speechVoices: speechSynthesis.getVoices().length }));
    if (typeof speechSynthesis !== "undefined") speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    return () => {
      cancelled = true;
      if (typeof speechSynthesis !== "undefined") speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
    };
  }, []);

  /**
   * A user-initiated capture check. It opens the microphone for the
   * shortest possible time and stops every track immediately, so it
   * proves the device works without retaining any audio.
   */
  async function requestMicrophone() {
    setAsking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks().length;
      stream.getTracks().forEach((track) => track.stop());
      setFacts((current) => ({ ...current, permission: "granted", error: tracks > 0 ? null : "A stream opened but exposed no audio track." }));
    } catch (error) {
      setFacts((current) => ({ ...current, permission: "denied", error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setAsking(false);
    }
  }

  const payload = voice.data;
  const inputState = facts.audioInputs === 0 ? "unavailable" : facts.audioInputs === null ? "not_configured" : "healthy";

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Voice"
      title="Voice Studio · adapters, device, measurements"
      onClose={onClose}
      width={studioFrame.width}
      maxHeight={studioFrame.maxHeight}
      elevation="focus"
      extraActions={
        <button type="button" style={ghostButton} onClick={voice.refresh} aria-label="Refresh voice adapters">
          Refresh
        </button>
      }
    >
      <div style={studioScroll}>
        {voice.state === "loading" ? <LoadingState what="voice adapters" /> : null}
        {voice.state === "error" ? (
          <ErrorState what="Voice adapters" error={voice.error ?? "unknown error"} onRetry={voice.refresh} />
        ) : null}

        <Section title="Server adapters" hint="Reported by the running server, not by this browser">
          {payload ? (
            payload.adapters.length === 0 ? (
              <EmptyState title="No adapters reported" detail="The server returned no voice adapters; nothing is claimed." />
            ) : (
              payload.adapters.map((adapter) => (
                <Card key={adapter.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <strong style={{ fontSize: 12 }}>{adapter.label}</strong>
                    <Pill state={adapter.state} />
                  </div>
                  <div style={{ opacity: 0.62, marginTop: 3 }}>{adapter.detail}</div>
                  <Row label="Model" value={adapter.model ? <span style={codeText}>{adapter.model}</span> : "none configured"} />
                  <Row label="Streaming" value={adapter.streaming ? "adapter supports chunked audio" : "not supported here"} />
                </Card>
              ))
            )
          ) : (
            <LoadingState what="server adapters" />
          )}
        </Section>

        <Section title="Voice activity detection" hint="What decides when you have finished speaking">
          {payload ? (
            <Card>
              <Row label="Implementation" value={<span style={codeText}>{payload.vad.implementation}</span>} />
              <Row label="Silero ONNX weights" value={payload.vad.neuralModelPresent ? "present" : "absent — energy VAD in use"} />
              {Object.entries(payload.vad.thresholds).map(([key, value]) => (
                <Row key={key} label={key} value={String(value)} />
              ))}
              <div style={{ opacity: 0.62, marginTop: 4 }}>{payload.vad.detail}</div>
            </Card>
          ) : (
            <LoadingState what="voice activity detection" />
          )}
        </Section>

        <Section title="This device" hint="Real browser facts — the server cannot know these">
          <MetricGrid>
            <Metric label="Capture devices" value={facts.audioInputs ?? "?"} tone={inputState === "unavailable" ? "#f87171" : undefined} />
            <Metric label="Output devices" value={facts.audioOutputs ?? "?"} />
            <Metric label="System voices" value={facts.speechVoices ?? "?"} />
            <Metric label="Mic permission" value={facts.permission ?? "unknown"} />
          </MetricGrid>
          <Card>
            <Row label="Media capture API" value={facts.mediaDevices ? "available" : "unavailable in this browser"} />
            <Row label="Speech synthesis" value={facts.speechSynthesis ? `${facts.speechVoices ?? 0} voice(s)` : "unavailable"} />
            <Row label="Secure context" value={facts.secureContext ? "yes (https/localhost)" : "no — capture is blocked"} />
            {facts.error ? <Row label="Last error" value={<span style={{ color: "#fca5a5" }}>{facts.error}</span>} /> : null}
            <button type="button" style={ghostButton} onClick={() => void requestMicrophone()} disabled={asking || !facts.mediaDevices}>
              {asking ? "Checking…" : "Test microphone capture"}
            </button>
            <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 6 }}>
              Opens the microphone for a moment and stops every track immediately. No audio is recorded or sent anywhere.
            </div>
          </Card>
        </Section>

        <Section title="Measured latency" hint="Median and p95 come from real samples only">
          {payload ? (
            payload.benchmark.samples === 0 ? (
              <EmptyState
                title="No measurements"
                detail={`${payload.benchmark.detail} A latency figure shown here would be invented, so none is shown.`}
              />
            ) : (
              <Card>
                <Row label="Samples" value={payload.benchmark.samples} />
                {payload.benchmark.median
                  ? Object.entries(payload.benchmark.median).map(([key, value]) => (
                      <Row key={key} label={`median ${key}`} value={`${Math.round(value)} ms`} />
                    ))
                  : null}
                {payload.benchmark.p95
                  ? Object.entries(payload.benchmark.p95).map(([key, value]) => (
                      <Row key={key} label={`p95 ${key}`} value={`${Math.round(value)} ms`} />
                    ))
                  : null}
              </Card>
            )
          ) : (
            <LoadingState what="latency samples" />
          )}
        </Section>

        <Section title="Interruption and barge-in" hint="Adapter capability, not a claim about this device">
          <Card>
            <Row label="Synthesis interruption" value="implemented at chunk boundaries (unit-tested)" />
            <Row label="Barge-in detection" value="VAD flush closes the turn immediately (unit-tested)" />
            <Row label="Overlapping speech" value="recognition windows are de-duplicated (unit-tested)" />
            <div style={{ opacity: 0.55, marginTop: 6 }}>
              These are verified behaviours of the adapter code. They have not been demonstrated with a real microphone on this
              machine, so they are not presented as a working conversation.
            </div>
          </Card>
        </Section>

        <SourceNote path="/api/integration/voice + browser capability APIs" updatedAt={voice.updatedAt} extra="no audio leaves this device" />
      </div>
    </GenesisWindowFrame>
  );
}
