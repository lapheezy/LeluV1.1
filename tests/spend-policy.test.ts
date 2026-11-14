/**
 * GLOBAL SPENDING POLICY — zero paid use without the user's explicit,
 * scoped authorization, enforced on the server for every caller.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CONSENT_HEADER,
  costOf,
  createSpendApi,
  createSpendPolicy,
  parseSpendConsent,
  setSpendPolicyForTests,
} from "../plugins/spendPolicy";
import { createModelApi } from "../plugins/modelApi";

const fresh = (now?: () => number) => createSpendPolicy({ stateDir: mkdtempSync(path.join(tmpdir(), "spend-")), read: () => undefined, now });

/** Drive the broker like the page does; returns status, body and how many upstream calls left the server. */
async function broker(env: Record<string, string>, url: string, body: Record<string, unknown>, upstream: (key: string) => Response) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    calls += 1;
    const auth = String((init.headers as Record<string, string>).Authorization ?? (init.headers as Record<string, string>)["x-api-key"] ?? "");
    return upstream(auth);
  }) as typeof fetch;
  try {
    let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
    createModelApi((n) => env[n]).attach({ use: (_p, fn) => (handler = fn as never) });
    const out = { status: 200, body: "" };
    await new Promise<void>((resolve) => {
      const res = { set statusCode(v: number) { out.status = v; }, get statusCode() { return out.status; }, setHeader: () => undefined,
        write: (c: unknown) => { out.body += String(c); return true; }, end: (b?: unknown) => { if (b !== undefined) out.body += typeof b === "string" ? b : Buffer.from(b as Uint8Array).toString(); resolve(); },
        on: () => undefined, writableFinished: false, flushHeaders: () => undefined };
      const raw = JSON.stringify(body);
      handler!({ method: "POST", url, headers: { "content-type": "application/json" },
        on: (e: string, fn: (c?: unknown) => void) => { if (e === "data") fn(Buffer.from(raw)); if (e === "end") fn(); } }, res, () => resolve());
    });
    return { ...out, calls };
  } finally {
    globalThis.fetch = real;
  }
}
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { cost: 0.0012 } }), { status: 200, headers: { "content-type": "application/json" } });

test("cost classification: free tiers and $0 models are free; everything else, including unknown, is paid", () => {
  assert.equal(costOf("groq").cost, "free");
  assert.equal(costOf("cerebras").cost, "free");
  assert.equal(costOf("firecrawl").cost, "free");
  assert.equal(costOf("openrouter", { model: "nvidia/nemotron-3-ultra-550b-a55b:free" }).cost, "free");
  assert.equal(costOf("openrouter", { model: "openai/gpt-4o-mini" }).cost, "paid");
  for (const s of ["anthropic", "fireworks", "elevenlabs", "meshy", "mistral", "gemini", "some-new-service"]) assert.equal(costOf(s).cost, "paid", s);
});

test("a paid provider is refused without authorization and nothing leaves the server", async () => {
  setSpendPolicyForTests(fresh());
  try {
    const out = await broker({ ANTHROPIC_API_KEY: "sk-ant-x", LELU_ENABLE_ANTHROPIC: "true" }, "/anthropic/messages", { model: "claude-x", max_tokens: 10, messages: [] }, ok);
    assert.equal(out.status, 402);
    assert.match(out.body, /spend_not_authorized/);
    assert.equal(out.calls, 0, "no upstream request was made");
    const paidRouter = await broker({ OPENROUTER_API_KEY: "sk-or-x" }, "/openrouter/chat/completions", { model: "openai/gpt-4o-mini", messages: [] }, ok);
    assert.equal(paidRouter.status, 402);
    assert.equal(paidRouter.calls, 0);
    const freeRouter = await broker({ OPENROUTER_API_KEY: "sk-or-x" }, "/openrouter/chat/completions", { model: "nvidia/nemotron-3-ultra-550b-a55b:free", messages: [] }, ok);
    assert.equal(freeRouter.status, 200, "a $0 model stays usable");
  } finally {
    setSpendPolicyForTests(null);
  }
});

test("when free capacity is exhausted, the paid fallback is still refused (no silent crossing into paid)", async () => {
  setSpendPolicyForTests(fresh());
  try {
    const groq = await broker({ GROQ_API_KEY: "gsk_a" }, "/groq/chat/completions", { model: "openai/gpt-oss-120b", messages: [] },
      () => new Response(JSON.stringify({ error: { message: "tokens per day (TPD) spent. Please try again in 35m2s." } }), { status: 429, headers: { "content-type": "application/json" } }));
    assert.equal(groq.status, 429, "the free provider reports its real exhaustion");
    const fallback = await broker({ FIREWORKS_API_KEY: "fw" }, "/fireworks/chat/completions", { model: "accounts/fireworks/models/x", messages: [] }, ok);
    assert.equal(fallback.status, 402);
    assert.equal(fallback.calls, 0);
  } finally {
    setSpendPolicyForTests(null);
  }
});

test("an authorization applies only to its scope: service, model, expiry, request cap and ceiling", () => {
  let t = 1_000_000;
  const policy = fresh(() => t);
  const grant = policy.authorize({ service: "anthropic", model: "claude-a", maxRequests: 2, ttlMs: 60 * 60_000, consent: "typed: I authorize Anthropic" });
  assert.equal(policy.check("anthropic", { model: "claude-a" }).allowed, true);
  assert.equal(policy.check("anthropic", { model: "claude-b" }).allowed, false, "another model");
  assert.equal(policy.check("openrouter", { model: "openai/gpt-4o-mini" }).allowed, false, "another provider");
  policy.consume(grant.id);
  policy.consume(grant.id);
  const spent = policy.check("anthropic", { model: "claude-a" });
  assert.equal(spent.allowed, false);
  assert.equal(spent.code, "grant_exhausted");
  const second = policy.authorize({ service: "fireworks", ttlMs: 60_000, consent: "typed: I authorize Fireworks" });
  assert.equal(policy.check("fireworks").allowed, true);
  t += 2 * 60_000;
  assert.equal(policy.check("fireworks").allowed, false, "expired");
  assert.ok(second.expiresAt - second.createdAt <= 24 * 3600_000, "never open-ended");
  // A USD ceiling is enforced where the provider reports cost.
  const capped = policy.authorize({ service: "openrouter", maxUsd: 0.01, consent: "typed: up to $0.01" });
  policy.consume(capped.id, { usd: 0.011 });
  assert.equal(policy.check("openrouter", { model: "openai/gpt-4o-mini" }).allowed, false);
});

test("the user's words: explicit authorization is required; negations and vague text are not consent", () => {
  assert.deepEqual(parseSpendConsent("I authorize Anthropic up to $2 for this job"), { kind: "authorize", service: "anthropic", maxUsd: 2, ttlMs: 2 * 3600_000 });
  assert.equal((parseSpendConsent("You can use OpenRouter paid capacity for 3 hours, 20 requests") as { maxRequests: number }).maxRequests, 20);
  assert.equal(parseSpendConsent("Don't use paid Anthropic, I authorize nothing"), null);
  assert.equal(parseSpendConsent("Anthropic seems good"), null, "naming a provider is not consent");
  assert.equal(parseSpendConsent("I authorize it"), null, "no named service");
  assert.deepEqual(parseSpendConsent("Stop all paid usage now"), { kind: "revoke" });
});

test("consent is accepted only from typed/spoken user input; agents and other origins cannot mint grants", async () => {
  const policy = fresh();
  const api = createSpendApi(() => policy);
  const post = (headers: Record<string, string>, text: string) =>
    new Promise<{ status: number; body: any }>((resolve) => {
      const res: any = { statusCode: 200, setHeader() {}, end(b: string) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
      api.handle({ method: "POST", url: "/api/spend/consent", headers, on: (e, fn) => { if (e === "data") fn(JSON.stringify({ text })); if (e === "end") fn(); } }, res, () => resolve({ status: 404, body: {} }));
    });
  assert.equal((await post({}, "I authorize Anthropic up to $5")).status, 403, "no consent marker");
  assert.equal((await post({ [CONSENT_HEADER]: "agent" }, "I authorize Anthropic up to $5")).status, 403, "an agent origin");
  assert.equal((await post({ [CONSENT_HEADER]: "typed", origin: "https://evil.example", host: "lelu.app" }, "I authorize Anthropic")).status, 403, "cross-origin");
  assert.equal(policy.grants().length, 0);
  const granted = await post({ [CONSENT_HEADER]: "typed" }, "I authorize Anthropic up to $5 for this job");
  assert.equal(granted.body.granted.service, "anthropic");
  assert.equal(policy.grants().length, 1);
});

test("only the composer and spoken input can send consent; no agent, tool or background module can", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk("src");
  const senders = files.filter((f) => /captureSpendConsent\(|\/api\/spend\/consent|x-lelu-user-consent/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/\\/g, "/")).sort();
  // CapabilityLedgerClient sends the user's own words for capability approval
  // and revocation (same rule, same two callers — checked just below).
  assert.deepEqual(senders, ["src/app/scene/genesis/GenesisChat.tsx", "src/core/acquisition/CapabilityLedgerClient.ts", "src/core/spend/SpendConsent.ts", "src/core/voice/VoiceEngine.ts"]);
  const deciders = files.filter((f) => /captureCapabilityDecision\(/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/\\/g, "/")).sort();
  assert.deepEqual(deciders, ["src/app/scene/genesis/GenesisChat.tsx", "src/core/acquisition/CapabilityLedgerClient.ts", "src/core/voice/VoiceEngine.ts"]);
});

test("Meshy (paid 3D generation) cannot be approved without authorization — not even by the model's forge.approve tool", async () => {
  setSpendPolicyForTests(fresh());
  const real = globalThis.fetch;
  let upstream = 0;
  globalThis.fetch = (async () => { upstream += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    const { createMeshyForgeApi } = await import("../plugins/meshyForgeApi");
    const api = createMeshyForgeApi((n) => (n === "MESHY_API_KEY" ? "msy_x" : undefined), { assetRoot: mkdtempSync(path.join(tmpdir(), "forge-")), poll: false });
    let handler: any = null;
    api.attach({ use: (_p: string, fn: unknown) => (handler = fn) });
    const call = (url: string, body: unknown) => new Promise<{ status: number; body: any }>((resolve) => {
      const res: any = { statusCode: 200, setHeader() {}, end(b: string) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
      const raw = JSON.stringify(body);
      handler({ method: "POST", url, headers: { "content-type": "application/json" }, on: (e: string, fn: (c?: unknown) => void) => { if (e === "data") fn(Buffer.from(raw)); if (e === "end") fn(); } }, res, () => resolve({ status: 404, body: {} }));
    });
    const approve = await call("/api/forge/jobs/job_1/approve", {});
    assert.equal(approve.status, 402);
    assert.equal(approve.body.code, "spend_not_authorized");
    const submit = await call("/api/forge/jobs", { character: "x", kind: "image-to-3d", body: {}, approve: true });
    assert.equal(submit.status, 402);
    assert.equal(upstream, 0, "nothing was sent to Meshy");
  } finally {
    globalThis.fetch = real;
    setSpendPolicyForTests(null);
  }
});

test("ElevenLabs is reported unavailable without authorization, so voice uses the free local worker", async () => {
  setSpendPolicyForTests(fresh());
  const savedKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "el_test_key";
  try {
    const { createVoiceApi } = await import("../plugins/voiceApi");
    const api = (createVoiceApi as any)((n: string) => (n === "ELEVENLABS_API_KEY" ? "el_test_key_123456" : undefined));
    const routes: Record<string, any> = {};
    (api.attach ?? api.configureServer)?.call(api, { use: (p: string, fn: unknown) => (routes[p] = fn) });
    const status = await new Promise<any>((resolve) => {
      const res: any = { statusCode: 200, setHeader() {}, end(b: string) { resolve(JSON.parse(b)); } };
      routes["/api/voice/status"]({ method: "GET", url: "/" }, res, () => resolve(null));
    });
    assert.equal(status.configured, false, "a key alone does not make a paid voice usable");
    assert.equal(status.spend, "spend_not_authorized");
  } finally {
    if (savedKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = savedKey;
    setSpendPolicyForTests(null);
  }
});
