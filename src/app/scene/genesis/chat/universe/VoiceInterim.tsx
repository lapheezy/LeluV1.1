/**
 * ==========================================================
 * LÉLU — THE WORDS BEING SPOKEN, AS THE PERSON'S OWN LINE IN THE THREAD
 *
 * Live conversation (WP03): while the browser's recogniser reports interim
 * words, they appear at the bottom of THIS conversation's thread as the
 * person's line in progress — not in a separate transcript panel. When the
 * utterance is final the engine hands it to the conversation as an ordinary
 * user message and this line clears, so nothing is shown twice.
 *
 * The Whisper path transcribes a whole utterance at once and has no interim
 * words: then nothing is shown here (the status chip says "Hearing you…"),
 * rather than inventing text the recogniser has not produced.
 * ==========================================================
 */

import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import { useVoice } from "../../../../../core/voice/useVoice";

export default function VoiceInterim({ conversationId }: { conversationId: string }) {
  const { state, interim } = useVoice();
  const text = interim.trim();
  if (!state.active || !text) return null;
  // Voice speaks into the active conversation (VoiceToggle switches to it).
  if (MultiChatStore.getInstance().getActiveId() !== conversationId) return null;
  return (
    <div className="lcu-msg lcu-msg-interim" data-role="user-interim" data-lelu-voice-interim aria-live="polite">
      <div className="lcu-bubble">
        <p>{text}…</p>
      </div>
    </div>
  );
}
