/**
 * ==========================================================
 * LÉLU — COSMOS OBJECT TOOLS
 *
 * The same ToolRegistry → ToolDispatcher → AutonomyGate path as every
 * other tool, but every one of these runs locally and deterministically:
 * taking an object out of the library and putting it in the Cosmos,
 * moving it, spinning it, grouping, integrating, extracting, isolating,
 * duplicating, removing, restoring, listing.
 *
 * Nothing here asks a model anything. A construction becomes an object,
 * and every later operation is a plain function over the object store,
 * so routine work costs zero model calls and cannot "succeed" without
 * changing the scene: each result is read back from the store.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../../tools/ToolRegistry";
import type { ToolExecutionResult } from "../../tools/ToolDispatcher";
import StudioStore from "../../studio/StudioStore";
import CosmosObjectStore from "./CosmosObjectStore";
import { cosmosCameraBus, cosmosViewBus, type CosmosCameraMode } from "./CosmosObjectCamera";
import { describeObject, type CosmosObject } from "./CosmosObjectTypes";
import { conversationOf, messagesOf, rememberCosmosReferent, resolveCosmosTarget } from "./continuity";
import { persistedObject, snapshotOf, verifyObjectOperation, type ObjectSnapshot, type OperationExpectation } from "./verification";
import type { BuildProgram } from "../../creative/kit/build";
import type { Scene3DProgram } from "../../creative/kit/Scene3D";

/** The part of RouterContext the object tools need: this conversation, and its messages. */
type ToolContext = { request?: { conversationId?: string; messages?: Array<{ role?: string; content?: unknown }> } } | undefined;

interface CosmosExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, context?: ToolContext) => Promise<ToolExecutionResult>;
}

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const s = (args: Record<string, unknown>, k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
const n = (args: Record<string, unknown>, k: string) => (typeof args[k] === "number" && Number.isFinite(args[k]) ? (args[k] as number) : undefined);
const vec = (v: unknown) => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number") ? (v as [number, number, number]) : undefined);
const ok = (content: string, data?: Record<string, unknown>): ToolExecutionResult => ({ ok: true, content, data });
const bad = (content: string): ToolExecutionResult => ({ ok: false, content });

const def = (id: string, name: string, description: string, risk: number, permissions: string[], inputSchema: Record<string, unknown>): ToolDefinition => ({
  id, name, description, category: "COSMOS" as ToolDefinition["category"], permissions, riskLevel: risk, available: true, inputSchema, executionRoute: "local · CosmosObjectStore",
} as ToolDefinition);

/** A recorded change, before and after, for the verdict. */
interface VerdictInput {
  id: string;
  action: string;
  before: ObjectSnapshot | null;
  expectation: Omit<OperationExpectation, "action" | "objectId">;
  content: string;
  data?: Record<string, unknown>;
  /** A safe re-application, used at most once. */
  retry?: () => void;
  context?: ToolContext;
}

/**
 * Judge what actually happened, then report it.
 *
 * A store call returning ok is not evidence that the requested state exists,
 * so the object is read back and checked on its target, its change, the value
 * that was asked for and the fields it must not touch. If nothing changed at
 * all, a transform is re-applied ONCE (repeating a no-op is safe); a second
 * failure is reported as a failure, and `ok` is false rather than "done".
 */
function judged(input: VerdictInput): ToolExecutionResult {
  const store = CosmosObjectStore.getInstance();
  const read = () => {
    const object = store.get(input.id);
    return object
      ? { snapshot: snapshotOf(object), persisted: persistedObject(input.id)?.updatedAt === object.updatedAt }
      : { snapshot: null, persisted: false };
  };

  let { snapshot, persisted } = read();
  let verification = verifyObjectOperation({ action: input.action, objectId: input.id, ...input.expectation }, input.before, snapshot, persisted);
  let correction: Record<string, unknown> | undefined;

  const nothingChanged = verification.checks.some((check) => check.name.includes("recorded the change") && !check.ok);
  if (verification.status === "FAILED" && nothingChanged && input.retry && input.expectation.expect) {
    input.retry();
    ({ snapshot, persisted } = read());
    const second = verifyObjectOperation({ action: input.action, objectId: input.id, ...input.expectation }, input.before, snapshot, persisted);
    correction = { attempted: true, status: second.status, tries: 2 };
    verification = second;
  }

  const failed = verification.status === "FAILED";
  const recovered = Boolean(correction) && verification.status === "VERIFIED";
  if (!failed) rememberCosmosReferent(conversationOf(input.context), input.id);

  return {
    ok: !failed,
    content: failed
      ? `${input.content} — verification failed: ${verification.note ?? "the requested state was not reached"}`
      : recovered
        ? `${input.content} — applied on retry after the first attempt did not reach the store`
        : input.content,
    data: {
      ...(input.data ?? {}),
      objectId: input.id,
      verification: {
        action: input.action,
        objectId: input.id,
        before: input.before,
        after: snapshot,
        persisted,
        result: verification,
        ...(correction ? { correction } : {}),
      },
    },
  };
}

/** The construction behind a Studio artifact, if it is a build. */
function buildOf(artifactId: string): { program: BuildProgram; rev: number; id: string } | null {
  const store = StudioStore.getInstance();
  const artifact = store.get(artifactId) ?? store.resolve(artifactId);
  if (!artifact) return null;
  const rev = store.latest(artifact);
  const spec = rev.spec;
  if (spec.kind !== "visual") return null;
  const program = (spec.program as { build?: BuildProgram }).build;
  if (!program || program.kind !== "build") return null;
  return { program, rev: rev.rev, id: artifact.id };
}

/** The most recently built construction in the Studio — what "it" means. */
function latestConstruction(): { artifactId: string; title: string } | null {
  const store = StudioStore.getInstance();
  const builds = store.list().filter((a) => {
    const spec = store.latest(a).spec;
    if (spec.kind !== "visual") return false;
    const program = (spec.program as { build?: BuildProgram }).build;
    return Boolean(program && program.kind === "build");
  });
  // StudioStore.list() is newest-first, so "it" is the first build, not the last.
  const newest = builds[0];
  return newest ? { artifactId: newest.id, title: newest.title } : null;
}

function sceneOfCall(program: BuildProgram): Scene3DProgram {
  return program.scene;
}

export const COSMOS_OBJECT_EXECUTORS: CosmosExecutor[] = [
  {
    id: "cosmos.object.spawn",
    parameters: OBJ({
      artifact: { type: "string", description: "a Studio artifact: its id, or part of its name (“gearbox”, “cabin”)" },
      name: { type: "string", description: "what to call the object in the Cosmos" },
      position: { type: "array", items: { type: "number" }, description: "[x, y, z]" },
      scale: { type: "number" },
      group: { type: "string", description: "an existing group id/name to add it to" },
      place: { type: "string", enum: ["cosmos", "workspace", "gallery"] },
      motion: { type: "string", enum: ["still", "spin", "orbit", "bob", "drift"] },
    }, ["artifact"]),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const named = s(args, "artifact");
      const pronoun = !named || /^(it|that|this|the one|them|they)$/i.test(named);
      const latest = pronoun ? latestConstruction() : null;
      if (pronoun && !latest) return bad("Nothing spawned: there is no construction yet to put in the Cosmos — build something first.");
      const artifact = latest?.artifactId ?? named;
      const found = buildOf(artifact);
      if (!found) {
        const studio = StudioStore.getInstance();
        const any = studio.get(artifact) ?? studio.resolve(artifact);
        return bad(!any
          ? `Nothing spawned: no artifact matches “${artifact}”. Build one first, or name an existing artifact.`
          : `Nothing spawned: “${any.title}” is a ${any.kind}, not a construction — only constructed artifacts have geometry to place.`);
      }
      const { program, rev } = found;
      // Store the artifact's real id, not the words the user used to name it,
      // so "open it in the workspace" can find the construction again.
      const parent = s(args, "group");
      const groupId = parent ? store.groups_[parent]?.id ?? Object.values(store.groups_).find((g) => g.name.toLowerCase() === parent.toLowerCase())?.id ?? null : null;
      const spawned = store.spawn({
        name: s(args, "name") || program.title,
        description: `${program.domain} · ${program.builder} · ${program.parts.length} parts${program.sources?.length ? ` · ${program.sources.length} source(s)` : ""}`,
        domain: program.domain,
        builder: program.builder,
        params: program.params,
        scene: sceneOfCall(program),
        partCount: program.parts.length,
        source: { artifactId: found.id, rev },
        frame: { position: vec(args.position), scale: n(args, "scale") },
        group: groupId,
        motion: s(args, "motion") ? { kind: s(args, "motion") as CosmosObject["motion"]["kind"] } : undefined,
        place: (s(args, "place") || "cosmos") as CosmosObject["place"],
      });
      if (!spawned.ok) return bad(`Nothing spawned: ${spawned.reason}.`);
      const object = spawned.value;
      const back = store.get(object.id);
      if (!back) return bad("The object was created but is not in the Cosmos — nothing to report as placed.");
      return ok(`In the Cosmos: ${describeObject(back)}. It is its own object now: it can be moved, grouped, opened or exported on its own.`, { objectId: object.id, artifactId: back.source?.artifactId });
    },
  },
  {
    id: "cosmos.object.position",
    parameters: OBJ({
      object: { type: "string", description: "the object, by id or part of its name (defaults to the selected one)" },
      position: { type: "array", items: { type: "number" }, description: "[x, y, z]" },
      scale: { type: "number" },
      rotation: { type: "array", items: { type: "number" }, description: "degrees [x, y, z]" },
      relative: { type: "boolean", description: "add to the current position instead of replacing it" },
      near: { type: "string", description: "an object to sit beside — its position is read, never guessed" },
      direction: { type: "string", enum: ["left", "right", "up", "down", "forward", "back"], description: "move a step in a world direction, from where it stands" },
      side: { type: "string", description: "left | right | up | down | front | behind, relative to `near`" },
    }),
    run: async (args, context) => {
      const store = CosmosObjectStore.getInstance();
      // "it" is this conversation's object, never the newest one in the scene.
      const lookup = resolveCosmosTarget(store, s(args, "object"), { messages: messagesOf(context), conversationId: conversationOf(context) });
      if (!("object" in lookup)) return bad(`Nothing moved: ${lookup.reason}.`);
      const object = lookup.object;
      const before = snapshotOf(object);

      let position = vec(args.position);
      const near = s(args, "near");
      if (near) {
        const anchor = store.resolve(near);
        if (!anchor) return bad(`Nothing moved: there is no “${near}” in the Cosmos to sit beside.`);
        if (anchor.id === object.id) return bad("Nothing moved: an object cannot sit beside itself.");
        const reach = Math.max(anchor.frame.scale * 1.4, object.frame.scale * 1.4);
        // Where "beside" is depends on the word: the offset is a real world
        // direction from the anchor's own position, not a guess at the camera.
        const side = s(args, "side") || "right";
        const offset: [number, number, number] =
          side === "left" ? [-reach, 0, 0] : side === "up" ? [0, reach, 0] : side === "down" ? [0, -reach, 0] : side === "front" ? [0, 0, reach] : side === "behind" ? [0, 0, -reach] : [reach, 0, 0];
        position = [anchor.frame.position[0] + offset[0], anchor.frame.position[1] + offset[1], anchor.frame.position[2] + offset[2]];
      }

      const direction = s(args, "direction");
      if (!position && direction) {
        // A step in a world direction, measured from where it stands — no camera guess.
        const step = 1.2;
        const offset: [number, number, number] =
          direction === "left" ? [-step, 0, 0] : direction === "right" ? [step, 0, 0] : direction === "up" ? [0, step, 0] : direction === "down" ? [0, -step, 0] : direction === "forward" ? [0, 0, step] : [0, 0, -step];
        position = [before.position[0] + offset[0], before.position[1] + offset[1], before.position[2] + offset[2]];
      }

      const relative = args.relative === true;
      const rotation = vec(args.rotation);
      const scaleArg = n(args, "scale");
      // A relative scale is a factor ("twice as large"), an absolute one is the
      // value the object should end up at.
      const scale = scaleArg === undefined ? undefined : relative ? object.frame.scale * scaleArg : scaleArg;
      const apply = () => store.transform(object.id, { position, rotation, scale, absolute: !relative });
      const result = apply();
      if (!result.ok) return bad(`Nothing moved: ${result.reason}.`);

      const back = store.get(object.id)!;
      // What the frame should be, where the request makes it knowable.
      const expectedPosition = position
        ? relative
          ? ([before.position[0] + position[0], before.position[1] + position[1], before.position[2] + position[2]] as [number, number, number])
          : position
        : undefined;
      const preserve: Array<"position" | "rotation" | "scale"> = [];
      if (!position) preserve.push("position");
      if (!rotation) preserve.push("rotation");
      if (typeof scale !== "number") preserve.push("scale");

      return judged({
        id: object.id,
        action: "transform",
        before,
        context,
        expectation: {
          ...(expectedPosition ? { expect: { position: expectedPosition } } : {}),
          ...(rotation && !relative ? { expect: { rotation } } : {}),
          preserve,
        },
        retry: apply,
        content: `${near ? `Moved beside “${near}”` : "Moved"}: ${describeObject(back)}.`,
      });
    },
  },
  {
    id: "cosmos.object.transform",
    parameters: OBJ({
      object: { type: "string" },
      rotation: { type: "array", items: { type: "number" } },
      scale: { type: "number" },
      position: { type: "array", items: { type: "number" } },
      relative: { type: "boolean" },
    }),
    run: async (args, context) => COSMOS_OBJECT_EXECUTORS.find((e) => e.id === "cosmos.object.position")!.run(args, context),
  },
  {
    id: "cosmos.object.animate",
    parameters: OBJ({
      object: { type: "string" },
      motion: { type: "string", enum: ["still", "spin", "orbit", "bob", "drift"] },
      speed: { type: "number", description: "turns per second, or metres per second for drift" },
      axis: { type: "string", enum: ["x", "y", "z"] },
      paused: { type: "boolean" },
      all: { type: "boolean", description: "pause or resume every floating object" },
    }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      if (args.all === true) {
        const paused = args.paused !== false;
        const count = store.pauseAll(paused);
        return ok(`${paused ? "Paused" : "Resumed"} ${count} floating object${count === 1 ? "" : "s"}${count === 0 ? " — none were moving" : ""}.`, { count });
      }
      const object = store.resolve(s(args, "object"));
      if (!object) return bad(`No object matches “${s(args, "object") || "that"}” — nothing animated.`);
      const result = store.animate(object.id, {
        kind: s(args, "motion") as CosmosObject["motion"]["kind"] || object.motion.kind,
        speed: n(args, "speed"),
        axis: (s(args, "axis") || object.motion.axis) as CosmosObject["motion"]["axis"],
        paused: typeof args.paused === "boolean" ? args.paused : object.motion.paused,
      });
      if (!result.ok) return bad(`Nothing animated: ${result.reason}.`);
      const back = store.get(object.id)!;
      return ok(`“${back.name}” now ${back.motion.paused ? "sits still" : back.motion.kind === "still" ? "sits still" : `${back.motion.kind}s at ${back.motion.speed} on ${back.motion.axis}`}${back.motion.paused && back.motion.kind !== "still" ? " (paused)" : ""}.`);
    },
  },
  {
    id: "cosmos.object.select",
    parameters: OBJ({ object: { type: "string" }, clear: { type: "boolean" }, add: { type: "boolean", description: "add to the selection instead of replacing it" } }),
    run: async (args, context) => {
      const store = CosmosObjectStore.getInstance();
      if (args.clear === true) {
        store.select(null);
        return ok("Selection cleared.");
      }
      const lookup = resolveCosmosTarget(store, s(args, "object"), { messages: messagesOf(context), conversationId: conversationOf(context) });
      if (!("object" in lookup)) return bad(`Nothing selected: ${lookup.reason}.`);
      const result = store.select(lookup.object.id, { add: args.add === true });
      if (!result.ok) return bad(`Nothing selected: ${result.reason}.`);
      if (!result.value) return ok("Selection cleared.");
      const many = store.selectionIds();
      const chosen = result.value;
      return judged({
        id: chosen.id,
        action: "select",
        before: snapshotOf(chosen),
        context,
        expectation: { mutates: false },
        content: many.length > 1 ? `Selected ${many.length} objects: ${many.join(", ")}.` : `Selected ${describeObject(chosen)}.`,
        data: { selection: many },
      });
    },
  },
  {
    id: "cosmos.object.group",
    parameters: OBJ({
      objects: { type: "array", items: { type: "string" }, description: "ids or names; two or more" },
      name: { type: "string" },
    }, ["objects"]),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const ids = Array.isArray(args.objects) ? args.objects.map((v) => String(v)) : [];
      const result = store.group(ids, s(args, "name"));
      if (!result.ok) return bad(`Nothing grouped: ${result.reason}.`);
      return ok(`Grouped ${result.value.members.length} objects as “${result.value.name}” (${result.value.id}). Their identities and positions are unchanged.`, { groupId: result.value.id });
    },
  },
  {
    id: "cosmos.object.ungroup",
    parameters: OBJ({ group: { type: "string", description: "the group, or any object in it" } }, ["group"]),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const result = store.ungroup(s(args, "group"));
      if (!result.ok) return bad(`Nothing ungrouped: ${result.reason}.`);
      return ok(`Ungrouped ${result.value.length} object${result.value.length === 1 ? "" : "s"}; each one is independent again.`);
    },
  },
  {
    id: "cosmos.object.integrate",
    parameters: OBJ({ object: { type: "string", description: "the object to place inside" }, into: { type: "string", description: "the environment or assembly that holds it" } }, ["object", "into"]),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const child = store.resolve(s(args, "object"));
      const parent = store.resolve(s(args, "into"));
      if (!child) return bad(`Nothing integrated: no object matches “${s(args, "object")}”.`);
      if (!parent) return bad(`Nothing integrated: no object matches “${s(args, "into")}”.`);
      const result = store.integrate(child.id, parent.id);
      if (!result.ok) return bad(`Nothing integrated: ${result.reason}.`);
      return ok(`“${child.name}” is now part of “${parent.name}”. It keeps its own id, geometry and revision — extracting it later changes nothing about it.`, { objectId: child.id, parentId: parent.id });
    },
  },
  {
    id: "cosmos.object.extract",
    parameters: OBJ({ object: { type: "string" }, open: { type: "string", description: "open it here: workspace | card" } }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const object = store.resolve(s(args, "object"));
      if (!object) return bad(`Nothing extracted: no object matches “${s(args, "object")}”.`);
      const was = object.parent;
      const result = store.extract(object.id);
      if (!result.ok) return bad(`Nothing extracted: ${result.reason}.`);
      const back = store.get(object.id)!;
      const lines = [`Extracted “${back.name}”${was ? ` from “${store.get(was)?.name ?? was}”` : ""}: ${describeObject(back)}.`];
      if (back.source) {
        const studio = StudioStore.getInstance();
        const artifact = studio.get(back.source.artifactId);
        lines.push(artifact
          ? `Still the same construction: ${artifact.title} (${back.source.artifactId}) revision ${studio.latest(artifact).rev}.`
          : `Its source artifact ${back.source.artifactId} is no longer in the Studio; the object's own geometry is intact.`);
      }
      if (s(args, "open") === "workspace") lines.push("Open the construction in the Studio to edit its parameters; the object keeps its own copy of the geometry.");
      return ok(lines.join(" "), { objectId: back.id });
    },
  },
  {
    id: "cosmos.object.isolate",
    parameters: OBJ({ object: { type: "string" }, showAll: { type: "boolean" } }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      if (args.showAll === true) {
        const changed = store.showAll();
        return ok(`Showing everything again (${changed} object${changed === 1 ? "" : "s"} came back).`);
      }
      const result = store.isolate(s(args, "object"));
      if (!result.ok) return bad(`Nothing isolated: ${result.reason}.`);
      return ok(`${result.value} other object${result.value === 1 ? "" : "s"} hidden — the selected one is alone in the Cosmos.`, { hidden: result.value });
    },
  },
  {
    id: "cosmos.object.duplicate",
    parameters: OBJ({ object: { type: "string" }, name: { type: "string" }, scale: { type: "number" } }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const object = store.resolve(s(args, "object"));
      if (!object) return bad(`Nothing duplicated: no object matches “${s(args, "object")}”.`);
      const result = store.duplicate(object.id, { name: s(args, "name") || undefined, scale: n(args, "scale") });
      if (!result.ok) return bad(`Nothing duplicated: ${result.reason}.`);
      return ok(`Duplicated: ${describeObject(result.value)}. The original is untouched.`, { objectId: result.value.id });
    },
  },
  {
    id: "cosmos.object.remove",
    parameters: OBJ({ object: { type: "string" }, confirm: { type: "boolean", description: "true to remove even if it holds other objects" } }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const object = store.resolve(s(args, "object"));
      if (!object) return bad(`Nothing removed: no object matches “${s(args, "object")}”.`);
      const result = store.remove(object.id, args.confirm === true);
      if (!result.ok) return bad(`Nothing removed: ${result.reason}.`);
      return ok(`Removed “${result.value.name}” from the Cosmos. It is in the trash and can be restored with cosmos.object.restore.`, { objectId: result.value.id });
    },
  },
  {
    id: "cosmos.object.restore",
    parameters: OBJ({ object: { type: "string" } }, ["object"]),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const result = store.restore(s(args, "object"));
      if (!result.ok) return bad(`Nothing restored: ${result.reason}.`);
      return ok(`Restored ${describeObject(result.value)}.`, { objectId: result.value.id });
    },
  },
  {
    id: "cosmos.object.reset",
    parameters: OBJ({}),
    run: async () => {
      const store = CosmosObjectStore.getInstance();
      const changed = store.resetPositions();
      return ok(changed ? `Put ${changed} object${changed === 1 ? "" : "s"} back in their starting arrangement, unrotated and at scale 1.` : "Every object is already where it started.");
    },
  },
  {
    id: "cosmos.object.list",
    parameters: OBJ({ domain: { type: "string" }, group: { type: "string" }, query: { type: "string" }, trash: { type: "boolean" } }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      if (args.trash === true) {
        const trashed = store.trashList();
        return ok(trashed.length ? `In the trash: ${trashed.map((o) => `${o.id} “${o.name}”`).join("; ")}.` : "The trash is empty.", { count: trashed.length });
      }
      const objects = store.list({ domain: s(args, "domain") || undefined, group: s(args, "group") || undefined, query: s(args, "query") || undefined });
      const groups = Object.values(store.groups_);
      if (!objects.length) return ok("The Cosmos holds no objects yet. Build something and spawn it.", { count: 0 });
      return ok(
        [`${objects.length} object${objects.length === 1 ? "" : "s"} in the Cosmos:`, ...objects.map((o) => `- ${describeObject(o)}`), ...(groups.length ? [`Groups: ${groups.map((g) => `${g.id} “${g.name}” (${g.members.length})`).join("; ")}.`] : [])].join("\n"),
        { count: objects.length, groups: groups.length },
      );
    },
  },
  {
    id: "cosmos.object.split",
    parameters: OBJ({ object: { type: "string" }, part: { type: "string", description: "a part of that object: “crank”, “seat”, “sleeve”" } }, ["object", "part"]),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const object = store.resolve(s(args, "object"));
      if (!object) return bad(`Nothing split: no object matches “${s(args, "object")}”.`);
      const result = store.splitPart(object.id, s(args, "part"));
      if (!result.ok) return bad(`Nothing split: ${result.reason}.`);
      const { source, part } = result.value;
      return ok(
        `Took ${part.name.split(" · ").pop()} out of “${source.name}” as its own object: ${describeObject(part)}. It sits where it was, keeps its material, and “${source.name}” still has its own id and ${source.partCount} parts.`,
        { objectId: part.id, sourceId: source.id },
      );
    },
  },
  {
    id: "cosmos.object.place",
    parameters: OBJ({ object: { type: "string" }, place: { type: "string", description: "cosmos | workspace | gallery" } }, ["object", "place"]),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const object = store.resolve(s(args, "object"));
      if (!object) return bad(`Nothing moved: no object matches “${s(args, "object")}”.`);
      const result = store.setPlace(object.id, s(args, "place") as "cosmos" | "workspace" | "gallery");
      if (!result.ok) return bad(`Nothing moved: ${result.reason}.`);
      return ok(`Moved “${result.value.name}” to the ${result.value.place} — the same object, with its id, geometry and revision history intact.`, { objectId: result.value.id, place: result.value.place });
    },
  },
  {
    id: "cosmos.object.undo",
    parameters: OBJ({}),
    run: async () => {
      const store = CosmosObjectStore.getInstance();
      const result = store.undo();
      if (!result.ok) return bad(`Nothing undone: ${result.reason}.`);
      const depth = store.historyDepth();
      return ok(`Undone. ${store.list().length} object${store.list().length === 1 ? "" : "s"} in the Cosmos now, with their ids and geometry as they were. ${depth.undo} more step${depth.undo === 1 ? "" : "s"} can be taken back.`, { undo: depth.undo, redo: depth.redo });
    },
  },
  {
    id: "cosmos.object.redo",
    parameters: OBJ({}),
    run: async () => {
      const store = CosmosObjectStore.getInstance();
      const result = store.redo();
      if (!result.ok) return bad(`Nothing redone: ${result.reason}.`);
      const depth = store.historyDepth();
      return ok(`Redone. ${store.list().length} object${store.list().length === 1 ? "" : "s"} in the Cosmos. ${depth.redo} more step${depth.redo === 1 ? "" : "s"} can be redone.`, { undo: depth.undo, redo: depth.redo });
    },
  },
  {
    id: "cosmos.view.open",
    parameters: OBJ({ open: { type: "boolean", description: "true to enter the Cosmos, false to go back to the workspace" }, frame: { type: "boolean" } }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const open = args.open !== false;
      if (!cosmosViewBus.live) {
        return bad("The Cosmos view is not mounted in this build, so it cannot be opened from here.");
      }
      cosmosViewBus.request({ mode: open ? "open" : "close", frame: args.frame !== false });
      if (!open) return ok("Back to the workspace. The objects stay where they were.", { open });
      const objects = store.list();
      return ok(
        objects.length
          ? `Opened the Cosmos with ${objects.length} object${objects.length === 1 ? "" : "s"} in it${args.frame === false ? "" : ", framed to fit"}. Tap one to select it; drag it to move it.`
          : "Opened the Cosmos. It is empty — build something and put it here.",
        { open, count: objects.length },
      );
    },
  },
  {
    id: "cosmos.view.frame",
    parameters: OBJ({
      mode: { type: "string", description: "all | selected | assembly | focus | home | previous | zoom" },
      object: { type: "string" },
      factor: { type: "number" },
    }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const mode = (s(args, "mode") || "all") as CosmosCameraMode;
      const modes: CosmosCameraMode[] = ["all", "selected", "assembly", "focus", "home", "previous", "zoom"];
      if (!modes.includes(mode)) return bad(`Nothing framed: “${mode}” is not a camera mode — use ${modes.join(", ")}.`);
      const selected = store.selectedId();
      const object = s(args, "object") || (mode === "selected" && selected ? selected : "");
      if (mode === "selected" && !object) return bad("Nothing framed: no object is selected.");
      if (!cosmosCameraBus.live) {
        return bad("The Cosmos scene is not open, so there is no camera to move. Open the Cosmos and ask again — the objects themselves are safe in the store.");
      }
      cosmosCameraBus.request({ mode, object: object || undefined, factor: n(args, "factor"), because: "tool" });
      const target = object ? store.resolve(object) : undefined;
      const what = mode === "all" ? `all ${store.list().filter((o) => o.visible).length} objects` : mode === "home" ? "the home view" : mode === "previous" ? "the previous view" : `“${target?.name ?? object}”`;
      return ok(`Framed ${what}. The camera move is bounded by the Cosmos' own navigation, and your next drag takes over.`, { mode, objectId: target?.id ?? null });
    },
  },
  {
    id: "cosmos.object.relocate",
    parameters: OBJ({
      object: { type: "string", description: "the object, by id or part of its name (defaults to the selected one)" },
    }),
    run: async (args) => {
      const store = CosmosObjectStore.getInstance();
      const object = store.resolve(s(args, "object"));
      if (!object) return bad(`Nothing moved: no object matches “${s(args, "object") || "that"}”.`);
      const before = object.frame.position.map((n) => n.toFixed(1)).join(", ");
      const moved = store.relocate(object.id);
      if (!moved.ok) return bad(`Nothing moved: ${moved.reason}.`);
      const after = moved.value.frame.position.map((n) => n.toFixed(1)).join(", ");
      return ok(`Brought “${moved.value.name}” out to [${after}] (was [${before}]) — clear of the core's cluster and of the other objects. Undo puts it back.`, { objectId: object.id });
    },
  },
];

export const COSMOS_OBJECT_TOOLS: ToolDefinition[] = [
  def("cosmos.object.spawn", "Put an Object in the Cosmos", "Take a constructed artifact and make it a real, independent object in the Cosmos: its own id, position, scale, motion and parent. Runs locally; no model, no server.", 1, ["WRITE"], { artifact: "string", name: "string", position: "number[3]", scale: "number", group: "string", place: "string", motion: "string" }),
  def("cosmos.object.position", "Move an Object", "Move, rotate or rescale an object in the Cosmos. Relative or absolute, in metres and degrees. Local and immediate.", 1, ["WRITE"], { object: "string", position: "number[3]", rotation: "number[3]", scale: "number", relative: "boolean" }),
  def("cosmos.object.transform", "Rotate or Resize an Object", "The same operation as cosmos.object.position, for rotation and scale.", 1, ["WRITE"], { object: "string", rotation: "number[3]", scale: "number", position: "number[3]", relative: "boolean" }),
  def("cosmos.object.animate", "Float, Spin or Pause Objects", "Give an object a motion (spin, orbit, bob, drift) or stop it, and pause or resume every floating object at once.", 1, ["WRITE"], { object: "string", motion: "string", speed: "number", axis: "string", paused: "boolean", all: "boolean" }),
  def("cosmos.object.reset", "Reset the Arrangement", "Return every object to the ring slot it was first placed in, unrotated and at scale 1. Local, reversible by moving things again.", 1, ["WRITE"], {}),
  def("cosmos.object.select", "Select an Object", "Select one object in the Cosmos — or add it to the selection — for the controls and later commands to act on. Clear it when done.", 0, ["READ"], { object: "string", clear: "boolean", add: "boolean" }),
  def("cosmos.object.group", "Group Objects", "Group two or more objects into a named collection. Their identities, positions and construction data are unchanged.", 1, ["WRITE"], { objects: "string[]", name: "string" }),
  def("cosmos.object.ungroup", "Ungroup Objects", "Dissolve a group; every member becomes independent again.", 1, ["WRITE"], { group: "string" }),
  def("cosmos.object.integrate", "Put an Object Inside Another", "Make one object part of a larger environment or assembly (engine into chassis, chair into cabin). The child keeps its identity and can be extracted again.", 1, ["WRITE"], { object: "string", into: "string" }),
  def("cosmos.object.extract", "Take an Object Out", "Detach an object from whatever holds it. Geometry, materials, parameters, identity and revision data are preserved.", 1, ["WRITE"], { object: "string", open: "string" }),
  def("cosmos.object.isolate", "Isolate an Object", "Show one object alone in the Cosmos, or bring everything back.", 1, ["WRITE"], { object: "string", showAll: "boolean" }),
  def("cosmos.object.duplicate", "Duplicate an Object", "Copy an object into an independent one, optionally smaller or renamed, without touching the original.", 1, ["WRITE"], { object: "string", name: "string", scale: "number" }),
  def("cosmos.object.remove", "Remove an Object", "Take an object out of the Cosmos into the trash (restorable). Refuses to silently drop the objects inside it.", 1, ["WRITE"], { object: "string", confirm: "boolean" }),
  def("cosmos.object.restore", "Restore an Object", "Put a removed object back exactly as it was.", 1, ["WRITE"], { object: "string" }),
  def("cosmos.object.list", "Every Object in the Cosmos", "List the objects in the Cosmos — or the trash — with their ids, positions, groups and sources.", 0, ["READ"], { domain: "string", group: "string", query: "string", trash: "boolean" }),
  def("cosmos.object.split", "Take One Part Out as an Object", "Split one part of an object out as its own object — the crankshaft out of an engine, a seat out of a chair, a panel out of a garment — keeping its material and where it stood. Local and undoable.", 1, ["WRITE"], { object: "string", part: "string" }),
  def("cosmos.object.place", "Move an Object Between Workspaces", "Move an object between the Cosmos, the construction workspace and the gallery. It is the same object with the same id and history.", 1, ["WRITE"], { object: "string", place: "string" }),
  def("cosmos.object.relocate", "Bring an Object Out", "Move an object to the first clear spot in front of the core's cluster — the recovery for one that a room marker or the core is standing in front of. One undo step; identity, geometry and attachments untouched. Local, no model involved.", 1, ["WRITE"], { object: "string" }),
  def("cosmos.object.undo", "Undo the Last Change", "Take back the last change to the Cosmos. Ids, geometry, relationships and provenance are restored rather than re-created.", 1, ["WRITE"], {}),
  def("cosmos.object.redo", "Redo the Change", "Put back the change that was taken back.", 1, ["WRITE"], {}),
  def("cosmos.view.open", "Open the Cosmos", "Enter the live Cosmos with the objects in view, closing the conversation over it without losing it; or go back to the workspace. Local navigation, no model involved.", 0, ["READ"], { open: "boolean", frame: "boolean" }),
  def("cosmos.view.frame", "Frame the Objects", "Move the Cosmos camera deterministically: frame everything, focus or zoom on one object or an assembly, return to the previous view or to the home view. Computed from real bounding boxes and the real viewport; no model involved.", 0, ["READ"], { mode: "string", object: "string", factor: "number" }),
];

export function registerCosmosObjectTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of COSMOS_OBJECT_TOOLS) registry.register(tool);
}
