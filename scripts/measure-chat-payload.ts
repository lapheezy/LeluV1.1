/**
 * ==========================================================
 * MISSION 6.1.4 — WHAT ONE CHAT TURN ACTUALLY TRANSMITS
 *
 * Mission 6.1.3 measured, from the server's broker log, that a
 * conversational turn carried ~21,756 tokens of tool definitions in
 * a 102 KB body, and that both providers refused it before one
 * accepted a retry. This script measures the same thing from the
 * client side, deterministically, on demand: it drives the REAL
 * chat entry point (AIService.chat) with fetch intercepted at the
 * network boundary, so every number below is the assembled
 * request — not a reconstruction from module names.
 *
 * It is deliberately read-only: it changes no behaviour, sends no
 * credential anywhere, and prints sizes and counts only — never
 * message text, never a key.
 *
 * Usage:
 *   tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
 *     scripts/measure-chat-payload.ts "What are you?"
 * ==========================================================
 */

interface Captured {
  target: string;
  bytes: number;
  messages: number;
  tools: number;
  toolBytes: number;
  maxTokens: number | null;
  stream: boolean;
}

const captured: Captured[] = [];
const realFetch = globalThis.fetch;

/** Bytes as UTF-8, the same unit RequestBudget uses. */
const bytes = (value: unknown): number =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value ?? "")).length;

function sse(text: string, model: string): Response {
  const frame =
    `data: ${JSON.stringify({ id: "harness", model, choices: [{ delta: { content: text }, index: 0 }] })}\n\n` +
    `data: ${JSON.stringify({ id: "harness", model, choices: [{ delta: {}, finish_reason: "stop", index: 0 }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } })}\n\n` +
    "data: [DONE]\n\n";
  return new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function json(text: string, model: string): Response {
  return new Response(
    JSON.stringify({
      id: "harness",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const isModelCall =
    /(api\.groq\.com|openrouter\.ai|api\.cerebras\.ai|api\.mistral\.ai|generativelanguage\.googleapis\.com)/.test(url) ||
    /\/api\/model\/[^/]+\/(chat\/completions|messages|streamGenerateContent)/.test(url);
  if (!isModelCall) return realFetch(input as never, init as never);

  const body = typeof init?.body === "string" ? init.body : "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const tools = Array.isArray(parsed.tools) ? (parsed.tools as unknown[]) : [];
  const model = String(parsed.model ?? "stub");
  captured.push({
    target: /groq/.test(url) ? "groq" : /openrouter/.test(url) ? "openrouter" : url.split("/api/model/")[1] ?? url,
    bytes: bytes(body),
    messages: Array.isArray(parsed.messages) ? (parsed.messages as unknown[]).length : 0,
    tools: tools.length,
    toolBytes: tools.length > 0 ? bytes(tools) : 0,
    maxTokens: typeof parsed.max_tokens === "number" ? parsed.max_tokens : null,
    stream: parsed.stream === true,
  });

  return parsed.stream === true ? sse("Harness reply.", model) : json("Harness reply.", model);
}) as typeof fetch;

const prompt = process.argv[2] ?? "What are you?";

const { default: AIService } = await import("../src/core/AIService.ts");

const ai = AIService.getInstance();

interface TurnOutcome {
  text: string;
  provider: string;
  model: string;
  error?: string;
}

const report = async (): Promise<TurnOutcome | number> => {
  try {
    await ai.initialize();
    const response = await ai.chat(prompt);
    const meta = (response.metadata ?? {}) as Record<string, unknown>;
    return {
      text: response.text,
      provider: String(response.provider ?? "?"),
      model: String(response.model ?? "?"),
      error: meta.error ? String(meta.error).slice(0, 160) : undefined,
    };
  } catch (error) {
    console.error("chat failed:", error instanceof Error ? error.message : String(error));
    return 0;
  }
};

const completed = await Promise.race([
  report(),
  new Promise<number>((resolve) => setTimeout(() => resolve(-1), 90_000)),
]);

/* ------------------------------ output ------------------------------- */

const line = (label: string, value: string | number) => console.log(`  ${label.padEnd(26)}${value}`);

console.log(`\nCHAT PAYLOAD — "${prompt}"`);
if (typeof completed === "number") {
  console.log(`  reply${String("").padEnd(22)}${completed < 0 ? "timeout" : `no response (${completed})`}`);
} else {
  console.log(`  answered by${String("").padEnd(15)}${completed.provider} / ${completed.model}`);
  console.log(`  reply${String("").padEnd(22)}${JSON.stringify(completed.text.slice(0, 120))}`);
  if (completed.error) console.log(`  error${String("").padEnd(22)}${completed.error}`);
}

if (captured.length === 0) {
  console.log("  (no provider request reached the boundary — the turn was answered locally)");
} else {
  captured.forEach((call, index) => {
    const perToken = call.toolBytes > 0 ? (call.toolBytes / 3.2).toFixed(0) : "0";
    console.log(`\n  attempt ${index + 1} → ${call.target}`);
    line("body bytes", call.bytes);
    line("body KB", (call.bytes / 1024).toFixed(1));
    line("messages", call.messages);
    line("tool definitions", call.tools);
    line("tool schema bytes", call.toolBytes);
    line("tool KB", (call.toolBytes / 1024).toFixed(1));
    line("tool share of body", call.bytes > 0 ? `${Math.round((call.toolBytes / call.bytes) * 100)}%` : "0%");
    line("tool tokens (÷3.2)", perToken);
    line("max_tokens", call.maxTokens ?? "unset");
    line("stream", call.stream);
  });
  const worst = captured.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  console.log(`\n  worst attempt: ${worst.target}, ${worst.bytes} bytes, ${worst.tools} schemas, ~${Math.round(worst.toolBytes / 3.2)} tool tokens`);
  console.log(`  attempts: ${captured.length}`);
}
console.log("");
