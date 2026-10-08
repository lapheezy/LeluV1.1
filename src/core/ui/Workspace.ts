/**
 * ==========================================================
 * LÉLU — WORKSPACE MEASUREMENT
 *
 * One measurement of the space the interface actually has.
 *
 * Every Genesis component measured `window.innerWidth` and
 * `window.innerHeight` for itself — eleven of them, each deciding
 * independently whether it was "mobile". Two consequences, both visible:
 *
 *   1. They measured the BROWSER WINDOW, not the container the
 *      interface is mounted in. Inside the Freebuff workspace, or any
 *      embedded frame, the window is larger than the space available, so
 *      panels were laid out for room they did not have and clipped.
 *
 *   2. There was no shared answer. Eleven thresholds drift, so the dock
 *      could believe it was on desktop while the chat believed it was on
 *      mobile, and their absolutely-positioned controls landed on top of
 *      each other.
 *
 * So the container is measured once, with a ResizeObserver on the real
 * root element, and everything reads that. `window` is the fallback for
 * when there is no element to observe yet — not the source of truth.
 *
 * The visual viewport is tracked separately because it is a different
 * question: on mobile Safari an open keyboard shrinks the visual
 * viewport without changing the layout viewport, which is why the
 * composer ended up underneath the keyboard.
 * ==========================================================
 */

/** Width breakpoints, named for what the layout can afford. */
export type WorkspaceSize = "compact" | "medium" | "wide";

export const BREAKPOINTS = {
  /** Below this, one column and nothing side by side. */
  compact: 640,
  /** Below this, panels overlay rather than sit beside the scene. */
  medium: 1024,
} as const;

export interface WorkspaceMetrics {
  /** The container's own size — not the window's. */
  width: number;
  height: number;
  size: WorkspaceSize;
  /** Narrow enough that stacked, full-width controls are the only option. */
  compact: boolean;
  /** Taller than it is wide; drives dock placement independently of width. */
  portrait: boolean;
  /**
   * Height actually visible, which an open keyboard reduces. The
   * difference between this and `height` is how much is being covered.
   */
  visibleHeight: number;
  /** True when something (almost always a keyboard) is covering the view. */
  keyboardOpen: boolean;
  /** Device safe-area insets, already resolved to numbers. */
  safeTop: number;
  safeBottom: number;
  /** Is this an embedded frame rather than a top-level window? */
  embedded: boolean;
}

type Listener = (metrics: WorkspaceMetrics) => void;

function sizeFor(width: number): WorkspaceSize {
  if (width < BREAKPOINTS.compact) return "compact";
  if (width < BREAKPOINTS.medium) return "medium";
  return "wide";
}

/** A safe-area inset in pixels, or 0 where the platform has none. */
function safeArea(edge: "top" | "bottom"): number {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc?.documentElement) return 0;
  const probe = doc.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.height = `env(safe-area-inset-${edge}, 0px)`;
  doc.documentElement.appendChild(probe);
  const value = Number.parseFloat(getComputedStyle(probe).height) || 0;
  probe.remove();
  return value;
}

/** Are we inside a frame? Cross-origin access throws, which is itself a yes. */
function isEmbedded(): boolean {
  const win = globalThis as { self?: unknown; top?: unknown };
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

const FALLBACK: WorkspaceMetrics = {
  width: 1280,
  height: 800,
  size: "wide",
  compact: false,
  portrait: false,
  visibleHeight: 800,
  keyboardOpen: false,
  safeTop: 0,
  safeBottom: 0,
  embedded: false,
};

/** Build metrics from a measured box. */
export function measure(
  width: number,
  height: number,
  options: {
    visibleHeight?: number;
    safeTop?: number;
    safeBottom?: number;
    embedded?: boolean;
  } = {},
): WorkspaceMetrics {
  const visibleHeight = options.visibleHeight ?? height;
  return {
    width,
    height,
    size: sizeFor(width),
    compact: width < BREAKPOINTS.compact,
    portrait: height > width,
    visibleHeight,
    // A small shortfall is browser chrome rounding; a large one is a
    // keyboard. 120px is comfortably above the former and below any
    // on-screen keyboard.
    keyboardOpen: height - visibleHeight > 120,
    safeTop: options.safeTop ?? 0,
    safeBottom: options.safeBottom ?? 0,
    embedded: options.embedded ?? false,
  };
}

export default class Workspace {
  private static instance: Workspace | null = null;

  private readonly listeners = new Set<Listener>();
  private metrics: WorkspaceMetrics = FALLBACK;
  private observer: ResizeObserver | null = null;
  private element: Element | null = null;
  private viewportBound = false;

  private constructor() {
    this.metrics = this.fromWindow();
  }

  public static getInstance(): Workspace {
    if (!Workspace.instance) Workspace.instance = new Workspace();
    return Workspace.instance;
  }

  /** The window, used only until a real container is observed. */
  private fromWindow(): WorkspaceMetrics {
    const win = globalThis as {
      innerWidth?: number;
      innerHeight?: number;
      visualViewport?: { height?: number };
    };
    if (typeof win.innerWidth !== "number" || typeof win.innerHeight !== "number") {
      return FALLBACK;
    }
    return measure(win.innerWidth, win.innerHeight, {
      visibleHeight: win.visualViewport?.height ?? win.innerHeight,
      safeTop: safeArea("top"),
      safeBottom: safeArea("bottom"),
      embedded: isEmbedded(),
    });
  }

  /**
   * Observe the element the interface is mounted in.
   *
   * Idempotent for the same element, because Genesis mounts twice under
   * StrictMode; observing twice would publish every resize twice and
   * make layout work depend on how many times React mounted.
   */
  public observe(element: Element | null): void {
    if (!element || element === this.element) return;
    this.observer?.disconnect();
    this.element = element;

    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!Observer) {
      // No ResizeObserver (older runtime, or a test): fall back to the
      // window rather than reporting nothing.
      this.publish(this.fromWindow());
      return;
    }

    this.observer = new Observer((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const win = globalThis as { visualViewport?: { height?: number } };
      this.publish(
        measure(box.width, box.height, {
          // The visual viewport is a window-level fact even when the
          // container is smaller, so it is clamped to the container.
          visibleHeight: Math.min(box.height, win.visualViewport?.height ?? box.height),
          safeTop: safeArea("top"),
          safeBottom: safeArea("bottom"),
          embedded: isEmbedded(),
        }),
      );
    });
    this.observer.observe(element);
    this.bindVisualViewport();
  }

  /**
   * Follow the visual viewport.
   *
   * A keyboard opening does not resize the container, so the
   * ResizeObserver never fires for it — which is why the composer
   * disappeared under the keyboard instead of moving above it.
   */
  private bindVisualViewport(): void {
    if (this.viewportBound) return;
    const viewport = (globalThis as {
      visualViewport?: { addEventListener?: (t: string, fn: () => void) => void };
    }).visualViewport;
    if (!viewport?.addEventListener) return;
    this.viewportBound = true;
    const onChange = (): void => {
      const box = this.element?.getBoundingClientRect();
      const win = globalThis as { visualViewport?: { height?: number } };
      const height = box?.height ?? this.metrics.height;
      this.publish(
        measure(box?.width ?? this.metrics.width, height, {
          visibleHeight: Math.min(height, win.visualViewport?.height ?? height),
          safeTop: this.metrics.safeTop,
          safeBottom: this.metrics.safeBottom,
          embedded: this.metrics.embedded,
        }),
      );
    };
    viewport.addEventListener("resize", onChange);
    viewport.addEventListener("scroll", onChange);
  }

  public stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.element = null;
  }

  public get(): WorkspaceMetrics {
    return this.metrics;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.metrics);
    return () => this.listeners.delete(listener);
  }

  /** Publish only real changes — a resize storm must not re-render per pixel. */
  private publish(next: WorkspaceMetrics): void {
    const current = this.metrics;
    const same =
      Math.round(next.width) === Math.round(current.width) &&
      Math.round(next.height) === Math.round(current.height) &&
      Math.round(next.visibleHeight) === Math.round(current.visibleHeight) &&
      next.size === current.size;
    if (same) return;
    this.metrics = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch {
        // A broken layout listener must never break measurement.
      }
    }
  }
}
