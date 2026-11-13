/**
 * ==========================================================
 * LÉLU — VOICE SESSION CONTROLS (LiveKit transport)
 *
 * Start · Mute/Unmute · Stop (she stops talking now) · End.
 * Every button calls the ONE VoiceEngine; nothing here talks to LiveKit
 * or to a model directly. The conversation is the same one text chat
 * shows, so ending the session simply returns to typing.
 *
 * Renders nothing unless the server says LiveKit is configured
 * (GET /api/livekit/status), so deployments without it are unchanged.
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

  if (!configured) return null;

  const live = Boolean(status && status.connection !== "disconnected" && status.connection !== "idle" && status.connection !== "failed");
  const phase = state.phase;
  const statusText = status ? LABEL[status.connection] ?? status.connection : LABEL.idle;
  const detail = live ? `${statusText}${status?.agentListening ? " · LÉLU listening" : status?.agentPresent ? " · connecting her ears…" : " · waiting for voice agent"} · ${phase}` : statusText;

  return (
    <div
      data-testid="lk-dock"
      style={{ position: "fixed", left: 12, bottom: "calc(12px + env(safe-area-inset-bottom))", zIndex: 60, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", maxWidth: "calc(100vw - 24px)" }}
    >
      {!live ? (
        <button type="button" data-testid="lk-start" style={button} onClick={() => void engine.startLivekitSession()}>
          🎙 Start voice
        </button>
      ) : (
        <>
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
