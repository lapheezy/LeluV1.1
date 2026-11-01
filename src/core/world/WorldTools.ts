/**
 * ==========================================================
 * LÉLUVERSE — WORLD TOOLS
 *
 * LÉLU's hands in her universe, registered in the same
 * ToolRegistry / ToolDispatcher / AutonomyGate as every other
 * tool (her cognition decides when to use them):
 *
 *   world.state        risk 0  where she is, what is there
 *   world.environment  risk 1  create / enter / change an
 *                              environment, or make a sandbox
 *   world.object       risk 1  create, move, rotate, resize,
 *                              re-colour, re-shape, simulate,
 *                              remove objects
 *   world.versions     risk 1  list / restore an environment's
 *                              versions
 *   world.promote      risk 3  replace a working environment
 *                              with a tested sandbox
 *   world.improve      risk 0  record a DISCOVER → … →
 *                              REMEMBER step
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import ForgeClient, { type AvatarMood, type AvatarWorldState, type CosmosPlacement, type WorldState } from "../forge/ForgeClient";
import { FURNITURE } from "./RoomGenerator";

interface WorldExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const tool = (id: string, name: string, description: string, riskLevel: number, permissions: string[], inputSchema?: Record<string, string>): ToolDefinition =>
  ({ id, name, description, category: "LÉLUVERSE", permissions, riskLevel, available: true, inputSchema, executionRoute: "/api/forge/world" }) as ToolDefinition;

export const WORLD_TOOLS: ToolDefinition[] = [
  tool("world.state", "Where Am I", "The environment LÉLU is in (her circular room is home), its lighting and colours, every object in it, and the other environments she can go to", 0, ["READ"]),
  tool(
    "world.environment",
    "Shape an Environment",
    "Create a new persistent environment (kinds: room, lab, studio, garden, observatory, open), enter one, change its colours/lighting/size/gravity, or make a sandbox copy to try changes safely",
    1,
    ["WRITE"],
    { action: "create|enter|update|sandbox", id: "string", name: "string", kind: "string", description: "string", settings: "object" },
  ),
  tool(
    "world.object",
    "Make or Change an Object",
    "Create a shape (box, sphere, cylinder, cone, torus, plane) in the current environment, or move/rotate/resize/re-colour/re-shape an object, switch real physics on (it falls, bounces, collides) or off, push it, or remove it. Placing a 3D Forge asset is forge.place",
    1,
    ["WRITE"],
    { action: "create|move|modify|simulate|remove", id: "string", shape: "string", label: "string", color: "string", position: "number[3]", rotationY: "number", height: "number" },
  ),
  tool(
    "world.generate",
    "Generate a Room",
    "Build a furnished environment from a description (e.g. \"a cozy pink reading nook with plants\"): its kind, colours, lighting and furniture made of built-in shapes, saved as one version she can restore. Can also furnish the current environment. Spends nothing",
    1,
    ["WRITE"],
    { description: "string", name: "string", kind: "string", items: "array", furnishCurrent: "boolean", replace: "boolean" },
  ),
  tool(
    "world.avatar",
    "Move Myself",
    "Where LÉLU stands in the current environment, which way she faces and her resting mood — remembered across reloads and devices. Walk to a spot or next to an object, turn towards an object or the user, or set her mood",
    1,
    ["WRITE"],
    { action: "get|move|face|mood", position: "number[2|3]", near: "string", towards: "string", facing: "number", mood: "string" },
  ),
  tool("world.versions", "Environment History", "List an environment's saved versions, or restore one (the restore is itself a new version, so it can be undone)", 1, ["WRITE"], { id: "string", restore: "number" }),
  tool("world.promote", "Promote Sandbox", "Replace a working environment with the sandbox copy that was tested — needs the user's approval", 3, ["EXTERNAL_ACTION"], { id: "string" }),
  tool("world.improve", "Record Improvement", "Write one step of LÉLU's improvement cycle (discover, design, generate, test, evaluate, integrate, remember) — what changed, why, and whether it passed", 0, ["WRITE"], {
    stage: "string",
    subject: "string",
    what: "string",
    why: "string",
    tests: "string",
    passed: "boolean",
  }),
];

const str = (args: Record<string, unknown>, key: string) => (typeof args[key] === "string" ? (args[key] as string).trim() : "");
const num = (args: Record<string, unknown>, key: string) => (typeof args[key] === "number" && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
const vec3 = (v: unknown) => (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number") ? (v as [number, number, number]) : undefined);
const OBJECT = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

function describeObject(o: CosmosPlacement): string {
  const what = o.primitive ? `${o.primitive.color} ${o.primitive.shape}` : `3D asset (job ${o.jobId})`;
  return `${o.id} "${o.label}": ${what}, ${o.height.toFixed(2)} tall at [${o.position.map((n) => n.toFixed(2)).join(", ")}]${o.physics?.dynamic ? ", physics on" : ""}`;
}

function describeState(state: WorldState): string {
  const env = state.environment;
  const s = env.settings;
  return (
    `LÉLU is in "${env.name}" (${env.kind}${env.sandbox ? `, sandbox of ${env.sandboxOf}` : ""}, version ${env.version}): radius ${s.radius}, accent ${s.accent}, key light ${s.keyLight} ${s.keyColor}, gravity ${s.gravity}. ` +
    `${state.objects.length} object(s)${state.objects.length ? `: ${state.objects.map(describeObject).join("; ")}` : ""}. ` +
    `Environments: ${state.environments.map((e) => `${e.id}${e.id === state.current ? " (here)" : ""}`).join(", ")}.`
  );
}

export const WORLD_EXECUTORS: WorldExecutor[] = [
  {
    id: "world.state",
    parameters: OBJECT({}),
    run: async () => {
      const state = await ForgeClient.world();
      return { ok: true, content: describeState(state), data: state };
    },
  },
  {
    id: "world.environment",
    parameters: OBJECT(
      {
        action: { type: "string", enum: ["create", "enter", "update", "sandbox"] },
        id: { type: "string", description: "Environment id (for enter, update, sandbox)." },
        name: { type: "string" },
        kind: { type: "string", enum: ["room", "lab", "studio", "garden", "observatory", "open"] },
        description: { type: "string" },
        settings: {
          type: "object",
          description: "Any of radius, floorColor, wallColor, accent, wallHeight, ambient, keyLight, keyColor, fogColor, fogDensity, gravity (colours as #rrggbb).",
        },
      },
      ["action"],
    ),
    run: async (args) => {
      const action = str(args, "action");
      const settings = (args.settings && typeof args.settings === "object" ? args.settings : undefined) as Record<string, never> | undefined;
      if (action === "create" || action === "sandbox") {
        const { environment } = await ForgeClient.createEnvironment({
          name: str(args, "name") || (action === "sandbox" ? "" : "New environment"),
          kind: str(args, "kind") || undefined,
          description: str(args, "description") || undefined,
          settings,
          sandboxOf: action === "sandbox" ? str(args, "id") || (await ForgeClient.world()).current : undefined,
        });
        const state = await ForgeClient.enterEnvironment(environment.id);
        return { ok: true, content: `Created and entered ${environment.sandbox ? "sandbox " : ""}"${environment.name}" (${environment.id}). ${describeState(state)}`, data: state };
      }
      if (action === "enter") {
        const state = await ForgeClient.enterEnvironment(str(args, "id"));
        return { ok: true, content: describeState(state), data: state };
      }
      if (action === "update") {
        const id = str(args, "id") || (await ForgeClient.world()).current;
        const { environment } = await ForgeClient.updateEnvironment(id, { name: str(args, "name") || undefined, description: str(args, "description") || undefined, settings });
        return { ok: true, content: `Updated "${environment.name}" (now version ${environment.version}).`, data: environment };
      }
      return { ok: false, content: `Unknown action "${action}".` };
    },
  },
  {
    id: "world.object",
    parameters: OBJECT(
      {
        action: { type: "string", enum: ["create", "move", "modify", "simulate", "remove"] },
        id: { type: "string", description: "Object id (all actions except create)." },
        shape: { type: "string", enum: ["box", "sphere", "cylinder", "cone", "torus", "plane"] },
        label: { type: "string" },
        color: { type: "string", description: "#rrggbb" },
        metalness: { type: "number" },
        roughness: { type: "number" },
        emissive: { type: "string" },
        opacity: { type: "number" },
        position: { type: "array", items: { type: "number" }, description: "[x, y, z]; her floor is y −2.55, she stands near [0, −2.55, 3.3]." },
        rotationY: { type: "number" },
        height: { type: "number" },
        physics: { type: "boolean", description: "simulate: true turns real physics on, false off." },
        push: { type: "array", items: { type: "number" }, description: "simulate: initial velocity [x, y, z] in m/s." },
        mass: { type: "number" },
        restitution: { type: "number", description: "Bounciness 0–1." },
      },
      ["action"],
    ),
    run: async (args) => {
      const action = str(args, "action");
      const id = str(args, "id");
      const primitive = {
        ...(str(args, "shape") ? { shape: str(args, "shape") as NonNullable<CosmosPlacement["primitive"]>["shape"] } : {}),
        ...(str(args, "color") ? { color: str(args, "color") } : {}),
        ...(num(args, "metalness") !== undefined ? { metalness: num(args, "metalness") } : {}),
        ...(num(args, "roughness") !== undefined ? { roughness: num(args, "roughness") } : {}),
        ...(str(args, "emissive") ? { emissive: str(args, "emissive") } : {}),
        ...(num(args, "opacity") !== undefined ? { opacity: num(args, "opacity") } : {}),
      };
      if (action === "create") {
        const { object } = await ForgeClient.createObject({
          ...primitive,
          label: str(args, "label") || undefined,
          position: vec3(args.position),
          rotationY: num(args, "rotationY"),
          height: num(args, "height"),
          physics: args.physics === true ? { mass: num(args, "mass"), restitution: num(args, "restitution"), velocity: vec3(args.push) } : undefined,
        });
        return { ok: true, content: `Created ${describeObject(object)}.`, data: object };
      }
      if (!id) return { ok: false, content: "Which object? Give its id (world.state lists them)." };
      if (action === "move") {
        const { placement } = await ForgeClient.updatePlacement(id, {
          position: vec3(args.position),
          rotationY: num(args, "rotationY"),
          height: num(args, "height"),
          label: str(args, "label") || undefined,
        });
        return { ok: true, content: `Now ${describeObject(placement)}.`, data: placement };
      }
      if (action === "modify") {
        const { object } = await ForgeClient.modifyObject(id, { primitive });
        return { ok: true, content: `Now ${describeObject(object)}.`, data: object };
      }
      if (action === "simulate") {
        const on = args.physics !== false;
        const { object } = await ForgeClient.modifyObject(id, {
          physics: on ? { dynamic: true, mass: num(args, "mass"), restitution: num(args, "restitution"), velocity: vec3(args.push) ?? [0, 0, 0] } : null,
        });
        return { ok: true, content: on ? `Physics on for ${object.label}: it now falls, bounces and collides.` : `Physics off for ${object.label}.`, data: object };
      }
      if (action === "remove") {
        const { placement } = await ForgeClient.unplace(id);
        return { ok: true, content: `Removed ${placement.label}. It can be brought back by restoring an earlier version.` };
      }
      return { ok: false, content: `Unknown action "${action}".` };
    },
  },
  {
    id: "world.generate",
    parameters: OBJECT(
      {
        description: { type: "string", description: "What the room is like: purpose, mood, colours, furniture." },
        name: { type: "string" },
        kind: { type: "string", enum: ["room", "lab", "studio", "garden", "observatory", "open"] },
        items: {
          type: "array",
          description: `Exact pieces instead of the ones read from the description; any of: ${FURNITURE.join(", ")}.`,
          items: { type: "string" },
        },
        furnishCurrent: { type: "boolean", description: "Add the furniture to the current environment instead of creating a new one." },
        replace: { type: "boolean", description: "With furnishCurrent: clear its objects first (the previous version stays restorable)." },
        seed: { type: "number", description: "Another seed gives another layout of the same description." },
      },
      ["description"],
    ),
    run: async (args) => {
      const furnish = args.furnishCurrent === true;
      const items = Array.isArray(args.items) ? args.items.filter((i): i is string => typeof i === "string") : undefined;
      const result = await ForgeClient.generateRoom({
        description: str(args, "description"),
        name: str(args, "name") || undefined,
        kind: str(args, "kind") || undefined,
        items: items?.length ? items : undefined,
        seed: num(args, "seed"),
        environmentId: furnish ? (await ForgeClient.world()).current : undefined,
        replace: furnish && args.replace === true,
      });
      const pieces = result.plan.pieces.map((p) => p.group).join(", ");
      const skipped = result.plan.skipped.length ? ` Did not fit: ${result.plan.skipped.join(", ")}.` : "";
      return {
        ok: true,
        content: `${furnish ? "Furnished" : "Generated and entered"} "${result.environment.name}" (${result.plan.kind}, version ${result.environment.version}) with ${result.plan.pieces.length} pieces: ${pieces}.${skipped}`,
        data: result,
      };
    },
  },
  {
    id: "world.avatar",
    parameters: OBJECT(
      {
        action: { type: "string", enum: ["get", "move", "face", "mood"] },
        position: { type: "array", items: { type: "number" }, description: "move: [x, z] or [x, y, z]; her floor is y −2.55, she starts at [0, −2.55, 3.3]." },
        near: { type: "string", description: "move: an object id or piece (e.g. \"desk-1\") to walk up to." },
        towards: { type: "string", description: "face: an object id, a piece, or \"user\"." },
        facing: { type: "number", description: "face: angle in radians (0 faces the user)." },
        mood: { type: "string", enum: ["neutral", "happy", "focused", "concerned", "surprised", "attentive"] },
      },
      ["action"],
    ),
    run: async (args) => {
      const action = str(args, "action");
      const describe = (a: AvatarWorldState) =>
        `LÉLU stands at [${a.position.map((n) => n.toFixed(2)).join(", ")}] in ${a.environmentId}, facing ${((a.facing * 180) / Math.PI).toFixed(0)}°, mood ${a.mood}.`;
      if (action === "get") {
        const { avatar } = await ForgeClient.avatar();
        return { ok: true, content: describe(avatar), data: avatar };
      }
      if (action === "move") {
        let position = Array.isArray(args.position) ? (args.position.filter((n) => typeof n === "number") as number[]) : [];
        const near = str(args, "near");
        if (near) {
          const state = await ForgeClient.world();
          const hits = state.objects.filter((o) => o.id === near || o.group === near);
          if (!hits.length) return { ok: false, content: `No object or piece "${near}" here (world.state lists them).` };
          const x = hits.reduce((s, o) => s + o.position[0], 0) / hits.length;
          const z = hits.reduce((s, o) => s + o.position[2], 0) / hits.length;
          // Stop about a metre short of it, on the side towards the room centre.
          const [cx, cz] = state.origin.centre;
          const d = Math.hypot(cx - x, cz - z) || 1;
          position = [x + ((cx - x) / d) * 1.1, z + ((cz - z) / d) * 1.1];
        }
        if (position.length !== 2 && position.length !== 3) return { ok: false, content: "Give a position [x, z] or something to walk up to (near)." };
        await ForgeClient.setAvatar({ position: position as [number, number] });
        const { avatar } = await ForgeClient.setAvatar({ towards: near || "user" });
        return { ok: true, content: describe(avatar), data: avatar };
      }
      if (action === "face") {
        const towards = str(args, "towards");
        const facing = num(args, "facing");
        if (!towards && facing === undefined) return { ok: false, content: "Face what? Give towards or facing." };
        const { avatar } = await ForgeClient.setAvatar(towards ? { towards } : { facing });
        return { ok: true, content: describe(avatar), data: avatar };
      }
      if (action === "mood") {
        const mood = str(args, "mood") as AvatarMood;
        const { avatar } = await ForgeClient.setAvatar({ mood });
        return { ok: true, content: describe(avatar), data: avatar };
      }
      return { ok: false, content: `Unknown action "${action}".` };
    },
  },
  {
    id: "world.versions",
    parameters: OBJECT({ id: { type: "string", description: "Environment id; default the current one." }, restore: { type: "number", description: "Version to restore." } }),
    run: async (args) => {
      const id = str(args, "id") || (await ForgeClient.world()).current;
      const restore = num(args, "restore");
      if (restore !== undefined) {
        const { environment } = await ForgeClient.restoreEnvironment(id, restore);
        return { ok: true, content: `Restored ${id} to version ${restore} (saved as version ${environment.version}).` };
      }
      const { history } = await ForgeClient.history(id);
      return { ok: true, content: `${id}: ${history.map((h) => `v${h.version} ${h.reason} (${h.objects} objects)`).join("; ")}`, data: history };
    },
  },
  {
    id: "world.promote",
    parameters: OBJECT({ id: { type: "string", description: "Sandbox environment id." } }, ["id"]),
    run: async (args) => {
      const { environment } = await ForgeClient.promoteSandbox(str(args, "id"), true);
      return { ok: true, content: `Promoted the sandbox over "${environment.name}" (now version ${environment.version}; the previous version can be restored).` };
    },
  },
  {
    id: "world.improve",
    parameters: OBJECT(
      {
        stage: { type: "string", enum: ["discover", "design", "generate", "test", "evaluate", "integrate", "remember"] },
        subject: { type: "string" },
        what: { type: "string" },
        why: { type: "string" },
        tests: { type: "string" },
        passed: { type: "boolean" },
      },
      ["stage", "subject", "what"],
    ),
    run: async (args) => {
      const { improvement } = await ForgeClient.recordImprovement({
        stage: str(args, "stage"),
        subject: str(args, "subject"),
        what: str(args, "what"),
        why: str(args, "why"),
        tests: str(args, "tests"),
        passed: typeof args.passed === "boolean" ? args.passed : null,
      });
      return { ok: true, content: `Recorded ${str(args, "stage")} step for ${str(args, "subject")}.`, data: improvement };
    },
  },
];

export function registerWorldTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const t of WORLD_TOOLS) registry.register(t);
}
