/**
 * LÉLU — can this browser share a screen at all?
 *
 * Capability, not user-agent: iOS Safari (and every iOS browser, which all
 * use WebKit) exposes navigator.mediaDevices but no getDisplayMedia, so the
 * Share Screen control is hidden there. Desktop browsers and Android Chrome
 * keep it. Pure, so it is unit-tested against fake navigators.
 */

export type ScreenShareSupport =
  | { supported: true }
  | { supported: false; reason: "no-media-devices" | "no-display-media" | "insecure-context" };

export function screenShareSupport(
  nav: { mediaDevices?: { getDisplayMedia?: unknown } | undefined } | undefined = typeof navigator !== "undefined" ? navigator : undefined,
  secure: boolean | undefined = typeof window !== "undefined" ? window.isSecureContext : true,
): ScreenShareSupport {
  if (secure === false) return { supported: false, reason: "insecure-context" };
  if (!nav?.mediaDevices) return { supported: false, reason: "no-media-devices" };
  if (typeof nav.mediaDevices.getDisplayMedia !== "function") return { supported: false, reason: "no-display-media" };
  return { supported: true };
}

/**
 * A person-facing explanation of why sharing did not start. Distinguishes a
 * refusal (the person or the OS said no) from a capture the device could not
 * start, from a browser that cannot share at all.
 */
export function explainScreenShareFailure(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (name === "NotAllowedError" || /permission|denied|not allowed/i.test(message)) {
    return "Screen sharing was declined, so nothing was captured. Choose Share Screen again and allow it when your browser asks.";
  }
  if (name === "AbortError") return "Screen sharing was cancelled before it started. Nothing was captured.";
  if (name === "NotReadableError") return "Your device could not start the capture (another app or the system may be blocking it). Nothing was captured.";
  if (name === "NotSupportedError" || name === "TypeError") return "This browser cannot share a screen.";
  return `Screen sharing did not start: ${message || "unknown error"}. Nothing was captured.`;
}
