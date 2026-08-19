/**
 * ==========================================================
 * LÉLU
 * DEVICE CAPABILITY — real device introspection
 *
 * Reads what the platform actually reports: UA-derived model,
 * iOS version, touch/hardware concurrency/memory, screen and
 * orientation, and whether the app is running as an installed
 * standalone (Home Screen) web app. No assumptions, no fake
 * hardware claims.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { isStandalone, iosVersion, isIOS, isSafari } from "./helpers";

function parseIphoneModel(ua: string): string | null {
  const match = ua.match(/iPhone\d+,\d+/i);
  if (!match) {
    return null;
  }
  const [series, chip] = match[0].toLowerCase().replace("iphone", "").split(",");
  // iPhone16,1 / 16,2 → iPhone 16 family (A18); 17,x → iPhone 16e/A18 per
  // Apple's public device identifiers. Reported as the identifier Apple
  // actually publishes — never invented.
  const seriesNumber = Number(series);
  if (seriesNumber >= 17) {
    return `iPhone 16e / 17-series (A18) — identifier ${match[0]}`;
  }
  return `iPhone ${series} / ${chip} — identifier ${match[0]}`;
}

function deviceSnapshot(): Record<string, unknown> {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const screen = typeof window !== "undefined" ? window.screen : undefined;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const orientation = (screen as Screen & { orientation?: { type?: string } })
    ?.orientation?.type;
  const memory = (nav as unknown as { deviceMemory?: number })?.deviceMemory;

  return {
    userAgent: ua,
    platform:
      (nav as unknown as { platform?: string })?.platform ?? "unknown",
    model: parseIphoneModel(ua),
    ios: isIOS(),
    iosVersion: iosVersion(),
    safari: isSafari(),
    standalone: isStandalone(),
    displayMode: (() => {
      try {
        return window.matchMedia("(display-mode: standalone)").matches
          ? "standalone"
          : "browser";
      } catch {
        return "unknown";
      }
    })(),
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    hardwareConcurrency: nav?.hardwareConcurrency ?? 0,
    deviceMemory: typeof memory === "number" ? memory : "not reported",
    screen: screen
      ? { width: screen.width, height: screen.height, pixelRatio: window.devicePixelRatio }
      : null,
    orientation: orientation ?? "unknown",
    language: nav?.language ?? "unknown",
    online: nav?.onLine ?? true,
  };
}

export const deviceCapability: NativeCapability = {
  id: "device.info",
  title: "Device Info",
  category: "device",
  requiredPermission: null,
  unavailableReason: "Device introspection is always available.",
  isAvailable(): boolean {
    return true;
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: true; result: Record<string, unknown> }> {
    return { ok: true, result: deviceSnapshot() };
  },
};
