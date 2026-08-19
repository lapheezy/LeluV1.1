/**
 * ==========================================================
 * LÉLU
 * NATIVE / DEVICE CAPABILITY CONTRACT
 *
 * One contract for every capability LÉLU can reach on the
 * current device. Every capability reports REAL availability
 * and REAL permission state — a browser feature that does not
 * exist on iOS reports `unavailable` with a reason, never a
 * fake implementation.
 *
 * A capability is NOT a browser API claim. It is the answer to
 * "can LÉLU actually perform this action on THIS device right
 * now" — checked through feature detection, permission state,
 * and (when a native shell exists later) the native bridge.
 * ==========================================================
 */

export type PermissionState =
  | "unknown"
  | "notDetermined"
  | "denied"
  | "restricted"
  | "authorized";

export type CapabilityCategory =
  | "input" // microphone, camera, media
  | "output" // speech synthesis, haptics
  | "communication" // share, clipboard
  | "system" // notifications, background, lifecycle, install
  | "storage"
  | "network"
  | "device" // introspection: device/lifecycle/permissions
  | "native"; // requires a native iOS shell (category 4)

/** Read-only, resolved status used by the Device panel and LÉLU's cognition. */
export interface CapabilityStatus {
  id: string;
  title: string;
  category: CapabilityCategory;
  /** True when the platform actually exposes the underlying mechanism. */
  available: boolean;
  permissionState: PermissionState;
  /** Permission identifier shown in UI ("microphone", "camera", "notifications", …). */
  requiredPermission: string | null;
  /** Plain-language explanation when not fully available. */
  reason?: string;
  /** Capability is only meaningful inside an installed/standalone web app. */
  standaloneOnly?: boolean;
  /** Category 3 — requires a remote/cloud component to function end-to-end. */
  requiresRemote?: boolean;
}

export interface CapabilityResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  state?: PermissionState;
}

export interface NativeCapability {
  /** Stable id, e.g. "camera.capture", "notifications.send". */
  id: string;
  title: string;
  category: CapabilityCategory;
  /** Permission identifier, or null when the mechanism needs no permission. */
  requiredPermission: string | null;
  /** True when this device/browser actually exposes the mechanism. */
  isAvailable(): boolean | Promise<boolean>;
  /** Current authorization state of the underlying permission. */
  permissionState(): PermissionState | Promise<PermissionState>;
  /** Perform the real action. Must fail honestly, never fake success. */
  execute(payload: Record<string, unknown>): Promise<CapabilityResult>;
  /** Shown when unavailable — the exact reason, e.g. "iOS Safari does not expose the Vibration API". */
  unavailableReason?: string;
  standaloneOnly?: boolean;
  requiresRemote?: boolean;
}
