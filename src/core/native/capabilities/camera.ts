/**
 * ==========================================================
 * LÉLU
 * CAMERA CAPABILITY — real frame capture
 *
 * Opens the rear/front camera through getUserMedia, draws a
 * real frame to a canvas and returns a JPEG data URL. The
 * returned image can ride the EXISTING media pipeline
 * (mediaProcessor / chat MediaAttachment).
 *
 * iOS note: getUserMedia video requires a secure context and
 * (on iOS Safari) a user gesture for the permission prompt —
 * failures are reported honestly.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { hasMediaDevices, isSecureContext, queryPermission, wait } from "./helpers";

async function grabFrame(
  facingMode: "user" | "environment",
): Promise<{ dataUrl: string; width: number; height: number }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode },
    audio: false,
  });

  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Camera video failed to load."));
      video.play().catch(reject);
    });
    await wait(350); // allow the frame to settle

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is not available in this browser.");
    }
    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return { dataUrl, width, height };
  } finally {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // already ended
      }
    }
  }
}

export const cameraCapability: NativeCapability = {
  id: "camera.capture",
  title: "Camera",
  category: "input",
  requiredPermission: "camera",
  unavailableReason:
    "Camera capture is not available in this browser (needs getUserMedia over HTTPS).",
  isAvailable(): boolean {
    return hasMediaDevices() && isSecureContext();
  },
  permissionState(): Promise<PermissionState> {
    return queryPermission("camera");
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const facingMode =
      payload.facingMode === "user" || payload.facingMode === "environment"
        ? payload.facingMode
        : "environment";
    const frame = await grabFrame(facingMode);
    return { ok: true, result: frame };
  },
};
