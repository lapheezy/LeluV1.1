/**
 * ==========================================================
 * LÉLU
 * APP INTENTS / SIRI / SHORTCUTS CAPABILITY — native only
 *
 * App Intents, Siri Shortcuts and Shortcuts automation are
 * native Apple frameworks (AppIntents, AppShortcutsProvider).
 * A web app cannot expose intents to Siri/Shortcuts — this is
 * category 4 (requires native Apple tooling). The capability
 * exists so LÉLU reports the truth and the Device panel can
 * show "NATIVE ONLY".
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";

export const appIntentsCapability: NativeCapability = {
  id: "appintents.siri",
  title: "App Intents / Siri / Shortcuts",
  category: "native",
  requiredPermission: null,
  unavailableReason:
    "App Intents, Siri and Shortcuts require a native iOS app (AppIntents framework) — not available to a web app.",
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
        "App Intents / Siri / Shortcuts are native-only (AppIntents framework). The bridge seam is ready for a future native shell (category 4).",
    };
  },
};
