/**
 * ==========================================================
 * LÉLUVERSE
 * DEVICE / CAPABILITIES PANEL
 *
 * Reads ONLY from the real NativeCapabilityRegistry through
 * AIService.nativeCapabilities() — every row is the answer to
 * "can LÉLU actually perform this action on THIS device right
 * now", checked through live feature detection, permission
 * state, and honest unavailable reasons.
 *
 * No fabricated statuses: if iOS Safari does not expose a
 * mechanism (Vibration, custom URL schemes, native push on
 * non-installed tabs), the panel shows exactly that. Category 1–3
 * capabilities that CAN run here expose action buttons so the
 * panel is a live control surface, not a static inventory.
 * ==========================================================
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { genesisTheme } from "./GenesisTheme";
import AIService from "../../../core/AIService";
import type { CapabilityStatus } from "../../../core/native";
import NativeCapabilityRegistry from "../../../core/native/NativeCapabilityRegistry";
import GenesisWindowFrame from "./GenesisWindowFrame";

const ai = AIService.getInstance();

type StatusKind = "available" | "permission" | "limited" | "native" | "unavailable";

const STATUS_META: Record<StatusKind, { label: string; color: string }> = {
  available: { label: "● AVAILABLE", color: genesisTheme.status.ok },
  permission: { label: "◐ PERMISSION", color: genesisTheme.status.warn },
  limited: { label: "⚠ LIMITED", color: genesisTheme.status.warn },
  native: { label: "⚠ NATIVE ONLY", color: genesisTheme.status.idle },
  unavailable: { label: "✕ UNAVAILABLE", color: genesisTheme.status.error },
};

const CATEGORY_LABEL: Record<CapabilityStatus["category"], string> = {
  input: "Input · mic, camera, media",
  output: "Output · voice, haptics",
  communication: "Communication · share, clipboard",
  system: "System · notifications, lifecycle",
  storage: "Storage",
  network: "Network",
  device: "Device introspection",
  native: "Native shell only",
};

const CATEGORY_ORDER: CapabilityStatus["category"][] = [
  "input",
  "output",
  "communication",
  "storage",
  "network",
  "system",
  "device",
  "native",
];

function classify(status: CapabilityStatus): StatusKind {
  if (!status.available) {
    return status.category === "native" ? "native" : "unavailable";
  }
  if (status.requiresRemote) {
    return "limited";
  }
  if (
    status.requiredPermission &&
    (status.permissionState === "notDetermined" || status.permissionState === "denied")
  ) {
    return "permission";
  }
  if (status.standaloneOnly) {
    return "limited";
  }
  return "available";
}

function permissionLabel(state: CapabilityStatus["permissionState"]): string {
  switch (state) {
    case "authorized":
      return "granted";
    case "denied":
      return "denied — enable in Settings → Privacy & Security";
    case "notDetermined":
      return "not requested yet";
    case "restricted":
      return "restricted (parental controls / MDM)";
    default:
      return "unknown";
  }
}

/** Capabilities that have a safe, useful in-panel action button. */
const ACTIONS: Record<string, { label: string; payload?: Record<string, unknown> }> = {
  "share.sheet": { label: "Share this screen" },
  "clipboard.write": { label: "Copy summary" },
  "tts.speak": { label: "Speak test phrase", payload: { text: "I am here. Voice output is working." } },
  "haptics.vibrate": { label: "Test haptics" },
  "storage.estimate": { label: "Check storage" },
  "network.state": { label: "Re-check network" },
  "deeplink.intake": { label: "Check for deep link" },
  "permissions.state": { label: "Re-scan permissions" },
};

interface CapabilityRowProps {
  status: CapabilityStatus;
  busy: boolean;
  lastResult: string | null;
  onRun: (status: CapabilityStatus) => void;
}

function CapabilityRow({ status, busy, lastResult, onRun }: CapabilityRowProps) {
  const kind = classify(status);
  const meta = STATUS_META[kind];
  const action = ACTIONS[status.id];

  return (
    <div
      style={{
        border: genesisTheme.glass.borderSoft,
        borderRadius: genesisTheme.radius.md,
        background: "rgba(255,255,255,0.03)",
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 12, flex: 1, minWidth: 0 }}>
          {status.title}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${meta.color}`,
            color: meta.color,
            borderRadius: 999,
            padding: "1px 8px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.05em",
            whiteSpace: "nowrap",
            background: "rgba(0,0,0,0.18)",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: meta.color,
              boxShadow: `0 0 6px ${meta.color}`,
              flexShrink: 0,
            }}
          />
          {meta.label}
        </span>
      </div>

      <div style={{ fontSize: 10.5, lineHeight: 1.55, opacity: 0.72 }}>
        {!status.available ? (
          <span style={{ color: genesisTheme.status.error }}>
            {status.reason ?? `${status.title} is not available on this device.`}
          </span>
        ) : status.requiresRemote ? (
          <span>
            Requires a remote component to function end-to-end (category 3) — detected as
            available, end-to-end depends on a push backend.
          </span>
        ) : status.requiredPermission ? (
          <span>
            Permission: <strong>{permissionLabel(status.permissionState)}</strong>
          </span>
        ) : (
          <span>Ready — no permission required.</span>
        )}
        {status.standaloneOnly ? (
          <span style={{ color: genesisTheme.status.warn }}>
            {" "}
            · Full behavior requires the app installed to the Home Screen.
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {action ? (
          <button
            type="button"
            onClick={() => onRun(status)}
            disabled={busy || !status.available}
            style={{
              ...genesisTheme.closeButton,
              minHeight: 28,
              padding: "4px 12px",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              border: `1px solid ${genesisTheme.status.accent}`,
              color: genesisTheme.status.accent,
              background: "rgba(34, 211, 238, 0.08)",
              cursor: busy || !status.available ? "default" : "pointer",
              opacity: busy || !status.available ? 0.55 : 1,
            }}
          >
            {busy ? "RUNNING…" : action.label}
          </button>
        ) : null}
        {lastResult ? (
          <span style={{ fontSize: 10, opacity: 0.8, minWidth: 0, overflowWrap: "anywhere" }}>
            {lastResult}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface GenesisDevicePanelProps {
  onClose: () => void;
}

export default function GenesisDevicePanel({ onClose }: GenesisDevicePanelProps) {
  const [statuses, setStatuses] = useState<CapabilityStatus[]>([]);
  const [scanning, setScanning] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await ai.nativeCapabilities();
      if (mountedRef.current) {
        setStatuses(snapshot);
        setScanning(false);
      }
    } catch (error) {
      console.error("[DevicePanel] Capability scan failed", error);
      if (mountedRef.current) {
        setScanning(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    // Live: the registry notifies whenever a capability registers or an
    // invoke() completes — the panel re-scans so permission/availability
    // state stays truthful without a fixed poll.
    const unsubscribe = NativeCapabilityRegistry.getInstance().subscribe(() => {
      void refresh();
    });

    const interval = window.setInterval(() => void refresh(), 8000);
    return () => {
      mountedRef.current = false;
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function handleRun(status: CapabilityStatus) {
    if (busyId) {
      return;
    }
    setBusyId(status.id);
    setResults((prev) => ({ ...prev, [status.id]: "running…" }));
    try {
      const result = await ai.runCapability(status.id, ACTIONS[status.id]?.payload ?? {});
      const message = result.ok
        ? `✓ ${JSON.stringify(result.result ?? "ok")}`
        : `✕ ${result.error ?? "failed"}`;
      setResults((prev) => ({ ...prev, [status.id]: message }));
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [status.id]: `✕ ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setBusyId(null);
    }
  }

  const counts = {
    available: statuses.filter((s) => classify(s) === "available").length,
    total: statuses.length,
  };

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Device"
      title={
        <>
          Device Capabilities · {scanning ? "scanning…" : `${counts.available}/${counts.total} ready`}
        </>
      }
      onClose={onClose}
      width="min(92vw, 620px)"
      maxHeight="80vh"
      overflow="hidden"
    >
      <div
        className="genesis-scroll"
        style={{
          maxHeight: "calc(80vh - 132px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
          paddingRight: 6,
        }}
      >
        {/* Device summary */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: 10,
            borderRadius: genesisTheme.radius.md,
            border: `1px solid ${isStandalone ? genesisTheme.status.ok : genesisTheme.status.idle}`,
            background: "rgba(255,255,255,0.03)",
            marginBottom: 12,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: isStandalone ? genesisTheme.status.ok : genesisTheme.status.idle,
              boxShadow: isStandalone ? `0 0 10px ${genesisTheme.status.ok}` : "none",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {isStandalone ? "INSTALLED WEB APP (STANDALONE)" : "BROWSER TAB"}
            </div>
            <div style={{ fontSize: 11, opacity: 0.68 }}>
              {isStandalone
                ? "Full-screen PWA mode — home-screen app context active. Re-scan every 8s + on change."
                : "Running in a browser tab. For the full installed experience: Share → Add to Home Screen."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={scanning}
            style={{
              ...genesisTheme.closeButton,
              minHeight: 34,
              padding: "7px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              border: `1px solid ${genesisTheme.status.accent}`,
              color: genesisTheme.status.accent,
              background: "rgba(34, 211, 238, 0.1)",
              cursor: scanning ? "default" : "pointer",
              opacity: scanning ? 0.6 : 1,
            }}
          >
            {scanning ? "SCANNING…" : "RE-SCAN"}
          </button>
        </div>

        {/* Honesty note */}
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            padding: "8px 12px",
            borderRadius: 12,
            border: `1px solid ${genesisTheme.status.idle}`,
            color: genesisTheme.status.idle,
            marginBottom: 12,
          }}
        >
          Every status below comes from real feature + permission detection on this device. LÉLU
          only claims a capability she can actually perform: things iOS does not expose to a web
          app (custom URL schemes, vibration, native background execution, App Intents) are marked{" "}
          <strong>UNAVAILABLE / NATIVE ONLY</strong> — never faked.
        </div>

        {CATEGORY_ORDER.map((category) => {
          const rows = statuses.filter((s) => s.category === category);
          if (rows.length === 0) {
            return null;
          }
          return (
            <div key={category} style={{ marginBottom: 14 }}>
              <div style={genesisTheme.text.label}>{CATEGORY_LABEL[category]}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {rows.map((status) => (
                  <CapabilityRow
                    key={status.id}
                    status={status}
                    busy={busyId === status.id}
                    lastResult={results[status.id] ?? null}
                    onRun={(s) => void handleRun(s)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div style={{ fontSize: 10, opacity: 0.5, lineHeight: 1.5 }}>
          Capabilities requiring a native iOS shell (App Intents, Siri Shortcuts, true background
          execution, URL scheme registration) report their honest status here. A future native
          companion can register through the same registry without rebuilding LÉLU — the
          NativeCapability contract is already the bridge.
        </div>
      </div>
    </GenesisWindowFrame>
  );
}
