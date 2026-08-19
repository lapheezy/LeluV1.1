/**
 * ==========================================================
 * LÉLU
 * NETWORK CAPABILITY — real connectivity + local network truth
 *
 *   - online/offline + Connection API (effective type) — real.
 *   - WebRTC support — real (iOS Safari supports RTCPeerConnection
 *     since iOS 11; usable for local peer connections).
 *   - Direct fetch to a LAN IP (192.168.x.x) from an HTTPS page
 *     is blocked by iOS as mixed content — reported honestly.
 *   - The dev-server engineering sandbox (/api/engineer) is
 *     detected when present; it is a category-3 remote component
 *     that exists only in the hosted environment.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";

async function probeSandbox(): Promise<boolean> {
  try {
    const response = await fetch("/api/engineer/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "package.json" }),
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const networkCapability: NativeCapability = {
  id: "network.state",
  title: "Network",
  category: "network",
  requiredPermission: null,
  unavailableReason: "Network state is always readable.",
  isAvailable(): boolean {
    return true;
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const connection = (navigator as unknown as {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number };
    })?.connection;

    const isHttps = typeof window !== "undefined" && window.location?.protocol === "https:";

    const result = {
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      effectiveType: connection?.effectiveType ?? "unknown",
      downlinkMbps: connection?.downlink ?? null,
      rttMs: connection?.rtt ?? null,
      webRtcSupported:
        typeof window !== "undefined" && "RTCPeerConnection" in window,
      localNetworkDirectFetch: isHttps
        ? "blocked-as-mixed-content"
        : "allowed",
      localNetworkNote:
        "Direct fetch to LAN addresses from an HTTPS origin is blocked by iOS (mixed content). WebRTC data channels can reach local peers when a peer exists; a server relay is the reliable path.",
      engineeringSandbox: await probeSandbox(),
    };

    return { ok: true, result };
  },
};
