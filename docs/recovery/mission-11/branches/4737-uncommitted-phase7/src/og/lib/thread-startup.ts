/**
 * ==========================================================
 * LÉLU — OG THREAD STARTUP RULES
 *
 * The OG Core panel used to open a conversation like this:
 *
 *   ChatPanelWrap
 *     → createConversation()      (remote, must resolve)
 *     → getMessages(threadId)     (remote, must resolve)
 *     → ChatInner mounts          ← the actual chat runtime
 *
 * Every arrow was a gate. If the Supabase insert failed — signed out,
 * expired session, RLS rejection, offline, or simply slow — the panel
 * showed "opening a thread…" forever, because ChatInner (and therefore
 * AIService, memory recall and every provider) had never been mounted.
 * The user could not talk to LÉLU at all, and the database was the
 * reason.
 *
 * The rule this module encodes: a THREAD IS A LOCAL OBJECT FIRST.
 *
 *   - the id is minted here, synchronously, in the shape the canonical
 *     table already uses for LÉLU-created conversations
 *   - the local snapshot is read synchronously, so the first render
 *     already has the transcript
 *   - the remote read has a deadline; past it the thread keeps running
 *     on what it has, and whatever arrives later is reconciled in
 *   - the remote write is best-effort and idempotent
 *
 * Nothing here imports React, Supabase or the AI layer, so the rules can
 * be exercised directly in a test rather than inferred from a component.
 * ==========================================================
 */

/** A message in the shape both the local snapshot and the UI use. */
export interface ThreadMessageLike {
  id: string;
  role?: string;
  parts?: Array<{ type: string; text?: string }>;
}

/** Snapshot storage key. One thread, one key. */
export const THREAD_SNAPSHOT_PREFIX = "lelu:thread:";

/**
 * The thread this device was last in.
 *
 * Opening the panel after a reload has to land in the conversation that was
 * open, not in a fresh empty one — otherwise "the conversation is still there"
 * is false no matter how well the transcript was stored.
 */
export const LAST_THREAD_KEY = "lelu:last-thread";

/**
 * How long the remote transcript may take before the thread stops waiting.
 *
 * The thread is already usable at this point — this only decides when the
 * reconciliation is abandoned so a hanging request holds no listener.
 */
export const HISTORY_DEADLINE_MS = 6_000;

export function threadSnapshotKey(threadId: string): string {
  return `${THREAD_SNAPSHOT_PREFIX}${threadId}`;
}

/**
 * Mint a thread id in the canonical conversation shape.
 *
 * Deliberately the same `conv-<millis>-<rand>` form `createConversation`
 * produces, because the local id is handed to the remote insert: if the
 * two disagreed, opening a thread offline and then persisting it would
 * leave the messages pointing at a conversation the UI never shows.
 */
export function mintThreadId(now = Date.now(), random = Math.random): string {
  return `conv-${now}-${random().toString(36).slice(2, 10)}`;
}

/** The last thread this device opened, if it still has one. */
export function readLastThreadId(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(LAST_THREAD_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

/** Remember the thread that is open, so a reload reopens it. */
export function rememberThreadId(
  threadId: string,
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_THREAD_KEY, threadId);
  } catch {
    // Best effort; the thread is still open in memory.
  }
}

/** Read the local snapshot for a thread. Never throws. */
export function readThreadSnapshot<T extends ThreadMessageLike>(
  threadId: string,
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): T[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(threadSnapshotKey(threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: unknown };
    if (!Array.isArray(parsed?.messages)) return null;
    return parsed.messages as T[];
  } catch {
    return null;
  }
}

/** Persist the local snapshot for a thread. Best effort. */
export function writeThreadSnapshot(
  threadId: string,
  messages: ThreadMessageLike[],
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(threadSnapshotKey(threadId), JSON.stringify({ at: Date.now(), messages }));
  } catch {
    // Quota or private mode — the thread still lives in memory.
  }
}

/**
 * Reconcile a remote transcript into what is already on screen.
 *
 * The remote copy is history and keeps its order. Anything local that the
 * remote set does not contain is kept and appended: those are either
 * messages this session has not persisted yet, or the in-flight turn —
 * dropping them would erase exactly the thing the user just watched being
 * written. Messages are matched by id, and persisted turns reuse the UI
 * message id, so a normal round trip produces no duplicates.
 */
export function mergeRemoteMessages<T extends ThreadMessageLike>(
  remote: T[],
  local: T[],
): T[] {
  if (remote.length === 0) return local;
  const known = new Set(remote.map((message) => message.id));
  const extra = local.filter((message) => !known.has(message.id));
  return extra.length === 0 ? remote : [...remote, ...extra];
}

/**
 * Resolve with `null` if `work` has not settled within `ms`.
 *
 * `null` means "no answer inside the budget", which is distinct from an
 * empty transcript — the caller must not treat a timeout as "this thread
 * is empty" and overwrite what it already has.
 */
export async function withinDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Plain text of a message, for persistence and titles. */
export function messageText(message: ThreadMessageLike): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

/** A conversation title derived from its first user message. */
export function deriveThreadTitle(messages: ThreadMessageLike[], fallback = "A new horizon"): string {
  const first = messages.find((message) => message.role === "user" && messageText(message).trim());
  const text = first ? messageText(first).trim().replace(/\s+/g, " ") : "";
  if (!text) return fallback;
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function safeStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
