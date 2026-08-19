/**
 * ==========================================================
 * LÉLU
 * INSTALL CAPABILITY — Home Screen web app guidance
 *
 * iOS has no programmatic install prompt for web apps (no
 * beforeinstallprompt on iOS). "Install" = the user's Share
 * menu → Add to Home Screen. This capability reports whether
 * the app is ALREADY installed (standalone) and returns the
 * exact user steps — real guidance, not a fake install.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { isStandalone, isIOS } from "./helpers";

export const installCapability: NativeCapability = {
  id: "install.homescreen",
  title: "Install to Home Screen",
  category: "system",
  requiredPermission: null,
  unavailableReason:
    "iOS does not expose a programmatic install API for web apps; installation is the Share → Add to Home Screen flow.",
  isAvailable(): boolean {
    return isIOS();
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: boolean; result?: unknown }> {
    return {
      ok: true,
      result: {
        installed: isStandalone(),
        steps: isStandalone()
          ? ["LÉLU is already installed on your Home Screen."]
          : [
              "Tap the Share button (square with arrow) in Safari.",
              "Choose “Add to Home Screen”.",
              "Name it LÉLU and tap Add.",
              "Open LÉLU from the Home Screen for full-screen standalone mode (notifications work only there).",
            ],
      },
    };
  },
};
