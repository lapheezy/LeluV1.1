/**
 * ==========================================================
 * LÉLUVERSE — VISUAL VIEWPORT
 *
 * The rectangle the user can actually see, which on phones is
 * NOT the layout viewport while the software keyboard is up:
 *
 *   iOS Safari ignores `interactive-widget=resizes-content`, so
 *   100dvh and position:fixed bottom stay sized to the full
 *   screen and the keyboard covers the composer.
 *
 * Full-screen phone surfaces size themselves to this box
 * instead, so the composer rides on top of the keyboard.
 * Updates are coalesced to one per animation frame.
 * ==========================================================
 */

import { useEffect, useState } from "react";

export interface VisualViewportBox {
  /** Visible height in CSS px. */
  height: number;
  /** Distance the visual viewport is scrolled down inside the layout viewport. */
  offsetTop: number;
  /** True when something (the keyboard) is covering a large part of the screen. */
  keyboardOpen: boolean;
}

/** Height a keyboard must take before we treat it as open (URL-bar changes are smaller). */
export const KEYBOARD_THRESHOLD_PX = 120;

export function readVisualViewport(
  win: Pick<Window, "innerHeight"> & { visualViewport?: Pick<VisualViewport, "height" | "offsetTop"> | null },
): VisualViewportBox {
  const vv = win.visualViewport;
  if (!vv) {
    return { height: win.innerHeight, offsetTop: 0, keyboardOpen: false };
  }
  const height = Math.round(vv.height);
  const offsetTop = Math.max(0, Math.round(vv.offsetTop));
  return {
    height,
    offsetTop,
    keyboardOpen: win.innerHeight - height > KEYBOARD_THRESHOLD_PX,
  };
}

function sameBox(a: VisualViewportBox, b: VisualViewportBox): boolean {
  return a.height === b.height && a.offsetTop === b.offsetTop && a.keyboardOpen === b.keyboardOpen;
}

/** Track the visual viewport while `enabled`; null when disabled or unavailable (SSR). */
export function useVisualViewport(enabled: boolean): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(() =>
    enabled && typeof window !== "undefined" ? readVisualViewport(window) : null,
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setBox(null);
      return;
    }
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const next = readVisualViewport(window);
        setBox((current) => (current && sameBox(current, next) ? current : next));
      });
    };
    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);

  return box;
}
