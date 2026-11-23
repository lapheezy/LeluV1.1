/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — CHAT TOOLS
 *
 * Five tools join the SAME ToolRegistry / ToolDispatcher table every other
 * capability uses. They are thin: the real work is /api/foundry (build, render,
 * compare, projects), and these executors are how a conversation reaches it.
 *
 *   foundry.status   what this machine can actually do, and what was refused
 *   foundry.ask      a sentence → the operation it maps to, executed
 *   foundry.render   render named shots; the IMAGES go into the conversation
 *   foundry.compare  a version's render against its reference, feature by feature
 *   foundry.project  versions, restore, verification — nothing is ever deleted
 *
 * The mission is explicit that a render must be displayed, not described, so
 * every produced PNG is emitted on the AgentEventBus as a creative_artifact —
 * the same event the browser capture and the creative studio already use — and
 * the spatial workspace is summoned for the model itself.
 * ==========================================================
 */

import AgentEventBus from "../../agent/AgentEvents";
import ToolRegistry, { type ToolDefinition } from "../../tools/ToolRegistry";
import type { ToolExecutionResult } from "../../tools/ToolDispatcher";
import { summonSpatial } from "../SpatialSummon";

interface FoundryExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const OBJECT = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const fail = (e: unknown): ToolExecutionResult => ({ ok: false, content: `Foundry: ${e instanceof Error ? e.message : String(e)}` });
const guard = (fn: (a: Record<string, unknown>) => Promise<ToolExecutionResult>) => async (a: Record<string, unknown>) => {
  try {
    return await fn(a);
  } catch (e) {
    return fail(e);
  }
};

async function post<T>(url: string, body: unknown): Promise<T & { ok?: boolean; error?: string }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

async function get<T>(url: string): Promise<T & { ok?: boolean; error?: string }> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

interface RenderResponse {
  results: Array<{ shot: string; ok: boolean; url: string | null; error: string | null; seconds: number; comparison: { verdict: string; silhouette: { iou: number; usable: boolean }; notes: string[] } | null }>;
  version: string;
  rendered: number;
  failed: number;
}

/** Put one rendered image into the conversation, and the model into the workspace. */
function publish(res: RenderResponse, project: string): void {
  const events = AgentEventBus.getInstance();
  const taskId = `${Date.now()}`;
  for (const shot of res.results) {
    if (!shot.ok || !shot.url) continue;
    events.emit({
      type: "creative_artifact",
      taskId,
      image: shot.url,
      label: `${project} ${shot.shot}`,
      source: "foundry.render",
      text: shot.comparison ? `verdict ${shot.comparison.verdict}; silhouette IoU ${shot.comparison.silhouette.usable ? shot.comparison.silhouette.iou.toFixed(3) : "not measurable"}` : undefined,
    });
  }
}

export const FOUNDRY_TOOLS: ToolDefinition[] = [
  {
    id: "foundry.status",
    name: "Character Foundry Status",
    description:
      "What the local Character Foundry can do on THIS machine: CPU/GPU/RAM, Blender, which reconstruction engines are adopted and which were refused for licence, account or hardware reasons. Zero spend, no account.",
    category: "3D Reconstruction",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "GET /api/foundry/status",
  },
  {
    id: "foundry.ask",
    name: "Ask The Character Foundry",
    description:
      "Say what you want in your own words — reconstruct her, improve the face, change the hairstyle, add jewelry, render a profile, compare versions, explain a failure — and the Foundry maps the sentence to a real operation and runs it. Returns the operation it chose and what actually ran.",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { message: "string", project: "string" },
    executionRoute: "POST /api/foundry/chat",
  },
  {
    id: "foundry.render",
    name: "Render Character Views",
    description:
      "Render named views of the persistent character with Blender Cycles (CPU): face-close-up, eyes, nose-lips, hairline, curl-detail, hair-full, jewelry, portrait-front, portrait-three-quarter, profile, rear, upper-body, full-body. The images appear in the conversation.",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { project: "string", shots: "string[]", version: "string", samples: "number" },
    executionRoute: "POST /api/foundry/render",
  },
  {
    id: "foundry.compare",
    name: "Compare A Render To The Reference",
    description:
      "Compare a stored render of a version against the original reference photograph: silhouette overlap, landmark deltas against the measured sheet, hair strand agreement and colour distance — each with its caveat, and 'not measurable' where the build never measured the feature.",
    category: "3D Reconstruction",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    inputSchema: { project: "string", version: "string", shot: "string" },
    executionRoute: "POST /api/foundry/compare",
  },
  {
    id: "foundry.project",
    name: "Character Foundry Versions",
    description: "A Foundry project's immutable versions: list, inspect the validation of one, restore an earlier version as a new version, and verify every stored model's hash. Nothing is overwritten or deleted.",
    category: "3D Reconstruction",
    permissions: ["WRITE"],
    riskLevel: 1,
    available: true,
    inputSchema: { project: "string", action: "list | inspect | restore | verify | create", version: "string", name: "string" },
    executionRoute: "/api/foundry/projects",
  },
];

export const FOUNDRY_EXECUTORS: FoundryExecutor[] = [
  {
    id: "foundry.status",
    parameters: OBJECT({}, []),
    run: guard(async () => {
      const s = await get<{ hardware: { summary: string }; blender: boolean; licences: { adopt: number; optional: number; reject: number; violations: string[] }; engines: Array<{ kind: string; chosen: string | null; reason: string }>; projects: unknown[] }>("/api/foundry/status");
      const engines = s.engines.map((e) => `${e.kind}: ${e.chosen ?? "none"} — ${e.reason}`).join(" | ");
      return {
        ok: true,
        content: `Character Foundry here: ${s.hardware.summary}. Blender: ${s.blender ? "available" : "NOT available"}. Engines — ${engines}. Licences: ${s.licences.adopt} adopted, ${s.licences.optional} optional, ${s.licences.reject} rejected${s.licences.violations.length ? `; POLICY VIOLATIONS: ${s.licences.violations.join("; ")}` : "; no policy violations"}.`,
        data: s,
      };
    }),
  },
  {
    id: "foundry.ask",
    parameters: OBJECT({ message: { type: "string" }, project: { type: "string" } }, ["message"]),
    run: guard(async (a) => {
      const message = String(a.message ?? "");
      const res = await post<{ answer: string; intent: unknown; operation: string; rendered?: RenderResponse }>("/api/foundry/chat", { message, project: str(a.project) });
      if (res.rendered) publish(res.rendered, str(a.project) ?? "lelu");
      return { ok: true, content: res.answer, data: { intent: res.intent, operation: res.operation, rendered: res.rendered?.results } };
    }),
  },
  {
    id: "foundry.render",
    parameters: OBJECT(
      {
        project: { type: "string" },
        shots: { type: "array", items: { type: "string" } },
        version: { type: "string" },
        samples: { type: "number" },
      },
      ["shots"],
    ),
    run: guard(async (a) => {
      const project = str(a.project) ?? "lelu";
      const shots = Array.isArray(a.shots) ? (a.shots as string[]) : [];
      if (!shots.length) return { ok: false, content: "Foundry: name at least one shot (face-close-up, portrait-front, profile, hair-full, jewelry, full-body…)." };
      const res = await post<RenderResponse>("/api/foundry/render", { project, shots, version: str(a.version), samples: typeof a.samples === "number" ? a.samples : undefined });
      publish(res, project);
      const lines = res.results.map((r) =>
        r.ok
          ? `${r.shot}: rendered in ${r.seconds}s${r.comparison ? ` — ${r.comparison.verdict}${r.comparison.silhouette.usable ? `, silhouette IoU ${r.comparison.silhouette.iou.toFixed(3)}` : `, silhouette not measurable`}` : ""}`
          : `${r.shot}: FAILED — ${r.error}`,
      );
      const glb = `/api/foundry/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(res.version)}/glb`;
      if (res.results.some((r) => r.ok)) summonSpatial({ tab: "render", source: "foundry.render", title: res.version, note: `${res.rendered} rendered`, glbUrl: glb });
      return { ok: res.rendered > 0, content: `Rendered ${res.rendered}, failed ${res.failed} for ${project} ${res.version}: ${lines.join("; ")}. The images are in this conversation; the failure logs are kept beside them.`, data: res };
    }),
  },
  {
    id: "foundry.compare",
    parameters: OBJECT({ project: { type: "string" }, version: { type: "string" }, shot: { type: "string" } }, ["shot"]),
    run: guard(async (a) => {
      const c = await post<{ comparison: { verdict: string; silhouette: { iou: number; usable: boolean; note: string }; colourDistance: number | null; landmarks: Array<{ feature: string; measured: number | null; reference: number | null; status: string; delta: number | null }>; notes: string[] }; reference: string }>("/api/foundry/compare", {
        project: str(a.project) ?? "lelu",
        version: str(a.version),
        shot: String(a.shot),
      });
      const lm = c.comparison.landmarks.map((l) => `${l.feature}: ${l.measured ?? "not measured"} vs ${l.reference} (${l.status}${l.delta !== null ? `, Δ ${l.delta}` : ""})`).join("; ");
      return {
        ok: true,
        content: `Comparison against ${c.reference}: verdict ${c.comparison.verdict}. Silhouette ${c.comparison.silhouette.usable ? `IoU ${c.comparison.silhouette.iou.toFixed(3)}` : `not measurable — ${c.comparison.silhouette.note}`}${c.comparison.colourDistance !== null ? `; colour distance ${c.comparison.colourDistance}` : ""}. Landmarks: ${lm || "none measured"}. ${c.comparison.notes.join(" ")}`,
        data: c,
      };
    }),
  },
  {
    id: "foundry.project",
    parameters: OBJECT({ project: { type: "string" }, action: { type: "string", enum: ["list", "inspect", "restore", "verify", "create"] }, version: { type: "string" }, name: { type: "string" } }, ["action"]),
    run: guard(async (a) => {
      const project = str(a.project) ?? "lelu";
      const action = String(a.action);
      if (action === "create") {
        const p = await post<{ project: { id: string; name: string; head: string } }>("/api/foundry/projects", { id: project, name: str(a.name) ?? project });
        return { ok: true, content: `Created Foundry project ${p.project.id} (${p.project.name}). It has no versions yet.`, data: p };
      }
      if (action === "restore") {
        const p = await post<{ version: { id: string; label: string }; project: { head: string } }>(`/api/foundry/projects/${encodeURIComponent(project)}/restore`, { version: String(a.version ?? "") });
        return { ok: true, content: `Restored ${String(a.version)} as new version ${p.version.id}; the head is now ${p.project.head}. Earlier versions are untouched.`, data: p };
      }
      if (action === "verify") {
        const v = await get<{ verification: { ok: boolean; versions: Array<{ id: string; ok: boolean }> } }>(`/api/foundry/projects/${encodeURIComponent(project)}/verify`);
        return { ok: v.verification.ok, content: v.verification.ok ? `All ${v.verification.versions.length} stored models re-hash to their recorded digests.` : `MISMATCH: ${v.verification.versions.filter((x) => !x.ok).map((x) => x.id).join(", ")} changed on disk.`, data: v };
      }
      const p = await get<{ project: { id: string; head: string; versions: string[] }; versions: Array<{ id: string; label: string; createdAt: string; triangles: number | null; validation: { verdict: string } | null }> }>(`/api/foundry/projects/${encodeURIComponent(project)}`);
      if (action === "inspect" && str(a.version)) {
        const v = p.versions.find((x) => x.id === a.version);
        return { ok: Boolean(v), content: v ? `${v.id} "${v.label}" ${v.createdAt}: ${v.triangles?.toLocaleString() ?? "?"} triangles, validation ${v.validation?.verdict ?? "none"}.` : `No version ${String(a.version)}.`, data: v ?? null };
      }
      return { ok: true, content: `${p.project.id}: head ${p.project.head || "none"}, ${p.versions.length} version(s) — ${p.versions.map((v) => `${v.id} ${v.label}`).join("; ")}.`, data: p };
    }),
  },
];

export function registerFoundryTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of FOUNDRY_TOOLS) registry.register(tool);
}
