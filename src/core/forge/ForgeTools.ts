/**
 * ==========================================================
 * LÉLU 3D FORGE — TOOLS
 *
 * The Forge as LÉLU's own capability: registered in the same
 * ToolRegistry cognition reads, and executable through the
 * same dispatcher and AutonomyGate as every other tool.
 *
 *   forge.status   risk 0  what is configured, spent, approved
 *   forge.job      risk 0  one job's progress and inspection
 *   forge.plan     risk 1  file a job — validated, priced,
 *                          de-duplicated — WITHOUT spending
 *   forge.promote  risk 1  make a validated output the
 *                          character's base / rig / animation
 *   forge.approve  risk 3  spend the credits (external action:
 *                          only offered at autonomy level 3+)
 *   forge.library  risk 0  every finished asset she can reuse
 *   forge.place    risk 1  put a finished asset into the Cosmos
 *                          (or take one out); assets are kept
 *
 * Planning and spending are deliberately separate tools, so
 * "LÉLU decided what to make" and "credits were spent" are
 * never the same step.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import ForgeClient, { type CosmosPlacement, type ForgeJobView } from "./ForgeClient";
import { estimateCredits, isForgeJobKind, validateRequest } from "./MeshyCatalog";

interface ForgeExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

export const FORGE_TOOLS: ToolDefinition[] = [
  {
    id: "forge.status",
    name: "3D Forge Status",
    description: "Whether 3D generation is configured, credits used, and each character's approved model, rig and animations",
    category: "3D Forge",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "ForgeClient.status + ForgeClient.active",
  },
  {
    id: "forge.job",
    name: "3D Forge Job",
    description: "Progress, credits and the measured inspection (mesh, texture, rig, animation) of one 3D generation job",
    category: "3D Forge",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { jobId: "string" },
    executionRoute: "GET /api/forge/jobs/<id>",
  },
  {
    id: "forge.plan",
    name: "Plan 3D Generation",
    description:
      "File a Meshy job (image-to-3d, multi-image-to-3d, text-to-3d, remesh, retexture, rigging, animation, image-to-image) with its credit estimate. Spends nothing; identical requests return the existing job",
    category: "3D Forge",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { character: "string", kind: "string", body: "object", purpose: "string" },
    executionRoute: "POST /api/forge/jobs (approve=false)",
  },
  {
    id: "forge.promote",
    name: "Approve 3D Asset",
    description: "Make a finished, inspected job the character's base mesh, rig, or a named animation — refused unless the inspection proves it fits",
    category: "3D Forge",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { character: "string", slot: "string", jobId: "string" },
    executionRoute: "POST /api/forge/characters/<c>/slots",
  },
  {
    id: "forge.approve",
    name: "Run 3D Generation",
    description: "Submit a planned job to Meshy, spending its estimated credits",
    category: "3D Forge",
    permissions: ["EXTERNAL_ACTION"],
    riskLevel: 3,
    available: true,
    inputSchema: { jobId: "string" },
    executionRoute: "POST /api/forge/jobs/<id>/approve",
  },
  {
    id: "forge.library",
    name: "3D Asset Library",
    description: "Every finished, inspected 3D asset (characters, outfits, props, environments) with its job id, and what is currently placed in the Cosmos",
    category: "3D Forge",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "GET /api/forge/library + /api/forge/placements",
  },
  {
    id: "forge.place",
    name: "Place 3D Asset in Cosmos",
    description:
      "Put a finished 3D asset into LÉLU's Cosmos at a position, rotation and height, or attach it to a bone of her rig (Head, Neck, Spine02, LeftHand…) so it moves with her; move, re-attach, detach or remove existing placements. Persists across sessions, never spends credits, never deletes the asset",
    category: "3D Forge",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { jobId: "string", label: "string", position: "number[3]", rotationY: "number", height: "number", attach: "object", updatePlacementId: "string", removePlacementId: "string" },
    executionRoute: "POST /api/forge/placements",
  },
  {
    id: "forge.wear",
    name: "Wear / Remove Wearable",
    description: "Put a wearable component on or take it off (e.g. slot hood: worn=true is hood up, false is hood down) without changing the character model",
    category: "3D Forge",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { character: "string", slot: "string", worn: "boolean" },
    executionRoute: "POST /api/forge/characters/<c>/wear",
  },
  {
    id: "forge.look",
    name: "Change LÉLU's Look",
    description: "Switch which approved look of a character the Cosmos shows (e.g. hood_up / hood_down); empty look returns to the base rig",
    category: "3D Forge",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { character: "string", look: "string" },
    executionRoute: "POST /api/forge/characters/<c>/look",
  },
];

function describe(job: ForgeJobView): string {
  const v = job.validation?.verdict;
  return [
    `Job ${job.id} (${job.kind}${job.purpose ? `: ${job.purpose}` : ""}) is ${job.status}${job.progress ? ` at ${job.progress}%` : ""}.`,
    `Credits: estimated ${job.estimatedCredits}, consumed ${job.consumedCredits ?? "none yet"}.`,
    job.error ? `Error: ${job.error}` : "",
    job.output ? `Outputs saved in ${job.output.dir} (${job.output.files.length} files).` : "",
    v ? `Inspection — mesh valid: ${v.meshValid}, textured: ${v.textured}, rig valid: ${v.rigValid}, animated: ${v.animated}.` : "",
    job.validation?.problems.length ? `Problems: ${job.validation.problems.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const str = (args: Record<string, unknown>, key: string) => (typeof args[key] === "string" ? (args[key] as string).trim() : "");

const OBJECT = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });

export const FORGE_EXECUTORS: ForgeExecutor[] = [
  {
    id: "forge.status",
    parameters: OBJECT({ character: { type: "string", description: "Character id, default lelu_character." } }, []),
    run: async (args) => {
      const character = str(args, "character") || "lelu_character";
      const [status, active] = await Promise.all([ForgeClient.status(), ForgeClient.active(character)]);
      return {
        ok: true,
        content:
          `3D Forge ${status.configured ? `configured (credential ${status.credential})` : "NOT configured: MESHY_API_KEY is missing on the server"}. ` +
          `${status.usage.jobs} job(s), ${status.usage.consumedCredits} credit(s) consumed. ` +
          `${character}: model ${active.model ? `${active.model.kind} job ${active.model.jobId}` : "none approved yet"}; ` +
          `animations ${Object.keys(active.animations).join(", ") || "none"}; ` +
          `looks ${Object.keys(active.looks ?? {}).join(", ") || "none"}${active.currentLook ? ` (showing ${active.currentLook})` : ""}.`,
        data: { status, active },
      };
    },
  },
  {
    id: "forge.job",
    parameters: OBJECT({ jobId: { type: "string" } }, ["jobId"]),
    run: async (args) => {
      const { job } = await ForgeClient.job(str(args, "jobId"));
      return { ok: true, content: describe(job), data: job };
    },
  },
  {
    id: "forge.plan",
    parameters: OBJECT(
      {
        character: {
          type: "string",
          description: "Collection id (lowercase): lelu_character for LÉLU herself, another id for a new character, or e.g. cosmos_props for objects and environments.",
        },
        kind: { type: "string", enum: ["image-to-3d", "multi-image-to-3d", "text-to-3d", "remesh", "retexture", "rigging", "animation", "image-to-image"] },
        body: { type: "object", description: "Meshy request parameters. Stored references are named as \"ref:<id>\"." },
        purpose: { type: "string" },
      },
      ["character", "kind", "body"],
    ),
    run: async (args) => {
      const kind = str(args, "kind");
      const body = (args.body && typeof args.body === "object" ? args.body : {}) as Record<string, unknown>;
      if (!isForgeJobKind(kind)) return { ok: false, content: `"${kind}" is not a Forge job kind, so nothing was planned.` };
      const problems = validateRequest(kind, body);
      if (problems.length) return { ok: false, content: `Not planned — the request does not match the Meshy API: ${problems.join(" ")}` };
      // approve is never forwarded: planning cannot spend.
      const { job, reused } = await ForgeClient.request({ character: str(args, "character"), kind, body, purpose: str(args, "purpose") });
      return {
        ok: true,
        content: `${reused ? "This exact request already exists — no new job, no new spend. " : ""}${describe(job)}` +
          (job.status === "awaiting_approval" ? ` Needs approval to spend about ${estimateCredits(kind, body)} credits.` : ""),
        data: job,
      };
    },
  },
  {
    id: "forge.promote",
    parameters: OBJECT(
      {
        character: { type: "string" },
        slot: { type: "string", description: "base, rig, or animation:<name> (e.g. animation:idle)." },
        jobId: { type: "string" },
      },
      ["character", "slot", "jobId"],
    ),
    run: async (args) => {
      await ForgeClient.approveSlot(str(args, "character"), str(args, "slot"), str(args, "jobId"));
      return { ok: true, content: `Job ${str(args, "jobId")} is now ${str(args, "character")}'s ${str(args, "slot")}.` };
    },
  },
  {
    id: "forge.approve",
    parameters: OBJECT({ jobId: { type: "string" } }, ["jobId"]),
    run: async (args) => {
      const { job } = await ForgeClient.approve(str(args, "jobId"));
      return { ok: job.status !== "FAILED" && !job.error, content: describe(job), data: job };
    },
  },
  {
    id: "forge.library",
    parameters: OBJECT({}, []),
    run: async () => {
      const [{ assets }, { placements }] = await Promise.all([ForgeClient.library(), ForgeClient.placements()]);
      const lines = assets.map(
        (a) => `${a.jobId} — ${a.character}/${a.kind}${a.purpose ? ` (${a.purpose})` : ""}, mesh ${a.meshValid ? "valid" : "INVALID"}${a.rigValid ? ", rigged" : ""}`,
      );
      const placed = placements.map((p) => `${p.id}: ${p.label} (job ${p.jobId}) at [${p.position.map((n) => n.toFixed(1)).join(", ")}]`);
      return {
        ok: true,
        content:
          `${assets.length} finished asset(s)${lines.length ? `: ${lines.join("; ")}` : ""}. ` +
          `${placements.length} placed in the Cosmos${placed.length ? `: ${placed.join("; ")}` : ""}.`,
        data: { assets, placements },
      };
    },
  },
  {
    id: "forge.place",
    parameters: OBJECT(
      {
        jobId: { type: "string", description: "Finished job to place (from forge.library)." },
        label: { type: "string" },
        position: { type: "array", items: { type: "number" }, description: "[x, y, z]; omit to use the next free spot near the core." },
        rotationY: { type: "number", description: "Radians." },
        height: { type: "number", description: "World units the model is fitted to; LÉLU stands 2.56 tall on the floor at y −2.55." },
        slot: { type: "string", description: "Make it a wearable in this slot (e.g. hood) so forge.wear can put it on / take it off." },
        attach: {
          type: "object",
          description: "Wear or hold it: { bone, offset?: [x,y,z], rotation?: [x,y,z], character? }. Follows that bone every frame. null detaches (with updatePlacementId).",
        },
        updatePlacementId: { type: "string", description: "Change this existing placement instead of creating one." },
        removePlacementId: { type: "string", description: "Instead of placing, remove this placement (the asset is kept)." },
      },
      [],
    ),
    run: async (args) => {
      const remove = str(args, "removePlacementId");
      if (remove) {
        const { placement } = await ForgeClient.unplace(remove);
        return { ok: true, content: `Removed ${placement.label} from the Cosmos. The asset is still in the library (job ${placement.jobId}).` };
      }
      const position = Array.isArray(args.position) && args.position.length === 3 ? (args.position as [number, number, number]) : undefined;
      const attach = args.attach && typeof args.attach === "object" ? (args.attach as CosmosPlacement["attach"]) : args.attach === null ? null : undefined;
      const update = str(args, "updatePlacementId");
      if (update) {
        const patch: Parameters<typeof ForgeClient.updatePlacement>[1] = {};
        if (position) patch.position = position;
        if (typeof args.rotationY === "number") patch.rotationY = args.rotationY;
        if (typeof args.height === "number") patch.height = args.height;
        if (str(args, "label")) patch.label = str(args, "label");
        if (attach !== undefined) patch.attach = attach;
        const { placement } = await ForgeClient.updatePlacement(update, patch);
        return {
          ok: true,
          content: placement.attach
            ? `${placement.label} now follows ${placement.attach.character}'s ${placement.attach.bone} bone.`
            : `${placement.label} now stands at [${placement.position.map((n) => n.toFixed(1)).join(", ")}].`,
          data: placement,
        };
      }
      const { placement } = await ForgeClient.place({
        attach: attach ?? undefined,
        slot: str(args, "slot") || undefined,
        jobId: str(args, "jobId"),
        label: str(args, "label") || undefined,
        position,
        rotationY: typeof args.rotationY === "number" ? args.rotationY : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
      });
      return {
        ok: true,
        content: placement.attach
          ? `${placement.label} is attached to ${placement.attach.character}'s ${placement.attach.bone} bone as ${placement.id}; it moves with her.`
          : `Placed ${placement.label} in the Cosmos at [${placement.position.map((n) => n.toFixed(1)).join(", ")}] as ${placement.id}.`,
        data: placement,
      };
    },
  },
  {
    id: "forge.wear",
    parameters: OBJECT(
      {
        character: { type: "string", description: "Default lelu_character." },
        slot: { type: "string", description: "Wearable slot, e.g. hood or pendant." },
        worn: { type: "boolean", description: "true puts it on (hood up), false takes it off (hood down)." },
      },
      ["slot", "worn"],
    ),
    run: async (args) => {
      const character = str(args, "character") || "lelu_character";
      const worn = args.worn !== false;
      const { placements } = await ForgeClient.wear(character, str(args, "slot"), worn);
      return { ok: true, content: `${character}'s ${str(args, "slot")} is now ${worn ? "on" : "off"} (${placements.length} piece(s)); her model is unchanged.` };
    },
  },
  {
    id: "forge.look",
    parameters: OBJECT(
      {
        character: { type: "string", description: "Default lelu_character." },
        look: { type: "string", description: "An approved look name such as hood_up or hood_down; empty for the base rig." },
      },
      [],
    ),
    run: async (args) => {
      const character = str(args, "character") || "lelu_character";
      const look = str(args, "look") || null;
      await ForgeClient.setLook(character, look);
      return { ok: true, content: look ? `${character} is now shown with the ${look} look.` : `${character} is back to the base look.` };
    },
  },
];

export function registerForgeTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of FORGE_TOOLS) registry.register(tool);
}
