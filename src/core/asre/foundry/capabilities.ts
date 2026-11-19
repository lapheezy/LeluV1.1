/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — CAPABILITIES (server)
 *
 * The mission's Part IV, as code rather than prose: read the machine,
 * then decide — per task — whether it runs on the GPU, on the CPU, at
 * reduced settings, later, or not at all. A plan is a decision with
 * reasons, never a hope.
 *
 * The rule that matters for stability: nothing here starts work. The
 * renderer and the reconstruction workers take this plan, run in their
 * own child process with the plan's timeout, and are killed at the
 * deadline. A slow machine degrades the output; it never takes LÉLU
 * down with it.
 * ==========================================================
 */

import { existsSync, readFileSync, statfsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type TaskNeed = "gpu" | "cpu" | "io";

export interface ComputeTask {
  /** What is being planned, for the report ("cycles-render", "human-reconstruction"). */
  id: string;
  need: TaskNeed;
  /** VRAM the engine actually asks for, in GB. */
  vramGb?: number;
  /** RAM the engine actually asks for, in GB. */
  ramGb?: number;
  /** Expected wall-clock minutes at full settings. */
  minutes?: number;
}

export interface GpuInfo {
  vendor: string;
  name: string;
  vramGb: number;
  backend: "cuda" | "rocm" | "metal" | "vulkan" | "unknown";
}

export interface HardwareProfile {
  platform: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  totalRamGb: number;
  freeDiskGb: number;
  gpu: GpuInfo | null;
  cuda: string | null;
  rocm: boolean;
  blender: { binary: string; version: string | null } | null;
  python: string | null;
  node: string;
  /** How each fact was established — so a report can be audited. */
  evidence: string[];
  probedAt: string;
}

export interface HardwareInput {
  platform: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  totalRamGb: number;
  freeDiskGb: number;
  gpu?: GpuInfo | null;
  cuda?: string | null;
  rocm?: boolean;
  blender?: { binary: string; version: string | null } | null;
  python?: string | null;
  node?: string;
  evidence?: string[];
}

/** Normalise a probe into the profile every planner and report uses. */
export function describeHardware(raw: HardwareInput): HardwareProfile {
  return {
    platform: raw.platform,
    arch: raw.arch,
    cpuCount: Math.max(1, raw.cpuCount),
    cpuModel: raw.cpuModel,
    totalRamGb: raw.totalRamGb,
    freeDiskGb: raw.freeDiskGb,
    gpu: raw.gpu ?? null,
    cuda: raw.cuda ?? null,
    rocm: raw.rocm ?? false,
    blender: raw.blender ?? null,
    python: raw.python ?? null,
    node: raw.node ?? process.version,
    evidence: raw.evidence ?? [],
    probedAt: new Date().toISOString(),
  };
}

function readFirst(paths: string[]): string | null {
  for (const p of paths) {
    try {
      if (existsSync(p)) return readFileSync(p, "utf8").trim();
    } catch {
      /* an unreadable probe file is not evidence of hardware */
    }
  }
  return null;
}

function versionOf(binary: string): string | null {
  try {
    const r = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 15_000 });
    if (r.status !== 0 || !r.stdout) return null;
    return r.stdout.trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Probe THIS machine. Deliberately does not assume NVIDIA: no
 * `nvidia-smi`, no torch, no CUDA toolkit required to answer.
 */
export function probeHardware(env: NodeJS.ProcessEnv = process.env): HardwareProfile {
  const evidence: string[] = [];
  const cpuModel = (() => {
    try {
      const line = readFileSync("/proc/cpuinfo", "utf8")
        .split("\n")
        .find((l) => l.startsWith("model name"));
      return line ? line.split(":").slice(1).join(":").trim() : os.cpus()[0]?.model ?? "unknown";
    } catch {
      return os.cpus()[0]?.model ?? "unknown";
    }
  })();
  evidence.push(`node:os cpus=${os.cpus().length} platform=${process.platform}/${process.arch}`);

  // NVIDIA: the driver's own version file exists only when the driver is loaded.
  const nvidiaVersion = readFirst(["/proc/driver/nvidia/version"]);
  let gpu: GpuInfo | null = null;
  if (nvidiaVersion) {
    const vram = readFirst(["/proc/driver/nvidia/gpus/0/information"]) ?? "";
    const name = /Model:\s*(.+)/.exec(vram)?.[1]?.trim() ?? "NVIDIA GPU";
    const total = Number(/Video Memory:\s*(\d+)\s*MiB/.exec(vram)?.[1] ?? 0) / 1024;
    gpu = { vendor: "nvidia", name, vramGb: Math.round(total) || 0, backend: "cuda" };
    evidence.push(`/proc/driver/nvidia/version present (${nvidiaVersion.split("\n")[0]})`);
  } else if (existsSync("/dev/kfd") || existsSync("/opt/rocm")) {
    gpu = { vendor: "amd", name: "AMD GPU (ROCm node)", vramGb: 0, backend: "rocm" };
    evidence.push("/dev/kfd or /opt/rocm present");
  } else if (existsSync("/dev/dri/renderD128")) {
    gpu = { vendor: "unknown", name: "DRM render node (no vendor driver probed)", vramGb: 0, backend: "vulkan" };
    evidence.push("/dev/dri/renderD128 present");
  } else {
    evidence.push("no /proc/driver/nvidia, /dev/kfd, /opt/rocm or /dev/dri/renderD128 — no usable GPU");
  }

  const cuda = readFirst(["/usr/local/cuda/version.json"]) ? "cuda toolkit present" : null;
  if (cuda) evidence.push("/usr/local/cuda/version.json present");

  const tools = env.LELU_TOOLS || path.join(os.homedir(), "lelu-tools");
  const candidates = [env.LELU_BLENDER_BIN, path.join(tools, "blender-4.2.23-linux-x64", "blender"), "/usr/bin/blender", "/opt/blender/blender"].filter(
    (p): p is string => Boolean(p),
  );
  const blenderBin = candidates.find((p) => existsSync(p)) ?? null;
  const blender = blenderBin ? { binary: blenderBin, version: blenderBin ? versionOf(blenderBin) : null } : null;
  evidence.push(blenderBin ? `Blender at ${blenderBin}` : "Blender not found (LELU_BLENDER_BIN / lelu-tools / PATH)");

  let freeDiskGb = 0;
  try {
    const st = statfsSync(process.cwd());
    freeDiskGb = Math.round(((st.bavail ?? 0) * (st.bsize ?? 0)) / 1e9);
  } catch {
    /* statfs is not available everywhere; an unknown disk stays 0 */
  }

  return describeHardware({
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    cpuModel,
    totalRamGb: Math.round((os.totalmem() / 1e9) * 10) / 10,
    freeDiskGb,
    gpu,
    cuda,
    rocm: existsSync("/dev/kfd"),
    blender,
    python: versionOf("python3"),
    node: process.version,
    evidence,
  });
}

export type Backend = "gpu" | "cpu" | "cpu-reduced" | "deferred" | "refuse";

export interface ExecutionPlan {
  task: ComputeTask;
  backend: Backend;
  threads: number;
  resolutionScale: number;
  samples: number | null;
  timeoutMs: number;
  degraded: boolean;
  /** Every reason, in the order it was considered. */
  reasons: string[];
  /** What to run instead when this plan refuses. */
  alternative: string | null;
}

/** Default Cycles samples for a plan; the renderer may lower but never raise it. */
const BASE_SAMPLES = 64;

/**
 * The execution manager. It is intentionally conservative: it refuses
 * rather than pretending a task can run, because a refused plan is a
 * sentence LÉLU can say in chat while a broken run is a lie.
 */
export function planExecution(task: ComputeTask, hw: HardwareProfile): ExecutionPlan {
  const reasons: string[] = [];
  const threads = Math.max(1, Math.min(8, hw.cpuCount - 1));
  const base: ExecutionPlan = {
    task,
    backend: "cpu",
    threads,
    resolutionScale: 1,
    samples: task.need === "gpu" ? null : BASE_SAMPLES,
    timeoutMs: Math.min(45 * 60_000, Math.max(60_000, Math.round((task.minutes ?? 5) * 90_000))),
    degraded: false,
    reasons,
    alternative: null,
  };

  if (task.need !== "gpu") {
    reasons.push(`needs ${task.need}, which this machine provides directly`);
    if (task.ramGb && task.ramGb > hw.totalRamGb) {
      return {
        ...base,
        backend: "cpu-reduced",
        resolutionScale: 0.5,
        samples: base.samples === null ? null : Math.round(base.samples / 2),
        degraded: true,
        reasons: [...reasons, `needs ${task.ramGb} GB RAM, the machine has ${hw.totalRamGb} GB — halving the working set`],
      };
    }
    if (hw.cpuCount <= 2) {
      return { ...base, backend: "cpu-reduced", resolutionScale: 0.75, degraded: true, reasons: [...reasons, `${hw.cpuCount} vCPU: reduced settings`] };
    }
    return base;
  }

  if (!hw.gpu) {
    return {
      ...base,
      backend: "refuse",
      degraded: true,
      samples: null,
      reasons: [...reasons, "the engine needs a GPU; this machine exposes none"],
      alternative: "PCI-FR silhouette/component reconstruction and Cycles-CPU rendering run here; a GPU-only engine stays optional.",
    };
  }

  const vram = hw.gpu.vramGb;
  if (task.vramGb && vram && vram < task.vramGb) {
    return {
      ...base,
      backend: "refuse",
      degraded: true,
      samples: null,
      reasons: [...reasons, `the engine needs ${task.vramGb} GB VRAM; the GPU has ${vram} GB`],
      alternative: "Run it on a machine that meets the VRAM requirement; nothing on this one will fake it.",
    };
  }

  if (task.ramGb && task.ramGb > hw.totalRamGb) {
    return {
      ...base,
      backend: "refuse",
      degraded: true,
      reasons: [...reasons, `needs ${task.ramGb} GB system RAM; the machine has ${hw.totalRamGb} GB`],
      alternative: "Reduce resolution or run elsewhere; a killed worker is not a reconstruction.",
    };
  }

  return { ...base, backend: "gpu", samples: null, reasons: [...reasons, `GPU present: ${hw.gpu.name} (${vram || "unknown"} GB, ${hw.gpu.backend})`] };
}

export function summariseHardware(hw: HardwareProfile): string {
  const gpu = hw.gpu ? `${hw.gpu.name} ${hw.gpu.vramGb || "?"} GB (${hw.gpu.backend})` : "no GPU";
  return `${hw.cpuCount} vCPU ${hw.cpuModel}, ${hw.totalRamGb} GB RAM, ${hw.freeDiskGb} GB free, ${gpu}, ${hw.blender ? `Blender ${hw.blender.version ?? "present"}` : "no Blender"}, ${hw.python ?? "no python3"}`;
}
