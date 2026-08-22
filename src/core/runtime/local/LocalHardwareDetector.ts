/**
 * ==========================================================
 * LÉLU
 * LOCAL HARDWARE DETECTOR
 *
 * Reads the REAL browser/system environment — never fabricates
 * values. GPU vendor is parsed from the unmasked renderer
 * string; VRAM is a coarse estimate with an explicit "estimated"
 * source flag. Disk storage comes from the async quota API.
 * ==========================================================
 */

import SystemEnvironment from "../../cognition/SystemEnvironment";
import type { LocalHardware, TypedValue, InfoSource } from "./LocalRuntimeTypes";

function parseGpuVendor(
  renderer: string | null,
): { vendor: string; source: InfoSource } {
  if (!renderer) {
    return { vendor: "Unknown", source: "unavailable" };
  }
  const r = renderer.toLowerCase();
  if (r.includes("apple")) {
    return { vendor: "Apple", source: "detected" };
  }
  if (r.includes("nvidia")) {
    return { vendor: "NVIDIA", source: "detected" };
  }
  if (r.includes("amd") || r.includes("radeon") || r.includes("ati")) {
    return { vendor: "AMD", source: "detected" };
  }
  if (r.includes("intel")) {
    return { vendor: "Intel", source: "detected" };
  }
  return { vendor: "Unknown", source: "unavailable" };
}

function estimateVramGB(renderer: string | null): {
  value: number | null;
  source: InfoSource;
} {
  if (!renderer) {
    return { value: null, source: "unavailable" };
  }
  const r = renderer.toLowerCase();
  if (
    /m2 ultra|m3 ultra|m4 max|rtx 4090|rtx 4080|rx 7900|a100|h100|m1 ultra|m2 max|m3 max/.test(
      r,
    )
  ) {
    return { value: 48, source: "estimated" };
  }
  if (
    /rtx 3090|rtx 3080|rtx 4070|rtx 4060 ti|rx 6900|m1 max|m2 pro|m3 pro|m4 pro|a6000|v100/.test(
      r,
    )
  ) {
    return { value: 24, source: "estimated" };
  }
  if (
    /rtx 3060|rtx 3070|rtx 4060|rtx 4050|rx 6700|rx 6800|m1 pro|m2|m3|m4|apple m1|apple m2|apple m3/.test(
      r,
    )
  ) {
    return { value: 8, source: "estimated" };
  }
  if (/iris xe|iris plus|uhd graphics|radeon graphics|vega|intel hd/.test(r)) {
    return { value: 4, source: "estimated" };
  }
  return { value: null, source: "unavailable" };
}

export default class LocalHardwareDetector {
  private static instance: LocalHardwareDetector | null = null;

  public static getInstance(): LocalHardwareDetector {
    if (!LocalHardwareDetector.instance) {
      LocalHardwareDetector.instance = new LocalHardwareDetector();
    }
    return LocalHardwareDetector.instance;
  }

  private constructor() {}

  public detect(): LocalHardware {
    const env = SystemEnvironment.getInstance().get();
    const renderer = env.gpu.renderer;
    const gpuVendor = parseGpuVendor(renderer);
    const vram = estimateVramGB(renderer);

    const accelerator: LocalHardware["gpu"]["accelerator"] = env.gpu.webgpu
      ? "webgpu"
      : env.gpu.webgl
        ? "webgl"
        : "cpu";

    const t = <T>(value: T | null, source: InfoSource = "detected"): TypedValue<T> => ({
      value,
      source,
    });

    return {
      updatedAt: Date.now(),
      os: t(env.os),
      browser: t(env.browser),
      platform: t(env.platform),
      cpuCores: t(env.cpuCores),
      memoryGB: t(env.memoryGB),
      gpu: {
        vendor: { value: gpuVendor.vendor, source: gpuVendor.source },
        webgl: env.gpu.webgl,
        webgpu: env.gpu.webgpu,
        accelerator,
        renderer: { value: renderer, source: renderer ? "detected" : "unavailable" },
        vramGB: { value: vram.value, source: vram.source },
      },
      storage: {
        quotaBytes: t(null as unknown as number, "unavailable"),
        usedBytes: t(null as unknown as number, "unavailable"),
      },
      screen: env.screen
        ? { value: env.screen, source: "detected" }
        : { value: null, source: "unavailable" },
      environment: env.environment,
    };
  }

  public async refresh(): Promise<LocalHardware> {
    await SystemEnvironment.getInstance().refresh();
    const hardware = this.detect();

    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        hardware.storage = {
          quotaBytes: {
            value: estimate.quota ?? null,
            source: estimate.quota !== undefined ? "detected" : "unavailable",
          },
          usedBytes: {
            value: estimate.usage ?? null,
            source: estimate.usage !== undefined ? "detected" : "unavailable",
          },
        };
      } catch {
        hardware.storage = {
          quotaBytes: { value: null, source: "unavailable" },
          usedBytes: { value: null, source: "unavailable" },
        };
      }
    }

    hardware.updatedAt = Date.now();
    return hardware;
  }
}