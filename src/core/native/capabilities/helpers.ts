/**
 * ==========================================================
 * LÉLU
 * CAPABILITY HELPERS — real feature/permission detection
 * ==========================================================
 */

import type { PermissionState } from "../NativeCapability";

export function isSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

export function hasMediaDevices(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/**
 * Query a permission through the Permissions API. Safari exposes
 * a SUBSET (camera/microphone on modern iOS; notifications is
 * NOT queryable). Returns "unknown" when the API does not exist,
 * the name is unsupported, or the query fails — never throws.
 */
export async function queryPermission(name: string): Promise<PermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unknown";
  }
  try {
    const status = await navigator.permissions.query({
      name,
    } as unknown as PermissionDescriptor);
    switch (status.state) {
      case "granted":
        return "authorized";
      case "denied":
        return "denied";
      case "prompt":
        return "notDetermined";
      default:
        return "unknown";
    }
  } catch {
    return "unknown";
  }
}

/** Map a Notification.permission value to the shared model. */
export function notificationPermissionState(
  permission: NotificationPermission | undefined,
): PermissionState {
  switch (permission) {
    case "granted":
      return "authorized";
    case "denied":
      return "denied";
    case "default":
      return "notDetermined";
    default:
      return "unknown";
  }
}

export function hasNotificationApi(): boolean {
  return typeof Notification !== "undefined";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as { standalone?: boolean };
  if (typeof w.standalone === "boolean") {
    return w.standalone; // iOS Safari installed web app
  }
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || isIPadOS();
}

function isIPadOS(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  const platform =
    (navigator as unknown as { platform?: string }).platform ?? "";
  return (
    /macintosh|mac os x/i.test(ua) &&
    /ipad|tablet/i.test(ua) &&
    /Safari/i.test(ua) &&
    /macintosh|mac os x/i.test(platform) &&
    navigator.maxTouchPoints > 0
  );
}

/** Extract "26.5.2"-style iOS version from the UA string, if present. */
export function iosVersion(): string | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  const match = navigator.userAgent.match(/OS (\d+[._]\d+[._]?\d*)/i);
  if (!match) {
    return null;
  }
  return match[1].replace(/_/g, ".");
}

export function isSafari(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
}

/** Async delay helper for probes. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
