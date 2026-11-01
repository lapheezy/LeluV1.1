/**
 * ==========================================================
 * LÉLU — SESSION 3C: THE SOFTWARE STUDIO
 * TYPES
 *
 * One vocabulary for websites, applications and games. These types
 * describe real artifacts only: a project record is written from what
 * the studio runtime actually returned (a file count, an exit code, a
 * build directory), never from what a model said it did.
 *
 * The Studio does not introduce a second agent system, a second
 * workspace architecture or a second asset library. Projects live in
 * Cosmos through the existing WorkspaceEngine and windows; agents are
 * SHAMAN's; assets are Session 3B's forge ledger.
 * ==========================================================
 */

/** What is being built. */
export type StudioProjectKind = "website" | "application" | "game";

/** A real engine/runtime, not a slide in a comparison table. */
export type StudioEngineId = "web" | "godot" | "unity" | "unreal";

/** Where the result has to run. */
export type StudioTarget = "web" | "pwa" | "mobile" | "desktop";

/** The autonomous development workflow, in order. */
export type StudioPhase =
  | "understand"
  | "research"
  | "architect"
  | "generate"
  | "build"
  | "integrate"
  | "test"
  | "debug"
  | "preview"
  | "approve"
  | "deploy"
  | "maintain";

export const STUDIO_PHASES: readonly StudioPhase[] = [
  "understand",
  "research",
  "architect",
  "generate",
  "build",
  "integrate",
  "test",
  "debug",
  "preview",
  "approve",
  "deploy",
  "maintain",
];

/** Actions that may never be taken autonomously. */
export type ProtectedAction =
  | "production-deploy"
  | "paid-service"
  | "production-database"
  | "auth-security"
  | "secret-management"
  | "lelu-core";

export const PROTECTED_ACTIONS: readonly ProtectedAction[] = [
  "production-deploy",
  "paid-service",
  "production-database",
  "auth-security",
  "secret-management",
  "lelu-core",
];

/** What the project needs. Requirements drive the engine decision. */
export interface StudioRequirements {
  kind: StudioProjectKind;
  /** 2D or 3D. A website has no dimension and leaves this unset. */
  dimension?: "2d" | "3d";
  targets: StudioTarget[];
  multiplayer?: boolean;
  /** Photoreal rendering and very large worlds. */
  photoreal?: boolean;
  /** Number of people who will work in the engine's editor. */
  teamSize?: number;
  /** Needs Session 3B: Blender scenes, Meshy meshes, rigs, animations. */
  assetPipeline?: boolean;
}

export type EngineStatus = "available" | "not-installed" | "unsupported-host";

export interface EngineCapability {
  id: StudioEngineId;
  label: string;
  dimensions: Array<"2d" | "3d">;
  targets: StudioTarget[];
  /** Measured against this runtime, not claimed from marketing pages. */
  status: EngineStatus;
  /** What has to be true to use it here. */
  requires: string[];
  /** Why it is available or not, in this environment specifically. */
  detail: string;
  preview: "in-browser" | "editor" | "none";
}

export interface EngineRecommendation {
  engine: StudioEngineId;
  label: string;
  /** Whether this runtime can actually build and preview the result. */
  supported: boolean;
  confidence: "high" | "medium" | "low";
  rationale: string[];
  stack: string;
  alternatives: Array<{ engine: StudioEngineId; label: string; why: string }>;
  /** Engines considered and rejected, each with the real reason. */
  rejected: Array<{ engine: StudioEngineId; label: string; reason: string }>;
}

export interface StudioVersion {
  id: string;
  label: string;
  createdAt: number;
  files: number;
  bytes: number;
  /** Content hash of the file set, so two versions are comparable. */
  hash: string;
  note?: string;
}

export interface StudioBuildRecord {
  id: string;
  at: number;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  /** Real process output, trimmed by the runtime. */
  output: string;
  /** Where the real build output landed, relative to the project. */
  artifact: string | null;
  bytes: number;
}

export interface StudioTestRecord {
  id: string;
  at: number;
  ok: boolean;
  exitCode: number;
  passed: number;
  failed: number;
  durationMs: number;
  output: string;
}

export interface StudioAssetRef {
  id: string;
  /** Where the asset comes from. 3B owns meshy and blender. */
  source: "meshy" | "blender" | "reference" | "procedural" | "three";
  path: string;
  kind: "model" | "texture" | "animation" | "scene" | "library";
  /** The real state: a file that exists, or a job that has not run. */
  state: "present" | "awaiting_approval" | "missing";
  jobId?: string;
  note?: string;
}

export interface StudioDeployment {
  id: string;
  at: number;
  environment: "preview" | "production";
  /** Where it was written, or why it was refused. */
  target: string;
  status: "prepared" | "published" | "blocked" | "failed";
  url?: string;
  approvedBy?: string;
  note?: string;
}

export interface StudioProject {
  id: string;
  slug: string;
  name: string;
  kind: StudioProjectKind;
  engine: StudioEngineId;
  stack: string;
  /** Real directory inside the studio root on the runtime. */
  root: string;
  createdAt: number;
  updatedAt: number;
  versions: StudioVersion[];
  builds: StudioBuildRecord[];
  tests: StudioTestRecord[];
  assets: StudioAssetRef[];
  deployments: StudioDeployment[];
  /** What the project is and how to run it — written from its README. */
  documentation: string;
  /** Last preview URL the runtime served, if any. */
  previewUrl: string | null;
  /** Last measured upstream health. */
  lastOpenedAt: number | null;
}

/** What a phase had to show before it could be recorded. */
export type StudioEvidence = Record<string, unknown>;

export interface StudioStageRecord {
  phase: StudioPhase;
  at: number;
  ok: boolean;
  evidence: StudioEvidence;
  note?: string;
}

export interface StudioPipelineState {
  projectId: string;
  stages: StudioStageRecord[];
  /** The approval a protected step is waiting on, if any. */
  blockedBy: string | null;
  updatedAt: number;
}

/** A request for a human decision. Created by the model, decided by a person. */
export interface StudioApproval {
  id: string;
  projectId: string;
  action: ProtectedAction;
  /** Exactly what would happen, shown to the person deciding. */
  reason: string;
  requestedAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "denied" | "expired";
  decidedAt: number | null;
  decidedBy: string | null;
  /** Present only when approved: what the person's yes covers. */
  scope: string[];
}

export const STUDIO_PHASE_LABELS: Record<StudioPhase, string> = {
  understand: "Understand",
  research: "Research",
  architect: "Architect",
  generate: "Generate",
  build: "Build",
  integrate: "Integrate",
  test: "Test",
  debug: "Debug",
  preview: "Preview",
  approve: "Approve",
  deploy: "Deploy",
  maintain: "Maintain",
};

export function isProtectedAction(value: string): value is ProtectedAction {
  return (PROTECTED_ACTIONS as readonly string[]).includes(value);
}

/** A URL-safe slug that can never escape the studio root. */
export function studioSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "project";
}
