/**
 * ==========================================================
 * LÉLU — RUNTIME INTEGRATION REGRESSIONS
 * ==========================================================
 *
 * Every case here locks a failure that was found by RUNNING
 * the system, not by reading it — and each asserts the real
 * behaviour rather than mocking the thing under test.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import registerAIProviders from "../src/core/RegisterAIProviders";
import ArxivProvider from "../src/providers/ArxivProvider";
import { resolveEnvValue, resolveViteOnly, resolveFirst } from "../src/core/resolveEnv";
import { endpoint, endpointUrl } from "../src/core/Endpoints";

/* ------------------------------------------------------------------ *
 * 1. Provider initialization outside Vite
 *
 * `import.meta.env.VITE_X?.trim()` guards the PROPERTY, not the object.
 * `import.meta.env` is undefined in Node, so initialize() threw
 * TypeError and the whole registry failed to start. The suite runs
 * under Bun, which DOES define import.meta.env — which is exactly why
 * this went unnoticed — so the test deletes it to reproduce Node.
 * ------------------------------------------------------------------ */

test("every AI provider initializes when import.meta.env is undefined", async () => {
  const meta = import.meta as unknown as { env?: unknown };
  const saved = meta.env;
  // Reproduce a non-Vite runtime (server.ts under Node, Deno, workers).
  delete meta.env;
  try {
    const registry = registerAIProviders();
    await registry.initialize();

    const health = await Promise.all(registry.all().map((p) => p.health()));
    assert.equal(
      health.every((h) => h.initialized),
      true,
      "a provider failed to initialize without import.meta.env",
    );
    assert.ok(registry.all().length >= 8, "expected the full provider chain");
  } finally {
    if (saved !== undefined) meta.env = saved;
  }
});

/* ------------------------------------------------------------------ *
 * 2. Guarded environment resolution
 * ------------------------------------------------------------------ */

test("resolveEnvValue reads the unprefixed name and never throws without import.meta.env", () => {
  const meta = import.meta as unknown as { env?: unknown };
  const saved = meta.env;
  delete meta.env;
  try {
    process.env.LELU_TEST_TOKEN = "  spaced-value  ";
    assert.equal(resolveEnvValue("LELU_TEST_TOKEN"), "spaced-value", "value should be trimmed");
    assert.equal(resolveEnvValue("LELU_TEST_ABSENT"), undefined);
  } finally {
    delete process.env.LELU_TEST_TOKEN;
    if (saved !== undefined) meta.env = saved;
  }
});

test("resolveEnvValue prefers the VITE_ spelling over the bare one", () => {
  process.env.LELU_TEST_PREF = "bare";
  process.env.VITE_LELU_TEST_PREF = "vite";
  try {
    assert.equal(resolveEnvValue("LELU_TEST_PREF"), "vite");
  } finally {
    delete process.env.LELU_TEST_PREF;
    delete process.env.VITE_LELU_TEST_PREF;
  }
});

test("resolveViteOnly refuses the bare name — an ambient GITHUB_TOKEN is not a Models key", () => {
  // Dev containers, Codespaces and CI runners all set this for git
  // tooling. Adopting it would make GitHubModelsProvider report itself
  // available and spend a repo-scoped token against an inference API.
  process.env.GITHUB_TOKEN = "ambient-git-tooling-token";
  try {
    assert.equal(resolveViteOnly("GITHUB_TOKEN"), undefined);
    process.env.VITE_GITHUB_TOKEN = "explicitly-configured";
    assert.equal(resolveViteOnly("GITHUB_TOKEN"), "explicitly-configured");
  } finally {
    delete process.env.GITHUB_TOKEN;
    delete process.env.VITE_GITHUB_TOKEN;
  }
});

test("resolveFirst walks its aliases in order", () => {
  process.env.LELU_TEST_SECOND = "from-second";
  try {
    assert.equal(resolveFirst("LELU_TEST_FIRST", "LELU_TEST_SECOND"), "from-second");
  } finally {
    delete process.env.LELU_TEST_SECOND;
  }
});

/* ------------------------------------------------------------------ *
 * 3. Endpoint version-segment repair
 *
 * ANTHROPIC_BASE_URL is ambiguous in the wild: the SDK documents the
 * bare host and appends /v1 itself, the API reference shows the
 * versioned form. One path segment apart; guessing wrong is a silent
 * 404 on every request.
 * ------------------------------------------------------------------ */

test("a base URL missing its version segment still reaches the real path", () => {
  const saved = process.env.ANTHROPIC_BASE_URL;
  try {
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    assert.equal(endpointUrl("anthropic", "messages"), "https://api.anthropic.com/v1/messages");

    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
    assert.equal(
      endpointUrl("anthropic", "messages"),
      "https://api.anthropic.com/v1/messages",
      "a base that already carries /v1 must not be doubled",
    );
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved;
  }
});

test("NASA_API_URL moves the endpoints derived from it, and a specific name still wins", () => {
  const saved = process.env.NASA_API_URL;
  try {
    process.env.NASA_API_URL = "https://nasa-mirror.internal";
    assert.equal(endpoint("nasaApod"), "https://nasa-mirror.internal/planetary/apod");
    assert.equal(endpoint("nasaNeo"), "https://nasa-mirror.internal/neo/rest/v1");

    process.env.NASA_APOD_API_URL = "https://apod-only.internal";
    assert.equal(endpoint("nasaApod"), "https://apod-only.internal");
  } finally {
    delete process.env.NASA_APOD_API_URL;
    if (saved === undefined) delete process.env.NASA_API_URL;
    else process.env.NASA_API_URL = saved;
  }
});

/* ------------------------------------------------------------------ *
 * 4. arXiv returns REAL parsed papers, never a placeholder
 *
 * The provider used to fetch real Atom XML, discard it, and return one
 * hardcoded "arXiv parsing coming soon" record. This drives the real
 * parser with a real Atom document and asserts the fields came out of
 * the XML — the fetch is stubbed, the PARSING under test is not.
 * ------------------------------------------------------------------ */

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <published>2017-06-12T18:00:00Z</published>
    <title>Attention Is All You Need</title>
    <summary>  The dominant sequence transduction models are based on complex
recurrent or convolutional neural networks.  </summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <link href="http://arxiv.org/abs/1706.03762v5" rel="alternate" type="text/html"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

test("arXiv parses real Atom into real results — no placeholder, no raw XML", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => ATOM,
  })) as unknown as typeof fetch;

  try {
    const results = await new ArxivProvider().search("attention");

    assert.equal(results.length, 1);
    const [paper] = results;
    assert.equal(paper.title, "Attention Is All You Need");
    assert.match(paper.content, /Ashish Vaswani/, "authors must reach the content");
    assert.match(paper.content, /sequence transduction/, "the abstract must reach the content");
    assert.equal(paper.url, "http://arxiv.org/abs/1706.03762v5");
    assert.deepEqual(paper.metadata?.categories, ["cs.CL"]);

    // The exact defect this replaced:
    assert.doesNotMatch(paper.title, /coming soon/i);
    assert.doesNotMatch(paper.content, /<entry>|<\/feed>/, "raw XML must never be handed to cognition");
    // Whitespace in the source abstract is hard-wrapped; it must be tidied.
    assert.doesNotMatch(paper.content, /\n/, "abstract should be collapsed to a single line");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arXiv surfaces an HTTP failure instead of fabricating a result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 503,
    text: async () => "unavailable",
  })) as unknown as typeof fetch;

  try {
    await assert.rejects(() => new ArxivProvider().search("x"), /arXiv 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ------------------------------------------------------------------ *
 * 5. Research is time-bounded so the turn always reaches the model
 *
 * runProviders() is re-entered once per fallback query, so the real
 * worst case was fallbacks x MAX_PROVIDERS x per-provider-timeout.
 * With providers that HANG rather than refuse (a blocked host, a slow
 * mirror) a measured turn spent 150s in research and never produced an
 * answer at all. The providers here hang exactly like that, so this
 * exercises the real bound rather than a mocked clock.
 * ------------------------------------------------------------------ */

test("research stops at its budget when every knowledge provider hangs", async () => {
  const { default: ResearchResolver } = await import("../src/core/router/ResearchResolver");

  const hanging = (name: string) => ({
    name,
    category: "news",
    priority: 80,
    enabled: true,
    requiresApiKey: false,
    timeout: 12000,
    cooldown: 0,
    maxConcurrent: 1,
    capabilities: ["news", "current-events"],
    canSearch: () => true,
    // Never settles — the shape that produced the 150s stall.
    search: () => new Promise(() => {}),
  });

  const providers = [hanging("p1"), hanging("p2"), hanging("p3"), hanging("p4")];
  const resolver = new ResearchResolver() as unknown as {
    runProviders: (
      ctx: unknown,
      providers: unknown[],
      query: string,
      attempted: Array<{ provider: string; error?: string }>,
      deadline?: number,
    ) => Promise<unknown[]>;
  };

  const attempted: Array<{ provider: string; error?: string }> = [];
  const ctx = { logger: { info() {}, error() {}, warn() {} } };

  const started = Date.now();
  const deadline = started + 3000;
  const results = await resolver.runProviders(ctx, providers, "latest news", attempted, deadline);
  const elapsed = Date.now() - started;

  assert.deepEqual(results, [], "hanging providers must yield no results");
  assert.ok(
    elapsed < 8000,
    `research must abandon hanging providers at its deadline; took ${elapsed}ms`,
  );
  assert.ok(
    attempted.some((a) => /timed out|budget-exhausted/.test(a.error ?? "")),
    "every abandoned provider must be recorded honestly, not silently skipped",
  );
});

/* ------------------------------------------------------------------ *
 * 6. A real search result must never be reported as "found nothing"
 *
 * ToolCallInterceptor gated success on `result.handled && length > 0`.
 * ResearchResolver returns handled:FALSE with results on its success
 * path (it hands off so a provider can synthesise them) and
 * handled:TRUE without results when retrieval failed — so that gate
 * matched neither state. A real search returning real sources fell
 * through to the "didn't find current results" branch: LÉLU told the
 * user she found nothing while holding the results.
 * ------------------------------------------------------------------ */

test("interceptor reports real results even though the resolver returns handled:false", async () => {
  const { default: ToolCallInterceptor } = await import("../src/core/router/ToolCallInterceptor");
  const AgentEventBus = (await import("../src/core/agent/AgentEvents")).default;

  const events: Array<{ type: string; status?: string; result?: string }> = [];
  const off = AgentEventBus.getInstance().subscribe((e: any) =>
    events.push({ type: e.type, status: e.status, result: e.result }),
  );

  const resolverModule = await import("../src/core/router/ResearchResolver");
  const RealResolver = resolverModule.default;
  const originalExecute = RealResolver.prototype.execute;

  // Reproduce the resolver's REAL success shape: handled:false + results.
  RealResolver.prototype.execute = async function () {
    return {
      handled: false,
      results: [
        {
          id: "r1",
          title: "Reactor achieves net energy gain",
          content: "A fusion experiment reported more energy out than in.",
          url: "https://example.org/fusion",
          source: "ExampleWire",
          confidence: 0.9,
        },
      ],
    };
  } as typeof originalExecute;

  try {
    const context = {
      request: { prompt: "latest fusion news", timestamp: Date.now(), messages: [] },
      started: Date.now(),
      logger: { info() {}, error() {}, warn() {} },
    } as never;

    const outcome = await new ToolCallInterceptor().intercept(
      { text: '<tool_call_start>{"name":"search","query":"fusion"}<tool_call_end>' } as never,
      context,
    );

    assert.equal(outcome.intercepted, true);
    assert.match(
      outcome.response!.text,
      /net energy gain/,
      "the real retrieved result must reach the user",
    );
    assert.doesNotMatch(
      outcome.response!.text,
      /didn't find|no usable results/i,
      "a successful search must never be reported as finding nothing",
    );
    assert.equal(outcome.response!.metadata?.success, true);

    // ResearchResolver owns the tool_result for success/empty, so the
    // interceptor must NOT add a second one — two rows for one
    // execution is the duplication this asserts against.
    const results = events.filter((e) => e.type === "tool_result");
    assert.equal(results.length, 0, "the interceptor must not duplicate the resolver's tool_result");
  } finally {
    RealResolver.prototype.execute = originalExecute;
    off?.();
  }
});

test("an executed-but-empty search is reported as empty, and never as skipped", async () => {
  const { default: ToolCallInterceptor } = await import("../src/core/router/ToolCallInterceptor");
  const AgentEventBus = (await import("../src/core/agent/AgentEvents")).default;

  const events: Array<{ type: string; status?: string }> = [];
  const off = AgentEventBus.getInstance().subscribe((e: any) =>
    events.push({ type: e.type, status: e.status }),
  );

  const resolverModule = await import("../src/core/router/ResearchResolver");
  const RealResolver = resolverModule.default;
  const originalExecute = RealResolver.prototype.execute;
  RealResolver.prototype.execute = async function () {
    return { handled: true, results: [] };
  } as typeof originalExecute;

  try {
    const outcome = await new ToolCallInterceptor().intercept(
      { text: '<tool_call_start>{"name":"search","query":"nothing"}<tool_call_end>' } as never,
      {
        request: { prompt: "nothing", timestamp: Date.now(), messages: [] },
        started: Date.now(),
        logger: { info() {}, error() {}, warn() {} },
      } as never,
    );

    assert.equal(outcome.response!.metadata?.success, false);
    assert.match(outcome.response!.text, /real retrieval attempt/i);
    assert.equal(
      events.filter((e) => e.type === "tool_result").length,
      0,
      "the resolver owns this terminal event; the interceptor must not duplicate it",
    );
  } finally {
    RealResolver.prototype.execute = originalExecute;
    off?.();
  }
});

/* ------------------------------------------------------------------ *
 * 7. Display sanitisation must never promise work it did not dispatch
 * ------------------------------------------------------------------ */

test("cleanAssistantText never claims a search is under way", async () => {
  const { cleanAssistantText } = await import("../src/core/router/ToolMarkup");

  const out = cleanAssistantText(
    '<tool_call_start><parameter name="query">mars rover</parameter><tool_call_end>',
  );

  // It sanitises text for display and dispatches nothing, so it must not
  // announce research that no tool call backs.
  assert.doesNotMatch(out, /I['’]m researching/i);
  assert.doesNotMatch(out, /will show the live result/i);
  assert.match(out, /not executed/i, "it must say plainly that nothing ran");
  assert.doesNotMatch(out, /<parameter|tool_call_start/, "raw markup must never reach the user");
});

test("cleanAssistantText leaves ordinary prose untouched", async () => {
  const { cleanAssistantText } = await import("../src/core/router/ToolMarkup");
  const prose = "The capital of France is Paris.";
  assert.equal(cleanAssistantText(prose), prose);
});

/* ------------------------------------------------------------------ *
 * 8. A tool that THROWS still produces a terminal telemetry event
 *
 * ResearchResolver emits its own tool_result for the success and empty
 * paths. When it throws it emits neither, so without this the activity
 * row showed "searching" with no outcome, forever — the "no evidence in
 * telemetry that the search executed" symptom.
 * ------------------------------------------------------------------ */

test("a throwing tool still emits a terminal tool_result", async () => {
  const { default: ToolCallInterceptor } = await import("../src/core/router/ToolCallInterceptor");
  const AgentEventBus = (await import("../src/core/agent/AgentEvents")).default;

  const events: Array<{ type: string; status?: string }> = [];
  const off = AgentEventBus.getInstance().subscribe((e: any) =>
    events.push({ type: e.type, status: e.status }),
  );

  const resolverModule = await import("../src/core/router/ResearchResolver");
  const RealResolver = resolverModule.default;
  const originalExecute = RealResolver.prototype.execute;
  RealResolver.prototype.execute = async function () {
    throw new Error("provider registry unavailable");
  } as typeof originalExecute;

  try {
    const outcome = await new ToolCallInterceptor().intercept(
      { text: '<tool_call_start>{"name":"search","query":"x"}<tool_call_end>' } as never,
      {
        request: { prompt: "x", timestamp: Date.now(), messages: [] },
        started: Date.now(),
        logger: { info() {}, error() {}, warn() {} },
      } as never,
    );

    assert.equal(outcome.response!.metadata?.success, false);
    const terminal = events.filter((e) => e.type === "tool_result");
    assert.equal(terminal.length, 1, "a throw must still close the activity");
    assert.equal(terminal[0].status, "error");
  } finally {
    RealResolver.prototype.execute = originalExecute;
    off?.();
  }
});

/* ------------------------------------------------------------------ *
 * 9. The activity label must reflect the event's real status
 * ------------------------------------------------------------------ */

test("a failed or empty tool_result is never labelled as a returned result", async () => {
  const { executionEventLabel } = await import(
    "../src/app/scene/genesis/GenesisExecutionTimeline"
  );

  const failed = executionEventLabel({
    type: "tool_result", taskId: "t", tool: "research",
    result: "", results: [], status: "error",
  } as never);
  assert.doesNotMatch(failed, /returned a result/, "a failure must not read as success");
  assert.match(failed, /failed/i);

  const empty = executionEventLabel({
    type: "tool_result", taskId: "t", tool: "research",
    result: "", results: [], status: "complete",
  } as never);
  assert.match(empty, /no results/i);

  const real = executionEventLabel({
    type: "tool_result", taskId: "t", tool: "research",
    result: "", results: [{ title: "a" }, { title: "b" }], status: "complete",
  } as never);
  assert.match(real, /returned 2 results/);
});
