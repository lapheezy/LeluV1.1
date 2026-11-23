/**
 * LÉLU — LIVE PERSONALITY VALIDATION (WP08)
 *
 * The 2.0 suite proved the machinery. This proves the OUTPUT.
 *
 * Every turn here goes through the SAME production entry point
 * GenesisChat uses — AIService.getInstance().chat() — with the
 * real provider chain, the real memory bridge and the real
 * post-generation transformation. Nothing is simulated:
 *
 *   • the directive each provider actually received is captured
 *     by tapping the provider's own generate(), so "the voice
 *     reached the model" is observed rather than assumed;
 *   • the VOICE stage of the cognitive trace is recorded;
 *   • raw provider text is kept where a direct call is used
 *     (--parity), so raw and transformed output can be compared;
 *   • every turn is evaluated against the personality spec and
 *     the drift guard.
 *
 * Verification level: pipeline (Node → real provider HTTP).
 * NOT browser-tested, NOT device-tested. The report says so.
 *
 * Run:
 *   npx tsx scripts/voice-live.ts            # canonical chain
 *   npx tsx scripts/voice-live.ts --parity   # same input, two engines
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* ------------------------- browser shims (Node) ------------------------- */
const databases = new Map<string, Map<string, Map<string, unknown>>>();
class ShimRequest {
  result: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  settle(): void {
    queueMicrotask(() => this.onsuccess?.());
  }
}
class ShimObjectStore {
  constructor(private readonly rows: Map<string, unknown>) {}
  put(value: unknown): void {
    const record = value as { id: string };
    this.rows.set(record.id, structuredClone(value));
  }
  delete(id: string): void {
    this.rows.delete(id);
  }
  clear(): void {
    this.rows.clear();
  }
  get(id: string): ShimRequest {
    const req = new ShimRequest();
    req.result = this.rows.has(id) ? structuredClone(this.rows.get(id)) : null;
    req.settle();
    return req;
  }
  getAll(): ShimRequest {
    const req = new ShimRequest();
    req.result = [...this.rows.values()].map((value) => structuredClone(value));
    req.settle();
    return req;
  }
}
class ShimTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly stores: Map<string, ShimObjectStore>;
  constructor(db: ShimDatabase, storeName: string) {
    this.stores = new Map([[storeName, new ShimObjectStore(db.store(storeName))]]);
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name: string): ShimObjectStore {
    return this.stores.get(name)!;
  }
}
class ShimDatabase {
  onversionchange: (() => void) | null = null;
  constructor(private readonly name: string) {}
  store(storeName: string): Map<string, unknown> {
    const db = databases.get(this.name)!;
    if (!db.has(storeName)) db.set(storeName, new Map());
    return db.get(storeName)!;
  }
  get objectStoreNames() {
    return { contains: (name: string) => databases.get(this.name)!.has(name) };
  }
  createObjectStore(storeName: string): void {
    databases.get(this.name)!.set(storeName, new Map());
  }
  transaction(storeName: string): ShimTransaction {
    return new ShimTransaction(this, storeName);
  }
  close(): void {}
}
// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string): ShimRequest {
    if (!databases.has(name)) databases.set(name, new Map());
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};
class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
}
// @ts-expect-error — global shim for Node
globalThis.window = {
  localStorage: new FakeStorage(),
  sessionStorage: new FakeStorage(),
  name: "",
  // OpenRouter's request headers read window.location.origin; without it the
  // real Node path fails before the request is sent (observed live).
  location: { origin: "http://localhost:3000" },
};

/* ------------------------------ scenario set ---------------------------- */

interface Scenario {
  id: string;
  group: string;
  prompt: string;
  conversationId: string;
  /** Seed a familiar relationship before this turn (stated in the record). */
  seedFamiliar?: boolean;
}

const SCENARIOS: Scenario[] = [
  { id: "01-unfamiliar", group: "unfamiliar user", prompt: "first time here — what are you, exactly?", conversationId: "voice-new" },
  { id: "02-casual", group: "casual", prompt: "hey, how's it going?", conversationId: "voice-a" },
  { id: "03-slang", group: "slang", prompt: "ngl this build is mid, no cap", conversationId: "voice-a" },
  { id: "04-humor", group: "humour", prompt: "tell me a joke about my sleep schedule lol", conversationId: "voice-a" },
  { id: "05-sarcasm", group: "sarcasm", prompt: "oh great, another monday build. brilliant.", conversationId: "voice-a" },
  { id: "06-excitement", group: "excitement", prompt: "shipped the avatar finally!! it works", conversationId: "voice-a" },
  { id: "07-technical", group: "technical", prompt: "this effect fires twice and the type is wrong\n```ts\nuseEffect(() => { load(id) }, [id])\n```\nany idea why?", conversationId: "voice-b" },
  { id: "08-frustration", group: "frustration", prompt: "it still doesn't work. third time. i already told you the error.", conversationId: "voice-b" },
  { id: "09-serious", group: "serious", prompt: "be straight with me: is this architecture going to hold at scale?", conversationId: "voice-c" },
  { id: "10-creative", group: "creative", prompt: "brainstorm names for a memory feature that forgets on purpose", conversationId: "voice-c" },
  { id: "11-disagreement", group: "disagreement", prompt: "no, i disagree — React is always better than Vue", conversationId: "voice-c" },
  { id: "12-emotional-support", group: "emotional support", prompt: "my dad died last month and i can't focus on anything", conversationId: "voice-d" },
  { id: "13-ambiguous", group: "ambiguous context", prompt: "can you fix it?", conversationId: "voice-b" },
  { id: "14-correction", group: "correction", prompt: "no, i meant the other one — the avatar face, not the body", conversationId: "voice-a" },
  { id: "15-continuity", group: "long-running continuity", prompt: "like we discussed, ship the smaller version first?", conversationId: "voice-a" },
  { id: "16-memory", group: "memory retrieval", prompt: "what did i say about the avatar work earlier?", conversationId: "voice-a" },
  { id: "17-familiar", group: "familiar user", prompt: "alright, where were we?", conversationId: "voice-a", seedFamiliar: true },
  { id: "18-provider-switch", group: "provider switching", prompt: "summarise where we are with the avatar work", conversationId: "voice-a" },
];

const PARITY_SCENARIOS = [
  { id: "p1-casual", prompt: "hey, how's it going?" },
  { id: "p2-frustration", prompt: "it still doesn't work. third time." },
  { id: "p3-disagreement", prompt: "no, i disagree — React is always better than Vue" },
  { id: "p4-support", prompt: "my dad died last month and i can't focus on anything" },
];

/* ------------------------------- main ---------------------------------- */

async function main(): Promise<void> {
  // Numbered credentials are what this deployment holds; alias them for
  // providers whose direct path reads the base name. Values are never printed.
  if (!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY_1) {
    process.env.GROQ_API_KEY = process.env.GROQ_API_KEY_1;
  }
  if (!process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY_1) {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY_1;
  }
  process.env.LELU_CHAIN_BUDGET_MS ??= "60000";
  process.env.LELU_PROVIDER_RUNG_BUDGET_MS ??= "40000";

  const parity = process.argv.includes("--parity");

  const AIService = (await import("../src/core/AIService")).default;
  const CognitiveTrace = (await import("../src/core/cognition/CognitiveTrace")).default;
  const LinguisticProfile = (await import("../src/core/identity/voice/LinguisticProfile")).default;
  const { composeVoice, voiceSignature } = await import("../src/core/identity/voice/VoiceComposer");
  const { checkReply } = await import("../src/core/identity/voice/VoiceDriftGuard");
  const { evaluateSpec } = await import("../src/core/identity/voice/PersonalitySpec");
  const { stripChatbotisms, findChatbotisms } = await import("../src/core/identity/voice/ChatbotismFilter");

  const profile = LinguisticProfile.getInstance();
  const signatureBefore = voiceSignature();
  const startedAt = new Date().toISOString();
  const outputDir = join(process.cwd(), "artifacts");
  mkdirSync(outputDir, { recursive: true });

  if (parity) {
    await runParity({ composeVoice, checkReply, evaluateSpec, stripChatbotisms, findChatbotisms, outputDir, startedAt, profile });
    return;
  }

  const Groq = (await import("../src/providers/GroqProvider")).default;
  const OpenRouter = (await import("../src/providers/OpenRouterProvider")).default;
  const Gemini = (await import("../src/providers/GeminiProvider")).default;
  const Anthropic = (await import("../src/providers/AnthropicProvider")).default;
  const Cerebras = (await import("../src/providers/CerebrasProvider")).default;
  const Mistral = (await import("../src/providers/MistralProvider")).default;
  const Fireworks = (await import("../src/providers/FireworksProvider")).default;
  const GitHubModels = (await import("../src/providers/GitHubModelsProvider")).default;

  interface Capture {
    provider: string;
    prompt: string;
    hasVoice: boolean;
    voice: string;
    systemPromptChars: number;
  }
  const captures: Capture[] = [];

  const PROMPT_BUILDERS: Array<[string, { prototype: Record<string, unknown> }]> = [
    ["Groq", Groq],
    ["OpenRouter", OpenRouter],
    ["Gemini", Gemini],
    ["Anthropic", Anthropic],
    ["Cerebras", Cerebras],
    ["Mistral", Mistral],
    ["Fireworks", Fireworks],
    ["GitHub Models", GitHubModels],
  ];

  for (const [label, ctor] of PROMPT_BUILDERS) {
    const proto = ctor.prototype as unknown as {
      generate: (request: { prompt: string; voice?: string }) => Promise<unknown>;
    };
    const original = proto.generate;
    if (typeof original !== "function") continue;
    proto.generate = async function patched(this: unknown, request: { prompt: string; voice?: string }) {
      captures.push({
        provider: label,
        prompt: request.prompt,
        hasVoice: typeof request.voice === "string" && request.voice.length > 0,
        voice: request.voice ?? "",
        systemPromptChars: request.voice?.length ?? 0,
      });
      return original.call(this, request);
    };
  }

  const ai = AIService.getInstance();
  await ai.initialize();
  CognitiveTrace.getInstance().setEnabled(true);
  CognitiveTrace.getInstance().clear();

  const results: Array<Record<string, unknown>> = [];
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex >= 0 ? (process.argv[onlyIndex + 1] ?? "") : "";
  const selected = only.length > 0 ? SCENARIOS.filter((scenario) => scenario.id.includes(only)) : SCENARIOS;

  for (const [index, scenario] of selected.entries()) {
    if (scenario.seedFamiliar) {
      // A familiar-user scenario needs a relationship to read from. This is
      // SEEDED, not earned, and is labelled as seeded in the record.
      const state = profile.snapshot();
      const now = Date.now();
      state.familiarity = {
        firstContactAt: now - 40 * 86_400_000,
        lastContactAt: now,
        interactions: 140,
        activeDays: Array.from({ length: 40 }, (_, day) => new Date(now - day * 86_400_000).toISOString().slice(0, 10)),
        banterTurns: 18,
        corrections: 3,
        sharedReferences: ["avatar face", "smaller version first", "memory bands", "build pipeline", "sleep schedule"],
      };
      profile.hydrate(state);
    }

    const directivePreview = composeVoice({ prompt: scenario.prompt });
    const before = captures.length;
    const clock = Date.now();
    let response: { text: string; provider: string; model: string; metadata?: Record<string, unknown> } | null = null;
    let error = "";
    try {
      response = await Promise.race([
        ai.chat(scenario.prompt, undefined, undefined, { conversationId: scenario.conversationId }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("turn exceeded 90s")), 90_000)),
      ]);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const elapsed = Date.now() - clock;

    const turnCaptures = captures.slice(before);
    const matched = turnCaptures.filter((capture) => capture.prompt === scenario.prompt);
    const matchedCapture = matched[matched.length - 1];

    const text = response?.text ?? "";
    const turn = CognitiveTrace.getInstance().lastTurn();
    const voiceEntry = turn?.entries.find((entry) => entry.stage === "VOICE");

    const spec = text ? evaluateSpec(stripChatbotisms(text).text) : null;
    const drift = text
      ? checkReply({
          reply: text,
          recentReplies: turnCaptures.map(() => "").filter(Boolean),
          provider: response?.provider,
        })
      : [];

    const status = error
      ? "error"
      : matched.length === 0
        ? "no-model-call"
        : /no ai provider|all providers|offline/i.test(text) && text.length < 400
          ? "offline"
          : "answered";

    results.push({
      index: index + 1,
      id: scenario.id,
      group: scenario.group,
      conversationId: scenario.conversationId,
      prompt: scenario.prompt,
      seededFamiliarity: Boolean(scenario.seedFamiliar),
      status,
      error: error || undefined,
      ms: elapsed,
      provider: response?.provider ?? null,
      model: response?.model ?? null,
      providerCalls: matched.length,
      providersTouched: turnCaptures.map((capture) => capture.provider),
      voiceAttached: matchedCapture?.hasVoice ?? false,
      voiceDirectiveChars: matchedCapture?.voice.length ?? 0,
      voiceDirective: matchedCapture?.voice ?? null,
      composedStance: {
        register: directivePreview.stance.register,
        length: directivePreview.stance.length,
        humor: directivePreview.stance.humor,
        challenge: directivePreview.stance.challenge,
        followUp: directivePreview.stance.followUp,
        emotion: directivePreview.appraisal.primary,
        mode: directivePreview.appraisal.mode,
        guarded: directivePreview.appraisal.guarded,
      },
      traceVoice: voiceEntry
        ? { detail: voiceEntry.detail, data: voiceEntry.data }
        : null,
      text,
      spec: spec
        ? { score: spec.score, passed: spec.passed, scored: spec.scored, checks: spec.checks }
        : null,
      drift,
      chatbotismsRemoved: (response?.metadata?.chatbotismsRemoved as string[] | undefined) ?? [],
      voiceExpressionsUsed: (response?.metadata?.voiceExpressionsUsed as string[] | undefined) ?? [],
      metadataVoiceProvider: (response?.metadata?.voiceProvider as string | undefined) ?? null,
    });

    const row = results[results.length - 1];
    console.log(
      `[${String(index + 1).padStart(2, "0")}/${selected.length}] ${String(scenario.id).padEnd(22)} ${status.padEnd(13)} ` +
        `${String(row.provider ?? "—").padEnd(12)} ${String(elapsed).padStart(6)}ms ` +
        `voice=${row.voiceDirectiveChars}c spec=${spec?.score ?? "—"} ` +
        `boilerplate=${text ? findChatbotisms(text).length : "—"} drift=${drift.length}`,
    );
    if (text) console.log(`      «${text.replace(/\s+/g, " ").slice(0, 220)}${text.length > 220 ? "…" : ""}»`);
    if (error) console.log(`      ERROR: ${error}`);
  }

  const answered = results.filter((row) => row.status === "answered");
  const providerSet = new Set(answered.map((row) => row.provider));
  const signatures = voiceSignature();

  const report = {
    mission: "Personality Evolution 2.1 — live validation",
    verificationLevel: "pipeline (Node → real provider HTTP via AIService.chat). Not browser-tested, not device-tested.",
    startedAt,
    finishedAt: new Date().toISOString(),
    modelTurnsAnswered: answered.length,
    scenariosRun: results.length,
    providersAnswered: [...providerSet],
    voiceSignatureBefore: signatureBefore,
    voiceSignatureAfter: signatures,
    profileDigest: profile.digest(),
    timings: {
      totalMs: results.reduce((sum, row) => sum + Number(row.ms ?? 0), 0),
      meanMs: Math.round(results.reduce((sum, row) => sum + Number(row.ms ?? 0), 0) / Math.max(1, results.length)),
    },
    results,
  };

  const jsonPath = join(outputDir, `voice-live-${startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nAnswered by a real model: ${answered.length}/${results.length}`);
  console.log(`Providers: ${[...providerSet].join(", ") || "(none)"}`);
  console.log(`Voice signature stable: ${signatureBefore === signatures ? "yes" : "NO"}`);
  console.log(`Evidence: ${jsonPath}`);
  process.exit(answered.length > 0 ? 0 : 1);
}

/* ------------------------------- parity -------------------------------- */

async function runParity(deps: {
  composeVoice: (input: { prompt: string }) => { text: string };
  checkReply: (input: { reply: string; provider?: string }) => unknown[];
  evaluateSpec: (text: string) => { score: number };
  stripChatbotisms: (text: string) => { text: string; removed: string[] };
  findChatbotisms: (text: string) => RegExpMatchArray[] | string[];
  outputDir: string;
  startedAt: string;
  profile: { digest: () => string };
}): Promise<void> {
  const GroqProvider = (await import("../src/providers/GroqProvider")).default;
  const OpenRouterProvider = (await import("../src/providers/OpenRouterProvider")).default;

  const engines = [
    { id: "groq", label: "Groq", provider: new GroqProvider() },
    { id: "openrouter", label: "OpenRouter", provider: new OpenRouterProvider() },
  ];

  for (const engine of engines) await engine.provider.initialize();

  const rows: Array<Record<string, unknown>> = [];
  for (const scenario of PARITY_SCENARIOS) {
    const voice = deps.composeVoice({ prompt: scenario.prompt }).text;
    for (const engine of engines) {
      const available = await engine.provider.isAvailable();
      if (!available) {
        rows.push({ scenario: scenario.id, engine: engine.label, available: false });
        continue;
      }
      const clock = Date.now();
      try {
        const response = await engine.provider.generate({
          prompt: scenario.prompt,
          messages: [{ role: "user", content: scenario.prompt }],
          voice,
          maxTokens: 400,
          temperature: 0.7,
        });
        const cleaned = deps.stripChatbotisms(response.text);
        rows.push({
          scenario: scenario.id,
          engine: engine.label,
          available: true,
          model: response.model,
          ms: Date.now() - clock,
          raw: response.text,
          transformed: cleaned.text,
          removed: cleaned.removed,
          boilerplateBefore: deps.findChatbotisms(response.text).length,
          boilerplateAfter: deps.findChatbotisms(cleaned.text).length,
          spec: deps.evaluateSpec(cleaned.text),
          drift: deps.checkReply({ reply: cleaned.text, provider: engine.label }),
          /** Proof the SAME directive reached both engines. */
          directiveChars: voice.length,
          directiveIncludesStance: voice.includes("This turn reads as:"),
        });
        console.log(
          `[parity] ${scenario.id} · ${engine.label} · ${Date.now() - clock}ms · ` +
            `boilerplate ${deps.findChatbotisms(response.text).length}→${deps.findChatbotisms(cleaned.text).length}`,
        );
        console.log(`  «${cleaned.text.replace(/\s+/g, " ").slice(0, 200)}»`);
      } catch (error) {
        rows.push({
          scenario: scenario.id,
          engine: engine.label,
          available: true,
          error: error instanceof Error ? error.message : String(error),
        });
        console.log(`[parity] ${scenario.id} · ${engine.label} · ERROR ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  const path = join(deps.outputDir, `voice-parity-${deps.startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        mission: "Personality Evolution 2.1 — provider parity",
        verificationLevel: "provider API (direct provider.generate with the canonical voice directive)",
        startedAt: deps.startedAt,
        profileDigest: deps.profile.digest(),
        rows,
      },
      null,
      2,
    ),
  );
  const answered = rows.filter((row) => typeof row.transformed === "string").length;
  console.log(`\nParity turns answered: ${answered}/${rows.length}`);
  console.log(`Evidence: ${path}`);
  process.exit(answered > 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Live validation crashed:", error);
  process.exit(1);
});
