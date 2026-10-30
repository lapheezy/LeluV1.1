/**
 * ==========================================================
 * LÉLU 3D FORGE — MESHY CATALOG
 *
 * What Meshy can actually be asked to do, written down once
 * from the published API reference (docs.meshy.ai, read
 * 2026-10-30) so nothing downstream invents an endpoint or
 * a parameter:
 *
 *   kind               create path                      cost (credits)
 *   image-to-3d        POST /openapi/v1/image-to-3d       5–35 by model/texture
 *   multi-image-to-3d  POST /openapi/v1/multi-image-to-3d same table, 1–4 images
 *   text-to-3d         POST /openapi/v2/text-to-3d        preview 5–20, refine 10–15
 *   remesh             POST /openapi/v1/remesh            5
 *   retexture          POST /openapi/v1/retexture         10–15
 *   rigging            POST /openapi/v1/rigging           5 (humanoid only)
 *   animation          POST /openapi/v1/animations        3 per action, ≤10
 *   image-to-image     POST /openapi/v1/image-to-image    3–12 by image model; returns
 *                                                         images, not a mesh (with
 *                                                         generate_multi_view: usually
 *                                                         three views of the subject)
 *
 * Every create returns { result: <task id> }; every task is
 * read back with GET <create path>/<id> and moves through
 * PENDING → IN_PROGRESS → SUCCEEDED | FAILED | CANCELED.
 * Failed tasks are refunded by Meshy.
 *
 * Pure data and pure functions: no credentials, no fetch, no
 * filesystem. The browser imports this to PLAN and ESTIMATE;
 * only the server broker (plugins/meshyForgeApi.ts) submits.
 * ==========================================================
 */

export type ForgeJobKind =
  | "image-to-3d"
  | "multi-image-to-3d"
  | "text-to-3d"
  | "remesh"
  | "retexture"
  | "rigging"
  | "animation"
  | "image-to-image";

/** Kinds whose output is images rather than a GLB. */
export const IMAGE_KINDS: ReadonlySet<ForgeJobKind> = new Set(["image-to-image"]);

/** Image models image-to-image accepts, with their published per-request price. */
export const IMAGE_MODEL_CREDITS: Record<string, number> = {
  "nano-banana": 3,
  "nano-banana-2-lite": 3,
  "nano-banana-2-1": 4,
  "nano-banana-2": 6,
  "nano-banana-pro": 9,
  "gpt-image-2": 12,
  "gpt-image-2-5-flare": 12,
  "gpt-image-2-5-sunburst": 12,
};

export type MeshyTaskStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

export const TERMINAL_STATUSES: ReadonlySet<MeshyTaskStatus> = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

interface KindSpec {
  path: string;
  /** Request fields Meshy documents for this kind. Anything else is refused. */
  fields: ReadonlySet<string>;
}

const GENERATION_FIELDS = [
  "ai_model",
  "geometry_resolution",
  "should_texture",
  "enable_pbr",
  "texture_resolution",
  "texture_prompt",
  "texture_image_url",
  "should_remesh",
  "topology",
  "decimation_mode",
  "save_pre_remeshed_model",
  "target_polycount",
  "pose_mode",
  "image_enhancement",
  "remove_lighting",
  "moderation",
  "target_formats",
  "auto_size",
  "origin_at",
  "alpha_thumbnail",
  "multi_view_thumbnails",
];

export const MESHY_KINDS: Record<ForgeJobKind, KindSpec> = {
  "image-to-3d": {
    path: "/openapi/v1/image-to-3d",
    fields: new Set(["image_url", "input_task_id", "model_type", ...GENERATION_FIELDS]),
  },
  "multi-image-to-3d": {
    path: "/openapi/v1/multi-image-to-3d",
    fields: new Set(["image_urls", "input_task_id", "texture_image_urls", ...GENERATION_FIELDS]),
  },
  "text-to-3d": {
    path: "/openapi/v2/text-to-3d",
    fields: new Set([
      "mode",
      "prompt",
      "preview_task_id",
      "ai_model",
      "topology",
      "target_polycount",
      "should_remesh",
      "pose_mode",
      "enable_pbr",
      "texture_prompt",
      "texture_image_url",
      "moderation",
      "target_formats",
    ]),
  },
  remesh: {
    path: "/openapi/v1/remesh",
    fields: new Set(["input_task_id", "model_url", "target_formats", "topology", "target_polycount", "decimation_mode", "alpha_thumbnail"]),
  },
  retexture: {
    path: "/openapi/v1/retexture",
    fields: new Set([
      "input_task_id",
      "model_url",
      "text_style_prompt",
      "image_style_url",
      "multiview_image_urls",
      "enable_original_uv",
      "enable_pbr",
      "ai_model",
      "texture_resolution",
      "remove_lighting",
      "target_formats",
      "alpha_thumbnail",
    ]),
  },
  rigging: {
    path: "/openapi/v1/rigging",
    fields: new Set(["input_task_id", "model_url", "height_meters"]),
  },
  animation: {
    path: "/openapi/v1/animations",
    fields: new Set(["rig_task_id", "action_id", "action_ids", "motion_task_id", "post_process"]),
  },
  "image-to-image": {
    path: "/openapi/v1/image-to-image",
    fields: new Set(["ai_model", "prompt", "reference_image_urls", "input_task_id", "generate_multi_view", "aspect_ratio", "remove_background"]),
  },
};

export function isForgeJobKind(value: unknown): value is ForgeJobKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MESHY_KINDS, value);
}

/** Paths a task can be read back from — the create path plus its id. */
export function taskPath(kind: ForgeJobKind, taskId: string): string {
  return `${MESHY_KINDS[kind].path}/${encodeURIComponent(taskId)}`;
}

/* ------------------------------ validation ------------------------------ */

/**
 * Refuse a body Meshy would reject (or that names a field it does not
 * have) BEFORE it costs a round trip. Returns the problems, never throws.
 * Only the documented, checkable rules are enforced here; Meshy remains
 * the authority on everything else and its 400 is surfaced verbatim.
 */
export function validateRequest(kind: ForgeJobKind, body: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const spec = MESHY_KINDS[kind];
  for (const key of Object.keys(body)) {
    if (!spec.fields.has(key)) problems.push(`"${key}" is not a documented ${kind} parameter.`);
  }
  const has = (key: string) => body[key] !== undefined && body[key] !== null && body[key] !== "";

  if (kind === "image-to-3d" && !has("image_url") && !has("input_task_id")) {
    problems.push("image-to-3d needs image_url or input_task_id.");
  }
  if (kind === "multi-image-to-3d") {
    const urls = body.image_urls;
    if (!has("input_task_id")) {
      if (!Array.isArray(urls) || urls.length < 1 || urls.length > 4) {
        problems.push("multi-image-to-3d needs 1–4 image_urls.");
      }
    }
    if (body.geometry_resolution === "4k") problems.push('multi-image-to-3d supports geometry_resolution "standard" or "2k", not "4k".');
    if (has("texture_image_urls") && (has("texture_image_url") || has("texture_prompt") || body.should_texture === false)) {
      problems.push("texture_image_urls cannot be combined with texture_image_url, texture_prompt or should_texture:false.");
    }
  }
  if ((kind === "remesh" || kind === "retexture" || kind === "rigging") && !has("input_task_id") && !has("model_url")) {
    problems.push(`${kind} needs input_task_id or model_url.`);
  }
  if (kind === "animation") {
    if (!has("rig_task_id")) problems.push("animation needs rig_task_id.");
    const chosen = ["action_id", "action_ids", "motion_task_id"].filter(has);
    if (chosen.length !== 1) problems.push("animation needs exactly one of action_id, action_ids, motion_task_id.");
    const ids = body.action_ids;
    if (Array.isArray(ids) && (ids.length < 1 || ids.length > 10 || new Set(ids).size !== ids.length)) {
      problems.push("action_ids must be 1–10 unique ids.");
    }
  }
  if (kind === "text-to-3d") {
    if (body.mode !== "preview" && body.mode !== "refine") problems.push('text-to-3d mode must be "preview" or "refine".');
    if (body.mode === "preview" && !has("prompt")) problems.push("text-to-3d preview needs prompt.");
    if (body.mode === "refine" && !has("preview_task_id")) problems.push("text-to-3d refine needs preview_task_id.");
  }
  if (kind === "image-to-image") {
    if (!(String(body.ai_model ?? "") in IMAGE_MODEL_CREDITS)) problems.push(`image-to-image ai_model must be one of ${Object.keys(IMAGE_MODEL_CREDITS).join(", ")}.`);
    if (!has("prompt")) problems.push("image-to-image needs a prompt.");
    const refs = body.reference_image_urls;
    if (!has("input_task_id") && (!Array.isArray(refs) || refs.length < 1 || refs.length > 5)) problems.push("image-to-image needs 1–5 reference_image_urls.");
    if (body.generate_multi_view === true && has("aspect_ratio")) problems.push("generate_multi_view cannot be combined with aspect_ratio.");
  }
  if (body.enable_pbr === true && body.should_texture === false) problems.push("enable_pbr needs should_texture: true.");
  const polycount = body.target_polycount;
  if (polycount !== undefined && (typeof polycount !== "number" || polycount < 100 || polycount > 300_000)) {
    problems.push("target_polycount must be 100–300000.");
  }
  if (body.pose_mode !== undefined && !["", "a-pose", "t-pose"].includes(String(body.pose_mode))) {
    problems.push('pose_mode must be "", "a-pose" or "t-pose".');
  }
  if (typeof body.height_meters === "number" && body.height_meters < 0) problems.push("height_meters cannot be negative.");
  return problems;
}

/* -------------------------------- cost --------------------------------- */

/**
 * Credits a request will consume, from Meshy's published pricing table.
 * An ESTIMATE used for approval gating: the task's own consumed_credits
 * is recorded as the authoritative figure once it exists.
 */
export function estimateCredits(kind: ForgeJobKind, body: Record<string, unknown>): number {
  const model = String(body.ai_model ?? "latest");
  const textured = body.should_texture !== false;
  const resolution = String(body.texture_resolution ?? "2k");
  switch (kind) {
    case "image-to-3d":
    case "multi-image-to-3d": {
      const lite = model === "meshy-6-lite";
      const topo = model === "meshy-t2" || model === "meshy-t2.5" || body.model_type === "smart-topology";
      let credits: number;
      if (!textured) credits = lite || topo ? 5 : 20;
      else if (lite || topo) credits = resolution === "8k" ? 20 : 15;
      else credits = resolution === "8k" ? 35 : 30;
      const geometry = String(body.geometry_resolution ?? "standard");
      if (geometry === "2k" || geometry === "4k") credits += 5;
      return credits;
    }
    case "text-to-3d":
      if (body.mode === "refine") return resolution === "8k" ? 15 : 10;
      return ["meshy-6-lite", "meshy-t2", "meshy-t2.5"].includes(model) ? 5 : 20;
    case "remesh":
      return 5;
    case "retexture":
      return resolution === "8k" ? 15 : 10;
    case "rigging":
      return 5;
    case "animation": {
      const ids = body.action_ids;
      return 3 * (Array.isArray(ids) ? ids.length : 1);
    }
    case "image-to-image":
      return IMAGE_MODEL_CREDITS[model] ?? 12;
  }
}

/* ------------------------------ fingerprint ----------------------------- */

/**
 * Stable identity of a request, for idempotency: the same kind and the
 * same parameters produce the same key, so a retry, a double click or a
 * re-run of a script finds the existing job instead of paying again.
 * Keys are sorted; large data URIs are reduced to a content hash.
 */
export function canonicalRequest(kind: ForgeJobKind, body: Record<string, unknown>): string {
  const reduce = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("data:") && value.length > 256) {
      return `data-uri:${fnv(value)}:${value.length}`;
    }
    if (Array.isArray(value)) return value.map(reduce);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = reduce((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify({ kind, body: reduce(body) });
}

function fnv(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}
