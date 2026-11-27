/**
 * MISSION 44.5 — PROVIDER TRACE, WRITTEN AGAINST THE REAL READER
 *
 * Why this exists: Mission 44.4 recorded "OpenRouter killed by the 12 s rung
 * budget" and "Groq returned no usable content" on multi-tool turns, and
 * could not say WHERE the failure was. This probe asks the provider the same
 * question twice — once with the production stream reader
 * (`readOpenAIStream`), once with a raw chunk by chunk reader — and records
 * both, so a difference between them is a defect in our parsing and not in
 * the provider.
 *
 * It never prints, logs or stores a credential. Only the env var NAME is
 * recorded.
 *
 *   npx tsx docs/missions/evidence/mission-44-5/scripts/provider-trace.ts groq
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnvFilesIntoProcess } from "../../../../../plugins/loadEnvFiles.ts";
import { readOpenAIStream } from "../../../../../src/providers/openaiTools.ts";

const provider = (process.argv[2] ?? "groq").toLowerCase();
const outPath =
  process.argv[3] ??
  `docs/missions/evidence/mission-44-5/traces/${provider}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

loadEnvFilesIntoProcess(["GROQ_API_KEY", "OPENROUTER_API_KEY"]);

/** The tools a research turn really carries: two lookups and a memory read. */
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "lab_history",
      description: "List the self-development laboratory's experiments with their branch, status and base commit.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "lab_repository",
      description: "Report the repository's current branch, HEAD commit and worktree list.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_recall",
      description: "Search LÉLU's memory for a phrase.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

const QUESTION =
  "Check the laboratory's experiment history and then the repository's current branch. " +
  "Then tell me, in two sentences, which experiments are on which base commit.";

const RESULTS: Record<string, string> = {
  lab_history:
    "8 experiments. exp-engineer-ops (complete, commit 4c1a9e2), exp-api-error-status (complete, commit 31b2f0a), " +
    "exp-work-queue-check (failed, commit 9d0c114) — all based on 543da7c.",
  lab_repository:
    "Branch mission/44-5-conversational-reliability. HEAD 77ead33 \"Let the laboratory answer the page\". " +
    "Base commit for every experiment: 543da7c.",
};

interface Attempt {
  provider: string;
  credentialEnv: string;
  model: string;
  stream: boolean;
  round: number;
  httpStatus?: number;
  elapsedMs: number;
  requestBytes: number;
  toolCount: number;
  raw: {
    contentChars: number;
    reasoningChars: number;
    toolCalls: Array<{ name: string; arguments: string }>;
    finishReason?: string;
    /** Which delta fields the provider actually sent. */
    deltaFields: string[];
    chunkCount: number;
    usage?: unknown;
  };
  parsed: {
    textChars: number;
    toolCalls: Array<{ name: string; arguments: string }>;
    finishReason?: string;
    error?: string;
  };
  note?: string;
}

function target(): { url: string; key: string; envName: string; model: string } {
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY?.trim() ?? process.env.GROQ_API_KEY_1?.trim() ?? "";
    return {
      url: process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1",
      key,
      envName: process.env.GROQ_API_KEY ? "GROQ_API_KEY" : "GROQ_API_KEY_1",
      model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
    };
  }
  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  return {
    url: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    key,
    envName: "OPENROUTER_API_KEY",
    model:
      process.env.OPENROUTER_MODEL?.trim() ||
      "nvidia/nemotron-3-ultra-550b-a55b:free",
  };
}

async function call(
  body: Record<string, unknown>,
  round: number,
  stream: boolean,
): Promise<Attempt> {
  const cfg = target();
  const request = JSON.stringify(body);
  const started = Date.now();
  const attempt: Attempt = {
    provider,
    credentialEnv: cfg.envName,
    model: String(body.model),
    stream,
    round,
    elapsedMs: 0,
    requestBytes: Buffer.byteLength(request, "utf8"),
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    raw: { contentChars: 0, reasoningChars: 0, toolCalls: [], deltaFields: [], chunkCount: 0 },
    parsed: { textChars: 0, toolCalls: [] },
  };

  const response = await fetch(`${cfg.url}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.key}`,
      ...(provider === "openrouter"
        ? { "HTTP-Referer": "https://freebull.com", "X-Title": "Lelu" }
        : {}),
    },
    body: request,
    signal: AbortSignal.timeout(120_000),
  });

  attempt.httpStatus = response.status;
  attempt.elapsedMs = Date.now() - started;

  if (!stream) {
    const text = await response.text();
    attempt.elapsedMs = Date.now() - started;
    const json = (() => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return null;
      }
    })();
    const choice = (json?.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const calls = Array.isArray(message?.tool_calls)
      ? (message.tool_calls as Array<{ function?: { name?: string; arguments?: string } }>)
      : [];
    attempt.raw.contentChars = typeof message?.content === "string" ? message.content.length : 0;
    attempt.raw.reasoningChars =
      (typeof message?.reasoning === "string" ? message.reasoning.length : 0) +
      (typeof message?.reasoning_content === "string" ? (message.reasoning_content as string).length : 0);
    attempt.raw.toolCalls = calls.map((entry) => ({
      name: String(entry?.function?.name ?? ""),
      arguments: String(entry?.function?.arguments ?? "").slice(0, 200),
    }));
    attempt.raw.finishReason = choice?.finish_reason as string | undefined;
    attempt.raw.usage = json?.usage;
    if (!json) attempt.note = `unparseable body: ${text.slice(0, 200)}`;
    attempt.parsed.textChars = typeof message?.content === "string" ? message.content.length : 0;
    attempt.parsed.toolCalls = attempt.raw.toolCalls;
    attempt.parsed.finishReason = attempt.raw.finishReason;
    return attempt;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    attempt.note = `HTTP ${response.status}: ${text.slice(0, 300)}`;
    return attempt;
  }

  // ONE pass over the stream, then BOTH readers applied to the same bytes:
  // the raw fields the provider sent, and what our parser made of them.
  const chunks: string[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  const bodyText = chunks.join("");
  attempt.elapsedMs = Date.now() - started;

  // Raw: what the provider really sent.
  let rawContent = "";
  let rawReasoning = "";
  const rawCalls = new Map<number, { name: string; args: string }>();
  const deltaFields = new Set<string>();
  let finishReason: string | undefined;
  let chunkCount = 0;
  for (const line of bodyText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    chunkCount += 1;
    if (chunk.usage) attempt.raw.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    if (!delta) continue;
    for (const key of Object.keys(delta)) {
      if (delta[key] !== null && delta[key] !== undefined) deltaFields.add(key);
    }
    if (typeof delta.content === "string") rawContent += delta.content;
    if (typeof delta.reasoning === "string") rawReasoning += delta.reasoning;
    if (typeof delta.reasoning_content === "string") rawReasoning += delta.reasoning_content;
    for (const part of delta.tool_calls ?? []) {
      const index = typeof part.index === "number" ? part.index : 0;
      const current = rawCalls.get(index) ?? { name: "", args: "" };
      if (part.function?.name) current.name += part.function.name;
      if (part.function?.arguments) current.args += part.function.arguments;
      rawCalls.set(index, current);
    }
  }
  attempt.raw.contentChars = rawContent.length;
  attempt.raw.reasoningChars = rawReasoning.length;
  attempt.raw.deltaFields = [...deltaFields];
  attempt.raw.chunkCount = chunkCount;
  attempt.raw.finishReason = finishReason;
  attempt.raw.toolCalls = [...rawCalls.values()].map((call) => ({
    name: call.name,
    arguments: call.args.slice(0, 200),
  }));

  // OUR reader, on the same SSE payload.
  const replay = new Response(bodyText, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  try {
    const parsed = await readOpenAIStream(replay, provider, () => {});
    attempt.parsed.textChars = parsed.text.length;
    attempt.parsed.toolCalls = parsed.toolCalls.map((call) => ({
      name: call.name,
      arguments: JSON.stringify(call.arguments ?? {}).slice(0, 200),
    }));
    attempt.parsed.finishReason = parsed.finishReason;
  } catch (error) {
    attempt.parsed.error = error instanceof Error ? error.message : String(error);
  }
  if (attempt.raw.reasoningChars > 0 && attempt.raw.contentChars === 0) {
    attempt.note =
      "the provider streamed reasoning only; content was empty, so a reader that ignores " +
      "reasoning deltas sees an empty answer";
  }
  return attempt;
}

async function main(): Promise<void> {
  const cfg = target();
  const attempts: Attempt[] = [];
  const conversation: Array<Record<string, unknown>> = [
    {
      role: "system",
      content:
        "You are LÉLU. Use the tools to check facts before answering. Never claim a fact you did not retrieve.",
    },
    { role: "user", content: QUESTION },
  ];

  if (!cfg.key) {
    console.log(JSON.stringify({ provider, configured: false, envName: cfg.envName }, null, 2));
    process.exit(3);
  }

  for (const stream of [true, false]) {
    // Round 1: the model may ask for tools.
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: conversation,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 2048,
      ...(stream ? { stream: true } : {}),
    };
    const first = await call(body, 1, stream);
    attempts.push(first);
    console.log(
      `[${provider} ${stream ? "stream" : "json"} round1] HTTP ${first.httpStatus} ` +
        `content=${first.raw.contentChars} reasoning=${first.raw.reasoningChars} ` +
        `calls=${first.raw.toolCalls.map((c) => c.name).join(",") || "none"} ` +
        `finish=${first.raw.finishReason ?? "-"} parsed=${first.parsed.textChars}ch/${first.parsed.toolCalls.length} calls` +
        `${first.parsed.error ? ` ERROR ${first.parsed.error}` : ""}`,
    );

    if (first.raw.toolCalls.length === 0) {
      console.log(`    no tool call on round 1 — provider answered directly${first.note ? ` (${first.note})` : ""}`);
      continue;
    }

    // Round 2: hand back the real results and ask for the narration.
    conversation.push({
      role: "assistant",
      content: null,
      tool_calls: first.raw.toolCalls.map((call, index) => ({
        id: `call_${index}`,
        type: "function",
        function: { name: call.name, arguments: "{}" },
      })),
    });
    for (const [index, call] of first.raw.toolCalls.entries()) {
      conversation.push({
        role: "tool",
        tool_call_id: `call_${index}`,
        content: RESULTS[call.name.replace("_", "_")] ?? RESULTS.lab_repository,
      });
    }
    const second = await call(
      {
        model: cfg.model,
        messages: conversation,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: 2048,
        ...(stream ? { stream: true } : {}),
      },
      2,
      stream,
    );
    attempts.push(second);
    console.log(
      `[${provider} ${stream ? "stream" : "json"} round2] HTTP ${second.httpStatus} ` +
        `content=${second.raw.contentChars} reasoning=${second.raw.reasoningChars} ` +
        `calls=${second.raw.toolCalls.map((c) => c.name).join(",") || "none"} ` +
        `finish=${second.raw.finishReason ?? "-"} parsed=${second.parsed.textChars}ch` +
        `${second.parsed.error ? ` ERROR ${second.parsed.error}` : ""}`,
    );
  }

  // THE TIGHT-BUDGET ROUND: the shape Mission 44.4 could only report as
  // "returned no usable content". A reasoning model asked for an answer with
  // 300 output tokens spends them thinking, and a reader that only looks at
  // `content` sees nothing at all.
  const tight: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      {
        role: "user",
        content:
          "Work out step by step which of 17, 23 and 41 are prime, then say which is largest. " +
          "Think it through before answering.",
      },
    ],
    max_tokens: 300,
    stream: true,
  };
  const tightAttempt = await call(tight, 3, true);
  tightAttempt.note = tightAttempt.note ?? "tight output budget";
  attempts.push(tightAttempt);
  console.log(
    `[${provider} stream tight] HTTP ${tightAttempt.httpStatus} content=${tightAttempt.raw.contentChars} ` +
      `reasoning=${tightAttempt.raw.reasoningChars} finish=${tightAttempt.raw.finishReason ?? "-"} ` +
      `parsed=${tightAttempt.parsed.textChars}ch${tightAttempt.parsed.error ? ` ERROR ${tightAttempt.parsed.error}` : ""}`,
  );

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      { provider, model: cfg.model, credentialEnv: cfg.envName, at: new Date().toISOString(), attempts },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${outPath}`);
}

await main();
