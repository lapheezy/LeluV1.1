/**
 * ==========================================================
 * LÉLU
 * CLIPBOARD CAPABILITY — real read/write
 *
 * Uses navigator.clipboard (secure context). iOS Safari
 * supports write within a user gesture without a prompt;
 * read may surface the system paste permission. Failures are
 * reported exactly as the platform reports them.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { isSecureContext, queryPermission } from "./helpers";

function clipboardAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    isSecureContext() &&
    Boolean(navigator.clipboard?.writeText)
  );
}

export const clipboardCapability: NativeCapability = {
  id: "clipboard.write",
  title: "Clipboard",
  category: "communication",
  requiredPermission: "clipboard",
  unavailableReason:
    "The Clipboard API requires a secure context; it is not available here.",
  isAvailable(): boolean {
    return clipboardAvailable();
  },
  permissionState(): Promise<PermissionState> {
    return queryPermission("clipboard-write");
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const action = payload.action === "read" ? "read" : "write";
    const text = typeof payload.text === "string" ? payload.text : "";

    if (action === "read") {
      if (!navigator.clipboard?.readText) {
        return { ok: false, error: "Clipboard read is not supported in this browser." };
      }
      const value = await navigator.clipboard.readText();
      return { ok: true, result: { text: value } };
    }

    if (!text) {
      return { ok: false, error: "Nothing to copy: provide payload.text." };
    }
    await navigator.clipboard.writeText(text);
    return { ok: true, result: { copied: text.length, text } };
  },
};
