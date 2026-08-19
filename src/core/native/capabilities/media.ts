/**
 * ==========================================================
 * LÉLU
 * MEDIA PROCESSING CAPABILITY
 *
 * Processes image/video input through the EXISTING mediaProcessor
 * (downscale to JPEG data URL; video → captured frame). Accepts a
 * File (from the UI/chat) or a data URL. The result can ride the
 * existing chat MediaAttachment pipeline for LÉLU's vision.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import {
  processImageFile,
  processVideoFile,
  fitDimensions,
  type ProcessedMedia,
} from "../../media/mediaProcessor";
import { isSecureContext } from "./helpers";

function processingAvailable(): boolean {
  return (
    typeof document !== "undefined" &&
    isSecureContext() &&
    typeof document.createElement("canvas").getContext === "function"
  );
}

async function processDataUrl(dataUrl: string, kind: "image" | "video", label: string): Promise<ProcessedMedia> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not decode the media."));
  });
  const { width, height } = fitDimensions(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }
  context.drawImage(image, 0, 0, width, height);
  return {
    kind,
    dataUrl: canvas.toDataURL("image/jpeg", 0.82),
    label,
  };
}

export const mediaCapability: NativeCapability = {
  id: "media.process",
  title: "Image / Video Processing",
  category: "input",
  requiredPermission: null,
  unavailableReason:
    "Canvas/FileReader media processing is not available in this browser.",
  isAvailable(): boolean {
    return processingAvailable();
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const file = payload.file;
    const dataUrl = typeof payload.dataUrl === "string" ? payload.dataUrl : "";
    const kind = payload.kind === "video" ? "video" : "image";
    const label = typeof payload.label === "string" ? payload.label : kind === "video" ? "clip.mp4" : "image";

    if (file instanceof File) {
      const processed =
        kind === "video"
          ? await processVideoFile(file)
          : await processImageFile(file);
      return { ok: true, result: processed };
    }

    if (dataUrl.startsWith("data:")) {
      const processed = await processDataUrl(dataUrl, kind, label);
      return { ok: true, result: processed };
    }

    return {
      ok: false,
      error: "Provide media to process: payload.file (File) or payload.dataUrl.",
    };
  },
};
