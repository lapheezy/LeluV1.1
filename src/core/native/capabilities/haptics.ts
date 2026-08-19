/**
 * ==========================================================
 * LÉLU
 * HAPTICS CAPABILITY — honestly unavailable on iOS web
 *
 * iOS Safari does not expose the Vibration API (navigator.vibrate)
 * and there is no public web mechanism for haptics on iOS.
 * Real haptics require the native CoreHaptics layer (category 4).
 * This capability exists so LÉLU KNOWS the truth instead of
 * pretending to vibrate.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";

export const hapticsCapability: NativeCapability = {
  id: "haptics.vibrate",
  title: "Haptics",
  category: "output",
  requiredPermission: null,
  unavailableReason:
    "iOS Safari does not expose the Vibration API (navigator.vibrate). Haptics require the native CoreHaptics layer.",
  isAvailable(): boolean {
    return typeof navigator !== "undefined" && "vibrate" in navigator;
  },
  permissionState(): PermissionState {
    return "unknown";
  },
  async execute(): Promise<{ ok: false; error: string }> {
    return {
      ok: false,
      error:
        "Haptics are not available to a web app on iOS (no Vibration API). Native CoreHaptics would be required (category 4).",
    };
  },
};
