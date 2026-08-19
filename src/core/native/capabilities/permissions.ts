/**
 * ==========================================================
 * LÉLU
 * PERMISSIONS CAPABILITY — unified real permission state
 *
 * Queries every permission the current browser exposes through
 * the Permissions API, plus Notification.permission. Safari
 * supports a subset (camera/microphone on modern iOS); anything
 * not queryable reports "unknown" instead of a guess.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { queryPermission, notificationPermissionState } from "./helpers";

export const permissionsCapability: NativeCapability = {
  id: "permissions.state",
  title: "Permission State",
  category: "device",
  requiredPermission: null,
  unavailableReason: "Permission state is always readable.",
  isAvailable(): boolean {
    return true;
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: true; result: Record<string, unknown> }> {
    const result: Record<string, unknown> = {};

    const names: Array<[string, string]> = [
      ["microphone", "microphone"],
      ["camera", "camera"],
      ["clipboardWrite", "clipboard-write"],
      ["clipboardRead", "clipboard-read"],
      ["geolocation", "geolocation"],
    ];

    for (const [key, name] of names) {
      result[key] = await queryPermission(name);
    }

    result.notifications = notificationPermissionState(
      typeof Notification !== "undefined"
        ? Notification.permission
        : undefined,
    );

    result.capabilitiesApiSupported =
      typeof navigator !== "undefined" && Boolean(navigator.permissions?.query);

    return { ok: true, result };
  },
};
