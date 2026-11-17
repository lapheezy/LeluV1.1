/**
 * ==========================================================
 * TEMPORAL STUDIO — MODEL CAPABILITY REGISTRY
 *
 * One entry per candidate model or library the reconstruction
 * engine may call. Every field is a fact taken from a primary
 * source (LICENSE file, model card, README) and recorded with
 * the source URLs and the date it was checked.
 *
 * The registry exists because "open source" is not a licence.
 * Code may be MIT while the weights are non-commercial; a repo
 * may be Apache-2.0 while its checkpoints need an access
 * request. Both distinctions are encoded here so the scheduler
 * cannot accidentally route a commercial build through a
 * research-only checkpoint.
 *
 * Deliberately dependency-free and framework-free: this module
 * must be importable by the engine, a CLI worker, or a browser
 * inspector without pulling in LÉLU's app stack.
 * ==========================================================
 */

/** What a capability produces. */
export type CapabilityTask =
  | "depth"            // monocular / multi-view depth and point maps
  | "segmentation"     // masks and subject dissection
  | "image-to-3d"      // single image to geometry
  | "human-recon"      // human-specific body/pose reconstruction
  | "image-generation" // reference expansion, novel views, editing
  | "registration"     // multi-view alignment, fusion
  | "representation"   // numerical encoding / round trip
  | "validation";      // inspection and comparison tooling

/** Whether the licence permits commercial use. */
export type CommercialUse = "permitted" | "prohibited" | "unverified" | "restricted";

/** Whether weights can be redistributed inside a shipped product. */
export type Redistribution = "allowed" | "not-allowed" | "unverified";

/** How checkpoints are obtained. */
export type Gating = "none" | "access-request" | "token";

/** Runtime cost classification, matching LÉLU's spend policy vocabulary. */
export type CostClass = "free" | "paid";

export interface LicenceFact {
  /** SPDX-ish identifier or the licence's own name. */
  id: string;
  commercial: CommercialUse;
  /** True only when the source states this licence for the weights themselves. */
  statedForWeights?: boolean;
}

export interface ModelCapability {
  id: string;
  displayName: string;
  provider: string;
  tasks: CapabilityTask[];
  repository: string;
  weightsRepository?: string;
  codeLicence: LicenceFact;
  weightsLicence: LicenceFact;
  gating: Gating;
  redistribution: Redistribution;
  /** Minimum GPU memory the source states, in GB. null = not stated in source. */
  minVramGb: number | null;
  /** true = source supports it, false = source says GPU only, "unstated" = no claim. */
  runsOnCpu: boolean | "unstated";
  costClass: CostClass;
  /** Numbers the source itself published, with the hardware it published them for. */
  publishedPerformance?: { note: string; source: string };
  /** Facts that change how the entry may be used. */
  caveats: string[];
  /** Primary sources this entry was verified against. */
  verifiedAgainst: string[];
  /** ISO date this entry was last checked against its sources. */
  verifiedAt: string;
}

const CHECKED = "2026-11-17";

/* ------------------------------------------------------------------ *
 * Entries
 * ------------------------------------------------------------------ */

export const MODEL_REGISTRY: readonly ModelCapability[] = [
  {
    id: "triposr",
    displayName: "TripoSR",
    provider: "Tripo AI & Stability AI",
    tasks: ["image-to-3d"],
    repository: "https://github.com/VAST-AI-Research/TripoSR",
    weightsRepository: "https://huggingface.co/stabilityai/TripoSR",
    codeLicence: { id: "MIT", commercial: "permitted" },
    weightsLicence: { id: "MIT", commercial: "permitted", statedForWeights: true },
    gating: "none",
    redistribution: "allowed",
    minVramGb: 6,
    runsOnCpu: true,
    costClass: "free",
    publishedPerformance: {
      note: "<0.5 s per image on an NVIDIA A100",
      source: "https://github.com/VAST-AI-Research/TripoSR",
    },
    caveats: [
      "Single-shell output: fused fingers, no separation of hair from clothing, no rig.",
      "The model card still carries leftover extra_gated_fields metadata while the Hub reports gated:false and no access request exists.",
      "run.py falls back to CPU when CUDA is absent; --chunk-size lowers VRAM.",
    ],
    verifiedAgainst: [
      "https://github.com/VAST-AI-Research/TripoSR/blob/main/LICENSE",
      "https://github.com/VAST-AI-Research/TripoSR/blob/main/README.md",
      "https://huggingface.co/stabilityai/TripoSR",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "trellis2",
    displayName: "TRELLIS.2 (4B)",
    provider: "Microsoft Research",
    tasks: ["image-to-3d", "representation"],
    repository: "https://github.com/microsoft/TRELLIS.2",
    weightsRepository: "https://huggingface.co/microsoft/TRELLIS.2-4B",
    codeLicence: { id: "MIT", commercial: "permitted" },
    weightsLicence: { id: "MIT", commercial: "permitted", statedForWeights: true },
    gating: "none",
    redistribution: "allowed",
    minVramGb: 24,
    runsOnCpu: false,
    costClass: "free",
    publishedPerformance: {
      note: "H100: ~3 s at 512³, ~17 s at 1024³, ~60 s at 1536³",
      source: "https://github.com/microsoft/TRELLIS.2",
    },
    caveats: [
      "Requires an NVIDIA GPU with at least 24 GB; generation has no CPU path.",
      "Mesh <-> O-Voxel conversion does run on CPU (mesh to O-Voxel <10 s).",
      "Separate terms apply to dependencies nvdiffrast and nvdiffrec.",
    ],
    verifiedAgainst: [
      "https://github.com/microsoft/TRELLIS.2/blob/main/LICENSE",
      "https://github.com/microsoft/TRELLIS.2/blob/main/README.md",
      "https://huggingface.co/api/models/microsoft/TRELLIS.2-4B",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "ovoxel",
    displayName: "O-Voxel (Flexible Dual Grid)",
    provider: "Microsoft Research",
    tasks: ["representation"],
    repository: "https://github.com/microsoft/TRELLIS.2/tree/main/o-voxel",
    codeLicence: { id: "MIT", commercial: "permitted" },
    weightsLicence: { id: "MIT", commercial: "permitted", statedForWeights: true },
    gating: "none",
    redistribution: "allowed",
    minVramGb: null,
    runsOnCpu: true,
    costClass: "free",
    caveats: [
      "Sparse surface voxels with a dual vertex per voxel plus per-voxel attributes; handles open and non-manifold surfaces.",
      "File formats: .npz, .ply and .vxz. vxz is 'VXZ' magic + version byte + big-endian offset + JSON metadata + binary chunks, 256-voxel chunks, LZMA, Morton order.",
      "Adopt as an adapter for ASRE's sparse representation rather than inventing a competing one.",
    ],
    verifiedAgainst: [
      "https://github.com/microsoft/TRELLIS.2/blob/main/o-voxel/README.md",
      "https://github.com/microsoft/TRELLIS.2/blob/main/o-voxel/o_voxel/io/vxz.py",
      "https://github.com/microsoft/TRELLIS.2/blob/main/o-voxel/examples/mesh2ovox.py",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "depth-anything-3-small",
    displayName: "Depth-Anything-3 (BASE / SMALL / METRIC-LARGE / MONO-LARGE)",
    provider: "ByteDance Seed",
    tasks: ["depth"],
    repository: "https://github.com/ByteDance-Seed/Depth-Anything-3",
    weightsRepository: "https://huggingface.co/depth-anything/DA3-BASE",
    codeLicence: { id: "Apache-2.0", commercial: "permitted" },
    weightsLicence: { id: "Apache-2.0", commercial: "permitted", statedForWeights: true },
    gating: "none",
    redistribution: "allowed",
    minVramGb: null,
    runsOnCpu: "unstated",
    costClass: "free",
    caveats: [
      "ONLY these checkpoints are Apache-2.0. The GIANT and LARGE families are CC BY-NC 4.0 and are registered separately as non-commercial.",
      "No per-image VRAM figure or wall-clock time is published; the only hardware claim is <12 GB for the streaming video path.",
      "Model-card example selects cuda when available else cpu, but CPU is not documented as a supported benchmark.",
    ],
    verifiedAgainst: [
      "https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/LICENSE",
      "https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/README.md",
      "https://huggingface.co/depth-anything/DA3-BASE",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "depth-anything-3-giant",
    displayName: "Depth-Anything-3 (GIANT / LARGE)",
    provider: "ByteDance Seed",
    tasks: ["depth"],
    repository: "https://github.com/ByteDance-Seed/Depth-Anything-3",
    weightsRepository: "https://huggingface.co/depth-anything/DA3-GIANT-1.1",
    codeLicence: { id: "Apache-2.0", commercial: "permitted" },
    weightsLicence: { id: "CC-BY-NC-4.0", commercial: "prohibited", statedForWeights: true },
    gating: "none",
    redistribution: "not-allowed",
    minVramGb: null,
    runsOnCpu: "unstated",
    costClass: "free",
    caveats: [
      "Weights are CC BY-NC 4.0: non-commercial only. Registered so the scheduler can refuse it in any commercial build.",
      "The model card states 'Non-commercial use only due to CC BY-NC 4.0 license'.",
    ],
    verifiedAgainst: [
      "https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/README.md",
      "https://huggingface.co/depth-anything/DA3-GIANT-1.1",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "moge",
    displayName: "MoGe",
    provider: "Microsoft Research Asia",
    tasks: ["depth"],
    repository: "https://github.com/microsoft/moge",
    weightsRepository: "https://huggingface.co/Ruicheng/moge-2-vitl",
    codeLicence: { id: "MIT", commercial: "permitted" },
    weightsLicence: { id: "MIT (Hub tag only)", commercial: "unverified" },
    gating: "none",
    redistribution: "unverified",
    minVramGb: null,
    runsOnCpu: true,
    costClass: "free",
    publishedPerformance: {
      note: "60 ms per image on A100 or RTX 3090, FP16, ViT-L",
      source: "https://github.com/microsoft/moge",
    },
    caveats: [
      "The repo's licence section covers code only; the weights licence exists only as a Hub tag, and open issue #98 asks for clarification. Treated as unverified, not permitted.",
      "Vendored DINOv2 code is Apache-2.0.",
      "--device accepts cpu.",
    ],
    verifiedAgainst: [
      "https://github.com/microsoft/MoGe/blob/main/LICENSE",
      "https://github.com/microsoft/MoGe/blob/main/README.md",
      "https://github.com/microsoft/MoGe/issues/98",
      "https://huggingface.co/api/models/Ruicheng/moge-2-vitl",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "instantmesh",
    displayName: "InstantMesh",
    provider: "Tencent ARC",
    tasks: ["image-to-3d"],
    repository: "https://github.com/TencentARC/InstantMesh",
    weightsRepository: "https://huggingface.co/TencentARC/InstantMesh",
    codeLicence: { id: "Apache-2.0", commercial: "permitted" },
    weightsLicence: { id: "Apache-2.0 (Hub metadata only)", commercial: "unverified" },
    gating: "none",
    redistribution: "unverified",
    minVramGb: null,
    runsOnCpu: false,
    costClass: "free",
    caveats: [
      "The GitHub README states no weights licence and does not separate code from weights; Apache-2.0 comes only from Hub metadata.",
      "README requires CUDA >= 12.1 and xformers; app.py hard-codes torch.device('cuda').",
      "No VRAM figure is published by the project.",
    ],
    verifiedAgainst: [
      "https://github.com/TencentARC/InstantMesh/blob/main/LICENSE",
      "https://huggingface.co/api/models/TencentARC/InstantMesh",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "flux2-klein-4b",
    displayName: "FLUX.2 [klein] 4B",
    provider: "Black Forest Labs",
    tasks: ["image-generation"],
    repository: "https://github.com/black-forest-labs/flux2",
    weightsRepository: "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B",
    codeLicence: { id: "Apache-2.0", commercial: "permitted" },
    weightsLicence: { id: "Apache-2.0", commercial: "permitted", statedForWeights: true },
    gating: "none",
    redistribution: "allowed",
    minVramGb: 8,
    runsOnCpu: "unstated",
    costClass: "free",
    caveats: [
      "Three official VRAM figures disagree: repo ~8 GB, HF card ~13 GB, model page 8.4 GB. Plan for the largest.",
      "CPU inference is not documented; the only CPU reference is enable_model_cpu_offload, which is not CPU-only inference.",
      "Ungated download; weights fetched automatically when env vars are absent.",
    ],
    verifiedAgainst: [
      "https://github.com/black-forest-labs/flux2/blob/main/LICENSE.md",
      "https://huggingface.co/black-forest-labs/FLUX.2-klein-4B",
      "https://bfl.ai/models/flux-2-klein",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "comfyui",
    displayName: "ComfyUI",
    provider: "Comfy Org",
    tasks: ["image-generation"],
    repository: "https://github.com/Comfy-Org/ComfyUI",
    codeLicence: { id: "GPL-3.0", commercial: "restricted" },
    weightsLicence: { id: "none (ships no weights)", commercial: "unverified" },
    gating: "none",
    redistribution: "not-allowed",
    minVramGb: null,
    runsOnCpu: true,
    costClass: "free",
    caveats: [
      "GPL-3.0: commercial USE is allowed, but conveying a derivative forces source disclosure. Must be invoked as a separate local process over HTTP, never linked into the engine.",
      "Ships no weights; every model's licence applies separately.",
      "--cpu runs everything on CPU, documented as slow.",
    ],
    verifiedAgainst: [
      "https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE",
      "https://github.com/Comfy-Org/ComfyUI",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "sam2",
    displayName: "SAM 2",
    provider: "Meta AI (facebookresearch)",
    tasks: ["segmentation"],
    repository: "https://github.com/facebookresearch/sam2",
    weightsRepository: "https://dl.fbaipublicfiles.com/segment_anything_2/",
    codeLicence: { id: "Apache-2.0", commercial: "permitted" },
    weightsLicence: { id: "Apache-2.0", commercial: "permitted", statedForWeights: true },
    gating: "none",
    redistribution: "allowed",
    minVramGb: null,
    runsOnCpu: true,
    costClass: "free",
    caveats: [
      "README explicitly licenses checkpoints, demo and training code under Apache 2.0.",
      "Checkpoints download directly from fbaipublicfiles with no auth.",
      "CPU/MPS support is official; the optional CUDA extension is not required.",
    ],
    verifiedAgainst: [
      "https://github.com/facebookresearch/sam2",
      "https://github.com/facebookresearch/sam2/blob/main/LICENSE",
      "https://github.com/facebookresearch/sam2/commit/1034ee2a1aecd24dcd58feba6dbbdefc7935561e",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "sam3d-body",
    displayName: "SAM 3D Body",
    provider: "Meta AI (facebookresearch)",
    tasks: ["human-recon", "segmentation"],
    repository: "https://github.com/facebookresearch/sam-3d-body",
    codeLicence: { id: "SAM License", commercial: "restricted" },
    weightsLicence: { id: "SAM License", commercial: "restricted", statedForWeights: true },
    gating: "access-request",
    redistribution: "not-allowed",
    minVramGb: null,
    runsOnCpu: "unstated",
    costClass: "free",
    caveats: [
      "SAM License grants use, modification and distribution but explicitly omits a sublicence right, and bans ITAR / military end uses.",
      "Checkpoints require an approved Hugging Face access request plus an auth token.",
      "No CPU support statement; demo.py only falls back to cpu.",
    ],
    verifiedAgainst: [
      "https://github.com/facebookresearch/sam-3d-body",
      "https://github.com/facebookresearch/sam-3d-body/blob/main/INSTALL.md",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "sam3d-objects",
    displayName: "SAM 3D Objects",
    provider: "Meta AI (facebookresearch)",
    tasks: ["image-to-3d", "segmentation"],
    repository: "https://github.com/facebookresearch/sam-3d-objects",
    codeLicence: { id: "SAM License", commercial: "restricted" },
    weightsLicence: { id: "SAM License", commercial: "restricted", statedForWeights: true },
    gating: "access-request",
    redistribution: "not-allowed",
    minVramGb: 32,
    runsOnCpu: false,
    costClass: "free",
    caveats: [
      "Requires an NVIDIA GPU with at least 32 GB VRAM; spconv and pytorch3d make it NVIDIA-only.",
      "Access request plus authentication required; sanctioned jurisdictions are rejected.",
      "Same SAM License: no sublicence grant.",
    ],
    verifiedAgainst: [
      "https://github.com/facebookresearch/sam-3d-objects",
      "https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md",
      "https://github.com/facebookresearch/sam-3d-objects/issues/6",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "open3d",
    displayName: "Open3D",
    provider: "Intel Labs / Open3D contributors",
    tasks: ["registration", "validation", "representation"],
    repository: "https://github.com/isl-org/Open3D",
    codeLicence: { id: "MIT", commercial: "permitted" },
    weightsLicence: { id: "none (no weights)", commercial: "permitted" },
    gating: "none",
    redistribution: "allowed",
    minVramGb: null,
    runsOnCpu: true,
    costClass: "free",
    caveats: [
      "Python bindings; CPU-only wheel documented; headless CPU rendering documented.",
      "Supports TSDF fusion (Uniform, Scalable, Voxel Block Grid) — the basis for temporal accumulation.",
      "gltf/glb mesh IO is supported; USD import is experimental with no export.",
    ],
    verifiedAgainst: [
      "https://github.com/isl-org/Open3D/blob/main/LICENSE",
      "https://www.open3d.org/docs/latest/tutorial/geometry/file_io.html",
      "https://www.open3d.org/docs/latest/tutorial/t_reconstruction_system/integration.html",
    ],
    verifiedAt: CHECKED,
  },
  {
    id: "colmap",
    displayName: "COLMAP",
    provider: "Johannes L. Schönberger et al.",
    tasks: ["registration"],
    repository: "https://github.com/colmap/colmap",
    codeLicence: { id: "BSD-3-Clause", commercial: "permitted" },
    weightsLicence: { id: "none (no weights)", commercial: "permitted" },
    gating: "none",
    redistribution: "allowed",
    minVramGb: null,
    runsOnCpu: true,
    costClass: "free",
    caveats: [
      "Sparse feature extraction and matching run headless on CPU (use_gpu 0); dense reconstruction is not available without CUDA per the project FAQ.",
      "Dependencies carry their own licences and can change the licence of a build.",
      "PyCOLMAP exposes most functionality to Python.",
    ],
    verifiedAgainst: [
      "https://github.com/colmap/colmap/blob/main/LICENSE",
      "https://colmap.github.io/faq.html",
      "https://colmap.github.io/pycolmap/",
    ],
    verifiedAt: CHECKED,
  },
] as const;

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export function capabilityById(id: string): ModelCapability | undefined {
  return MODEL_REGISTRY.find((entry) => entry.id === id);
}

/**
 * Whether an entry may be used in a commercial build at all.
 * Both licences must be explicitly permitted by their source, and the
 * weights licence must be stated for the weights — a Hub tag alone is not
 * enough, because the directive forbids treating a repo's code licence as
 * covering its checkpoints.
 */
export function isCommercialEligible(entry: ModelCapability): boolean {
  return (
    entry.codeLicence.commercial === "permitted" &&
    entry.weightsLicence.commercial === "permitted" &&
    entry.weightsLicence.statedForWeights === true
  );
}

/** Whether the entry can be bundled into a product we ship. */
export function isDistributable(entry: ModelCapability): boolean {
  return isCommercialEligible(entry) && entry.redistribution === "allowed";
}

/** Whether the entry needs no payment, no account and no approval. */
export function needsNoAccount(entry: ModelCapability): boolean {
  return entry.costClass === "free" && entry.gating === "none";
}

export interface WorkerConstraints {
  /** Available GPU memory in GB. 0 = no GPU available. */
  availableVramGb: number;
  /** Force CPU-only routing. */
  cpuOnly?: boolean;
  /** Exclude anything that is not commercial-eligible outright. */
  commercial: boolean;
}

/**
 * Candidate workers for a task, best first: free and accountless, then
 * fitting the hardware. Nothing is silently substituted — an empty result
 * means the machine cannot run this task and the caller must say so.
 */
export function selectForTask(task: CapabilityTask, constraints: WorkerConstraints): ModelCapability[] {
  return MODEL_REGISTRY.filter((entry) => entry.tasks.includes(task))
    .filter((entry) => entry.costClass === "free")
    .filter((entry) => (constraints.commercial ? isCommercialEligible(entry) : true))
    .filter((entry) => {
      if (constraints.cpuOnly === true) return entry.runsOnCpu === true;
      if (entry.minVramGb === null) return entry.runsOnCpu === true || constraints.availableVramGb > 0;
      return entry.minVramGb <= constraints.availableVramGb;
    })
    .sort((a, b) => {
      const gate = (e: ModelCapability) => (e.gating === "none" ? 0 : 1);
      const cpu = (e: ModelCapability) => (e.runsOnCpu === true ? 0 : 1);
      return gate(a) - gate(b) || cpu(a) - cpu(b) || (a.minVramGb ?? 0) - (b.minVramGb ?? 0);
    });
}

/** Entries that must never appear in a commercial pipeline. */
export function excludedFromCommercialBuild(): ModelCapability[] {
  return MODEL_REGISTRY.filter((entry) => !isCommercialEligible(entry));
}
