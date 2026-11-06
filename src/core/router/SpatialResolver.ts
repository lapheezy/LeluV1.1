/**
 * ==========================================================
 * LÉLU — SPATIAL RESOLVER
 *
 * The chat face of the spatial core. A stage in the EXISTING
 * router chain: language becomes a typed SpatialIntent, the
 * SpatialIntentBus enforces the tier guard and commits it, and
 * the reply is built from the REAL result — including refusals,
 * which report the revision that stayed unchanged.
 *
 * Deliberately deterministic: no provider call, no model guess.
 * The parsing is conservative and bails out (handled:false) when
 * a sentence does not clearly name a scene operation, so "create
 * a project" or "make a plan" never become geometry.
 *
 * Owner approval is a phrase ("…, I approve") turned into a
 * single-use token by SpatialTierGuard. LÉLU has no other route
 * to mint one, and a destructive intent without it is refused.
 * ==========================================================
 */

import type { AIResponse } from "../../providers/AIProvider";
import type RouterContext from "./RouterContext";
import type { BrainResult } from "./RouterResults";
import SpatialIntentBus from "../spatial/SpatialIntentBus";
import SpatialTierGuard from "../spatial/SpatialTierGuard";
import { registerSpatialCapabilities } from "../spatial/SpatialCapabilityManifest";
import {
  SPATIAL_PRIMITIVES,
  type SpatialIntent,
  type SpatialMaterial,
  type SpatialOperationId,
  type SpatialPrimitiveKind,
  type SpatialVec3,
} from "../spatial/SpatialTypes";

export interface ParsedSpatialCommand {
  intent: SpatialIntent;
  label: string;
  /** The user wrote an explicit approval phrase in the same message. */
  ownerApproval: boolean;
}

const COLOR_WORDS: Record<string, string> = {
  red: "#ef4444",
  crimson: "#dc2626",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#facc15",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  magenta: "#d946ef",
  pink: "#ec4899",
  white: "#ffffff",
  black: "#000000",
  grey: "#9ca3af",
  gray: "#9ca3af",
  gold: "#eab308",
  silver: "#cbd5e1",
};

const PRIMITIVE_WORDS: ReadonlyArray<[RegExp, SpatialPrimitiveKind]> = [
  [/\bcubes?\b|\bboxes\b|\bbox\b/, "box"],
  [/\bspheres?\b|\borbs?\b|\bballs?\b/, "sphere"],
  [/\bcylinders?\b|\bpillars?\b/, "cylinder"],
  [/\bcones?\b/, "cone"],
  [/\btorus\b|\btori\b|\brings?\b|\bdonuts?\b/, "torus"],
  [/\bplanes?\b|\bfloors?\b/, "plane"],
];

const CREATED_KINDS: ReadonlySet<string> = new Set(SPATIAL_PRIMITIVES);

const APPROVAL_PATTERN =
  /\b(?:i\s+(?:approve|confirm|authorize)(?:\s+(?:this|it|that))?|approved|go\s+ahead\s+and\s+(?:delete|remove|destroy)|yes,?\s+(?:delete|remove)\s+it)\b/i;

const OP_FOR_INTENT: Record<SpatialIntent["op"], SpatialOperationId> = {
  "scene.list": "scene.list",
  "scene.inspect": "scene.inspect",
  "object.create": "object.create",
  "object.move": "object.move",
  "object.rotate": "object.rotate",
  "object.scale": "object.scale",
  "object.setVisible": "object.setVisible",
  "material.set": "material.set",
  "object.connect": "object.connect",
  "object.delete": "object.delete",
  "scene.undo": "scene.undo",
};

export function operationsFor(intent: SpatialIntent): SpatialOperationId[] {
  return [OP_FOR_INTENT[intent.op]];
}

export default class SpatialResolver {
  private readonly bus = SpatialIntentBus.getInstance();
  private readonly guard = SpatialTierGuard.getInstance();

  constructor() {
    registerSpatialCapabilities();
  }

  public async execute(context: RouterContext): Promise<BrainResult> {
    const prompt = context.request.prompt ?? "";
    const parsed = parseSpatialCommand(prompt);
    if (!parsed) return { handled: false };

    let approvalId: string | undefined;
    if (parsed.ownerApproval) {
      approvalId = this.guard.requestApproval(
        operationsFor(parsed.intent),
        `owner approved "${parsed.label}" in chat`,
      ).approvalId;
    }

    const result = await this.bus.apply(parsed.intent, {
      approvalId,
      taskId: String(context.request.timestamp ?? Date.now()),
    });

    const response: AIResponse = {
      text: result.message,
      provider: "spatial",
      model: "spatial-core",
      processingTime: Date.now() - context.started,
      metadata: {
        intent: "spatial",
        op: result.op,
        success: result.ok,
        revision: result.revision,
        refusal: result.refusal?.code,
        objectId: result.objectId,
      },
    };

    return { handled: true, response };
  }
}

/* ------------------------------------------------------------
 * PARSING
 * ---------------------------------------------------------- */

export function parseSpatialCommand(prompt: string): ParsedSpatialCommand | null {
  let text = prompt
    .trim()
    .replace(/^(?:lelu|l[eé]lu)[,\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const ownerApproval = APPROVAL_PATTERN.test(text);
  if (ownerApproval) {
    text = text
      .replace(APPROVAL_PATTERN, "")
      .replace(/\s*[,;]\s*$/, "")
      .trim();
  }

  const lower = text.toLowerCase();

  // ---- Tier 1 reads ----
  if (
    /(?:what(?:'s| is) (?:in|inside) (?:the|your) scene|list (?:the |your )?(?:scene|objects)|scene (?:status|inventory|contents)|what objects (?:are|do you have)|spatial status)/.test(
      lower,
    )
  ) {
    return { intent: { op: "scene.list" }, label: "list the scene", ownerApproval };
  }

  if (/^(?:please\s+)?(?:undo|revert|roll back)(?:\s+(?:that|this|the last (?:change|edit|mutation)|the scene))?\s*$/.test(lower)) {
    return { intent: { op: "scene.undo" }, label: "undo the last change", ownerApproval };
  }

  if (/^(?:please\s+)?(?:inspect|describe)\s+(?:the\s+)?(.+?)(?:\s+object)?\s*$/.test(lower)) {
    const match = /^(?:please\s+)?(?:inspect|describe)\s+(?:the\s+)?(.+?)(?:\s+object)?\s*$/.exec(text);
    if (match?.[1]) {
      const target = cleanReference(match[1]);
      if (target) return { intent: { op: "scene.inspect", target }, label: `inspect "${target}"`, ownerApproval };
    }
  }

  // ---- Tier 3 relationships ----
  const connect = /^(?:please\s+)?(?:connect|link|join|attach)\s+(?:the\s+)?(.+?)\s+(?:to|with)\s+(?:the\s+)?(.+?)(?:\s+(?:with|using)\s+(?:a\s+)?(?:beam|line|tether|link|connection))?\s*$/i.exec(
    text,
  );
  if (connect?.[1] && connect[2]) {
    const from = cleanReference(connect[1]);
    const to = cleanReference(connect[2]);
    if (from && to) {
      return {
        intent: { op: "object.connect", from, to },
        label: `link "${from}" to "${to}"`,
        ownerApproval,
      };
    }
  }

  // ---- Destructive ----
  const remove = /^(?:please\s+)?(?:delete|remove|destroy|erase|get rid of)\s+(.+)$/i.exec(text);
  if (remove?.[1]) {
    const target = cleanReference(remove[1]);
    if (target) {
      return { intent: { op: "object.delete", target }, label: `delete "${target}"`, ownerApproval };
    }
  }

  // ---- Visibility ----
  const visibility = /^(?:please\s+)?(hide|show|reveal)\s+(?:the\s+)?(.+)$/i.exec(text);
  if (visibility?.[1] && visibility[2]) {
    const target = cleanReference(visibility[2]);
    if (target) {
      const visible = visibility[1].toLowerCase() !== "hide";
      return {
        intent: { op: "object.setVisible", target, visible },
        label: `${visible ? "show" : "hide"} "${target}"`,
        ownerApproval,
      };
    }
  }

  // ---- Tier 2 transforms ----
  const moveTo = /^(?:please\s+)?(?:move|shift|slide|push)\s+(?:the\s+|my\s+)?(.+?)\s+to\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(
    text,
  );
  if (moveTo?.[1]) {
    const target = cleanReference(moveTo[1]);
    if (target) {
      const position: SpatialVec3 = {
        x: Number(moveTo[2]),
        y: Number(moveTo[3]),
        z: Number(moveTo[4]),
      };
      return {
        intent: { op: "object.move", target, position },
        label: `move "${target}"`,
        ownerApproval,
      };
    }
  }

  const moveDirection = /^(?:please\s+)?(?:move|shift|slide|push)\s+(?:the\s+|my\s+)?(.+?)\s+(up|down|left|right|forward|forwards|backward|backwards|back|higher|lower|closer|further)\b(?:\s+(?:by\s+)?(\d+(?:\.\d+)?))?/i.exec(
    text,
  );
  if (moveDirection?.[1] && moveDirection[2]) {
    const target = cleanReference(moveDirection[1]);
    const step = moveDirection[3] ? Number(moveDirection[3]) : 1;
    if (target && Number.isFinite(step)) {
      const delta = directionDelta(moveDirection[2].toLowerCase(), step);
      return {
        intent: { op: "object.move", target, delta },
        label: `move "${target}"`,
        ownerApproval,
      };
    }
  }

  const rotate = /^(?:please\s+)?(?:rotate|spin|turn)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(?:degrees?|deg|°))?(?:\s*(?:around|on|about)\s*(?:the\s+)?(x|y|z)(?:\s+axis)?)?\s*$/i.exec(
    text,
  );
  if (rotate?.[1]) {
    const target = cleanReference(rotate[1]);
    if (target) {
      const radians = ((rotate[2] ? Number(rotate[2]) : 45) * Math.PI) / 180;
      const axis = (rotate[3]?.toLowerCase() ?? "y") as "x" | "y" | "z";
      const delta: Partial<SpatialVec3> = { [axis]: radians };
      return {
        intent: { op: "object.rotate", target, delta },
        label: `rotate "${target}"`,
        ownerApproval,
      };
    }
  }

  const resize = /^(?:please\s+)?(?:resize|scale)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:x|times)?\s*$/i.exec(
    text,
  );
  if (resize?.[1] && resize[2]) {
    const target = cleanReference(resize[1]);
    const scale = Number(resize[2]);
    if (target && Number.isFinite(scale)) {
      return {
        intent: { op: "object.scale", target, scale },
        label: `resize "${target}"`,
        ownerApproval,
      };
    }
  }

  const double = /^(?:please\s+)?double\s+(?:the\s+)?(.+)$/i.exec(text);
  if (double?.[1]) {
    const target = cleanReference(double[1]);
    if (target) {
      return {
        intent: { op: "object.scale", target, factor: 2 },
        label: `double "${target}"`,
        ownerApproval,
      };
    }
  }

  const halve = /^(?:please\s+)?(?:halve|half)\s+(?:the\s+)?(.+)$/i.exec(text);
  if (halve?.[1]) {
    const target = cleanReference(halve[1]);
    if (target) {
      return {
        intent: { op: "object.scale", target, factor: 0.5 },
        label: `halve "${target}"`,
        ownerApproval,
      };
    }
  }

  const relativeSize = /^(?:please\s+)?(?:make\s+)?(?:the\s+)?(.+?)\s+(bigger|larger|smaller)\s*$/i.exec(
    text,
  );
  if (relativeSize?.[1] && relativeSize[2]) {
    const target = cleanReference(relativeSize[1]);
    if (target) {
      const factor = /smaller/i.test(relativeSize[2]) ? 0.6 : 1.5;
      return {
        intent: { op: "object.scale", target, factor },
        label: `resize "${target}"`,
        ownerApproval,
      };
    }
  }

  // ---- Tier 2 material ----
  const material = /^(?:please\s+)?(?:make|paint|colou?r|turn)\s+(?:the|that|this|my)\s+(.+?)\s+(.+)$/i.exec(
    text,
  );
  if (material?.[1] && material[2]) {
    const target = cleanReference(material[1]);
    const descriptors = material[2].toLowerCase();
    const colorWord = detectColor(descriptors);
    const patch = materialPatch(descriptors, colorWord);
    if (target && Object.keys(patch).length > 0) {
      return {
        intent: { op: "material.set", target, ...patch },
        label: `restyle "${target}"`,
        ownerApproval,
      };
    }
  }

  // ---- Tier 3 construction ----
  const create = /^(?:please\s+|can you\s+|could you\s+)?(?:create|add|build|spawn|make)\b(.*)$/i.exec(
    text,
  );
  if (create) {
    const rest = create[1] ?? "";
    const kind = detectPrimitive(rest);
    if (kind && CREATED_KINDS.has(kind)) {
      const color = detectColor(rest);
      const placement = detectPlacement(rest);
      const scale = detectSize(rest);
      const name = detectName(rest);
      const materialExtra = materialPatch(rest.toLowerCase(), color);
      const intent: Extract<SpatialIntent, { op: "object.create" }> = {
        op: "object.create",
        kind,
        ...(name ? { name } : {}),
        ...(color ? { color } : {}),
        ...(placement ? { position: placement } : {}),
        ...(scale !== undefined ? { scale } : {}),
        ...(Object.keys(materialExtra).length > 0
          ? { material: materialExtra as Partial<SpatialMaterial> }
          : {}),
      };
      return {
        intent,
        label: `create a ${kind}${name ? ` named "${name}"` : ""}`,
        ownerApproval,
      };
    }
  }

  return null;
}

/* ------------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------- */

function cleanReference(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(?:the|my|a|an)\s+/i, "")
    .replace(/\s+(?:from|in)\s+(?:the\s+)?scene$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function detectPrimitive(text: string): SpatialPrimitiveKind | null {
  for (const [pattern, kind] of PRIMITIVE_WORDS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

function detectColor(text: string): string | null {
  const hex = /#([0-9a-f]{6})\b/i.exec(text);
  if (hex) return `#${hex[1].toLowerCase()}`;
  for (const [word, value] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) return value;
  }
  return null;
}

function materialPatch(descriptors: string, color: string | null): Partial<SpatialMaterial> {
  const patch: Partial<SpatialMaterial> = {};
  if (/\bmetallic\b|\bshiny\b|\bglossy\b/.test(descriptors)) {
    patch.metalness = 0.9;
    patch.roughness = 0.15;
  }
  if (/\bmatte\b|\brough\b/.test(descriptors)) {
    patch.roughness = 0.95;
    patch.metalness = 0.05;
  }
  if (/\bglow(?:ing)?\b|\bemissive\b/.test(descriptors)) {
    patch.emissive = color ?? "#a78bfa";
    patch.emissiveIntensity = 1.2;
  }
  if (/\btransparent\b|\btranslucent\b|\bghost\b/.test(descriptors)) {
    patch.opacity = 0.35;
  }
  if (/\bopaque\b|\bsolid\b/.test(descriptors)) {
    patch.opacity = 1;
  }
  if (/\bwireframe\b|\bhollow\b/.test(descriptors)) {
    patch.wireframe = true;
  }
  if (color) patch.color = color;
  return patch;
}

function detectPlacement(text: string): Partial<SpatialVec3> | null {
  const coordinates = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(text);
  if (coordinates) {
    return { x: Number(coordinates[1]), y: Number(coordinates[2]), z: Number(coordinates[3]) };
  }
  const direction = /\b(?:at|in|on|to|near)\s+(?:the\s+)?(center|centre|middle|left|right|above|below|top|bottom|front|behind)\b/i.exec(
    text,
  );
  if (!direction?.[1]) return null;
  switch (direction[1].toLowerCase()) {
    case "left":
      return { x: -2.6, y: -1.2, z: 2.2 };
    case "right":
      return { x: 2.6, y: -1.2, z: 2.2 };
    case "above":
    case "top":
      return { x: 0, y: 1.6, z: 2.4 };
    case "below":
    case "bottom":
      return { x: 0, y: -2.4, z: 2.4 };
    case "front":
      return { x: 0, y: 0, z: 3.6 };
    case "behind":
      return { x: 0, y: 0, z: -2.4 };
    case "center":
    case "centre":
    case "middle":
      return { x: 0, y: 0, z: 2.6 };
    default:
      return null;
  }
}

function detectSize(text: string): number | undefined {
  const explicit = /\b(?:size|scale)\s+(?:of\s+)?(\d+(?:\.\d+)?)/i.exec(text);
  if (explicit?.[1]) return Number(explicit[1]);
  const units = /(\d+(?:\.\d+)?)\s*(?:units?|metres?|meters?)\b/i.exec(text);
  if (units?.[1]) return Number(units[1]);
  if (/\btiny\b/.test(text)) return 0.35;
  if (/\bsmall\b|\blittle\b/.test(text)) return 0.6;
  if (/\blarge\b|\bbig\b|\bhuge\b/.test(text)) return 1.8;
  return undefined;
}

function detectName(text: string): string | undefined {
  const quoted = /\b(?:called|named)\s+"([^"]{1,48})"/i.exec(text);
  if (quoted?.[1]) return quoted[1].trim();
  const bare = /\b(?:called|named)\s+([a-z0-9][a-z0-9 _-]{0,40}?)(?:\s+(?:at|in|on|to|near)\b|$)/i.exec(
    text,
  );
  return bare?.[1]?.trim();
}

function directionDelta(direction: string, step: number): Partial<SpatialVec3> {
  switch (direction) {
    case "up":
    case "higher":
      return { y: step };
    case "down":
    case "lower":
      return { y: -step };
    case "left":
      return { x: -step };
    case "right":
      return { x: step };
    case "forward":
    case "forwards":
    case "closer":
      return { z: step };
    default:
      return { z: -step };
  }
}
