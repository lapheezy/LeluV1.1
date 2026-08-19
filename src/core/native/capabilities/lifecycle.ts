/**
 * ==========================================================
 * LÉLU
 * LIFECYCLE CAPABILITY — real app/window state
 *
 * Reports the actual page lifecycle: visibility, focus, online
 * state and standalone mode. Web apps cannot receive native
 * iOS lifecycle events; the bridge event stream (added later
 * with a native shell) would extend this without replacing it.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { isStandalone } from "./helpers";

function lifecycleSnapshot(): Record<string, unknown> {
  return {
    visibility: typeof document !== "undefined" ? document.visibilityState : "unknown",
    hasFocus: typeof document !== "undefined" ? document.hasFocus() : false,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    standalone: isStandalone(),
    timestamp: Date.now(),
  };
}

export const lifecycleCapability: NativeCapability = {
  id: "lifecycle.state",
  title: "App Lifecycle",
  category: "device",
  requiredPermission: null,
  unavailableReason: "Page lifecycle state is always readable.",
  isAvailable(): boolean {
    return true;
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: true; result: Record<string, unknown> }> {
    return { ok: true, result: lifecycleSnapshot() };
  },
};
