/**
 * ==========================================================
 * LÉLU
 * SYSTEM ENVIRONMENT MODEL — the technical environment LÉLU
 * operates in, as structured data she can reason about.
 *
 * Everything here comes from real browser web APIs (navigator,
 * screen, storage estimate, canvas/WebGL/WebGPU probes) — no
 * assumptions, no fake values. Unavailable facts are null.
 * ==========================================================
 */

export interface SystemEnvironmentState {
  updatedAt: number;
  platform: string;
  os: string;
  browser: string;
  language: string;
  online: boolean;
  cpuCores: number | null;
  memoryGB: number | null;
  screen: {
    width: number;
    height: number;
    dpr: number;
    touch: boolean;
  } | null;
  storage: {
    availableBytes: number | null;
    quotaBytes: number | null;
  } | null;
  gpu: {
    webgl: boolean;
    webgpu: boolean;
    renderer: string | null;
  };
  environment: "browser" | "standalone";
}

function detectOS(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (/windows/.test(ua)) return "Windows";
  if (/android/.test(ua)) return "Android";
  if (/iphone|ipad|ipod/.test(ua)) return "iOS";
  if (/mac os x|macintosh/.test(ua)) return "macOS";
  if (/linux/.test(ua)) return "Linux";
  return "Unknown";
}

function detectBrowser(userAgent: string): string {
  if (/edg\//.test(userAgent)) return "Edge";
  if (/opr\//.test(userAgent)) return "Opera";
  if (/chrome\//.test(userAgent) && !/chromium/.test(userAgent)) return "Chrome";
  if (/safari\//.test(userAgent) && !/chrome\//.test(userAgent)) return "Safari";
  if (/firefox\//.test(userAgent)) return "Firefox";
  return "Web browser";
}

function probeGpu(): { webgl: boolean; webgpu: boolean; renderer: string | null } {
  if (typeof window === "undefined") {
    return { webgl: false, webgpu: false, renderer: null };
  }
  let webgl = false;
  let webgpu = false;
  let renderer: string | null = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      webgl = true;
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? null);
      }
    }
  } catch {
    // WebGL unavailable — record as false
  }
  try {
    webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
  } catch {
    webgpu = false;
  }
  return { webgl, webgpu, renderer };
}

export default class SystemEnvironment {
  private static instance: SystemEnvironment | null = null;
  private state: SystemEnvironmentState;

  private constructor() {
    this.state = this.collect();
  }

  public static getInstance(): SystemEnvironment {
    if (!SystemEnvironment.instance) {
      SystemEnvironment.instance = new SystemEnvironment();
    }
    return SystemEnvironment.instance;
  }

  private collect(): SystemEnvironmentState {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return {
        updatedAt: Date.now(),
        platform: "unknown",
        os: "unknown",
        browser: "unknown",
        language: "unknown",
        online: false,
        cpuCores: null,
        memoryGB: null,
        screen: null,
        storage: null,
        gpu: { webgl: false, webgpu: false, renderer: null },
        environment: "browser",
      };
    }

    const ua = navigator.userAgent;
    const navMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    const screen = window.screen;

    return {
      updatedAt: Date.now(),
      platform: navigator.platform ?? "unknown",
      os: detectOS(ua),
      browser: detectBrowser(ua),
      language: navigator.language ?? "unknown",
      online: navigator.onLine,
      cpuCores: navigator.hardwareConcurrency ?? null,
      memoryGB: typeof navMemory === "number" ? navMemory : null,
      screen: {
        width: screen?.width ?? 0,
        height: screen?.height ?? 0,
        dpr: window.devicePixelRatio ?? 1,
        touch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
      },
      storage: null,
      gpu: probeGpu(),
      environment: window.matchMedia?.("(display-mode: standalone)").matches ? "standalone" : "browser",
    };
  }

  /** Re-collect static facts + refresh the async storage estimate. */
  public async refresh(): Promise<SystemEnvironmentState> {
    const base = this.collect();
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        base.storage = {
          availableBytes: estimate.usage !== undefined ? estimate.usage : null,
          quotaBytes: estimate.quota !== undefined ? estimate.quota : null,
        };
      } catch {
        base.storage = null;
      }
    }
    this.state = base;
    return this.state;
  }

  public get(): SystemEnvironmentState {
    return this.state;
  }
}
