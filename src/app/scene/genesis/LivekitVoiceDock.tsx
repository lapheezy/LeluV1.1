/**
 * ==========================================================
 * LÉLU — VOICE SESSION CONTROLS (LiveKit transport)
 *
 * A session is STARTED by LÉLU's existing voice entry points (the
 * composer's "Talk to LÉLU" mic, the navigator mic, holding the planet):
 * VoiceEngine.toggle() uses LiveKit when the server has it configured.
 * This dock appears only while a session is live and carries what has no
 * home yet: Mute/Unmute · Stop (she stops talking now) · End, plus
 * "Enable audio" when iOS refused to start playback without a tap.
 * Every button calls the ONE VoiceEngine. The conversation is the same one
 * text chat shows, so ending the session simply returns to typing.
 * ==========================================================
 */
import { useEffect, useState } from "react";

import VoiceEngine from "../../../core/voice/VoiceEngine";
import type { LivekitStatus } from "../../../core/voice/livekitTransport";
import { useVoice } from "../../../core/voice/useVoice";

const LABEL: Record<string, string> = {
  idle: "Voice off",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  rejoining: "Connection lost — rejoining…",
  disconnected: "Voice off",
  failed: "Voice session failed",
};

const button: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(20,20,32,0.85)",
  color: "#fff",
  borderRadius: 999,
  padding: "8px 14px",
  fontSize: 14,
  minHeight: 40,
  cursor: "pointer",
};

export default function LivekitVoiceDock() {
  const engine = VoiceEngine.getInstance();
  const { state } = useVoice();
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState<LivekitStatus | null>(() => engine.getLivekitStatus());

  useEffect(() => {
    let alive = true;
    fetch("/api/livekit/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { configured?: boolean } | null) => alive && setConfigured(Boolean(body?.configured)))
      .catch(() => {});
    const unsubscribe = engine.onLivekitStatus(setStatus);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [engine]);

  const live = Boolean(status && status.connection !== "disconnected" && status.connection !== "idle" && status.connection !== "failed");
  // Nothing to show unless LiveKit exists here and a session is (or just
  // failed to be) running: the existing mic buttons start it.
  if (!configured || (!live && status?.connection !== "failed")) return null;
  const phase = state.phase;
  const statusText = status ? LABEL[status.connection] ?? status.connection : LABEL.idle;
  const detail = live ? `${statusText}${status?.agentListening ? " · LÉLU listening" : status?.agentPresent ? " · connecting her ears…" : " · waiting for voice agent"} · ${phase}` : statusText;

  return (
    <div
      data-testid="lk-dock"
      style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(136px + env(safe-area-inset-bottom))", zIndex: 60, display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap", width: "max-content", maxWidth: "calc(100vw - 24px)", padding: 6, borderRadius: 999, background: "rgba(10,10,20,0.55)", backdropFilter: "blur(8px)" }}
    >
      {!live ? (
        <button type="button" data-testid="lk-start" style={button} onClick={() => void engine.toggle()}>
          🎙 Try voice again
        </button>
      ) : (
        <>
          {status?.audioBlocked ? (
            <button type="button" data-testid="lk-enable-audio" style={{ ...button, background: "rgba(40,110,60,0.9)" }} onClick={() => void engine.enableLivekitAudio()}>
              🔊 Enable audio
            </button>
          ) : null}
          <button type="button" data-testid="lk-mute" style={button} aria-pressed={status?.micMuted} onClick={() => void engine.setMicMuted(!status?.micMuted)}>
            {status?.micMuted ? "Unmute" : "Mute"}
          </button>
          <button type="button" data-testid="lk-stop" style={{ ...button, background: "rgba(150,30,40,0.9)" }} onClick={() => engine.stopSpeakingNow()}>
            ■ Stop
          </button>
          <button type="button" data-testid="lk-end" style={button} onClick={() => void engine.endLivekitSession()}>
            End
          </button>
        </>
      )}
      <span data-testid="lk-status" data-connection={status?.connection ?? "idle"} data-listening={status?.agentListening ? "1" : "0"} data-phase={phase} style={{ color: "#ddd", fontSize: 12, textShadow: "0 1px 2px #000" }}>
        {detail}
        {state.error ? ` — ${state.error}` : ""}
      </span>
    </div>
  );
}
