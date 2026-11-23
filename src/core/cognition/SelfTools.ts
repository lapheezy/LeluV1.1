/**
 * ==========================================================
 * LÉLU — HER OWN TOOLS FOR KNOWING AND REPEATING HER CHANGES
 *
 *   self.changes         what was changed in me, by whom, why, which parts
 *   self.journal         the explained lessons (how it was done, how to redo it)
 *   self.playbooks       procedures I can run, with their cost
 *   self.playbook.run    run one (server: plugins/selfJournalApi.ts) — credit
 *                        spending steps need a person's approval named in the call
 *   self.run.status      progress and output of a run
 *
 * Same ToolRegistry / ToolDispatcher table as every other capability.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import SelfChangeAwareness from "./SelfChangeAwareness";
import SourceAccess from "../selfdev/SourceAccess";

interface SelfExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const OBJECT = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });
const str = (a: Record<string, unknown>, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const SELF_TOOLS: ToolDefinition[] = [
  { id: "self.changes", name: "My Changes", description: "Every recent change to my code and assets from git (who, when, why, which of my parts), plus the journal written for me. Use this — never guess — when asked what changed in me or who changed me.", category: "Self", permissions: ["READ"], riskLevel: 0, available: true, inputSchema: { limit: "number" }, executionRoute: "GET /api/self/changes" },
  { id: "self.journal", name: "My Journal", description: "The explained lessons: what was done to me, why, what went wrong, and how I can redo it myself.", category: "Self", permissions: ["READ"], riskLevel: 0, available: true, inputSchema: { title: "string" }, executionRoute: "GET /api/self/journal" },
  { id: "self.playbooks", name: "My Playbooks", description: "Procedures I can run myself (rebuild my looks, make a new look from photos, change outfits), step by step with cost.", category: "Self", permissions: ["READ"], riskLevel: 0, available: true, inputSchema: { id: "string" }, executionRoute: "GET /api/self/playbooks" },
  { id: "self.playbook.run", name: "Run My Playbook", description: "Run one of my playbooks on the server. Steps that spend Meshy credits are refused unless approveSpend is true and approvedBy names the person who approved.", category: "Self", permissions: ["EXECUTE"], riskLevel: 2, available: true, inputSchema: { id: "string", steps: "array", params: "object", approveSpend: "boolean", approvedBy: "string" }, executionRoute: "POST /api/self/playbooks/<id>/run" },
  { id: "self.run.status", name: "My Run Status", description: "Progress and output of a playbook run.", category: "Self", permissions: ["READ"], riskLevel: 0, available: true, inputSchema: { runId: "string" }, executionRoute: "GET /api/self/runs/<id>" },
];

export const SELF_EXECUTORS: SelfExecutor[] = [
  {
    id: "self.changes",
    parameters: OBJECT({ limit: { type: "number", description: "How many commits, newest first (default 15)." } }, []),
    run: async (a) => {
      const limit = typeof a.limit === "number" ? a.limit : 15;
      const data = await get<{ changes: Array<{ hash: string; author: string; date: string; subject: string; body: string; areas: string[] }>; journal: Array<{ title: string; file: string }> }>(`/api/self/changes?limit=${limit}`);
      const lines = data.changes.map((c) => `${c.date.slice(0, 10)} ${c.author} — ${c.subject} [${c.areas.join("; ")}] (${c.hash.slice(0, 8)})${c.body ? `\n    ${c.body.split("\n")[0]}` : ""}`);
      return { ok: true, content: `Changes made to me, newest first:\n${lines.join("\n")}\n\nJournal: ${data.journal.map((j) => j.title).join(" | ") || "none"}`, data };
    },
  },
  {
    id: "self.journal",
    parameters: OBJECT({ title: { type: "string", description: "Part of a journal title to open; empty lists them." } }, []),
    run: async (a) => {
      const { journal } = await get<{ journal: Array<{ title: string; file: string; date: string; text: string; playbooks: string[] }> }>("/api/self/journal");
      const q = str(a, "title").toLowerCase();
      const hit = q ? journal.find((j) => j.title.toLowerCase().includes(q) || j.file.includes(q)) : null;
      if (hit) return { ok: true, content: `${hit.title} (${hit.date})\n\n${hit.text}`, data: hit };
      return { ok: true, content: journal.map((j) => `${j.date} — ${j.title} (${j.file})`).join("\n") || "My journal is empty.", data: journal };
    },
  },
  {
    id: "self.playbooks",
    parameters: OBJECT({ id: { type: "string", description: "A playbook id to read in full; empty lists them." } }, []),
    run: async (a) => {
      const id = str(a, "id");
      if (id) {
        const { playbook } = await get<{ playbook: { title: string; why: string; spendsCredits: number; steps: Array<{ id: string; title: string; kind: string; why?: string; spend?: number }> } }>(`/api/self/playbooks/${encodeURIComponent(id)}`);
        const steps = playbook.steps.map((s, i) => `${i + 1}. ${s.title} [${s.kind}${s.spend ? `, ${s.spend} credits` : ""}]${s.why ? ` — ${s.why}` : ""}`);
        return { ok: true, content: `${playbook.title}\nWhy: ${playbook.why}\nCost: ${playbook.spendsCredits} credits\n${steps.join("\n")}`, data: playbook };
      }
      const { playbooks } = await get<{ playbooks: Array<{ id: string; title: string; spendsCredits: number; steps: number }> }>("/api/self/playbooks");
      return { ok: true, content: playbooks.map((p) => `${p.id}: ${p.title} (${p.steps} steps, ${p.spendsCredits} credits)`).join("\n"), data: playbooks };
    },
  },
  {
    id: "self.playbook.run",
    parameters: OBJECT(
      {
        id: { type: "string", description: "Playbook id." },
        steps: { type: "array", items: { type: "string" }, description: "Only these step ids (default: all)." },
        params: { type: "object", description: "Values for the playbook's ${params}." },
        approveSpend: { type: "boolean", description: "True only when a person approved spending credits in this conversation." },
        approvedBy: { type: "string", description: "Who approved the spend." },
      },
      ["id"],
    ),
    run: async (a) => {
      const id = str(a, "id");
      const access = SourceAccess.getInstance();
      const res = await fetch(access.url(`/api/self/playbooks/${encodeURIComponent(id)}/run`), {
        method: "POST",
        headers: access.headers(),
        body: JSON.stringify({ steps: a.steps, params: a.params, approveSpend: a.approveSpend === true, approvedBy: str(a, "approvedBy") }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; run?: { id: string; status: string }; error?: string };
      if (!json.ok) return { ok: false, content: `I could not run ${id}: ${json.error ?? `HTTP ${res.status}`}` };
      return { ok: true, content: `Started ${id} as ${json.run?.id}. I'll check it with self.run.status and look at the renders before I say it worked.`, data: json.run };
    },
  },
  {
    id: "self.run.status",
    parameters: OBJECT({ runId: { type: "string" } }, ["runId"]),
    run: async (a) => {
      const { run } = await get<{ run: { status: string; steps: Array<{ id: string; status: string; output: string; seconds?: number }>; error?: string } }>(`/api/self/runs/${encodeURIComponent(str(a, "runId"))}`);
      return { ok: true, content: `${run.status}${run.error ? ` — ${run.error}` : ""}\n${run.steps.map((s) => `${s.id}: ${s.status}${s.seconds ? ` (${s.seconds}s)` : ""}`).join("\n")}`, data: run };
    },
  },
];

export function registerSelfTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of SELF_TOOLS) registry.register(tool);
  SelfChangeAwareness.getInstance().start();
}
