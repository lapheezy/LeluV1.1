/**
 * LÉLU — LIVE PROVIDER REQUEST-PATH VERIFICATION (zero spend)
 *
 * Sends one tiny real request per authorised chat provider THROUGH THE REAL
 * SERVER BROKER (plugins/modelApi.ts) — the path every browser turn takes —
 * using whatever credentials this process environment holds, resolved by the
 * canonical contract (src/core/model/ProviderCredentials.ts).
 *
 * Safety, by construction rather than by care:
 *   - the broker runs under an ISOLATED zero-spend policy (temp dir, no
 *     authorizations), so a paid provider (Fireworks, Mistral, Gemini, a paid
 *     OpenRouter model) is refused by the broker BEFORE any request leaves;
 *   - Anthropic is never asked to answer: the script sends one request to the
 *     broker's Anthropic route and asserts that ZERO requests reached
 *     Anthropic (policy off unless LELU_ENABLE_ANTHROPIC=true; if an operator
 *     has turned it on, the script refuses to run at all);
 *   - output is status codes, model names, sizes and the first few characters
 *     of each answer. Never a key, never a key length.
 *
 * Voice: one second of a synthetic tone is posted to Groq Whisper through the
 * same broker route the browser uses (/api/model/groq/audio/transcriptions).
 *
 *   npx tsx scripts/verify-provider-runtime-live.ts [--json]
 *
 * Exit 0: every configured FREE provider answered through the broker, voice
 * transcription answered, and Anthropic received nothing.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createModelApi } from "../plugins/modelApi.ts";
import { costOf, createSpendPolicy, setSpendPolicyForTests } from "../plugins/spendPolicy.ts";
import {
  AUTHORIZED_CHAT_PROVIDERS,
  credentialReport,
  describeCredentialState,
} from "../src/core/model/ProviderCredentials.ts";
import { resolveModel } from "../src/core/ProviderModels.ts";

const POLICY_TRUE = new Set(["1", "true", "yes", "on"]);
if (POLICY_TRUE.has((process.env.LELU_ENABLE_ANTHROPIC ?? "").trim().toLowerCase())) {
  console.error("LELU_ENABLE_ANTHROPIC is on: this script only verifies the authorised providers and will not run.");
  process.exit(2);
}

// Zero spend, isolated: nothing paid can be sent, and no audit is written to the repo.
setSpendPolicyForTests(
  createSpendPolicy({ stateDir: mkdtempSync(path.join(tmpdir(), "lelu-live-verify-")), read: () => undefined }),
);

type Handler = (req: unknown, res: unknown, next: () => void) => void;
let handler: Handler | null = null;
createModelApi((name) => process.env[name]).attach({ use: (_path, fn) => { handler = fn as Handler; } });

/** Every upstream request the broker makes, by host — to prove where traffic went. */
const upstreamHosts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  upstreamHosts.push(new URL(String(input instanceof Request ? input.url : input)).host);
  return realFetch(input, init);
}) as typeof fetch;

async function broker(url: string, body: Buffer, contentType: string): Promise<{ status: number; body: string }> {
  const out = { status: 200, body: "" };
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    const req = {
      method: "POST",
      url,
      headers: { "content-type": contentType },
      on: (event: string, fn: (chunk?: unknown) => void) => {
        if (event === "data") fn(body);
        if (event === "end") fn();
      },
    };
    const res = {
      set statusCode(v: number) { out.status = v; },
      get statusCode() { return out.status; },
      headersSent: false,
      setHeader: () => {},
      flushHeaders: () => {},
      write: (chunk: string | Uint8Array) => { chunks.push(Buffer.from(chunk)); return true; },
      end: (text?: string) => { if (text) chunks.push(Buffer.from(text)); out.body = Buffer.concat(chunks).toString("utf8"); resolve(); },
    };
    (handler as Handler)(req, res, () => resolve());
  });
  return out;
}

/** One second of a 440 Hz tone, 16 kHz mono 16-bit PCM WAV. */
function toneWav(): Buffer {
  const rate = 16_000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function multipart(fields: Record<string, string>, file: Buffer): { body: Buffer; type: string } {
  const boundary = `lelu${Date.now().toString(16)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tone.wav"\r\nContent-Type: audio/wav\r\n\r\n`));
  parts.push(file, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

const results: Record<string, unknown> = {};
let failures = 0;

for (const id of AUTHORIZED_CHAT_PROVIDERS) {
  const report = credentialReport(id);
  const model = resolveModel(id);
  const cost = costOf(id, { model }).cost;
  if (report.state !== "configured") {
    results[id] = { run: false, credential: report.state, diagnosis: describeCredentialState(report) };
    continue;
  }
  const before = upstreamHosts.length;
  const started = Date.now();
  const payload = id === "gemini"
    ? { contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { maxOutputTokens: 16 } }
    : { model, messages: [{ role: "user", content: "Reply with the single word OK." }], max_tokens: 64 };
  const route = id === "gemini" ? `/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent` : `/${id}/chat/completions`;
  const out = await broker(route, Buffer.from(JSON.stringify(payload)), "application/json");
  const sent = upstreamHosts.slice(before);
  let answer = "";
  try {
    const parsed = JSON.parse(out.body) as { choices?: Array<{ message?: { content?: string; reasoning?: string } }> };
    answer = String(parsed.choices?.[0]?.message?.content ?? "").slice(0, 24);
  } catch { /* non-JSON body: status says enough */ }
  const ok = cost === "free" ? out.status >= 200 && out.status < 300 && sent.length > 0 : out.status !== 200 && sent.length === 0;
  if (!ok) failures += 1;
  results[id] = {
    run: true,
    credential: `configured from ${report.source} (${report.count} key${report.count === 1 ? "" : "s"})`,
    cost,
    model,
    brokerStatus: out.status,
    upstreamHosts: sent,
    ms: Date.now() - started,
    ...(cost === "free" ? { answer } : { refusedWithoutSending: sent.length === 0 }),
    ok,
  };
}

// Voice: the browser's transcription route, through the same broker.
{
  const report = credentialReport("groq");
  if (report.state === "configured") {
    const form = multipart({ model: "whisper-large-v3-turbo", response_format: "json" }, toneWav());
    const before = upstreamHosts.length;
    const out = await broker("/groq/audio/transcriptions", form.body, form.type);
    const sent = upstreamHosts.slice(before);
    const ok = out.status === 200 && sent.includes("api.groq.com");
    if (!ok) failures += 1;
    results.voice = { route: "/api/model/groq/audio/transcriptions", brokerStatus: out.status, upstreamHosts: sent, bodyBytes: form.body.length, ok, response: out.body.slice(0, 80) };
  } else {
    results.voice = { run: false, diagnosis: describeCredentialState(report) };
  }
}

// Anthropic: the broker must refuse, and nothing may reach Anthropic.
{
  const before = upstreamHosts.length;
  const out = await broker("/anthropic/messages", Buffer.from(JSON.stringify({ model: "x", max_tokens: 1, messages: [] })), "application/json");
  const reached = upstreamHosts.slice(before).filter((host) => host.includes("anthropic"));
  const ok = out.status !== 200 && reached.length === 0;
  if (!ok) failures += 1;
  results.anthropic = { brokerStatus: out.status, requestsReachingAnthropic: reached.length, ok };
}

results.allUpstreamHosts = [...new Set(upstreamHosts)];

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const [key, value] of Object.entries(results)) console.log(`${key}: ${JSON.stringify(value)}`);
  console.log(failures === 0 ? "OK" : `${failures} CHECK(S) FAILED`);
}
process.exit(failures === 0 ? 0 : 1);
