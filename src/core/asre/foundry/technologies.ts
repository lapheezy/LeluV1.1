/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — TECHNOLOGY DECISION MATRIX
 *
 * Part II of the mission asks for a matrix, not a bibliography: for every
 * candidate, its licence (code and weights separately), whether it needs an
 * account, whether it needs the internet at RUNTIME, what GPU and RAM it really
 * needs, whether it installs here, what it actually produces, how it fails, and
 * the decision.
 *
 * Two rules this file keeps:
 *
 *  1. A repository with no LICENSE file grants nothing. GitHub reporting
 *     `license: null` is the evidence, and it is recorded as such.
 *  2. A research licence on a dependency (SMPL-X, FLAME, Gaussian-Splatting)
 *     restricts everything built on it, even when the repository itself is MIT.
 *
 * `verifiedOn` is the date the licence claim was checked, not the date this file
 * was written. Anything not checked is `install: "untested"` and says so.
 * ==========================================================
 */

export type Decision = "adopt" | "optional" | "reject";
export type Commercial = "yes" | "restricted" | "unknown" | "no";
export type InstallState = "reproduced" | "installed" | "untested" | "not-attempted";

export interface TechnologyRecord {
  id: string;
  name: string;
  repository: string;
  role: string;
  codeLicense: string;
  weightsLicense: string;
  /** Dataset and inherited licences that bind the weights even when the code is free. */
  inherited: string[];
  commercial: Commercial;
  account: boolean;
  /** Downloads needed once vs. calls made at runtime. */
  internet: "download-only" | "runtime" | "none";
  gpu: string;
  ram: string;
  cpuFallback: string;
  install: InstallState;
  quality: string;
  failures: string[];
  integration: string;
  decision: Decision;
  reasons: string[];
  sources: string[];
  verifiedOn: string;
}

const V = "2026-11-19";

export const TECHNOLOGIES: TechnologyRecord[] = [
  {
    id: "blender-cycles",
    name: "Blender 4.2 LTS + Cycles (CPU)",
    repository: "https://projects.blender.org/blender/blender",
    role: "production renderer: geometry, shaders, Cycles, export",
    codeLicense: "GPL-2.0-or-later (the application)",
    weightsLicense: "n/a — no model weights",
    inherited: ["OpenImageDenoise (Apache-2.0) ships inside Cycles"],
    commercial: "yes",
    account: false,
    internet: "download-only",
    gpu: "optional; CPU Cycles is a supported backend",
    ram: "~2 GB for a 1.3 M-triangle character at 1024²",
    cpuFallback: "tested here: Cycles CPU rendered the 1.29 M-triangle LÉLU build in 6.02 s at 512²/16 samples",
    install: "reproduced",
    quality: "physically based path tracing with subsurface scattering; the renders in artifacts/foundry/benchmark are Cycles CPU",
    failures: ["CPU render time scales with samples; a 1024²/64-sample close-up is tens of seconds, not one", "Blender's own GPL does not extend to images it renders or models it exports"],
    integration: "scripts/blender/lelu_foundry_render.py, launched as a child process with a timeout",
    decision: "adopt",
    reasons: ["free, local, no account, no runtime network", "GPL applies to the application we run, not to rendered output", "CPU path measured on this machine"],
    sources: ["https://www.blender.org/about/license/"],
    verifiedOn: V,
  },
  {
    id: "pci-fr",
    name: "PCI-FR 2.3.1 (this repository)",
    repository: "local: src/core/asre/{character,reference,hair,gltf}",
    role: "reference-driven component/human reconstruction and persistent identity",
    codeLicense: "project licence (this repository)",
    weightsLicense: "none — procedural, reference-measured geometry",
    inherited: ["the 39 photographs are the user's own references, read-only"],
    commercial: "yes",
    account: false,
    internet: "none",
    gpu: "none",
    ram: "~1.5 GB during a build (measured: 58.7 s full character build)",
    cpuFallback: "this is the CPU path",
    install: "reproduced",
    quality: "measured: 1 289 906 triangles, jaw 98.7 mm against the sheet's 96 mm, 149 baby strands with 100 % hairline coverage; the forehead defect is documented, not hidden",
    failures: ["component-based, so it cannot invent anatomy the references do not show", "the main hair curtain still starts above the rooted fringe (report 2.3.1 §1)"],
    integration: "npm run m23:youth → GLB → the Foundry project store → Cycles",
    decision: "adopt",
    reasons: ["the only engine here that preserves HER measured identity", "zero spend, zero account, zero network", "its own diagnostics are the validation input"],
    sources: ["artifacts/lelu2/m231/report-2.3.1.md"],
    verifiedOn: V,
  },
  {
    id: "triposr",
    name: "TripoSR",
    repository: "https://github.com/VAST-AI-Research/TripoSR",
    role: "optional generic single-image prop reconstruction (never the canonical human engine)",
    codeLicense: "MIT",
    weightsLicense: "MIT (stabilityai/TripoSR model card)",
    inherited: ["trained on Objaverse renders; the released weights are MIT"],
    commercial: "yes",
    account: false,
    internet: "download-only",
    gpu: "CUDA recommended; a CPU worker exists in services/asre-reconstruct",
    ram: "~4 GB CPU worker",
    cpuFallback: "documented CPU worker in this repository; not timed in this pass",
    install: "untested",
    quality: "coarse single-image geometry; fine for props, not a face",
    failures: ["single view invents the back of the head", "no rig, no eyelids, no hair"],
    integration: "existing ASRE engine \"triposr\" behind the same job ledger",
    decision: "optional",
    reasons: ["MIT code and weights make it legally safe", "the mission forbids it as the canonical human reconstruction engine"],
    sources: ["https://huggingface.co/stabilityai/TripoSR"],
    verifiedOn: V,
  },
  {
    id: "humannova",
    name: "HumanNOVA",
    repository: "https://github.com/HumanNOVA/HumanNOVA",
    role: "single-image photorealistic full-body avatar (triplane)",
    codeLicense: "none — the repository has no LICENSE file (GitHub API: license null)",
    weightsLicense: "unstated; distributed as an external asset archive",
    inherited: ["tokenizer/HMR components borrowed from other projects; unlicensed as redistributed"],
    commercial: "unknown",
    account: false,
    internet: "download-only",
    gpu: "CUDA 12.1 setup script; run.py falls back to CPU only in code",
    ram: "not documented",
    cpuFallback: "the CLI accepts cpu, but the pipeline uses CUDA-only kernels in practice; untested",
    install: "not-attempted",
    quality: "CVPR 2026 highlight; paper reports sub-second feed-forward avatars",
    failures: ["no licence = no grant to use, modify or redistribute", "checkpoint delivered as an external link with no separate terms"],
    integration: "none",
    decision: "reject",
    reasons: [
      "requirement 6/7: a repository without a LICENSE file grants no rights, and 'open source' cannot be assumed",
      "no GPU on this machine; the setup targets CUDA 12.1",
    ],
    sources: ["https://github.com/HumanNOVA/HumanNOVA", "https://api.github.com/repos/HumanNOVA/HumanNOVA"],
    verifiedOn: V,
  },
  {
    id: "idol",
    name: "IDOL",
    repository: "https://github.com/yiyuzhuang/IDOL",
    role: "single-image photorealistic human (Gaussian avatar) + editing",
    codeLicense: "MIT",
    weightsLicense: "IDOL checkpoint on Hugging Face; SMPL-X/FLAME templates are downloaded separately",
    inherited: ["SMPL-X: academic research only (commercial via Meshcapade)", "FLAME: research licence", "HuGe100K dataset: DeepFashion images may not be redistributed or commercially exploited"],
    commercial: "no",
    account: true,
    internet: "download-only",
    gpu: "NVIDIA CUDA 11.8, 24 GB VRAM recommended",
    ram: "≥ 15 GB storage; RAM undocumented",
    cpuFallback: "none documented",
    install: "not-attempted",
    quality: "1K Gaussian avatars, editable; research demonstrations only",
    failures: ["registration on the SMPL-X and FLAME sites is mandatory", "the SMPL-X licence forbids commercial use and redistribution", "24 GB VRAM unavailable here"],
    integration: "none",
    decision: "reject",
    reasons: ["account requirement violates Part I (no mandatory accounts)", "SMPL-X/FLAME make every output non-commercial", "no GPU"],
    sources: ["https://github.com/yiyuzhuang/IDOL", "https://smpl-x.is.tue.mpg.de/modellicense.html"],
    verifiedOn: V,
  },
  {
    id: "pshuman",
    name: "PSHuman",
    repository: "https://github.com/pengHTYX/PSHuman",
    role: "cross-scale multiview diffusion human reconstruction",
    codeLicense: "MIT",
    weightsLicense: "CC BY 4.0 (reported), with an SMPL-free variant",
    inherited: ["SMPL-X templates for the conditioned variant"],
    commercial: "restricted",
    account: false,
    internet: "download-only",
    gpu: "768-resolution model needs > 40 GB VRAM (authors' FAQ)",
    ram: "undocumented; large",
    cpuFallback: "none",
    install: "not-attempted",
    quality: "detailed clothed humans; users report weak proportions and memory failures",
    failures: ["does not fit a 24 GB card, let alone this CPU-only machine", "multiview diffusion invents views rather than measuring them"],
    integration: "none",
    decision: "reject",
    reasons: ["hardware requirement is an order of magnitude beyond this machine", "the mission explicitly forbids making it a default dependency"],
    sources: ["https://github.com/pengHTYX/PSHuman", "https://otoy.studio/guides/run-pshuman-without-a-gpu"],
    verifiedOn: V,
  },
  {
    id: "sam-3d-body",
    name: "SAM 3D Body",
    repository: "https://github.com/facebookresearch/sam-3d-body",
    role: "promptable full-body mesh from one image",
    codeLicense: "MIT",
    weightsLicense: "SAM License (custom Meta terms, not OSI-approved)",
    inherited: ["MHR parametric body model"],
    commercial: "restricted",
    account: true,
    internet: "download-only",
    gpu: "CUDA unconditionally: the estimator moves its batch to the GPU without checking",
    ram: "undocumented",
    cpuFallback: "none — a CPU-only machine raises rather than falling back (independent report)",
    install: "not-attempted",
    quality: "strong pose and shape; body only, no identity-level face",
    failures: ["Hugging Face access must be requested and approved", "no CPU path", "custom weight licence needs review before commercial use"],
    integration: "none",
    decision: "reject",
    reasons: ["gated checkpoint violates the no-account preference and cannot be fetched offline", "no GPU path here"],
    sources: ["https://github.com/facebookresearch/sam-3d-body/blob/main/INSTALL.md", "https://www.libreyolo.com/docs/models/sam-3d-body"],
    verifiedOn: V,
  },
  {
    id: "sapiens2",
    name: "Sapiens2",
    repository: "https://github.com/facebookresearch/sapiens2",
    role: "human vision foundation: pose, segmentation, normals, point maps, matting",
    codeLicense: "custom Meta Sapiens licence (not OSI-approved)",
    weightsLicense: "same custom licence",
    inherited: ["1B pretrained on human images; training-data terms not restated per checkpoint"],
    commercial: "restricted",
    account: false,
    internet: "download-only",
    gpu: "ViT 0.4B–5B; CUDA practical, CPU prohibitive",
    ram: "model-size dependent (5B checkpoint)",
    cpuFallback: "technically possible, not practical",
    install: "not-attempted",
    quality: "excellent 2D/2.5D human analysis; it is NOT a character generator",
    failures: ["cannot produce an editable character mesh", "custom licence needs legal review", "compute far beyond this machine"],
    integration: "none; could later feed landmarks into PCI-FR",
    decision: "reject",
    reasons: ["not a standalone generator (the mission says so and the docs agree)", "custom licence + compute"],
    sources: ["https://github.com/facebookresearch/sapiens2/blob/main/LICENSE.md"],
    verifiedOn: V,
  },
  {
    id: "colmap",
    name: "COLMAP",
    repository: "https://github.com/colmap/colmap",
    role: "SfM/MVS: camera calibration and dense multi-view geometry",
    codeLicense: "BSD-3-Clause",
    weightsLicense: "n/a",
    inherited: ["third-party deps (Ceres, PoseLib, SIFT GPU) separately licensed"],
    commercial: "yes",
    account: false,
    internet: "none",
    gpu: "optional; CPU SfM/MVS supported (CUDA speeds up dense stereo)",
    ram: "several GB for a dense reconstruction",
    cpuFallback: "documented and widely used",
    install: "untested",
    quality: "the reference implementation for multi-view geometry",
    failures: ["needs many calibrated views of ONE static subject; the 39 references are different hairstyles and expressions, not a capture set"],
    integration: "optional CLI behind the Foundry's acquisition step",
    decision: "optional",
    reasons: ["legally clean and CPU-capable", "no suitable capture set exists, so nothing was claimed"],
    sources: ["https://colmap.github.io/license.html"],
    verifiedOn: V,
  },
  {
    id: "meshroom",
    name: "Meshroom / AliceVision",
    repository: "https://github.com/alicevision/Meshroom",
    role: "photogrammetry to textured mesh",
    codeLicense: "MPL-2.0",
    weightsLicense: "n/a",
    inherited: ["Qt/PySide6 (LGPL-3.0)"],
    commercial: "yes",
    account: false,
    internet: "download-only",
    gpu: "the full MVS depth-map step requires an NVIDIA CUDA GPU",
    ram: "8–16 GB for a dense scene",
    cpuFallback: "partial; the MVS stage is CUDA-bound",
    install: "not-attempted",
    quality: "good textured meshes from capture sets",
    failures: ["CUDA requirement", "photogrammetry cannot recover hair or eyelids from these references"],
    integration: "none",
    decision: "reject",
    reasons: ["CUDA-bound MVS on a machine with no GPU", "wrong tool for a single-subject stylised character"],
    sources: ["https://github.com/alicevision/AliceVision/blob/develop/COPYING.md"],
    verifiedOn: V,
  },
  {
    id: "nerfstudio",
    name: "Nerfstudio",
    repository: "https://github.com/nerfstudio-project/nerfstudio",
    role: "NeRF / Gaussian-splatting appearance reconstruction",
    codeLicense: "Apache-2.0",
    weightsLicense: "n/a (trained per scene)",
    inherited: ["tiny-cuda-nn, nerfacc, gsplat: CUDA extensions"],
    commercial: "yes",
    account: false,
    internet: "download-only",
    gpu: "CUDA GPU required for training",
    ram: "6–24 GB VRAM depending on method",
    cpuFallback: "none practical",
    install: "not-attempted",
    quality: "photoreal appearance, not an editable mesh",
    failures: ["an appearance representation is not riggable geometry (the mission warns about exactly this)", "no GPU"],
    integration: "none",
    decision: "reject",
    reasons: ["CUDA-only training", "cannot yield the editable, riggable character the Foundry needs"],
    sources: ["https://docs.nerf.studio/"],
    verifiedOn: V,
  },
  {
    id: "openmvs",
    name: "OpenMVS",
    repository: "https://github.com/cdcseacave/openMVS",
    role: "dense reconstruction and texturing",
    codeLicense: "AGPL-3.0",
    weightsLicense: "n/a",
    inherited: ["AGPL propagates to the combined work if linked into a service"],
    commercial: "restricted",
    account: false,
    internet: "none",
    gpu: "optional CUDA",
    ram: "4–16 GB",
    cpuFallback: "documented",
    install: "not-attempted",
    quality: "solid dense meshes",
    failures: ["AGPL-3.0 distribution obligations for a hosted product", "same capture-set problem as COLMAP"],
    integration: "none",
    decision: "reject",
    reasons: ["AGPL-3.0 is incompatible with shipping it inside LÉLU without opening the combined work"],
    sources: ["https://github.com/cdcseacave/openMVS"],
    verifiedOn: V,
  },
  {
    id: "sugar",
    name: "SuGaR",
    repository: "https://github.com/Anttwo/SuGaR",
    role: "Gaussian splatting to surface mesh",
    codeLicense: "Inria/MPII Gaussian-Splatting licence — research and evaluation only",
    weightsLicense: "same",
    inherited: ["gaussian-splatting (Inria/MPII), CUDA rasteriser"],
    commercial: "no",
    account: false,
    internet: "download-only",
    gpu: "CUDA, 24 GB recommended",
    ram: "16 GB+",
    cpuFallback: "none",
    install: "not-attempted",
    quality: "fast surface extraction from splats",
    failures: ["licence grants non-commercial research use only", "needs a splat capture and a GPU"],
    integration: "none",
    decision: "reject",
    reasons: ["research-only licence", "no GPU, no capture"],
    sources: ["https://github.com/Anttwo/SuGaR/blob/main/LICENSE.md"],
    verifiedOn: V,
  },
  {
    id: "stable-fast-3d",
    name: "Stable Fast 3D",
    repository: "https://github.com/Stability-AI/stable-fast-3d",
    role: "optional prop reconstruction with UVs",
    codeLicense: "Stability AI Community License",
    weightsLicense: "Stability AI Community License (gated on Hugging Face)",
    inherited: ["trained on Objaverse and internal data"],
    commercial: "restricted",
    account: true,
    internet: "download-only",
    gpu: "CUDA, ~7 GB VRAM",
    ram: "8 GB+",
    cpuFallback: "none official",
    install: "not-attempted",
    quality: "good props, not humans",
    failures: ["gated weights need a Hugging Face account", "community licence has revenue and use restrictions"],
    integration: "none",
    decision: "reject",
    reasons: ["gated account + restricted licence + no GPU", "TripoSR already covers props under MIT"],
    sources: ["https://github.com/Stability-AI/stable-fast-3d"],
    verifiedOn: V,
  },
];

export type EngineKind = "human-from-photos" | "prop-from-photo" | "render" | "photogrammetry" | "appearance";

export interface EngineChoice {
  kind: EngineKind;
  chosen: TechnologyRecord | null;
  blocked: TechnologyRecord[];
  reason: string;
}

const PREFERRED: Record<EngineKind, string[]> = {
  "human-from-photos": ["pci-fr"],
  "prop-from-photo": ["triposr"],
  render: ["blender-cycles"],
  photogrammetry: ["colmap", "meshroom"],
  appearance: ["nerfstudio", "sugar"],
};

/**
 * Pick an engine for a job, on this machine. A GPU requirement the machine
 * cannot meet, an account gate, or a non-commercial licence blocks the choice —
 * the refusal names the rule, not a vague "unsupported".
 */
export function chooseEngine(kind: EngineKind, hasGpu: boolean): EngineChoice {
  const blocked: TechnologyRecord[] = [];
  for (const id of PREFERRED[kind]) {
    const record = TECHNOLOGIES.find((t) => t.id === id);
    if (!record) continue;
    if (record.decision === "reject") {
      blocked.push(record);
      continue;
    }
    if (record.account) {
      blocked.push(record);
      continue;
    }
    // A GPU-bound engine without a CPU path is blocked when there is no GPU.
    // "CUDA recommended, CPU worker exists" is not blocked — it is a CPU path.
    const gpuBound = /cuda/i.test(record.gpu) && !/cpu/i.test(record.gpu);
    if (!hasGpu && gpuBound) {
      blocked.push(record);
      continue;
    }
    const chosen = record;
    return {
      kind,
      chosen,
      blocked,
      reason: chosen.decision === "adopt" ? `${chosen.name} is adopted locally: ${chosen.reasons[0]}` : `${chosen.name} is the only viable optional engine for ${kind}`,
    };
  }
  return {
    kind,
    chosen: null,
    blocked,
    reason:
      blocked.length > 0
        ? `No permitted engine for ${kind}: ${blocked.map((b) => `${b.name} (${b.reasons[0]})`).join("; ")}`
        : `No engine is registered for ${kind}.`,
  };
}

export interface LicenceAudit {
  total: number;
  adopt: number;
  optional: number;
  reject: number;
  commercialOk: string[];
  restricted: string[];
  unlicensed: string[];
  gated: string[];
  /** Requirement violations the project must never ship. */
  violations: string[];
}

export function auditLicences(records: TechnologyRecord[] = TECHNOLOGIES): LicenceAudit {
  const commercialOk = records.filter((r) => r.commercial === "yes").map((r) => r.id);
  const restricted = records.filter((r) => r.commercial === "restricted" || r.commercial === "no").map((r) => r.id);
  const unlicensed = records.filter((r) => /none|unstated/i.test(r.codeLicense)).map((r) => r.id);
  const gated = records.filter((r) => r.account).map((r) => r.id);
  const violations: string[] = [];
  for (const r of records) {
    if (r.decision !== "reject" && r.commercial !== "yes") violations.push(`${r.id} is marked ${r.decision} but its commercial rights are ${r.commercial}`);
    if (r.decision !== "reject" && r.account) violations.push(`${r.id} is marked ${r.decision} but requires an account`);
    if (r.decision !== "reject" && /AGPL|research and evaluation only/i.test(r.codeLicense)) violations.push(`${r.id} is marked ${r.decision} under ${r.codeLicense}`);
  }
  return {
    total: records.length,
    adopt: records.filter((r) => r.decision === "adopt").length,
    optional: records.filter((r) => r.decision === "optional").length,
    reject: records.filter((r) => r.decision === "reject").length,
    commercialOk,
    restricted,
    unlicensed,
    gated,
    violations,
  };
}

/** Everything a chat answer needs, without the prose. */
export function technologyBrief(records: TechnologyRecord[] = TECHNOLOGIES): { adopted: string[]; optional: string[]; rejected: Array<{ id: string; why: string }> } {
  return {
    adopted: records.filter((r) => r.decision === "adopt").map((r) => `${r.name}: ${r.reasons[0]}`),
    optional: records.filter((r) => r.decision === "optional").map((r) => `${r.name}: ${r.reasons[0]}`),
    rejected: records.filter((r) => r.decision === "reject").map((r) => ({ id: r.id, why: r.reasons[0] })),
  };
}
