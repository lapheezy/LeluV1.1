/** LÉLU — the Workspace Steward's browser-side senses: viewport and content overflow. */
import { useEffect, useState } from "react";
import WorkspaceStewardStore from "../../../../core/interface/WorkspaceStewardStore";

export function useStewardViewport(): { width: number; height: number } {
  const read = () => ({
    width: Math.round(typeof window === "undefined" ? 1440 : window.visualViewport?.width ?? window.innerWidth),
    height: Math.round(typeof window === "undefined" ? 900 : window.visualViewport?.height ?? window.innerHeight),
  });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const apply = () => setVp((prev) => {
      const next = read();
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
      // visualViewport can report the old size for a moment after a resize or
      // rotation; read again once it has settled so the plan is never a step behind.
      if (settle) clearTimeout(settle);
      settle = setTimeout(apply, 250);
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      if (settle) clearTimeout(settle);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return vp;
}

/**
 * Recognise content that does not fit its window: a descendant reaching past
 * the window's right edge. Reported to the steward, which gives the window
 * room (desktop) — or, where no room exists, the panel's own container
 * queries reflow it. Debounced; reads layout only, never writes it.
 */
export function useContentOverflowWatch(key: string): void {
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scan = () => {
      for (const content of document.querySelectorAll<HTMLElement>("[data-lelu-module-content]")) {
        const id = content.getAttribute("data-lelu-module-content");
        if (!id || content.offsetParent === null) continue;
        const box = content.getBoundingClientRect();
        let right = box.right;
        const nodes = content.querySelectorAll<HTMLElement>("*");
        const limit = Math.min(nodes.length, 600);
        for (let i = 0; i < limit; i += 1) {
          const r = nodes[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.right > right) right = r.right;
        }
        const overflow = right - box.right;
        if (overflow > 6) WorkspaceStewardStore.reportNeed(id, box.width + overflow + 24);
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, 450);
    };
    const observer = new ResizeObserver(schedule);
    for (const el of document.querySelectorAll("[data-lelu-module-content]")) observer.observe(el);
    schedule();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [key]);
}

