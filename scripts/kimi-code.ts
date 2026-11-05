/**
 * ==========================================================
 * LÉLU — KIMI CODING HARNESS (Fireworks)
 *
 * A minimal agentic coding loop whose inference runs on Fireworks
 * through LÉLU's OWN FireworksProvider (workload "coding", so it
 * uses FIREWORKS_CODING_MODEL — Kimi K2.7 Code by default). No
 * second provider client, no Anthropic anywhere in the path.
 *
 * WHY IT EXISTS: the Claude Code session that set this up runs on
 * Anthropic inference fixed by its platform and cannot be pointed at
 * Fireworks. Coding work meant for Kimi runs HERE instead.
 *
 * SAFETY: every path is confined to --root (use a disposable git
 * worktree). Commands are an allowlist (typecheck, a single test
 * file, git diff/status). Nothing is committed or pushed.
 *
 *   npx tsx scripts/kimi-code.ts --root <dir> --task "<objective>" \
 *     [--model <fireworks model id>] [--max-rounds 24] [--out run.json] [--stream]
 *
 * Reports real token usage from Fireworks' `usage` field and a cost
 * computed from the per-model price table below (null when the model
 * is billed per GPU-hour on a dedicated deployment).
 * ==========================================================
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { AIMessage, AIRequest, ToolCall, ToolSchema } from "../src/providers/AIProvider";

/* ---------------- args ---------------- */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const ROOT = resolve(arg("root") ?? process.cwd());
const TASK = arg("task");
const MAX_ROUNDS = Number(arg("max-rounds", "24"));
const OUT = arg("out");
const STREAM = process.argv.includes("--stream");
if (!TASK) {
  console.error("usage: kimi-code.ts --root <dir> --task <objective> [--model id] [--max-rounds n] [--out file] [--stream]");
  process.exit(2);
}
if (arg("model")) process.env.FIREWORKS_CODING_MODEL = arg("model");
if (!process.env.FIREWORKS_API_KEY && !process.env.VITE_FIREWORKS_API_KEY) {
  console.error("FIREWORKS_API_KEY is not set. Add it to the environment's secrets / variables; nothing was run.");
  process.exit(3);
}

/* ---------------- pricing (USD per 1M tokens) ---------------- */

const PRICES: Record<string, { input: number; cachedInput: number; output: number } | null> = {
  // fireworks.ai/models/fireworks/kimi-k3p1-pro, read 2026-11-05.
  "accounts/fireworks/models/kimi-k3p1-pro": { input: 2.0, cachedInput: 0.2, output: 10.0 },
  // Dedicated deployment only: billed per GPU-hour, not per token.
  "accounts/fireworks/models/kimi-k2p7-code": null,
};

/* ---------------- sandboxed tools ---------------- */

function inside(path: string): string {
  const full = resolve(ROOT, path || ".");
  if (full !== ROOT && !full.startsWith(ROOT + sep)) throw new Error(`path escapes root: ${path}`);
  if (full.split(sep).includes(".git") || full.split(sep).includes("node_modules")) {
    throw new Error(`path not allowed: ${path}`);
  }
  return full;
}

const ALLOWED_COMMANDS: Array<{ re: RegExp; argv: (m: RegExpMatchArray) => string[] }> = [
  { re: /^typecheck$/, argv: () => ["npx", "tsc", "-p", "tsconfig.app.json", "--noEmit"] },
  { re: /^test (tests\/[\w.-]+\.test\.ts)$/, argv: (m) => ["npx", "tsx", "--test", m[1]] },
  { re: /^git diff$/, argv: () => ["git", "--no-pager", "diff"] },
  { re: /^git status$/, argv: () => ["git", "status", "--short"] },
];

const changed = new Set<string>();
const commandsRun: Array<{ command: string; ok: boolean }> = [];

const TOOLS: ToolSchema[] = [
  {
    name: "list_files",
    description: "List entries of a directory relative to the repository root.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "read_file",
    description: "Read a text file (optionally a 1-based inclusive line range). Output lines are prefixed with line numbers.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, start: { type: "integer" }, end: { type: "integer" } },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Search tracked files with `git grep -n` (extended regex). Optional path limits the search.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "edit_file",
    description: "Replace exactly one occurrence of old_text with new_text in a file. old_text must match exactly and be unique.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "write_file",
    description: "Create a NEW file. Fails if the file exists (use edit_file for existing files).",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  },
  {
    name: "run",
    description: "Run an allowlisted command: 'typecheck', 'test tests/<name>.test.ts', 'git diff', 'git status'.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
];

function runTool(call: ToolCall): { ok: boolean; content: string } {
  const a = (call.arguments ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  try {
    switch (call.name) {
      case "list_files": {
        const dir = inside(s("path"));
        const entries = readdirSync(dir)
          .filter((e) => e !== ".git" && e !== "node_modules")
          .map((e) => (statSync(resolve(dir, e)).isDirectory() ? `${e}/` : e));
        return { ok: true, content: entries.join("\n") };
      }
      case "read_file": {
        const lines = readFileSync(inside(s("path")), "utf8").split("\n");
        const start = Math.max(1, Number(a.start ?? 1));
        const end = Math.min(lines.length, Number(a.end ?? Math.min(lines.length, start + 399)));
        const body = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n");
        return { ok: true, content: `${body}${end < lines.length ? `\n… (${lines.length} lines total)` : ""}` };
      }
      case "search": {
        const extra = s("path") ? ["--", relative(ROOT, inside(s("path"))) || "."] : [];
        try {
          const out = execFileSync("git", ["grep", "-n", "-E", s("pattern"), ...extra], { cwd: ROOT, encoding: "utf8", maxBuffer: 4e6 });
          const lines = out.split("\n");
          return { ok: true, content: lines.slice(0, 80).join("\n") + (lines.length > 80 ? `\n… ${lines.length - 80} more` : "") };
        } catch (e: any) {
          return e?.status === 1 ? { ok: true, content: "(no matches)" } : { ok: false, content: String(e?.message ?? e) };
        }
      }
      case "edit_file": {
        const file = inside(s("path"));
        const text = readFileSync(file, "utf8");
        const count = text.split(s("old_text")).length - 1;
        if (!s("old_text") || count !== 1) return { ok: false, content: `old_text matched ${count} times; it must match exactly once.` };
        writeFileSync(file, text.replace(s("old_text"), () => s("new_text")));
        changed.add(relative(ROOT, file));
        return { ok: true, content: "edited" };
      }
      case "write_file": {
        const file = inside(s("path"));
        if (existsSync(file)) return { ok: false, content: "file exists; use edit_file" };
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, s("content"));
        changed.add(relative(ROOT, file));
        return { ok: true, content: "created" };
      }
      case "run": {
        const command = s("command").trim();
        for (const rule of ALLOWED_COMMANDS) {
          const m = command.match(rule.re);
          if (!m) continue;
          const [bin, ...rest] = rule.argv(m);
          try {
            const out = execFileSync(bin, rest, { cwd: ROOT, encoding: "utf8", stdio: "pipe", timeout: 600_000, maxBuffer: 2e7 });
            commandsRun.push({ command, ok: true });
            return { ok: true, content: `exit 0\n${out.slice(-6000)}` };
          } catch (e: any) {
            commandsRun.push({ command, ok: false });
            return { ok: false, content: `exit ${e?.status}\n${String(e?.stdout ?? "").slice(-5000)}\n${String(e?.stderr ?? "").slice(-2000)}` };
          }
        }
        return { ok: false, content: `command not allowed: ${command}` };
      }
      default:
        return { ok: false, content: `unknown tool ${call.name}` };
    }
  } catch (e) {
    return { ok: false, content: e instanceof Error ? e.message : String(e) };
  }
}

/* ---------------- loop ---------------- */

const SYSTEM = `You are a coding agent working in a git repository at the repository root ("."). This is a CODING task, not a conversation.
Rules: inspect before editing; make the smallest change that achieves the objective and match existing conventions; verify with the 'run' tool (typecheck / the relevant test file); never claim a check passed unless its real output says so; do not commit.
When done, reply with no tool calls and a short plain summary: files changed, commands run and their real results, anything left undone.`;

async function main(): Promise<void> {
  const { default: FireworksProvider } = await import("../src/providers/FireworksProvider");
  const provider = new FireworksProvider();
  await provider.initialize();

  const messages: AIMessage[] = [{ role: "user", content: TASK! }];
  const calls: Array<{ round: number; model: string; ms: number; usage: any; toolCalls: string[]; finish?: string }> = [];
  let final = "";
  let model = "";
  const started = Date.now();
  let streamedChars = 0;

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const last = round === MAX_ROUNDS;
    const request: AIRequest = {
      prompt: TASK!,
      messages,
      context: SYSTEM,
      workload: "coding",
      temperature: 0.2,
      maxTokens: 8192,
      ...(last ? {} : { tools: TOOLS }),
      ...(STREAM ? { onDelta: (t: string) => { streamedChars = t.length; } } : {}),
    };
    const response = await provider.generate(request);
    model = response.model;
    const toolCalls = response.toolCalls ?? [];
    calls.push({
      round,
      model: response.model,
      ms: response.processingTime,
      usage: response.metadata?.usage ?? null,
      toolCalls: toolCalls.map((c) => c.name),
      finish: response.stopReason,
    });
    console.error(`[round ${round}] ${response.processingTime}ms tools=[${toolCalls.map((c) => c.name).join(",")}] usage=${JSON.stringify(response.metadata?.usage ?? null)}`);
    if (toolCalls.length === 0) {
      final = response.text;
      break;
    }
    messages.push({ role: "assistant", content: response.text ?? "", toolCalls });
    for (const call of toolCalls) {
      const result = runTool(call);
      console.error(`   ${call.name}(${JSON.stringify(call.arguments).slice(0, 140)}) -> ${result.ok ? "ok" : "FAILED"}`);
      messages.push({ role: "tool", content: result.content, toolCallId: call.id, toolName: call.name, toolError: !result.ok });
    }
  }

  const sum = (k: string) => calls.reduce((n, c) => n + Number(c.usage?.[k] ?? 0), 0);
  const cached = calls.reduce((n, c) => n + Number(c.usage?.prompt_tokens_details?.cached_tokens ?? 0), 0);
  const usage = { prompt_tokens: sum("prompt_tokens"), completion_tokens: sum("completion_tokens"), total_tokens: sum("total_tokens"), cached_prompt_tokens: cached };
  const price = PRICES[model];
  const costUsd =
    price === undefined || price === null
      ? null
      : ((usage.prompt_tokens - cached) * price.input + cached * price.cachedInput + usage.completion_tokens * price.output) / 1e6;

  let diff = "";
  try {
    diff = execFileSync("git", ["--no-pager", "diff"], { cwd: ROOT, encoding: "utf8", maxBuffer: 2e7 });
  } catch { /* not a git tree */ }

  const report = {
    model,
    root: ROOT,
    task: TASK,
    rounds: calls.length,
    wallMs: Date.now() - started,
    final,
    filesChanged: [...changed],
    commandsRun,
    usage,
    costUsd,
    pricing: price ?? (price === null ? "per-GPU-hour dedicated deployment (no per-token price)" : "unknown model price"),
    ...(STREAM ? { streamed: true, lastStreamedChars: streamedChars } : {}),
    calls,
    diff,
  };
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, calls: undefined, diff: `${diff.split("\n").length} lines` }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
