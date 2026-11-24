/**
 * ==========================================================
 * LÉLU — THE MICROPHONE BUTTON, ONE COMPONENT FOR EVERY CHAT COMPOSER
 *
 * The Chat Universe composer and each open chat window's composer show the
 * same control over the ONE voice engine (VoiceEngine.getInstance()). It
 * reflects the engine's real state — pressed only while a session holds the
 * microphone, "paused" while the platform has taken it (M22.9) — and starts
 * voice in the conversation this composer belongs to, the same rule a typed
 * send uses.
 *
 * M22.10: extracted from ChatUniverse so the chat WINDOW gets it too. On the
 * canonical branch an opened chat window replaces the Universe composer, and
 * the window had no microphone at all: a user mid-voice-session lost both the
 * listening indicator and the only way to stop listening.
 *
 * M23: the button now shows its own error. Voice errors went only to
 * notify(), and while the chat owns a phone screen GenesisNotificationCenter
 * files notifications silently into history instead of showing them — so on
 * a phone a denied or missing microphone produced no visible message at all
 * (measured: desktop showed "Microphone permission denied…", the iPhone
 * viewport showed nothing). The message now sits beside the control that
 * caused it, on every device, until dismissed or the next attempt.
 * ==========================================================
 */

import { useState } from "react";
import * as Icons from "lucide-react";

import { useGenesis } from "../../GenesisCore";
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import VoiceEngine from "../../../../../core/voice/VoiceEngine";
import { useVoice } from "../../../../../core/voice/useVoice";

export default function VoiceToggle({ conversationId }: { conversationId: string | null }) {
  const genesis = useGenesis();
  const { state } = useVoice();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const capture = state.active ? (state.captureSuspended ? "suspended" : "live") : "off";
  const error = !state.active && state.error && state.error !== dismissed ? state.error : null;
  return (
    <span className="lcu-voice" data-lelu-voice-wrap>
      <button
        type="button"
        className="lcu-icon sm"
        data-lelu-voice-toggle
        data-lelu-voice-phase={state.phase}
        data-lelu-voice-capture={capture}
        aria-pressed={state.active}
        aria-label={state.active ? (state.captureSuspended ? "Microphone paused — stop voice" : "Stop listening") : "Talk to LÉLU"}
        aria-describedby={error ? "lcu-voice-error" : undefined}
        title={state.active ? (state.captureSuspended ? "Microphone paused" : `Listening — ${state.phase}`) : "Talk to LÉLU"}
        onClick={() => {
          // A new attempt replaces the previous error.
          if (state.error) setDismissed(state.error);
          // Voice speaks into the chat this composer targets — the same
          // conversation a typed message here would go to.
          if (!state.active && conversationId && conversationId !== MultiChatStore.getInstance().getActiveId()) {
            genesis.switchConversation(conversationId);
          }
          void VoiceEngine.getInstance().toggle();
        }}
      >
        {state.active ? <Icons.Mic size={17} /> : error ? <Icons.MicOff size={17} /> : <Icons.Mic size={17} />}
      </button>
      {error ? (
        <span id="lcu-voice-error" className="lcu-voice-error" role="alert" data-lelu-voice-error={state.errorKind ?? "error"}>
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setDismissed(error)}>
            <Icons.X size={14} />
          </button>
        </span>
      ) : null}
    </span>
  );
}
