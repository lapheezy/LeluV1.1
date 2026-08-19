/**
 * ==========================================================
 * LÉLU
 * SHARE CAPABILITY — the real iOS Share Sheet
 *
 * Uses navigator.share (Web Share API), which on iOS opens the
 * actual system share sheet (copy, Messages, AirDrop, save…).
 * Files can be shared where navigator.canShare supports them.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { isSecureContext } from "./helpers";

function shareAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    isSecureContext() &&
    typeof navigator.share === "function"
  );
}

export const shareCapability: NativeCapability = {
  id: "share.sheet",
  title: "Share Sheet",
  category: "communication",
  requiredPermission: null,
  unavailableReason:
    "The Web Share API is not available in this browser.",
  isAvailable(): boolean {
    return shareAvailable();
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const title = typeof payload.title === "string" ? payload.title : "LÉLU";
    const text = typeof payload.text === "string" ? payload.text : "";
    const url = typeof payload.url === "string" ? payload.url : location.href;

    const shareData: ShareData = { title, text, url };
    const files = payload.files;
    if (
      Array.isArray(files) &&
      files.length > 0 &&
      typeof navigator.canShare === "function"
    ) {
      try {
        if (navigator.canShare({ files: files as File[] })) {
          shareData.files = files as File[];
        }
      } catch {
        // fall through to text-only share
      }
    }

    await navigator.share(shareData);
    return { ok: true, result: { shared: true, title, url } };
  },
};
