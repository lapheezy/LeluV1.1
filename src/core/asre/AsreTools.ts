/**
 * ==========================================================
 * LÉLU ASRE — TOOLS
 *
 * The Adaptive Spatial Reconstruction Engine as LÉLU's own capability,
 * registered in the same ToolRegistry and run through the same
 * dispatcher and AutonomyGate as the 3D Forge. Unlike the Forge it
 * spends nothing: everything runs locally (plugins/asreApi.ts).
 *
 *   asre.status       risk 0  is the local toolchain installed?
 *   asre.reconstruct  risk 1  one image → reconstruction job
 *   asre.job          risk 0  intermediate results, hypotheses, and
 *                             which observation would help most next
 *   asre.character    risk 1  a variation of the persistent character:
 *                             only invalidated components are rebuilt
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry.ts";
import type { ToolExecutionResult } from "../tools/ToolDispatcher.ts";

const OBJECT = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });

export const ASRE_TOOLS: ToolDefinition[] = [
  {
    id: "asre.status",
    name: "Reconstruction Engine Status",
    description: "Whether LÉLU's local 3D reconstruction toolchain (TripoSR CPU worker, Blender renderer, weights) is installed. Zero spend.",
    category: "3D Reconstruction",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "GET /api/asre/status",
  },
  {
    id: "asre.reconstruct",
    name: "Reconstruct 3D From An Image",
    description:
      "Start a local, zero-spend reconstruction of one image: TripoSR on CPU, concurrent image analyses, competing geometry hypotheses, a numerical (voxel) record with provenance, a validated GLB and renders. Returns a job id.",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { image: "string (path inside the ASRE asset root)", imageBase64: "string" },
    executionRoute: "POST /api/asre/reconstruct",
  },
  {
    id: "asre.job",
    name: "Reconstruction Job",
    description: "Steps done so far, hypothesis ranking, GLB, and the coverage report: which side of the object is only guessed and which view to ask for next.",
    category: "3D Reconstruction",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { jobId: "string" },
    executionRoute: "GET /api/asre/jobs/<id>",
  },
  {
    id: "asre.character",
    name: "Vary The Persistent Character",
    description:
      "Build a variation of LÉLU's persistent ASRE character (hair, clothing, accessories, materials, body proportions, pose). Only components the change invalidates are rebuilt; the rest are reused. Returns a GLB and, optionally, a render.",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { patch: "object", render: "boolean" },
    executionRoute: "POST /api/asre/character",
  },
];

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; [k: string]: unknown }> {
  const res = await fetch(`/api/asre${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok: boolean; [k: string]: unknown };
  return res.ok ? json : { ...json, ok: false };
}

interface AsreExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const fail = (r: Record<string, unknown>) => ({ ok: false, content: `ASRE: ${String(r.error ?? "request failed")}`, data: r });

export const ASRE_EXECUTORS: AsreExecutor[] = [
  {
    id: "asre.status",
    parameters: OBJECT({}, []),
    run: async () => {
      const r = await call("GET", "/status");
      if (!r.ok) return fail(r);
      const ready = r.python && r.triposrWeights && r.triposrSource;
      return { ok: true, content: `Reconstruction ${ready ? "ready" : "NOT installed (run services/asre-reconstruct/setup.sh)"}; Blender renders ${r.blender ? "available" : "unavailable"}. ${String(r.spend)}.`, data: r };
    },
  },
  {
    id: "asre.reconstruct",
    parameters: OBJECT({ image: { type: "string" }, imageBase64: { type: "string" } }, []),
    run: async (args) => {
      const r = await call("POST", "/reconstruct", { image: args.image, imageBase64: args.imageBase64 });
      if (!r.ok) return fail(r);
      const job = r.job as { id: string };
      return { ok: true, content: `Reconstruction job ${job.id} started locally. Check it with asre.job.`, data: r };
    },
  },
  {
    id: "asre.job",
    parameters: OBJECT({ jobId: { type: "string" } }, ["jobId"]),
    run: async (args) => {
      const r = await call("GET", `/jobs/${encodeURIComponent(String(args.jobId ?? ""))}`);
      if (!r.ok) return fail(r);
      const job = r.job as { state: string; steps: Array<{ step: string; state: string }>; error?: string; results: { coverage?: { requests?: Array<{ view: string; reason: string }> } } };
      const next = job.results.coverage?.requests?.[0];
      return {
        ok: true,
        content: `Job ${job.state}: ${job.steps.map((s) => `${s.step} ${s.state}`).join(", ")}${job.error ? `. Error: ${job.error}` : ""}${next ? `. Most useful next observation: the ${next.view} (${next.reason}).` : ""}`,
        data: job,
      };
    },
  },
  {
    id: "asre.character",
    parameters: OBJECT({ patch: { type: "object" }, render: { type: "boolean" } }, []),
    run: async (args) => {
      const r = await call("POST", "/character", { patch: args.patch ?? {}, render: args.render === true });
      if (!r.ok) return fail(r);
      return { ok: true, content: `Built ${String(r.glb)}: regenerated ${(r.regenerated as string[]).join(", ") || "nothing"}; recoloured ${(r.recolored as string[]).join(", ") || "nothing"}; reused ${(r.reused as string[]).length} components.`, data: r };
    },
  },
];

export function registerAsreTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of ASRE_TOOLS) registry.register(tool);
}
