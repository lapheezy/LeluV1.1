/** Pixel-ratio limits for the Gen V2 canvas (see AdaptiveQuality.tsx). */

export const mobile = typeof navigator !== "undefined" && (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints ?? 0) > 1);
const deviceRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
export const DPR_MAX = Math.min(deviceRatio, mobile ? 2 : 3);
export const DPR_MIN = mobile ? 0.75 : 1;
export const DPR_START = Math.min(DPR_MAX, mobile ? 1.25 : 1.5);
