/**
 * ==========================================================
 * LÉLU — SCREEN SHARE (her eyes on what the user explicitly shares)
 *
 * Consent: the browser's own picker and recording indicator
 * (getDisplayMedia). Nothing is captured until the user chooses
 * a screen, window or tab, and capture ends when they stop —
 * here, or from the browser's own "Stop sharing" control.
 *
 * Resource-aware perception:
 *   • about once a second a 64×36 grayscale thumbnail is compared
 *     with the last kept one; only a MEANINGFUL change keeps a new
 *     full frame (JPEG, longest side ≤ 1280 px; last 5 kept);
 *   • an unchanged screen costs nothing — no frame is kept and
 *     nothing is sent anywhere;
 *   • NO model is called per frame. The latest frame (plus the one
 *     before it, when the user asks what changed) is attached to the
 *     user's own turn through the existing AIService.chat(prompt,
 *     media) — the same multimodal path as an attached image — so
 *     vision is paid only when asked, and metered by the provider's
 *     own token report like every other model call.
 *
 * Screen understanding is not computer control: this module only
 * sees. Acting on the screen stays with the permission-gated tools.
 * ==========================================================
 */

import type { MediaAttachment } from "../../providers/AIProvider";

export interface SharedFrame {
  at: number;
  dataUrl: string;
  width: number;
  height: number;
  /** Mean absolute luminance difference from the previous kept frame (0–1). */
  change: number;
}

export interface ScreenShareStats {
  active: boolean;
  startedAt: number | null;
  sampled: number;
  kept: number;
  unchangedSkipped: number;
  lastChangeAt: number | null;
  surface: string | null;
}

type Listener = (stats: ScreenShareStats) => void;

const SAMPLE_MS = 1000;
const THUMB_W = 64;
const THUMB_H = 36;
/** Mean |Δluma| over the thumbnail above which the screen "changed". */
const CHANGE_THRESHOLD = 0.02;
const MAX_SIDE = 1280;
const HISTORY = 5;
const CHANGE_WORDS = /\b(change[sd]?|different|differ|before|now|new|update[sd]?|moved|what happened)\b/i;

/** Mean absolute difference of two luminance signatures (0–1). */
export function signatureDistance(a: Uint8ClampedArray | number[], b: Uint8ClampedArray | number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

/** RGBA pixels → one luminance byte per pixel. */
export function lumaSignature(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

/** Which kept frames a turn should carry: the latest, plus the previous when the user asks about a change. */
export function framesForPrompt(history: SharedFrame[], prompt: string): SharedFrame[] {
  if (history.length === 0) return [];
  const latest = history[history.length - 1];
  if (history.length > 1 && CHANGE_WORDS.test(prompt)) return [history[history.length - 2], latest];
  return [latest];
}

export default class ScreenShare {
  private static instance: ScreenShare | null = null;
  static getInstance(): ScreenShare {
    ScreenShare.instance ??= new ScreenShare();
    return ScreenShare.instance;
  }

  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSignature: Uint8ClampedArray | null = null;
  private history: SharedFrame[] = [];
  private stats: ScreenShareStats = { active: false, startedAt: null, sampled: 0, kept: 0, unchangedSkipped: 0, lastChangeAt: null, surface: null };
  private listeners = new Set<Listener>();

  isActive(): boolean {
    return this.stats.active;
  }

  getStats(): ScreenShareStats {
    return { ...this.stats };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.getStats();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* a listener never breaks capture */ }
    }
  }

  /** Ask the user to share (browser picker). Must be called from a user gesture. */
  async start(): Promise<ScreenShareStats> {
    if (this.stats.active) return this.getStats();
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getDisplayMedia) throw new Error("Screen sharing is not supported in this browser.");
    const stream = await media.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("No screen was shared.");
    }
    // The browser's own "Stop sharing" ends it here too.
    track.addEventListener("ended", () => this.stop());
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    this.stream = stream;
    this.video = video;
    this.history = [];
    this.lastSignature = null;
    const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
    this.stats = { active: true, startedAt: Date.now(), sampled: 0, kept: 0, unchangedSkipped: 0, lastChangeAt: null, surface: settings.displaySurface ?? null };
    this.sample();
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    this.emit();
    return this.getStats();
  }

  /** End capture: every track stopped, frames dropped. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.history = [];
    this.lastSignature = null;
    this.stats = { ...this.stats, active: false };
    this.emit();
  }

  /** True while any capture track is still live (evidence that stop() really stopped). */
  captureLive(): boolean {
    return Boolean(this.stream?.getTracks().some((t) => t.readyState === "live"));
  }

  private sample(): void {
    const video = this.video;
    if (!video || video.videoWidth === 0) return;
    this.stats.sampled += 1;
    const thumb = document.createElement("canvas");
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    const tctx = thumb.getContext("2d", { willReadFrequently: true });
    if (!tctx) return;
    tctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const signature = lumaSignature(tctx.getImageData(0, 0, THUMB_W, THUMB_H).data);
    const change = this.lastSignature ? signatureDistance(signature, this.lastSignature) : 1;
    if (this.lastSignature && change < CHANGE_THRESHOLD) {
      this.stats.unchangedSkipped += 1;
      return;
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const full = document.createElement("canvas");
    full.width = Math.round(video.videoWidth * scale);
    full.height = Math.round(video.videoHeight * scale);
    full.getContext("2d")?.drawImage(video, 0, 0, full.width, full.height);
    this.history.push({ at: Date.now(), dataUrl: full.toDataURL("image/jpeg", 0.72), width: full.width, height: full.height, change });
    if (this.history.length > HISTORY) this.history.shift();
    this.lastSignature = signature;
    this.stats.kept += 1;
    this.stats.lastChangeAt = Date.now();
    this.emit();
  }

  /**
   * The shared screen as attachments for one user turn (empty when not
   * sharing). Labelled so the model knows what it is looking at.
   */
  attachmentsFor(prompt: string): MediaAttachment[] {
    if (!this.stats.active) return [];
    this.sample(); // the screen as it is NOW, if it changed since the last tick
    const frames = framesForPrompt(this.history, prompt);
    return frames.map((frame, i) => ({
      kind: "image" as const,
      dataUrl: frame.dataUrl,
      label: frames.length > 1 ? (i === 0 ? "shared-screen-before.jpg" : "shared-screen-now.jpg") : "shared-screen.jpg",
    }));
  }
}
