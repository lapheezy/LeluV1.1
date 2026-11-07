/**
 * ==========================================================
 * LÉLU CORE — ENVIRONMENT ORCHESTRATION ENGINE (SESSION 02)
 *
 * Operational Execution Layer for Universal Environment Architecture:
 *
 *   INTENT → PLAN → ENVIRONMENT COMPOSITION → EXECUTION → PRESENTATION → FEEDBACK → REVISION
 *
 * Makes LÉLU capable of actively operating her own medium:
 *   1. Dynamically creating workspaces and presentation surfaces.
 *   2. Arranging and mutating visual presentation layouts (grid, split, stack, organic).
 *   3. Generating UI structures & visual specs from natural language.
 *   4. Creating and revising 2D (diagrams, tables, documents) and 3D (Cosmos scenes, objects).
 *   5. Seamlessly moving across active projects with full state preservation.
 *   6. Restoring, updating, snapshotting, and revising environments in-place.
 *
 * Singleton design pattern, framework-free, highly tested and resilient.
 * ==========================================================
 */

import AgentEventBus, { type AgentEvent } from "../agent/AgentEvents";
import WorkspaceEngine, {
  type WorkspaceView,
  type WorkspaceViewKind,
  type WorkspaceLayoutMode,
  type WorkspaceViewState,
} from "../workspace/WorkspaceEngine";
import InterfaceOrchestrator, {
  type ChangeSet,
  type Proposal,
} from "../interface/InterfaceOrchestrator";
import type { VisualSpec } from "../workspace/VisualSpec";

export type EnvironmentTaskCategory =
  | "research"
  | "creative"
  | "development"
  | "data"
  | "planning"
  | "3d"
  | "conversation";

export interface EnvironmentIntent {
  rawRequest: string;
  category: EnvironmentTaskCategory;
  urgency: boolean;
  needs3D: boolean;
  needsWorkspace: boolean;
  needsSplitPresentation: boolean;
  targetArtifact?: string;
  inferredGoal: string;
}

export interface EnvironmentPlanStep {
  id: string;
  action: "compose" | "execute_tool" | "present" | "wait_feedback" | "mutate";
  description: string;
  target?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
}

export interface EnvironmentPlan {
  id: string;
  intent: EnvironmentIntent;
  steps: EnvironmentPlanStep[];
  suggestedPreset?: string;
  recommendedLayout: WorkspaceLayoutMode;
  createdAt: number;
}

export interface SurfaceComposition {
  kind: WorkspaceViewKind;
  title: string;
  spec?: VisualSpec;
  text?: string;
  url?: string;
  pinned?: boolean;
  temporary?: boolean;
  group?: string;
  weight?: number;
}

export interface EnvironmentCompositionRequest {
  title?: string;
  category?: EnvironmentTaskCategory;
  layout?: WorkspaceLayoutMode;
  surfaces: SurfaceComposition[];
  preset?: string;
  sceneObjects?: Array<{
    kind: "planet" | "moon" | "star" | "nebula" | "crystal" | "flora" | "orb" | "river" | "particles" | "artboard" | "light" | "model";
    label: string;
    color?: string;
    position?: [number, number, number];
    scale?: number;
  }>;
}

export interface EnvironmentStateSnapshot {
  id: string;
  name: string;
  timestamp: number;
  category: EnvironmentTaskCategory;
  workspaceSnapshot: {
    views: WorkspaceView[];
    focusId: string | null;
    layout: WorkspaceLayoutMode;
  };
  interfaceVersion: number;
  metadata?: Record<string, unknown>;
}

export default class EnvironmentOrchestrationEngine {
  private static instance: EnvironmentOrchestrationEngine | null = null;
  private readonly workspace = WorkspaceEngine.getInstance();
  private readonly interfaceOrchestrator = InterfaceOrchestrator.getInstance();
  private readonly events = AgentEventBus.getInstance();

  private activePlan: EnvironmentPlan | null = null;
  private snapshots: Map<string, EnvironmentStateSnapshot> = new Map();
  private revisionHistory: Array<{
    turnId: string;
    summary: string;
    appliedAt: number;
    viewsAffected: string[];
  }> = [];

  private constructor() {}

  public static getInstance(): EnvironmentOrchestrationEngine {
    if (!EnvironmentOrchestrationEngine.instance) {
      EnvironmentOrchestrationEngine.instance = new EnvironmentOrchestrationEngine();
    }
    return EnvironmentOrchestrationEngine.instance;
  }

  // ============================================================
  // 1. INTENT RECOGNITION & PARSING
  // ============================================================

  public analyzeIntent(request: string): EnvironmentIntent {
    const lower = request.toLowerCase();
    let category: EnvironmentTaskCategory = "conversation";

    if (/\b(research|investigate|study|look up|search|sources|papers|arxiv|find out|wiki|news)\b/.test(lower)) {
      category = "research";
    } else if (/\b(draw|sketch|design|creative|art|palette|visualize|compose visual|gallery|artwork)\b/.test(lower)) {
      category = "creative";
    } else if (/\b(code|repository|repo|architecture|inspect|file|refactor|debug|component|typescript|build)\b/.test(lower)) {
      category = "development";
    } else if (/\b(data|metrics|analytics|chart|graph|table|dashboard|stats|measurements)\b/.test(lower)) {
      category = "data";
    } else if (/\b(plan|schedule|roadmap|steps|timeline|workflow|organize|milestones)\b/.test(lower)) {
      category = "planning";
    } else if (/\b(3d|cosmos|planet|spatial|nebula|orbit|scene|celestial|universe|world)\b/.test(lower)) {
      category = "3d";
    }

    const needs3D = category === "3d" || /\b(cosmos|planet|spatial|3d|stars|solar)\b/.test(lower);
    const needsWorkspace = category !== "conversation" || /\b(workspace|surface|window|view|diagram|canvas)\b/.test(lower);
    const needsSplitPresentation = /\b(beside|compare|split|side by side|dual|alongside)\b/.test(lower);

    return {
      rawRequest: request,
      category,
      urgency: /\b(urgent|asap|now|fast|immediately)\b/.test(lower),
      needs3D,
      needsWorkspace,
      needsSplitPresentation,
      inferredGoal: request.slice(0, 200),
    };
  }

  // ============================================================
  // 2. PLAN GENERATION
  // ============================================================

  public createPlan(intent: EnvironmentIntent): EnvironmentPlan {
    const steps: EnvironmentPlanStep[] = [];
    const planId = `env-plan-${Date.now().toString(36)}`;

    // Recommended layout mapping
    let recommendedLayout: WorkspaceLayoutMode = "auto";
    let suggestedPreset: string | undefined = undefined;

    switch (intent.category) {
      case "research":
        recommendedLayout = "split";
        suggestedPreset = "plain-river";
        steps.push({
          id: `${planId}-1`,
          action: "compose",
          description: "Construct research presentation workspace with sources and structured findings",
          status: "pending",
        });
        steps.push({
          id: `${planId}-2`,
          action: "present",
          description: "Display research synthesis & interactive source explorer",
          status: "pending",
        });
        break;

      case "creative":
        recommendedLayout = "grid";
        suggestedPreset = "creative-studio";
        steps.push({
          id: `${planId}-1`,
          action: "compose",
          description: "Initialize visual creation studio with artboard canvas & visual spec",
          status: "pending",
        });
        steps.push({
          id: `${planId}-2`,
          action: "present",
          description: "Render creative artifact with interactive inspection surfaces",
          status: "pending",
        });
        steps.push({
          id: `${planId}-3`,
          action: "wait_feedback",
          description: "Await user feedback or in-place visual revision",
          status: "pending",
        });
        break;

      case "development":
        recommendedLayout = intent.needsSplitPresentation ? "split" : "grid";
        suggestedPreset = "celestial-cosmos";
        steps.push({
          id: `${planId}-1`,
          action: "compose",
          description: "Initialize development workspace with architecture diagram & file explorer",
          status: "pending",
        });
        steps.push({
          id: `${planId}-2`,
          action: "present",
          description: "Render repository structure & interactive component hierarchy",
          status: "pending",
        });
        break;

      case "data":
        recommendedLayout = "grid";
        steps.push({
          id: `${planId}-1`,
          action: "compose",
          description: "Create data visualization dashboard with charts and metric tables",
          status: "pending",
        });
        break;

      case "planning":
        recommendedLayout = "stack";
        steps.push({
          id: `${planId}-1`,
          action: "compose",
          description: "Create interactive timeline and planning sequence space",
          status: "pending",
        });
        break;

      case "3d":
        recommendedLayout = "auto";
        suggestedPreset = "cosmos-garden";
        steps.push({
          id: `${planId}-1`,
          action: "compose",
          description: "Transform spatial Cosmos environment with celestial entities & lighting",
          status: "pending",
        });
        break;

      default:
        steps.push({
          id: `${planId}-1`,
          action: "compose",
          description: "Maintain fluid conversational context",
          status: "pending",
        });
    }

    const plan: EnvironmentPlan = {
      id: planId,
      intent,
      steps,
      suggestedPreset,
      recommendedLayout,
      createdAt: Date.now(),
    };

    this.activePlan = plan;
    return plan;
  }

  // ============================================================
  // 3. ENVIRONMENT COMPOSITION (EXECUTION & PRESENTATION)
  // ============================================================

  public async composeEnvironment(
    request: EnvironmentCompositionRequest,
    taskId?: string,
  ): Promise<{
    ok: boolean;
    createdViews: WorkspaceView[];
    activeLayout: WorkspaceLayoutMode;
    sceneUpdated: boolean;
  }> {
    const id = taskId ?? `task-${Date.now().toString(36)}`;
    const createdViews: WorkspaceView[] = [];

    this.events.emit({
      type: "execution_phase",
      taskId: id,
      phase: "ui_orchestration_started",
      label: `Composing environment: ${request.title ?? request.category ?? "Custom"}`,
      side: "both",
    });

    // 1. Manage layout mode
    if (request.layout) {
      this.workspace.setLayout(request.layout);
    }

    // 2. Create surfaces in workspace
    for (const surface of request.surfaces) {
      const view = this.workspace.openView({
        kind: surface.kind,
        title: surface.title,
        spec: surface.spec,
        text: surface.text,
        url: surface.url,
        pinned: surface.pinned ?? false,
        temporary: surface.temporary ?? false,
        group: surface.group,
        show: true,
        source: { tool: "environment.compose", taskId: id },
      });

      if (surface.weight && surface.weight > 1) {
        this.workspace.resizeView(view.id, surface.weight);
      }
      createdViews.push(view);
    }

    // If split was requested and at least two views exist, establish the split
    if (request.layout === "split" && createdViews.length >= 2) {
      this.workspace.splitView([createdViews[0].id, createdViews[1].id]);
    } else if (createdViews.length > 0) {
      this.workspace.focusView(createdViews[0].id);
    }

    // 3. Optional Cosmos 3D Scene Objects update via InterfaceOrchestrator
    let sceneUpdated = false;
    if (request.sceneObjects && request.sceneObjects.length > 0) {
      try {
        const changes: ChangeSet = {
          description: `Add ${request.sceneObjects.length} scene objects for ${request.title ?? "environment"}`,
          scene: request.sceneObjects.map((obj) => ({
            op: "add",
            object: {
              kind: obj.kind,
              label: obj.label,
              color: obj.color ?? "#60a5fa",
              position: obj.position ?? [0, 0, -5],
              scale: obj.scale ?? 1,
            },
          })),
        };

        const prop = this.interfaceOrchestrator.propose(changes, { origin: "lelu" });
        if (prop.ok && prop.proposal) {
          // Auto-apply benign visual 3D additions in the autonomous environment flow
          this.interfaceOrchestrator.decide(prop.proposal.id, "approved");
          sceneUpdated = true;
        }
      } catch (err) {
        console.warn("[EnvironmentOrchestrationEngine] Scene composition non-fatal fallback:", err);
      }
    }

    this.events.emit({
      type: "execution_phase",
      taskId: id,
      phase: "ui_orchestration_completed",
      label: `Environment ready with ${createdViews.length} surface(s)`,
      side: "both",
    });

    return {
      ok: true,
      createdViews,
      activeLayout: this.workspace.getState().layout,
      sceneUpdated,
    };
  }

  // ============================================================
  // 4. NATURAL LANGUAGE INTERFACE SYNTHESIS
  // ============================================================

  public synthesizeInterfaceFromNL(
    prompt: string,
    category: EnvironmentTaskCategory = "development",
  ): SurfaceComposition[] {
    const lower = prompt.toLowerCase();
    const surfaces: SurfaceComposition[] = [];

    if (category === "research" || /\b(research|sources|findings|report)\b/.test(lower)) {
      surfaces.push({
        kind: "table",
        title: "Synthesized Sources & Evidence",
        spec: {
          kind: "table",
          title: "Research Evidence",
          columns: ["Source / Citation", "Domain", "Key Finding", "Status"],
          rows: [
            { "Source / Citation": "Primary Literature", Domain: "Core Corpus", "Key Finding": "Validated hypothesis", Status: "Verified" },
            { "Source / Citation": "Cross-Reference Map", Domain: "Ecosystem Index", "Key Finding": "Coherent multi-model alignment", Status: "Active" },
          ],
        },
      });
      surfaces.push({
        kind: "diagram",
        title: "Topic Relationship Graph",
        spec: {
          kind: "diagram",
          title: "Topic Relationship",
          nodes: [
            { id: "root", label: "Research Anchor", kind: "concept" },
            { id: "evidence_a", label: "Empirical Data", kind: "evidence" },
            { id: "evidence_b", label: "Related Systems", kind: "system" },
          ],
          edges: [
            { from: "root", to: "evidence_a", label: "supports" },
            { from: "root", to: "evidence_b", label: "contextualizes" },
          ],
        },
      });
    } else if (category === "creative" || /\b(design|art|creative|palette)\b/.test(lower)) {
      surfaces.push({
        kind: "diagram",
        title: "Visual Artboard Spec",
        spec: {
          kind: "diagram",
          title: "Composition Artboard",
          nodes: [
            { id: "focal", label: "Hero Centerpiece", color: "#ec4899" },
            { id: "atmosphere", label: "Ambient Lighting & Aura", color: "#8b5cf6" },
            { id: "geometry", label: "Symmetric Crystal Lattice", color: "#3b82f6" },
          ],
          edges: [
            { from: "focal", to: "atmosphere", label: "radiates" },
            { from: "atmosphere", to: "geometry", label: "illuminates" },
          ],
        },
      });
    } else if (category === "data" || /\b(chart|metric|analytics)\b/.test(lower)) {
      surfaces.push({
        kind: "chart",
        title: "System Performance Telemetry",
        spec: {
          kind: "chart",
          title: "Telemetry Stream",
          series: [
            { label: "Token Efficiency", points: [{ label: "T0", value: 40 }, { label: "T1", value: 85 }, { label: "T2", value: 92 }] },
            { label: "Execution Latency (ms)", points: [{ label: "T0", value: 120 }, { label: "T1", value: 65 }, { label: "T2", value: 42 }] },
          ],
        },
      });
    } else {
      // Default Development / Architecture inspect
      surfaces.push({
        kind: "diagram",
        title: "System Architecture Map",
        spec: {
          kind: "diagram",
          title: "Architecture Map",
          nodes: [
            { id: "core", label: "LÉLU CORE", kind: "runtime" },
            { id: "orchestrator", label: "Environment Engine", kind: "orchestrator" },
            { id: "workspace", label: "Workspace Surfaces", kind: "ui" },
            { id: "cosmos", label: "Cosmos Spatial", kind: "3d" },
          ],
          edges: [
            { from: "core", to: "orchestrator", label: "drives" },
            { from: "orchestrator", to: "workspace", label: "projects" },
            { from: "orchestrator", to: "cosmos", label: "manifests" },
          ],
        },
      });
      surfaces.push({
        kind: "file",
        title: "Architecture Overview (Summary)",
        text: `# Architecture Overview\n\n- Active Runtime: Autonomous Environment Orchestration\n- Surfaces: Multi-view dynamic visual workspace\n- Spatial Medium: Live Cosmos engine integration\n- State: Intact and revokable.\n`,
      });
    }

    return surfaces;
  }

  // ============================================================
  // 5. IN-PLACE SURFACE MUTATION & REVISION
  // ============================================================

  public mutateSurface(
    viewId: string,
    patch: {
      title?: string;
      text?: string;
      spec?: VisualSpec;
      url?: string;
      viewState?: Partial<WorkspaceViewState>;
    },
  ): { ok: boolean; view?: WorkspaceView; error?: string } {
    const existing = this.workspace.getState().views.find((v) => v.id === viewId);
    if (!existing) {
      return { ok: false, error: `View "${viewId}" does not exist in active workspace.` };
    }

    // Apply model updates
    this.workspace.updateView(viewId, {
      title: patch.title,
      text: patch.text,
      spec: patch.spec,
      url: patch.url,
    });

    if (patch.viewState) {
      if (patch.viewState.highlighted) {
        this.workspace.focusElements(viewId, patch.viewState.highlighted);
      }
      if (patch.viewState.traced) {
        this.workspace.tracePath(viewId, patch.viewState.traced);
      }
      if (patch.viewState.zoom !== undefined) {
        this.workspace.zoomView(viewId, patch.viewState.zoom);
      }
      if (patch.viewState.pan) {
        this.workspace.panView(viewId, patch.viewState.pan.x, patch.viewState.pan.y);
      }
    }

    const updated = this.workspace.getState().views.find((v) => v.id === viewId);

    // Record revision
    this.revisionHistory.push({
      turnId: `rev-${Date.now().toString(36)}`,
      summary: `Mutated surface [${viewId}] "${updated?.title}"`,
      appliedAt: Date.now(),
      viewsAffected: [viewId],
    });

    return { ok: true, view: updated };
  }

  // ============================================================
  // 6. SNAPSHOT & PROJECT STATE RESTORATION
  // ============================================================

  public saveSnapshot(name: string, category: EnvironmentTaskCategory = "development"): EnvironmentStateSnapshot {
    const state = this.workspace.getState();
    const snapshotId = `snapshot-${Date.now().toString(36)}`;
    const snapshot: EnvironmentStateSnapshot = {
      id: snapshotId,
      name,
      timestamp: Date.now(),
      category,
      workspaceSnapshot: {
        views: state.views.map((v) => ({ ...v })),
        focusId: state.focusId,
        layout: state.layout,
      },
      interfaceVersion: this.interfaceOrchestrator.getLive().version,
    };

    this.snapshots.set(snapshotId, snapshot);
    // Also save in workspace engine layout history
    this.workspace.saveLayout();

    return snapshot;
  }

  public restoreSnapshot(snapshotId: string): { ok: boolean; snapshot?: EnvironmentStateSnapshot; error?: string } {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return { ok: false, error: `Snapshot ${snapshotId} not found.` };
    }

    // Reconstruct workspace
    this.workspace.clear();
    for (const view of snapshot.workspaceSnapshot.views) {
      this.workspace.openView({
        id: view.id,
        kind: view.kind,
        title: view.title,
        spec: view.spec,
        text: view.text,
        url: view.url,
        pinned: view.pinned,
        temporary: view.temporary,
        group: view.group,
        show: true,
      });
      if (view.weight > 1) {
        this.workspace.resizeView(view.id, view.weight);
      }
    }

    this.workspace.setLayout(snapshot.workspaceSnapshot.layout);
    if (snapshot.workspaceSnapshot.focusId) {
      this.workspace.focusView(snapshot.workspaceSnapshot.focusId);
    }

    return { ok: true, snapshot };
  }

  public getActivePlan(): EnvironmentPlan | null {
    return this.activePlan;
  }

  public getSnapshots(): EnvironmentStateSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  public getRevisionHistory(): Array<{ turnId: string; summary: string; appliedAt: number; viewsAffected: string[] }> {
    return this.revisionHistory;
  }
}
