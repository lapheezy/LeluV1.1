/**
 * ==========================================================
 * LÉLU
 * RENDER ENGINE — pluggable rendering architecture
 *
 * The RENDER workspace is designed around pluggable engines:
 *   - LocalCanvasEngine   — REAL offline canvas processing
 *     (filters, post-processing, variations, product canvas,
 *     sketch → render). Works with zero network.
 *   - Cloud engines       — registered as PROVIDER-DEPENDENT
 *     slots. They implement the same RenderEngine contract but
 *     report "not configured" until an API key exists. Nothing
 *     fakes a cloud render.
 *
 * Every engine returns a structured RenderResult — the UI and
 * agents consume the same contract, so new engines (image
 * generation APIs, 3D renderers) plug in without UI changes.
 * ==========================================================
 */

import { renderDocumentToCanvas, type SketchDocument } from "./SketchDocument";
import { Procedural3DEngine } from "./Procedural3DEngine";

export type RenderKind =
  | "generate"
  | "edit"
  | "variation"
  | "visualize"
  | "post";

export interface RenderRequest {
  kind: RenderKind;
  /** Engine id to run (see RenderEngineRegistry). */
  engine: string;
  /** Human prompt describing the desired output. */
  prompt?: string;
  /** Optional source image data URL. */
  source?: string;
  /** Optional source sketch document (rendered locally). */
  sketch?: SketchDocument;
  /** Engine-specific parameters. */
  params: Record<string, string | number | boolean>;
}

export interface RenderResult {
  ok: boolean;
  engine: string;
  kind: RenderKind;
  /** Output image data URL when the render produced one. */
  output?: string;
  message: string;
  processingTime: number;
  offline: boolean;
  /** When false the engine is available but the render failed. */
  providerDependent?: boolean;
}

export interface RenderEngine {
  id: string;
  name: string;
  description: string;
  offline: boolean;
  providerDependent: boolean;
  supports: RenderKind[];
  run(request: RenderRequest): Promise<RenderResult>;
}

/* ------------------------------------------------------------
 * LOCAL CANVAS ENGINE — real offline image processing
 * ---------------------------------------------------------- */

const POST_FILTERS: Record<string, (ctx: CanvasRenderingContext2D, width: number, height: number, value: number) => void> = {
  grayscale: (ctx) => {
    ctx.filter = "grayscale(1)";
  },
  sepia: (ctx) => {
    ctx.filter = "sepia(0.85)";
  },
  invert: (ctx) => {
    ctx.filter = "invert(1)";
  },
  blur: (ctx, _w, _h, value) => {
    ctx.filter = `blur(${Math.max(0, value || 4)}px)`;
  },
  contrast: (ctx, _w, _h, value) => {
    ctx.filter = `contrast(${Math.max(0.1, (value || 1.4))})`;
  },
  brightness: (ctx, _w, _h, value) => {
    ctx.filter = `brightness(${Math.max(0.1, value || 1.25)})`;
  },
  saturate: (ctx, _w, _h, value) => {
    ctx.filter = `saturate(${Math.max(0, value || 1.6)})`;
  },
  hue: (ctx, _w, _h, value) => {
    ctx.filter = `hue-rotate(${Math.max(0, value || 90)}deg)`;
  },
  pixelate: (ctx, width, height, value) => {
    const size = Math.max(2, value || 12);
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ctx.canvas, 0, 0, width / size, height / size);
    ctx.drawImage(ctx.canvas, 0, 0, width / size, height / size, 0, 0, width, height);
  },
};

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load source image."));
    image.src = dataUrl;
  });
}

function sourceCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return loadImage(dataUrl).then((image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas unavailable.");
    }
    ctx.drawImage(image, 0, 0);
    return canvas;
  });
}

function toDataUrl(canvas: HTMLCanvasElement, format: "png" | "jpg" = "png"): string {
  return format === "jpg" ? canvas.toDataURL("image/jpeg", 0.92) : canvas.toDataURL("image/png");
}

class LocalCanvasEngine implements RenderEngine {
  readonly id = "local-canvas";
  readonly name = "Local Canvas Engine";
  readonly description =
    "Offline rendering and post-processing: filters, variations, product canvases, and sketch renders. No network, no API key.";
  readonly offline = true;
  readonly providerDependent = false;
  readonly supports: RenderKind[] = ["post", "variation", "visualize", "generate"];

  async run(request: RenderRequest): Promise<RenderResult> {
    const started = Date.now();

    // generate from a sketch document (no source image needed)
    if (request.kind === "generate" && request.sketch) {
      const canvas = renderDocumentToCanvas(request.sketch);
      if (!canvas) {
        return this.fail(started, "Could not render the sketch document.");
      }
      return {
        ok: true,
        engine: this.id,
        kind: request.kind,
        output: toDataUrl(canvas),
        message: `Rendered sketch "${request.sketch.name}" to an image (${canvas.width} × ${canvas.height}).`,
        processingTime: Date.now() - started,
        offline: true,
      };
    }

    if (request.kind === "generate" && !request.source) {
      // local abstract scene generation: gradient backdrop + sun/glow disc
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 900;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return this.fail(started, "Canvas unavailable.");
      }
      const from = (request.params.from as string) || "#1e1b4b";
      const to = (request.params.to as string) || "#0f172a";
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const glow = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 40, canvas.width / 2, canvas.height / 2, 420);
      glow.addColorStop(0, "rgba(167, 139, 250, 0.65)");
      glow.addColorStop(1, "rgba(167, 139, 250, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return {
        ok: true,
        engine: this.id,
        kind: request.kind,
        output: toDataUrl(canvas),
        message: "Generated a local gradient scene (offline).",
        processingTime: Date.now() - started,
        offline: true,
      };
    }

    if (!request.source) {
      return this.fail(started, "This render needs a source image (or a sketch document).");
    }

    const source = await sourceCanvas(request.source);
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;

    if (request.kind === "post") {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return this.fail(started, "Canvas unavailable.");
      }
      ctx.drawImage(source, 0, 0);
      const filter = String(request.params.filter ?? "grayscale");
      const handler = POST_FILTERS[filter];
      if (!handler) {
        return this.fail(started, `Unknown local filter "${filter}".`);
      }
      const value = Number(request.params.value ?? 0);
      handler(ctx, canvas.width, canvas.height, value);
      return {
        ok: true,
        engine: this.id,
        kind: request.kind,
        output: toDataUrl(canvas),
        message: `Applied local "${filter}" filter (offline).`,
        processingTime: Date.now() - started,
        offline: true,
      };
    }

    if (request.kind === "variation") {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return this.fail(started, "Canvas unavailable.");
      }
      ctx.drawImage(source, 0, 0);
      const mode = String(request.params.mode ?? "mirror");
      if (mode === "mirror") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(source, 0, 0);
      } else if (mode === "rotate") {
        const angle = (Number(request.params.angle ?? 12) * Math.PI) / 180;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(angle);
        ctx.drawImage(source, -canvas.width / 2, -canvas.height / 2);
      } else if (mode === "crop-square") {
        const side = Math.min(canvas.width, canvas.height);
        const sx = (canvas.width - side) / 2;
        const sy = (canvas.height - side) / 2;
        const cropped = document.createElement("canvas");
        cropped.width = side;
        cropped.height = side;
        const cctx = cropped.getContext("2d");
        if (!cctx) {
          return this.fail(started, "Canvas unavailable.");
        }
        cctx.drawImage(source, sx, sy, side, side, 0, 0, side, side);
        return {
          ok: true,
          engine: this.id,
          kind: request.kind,
          output: toDataUrl(cropped),
          message: "Produced a square-crop variation (offline).",
          processingTime: Date.now() - started,
          offline: true,
        };
      }
      return {
        ok: true,
        engine: this.id,
        kind: request.kind,
        output: toDataUrl(canvas),
        message: `Produced a "${mode}" variation (offline).`,
        processingTime: Date.now() - started,
        offline: true,
      };
    }

    if (request.kind === "visualize") {
      // Product canvas: center the source on a tinted backdrop with a
      // soft ground shadow — the classic product-visualization frame.
      const backdrop = String(request.params.backdrop ?? "#111827");
      const canvasOut = document.createElement("canvas");
      canvasOut.width = 1400;
      canvasOut.height = 1050;
      const ctx = canvasOut.getContext("2d");
      if (!ctx) {
        return this.fail(started, "Canvas unavailable.");
      }
      const gradient = ctx.createRadialGradient(700, 400, 100, 700, 500, 900);
      gradient.addColorStop(0, backdrop);
      gradient.addColorStop(1, "#05060f");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvasOut.width, canvasOut.height);
      const scale = Math.min(0.62, (canvasOut.width * 0.6) / source.width, (canvasOut.height * 0.6) / source.height);
      const drawW = source.width * scale;
      const drawH = source.height * scale;
      const x = (canvasOut.width - drawW) / 2;
      const y = (canvasOut.height - drawH) / 2 - 30;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 90;
      ctx.shadowOffsetY = 36;
      ctx.drawImage(source, x, y, drawW, drawH);
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.ellipse(canvasOut.width / 2, canvasOut.height - 90, drawW * 0.58, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      return {
        ok: true,
        engine: this.id,
        kind: request.kind,
        output: toDataUrl(canvasOut),
        message: "Framed the source on a product canvas with a soft shadow (offline).",
        processingTime: Date.now() - started,
        offline: true,
      };
    }

    return this.fail(started, `Kind "${request.kind}" is not supported by the local engine.`);
  }

  private fail(started: number, message: string): RenderResult {
    return {
      ok: false,
      engine: this.id,
      kind: "post",
      message,
      processingTime: Date.now() - started,
      offline: true,
    };
  }
}

/* ------------------------------------------------------------
 * CLOUD ENGINE SLOT — provider-dependent, never faked
 * ---------------------------------------------------------- */

class CloudEngineSlot implements RenderEngine {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly description: string,
    readonly supports: RenderKind[],
    private readonly envVar: string,
  ) {}

  readonly offline = false;
  readonly providerDependent = true;

  async run(request: RenderRequest): Promise<RenderResult> {
    const configured = typeof process !== "undefined" && Boolean(process.env?.[this.envVar]);
    return {
      ok: false,
      engine: this.id,
      kind: request.kind,
      message: configured
        ? `The ${this.name} engine is configured but not wired to a generation endpoint yet (FOUNDATION).`
        : `${this.name} needs an API key (${this.envVar}). Add it in the Keys tab, then this engine becomes available.`,
      processingTime: 0,
      offline: false,
      providerDependent: true,
    };
  }
}

/* ------------------------------------------------------------
 * REGISTRY
 * ---------------------------------------------------------- */

export default class RenderEngineRegistry {
  private static instance: RenderEngineRegistry | null = null;

  private readonly engines = new Map<string, RenderEngine>();

  private constructor() {
    this.register(new LocalCanvasEngine());
    // REAL offline procedural 3D authoring — builds the saved avatar / a
    // scene from primitives and renders a PNG snapshot (no API key).
    this.register(new Procedural3DEngine());
    // PROVIDER-DEPENDENT slots — same contract, no fake renders.
    this.register(
      new CloudEngineSlot(
        "cloud-image-gen",
        "Cloud Image Generation",
        "Text-to-image rendering through a cloud provider (PROVIDER-DEPENDENT).",
        ["generate", "edit", "variation"],
        "LELU_IMAGE_API_KEY",
      ),
    );
    this.register(
      new CloudEngineSlot(
        "cloud-video-gen",
        "Cloud Video Generation",
        "Scene/asset generation for video projects (PROVIDER-DEPENDENT).",
        ["generate"],
        "LELU_VIDEO_API_KEY",
      ),
    );
  }

  public static getInstance(): RenderEngineRegistry {
    if (!RenderEngineRegistry.instance) {
      RenderEngineRegistry.instance = new RenderEngineRegistry();
    }
    return RenderEngineRegistry.instance;
  }

  public register(engine: RenderEngine): void {
    this.engines.set(engine.id, engine);
  }

  public get(id: string): RenderEngine | undefined {
    return this.engines.get(id);
  }

  public all(): RenderEngine[] {
    return [...this.engines.values()];
  }

  public offlineEngines(): RenderEngine[] {
    return this.all().filter((engine) => engine.offline);
  }

  public async run(request: RenderRequest): Promise<RenderResult> {
    const engine = this.engines.get(request.engine);
    if (!engine) {
      return {
        ok: false,
        engine: request.engine,
        kind: request.kind,
        message: `Unknown render engine "${request.engine}".`,
        processingTime: 0,
        offline: false,
      };
    }
    if (!engine.supports.includes(request.kind)) {
      return {
        ok: false,
        engine: engine.id,
        kind: request.kind,
        message: `The ${engine.name} engine does not support "${request.kind}" yet.`,
        processingTime: 0,
        offline: engine.offline,
        providerDependent: engine.providerDependent,
      };
    }
    try {
      return await engine.run(request);
    } catch (error) {
      return {
        ok: false,
        engine: engine.id,
        kind: request.kind,
        message: error instanceof Error ? error.message : String(error),
        processingTime: 0,
        offline: engine.offline,
        providerDependent: engine.providerDependent,
      };
    }
  }
}
