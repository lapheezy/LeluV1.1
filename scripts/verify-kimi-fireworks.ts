/**
 * LÉLU — live verification of Kimi on Fireworks through the real
 * FireworksProvider and router. Prints one JSON report; every number
 * in it comes from a real API response.
 *
 *   npx tsx scripts/verify-kimi-fireworks.ts [--model <serverless kimi id>]
 *
 * The configured coding model (FIREWORKS_CODING_MODEL, default Kimi K3.1 Pro)
 * is probed first and its REAL outcome recorded. The
 * capability checks then run on --model (default: the coding model;
 * pass e.g. kimi-k2p7-code once it has a deployment).
 */

import type { AIRequest, ToolSchema } from "../src/providers/AIProvider";
import { resolveModel } from "../src/core/ProviderModels";
import { endpointUrl } from "../src/core/Endpoints";

const i = process.argv.indexOf("--model");
const TEST_MODEL = i >= 0 ? process.argv[i + 1] : resolveModel("fireworksCoding");
const CONFIGURED = resolveModel("fireworksCoding");
const results: Record<string, unknown> = { configuredCodingModel: CONFIGURED, testModel: TEST_MODEL, endpoint: endpointUrl("fireworks", "chat/completions") };
const usages: any[] = [];

async function check(name: string, fn: () => Promise<unknown>): Promise<void> {
  const t = Date.now();
  try {
    results[name] = { ok: true, ...(await fn() as object), ms: Date.now() - t };
  } catch (e) {
    results[name] = { ok: false, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  if (!process.env.FIREWORKS_API_KEY) {
    console.log(JSON.stringify({ ok: false, error: "FIREWORKS_API_KEY missing — add it as an environment secret/variable." }));
    process.exit(3);
  }
  const { default: FireworksProvider } = await import("../src/providers/FireworksProvider");
  const { default: AnthropicProvider } = await import("../src/providers/AnthropicProvider");
  const { default: ModelRouter } = await import("../src/core/model/ModelRouter");

  const fw = new FireworksProvider();
  await fw.initialize();
  const base = (extra: Partial<AIRequest>): AIRequest => ({ prompt: "", messages: [], workload: "coding", temperature: 0, maxTokens: 2048, ...extra });
  const track = (r: any) => { usages.push(r.metadata?.usage); return r; };

  // 1. The configured model, exactly as LÉLU would call it.
  await check("configuredModelConnectivity", async () => {
    const r = track(await fw.generate(base({ prompt: "Reply with exactly: PONG", model: CONFIGURED })));
    return { model: r.model, text: r.text, usage: r.metadata?.usage };
  });

  // 2. Minimal connectivity on the test model via the coding workload.
  await check("connectivity", async () => {
    const r = track(await fw.generate(base({ prompt: "Reply with exactly: PONG", model: TEST_MODEL })));
    if (!/PONG/.test(r.text)) throw new Error(`unexpected: ${r.text}`);
    return { model: r.model, text: r.text, usage: r.metadata?.usage };
  });

  // 3. Streaming.
  await check("streaming", async () => {
    const deltas: number[] = [];
    const r = track(await fw.generate(base({ prompt: "Count from 1 to 20, comma separated.", model: TEST_MODEL, onDelta: (t) => deltas.push(t.length) })));
    if (r.metadata?.streamed !== true || deltas.length < 2) throw new Error(`not streamed: ${deltas.length} deltas`);
    return { deltas: deltas.length, chunks: r.metadata?.chunks, text: r.text.slice(0, 80), usageReportedInStream: Boolean(r.metadata?.usage), usage: r.metadata?.usage };
  });

  // 4. Tool calling, full round trip (request → result → answer).
  const tool: ToolSchema = {
    name: "get_line_count",
    description: "Return the number of lines in a repository file.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  };
  await check("toolCalling", async () => {
    const prompt = "How many lines does src/core/ProviderModels.ts have? Use the tool.";
    const r1 = track(await fw.generate(base({ prompt, model: TEST_MODEL, tools: [tool] })));
    const call = r1.toolCalls?.[0];
    if (!call) throw new Error(`no tool call; text=${r1.text.slice(0, 120)}`);
    const { readFileSync } = await import("node:fs");
    const lines = readFileSync(String(call.arguments.path), "utf8").split("\n").length;
    const r2 = track(await fw.generate(base({
      prompt,
      model: TEST_MODEL,
      tools: [tool],
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: r1.text, toolCalls: r1.toolCalls },
        { role: "tool", content: String(lines), toolCallId: call.id, toolName: call.name },
      ],
    })));
    if (!r2.text.includes(String(lines))) throw new Error(`answer ignored tool result: ${r2.text}`);
    return { call: { name: call.name, arguments: call.arguments }, realLines: lines, answer: r2.text.slice(0, 160) };
  });

  // 5. Streaming + tool call together (assembled from deltas).
  await check("streamingToolCall", async () => {
    const r = track(await fw.generate(base({ prompt: "Use the tool to count lines in package.json.", model: TEST_MODEL, tools: [tool], onDelta: () => {} })));
    if (!r.toolCalls?.length) throw new Error(`no tool call assembled; text=${r.text.slice(0, 120)}`);
    return { call: r.toolCalls[0] };
  });

  // 6. Multi-turn memory.
  await check("multiTurn", async () => {
    const r = track(await fw.generate(base({
      prompt: "What codename did I give you, and what number? Answer as CODENAME-NUMBER.",
      model: TEST_MODEL,
      messages: [
        { role: "user", content: "Remember: codename is ORCHID, number is 4471." },
        { role: "assistant", content: "Understood — ORCHID and 4471." },
      ],
    })));
    if (!/ORCHID-?\s*4471/i.test(r.text)) throw new Error(`lost context: ${r.text}`);
    return { text: r.text };
  });

  // 7. Structured output. FireworksProvider does not expose response_format,
  //    so this checks the ENDPOINT directly with the same key and model.
  await check("structuredOutput", async () => {
    const res = await fetch(endpointUrl("fireworks", "chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}` },
      body: JSON.stringify({
        model: TEST_MODEL,
        temperature: 0,
        max_tokens: 1024,
        messages: [{ role: "user", content: "Classify this change: 'fix null check in parser'. Return JSON." }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "change",
            schema: { type: "object", properties: { kind: { type: "string", enum: ["fix", "feature", "refactor"] }, risk: { type: "integer", minimum: 0, maximum: 3 } }, required: ["kind", "risk"], additionalProperties: false },
          },
        },
      }),
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error?.message}`);
    usages.push(data.usage);
    const parsed = JSON.parse(data.choices[0].message.content);
    if (!["fix", "feature", "refactor"].includes(parsed.kind) || typeof parsed.risk !== "number") throw new Error(`schema violated: ${data.choices[0].message.content}`);
    return { parsed, viaProvider: false };
  });

  // 8. Routing + policy.
  await check("routing", async () => {
    const router = ModelRouter.getInstance();
    const coding = router.route({ prompt: "fix the bug", messages: [] }, "engineering");
    const chat = router.route({ prompt: "hello", messages: [] }, "chat" as never);
    if (coding.preferredProviders[0] !== "Fireworks" || coding.workload !== "coding") throw new Error(JSON.stringify(coding.preferredProviders));
    return { codingOrder: coding.preferredProviders, codingWorkload: coding.workload, chatOrder: chat.preferredProviders };
  });
  await check("anthropicDisabledByDefault", async () => {
    const a = new AnthropicProvider();
    await a.initialize();
    const available = await a.isAvailable();
    const health = await a.health();
    let generateRefused = "";
    try { await a.generate({ prompt: "hi", messages: [] }); } catch (e) { generateRefused = (e as Error).message; }
    if (available || !generateRefused) throw new Error("Anthropic reachable with policy off");
    return { flag: process.env.LELU_ENABLE_ANTHROPIC ?? "(unset)", keyPresent: Boolean(process.env.LELU_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY), available, healthError: health.lastError, generateRefused };
  });

  const total = usages.filter(Boolean).reduce((t, u) => ({
    prompt_tokens: t.prompt_tokens + (u.prompt_tokens ?? 0),
    completion_tokens: t.completion_tokens + (u.completion_tokens ?? 0),
    cached: t.cached + (u.prompt_tokens_details?.cached_tokens ?? 0),
  }), { prompt_tokens: 0, completion_tokens: 0, cached: 0 });
  results.usageTotal = total;
  if (TEST_MODEL === "accounts/fireworks/models/kimi-k3p1-pro") {
    results.costUsd = ((total.prompt_tokens - total.cached) * 2 + total.cached * 0.2 + total.completion_tokens * 10) / 1e6;
  }
  console.log(JSON.stringify(results, null, 2));
}

main();
