/**
 * ==========================================================
 * LÉLU
 * ARCHITECTURE MAP — a machine-readable representation of
 * LÉLU's own software
 *
 * Two layers of truth, both real:
 *
 *  1. `allSourceFiles()` enumerates the ACTUAL source tree at
 *     runtime through Vite's import.meta.glob (file paths are
 *     real — this module list is never hand-maintained).
 *  2. The subsystem registry is a curated map built from the
 *     architecture audit: real modules, real dependencies, and
 *     the capabilities each subsystem provides. It is queryable
 *     so LÉLU can answer "where does my memory live?", "what
 *     depends on the provider system?", etc.
 *
 * Relationships are represented as:
 *   subsystem → dependsOn (subsystem ids) → provides (capability ids)
 *   file → subsystem (findByFile)
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type SubsystemKind =
  | "frontend"
  | "core"
  | "storage"
  | "service"
  | "workspace"
  | "creative"
  | "system";

export type SubsystemStatus = "working" | "partial" | "foundation" | "provider-dependent";

export interface ArchitectureSubsystem {
  id: string;
  name: string;
  description: string;
  kind: SubsystemKind;
  /** Real source file paths that make up this subsystem. */
  files: string[];
  /** Subsystem ids this one depends on. */
  dependsOn: string[];
  /** Capability ids this subsystem provides (see CapabilityRegistry). */
  provides: string[];
  status: SubsystemStatus;
}

const KEY = "lelu.archmap.v1";

/** The curated subsystem registry — from the architecture audit. */
export function defaultSubsystems(): ArchitectureSubsystem[] {
  return [
    {
      id: "ui",
      name: "Frontend & interface",
      description:
        "The React entrypoint, the Genesis UI shell, dock navigation, panels, command palette, and scene wiring.",
      kind: "frontend",
      files: [
        "src/main.tsx",
        "src/App.tsx",
        "src/app/scene/genesis/GenesisCore.tsx",
        "src/app/scene/genesis/GenesisInterface.tsx",
        "src/app/scene/genesis/GenesisScene.tsx",
        "src/app/scene/genesis/GenesisDock.tsx",
        "src/app/scene/genesis/GenesisCommandPalette.tsx",
        "src/app/scene/genesis/GenesisWindowFrame.tsx",
        "src/app/scene/genesis/GenesisTheme.ts",
        "src/app/scene/genesis/GenesisNavIcons.tsx",
      ],
      dependsOn: ["core-ai", "memory", "cognition", "storage"],
      provides: ["ui", "navigation", "chat-ui"],
      status: "working",
    },
    {
      id: "core-ai",
      name: "AI service & runtime",
      description:
        "The single AI pipeline: AIService → AIRuntime → AIRouter → Brain (memory/cognition) → providers → offline fallback.",
      kind: "core",
      files: [
        "src/core/AIService.ts",
        "src/core/AIRuntime.ts",
        "src/core/AIRouter.ts",
        "src/core/MemoryBridge.ts",
        "src/core/ProviderRegistry.ts",
        "src/core/router/ProviderResolver.ts",
        "src/core/router/BrainResolver.ts",
        "src/core/router/PlanningResolver.ts",
        "src/core/router/ReasoningResolver.ts",
      ],
      dependsOn: ["providers", "memory", "cognition"],
      provides: ["chat", "delegation", "reasoning", "planning"],
      status: "working",
    },
    {
      id: "providers",
      name: "AI provider registry",
      description:
        "Priority/cooldown/fallback registry of AI + knowledge providers, with per-agent provider preference.",
      kind: "service",
      files: [
        "src/providers/AIProvider.ts",
        "src/providers/BaseProvider.ts",
        "src/core/AIProviderRegistry.ts",
        "src/core/router/ProviderResolver.ts",
      ],
      dependsOn: [],
      provides: ["chat", "delegation", "research"],
      status: "provider-dependent",
    },
    {
      id: "memory",
      name: "Memory system (STM/LTM)",
      description:
        "PatternMemory (IndexedDB), memory engines, reflection, synthesis, conversation engine, and identity seed.",
      kind: "core",
      files: [
        "src/brain/PatternMemory.ts",
        "src/core/memory/MemoryStore.ts",
        "src/core/memory/IndexedDBStore.ts",
        "src/core/MemoryBridge.ts",
        "src/brain/LeluIdentity.ts",
        "src/brain/Brain.ts",
      ],
      dependsOn: ["storage"],
      provides: ["memory", "identity-context"],
      status: "working",
    },
    {
      id: "cognition",
      name: "Cognition & self-model",
      description:
        "CognitiveCore, planning/reasoning engines, the persistent self-model, knowledge library, work queue, autonomy gate, and the continuous cognitive loop.",
      kind: "core",
      files: [
        "src/core/cognition/CognitiveCore.ts",
        "src/core/cognition/SelfModel.ts",
        "src/core/cognition/KnowledgeLibrary.ts",
        "src/core/cognition/WorkQueue.ts",
        "src/core/cognition/AutonomyGate.ts",
        "src/core/cognition/SystemEnvironment.ts",
        "src/core/cognition/CognitiveLoop.ts",
      ],
      dependsOn: ["storage", "memory"],
      provides: ["cognition", "self-model", "knowledge", "work-queue", "autonomy", "proactive"],
      status: "working",
    },
    {
      id: "agents",
      name: "Agent system",
      description:
        "Persistent agent store (CRUD, templates, tools, memory permissions, provider prefs), the runner, and agent events.",
      kind: "core",
      files: [
        "src/core/agents/AgentTypes.ts",
        "src/core/agents/AgentTemplates.ts",
        "src/core/agents/AgentStore.ts",
        "src/core/agents/AgentRunner.ts",
        "src/core/agent/AgentEvents.ts",
      ],
      dependsOn: ["core-ai", "storage"],
      provides: ["agents", "delegation", "workflows"],
      status: "working",
    },
    {
      id: "workspace",
      name: "Projects & workspace",
      description:
        "The persistent project system (conversations, files, images, sketches, renders, videos, tasks, notes, outputs) and the visual workspace engine.",
      kind: "core",
      files: [
        "src/core/projects/ProjectStore.ts",
        "src/core/workspace/WorkspaceEngine.ts",
        "src/core/cognition/WorkspaceManager.ts",
        "src/app/scene/genesis/GenesisWorkspace.tsx",
        "src/app/scene/genesis/GenesisAgentWorkspace.tsx",
      ],
      dependsOn: ["storage", "agents", "creative"],
      provides: ["projects", "workspace"],
      status: "working",
    },
    {
      id: "creative",
      name: "Creative systems",
      description:
        "Sketch (offline canvas + document model), Render (pluggable engine registry + local engine), Video (project/storyboard/scene/asset architecture), Avatar identity.",
      kind: "creative",
      files: [
        "src/core/creative/SketchDocument.ts",
        "src/core/creative/CreativeToolInterface.ts",
        "src/core/creative/RenderEngine.ts",
        "src/core/creative/RenderStore.ts",
        "src/core/creative/VideoProject.ts",
        "src/core/avatar/AvatarProfile.ts",
      ],
      dependsOn: ["storage"],
      provides: ["sketch", "render", "video", "avatar", "creative-tools"],
      status: "partial",
    },
    {
      id: "engineering",
      name: "Engineering sandbox",
      description:
        "The isolated virtual filesystem with project generation, static analysis, and the autonomous cognition/engineering layer.",
      kind: "core",
      files: [
        "src/core/engineering/SandboxFS.ts",
        "src/core/engineering/SandboxRuntime.ts",
        "src/core/engineering/sandbox.worker.ts",
        "src/core/engineering/WorkspaceRuntime.ts",
        "src/app/scene/genesis/GenesisEngineeringPanel.tsx",
      ],
      dependsOn: ["storage", "cognition"],
      provides: ["engineering", "sandbox", "sandbox-runtime"],
      status: "working",
    },
    {
      id: "selfdev",
      name: "Self-development engine",
      description:
        "Architecture map, capability registry, self-diagnostics, improvement queue, self-tests, version history, UI specs, and the evolution workspace.",
      kind: "core",
      files: [
        "src/core/selfdev/ArchitectureMap.ts",
        "src/core/selfdev/CapabilityRegistry.ts",
        "src/core/selfdev/ImprovementQueue.ts",
        "src/core/selfdev/SelfDiagnostics.ts",
        "src/core/selfdev/SelfTestRunner.ts",
        "src/core/selfdev/VersionHistory.ts",
        "src/core/selfdev/SelfCode.ts",
        "src/core/selfdev/UISpec.ts",
        "src/core/selfdev/SelfDevelopmentEngine.ts",
        "src/core/selfdev/EngineeringToolset.ts",
        "src/core/selfdev/EngineeringMemory.ts",
        "src/core/selfdev/ImprovementPrioritizer.ts",
        "src/core/selfdev/SelfDevelopmentLoop.ts",
        "src/core/selfdev/VisualInspection.ts",
      ],
      dependsOn: ["cognition", "engineering", "storage", "creative"],
      provides: ["self-development", "self-diagnostics", "ui-evolution", "visual-inspection", "versioning"],
      status: "working",
    },
    {
      id: "storage",
      name: "Persistence layer",
      description:
        "The shared KvStore (localStorage → sessionStorage → window.name) used by every persistent store, offline-first.",
      kind: "storage",
      files: ["src/core/storage/KvStore.ts"],
      dependsOn: [],
      provides: ["persistence"],
      status: "working",
    },
    {
      id: "voice",
      name: "Voice system",
      description:
        "Voice engine: speech recognition + synthesis + the useVoice hook, flowing through the same chat pipeline.",
      kind: "system",
      files: ["src/core/voice/VoiceEngine.ts", "src/core/voice/useVoice.ts", "src/app/scene/genesis/VoiceBridge.tsx"],
      dependsOn: ["core-ai"],
      provides: ["voice"],
      status: "working",
    },
    {
      id: "visual",
      name: "Visual environment",
      description:
        "The ambient visual layer (VisualEngine + VisualInterface) and the SYSTEM environment switch.",
      kind: "frontend",
      files: ["src/core/visual/VisualEngine.ts", "src/core/visual/useVisual.ts", "src/app/scene/genesis/VisualInterface.tsx"],
      dependsOn: ["ui"],
      provides: ["visual"],
      status: "working",
    },
  ];
}

export default class ArchitectureMap {
  private static instance: ArchitectureMap | null = null;
  private subsystems: ArchitectureSubsystem[];

  private constructor() {
    const stored = KvStore.getInstance().get<ArchitectureSubsystem[]>(KEY);
    this.subsystems = stored && stored.length > 0 ? stored : defaultSubsystems();
  }

  public static getInstance(): ArchitectureMap {
    if (!ArchitectureMap.instance) {
      ArchitectureMap.instance = new ArchitectureMap();
    }
    return ArchitectureMap.instance;
  }

  public list(): ArchitectureSubsystem[] {
    return this.subsystems;
  }

  public get(id: string): ArchitectureSubsystem | undefined {
    return this.subsystems.find((subsystem) => subsystem.id === id);
  }

  public update(id: string, patch: Partial<ArchitectureSubsystem>): void {
    this.subsystems = this.subsystems.map((subsystem) =>
      subsystem.id === id ? { ...subsystem, ...patch } : subsystem,
    );
    try {
      KvStore.getInstance().set(KEY, this.subsystems);
    } catch {
      // best-effort
    }
  }

  /** THE REAL SOURCE TREE — every source file path in this app, at
      runtime, via Vite's import.meta.glob (lazy, no content loaded). */
  public allSourceFiles(): string[] {
    try {
      const modules = import.meta.glob("/src/**/*.{ts,tsx,css}");
      return Object.keys(modules)
        .filter((path) => !path.includes("_generated"))
        .sort();
    } catch {
      return [];
    }
  }

  public findByFile(path: string): ArchitectureSubsystem | undefined {
    return this.subsystems.find((subsystem) => subsystem.files.includes(path));
  }

  /** Query the map: predicate over subsystems, returns matching ids. */
  public query(predicate: (subsystem: ArchitectureSubsystem) => boolean): ArchitectureSubsystem[] {
    return this.subsystems.filter(predicate);
  }

  /** Subsystems that depend (directly or transitively) on `id`. */
  public dependentsOf(id: string): ArchitectureSubsystem[] {
    const found: ArchitectureSubsystem[] = [];
    const visit = (subsystemId: string) => {
      for (const subsystem of this.subsystems) {
        if (subsystem.dependsOn.includes(subsystemId) && !found.includes(subsystem)) {
          found.push(subsystem);
          visit(subsystem.id);
        }
      }
    };
    visit(id);
    return found;
  }

  public countFiles(): number {
    return this.subsystems.reduce((total, subsystem) => total + subsystem.files.length, 0);
  }

  /** Plain-data snapshot for diagnostics / the evolution workspace. */
  public snapshot(): { subsystems: ArchitectureSubsystem[]; totalSourceFiles: number } {
    return {
      subsystems: this.subsystems,
      totalSourceFiles: this.allSourceFiles().length,
    };
  }
}
