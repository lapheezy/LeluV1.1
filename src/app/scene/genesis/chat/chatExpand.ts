/**
 * ==========================================================
 * LÉLU — THE PHONE CHAT IS A LAYER, NOT A TAKEOVER
 *
 * On a phone the conversation used to open as the whole screen: the
 * Cosmos, the bottom navigation and everything you were doing vanished
 * the moment you tapped Chat. The surface separation made that
 * deliberate rather than expensive (nothing renders behind a full-screen
 * chat), but it still meant that asking her one question cost you the
 * view you asked it from.
 *
 * So the chat opens FLOATING: a sheet above the navigation, the Cosmos
 * still visible and still alive behind it. Expanding to the whole screen
 * is one tap, and the choice is remembered — someone who reads long
 * replies on a phone should not have to expand it every time.
 *
 * This store is read by:
 *   - GenesisChat (which geometry to use),
 *   - surface/Surface (a floating chat does not own the screen, so the
 *     Cosmos keeps rendering and the navigation stays reachable).
 *
 * It holds a preference, not a conversation: the transcript, the turn
 * queue and the streams live in the chat itself and are untouched by
 * expanding or collapsing.
 * ==========================================================
 */

import { useSyncExternalStore } from "react";
import KvStore from "../../../../core/storage/KvStore";

const KEY = "lelu.chat.expand.v1";

interface ChatExpandState {
  expanded: boolean;
}

type Listener = (state: ChatExpandState) => void;

class ChatExpandStore {
  private state: ChatExpandState;
  private readonly listeners = new Set<Listener>();

  constructor() {
    let saved: ChatExpandState | null = null;
    try {
      saved = typeof window !== "undefined" ? KvStore.getInstance().get<ChatExpandState>(KEY) : null;
    } catch {
      saved = null;
    }
    this.state = { expanded: Boolean(saved?.expanded) };
  }

  get(): ChatExpandState {
    return this.state;
  }

  set(expanded: boolean): void {
    if (this.state.expanded === expanded) return;
    this.state = { expanded };
    try {
      KvStore.getInstance().set(KEY, this.state);
    } catch {
      // storage unavailable: the choice lives for this session only
    }
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const chatExpand = new ChatExpandStore();

export function useChatExpanded(): boolean {
  return useSyncExternalStore(
    chatExpand.subscribe,
    () => chatExpand.get().expanded,
    () => false,
  );
}
