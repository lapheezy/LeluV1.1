/**
 * ==========================================================
 * LÉLU
 * MEDIA PROCESSOR
 *
 * Turns image/video files selected in the chat interface into
 * compact, model-ready attachments:
 *
 *   - images are downscaled to a bounded canvas and re-encoded
 *     as JPEG data URLs (small payloads for the provider APIs),
 *   - videos are reduced to a representative captured frame
 *     (data URL) — the frame is what the vision pipeline sees,
 *     while the prompt text carries the video context.
 *
 * Pure helpers (default prompts, dimension math) are exported
 * separately so the verification suite can test them without a
 * DOM. Processing functions are DOM-bound and safe to call only
 * in the browser.
 * ==========================================================
 */

export interface ProcessedMedia {
  kind: "image" | "video";
  dataUrl: string;
  label: string;
}

export const MAX_DIMENSION = 1280;
export const JPEG_QUALITY = 0.82;

/** Short label used for scene display + memory when no text was typed. */
export function mediaDisplayLabel(media: ProcessedMedia[]): string {
  if (media.length === 0) {
    return "";
  }
  if (media.length === 1) {
    return media[0].kind === "video" ? "[Video attached]" : "[Image attached]";
  }
  const images = media.filter((item) => item.kind === "image").length;
  const videos = media.length - images;
  const parts: string[] = [];
  if (images) {
    parts.push(`${images} image${images > 1 ? "s" : ""}`);
  }
  if (videos) {
    parts.push(`${videos} video${videos > 1 ? "s" : ""}`);
  }
  return `[${parts.join(" + ")} attached]`;
}

/** Prompt sent to the model when the user attached media but typed nothing. */
export function defaultMediaPrompt(media: ProcessedMedia[]): string {
  const kinds = new Set(media.map((item) => item.kind));
  if (kinds.size === 1 && kinds.has("image")) {
    return "Analyze this image and tell me what you see.";
  }
  if (kinds.size === 1 && kinds.has("video")) {
    return "Analyze this video. A captured frame is attached — describe what's happening in it.";
  }
  return "Analyze these images/videos and tell me what you see.";
}

/** Downscale destination dimensions keeping aspect ratio. */
export function fitDimensions(
  width: number,
  height: number,
  maxDim = MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxDim) {
    return { width, height };
  }
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the image."));
    image.src = source;
  });
}

function drawToDataUrl(
  source: HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function labelFromFile(file: File): string {
  return file.name || (file.type.includes("video") ? "clip" : "image");
}

/** Downscale an image file to a compact JPEG data URL attachment. */
export async function processImageFile(file: File): Promise<ProcessedMedia> {
  const raw = await readFileAsDataUrl(file);
  const image = await loadImage(raw);
  const { width, height } = fitDimensions(image.naturalWidth, image.naturalHeight);
  return {
    kind: "image",
    dataUrl: drawToDataUrl(image, width, height),
    label: labelFromFile(file),
  };
}

function waitForEvent(element: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Video load timed out.")), 15000);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("Could not decode the video."));
    }, { once: true });
  });
}

/**
 * Reduce a video file to a representative captured frame. The frame
 * (not the raw video) is what the vision pipeline receives — the
 * prompt text carries the video context.
 */
export async function processVideoFile(file: File): Promise<ProcessedMedia> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = objectUrl;

    await waitForEvent(video, "loadedmetadata");

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = duration > 0 ? Math.min(duration * 0.25, 1.5) : 0;
    if (target > 0) {
      video.currentTime = target;
      await waitForEvent(video, "seeked");
    }

    const naturalWidth = video.videoWidth || 640;
    const naturalHeight = video.videoHeight || 360;
    const { width, height } = fitDimensions(naturalWidth, naturalHeight);

    return {
      kind: "video",
      dataUrl: drawToDataUrl(video, width, height),
      label: labelFromFile(file),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
