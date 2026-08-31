/**
 * ==========================================================
 * LÉLU
 * WEB PUSH CAPABILITY — category 3 (remote component required)
 *
 * The client half of Web Push: registers the service worker and
 * subscribes through the Push API. The SUBSCRIPTION alone is
 * worthless without a remote push server that holds the VAPID
 * private key and delivers payloads — so:
 *
 *   - isAvailable() = SW + Push API present AND a VAPID public
 *     key is configured (VITE_VAPID_PUBLIC_KEY or
 *     window.__LELU_VAPID_PUBLIC_KEY__).
 *   - Without the key the capability reports requiresRemote and
 *     execute() explains exactly what is missing.
 *
 * The service worker's push/notificationclick handlers are
 * already implemented (public/sw.js).
 * ==========================================================
 */

import { publicEnv } from "../../env/publicEnv";
import type { NativeCapability, PermissionState } from "../NativeCapability";
import { isSecureContext } from "./helpers";

function vapidPublicKey(): string {
  // Browser-safe allowlist, not the whole env record (see env/publicEnv.ts).
  const env = publicEnv();
  const runtimeEnv = globalThis as typeof globalThis & {
    __LELU_VAPID_PUBLIC_KEY__?: string;
  };
  return env.VITE_VAPID_PUBLIC_KEY?.trim() ?? runtimeEnv.__LELU_VAPID_PUBLIC_KEY__?.trim() ?? "";
}

function pushAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    isSecureContext() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    vapidPublicKey().length > 0
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Url);
  const array = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    array[i] = raw.charCodeAt(i);
  }
  return array;
}

export const pushCapability: NativeCapability = {
  id: "push.subscribe",
  title: "Web Push",
  category: "system",
  requiredPermission: "notifications",
  unavailableReason:
    "Web Push requires a remote push server (VAPID public key via VITE_VAPID_PUBLIC_KEY) — see IOS_CAPABILITIES.md.",
  requiresRemote: true,
  isAvailable(): boolean {
    return pushAvailable();
  },
  permissionState(): PermissionState {
    return typeof Notification !== "undefined"
      ? Notification.permission === "granted"
        ? "authorized"
        : Notification.permission === "denied"
          ? "denied"
          : "notDetermined"
      : "unknown";
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (!pushAvailable()) {
      if (vapidPublicKey().length === 0) {
        return {
          ok: false,
          error:
            "A remote push server is required: configure VITE_VAPID_PUBLIC_KEY (and run a push backend holding the VAPID private key). This is a category-3 remote component.",
        };
      }
      return { ok: false, error: "Web Push is not available in this browser." };
    }

    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) {
      return { ok: false, error: "PushManager is not available in this browser." };
    }

    const unsubscribe = Boolean(payload.unsubscribe);
    if (unsubscribe) {
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }
      try {
        localStorage.removeItem("lelu-push-subscription");
      } catch {
        // storage unavailable — non-fatal
      }
      return { ok: true, result: { unsubscribed: true } };
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()),
      });
    }

    const record = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      keys: {
        p256dh: arrayToBase64(subscription.getKey("p256dh")),
        auth: arrayToBase64(subscription.getKey("auth")),
      },
      savedAt: Date.now(),
    };

    try {
      localStorage.setItem("lelu-push-subscription", JSON.stringify(record));
    } catch {
      // storage unavailable — subscription still returned to caller
    }

    return {
      ok: true,
      result: {
        subscribed: true,
        endpoint: subscription.endpoint,
        storedLocally: true,
        note: "Send this subscription to your push server to deliver pushes.",
      },
    };
  },
};

function arrayToBase64(key: ArrayBuffer | null): string | null {
  if (!key) {
    return null;
  }
  const bytes = new Uint8Array(key);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
