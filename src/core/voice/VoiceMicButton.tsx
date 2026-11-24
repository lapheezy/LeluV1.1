/**
 * ==========================================================
 * LÉLU — VOICE MIC CONTROL
 *
 * The ONE microphone control used by every chat surface. It calls the
 * existing VoiceEngine.toggle() — the same pipeline LiveKit, Whisper and
 * browser recognition already use — and it says what is actually
 * happening: listening, transcribing, speaking, permission denied, or a
 * device/service failure.
 *
 * It is a circular control like everything else: tap starts/stops
 * capture, hold opens voice actions. There is deliberately no second
 * decorative microphone anywhere.
 * ==========================================================
 */

import { useState } from "react";
import { Mic, MicOff, Square, VolumeX } from "lucide-react";

import { CircularControl, type RadialMenuDefinition } from "../interaction";
import { useVoice } from "./useVoice";
import "./voiceMic.css";

export interface VoiceMicButtonProps {
  /** Show the state/error line beside the control. On by default. */
  showStatus?: boolean;
  size?: number;
  className?: string;
  /** Where the control lives, for the accessible label and tests. */
  context?: string;
}

function statusOf(state: ReturnType<typeof useVoice>["state"]): {
  text: string;
  tone: "idle" | "listening" | "working" | "speaking" | "error";
} {
  if (state.error) return { text: state.error, tone: "error" };
  if (state.permission === "denied") {
    return { text: "Microphone blocked — allow it in your browser settings.", tone: "error" };
  }
  if (state.active && state.phase === "listening") {
    return { text: "Listening — speak, then pause.", tone: "listening" };
  }
  if (state.active && state.phase === "processing") {
    return { text: "Transcribing your voice…", tone: "working" };
  }
  if (state.active && state.phase === "responding") {
    return { text: "LÉLU is answering…", tone: "working" };
  }
  if (state.phase === "speaking") return { text: "LÉLU is speaking.", tone: "speaking" };
  return { text: "", tone: "idle" };
}

export default function VoiceMicButton({
  showStatus = true,
  size = 44,
  className = "",
  context = "chat",
}: VoiceMicButtonProps) {
  const voice = useVoice();
  const [busy, setBusy] = useState(false);
  const { state } = voice;
  const status = statusOf(state);
  const active = state.active;
  const speaking = state.phase === "speaking";

  const startStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await voice.engine.toggle();
    } finally {
      setBusy(false);
    }
  };

  const label = active
    ? `Stop listening (${context})`
    : state.error || state.permission === "denied"
      ? `Retry microphone (${context})`
      : `Talk to LÉLU (${context})`;

  const menu: RadialMenuDefinition = {
    id: `voice-menu:${context}`,
    label: "Voice",
    items: [
      {
        id: "toggle",
        label: active ? "Stop listening" : "Start listening",
        icon: active ? <Square size={16} fill="currentColor" /> : <Mic size={19} />,
        active,
        tone: active ? "accent" : "default",
        onSelect: () => void startStop(),
      },
      {
        id: "stop-speaking",
        label: "Stop LÉLU speaking",
        icon: <VolumeX size={18} />,
        disabled: !speaking,
        onSelect: () => voice.engine.cancelSpeech(),
      },
      {
        id: "dismiss-error",
        label: "Dismiss voice error",
        icon: <MicOff size={18} />,
        disabled: !state.error,
        onSelect: () => voice.engine.dismissError(),
      },
    ],
  };

  const icon = busy ? (
    <span className="lelu-voice-spinner" />
  ) : active ? (
    <span className="lelu-voice-live">
      <Mic size={18} />
    </span>
  ) : state.error || state.permission === "denied" ? (
    <MicOff size={18} />
  ) : (
    <Mic size={19} />
  );

  return (
    <span
      className={`lelu-voice-mic ${className}`.trim()}
      data-state={status.tone}
      data-active={active ? "true" : "false"}
      data-context={context}
    >
      <CircularControl
        label={label}
        icon={icon}
        size={size}
        active={active}
        tone={state.error ? "danger" : active ? "accent" : "default"}
        disabled={busy}
        menu={menu}
        onPress={() => void startStop()}
        testId="lelu-voice-mic"
        className="lelu-voice-mic-control"
      />
      {showStatus && status.text ? (
        <span
          className="lelu-voice-status"
          role={status.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          data-testid="lelu-voice-status"
          data-tone={status.tone}
        >
          {status.text}
        </span>
      ) : null}
    </span>
  );
}
