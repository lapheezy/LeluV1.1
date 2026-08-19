/**
 * LÉLU cognitive integration verification — acceptance tests A–H.
 *
 * Exercises the REAL Brain → PatternMemory → MemoryEngine →
 * MemorySynthesizer → AIRouter → EngineeringResolver →
 * ResearchResolver → ProviderResolver stack in Node, with:
 *   - an in-memory IndexedDB shim (persistent across "restarts")
 *   - a stubbed fetch for the knowledge providers
 *   - NO AI API keys (every provider is honestly unavailable, so
 *     the offline/fallback paths are the ones exercised)
 *
 * Run: bun run scripts/verify-cognition.ts
 */

// ---------------------------------------------------------------
// Minimal in-memory IndexedDB shim (same as verify-offline-brain).
// ---------------------------------------------------------------
const databases = new Map<string, Map<string, Map<string, unknown>>>();

class ShimRequest {
  result: unknown = null;
  error: Error | null = null;
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
    req.result = [...this.rows.values()].map((v) => structuredClone(v));
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
    if (!db.has(storeName)) {
      db.set(storeName, new Map());
    }
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
  close(): void {
    /* no-op */
  }
}

// @ts-expect-error — global shim for Node
globalThis.indexedDB = {
  open(name: string, _version?: number): ShimRequest {
    if (!databases.has(name)) {
      databases.set(name, new Map());
    }
    const req = new ShimRequest();
    const db = new ShimDatabase(name);
    req.result = db;
    queueMicrotask(() => {
      if (!db.objectStoreNames.contains("memories")) {
        req.onupgradeneeded?.();
      }
      req.onsuccess?.();
    });
    return req;
  },
};

// ---------------------------------------------------------------
// Stubbed fetch: knowledge providers get deterministic data.
// ---------------------------------------------------------------
function stubKnowledgeFetch() {
  const original = globalThis.fetch;

  // @ts-expect-error — test stub
  globalThis.fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("gdeltproject.org")) {
      return json({
        articles: [
          {
            title: "Tampa Bay waterfront development plan announced",
            seendate: "20260813T120000Z",
            url: "https://example.com/tampa-bay-development",
            sourcecountry: "United States",
          },
        ],
      });
    }

    if (url.includes("hn.algolia.com")) {
      return json({ hits: [] });
    }

    if (url.includes("wikipedia.org/api/rest_v1/page/summary/")) {
      return json({
        pageid: 123,
        title: "Tampa",
        extract: "Tampa is a city on the Gulf Coast of Florida, United States.",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Tampa" } },
      });
    }

    if (url.includes("geocoding-api.open-meteo.com")) {
      return json({ results: [{ name: "Tampa", latitude: 27.95, longitude: -82.46, country: "United States" }] });
    }

    if (url.includes("api.open-meteo.com/v1/forecast")) {
      return json({ current: { temperature_2m: 31.2, weather_code: 1 } });
    }

    throw new Error(`Unstubbed fetch in verification: ${url.slice(0, 120)}`);
  };

  return () => {
    globalThis.fetch = original;
  };
}

// ---------------------------------------------------------------
// Now the REAL app code.
// ---------------------------------------------------------------
import Brain from "../src/brain/Brain";
import AIService from "../src/core/AIService";
import type ResponsePattern from "../src/brain/ResponsePattern";

let failures = 0;
const results: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    results.push(`  ✓ ${label}`);
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    results.push(`  ✗ ${label}`);
    console.error(`  ✗ ${label}`);
  }
}

async function section(title: string): Promise<void> {
  console.log(`\n== ${title} ==`);
}

function patterns(brain: Brain): Promise<ResponsePattern[]> {
  return brain.recallAll();
}

async function runUnitTests(): Promise<void> {
  const brain = new Brain();
  await brain.initialize();

  // ---- TEST A: relevance ----------------------------------------
  await section("TEST A — RELEVANCE (memory informs, does not dump)");
  await brain.learn("My name is Alex", "ok", "conversation", [], { source: "test" });
  await brain.learn("I love retro space games", "ok", "conversation", [], { source: "test" });
  await brain.learn("I am building a space exploration app", "ok", "conversation", [], { source: "test" });

  const recalled = await brain.recall("What am I building?");
  const relevant = recalled.some((m) => /space exploration/i.test(m.response));
  const polluted = recalled.some((m) => /retro space games/i.test(m.response));
  assert(relevant, "recall surfaces the relevant project memory");
  assert(!polluted, "recall does not surface unrelated preference memory");

  const ctx = brain.synthesizeContext("What am I building?", recalled);
  assert(/space exploration/i.test(ctx.context), "cognitive context includes the relevant fact");
  assert(!/retro space games/i.test(ctx.context), "cognitive context excludes the irrelevant fact");

  // ---- TEST B: synthesis -----------------------------------------
  await section("TEST B — SYNTHESIS (related facts become understanding)");
  await brain.learn("I know React and TypeScript", "ok", "conversation", [], { source: "test" });

  const recalledB = await brain.recall("Tell me about my space exploration project and my TypeScript skills");
  assert(recalledB.length >= 2, `recalls both related memories (${recalledB.length})`);

  const ctxB = brain.synthesizeContext("Tell me about my space exploration project and my TypeScript skills", recalledB);
  assert(/space exploration/i.test(ctxB.context), "synthesis includes the project fact");
  assert(/react/i.test(ctxB.context), "synthesis includes the skill fact");
  assert(/Connections/.test(ctxB.context), "synthesis derives a cross-memory connection note");

  // ---- TEST C: detail control ------------------------------------
  await section("TEST C — DETAIL CONTROL (progressive disclosure)");
  const projects = [
    "I am building a space exploration app",
    "I am building a finance tracker",
    "I am building a recipe manager",
    "I am building a fitness coach",
    "I am building a music visualizer",
    "I am building a travel planner",
    "I am building a book tracker",
    "I am building a habit builder",
  ];
  for (const project of projects) {
    await brain.learn(project, "ok", "conversation", [], { source: "test" });
  }

  const allProjectMemories = await brain.recall("my projects");
  assert(allProjectMemories.length >= 7, `stores distinct projects (${allProjectMemories.length})`);

  const broad = brain.synthesizeContext("Tell me about my projects", allProjectMemories);
  const deep = brain.synthesizeContext("Tell me everything you remember about my projects", allProjectMemories);
  assert(broad.used.length <= 6, `broad question uses minimum sufficient subset (${broad.used.length})`);
  assert(deep.used.length > 6, `deep request surfaces more detail (${deep.used.length})`);
  assert(deep.context.length > broad.context.length, "deep context is richer than the default");

  // ---- TEST E: memory update / correction -------------------------
  await section("TEST E — MEMORY UPDATE (corrections supersede)");
  await brain.learn("I love coffee", "ok", "conversation", [], { source: "test" });
  await brain.learn("Actually I no longer like coffee, I prefer tea", "ok", "conversation", [], { source: "test" });

  const coffeeRecall = await brain.recall("coffee");
  const coffeeMemory = coffeeRecall.find((m) => m.category === "preference");
  assert(Boolean(coffeeMemory), "preference memory still findable after correction");
  assert(/tea/i.test(coffeeMemory?.response ?? ""), "newer statement wins (coffee → tea)");
  assert(!/love coffee/i.test(coffeeMemory?.response ?? ""), "obsolete version is not the active answer");
  const history = (coffeeMemory?.context?.history as string[] | undefined) ?? [];
  assert(history.some((h) => /coffee/i.test(h)), "previous value preserved in memory history");

  // ---- TEST D part 1: self vs user (memory layer) -----------------
  await section("TEST D — SELF VS USER (memory types stay separate)");
  const all = await patterns(brain);
  const selfMemories = all.filter((m) => m.memoryType === "self");
  const userMemories = all.filter((m) => m.memoryType === "user");
  assert(selfMemories.some((m) => m.id === "lelu-identity-foundation"), "LÉLU identity is stored as self memory");
  assert(
    userMemories.some((m) => m.category === "identity" && /Alex/i.test(m.response)),
    "user identity is stored as user memory, not self",
  );
}

async function runEndToEndTests(): Promise<void> {
  const restoreFetch = stubKnowledgeFetch();
  const ai = AIService.getInstance();
  await ai.initialize();

  // No API keys in this sandbox → every provider honestly unavailable.
  const health = await ai.getProviderHealth();
  assert(health.every((h) => h.health.available === false), "no AI provider available (honest status)");

  // ---- TEST D part 2: self vs user (chat level) -------------------
  await section("TEST D — SELF VS USER (chat answers from the right layer)");
  const whoAreYou = await ai.chat("Who are you?");
  assert(/My name is Lélu/.test(whoAreYou.text), '"Who are you?" answered from LÉLU identity (self)');
  assert(!/Alex/.test(whoAreYou.text), "LÉLU does not confuse herself with the user");

  await ai.chat("My name is Alex");
  const whoAmI = await ai.chat("Who am I?");
  assert(/Alex/.test(whoAmI.text), '"Who am I?" answered from the user profile (user layer)');
  assert(!/My name is Lélu/.test(whoAmI.text), "user answer does not return LÉLU's own identity");

  // ---- TEST F: engineering tool use -------------------------------
  await section("TEST F — ENGINEERING TOOL USE (runtime diagnostics)");
  const eng = await ai.chat("Why is my Groq provider not working?");
  assert(/Groq/i.test(eng.text), "engineering response addresses the actual provider");
  assert(/(diagnostic|findings|runtime state|credential)/i.test(eng.text), "engineering response carries a real diagnostic");

  const memoriesAfterEng = await ai.getMemories();
  assert(
    memoriesAfterEng.some((m) => /requires an API key/i.test(m.response)),
    "durable engineering finding persisted as system memory",
  );

  // ---- TEST G: engineering verification ---------------------------
  await section("TEST G — ENGINEERING VERIFICATION (inspect the result)");
  const verify = await ai.chat("Verify whether the provider configuration is correct");
  assert(/Groq/i.test(verify.text) || /provider/i.test(verify.text), "verification inspects the provider configuration");
  assert(verify.text.length > 80, "verification returns a substantive report, not a stub");

  // ---- TEST H: current information --------------------------------
  await section("TEST H — CURRENT INFORMATION (live knowledge tools)");
  const news = await ai.chat("What is the latest news in Tampa?");
  assert(/Tampa/i.test(news.text), "news answer is about the requested topic");
  assert(/development plan|example\.com|source/i.test(news.text), "answer comes from real retrieved data, not a claim of no access");
  assert(news.provider === "research" || /research/i.test(news.provider), "knowledge tools actually executed");

  restoreFetch();
}

async function run(): Promise<void> {
  await runUnitTests();
  await runEndToEndTests();

  console.log("\n==========================================");
  console.log("LÉLU COGNITIVE INTEGRATION VERIFICATION");
  console.log("==========================================");
  for (const line of results) console.log(line);
  console.log("------------------------------------------");
  console.log(`${results.filter((r) => r.startsWith("  ✓")).length} passed, ${failures} failed`);
  console.log("==========================================");
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
