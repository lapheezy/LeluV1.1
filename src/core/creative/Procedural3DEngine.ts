/**
 * ==========================================================
 * LÉLU
 * PROCEDURAL 3D AUTHORING ENGINE — RenderEngine plugin
 * ==========================================================
 *
 * A real, offline render engine for the Render workspace. It
 * implements the same RenderEngine contract as the local canvas
 * engine, so the existing Render panel, RenderStore gallery and
 * agent tooling consume it without any UI changes:
 *
 *   kind "generate" + prompt
 *     → classifySceneKind(prompt) → authorScene(...) → render
 *       a PNG snapshot through the real Three.js WebGL renderer.
 *
 * "avatar" prompts use the SAVED AvatarProfile (the canonical
 * embodiment) — the same profile the portrait and Avatar panel
 * render. Everything is built procedurally; nothing is faked.
 * ==========================================================
 */

import type { RenderEngine, RenderKind, RenderRequest, RenderResult } from "./RenderEngine";
import { authorScene, classifySceneKind, renderAvatarToImage, renderSceneToImage } from "./Procedural3DPipeline";
import AvatarStore from "../avatar/AvatarProfile";

export class Procedural3DEngine implements RenderEngine {
  readonly id = "3d-authoring";
  readonly name = "Procedural 3D Authoring";
  readonly description =
    "Real offline procedural 3D: builds LÉLU's saved avatar (or an orb/planet scene) from primitives and renders a PNG snapshot through Three.js. No API key, no network.";
  readonly offline = true;
  readonly providerDependent = false;
  readonly supports: RenderKind[] = ["generate", "visualize"];

  async run(request: RenderRequest): Promise<RenderResult> {
    const started = Date.now();
    const prompt = request.prompt?.trim() || "avatar";
    const kind = classifySceneKind(prompt);
    const width = Number(request.params.width ?? 1280) || 1280;
    const height = Number(request.params.height ?? (kind === "avatar" ? 1600 : 1280)) || 1280;

    if (kind === "avatar") {
      const profile = AvatarStore.getInstance().get();
      const snapshot = await renderAvatarToImage(profile, {
        mode: "idle",
        time: 0.9,
        width,
        height,
      });
      if (!snapshot) {
        return {
          ok: false,
          engine: this.id,
          kind: request.kind,
          message: "WebGL is unavailable in this browser — the procedural 3D renderer could not start.",
          processingTime: Date.now() - started,
          offline: true,
        };
      }
      return {
        ok: true,
        engine: this.id,
        kind: request.kind,
        output: snapshot.dataUrl,
        message: `Authored the procedural 3D avatar of "${profile.identity.name}" (${snapshot.width} × ${snapshot.height}) — ${snapshot.parts.length} parts built from the saved appearance profile.`,
        processingTime: Date.now() - started,
        offline: true,
      };
    }

    const authored = authorScene(prompt, AvatarStore.getInstance().get());
    const snapshot = await renderSceneToImage(authored.group, { width, height });
    if (!snapshot) {
      return {
        ok: false,
        engine: this.id,
        kind: request.kind,
        message: "WebGL is unavailable in this browser — the procedural 3D renderer could not start.",
        processingTime: Date.now() - started,
        offline: true,
      };
    }
    return {
      ok: true,
      engine: this.id,
      kind: request.kind,
      output: snapshot.dataUrl,
      message: `Authored the procedural ${authored.kind} scene — ${authored.parts.join(", ")} (${snapshot.width} × ${snapshot.height}).`,
      processingTime: Date.now() - started,
      offline: true,
    };
  }
}
