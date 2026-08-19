/**
 * ==========================================================
 * LÉLU
 * DEEP LINKS CAPABILITY — intake + honest registration status
 *
 *   - Intake (works now): the app's OWN url can carry an intent
 *     (?ask=… or #ask=…). DeepLinkIntake reads it and feeds the
 *     prompt into LÉLU through the existing AIService path.
 *   - Registration (native-only): a web app cannot register a
 *     custom URL scheme or Universal Link on iOS — that requires
 *     a native app + associated-domain entitlement. Reported as
 *     unavailable instead of faked.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";

export function extractDeepLinkPrompt(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const url = new URL(window.location.href);
  const fromSearch = url.searchParams.get("ask");
  if (fromSearch?.trim()) {
    return fromSearch.trim().slice(0, 400);
  }
  const hash = url.hash;
  const match = hash.match(/[#&]ask=([^&]+)/);
  if (match) {
    try {
      const decoded = decodeURIComponent(match[1]);
      if (decoded.trim()) {
        return decoded.trim().slice(0, 400);
      }
    } catch {
      // malformed hash — ignore
    }
  }
  return null;
}

export const deepLinkIntakeCapability: NativeCapability = {
  id: "deeplink.intake",
  title: "Deep Link Intake",
  category: "device",
  requiredPermission: null,
  unavailableReason: "Deep-link intake is always available.",
  isAvailable(): boolean {
    return true;
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: boolean; result?: unknown }> {
    const prompt = extractDeepLinkPrompt();
    return {
      ok: true,
      result: { prompt, note: "Registered in-app URL intents are parsed; custom scheme registration is native-only." },
    };
  },
};

export const deepLinkRegisterCapability: NativeCapability = {
  id: "deeplink.register",
  title: "URL Scheme Registration",
  category: "native",
  requiredPermission: null,
  unavailableReason:
    "A web app cannot register a custom URL scheme or Universal Link on iOS — this requires a native app with associated domains (category 4).",
  isAvailable(): boolean {
    return false;
  },
  permissionState(): PermissionState {
    return "unknown";
  },
  async execute(): Promise<{ ok: false; error: string }> {
    return {
      ok: false,
      error:
        "URL scheme registration is not available to a web app on iOS. It requires a native app with associated-domain entitlements.",
    };
  },
};
