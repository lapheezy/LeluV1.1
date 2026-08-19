/**
 * ==========================================================
 * LÉLU
 * NATIVE BRIDGE CAPABILITY — the future native shell seam
 *
 * Detects whether LÉLU is running inside a native WKWebView
 * shell (window.webkit.messageHandlers.leluNative). Today the
 * answer is false — LÉLU runs as a web app. When a native iOS
 * layer is added later (category 4), this capability lights up
 * and every capability above can be re-backed by the REAL
 * native implementation without rebuilding LÉLU.
 *
 * The contract (id / permissionState / execute / result) is
 * already the one the native shell would implement.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";

function nativeShellPresent(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const w = window as unknown as {
    webkit?: { messageHandlers?: Record<string, unknown> };
  };
  return Boolean(w.webkit?.messageHandlers?.leluNative);
}

export const nativeBridgeCapability: NativeCapability = {
  id: "native.bridge",
  title: "Native Shell Bridge",
  category: "native",
  requiredPermission: null,
  unavailableReason:
    "LÉLU is running as a web app — no native WKWebView shell is present. The bridge contract is ready for a future native layer.",
  isAvailable(): boolean {
    return nativeShellPresent();
  },
  permissionState(): PermissionState {
    return nativeShellPresent() ? "authorized" : "unknown";
  },
  async execute(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if (!nativeShellPresent()) {
      return {
        ok: false,
        error:
          "No native shell detected. Capabilities report their web-real state; native-backed execution requires the WKWebView bridge.",
      };
    }
    return { ok: true, result: { nativeShell: true } };
  },
};
