/**
 * ==========================================================
 * LÉLU
 * CREATIVE ORCHESTRATOR — unified "create this" capability router
 * ==========================================================
 *
 * One entry point for creative intent. It classifies natural language
 * and dispatches to the EXISTING local systems — never to a second
 * engine:
 *
 *   image  → RenderEngine (local canvas, real offline procedural output)
 *   video  → VideoStore (real project/scene/shot/timeline scaffold)
 *   code   → SandboxFS   (real starter-project generation)
 *   game   → SandboxFS   (real canvas-game skeleton)
 *   audio  → VoiceEngine (TTS status; music generation is provider-dependent)
 *   sketch → Sketch workspace (CreativeToolInterface)
 *   3d/film/universe/simulation → honest "not implemented" pointers
 *
 * Every result carries an explicit capability status so LÉLU never
 * claims to have produced something she did not. Photoreal image
 * generation, actual video encoding, 3D generation, and full universe
 * simulation remain clearly provider-dependent / not-implemented until
 * a real backend is wired — nothing here fabricates output.
 * ==========================================================
 */

import RenderEngineRegistry from "./RenderEngine";
import VideoStore from "./VideoProject";
import SandboxFS from "../engineering/SandboxFS";
import VoiceEngine from "../voice/VoiceEngine";

export type CreativeCapability =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "code"
  | "game"
  | "sketch"
  | "3d"
  | "film"
  | "universe"
  | "simulation";

export type CreativeStatus =
  | "available"
  | "partial"
  | "provider-dependent"
  | "not-implemented";

export interface CreativeResult {
  capability: CreativeCapability;
  status: CreativeStatus;
  /** true when a real local action was performed with a deterministic artifact. */
  handled: boolean;
  /** Human-readable summary of what actually happened. */
  message: string;
  /** Optional produced artifact reference (never fabricated). */
  artifact?: {
    kind: string;
    id?: string;
    output?: string;
  };
}

const CREATE_VERBS =
  /\b(create|make|generate|build|draw|render|compose|produce|design|code|develop|construct|author)\b/i;

function titleFrom(prompt: string): string {
  const cleaned = prompt
    .replace(/\b(please|can you|create|make|generate|build|a|an|the|for me|me a)\b/gi, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 5);
  const title = words.join(" ").trim() || "Untitled";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export default class CreativeOrchestrator {
  private static instance: CreativeOrchestrator | null = null;

  public static getInstance(): CreativeOrchestrator {
    if (!CreativeOrchestrator.instance) {
      CreativeOrchestrator.instance = new CreativeOrchestrator();
    }
    return CreativeOrchestrator.instance;
  }

  /** Classify a prompt into a creative capability (text = not creative). */
  public classify(prompt: string): CreativeCapability {
    const p = prompt.toLowerCase();
    if (/\b(3d|three\.?js|blender|mesh|voxel|gaussian splat|obj model)\b/.test(p)) return "3d";
    if (/\b(film|movie|cinematic|short film|documentary|feature)\b/.test(p)) return "film";
    if (/\b(video|animation|animat|clip|storyboard|shot list|frame-by-frame)\b/.test(p)) return "video";
    if (/\b(game|gameplay|level design|playable|quest|inventory system)\b/.test(p)) return "game";
    if (/\b(simulation|simulate|physics sim|fluid sim|traffic sim|ecosystem sim)\b/.test(p)) return "simulation";
    if (/\b(universe|galaxy|cosmos|planet|continent|world-gen|worldbuilding)\b/.test(p)) return "universe";
    if (/\b(music|song|soundtrack|audio|sound effect|melody|compose|beat|jingle)\b/.test(p)) return "audio";
    if (/\b(sketch|doodle|whiteboard|canvas draw)\b/.test(p)) return "sketch";
    if (/\b(image|picture|photo|artwork|concept art|texture|illustration|wallpaper|poster|logo|portrait)\b/.test(p)) return "image";
    if (/\b(draw|paint)\b/.test(p)) return "image";
    if (/\b(code|app|website|web app|program|script|function|component|cli|api endpoint)\b/.test(p)) return "code";
    return "text";
  }

  /**
   * Route a creative intent to the real local system that can serve it.
   * Returns `handled: false` for capabilities that should still fall
   * through to the conversational AI (text, sketch, audio, and the
   * not-yet-implemented 3d/film/universe/simulation).
   */
  public async route(prompt: string): Promise<CreativeResult> {
    const capability = this.classify(prompt);
    const isCreativeRequest = CREATE_VERBS.test(prompt);

    if (capability === "text" || !isCreativeRequest) {
      return {
        capability: "text",
        status: "available",
        handled: false,
        message: "Not a creative generation request.",
      };
    }

    switch (capability) {
      case "image": {
        const title = titleFrom(prompt);
        const started = Date.now();
        try {
          const result = await RenderEngineRegistry.getInstance().run({
            engine: "local-canvas",
            kind: "generate",
            prompt,
            params: {},
          });
          return {
            capability,
            status: "available",
            handled: result.ok,
            message: result.ok
              ? `${result.message} (procedural local output — photoreal local image generation is not installed yet; saved as "${title}".)`
              : `Local image generation failed: ${result.message}`,
            artifact: result.ok
              ? { kind: "image", output: result.output }
              : undefined,
          };
        } catch (error) {
          return {
            capability,
            status: "available",
            handled: false,
            message: `Local image generation threw: ${error instanceof Error ? error.message : String(error)}`,
          };
        } finally {
          void started;
        }
      }

      case "video": {
        const name = titleFrom(prompt);
        const project = VideoStore.getInstance().create(name, prompt);
        return {
          capability,
          status: "partial",
          handled: true,
          message: `Created the video project "${project.name}" with the full storyboard/scene/shot/timeline scaffold. Actual video encoding is provider-dependent — the structured production is real and saved.`,
          artifact: { kind: "video-project", id: project.id },
        };
      }

      case "game": {
        const name = titleFrom(prompt);
        const result = SandboxFS.getInstance().generateProject("game", name);
        return {
          capability,
          status: "partial",
          handled: result.ok,
          message: result.ok
            ? `Generated a canvas-game skeleton in the engineering sandbox (${(result.paths ?? []).length} files: player, input, game loop).`
            : `Game scaffold generation failed: ${result.error ?? "unknown error"}.`,
          artifact: result.ok ? { kind: "sandbox-project", id: `projects/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` } : undefined,
        };
      }

      case "code": {
        const name = titleFrom(prompt);
        const result = SandboxFS.getInstance().generateProject("app", name);
        return {
          capability,
          status: "available",
          handled: result.ok,
          message: result.ok
            ? `Generated a single-page app skeleton in the engineering sandbox (${(result.paths ?? []).length} files).`
            : `Code scaffold generation failed: ${result.error ?? "unknown error"}.`,
          artifact: result.ok ? { kind: "sandbox-project", id: `projects/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` } : undefined,
        };
      }

      case "sketch": {
        return {
          capability,
          status: "available",
          handled: false,
          message:
            "The Sketch workspace and its tool layer (layers, shapes, concept guides, annotations, export) handle this locally — open Sketch to draw it, or ask me for a layer/guide command.",
        };
      }

      case "audio": {
        const diag = VoiceEngine.getInstance().getDiagnostics();
        return {
          capability,
          status: "partial",
          handled: false,
          message: diag.ttsSupported
            ? "Text-to-speech is available locally; music/soundtrack generation is provider-dependent and not wired yet."
            : "Audio generation is provider-dependent and not wired yet; local TTS is unavailable in this browser.",
        };
      }

      case "3d":
        return {
          capability,
          status: "not-implemented",
          handled: false,
          message:
            "Local 3D generation is not implemented yet. The architecture has a ModelRouter slot and the existing Three.js LÉLUVERSE renderer, but no procedural 3D authoring pipeline (Blender adapter) is wired.",
        };

      case "film":
        return {
          capability,
          status: "not-implemented",
          handled: false,
          message:
            "Film direction is not implemented yet. Video projects exist as structured scaffolds; the storyboard→shots→render→edit pipeline is not wired.",
        };

      case "universe":
        return {
          capability,
          status: "not-implemented",
          handled: false,
          message:
            "The Universe Compiler is not implemented yet. The LÉLUVERSE procedural engines exist, but there is no unified structured universe graph with snapshots/timelines/branches yet.",
        };

      case "simulation":
        return {
          capability,
          status: "not-implemented",
          handled: false,
          message:
            "A unified Simulation Orchestrator is not implemented yet. Individual LÉLUVERSE engines (physics, weather, ocean, particles) run live, but there is no configurable simulation-runner abstraction yet.",
        };

      default:
        return {
          capability,
          status: "available",
          handled: false,
          message: "Creative intent recognized but not dispatched.",
        };
    }
  }

  /** Capability status map for self-model / diagnostics. */
  public status(): Record<CreativeCapability, CreativeStatus> {
    return {
      text: "available",
      image: "available",
      video: "partial",
      audio: "partial",
      code: "available",
      game: "partial",
      sketch: "available",
      "3d": "not-implemented",
      film: "not-implemented",
      universe: "not-implemented",
      simulation: "not-implemented",
    };
  }
}
