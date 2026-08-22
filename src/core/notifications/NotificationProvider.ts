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

export interface NotificationPayload {
  title: string;
  body?: string;
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
  conversationId?: string;
  messageId?: string;
  priority: number;
  timestamp: number;
}

export interface DeepLink {
  conversationId?: string;
  messageId?: string;
  openChat: boolean;
}

type NotificationListener = (record: NotificationRecord) => void;
type DeepLinkListener = (link: DeepLink) => void;

const KEY = "notifications.history.v1";
const MAX_HISTORY = 80;
const DEDUP_WINDOW_MS = 60_000;

export default class NotificationProvider {
  private static instance: NotificationProvider | null = null;

  private readonly kv = KvStore.getInstance();
  private readonly notificationListeners = new Set<NotificationListener>();
  private readonly deepLinkListeners = new Set<DeepLinkListener>();
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
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      priority: payload.priority ?? 5,
      timestamp: now,
    };

    this.persist(record);

    for (const listener of this.notificationListeners) {
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
    this.kv.set(KEY, history);
  }

  public clearHistory(): void {
    this.kv.remove(KEY);
  }

  /* ------------------------------- internals ------------------------------ */

  private persist(record: NotificationRecord): void {
    const history = this.history();
    history.push(record);
    this.kv.set(KEY, history.slice(-MAX_HISTORY));
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
