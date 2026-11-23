/**
 * ==========================================================
 * LÉLU — CREATIVE RENDER PROBE
 *
 * A tiny read-only window the acceptance run reads to prove what
 * the live scene is drawing: frame time and how many frames have
 * gone through the creative layer. It writes nothing back into
 * the object store and is inert when nobody looks at it.
 * ==========================================================
 */

interface CreativeFrameStats {
  frames: number;
  lastFrameMs: number;
  averageFrameMs: number;
  worstFrameMs: number;
}

const stats: CreativeFrameStats = { frames: 0, lastFrameMs: 0, averageFrameMs: 0, worstFrameMs: 0 };
let windowFrames = 0;
let windowTotal = 0;

export function reportCreativeFrame(deltaMs: number): void {
  // The first frame after a mount (or a tab leaving the background) carries
  // the whole pause in its delta; it is not a render cost and would poison
  // the average.
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 250) return;
  stats.frames += 1;
  stats.lastFrameMs = deltaMs;
  stats.worstFrameMs = Math.max(stats.worstFrameMs, deltaMs);
  windowFrames += 1;
  windowTotal += deltaMs;
  stats.averageFrameMs = windowTotal / windowFrames;
  if (windowFrames >= 120) {
    windowFrames = 0;
    windowTotal = 0;
    stats.worstFrameMs = deltaMs;
  }
  if (typeof window !== "undefined") {
    (window as unknown as { __leluCreativeFrames?: CreativeFrameStats }).__leluCreativeFrames = stats;
  }
}

export function resetCreativeFrames(): void {
  stats.frames = 0;
  stats.lastFrameMs = 0;
  stats.averageFrameMs = 0;
  stats.worstFrameMs = 0;
  windowFrames = 0;
  windowTotal = 0;
}
