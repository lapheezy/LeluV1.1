/**
 * diagnostics.run: LÉLU runs her own diagnostics from the conversation, inside Cosmos (v3 §16–19).
 *
 * It runs REAL suites (src/core/diagnostics/suites.ts): checks that measure the live page and stores,
 * and the project's own test files through the engineering authority. Before the run it puts a
 * Diagnostics surface in the conversation's thread (one per conversation), which streams the checks as
 * they finish. The reply is the run's own summary: counts per status and every check that did not pass,
 * with its reason. Read-only: anything changed to measure it is put back.
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import { chatSummary, getRun, runDiagnostics, suiteFor, suites } from "./Diagnostics";
import { registerDiagnosticSuites } from "./suites";

export const DIAGNOSTICS_TOOLS: ToolDefinition[] = [
  {
    id: "diagnostics.run",
    name: "Run diagnostics",
    description:
      'Run your own diagnostics on the open conversation and show them beside the chat: "freestyle-chat" (Freestyle + chat as one variant: spatial, borderless outputs, chat, coexistence, persistence, device), "integration" (chat + Neural Map + browser + video), "unit" (the project\'s tests), or "full". Every check reports PASS, FAIL, PARTIAL, BLOCKED or NOT_RUN with evidence. Use for: run a diagnostic, validate Freestyle, test borderless outputs, check chat/Neural Map/browser integration, find broken interactions, rerun.',
    category: "Diagnostics",
    permissions: ["READ"],
    riskLevel: 0,
    available: true,
    executionRoute: "DiagnosticsTools.diagnostics.run",
  },
];

async function surface(conversationId: string, runId: string, suite: string): Promise<void> {
  const T = await import("../thread/ThreadObjects");
  const { object, existing } = T.summon({ conversationId, kind: "diagnostics", by: "lelu", title: "Diagnostics", diagnostics: { runId, suite } });
  if (existing) T.update(object.id, { diagnostics: { runId, suite } });
}

export const DIAGNOSTICS_EXECUTORS: Array<{ id: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>, context?: { request?: { conversationId?: string | null } }) => Promise<ToolExecutionResult> }> = [
  {
    id: "diagnostics.run",
    parameters: { type: "object", properties: { suite: { type: "string" }, request: { type: "string" }, rerun: { type: "string" } }, required: [] },
    run: async (args, context) => {
      registerDiagnosticSuites();
      const asked = String(args.suite ?? args.request ?? args.query ?? "full");
      const rerunOf = typeof args.rerun === "string" ? getRun(args.rerun) : undefined;
      const suite = rerunOf ? rerunOf.suite : suiteFor(asked)?.id ?? "full";
      let conversationId = context?.request?.conversationId ?? null;
      if (!conversationId) {
        const MC = (await import("../multichat/MultiChatStore")).default.getInstance() as unknown as { getActiveId(): string | null };
        conversationId = MC.getActiveId();
      }
      // The surface appears first and the layout settles, then the run starts and streams into it.
      const run = await runDiagnostics(suite, conversationId, {
        ...(rerunOf ? { rerunOf: rerunOf.id } : {}),
        ready: async (r) => {
          if (!conversationId) return;
          await surface(conversationId, r.id, suite);
          await new Promise((done) => setTimeout(done, 1200));
        },
      });
      return { ok: true, content: chatSummary(run), data: { runId: run.id, suite, checks: run.checks.length, available: suites().map((s) => s.id) } };
    },
  },
];

export function registerDiagnosticsTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of DIAGNOSTICS_TOOLS) registry.register(tool);
}
