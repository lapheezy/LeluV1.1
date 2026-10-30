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
 *
 * Planning and spending are deliberately separate tools, so
 * "LÉLU decided what to make" and "credits were spent" are
 * never the same step.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import ForgeClient, { type ForgeJobView } from "./ForgeClient";
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
      "File a Meshy job (image-to-3d, multi-image-to-3d, text-to-3d, remesh, retexture, rigging, animation) with its credit estimate. Spends nothing; identical requests return the existing job",
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
          `animations ${Object.keys(active.animations).join(", ") || "none"}.`,
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
        character: { type: "string", description: "Character id (lowercase), e.g. lelu_character." },
        kind: { type: "string", enum: ["image-to-3d", "multi-image-to-3d", "text-to-3d", "remesh", "retexture", "rigging", "animation"] },
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
];

export function registerForgeTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of FORGE_TOOLS) registry.register(tool);
}
