/**
 * ==========================================================
 * LÉLU
 * NOTIFICATIONS CAPABILITY — Notification API + Web Push (client)
 *
 * Local notifications use the Notification API. On iOS 16.4+
 * this only functions for INSTALLED Home Screen web apps —
 * reported honestly via standaloneOnly.
 *
 * Web Push (remote notifications while the app is closed) needs
 * a remote push server with VAPID keys — see push.ts (category
 * 3). The service worker's push handler is already wired.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { hasNotificationApi, notificationPermissionState } from "./helpers";

export const notificationsCapability: NativeCapability = {
  id: "notifications.send",
  title: "Notifications",
  category: "system",
  requiredPermission: "notifications",
  unavailableReason:
    "The Notification API is not available in this browser (iOS: only installed Home Screen web apps receive notifications).",
  standaloneOnly: true,
  isAvailable(): boolean {
    return hasNotificationApi();
  },
  permissionState(): PermissionState {
    return notificationPermissionState(
      typeof Notification !== "undefined" ? Notification.permission : undefined,
    );
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string; state?: PermissionState }> {
    const title = typeof payload.title === "string" ? payload.title : "LÉLU";
    const body = typeof payload.body === "string" ? payload.body : "";
    const tag = typeof payload.tag === "string" ? payload.tag : "lelu";

    if (!hasNotificationApi()) {
      return {
        ok: false,
        error: "Notifications are not available in this browser.",
      };
    }

    if (Notification.permission === "denied") {
      return {
        ok: false,
        state: "denied",
        error: "Notifications are denied. Enable them in Settings → Notifications for this app.",
      };
    }

    if (Notification.permission === "default") {
      const granted = await Notification.requestPermission();
      if (granted !== "granted") {
        return {
          ok: false,
          state: granted === "denied" ? "denied" : "notDetermined",
          error: "Notification permission was not granted.",
        };
      }
    }

    new Notification(title, {
      body,
      tag,
      icon: `${import.meta.env.BASE_URL}apple-touch-icon.png`,
    });
    return { ok: true, state: "authorized", result: { shown: true, title } };
  },
};
