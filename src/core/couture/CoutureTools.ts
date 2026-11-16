/**
 * ==========================================================
 * LÉLU — CREATIVE ENGINE TOOLS
 *
 * The Creative Engine offered through the SAME pipeline every
 * other capability uses: ToolRegistry marks it, ToolDispatcher
 * runs it, AutonomyGate gates it. There is no second tool
 * registry and no second dispatcher.
 *
 * Two tools:
 *   couture.design  — materials, patterns, garments, products.
 *   couture.objects — the object lifecycle and spatial
 *                     manipulation (place, float, move, detach,
 *                     attach, remove without deleting, restore,
 *                     duplicate, library, undo).
 *
 * Every lifecycle call is deterministic: it reads and writes the
 * creative object store and never asks a model to decide. The
 * reference resolver refuses an ambiguous object instead of
 * picking one.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import { registerExecutor } from "../tools/ToolDispatcher";
import type { ToolExecutionResult, ToolExecutor } from "../tools/ToolDispatcher";
import CreativeObjectBridge from "../cosmos/CreativeObjectBridge";
import CreativeObjects, { type CreativeObject } from "./objects";
import { garmentAssembly, patternAssembly } from "./components";
import { buildGarment } from "./garment";
import { draftPattern, BASE_SIZE, type GarmentStyle, type SizeLabel } from "./pattern";
import { buildProduct, PRODUCT_TEMPLATES } from "./product";
import { objectWorldBox, SPATIAL_RELATIONS, positionedRelativeTo, type SpatialRelation } from "./layout";
import { getCreativeSelection, hasCreativeFocusListener, requestCreativeFocus, selectCreativeObject } from "./selection";
import { findMaterial, searchMaterials } from "./textiles";

export const OBJECT_ACTIONS = [
  "list",
  "inspect",
  "select",
  "focus",
  "place-in-cosmos",
  "remove-from-cosmos",
  "restore",
  "move",
  "rotate",
  "scale",
  "float",
  "anchor",
  "pause",
  "detach",
  "attach",
  "reuse",
  "duplicate",
  "set-material",
  "save-to-library",
  "move-to-workspace",
  "archive",
  "unarchive",
  "visibility",
  "undo",
  "redo",
] as const;
export type ObjectAction = (typeof OBJECT_ACTIONS)[number];

export interface ParsedObjectCall {
  action: ObjectAction;
  reference?: string;
  component?: string;
  parent?: string;
  target?: string;
  name?: string;
  roomId?: string;
  workspaceId?: string;
  material?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  visible?: boolean;
  /** Reference object for a relative placement ("beside the chair"). */
  relativeTo?: string;
  relation?: SpatialRelation;
  gap?: number;
}

type ParseResult = { ok: true; call: ParsedObjectCall } | { ok: false; error: string };

const str = (args: Record<string, unknown>, key: string): string => (typeof args[key] === "string" ? (args[key] as string).trim() : "");

function vec3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const out = value.slice(0, 3).map(Number);
  return out.every((n) => Number.isFinite(n)) ? (out as [number, number, number]) : undefined;
}

/**
 * Validate an object call before anything executes. The message names the
 * valid actions, so a bad call is reported as a bad call, not as a silent
 * no-op or a guess at what the user meant.
 */
export function parseObjectCall(args: Record<string, unknown>): ParseResult {
  const action = str(args, "action") as ObjectAction;
  if (!action) return { ok: false, error: `couture_objects needs an action. One of: ${OBJECT_ACTIONS.join(", ")}.` };
  if (!OBJECT_ACTIONS.includes(action)) return { ok: false, error: `"${action}" is not an object action. One of: ${OBJECT_ACTIONS.join(", ")}.` };

  const call: ParsedObjectCall = { action };
  const reference = str(args, "object") || str(args, "objectId") || str(args, "reference");
  if (reference) call.reference = reference;
  const relativeTo = str(args, "relativeTo") || str(args, "nextTo") || str(args, "beside");
  if (relativeTo) call.relativeTo = relativeTo;
  const relation = str(args, "relation") || str(args, "where");
  if (relation) {
    const normalized = relation.toLowerCase().replace(/[\s_]+/g, "-").replace(/^in-front-of$/, "in-front");
    if (!SPATIAL_RELATIONS.includes(normalized as SpatialRelation)) {
      return { ok: false, error: `"${relation}" is not a placement. One of: ${SPATIAL_RELATIONS.join(", ")}.` };
    }
    call.relation = normalized as SpatialRelation;
  }
  if (typeof args.gap === "number" && Number.isFinite(args.gap)) call.gap = Number(args.gap);
  const component = str(args, "component");
  if (component) call.component = component;
  const parent = str(args, "parent") || str(args, "parentId");
  if (parent) call.parent = parent;
  const target = str(args, "target") || str(args, "targetId");
  if (target) call.target = target;
  const name = str(args, "name");
  if (name) call.name = name;
  const roomId = str(args, "roomId");
  if (roomId) call.roomId = roomId;
  const workspaceId = str(args, "workspaceId");
  if (workspaceId) call.workspaceId = workspaceId;
  const material = str(args, "material") || str(args, "materialId");
  if (material) call.material = material;
  const position = vec3(args.position);
  if (position) call.position = position;
  const rotation = vec3(args.rotation);
  if (rotation) call.rotation = rotation;
  if (typeof args.scale === "number" && Number.isFinite(args.scale)) call.scale = Number(args.scale);
  if (typeof args.visible === "boolean") call.visible = args.visible;

  const needsReference: ObjectAction[] = ["inspect", "place-in-cosmos", "remove-from-cosmos", "restore", "move", "rotate", "scale", "float", "anchor", "pause", "detach", "attach", "duplicate", "set-material", "save-to-library", "move-to-workspace", "archive", "unarchive", "visibility"];
  if (needsReference.includes(action) && !call.reference) return { ok: false, error: `${action} needs an object: pass object (a name or id).` };
  if (action === "detach" && !call.component) return { ok: false, error: "detach needs the component to take off (e.g. component: \"right sleeve\")." };
  if (action === "attach" && !call.parent) return { ok: false, error: "attach needs the parent object to reattach into (parent: \"Aurelia gown\")." };
  if (action === "reuse" && !call.target) return { ok: false, error: "reuse needs the target object (target: \"Aurelia mikado second look\")." };
  if (action === "move" && !call.position && !vec3(args.delta) && !call.relativeTo) {
    return { ok: false, error: "move needs position [x,y,z] in millimetres, delta, or relativeTo (an object) with relation (e.g. beside)." };
  }
  if (call.relativeTo && !call.relation) return { ok: false, error: `relativeTo needs a relation. One of: ${SPATIAL_RELATIONS.join(", ")}.` };
  if (action === "rotate" && !call.rotation && !vec3(args.delta)) return { ok: false, error: "rotate needs rotation [x,y,z] in degrees, or delta." };
  if (action === "scale" && call.scale === undefined) return { ok: false, error: "scale needs scale (a factor, e.g. 1.25)." };
  if (action === "set-material" && !call.material) return { ok: false, error: "set-material needs material (a textile or metal id)." };
  return { ok: true, call };
}

const definition = (id: string, name: string, description: string, inputSchema: Record<string, unknown>): ToolDefinition => ({
  id,
  name,
  description,
  category: "Creative",
  permissions: ["READ", "WRITE"],
  riskLevel: 1,
  available: true,
  inputSchema,
});

const VEC3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };

export const COUTURE_TOOLS: ToolDefinition[] = [
  definition(
    "couture.design",
    "Design with the Creative Engine",
    "Draft a pattern from body measurements, build a simulated garment, look up and compare textiles, build a parametric product or piece of jewellery, and inspect the resulting editable object. Everything runs locally: no generation API.",
    {
      type: "object",
      properties: {
        action: { type: "string", enum: ["materials", "material", "compare", "draft-pattern", "build-garment", "product", "products", "inspect"] },
        material: { type: "string", description: "A material id, e.g. velvet-silk, silk-organza, copper." },
        materials: { type: "array", items: { type: "string" }, description: "Material ids to compare." },
        template: { type: "string", enum: PRODUCT_TEMPLATES.map((t) => t.id), description: "Product/jewellery template." },
        variables: { type: "object", description: "Template variable overrides, mm." },
        style: { type: "object", description: "Garment style (category, sleeves, length, silhouette, neckline)." },
        name: { type: "string" },
        object: { type: "string", description: "Object to inspect." },
      },
      required: ["action"],
    },
  ),
  definition(
    "couture.objects",
    "Operate a Creative Object",
    "Place a creation in the Cosmos, make it float, move/rotate/scale it, take a component off and put it back, reuse it in another creation, duplicate it, take it out of the Cosmos WITHOUT deleting it, restore it, save it to the library, undo and redo. Deterministic: no model call is involved in carrying it out.",
    {
      type: "object",
      properties: {
        action: { type: "string", enum: OBJECT_ACTIONS as unknown as string[] },
        object: { type: "string", description: "The object, by name or id." },
        relativeTo: { type: "string", description: "Reference object for a relative placement, e.g. \"the chair\"." },
        relation: { type: "string", enum: SPATIAL_RELATIONS, description: "Where to put it relative to relativeTo: left, right, above, below, in-front, behind, beside, centre." },
        gap: { type: "number", description: "Clear space to leave between the two objects, in millimetres." },
        component: { type: "string", description: "Component name, for detach (e.g. \"right sleeve\", \"stone\")." },
        parent: { type: "string", description: "Parent object, for attach." },
        target: { type: "string", description: "Target object, for reuse." },
        name: { type: "string" },
        roomId: { type: "string" },
        workspaceId: { type: "string" },
        material: { type: "string" },
        position: VEC3,
        delta: VEC3,
        rotation: VEC3,
        scale: { type: "number" },
        visible: { type: "boolean" },
      },
      required: ["action"],
    },
  ),
];

export function registerCoutureTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of COUTURE_TOOLS) registry.register(tool);
  for (const executor of COUTURE_EXECUTORS) {
    const tool = COUTURE_TOOLS.find((t) => t.id === executor.id);
    if (!tool) continue;
    const added = registerExecutor(executor, tool);
    if (!added.ok) console.warn(`[CoutureTools] ${executor.id} was not registered: ${added.reason}`);
  }
}

/* ---------------- executors ---------------- */

function store(): CreativeObjects {
  return CreativeObjects.getInstance();
}

/**
 * A plain snapshot of the authoritative state.
 *
 * Store operations mutate the object in place, so "before" has to be captured
 * as data, not as a reference — otherwise the comparison after the call would
 * compare an object with itself and always report "unchanged".
 */
function stateOf(object: CreativeObject): Record<string, unknown> {
  return {
    id: object.id,
    name: object.name,
    location: object.location,
    revision: object.revision,
    visible: object.visible,
    archived: object.archived,
    position: [...object.transform.position],
    rotation: [...object.transform.rotation],
    scale: [...object.transform.scale],
  };
}

function resolveOrFail(reference: string): { ok: true; id: string; name: string } | { ok: false; content: string } {
  const resolved = store().resolve(reference);
  if (!resolved.ok || !resolved.object) return { ok: false, content: resolved.message };
  return { ok: true, id: resolved.object.id, name: resolved.object.name };
}

const designExecutor: ToolExecutor = {
  id: "couture.design",
  parameters: COUTURE_TOOLS[0].inputSchema as Record<string, unknown>,
  run: async (args): Promise<ToolExecutionResult> => {
    const action = str(args, "action");

    if (action === "materials") {
      const query = str(args, "name") || str(args, "material");
      const found = searchMaterials({ ...(query ? { text: query } : {}), limit: 20 });
      return {
        ok: true,
        content: `${found.length} material(s)${query ? ` matching "${query}"` : ""}:\n${found.map((m) => `  ${m.id} — ${m.name} (${m.category})${m.physical ? `, ${m.physical.gsm} g/m², ${m.physical.bendingStiffness} mN·cm` : ", solid"}; ${m.provenance.basis}`).join("\n")}`,
        data: { materials: found.map((m) => ({ id: m.id, name: m.name, category: m.category, physical: m.physical ?? null, provenance: m.provenance })) },
      };
    }

    if (action === "material") {
      const material = findMaterial(str(args, "material"));
      if (!material) return { ok: false, content: `no material "${str(args, "material")}"` };
      return { ok: true, content: `${material.name} (${material.id})\n${material.provenance.basis}\nvisual ${JSON.stringify(material.visual)}\nphysical ${JSON.stringify(material.physical)}`, data: material };
    }

    if (action === "compare") {
      const ids = Array.isArray(args.materials) ? args.materials.map(String) : [];
      if (ids.length < 2) return { ok: false, content: "compare needs at least two material ids." };
      const rows = ids.map((id) => findMaterial(id)).filter((m): m is NonNullable<ReturnType<typeof findMaterial>> => Boolean(m));
      if (rows.length < 2) return { ok: false, content: `only ${rows.length} of those materials exist.` };
      return {
        ok: true,
        content: rows.map((m) => `${m.name}: ${m.physical ? `${m.physical.gsm} g/m², bending ${m.physical.bendingStiffness} mN·cm, opacity ${m.visual.opacity}, transmission ${m.visual.transmission}` : "solid"} — ${m.provenance.basis}`).join("\n"),
        data: rows.map((m) => ({ id: m.id, name: m.name, physical: m.physical ?? null, visual: m.visual })),
      };
    }

    if (action === "draft-pattern") {
      const style = (args.style && typeof args.style === "object" ? args.style : {}) as Partial<GarmentStyle>;
      const pattern = draftPattern(style, {}, (str(args, "size") || BASE_SIZE) as SizeLabel);
      const assembly = patternAssembly(pattern);
      const object = store().create({
        kind: "pattern",
        name: str(args, "name") || `${style.category ?? "dress"} pattern`,
        parts: assembly.parts,
        components: assembly.components,
        data: { ...assembly.data, draft: { style, measurements: {}, size: pattern.size } },
        source: { tool: "couture.design" },
        checks: assembly.checks,
      });
      return {
        ok: true,
        content: `Drafted ${pattern.name}: ${pattern.pieces.length} pieces, ${pattern.seams.length} seams, ${pattern.checks.filter((c) => c.ok).length}/${pattern.checks.length} checks. It is editable object ${object.id} ("${object.name}").`,
        data: { objectId: object.id, pieces: pattern.pieces.map((p) => p.id), checks: pattern.checks },
      };
    }

    if (action === "build-garment") {
      const material = str(args, "material") || "velvet-silk";
      const style = (args.style && typeof args.style === "object" ? args.style : {}) as Partial<GarmentStyle>;
      const built = buildGarment({ name: str(args, "name") || "garment", style, material, rows: 30, cols: 96, steps: 60, iterations: 8 });
      if (!built.ok || !built.garment) return { ok: false, content: built.reason ?? "garment build failed" };
      const assembly = garmentAssembly(built.garment);
      const object = store().create({
        kind: "garment",
        name: str(args, "name") || built.garment.name,
        parts: assembly.parts,
        components: assembly.components,
        sockets: assembly.sockets,
        data: assembly.data,
        source: { tool: "couture.design" },
        checks: assembly.checks,
      });
      return {
        ok: true,
        content: `Built ${object.name} (${object.id}): ${object.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0)} triangles, ${built.garment.report.totalMassG} g, ${built.garment.report.simulationMs} ms simulated. Components: ${object.components.map((c) => c.name).join(", ")}. It is not in the cosmos yet.`,
        data: { objectId: object.id, components: object.components, report: built.garment.report },
      };
    }

    if (action === "products") {
      return { ok: true, content: PRODUCT_TEMPLATES.map((t) => `${t.id} (${t.category}) — ${t.description}`).join("\n"), data: PRODUCT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category })) };
    }

    if (action === "product") {
      const template = str(args, "template");
      const variables = (args.variables && typeof args.variables === "object" ? args.variables : {}) as Record<string, number>;
      const built = buildProduct(template, variables);
      if (!built.ok || !built.assembly || !built.template) return { ok: false, content: built.reason ?? "product build failed" };
      const object = store().create({
        kind: built.template.category === "jewelry" ? "jewelry" : "product",
        name: str(args, "name") || built.template.name,
        parts: built.assembly.parts,
        components: built.assembly.components,
        sockets: built.assembly.sockets,
        data: { ...built.assembly.data, template: built.template.id, variables: built.variables?.list, limitations: built.assembly.limitations },
        source: { tool: "couture.design" },
        checks: built.assembly.checks,
      });
      return {
        ok: true,
        content: `Built ${object.name} (${object.id}) from ${built.template.id}: ${built.assembly.components.length} components (${built.assembly.components.map((c) => c.name).join(", ")}). ${built.assembly.data.estimatedWeightG ? `Estimated ${built.assembly.data.estimatedWeightG} g. ` : ""}${built.variables?.errors.length ? `Variable notes: ${built.variables.errors.join("; ")}` : ""}`,
        data: { objectId: object.id, variables: built.variables?.list, checks: built.assembly.checks, limitations: built.assembly.limitations },
      };
    }

    if (action === "inspect") {
      const resolved = resolveOrFail(str(args, "object"));
      if (!resolved.ok) return { ok: false, content: resolved.content };
      const object = store().get(resolved.id)!;
      const composition = store().compose(object.id, 0);
      return {
        ok: true,
        content: `${object.name} (${object.id}) — ${object.kind}, revision ${object.revision}, ${object.location}\ncomponents: ${object.components.map((c) => `${c.name} [${c.status}]`).join(", ")}\nvisible triangles: ${composition?.triangles ?? 0}\nmaterials: ${[...new Set(object.parts.map((p) => p.materialId))].join(", ")}\nhistory: ${object.history.slice(-3).map((h) => `${h.revision} ${h.action}`).join(" → ")}`,
        data: object,
      };
    }

    return { ok: false, content: `"${action}" is not a design action.` };
  },
};

const objectsExecutor: ToolExecutor = {
  id: "couture.objects",
  parameters: COUTURE_TOOLS[1].inputSchema as Record<string, unknown>,
  run: async (args): Promise<ToolExecutionResult> => {
    const parsed = parseObjectCall(args);
    if (!parsed.ok) return { ok: false, content: parsed.error };
    const call = parsed.call;
    const s = store();

    if (call.action === "undo") {
      const undone = s.undo();
      return { ok: undone.ok, content: undone.message };
    }
    if (call.action === "redo") {
      const redone = s.redo();
      return { ok: redone.ok, content: redone.message };
    }
    if (call.action === "list") {
      const listed = CreativeObjectBridge.listing(call.roomId, { store: s });
      return {
        ok: true,
        content: listed.length
          ? listed.map((o) => `${o.name} (${o.objectId}) — ${o.kind}, ${o.components} components, ${o.triangles} triangles at ${o.position.map((n) => Math.round(n)).join(",")} mm`).join("\n")
          : "Nothing from the creative engine is in the cosmos right now.",
        data: { objects: listed },
      };
    }

    const resolved = resolveOrFail(call.reference ?? "");
    if (!resolved.ok) return { ok: false, content: resolved.content };
    const id = resolved.id;
    const object = s.get(id)!;

    /**
     * Attach the outcome evidence to a result.
     *
     * A tool response saying "moved" is a CLAIM. This is the check behind it:
     * the authoritative state before and after, whether the store actually
     * changed, and the revision the change was persisted at. The executor never
     * reports an operation as done without it.
     */
    const before = stateOf(object);
    const verified = (
      result: ToolExecutionResult,
      action: string,
      extra: Record<string, unknown> = {},
    ): ToolExecutionResult => {
      const after = s.get(id);
      const afterState = after ? stateOf(after) : null;
      const storeChanged = Boolean(afterState) && JSON.stringify(before) !== JSON.stringify(afterState);
      return {
        ...result,
        data: {
          ...(result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {}),
          verification: {
            action,
            objectId: id,
            before,
            after: afterState,
            storeChanged,
            persisted: Boolean(after && after.revision >= object.revision),
            ...extra,
          },
        },
      };
    };

    switch (call.action) {
      case "select": {
        // Selection is a pointer, not a mutation: it must never bump a revision
        // or move the object. The revision check below proves that.
        selectCreativeObject({ objectId: id, ...(call.component ? { componentId: call.component } : {}) });
        const selection = getCreativeSelection();
        return verified(
          {
            ok: selection?.objectId === id,
            content: selection?.objectId === id
              ? `Selected ${object.name} (${object.id})${call.component ? `, component ${call.component}` : ""}. The object itself is unchanged (revision ${object.revision}).`
              : `could not select ${object.name}`,
            data: { selection },
          },
          "select",
          { selection },
        );
      }
      case "focus": {
        const listening = hasCreativeFocusListener();
        requestCreativeFocus(id);
        return verified(
          {
            ok: true,
            content: listening
              ? `Framing ${object.name} (${object.id}) on its own geometry.`
              : `Selection set for ${object.name}, but no scene is open to frame it in.`,
            data: { framed: listening },
          },
          "focus",
          { framed: listening },
        );
      }
      case "inspect": {
        const composition = s.compose(id, 0);
        return {
          ok: true,
          content: `${object.name} (${object.id}) — ${object.kind}, revision ${object.revision}, ${object.location}${object.roomId ? ` in ${object.roomId}` : ""}, ${composition?.triangles ?? 0} visible triangles, components: ${object.components.map((c) => `${c.name} [${c.status}]`).join(", ")}`,
          data: object,
        };
      }
      case "place-in-cosmos": {
        const placed = CreativeObjectBridge.place(id, { ...(call.roomId ? { roomId: call.roomId } : {}), ...(call.position ? { position: call.position } : {}), store: s });
        return { ok: placed.ok, content: placed.message, data: placed };
      }
      case "remove-from-cosmos": {
        const removed = CreativeObjectBridge.remove(id, { store: s });
        return { ok: removed.ok, content: removed.message, data: removed };
      }
      case "restore": {
        const placed = CreativeObjectBridge.place(id, { store: s });
        return { ok: placed.ok, content: placed.message, data: placed };
      }
      case "move": {
        if (call.relativeTo) {
          const target = resolveOrFail(call.relativeTo);
          if (!target.ok) return { ok: false, content: target.content };
          if (target.id === id) return { ok: false, content: `cannot place ${object.name} relative to itself.` };
          const anchor = s.get(target.id);
          if (!anchor) return { ok: false, content: `no object ${target.id}` };
          if (!objectWorldBox(object) || !objectWorldBox(anchor)) {
            return { ok: false, content: `cannot measure ${object.name} or ${anchor.name}: no geometry.` };
          }
          const next = positionedRelativeTo(object, anchor, call.relation ?? "beside", (call.gap ?? 250) / 1000);
          if (!next) return { ok: false, content: `could not work out where to put ${object.name}.` };
          const result = s.setTransform(id, { position: next });
          return verified(
            {
              ok: Boolean(result),
              content: result
                ? `${result.name} placed ${call.relation ?? "beside"} ${anchor.name}, at ${result.transform.position.map((n) => Math.round(n)).join(", ")} mm`
                : "could not move it",
              data: { relativeTo: anchor.id, relation: call.relation ?? "beside" },
            },
            "move",
            { relativeTo: anchor.id, relation: call.relation ?? "beside" },
          );
        }
        const result = call.position ? s.setTransform(id, { position: call.position }) : s.moveBy(id, vec3(args.delta) ?? [0, 0, 0]);
        return verified(
          { ok: Boolean(result), content: result ? `${result.name} moved to ${result.transform.position.map((n) => Math.round(n)).join(", ")} mm` : "could not move it" },
          "move",
        );
      }
      case "rotate": {
        const result = call.rotation ? s.setTransform(id, { rotation: call.rotation }) : s.rotateBy(id, vec3(args.delta) ?? [0, 0, 0]);
        return verified(
          { ok: Boolean(result), content: result ? `${result.name} rotated to ${result.transform.rotation.map((n) => Math.round(n)).join(", ")}°` : "could not rotate it" },
          "rotate",
        );
      }
      case "scale": {
        const result = s.scaleTo(id, call.scale ?? 1);
        return verified(
          { ok: Boolean(result), content: result ? `${result.name} scale ${result.transform.scale[0]}` : "could not scale it" },
          "scale",
        );
      }
      case "float": {
        const result = s.setMotion(id, { kind: "spin", paused: false });
        return { ok: Boolean(result), content: result ? `${result.name} floats: ${result.motion.kind} at ${result.motion.speed}/min` : "could not animate it" };
      }
      case "anchor": {
        const result = s.anchor(id, true);
        return { ok: Boolean(result), content: result ? `${result.name} anchored` : "could not anchor it" };
      }
      case "pause": {
        const result = s.setMotion(id, { paused: true });
        return { ok: Boolean(result), content: result ? `${result.name} motion paused` : "could not pause it" };
      }
      case "detach": {
        const result = s.detachComponent(id, call.component ?? "");
        return { ok: result.ok, content: result.message, data: result.object };
      }
      case "attach": {
        const parent = resolveOrFail(call.parent ?? "");
        if (!parent.ok) return { ok: false, content: parent.content };
        const result = s.attachComponent(id, parent.id);
        return { ok: result.ok, content: result.message, data: result.object };
      }
      case "reuse": {
        const target = resolveOrFail(call.target ?? "");
        if (!target.ok) return { ok: false, content: target.content };
        const result = s.reuseComponent(id, target.id);
        return { ok: result.ok, content: result.message, data: result.object };
      }
      case "duplicate": {
        const copy = s.duplicate(id, { ...(call.name ? { name: call.name } : {}), toCosmos: object.location === "cosmos" });
        return { ok: Boolean(copy), content: copy ? `Duplicated as "${copy.name}" (${copy.id}), revision ${copy.revision}` : `could not duplicate ${object.name}` };
      }
      case "set-material": {
        const result = s.setMaterial(id, call.material ?? "", call.component);
        return { ok: Boolean(result), content: result ? `${result.name}: ${call.material} on ${call.component ?? "every part"}; geometry unchanged` : "could not set the material" };
      }
      case "save-to-library": {
        const result = s.saveToLibrary(id, call.name);
        return { ok: Boolean(result), content: result ? `${result.name} saved to the library (still ${result.parts.length} parts)` : "could not save it" };
      }
      case "move-to-workspace": {
        const result = s.moveToWorkspace(id, call.workspaceId || "chat-universe");
        return { ok: Boolean(result), content: result ? `${result.name} moved to ${result.workspaceId}` : "could not move it" };
      }
      case "archive": {
        const result = s.archive(id);
        return { ok: Boolean(result), content: result ? `${result.name} archived (kept, not deleted)` : "could not archive it" };
      }
      case "unarchive": {
        const result = s.unarchive(id);
        return { ok: Boolean(result), content: result ? `${result.name} restored from the archive` : "could not unarchive it" };
      }
      case "visibility": {
        const result = s.setVisible(id, call.visible ?? true);
        return { ok: Boolean(result), content: result ? `${result.name} ${result.visible ? "shown" : "hidden"}` : "could not change visibility" };
      }
      default:
        return { ok: false, content: `"${call.action}" is not implemented.` };
    }
  },
};

export const COUTURE_EXECUTORS: ToolExecutor[] = [designExecutor, objectsExecutor];
