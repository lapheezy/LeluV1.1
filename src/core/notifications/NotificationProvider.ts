/**
 * ==========================================================
 * LÉLU
 * NOTIFICATION PROVIDER — web adapter
 *
 * A single notification abstraction above the existing native
 * capability. The web adapter:
 *   - foreground in-app notifications (listener channel)
 *   - optional system Notification (only when the tab is hidden)
 *   - deduplication by tag within a short window
 *   - persistent notification history
 *   - deep-linking (conversationId + messageId) so a click routes
 *     the user to the exact conversation
 *
 * Native / desktop / mobile adapters can replace or wrap the web
 * adapter later without changing callers. This is NOT background
 * execution — the platform's limits are reported honestly (see
 * PersistentRuntime and native/capabilities/background.ts).
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

/**
 * What a notification is about. "question" is LÉLU asking something on the
 * side; "reply"/"failure" is a turn that finished in a conversation the
 * user was not looking at; "approval" is work waiting for consent.
 */
export type NotificationType = "question" | "reply" | "failure" | "approval" | "proactive" | "info";

export interface NotificationPayload {
  title: string;
  body?: string;
  type?: NotificationType;
  /** The task that produced it (TurnOwnership task id). */
  taskId?: string;
  /** The ProactiveCore question it is about. */
  questionId?: string;
  /**
   * Inbox only — kept in the Chats panel's NOTIFICATIONS without a toast.
   * A side question or a reply in another chat should be findable, not
   * thrown over what the user is doing.
   */
  silent?: boolean;
  /** Optional conversation the notification deep-links into. */
  conversationId?: string;
  messageId?: string;
  /** Stable dedup key (defaults to title). */
  tag?: string;
  priority?: 1 | 2 | 3 | 4 | 5 | 6;
  /** True to also request/fire a system Notification when hidden. */
  system?: boolean;
}

export interface NotificationRecord {
  id: string;
  title: string;
  body?: string;
  /** Optional on the type so history written before these fields still loads. */
  type?: NotificationType;
  conversationId?: string;
  messageId?: string;
  taskId?: string;
  questionId?: string;
  priority: number;
  timestamp: number;
  read?: boolean;
}

export interface DeepLink {
  conversationId?: string;
  messageId?: string;
  openChat: boolean;
}

type NotificationListener = (record: NotificationRecord) => void;
type HistoryListener = (history: NotificationRecord[]) => void;
type DeepLinkListener = (link: DeepLink) => void;

const KEY = "notifications.history.v1";

/**
 * Unread is explicit. History written before read state existed was
 * already shown as toasts, so it does not come back as unread.
 */
export function isUnread(record: NotificationRecord): boolean {
  return record.read === false;
}
const MAX_HISTORY = 80;
const DEDUP_WINDOW_MS = 60_000;

export default class NotificationProvider {
  private static instance: NotificationProvider | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly notificationListeners = new Set<NotificationListener>();
  private readonly deepLinkListeners = new Set<DeepLinkListener>();
  private readonly historyListeners = new Set<HistoryListener>();
  private readonly recentTags = new Map<string, number>();

  public static getInstance(): NotificationProvider {
    if (!NotificationProvider.instance) {
      NotificationProvider.instance = new NotificationProvider();
    }
    return NotificationProvider.instance;
  }

  /* ------------------------------- subscribe ------------------------------ */

  public subscribe(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  /** Every change to the history — new, read, dismissed. Called once now. */
  public subscribeHistory(listener: HistoryListener): () => void {
    this.historyListeners.add(listener);
    try {
      listener(this.history());
    } catch {
      // contained
    }
    return () => {
      this.historyListeners.delete(listener);
    };
  }

  public subscribeDeepLink(listener: DeepLinkListener): () => void {
    this.deepLinkListeners.add(listener);
    return () => {
      this.deepLinkListeners.delete(listener);
    };
  }

  /* -------------------------------- notify -------------------------------- */

  public notify(payload: NotificationPayload): NotificationRecord | null {
    const tag = payload.tag ?? payload.title;
    const now = Date.now();
    const last = this.recentTags.get(tag);
    if (last && now - last < DEDUP_WINDOW_MS) {
      return null; // deduplicated
    }
    this.recentTags.set(tag, now);

    const record: NotificationRecord = {
      id: crypto.randomUUID(),
      title: payload.title,
      body: payload.body,
      ...(payload.type ? { type: payload.type } : {}),
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      ...(payload.taskId ? { taskId: payload.taskId } : {}),
      ...(payload.questionId ? { questionId: payload.questionId } : {}),
      priority: payload.priority ?? 5,
      timestamp: now,
      read: false,
    };

    this.persist(record);

    for (const listener of payload.silent ? [] : this.notificationListeners) {
      try {
        listener(record);
      } catch (error) {
        console.error("[Lélu NotificationProvider] listener threw (contained)", error);
      }
    }

    if (payload.system && this.documentHidden()) {
      this.fireSystemNotification(record);
    }

    return record;
  }

  /** Route the user to a conversation (used by in-app UI + SW click). */
  public openDeepLink(link: DeepLink): void {
    for (const listener of this.deepLinkListeners) {
      try {
        listener(link);
      } catch (error) {
        console.error("[Lélu NotificationProvider] deep-link listener threw (contained)", error);
      }
    }
  }

  /* ------------------------------- history -------------------------------- */

  public history(): NotificationRecord[] {
    return this.kv.get<NotificationRecord[]>(KEY) ?? [];
  }

  public dismiss(id: string): void {
    const history = this.history().filter((record) => record.id !== id);
    this.write(history);
  }

  public clearHistory(): void {
    this.kv.remove(KEY);
    this.emitHistory([]);
  }

  public unreadCount(): number {
    return this.history().filter(isUnread).length;
  }

  /** Mark one notification read. */
  public markRead(id: string): void {
    this.markWhere((record) => record.id === id);
  }

  /** Mark read everything about a question — answered or dismissed elsewhere. */
  public markQuestionRead(questionId: string): void {
    this.markWhere((record) => record.questionId === questionId);
  }

  /** Mark read every reply/failure notification for a conversation now on screen. */
  public markConversationRead(conversationId: string): void {
    this.markWhere(
      (record) => record.conversationId === conversationId && (record.type === "reply" || record.type === "failure"),
    );
  }

  public markAllRead(): void {
    this.markWhere(() => true);
  }

  /**
   * Open what a notification points at: its conversation (deep link) and
   * mark it read. The caller decides what else to show (a question card).
   */
  public open(id: string): NotificationRecord | null {
    const record = this.history().find((item) => item.id === id) ?? null;
    if (!record) return null;
    this.markRead(id);
    this.openDeepLink({
      conversationId: record.conversationId,
      messageId: record.messageId,
      openChat: true,
    });
    return record;
  }

  /* ------------------------------- internals ------------------------------ */

  private persist(record: NotificationRecord): void {
    const history = this.history();
    history.push(record);
    this.write(history.slice(-MAX_HISTORY));
  }

  private markWhere(match: (record: NotificationRecord) => boolean): void {
    const history = this.history();
    let changed = false;
    const next = history.map((record) => {
      if (!isUnread(record) || !match(record)) return record;
      changed = true;
      return { ...record, read: true };
    });
    if (changed) this.write(next);
  }

  private write(history: NotificationRecord[]): void {
    this.kv.set(KEY, history);
    this.emitHistory(history);
  }

  private emitHistory(history: NotificationRecord[]): void {
    for (const listener of this.historyListeners) {
      try {
        listener(history);
      } catch (error) {
        console.error("[Lélu NotificationProvider] history listener threw (contained)", error);
      }
    }
  }

  private documentHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }

  private fireSystemNotification(record: NotificationRecord): void {
    if (typeof Notification === "undefined") {
      return;
    }
    try {
      if (Notification.permission !== "granted") {
        return;
      }
      const notification = new Notification(record.title, {
        body: record.body,
        tag: record.id,
        icon: `${import.meta.env.BASE_URL}apple-touch-icon.png`,
      });
      notification.onclick = () => {
        notification.close();
        this.openDeepLink({
          conversationId: record.conversationId,
          messageId: record.messageId,
          openChat: Boolean(record.conversationId),
        });
      };
    } catch {
      // Notification API unavailable/blocked — foreground channel already fired.
    }
  }
}
