/**
 * ==========================================================
 * LÉLU — REFERENCE TOOLS
 *
 * How LÉLU's builders reach the owner's reference library: the character
 * builder (character / clothing / character-style), the world builder
 * (families, layers, places, planned worlds), the scene renderer (plates,
 * palettes) and visual generation (what a request should be based on).
 *
 * Read tools report exactly what the local registry holds, including what
 * is unresolved and which targets are only planned. The apply tool acts on
 * the active world through the same store as the editor. When the library
 * is not on this machine (production, another computer) every tool says
 * so instead of inventing references.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import { referenceById, referencesFor, searchReferences, targetState, type Registry } from "./ReferenceRegistry";
import { CATEGORIES, type Category } from "./referenceLabels";
import { knownTargets } from "./knownTargets";

const OBJECT = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });
const str = (a: Record<string, unknown>, k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");

let source: () => Promise<Registry | null> = async () => {
  if (typeof fetch === "undefined" || typeof window === "undefined") return null;
  try {
    const r = await fetch("/reference/registry.json", { cache: "no-store" });
    return r.ok && (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as Registry) : null;
  } catch {
    return null;
  }
};
/** Tests and Node runtimes point the tools at a registry directly. */
export function setReferenceSource(fn: () => Promise<Registry | null>): void {
  source = fn;
}

const NONE: ToolExecutionResult = { ok: false, content: "No local reference library on this machine: reference/ is personal, Git-ignored and absent from builds. Nothing was substituted." };
const line = (e: { code: string; id: string; shows: string; franchise?: string; categories: string[] }) => `${e.code} (${e.id}): ${e.shows}${e.franchise ? ` [${e.franchise}]` : ""} {${e.categories.join(", ")}}`;

export const REFERENCE_TOOLS: ToolDefinition[] = [
  { id: "references.search", name: "Search references", description: "Search the owner's local visual references by text, category (franchise, character, environment, vehicle, architecture, animation, clothing, visual-style…), franchise, or what they inform.", category: "References", permissions: ["READ"], riskLevel: 0, available: true, executionRoute: "ReferenceTools.references.search" },
  { id: "references.for", name: "References for a visual object", description: "Which references inform a family, layer, place or planned world (e.g. family:volcano, planned:retro-video-store, character-style:cel-shaded-american-anime), and whether that target exists yet.", category: "References", permissions: ["READ"], riskLevel: 0, available: true, executionRoute: "ReferenceTools.references.for" },
  { id: "references.unresolved", name: "Unresolved references", description: "Atlas entries with no usable image (blocked, no preview, PDF, logo only, mismatched) and planned targets still waiting to be built.", category: "References", permissions: ["READ"], riskLevel: 0, available: true, executionRoute: "ReferenceTools.references.unresolved" },
  { id: "references.apply", name: "Use a reference", description: "Make a reference a full-screen 2D workspace (the image is the environment the thread floats over), or take the active world's palette from it.", category: "References", permissions: ["WRITE"], riskLevel: 1, available: true, executionRoute: "ReferenceTools.references.apply" },
  { id: "workspace.from_image", name: "Make a workspace from an image", description: "Turn any image into a full-screen 2D workspace variant: one of the owner's references, a photo, or a visual you made or that is in the conversation (by URL or data URL). The image stays on this device.", category: "References", permissions: ["WRITE"], riskLevel: 1, available: true, executionRoute: "ReferenceTools.workspace.from_image" },
];

export const REFERENCE_EXECUTORS: Array<{ id: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<ToolExecutionResult> }> = [
  {
    id: "references.search",
    parameters: OBJECT({ text: { type: "string" }, category: { type: "string", enum: [...CATEGORIES] }, franchise: { type: "string" }, informs: { type: "string" }, limit: { type: "number" } }, []),
    run: async (args) => {
      const reg = await source();
      if (!reg) return NONE;
      const cat = str(args, "category");
      const found = searchReferences(reg, { text: str(args, "text") || undefined, category: (CATEGORIES as readonly string[]).includes(cat) ? (cat as Category) : undefined, franchise: str(args, "franchise") || undefined, informs: str(args, "informs") || undefined });
      const lim = Math.max(1, Math.min(40, Number(args.limit) || 12));
      return { ok: true, content: found.length ? `${found.length} reference(s):\n${found.slice(0, lim).map(line).join("\n")}` : "No usable reference matches. (Unresolved entries are listed by references.unresolved.)", data: found.slice(0, lim) };
    },
  },
  {
    id: "references.for",
    parameters: OBJECT({ target: { type: "string" } }, ["target"]),
    run: async (args) => {
      const reg = await source();
      if (!reg) return NONE;
      const t = str(args, "target");
      const refs = referencesFor(reg, t);
      const state = targetState(t, knownTargets());
      return { ok: true, content: `${t} is ${state === "implemented" ? "built" : state === "planned" ? "planned, not built yet" : "not a known target"}. ${refs.length} reference(s) inform it${refs.length ? `:\n${refs.map(line).join("\n")}` : "."}`, data: { state, refs } };
    },
  },
  {
    id: "references.unresolved",
    parameters: OBJECT({ reason: { type: "string" } }, []),
    run: async (args) => {
      const reg = await source();
      if (!reg) return NONE;
      const reason = str(args, "reason");
      const list = reg.unresolved.filter((u) => !reason || u.reason === reason);
      const counts = list.reduce<Record<string, number>>((m, u) => ((m[u.reason] = (m[u.reason] ?? 0) + 1), m), {});
      return { ok: true, content: `${list.length} unresolved: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}. Planned targets waiting: ${Object.entries(reg.planned).map(([k, v]) => `${k} (${v.length})`).join(", ")}.`, data: { unresolved: list, planned: reg.planned } };
    },
  },
  {
    id: "references.apply",
    parameters: OBJECT({ ref: { type: "string" }, as: { type: "string", enum: ["workspace", "palette"] } }, ["ref", "as"]),
    run: async (args) => {
      const reg = await source();
      if (!reg) return NONE;
      const e = referenceById(reg, str(args, "ref"));
      if (!e) return { ok: false, content: `No reference ${str(args, "ref")} in the library.` };
      if (e.status !== "usable") return { ok: false, content: `${e.code} is ${e.status} (${e.shows}); it is not used as a visual reference.` };
      if (typeof document === "undefined") return { ok: false, content: "Building from an image needs the browser (it reads the image's colours); not available here." };
      if (str(args, "as") === "workspace") {
        const { makeWorkspace } = await import("../../app/scene/worlds/workspaceImages");
        const w = await makeWorkspace({ origin: "reference", title: `${e.code} ${e.shows}`, ref: e.id, provenance: e.code });
        return { ok: true, content: `Made "${w.name}" a full-screen 2D workspace and switched to it (${e.shows}).`, data: { world: w.id } };
      }
      const S = await import("../worlds/WorldStore");
      const w = S.activeWorld();
      if (!w) return { ok: false, content: "No active world to recolour: make or pick one first (🌐)." };
      if (typeof document === "undefined") return { ok: false, content: "Taking a palette needs the image decoded in the browser; not available here." };
      const { paletteFromReference } = await import("../../app/scene/worlds/referenceLibrary");
      const p = await paletteFromReference(e);
      S.applyEdit(w.id, { op: "world", changes: { palette: p } });
      return { ok: true, content: `"${w.name}" now takes its palette from ${e.code}: sky ${p.sky.join(" → ")}, accent ${p.accent}, glow ${p.glow}.`, data: p };
    },
  },
  {
    id: "workspace.from_image",
    parameters: OBJECT({ reference: { type: "string", description: "A reference id or code, e.g. owner:U-01 or III-02." }, url: { type: "string", description: "An image URL or data URL (a visual you made, a photo in the conversation)." }, title: { type: "string" }, origin: { type: "string", enum: ["generated", "photo", "thread-image"] } }, []),
    run: async (args) => {
      if (typeof document === "undefined") return { ok: false, content: "Building a workspace from an image needs the browser; not available here." };
      const { makeWorkspace } = await import("../../app/scene/worlds/workspaceImages");
      const reference = str(args, "reference"), url = str(args, "url");
      if (!reference && !url) return { ok: false, content: "Give a reference or an image url." };
      try {
        if (reference) {
          const reg = await source();
          const e = reg && referenceById(reg, reference);
          if (!e) return NONE;
          const w = await makeWorkspace({ origin: "reference", title: str(args, "title") || `${e.code} ${e.shows}`, ref: e.id, provenance: e.code });
          return { ok: true, content: `Made "${w.name}" the full-screen 2D workspace.`, data: { world: w.id } };
        }
        const origin = (["generated", "photo", "thread-image"].includes(str(args, "origin")) ? str(args, "origin") : "generated") as "generated" | "photo" | "thread-image";
        const w = await makeWorkspace({ origin, title: str(args, "title") || "Untitled image", url, provenance: url.startsWith("data:") ? "data" : url.slice(0, 80) });
        return { ok: true, content: `Made "${w.name}" the full-screen 2D workspace; the image is kept on this device.`, data: { world: w.id } };
      } catch (err) {
        return { ok: false, content: String((err as Error).message) };
      }
    },
  },
];

export function registerReferenceTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of REFERENCE_TOOLS) registry.register(tool);
}
