/**
 * LÉLU — chat window LAYOUT persistence.
 *
 * Only geometry and presentation of the `chat:<conversationId>` module
 * windows live here (KvStore `lelu.chatwindows.v1`). Transcripts stay in
 * MultiChatStore — nothing here duplicates conversation content.
 */
import KvStore from "../../../../../core/storage/KvStore";

export interface ChatWindowLayout {
  presentation: "inline" | "expanded" | "minimized";
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  zIndex?: number;
}

export interface ChatWindowsSnapshot {
  windows: Record<string, ChatWindowLayout>; // keyed by conversation id
  active: string | null;
}

const KEY = "lelu.chatwindows.v1";

export function loadChatWindows(): ChatWindowsSnapshot {
  try {
    const saved = KvStore.getInstance().get<ChatWindowsSnapshot>(KEY);
    if (saved && typeof saved === "object" && saved.windows) return saved;
  } catch {
    /* fall through */
  }
  return { windows: {}, active: null };
}

export function saveChatWindows(snapshot: ChatWindowsSnapshot): void {
  try {
    KvStore.getInstance().set(KEY, snapshot);
  } catch {
    /* storage unavailable: layout lasts for this session */
  }
}

/** Snapshot the chat windows from GenesisCore's module state. Pure. */
export function snapshotFromModules(
  modules: Record<string, { presentation: string; position?: { x: number; y: number }; size?: { width: number; height: number }; zIndex?: number }>,
  prefix: string,
): ChatWindowsSnapshot {
  const windows: Record<string, ChatWindowLayout> = {};
  let active: string | null = null;
  let top = -Infinity;
  for (const [id, mod] of Object.entries(modules)) {
    if (!id.startsWith(prefix) || mod.presentation === "closed") continue;
    const conversationId = id.slice(prefix.length);
    const presentation = mod.presentation === "minimized" ? "minimized" : mod.presentation === "expanded" ? "expanded" : "inline";
    windows[conversationId] = { presentation, position: mod.position, size: mod.size, zIndex: mod.zIndex };
    const z = mod.zIndex ?? 0;
    if (presentation !== "minimized" && z >= top) { top = z; active = conversationId; }
  }
  return { windows, active };
}
