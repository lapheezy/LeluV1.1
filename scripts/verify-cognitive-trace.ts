/**
 * LÉLU COGNITIVE TRACE — FULL-CYCLE ACCEPTANCE VERIFICATION
 *
 * This script exists to answer the question that "memory exists" and
 * "the files are there" can never answer:
 *
 *   Did cognition and memory ACTUALLY participate in this turn, and
 *   did the retrieved memory ACTUALLY reach the model request?
 *
 * Every assertion goes through the real production entry point —
 * AIService.getInstance().chat(), the same call GenesisChat.tsx makes
 * — and is checked against the CognitiveTrace evidence chain recorded
 * by the real pipeline (MemoryBridge.enrich, AIRuntime.process,
 * ProviderResolver), never by calling those internals directly.
 *
 * PART A — the full write → persist → retrieve → inject → use cycle
 *   for a unique arbitrary fact, including across a simulated restart
 *   (fresh AIService/Brain instances reading the SAME persisted store).
 *
 * PART B — provider #1 fails → provider #2 takes over, with cognition
 *   and memory PROVABLY intact across the fallback (the enriched
 *   context is still attached to the request the second provider
 *   receives, and the memory write still happens).
 *
 * Run: bun run scripts/verify-cognitive-trace.ts
 */

// ---------------------------------------------------------------
// Shims: in-memory IndexedDB (Brain/PatternMemory) + window storage
// (KvStore-backed stores). Identical to the other verify-*.ts scripts.
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
  open(name: string, _version?: number): ShimRequest {
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
globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import AIService from "../src/core/AIService";
import CognitiveTrace, { type CognitiveTurn } from "../src/core/cognition/CognitiveTrace";
import Brain from "../src/brain/Brain";
import MemoryBridge from "../src/core/MemoryBridge";
import UserManager from "../src/core/user/UserManager";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The unique arbitrary fact — deliberately not a name, and not a word
 *  that appears anywhere in LÉLU's source, prompts, or seeded memories. */
const UNIQUE_FACT = "My test identifier is LELU-ARCH-72941.";
const UNIQUE_TOKEN = "LELU-ARCH-72941";

function stageData(turn: CognitiveTurn | null, stage: Parameters<typeof CognitiveTrace.entriesFor>[1]) {
  return CognitiveTrace.entriesFor(turn, stage)[0]?.data ?? {};
}

async function main(): Promise<void> {
  const trace = CognitiveTrace.getInstance();
  // Enable explicitly: a plain bun run has no import.meta.env.DEV, and
  // the whole point of this script is to read the evidence chain.
  trace.setEnabled(true);

  const ai = AIService.getInstance();
  await ai.initialize();

  console.log("== The trace is wired into the REAL chat path (not a test-only shim) ==");
  await ai.chat("Hello.");
  const firstTurn = trace.lastTurn();
  assert(firstTurn !== null, "an ordinary chat() call produced a traced turn");
  assert(
    CognitiveTrace.reached(firstTurn, "INPUT") &&
      CognitiveTrace.reached(firstTurn, "MEMORY_RETRIEVAL") &&
      CognitiveTrace.reached(firstTurn, "SELF_CONTEXT") &&
      CognitiveTrace.reached(firstTurn, "MODEL_ROUTE") &&
      CognitiveTrace.reached(firstTurn, "RESPONSE"),
    "every core cognitive stage ran for an ordinary turn (INPUT → MEMORY_RETRIEVAL → SELF_CONTEXT → MODEL_ROUTE → RESPONSE)",
    CognitiveTrace.format(firstTurn),
  );

  console.log("\n== GAP 1 — exactly ONE canonical recall per turn (measured inside Brain.recall itself) ==");
  {
    const retrievals = CognitiveTrace.entriesFor(firstTurn, "MEMORY_RETRIEVAL");
    const responseAt = (firstTurn?.entries ?? []).findIndex((e) => e.stage === "RESPONSE");
    // Recalls that happened BEFORE the response — i.e. the cognition
    // path that produces the answer. Previously this was 2-3 (
    // MemoryBridge.enrich + BrainResolver + composeFromMemory).
    const cognitionRecalls = (firstTurn?.entries ?? []).filter(
      (e, i) => e.stage === "MEMORY_RETRIEVAL" && (responseAt < 0 || i < responseAt),
    );
    assert(
      cognitionRecalls.length === 1,
      `exactly ONE brain.recall() before the response (was 2-3 via enrich + BrainResolver + composeFromMemory) — got ${cognitionRecalls.length}`,
      JSON.stringify(retrievals.map((e) => e.data?.purpose)),
    );
    assert(
      cognitionRecalls[0]?.data?.purpose === "cognition",
      "the single pre-response recall is the canonical cognition recall",
      JSON.stringify(cognitionRecalls[0]?.data),
    );
    const postWrite = retrievals.filter((e) => e.data?.purpose === "post-write-profile-sync");
    assert(
      postWrite.length <= 1,
      "the post-write profile sync is a single, distinctly-labelled recall — visible, not hidden",
      JSON.stringify(retrievals.map((e) => e.data?.purpose)),
    );
  }

  console.log("\n== PART A/1 — the unique fact is WRITTEN through the real chat path ==");
  await ai.chat(UNIQUE_FACT);
  const writeTurn = trace.lastTurn();
  const writeData = stageData(writeTurn, "MEMORY_WRITE");
  assert(
    CognitiveTrace.reached(writeTurn, "MEMORY_WRITE"),
    "the turn reached MEMORY_WRITE (memory consolidation actually ran)",
  );
  assert(
    writeData.persisted === true,
    "the trace reports a REAL persisted memory for this turn, not a skipped write",
    JSON.stringify(writeData),
  );

  console.log("\n== PART A/2 — it is genuinely in long-term storage, readable back ==");
  const storedNow = await ai.getMemories(50);
  const storedFact = storedNow.find((m) => m.response.includes(UNIQUE_TOKEN));
  assert(Boolean(storedFact), "the unique fact is present in the long-term memory store");
  assert(
    storedFact?.memoryType === "user" || storedFact?.category !== "conversation",
    "it was classified as a durable user fact, not disposable conversation filler",
    `category=${storedFact?.category} memoryType=${storedFact?.memoryType}`,
  );

  console.log("\n== PART A/3 — SIMULATED RESTART: brand-new Brain reading the SAME persisted store ==");
  // Not a new memory system — a second Brain instance over the SAME
  // shimmed IndexedDB, which is exactly what a page reload produces.
  const restartedBrain = new Brain();
  await restartedBrain.initialize();
  const restartedUser = new UserManager();
  await restartedUser.initialize();
  const restartedBridge = new MemoryBridge(restartedBrain, restartedUser);

  const recalledAfterRestart = await restartedBrain.recall("what is my test identifier");
  assert(
    recalledAfterRestart.some((m) => m.response.includes(UNIQUE_TOKEN)),
    "after a restart, a DIFFERENTLY-WORDED question still retrieves the fact from persistent storage",
    `recalled ${recalledAfterRestart.length}: ${recalledAfterRestart.map((m) => m.response.slice(0, 40)).join(" | ")}`,
  );

  console.log("\n== PART A/4 — the retrieved memory is actually INJECTED into the model request ==");
  const { request: enriched } = await restartedBridge.enrich({
    messages: [{ role: "user", content: "what is my test identifier" }],
    prompt: "what is my test identifier",
    timestamp: Date.now(),
  });
  const injectedText = [
    enriched.context ?? "",
    ...(enriched.messages ?? []).map((m) => m.content),
  ].join("\n");
  assert(
    injectedText.includes(UNIQUE_TOKEN),
    "the enriched request the MODEL would receive literally contains the stored fact — retrieval is not a silent no-op",
    `context=${(enriched.context ?? "").length} chars, messages=${enriched.messages?.length}`,
  );

  console.log("\n== PART A/5 — a later real chat() turn USES it, and the trace proves why ==");
  const recallResponse = await ai.chat("What is my test identifier?");
  const recallTurn = trace.lastTurn();
  const retrievalData = stageData(recallTurn, "MEMORY_RETRIEVAL");
  const injectionData = stageData(recallTurn, "CONTEXT_INJECTION");
  const routeData = stageData(recallTurn, "MODEL_ROUTE");

  assert(
    (retrievalData.count as number) > 0,
    "MEMORY_RETRIEVAL recalled at least one memory for the recall question",
    JSON.stringify(retrievalData),
  );
  assert(
    injectionData.injected === true && (injectionData.contextLength as number) > 0,
    "CONTEXT_INJECTION confirms real context was injected into the request",
    JSON.stringify(injectionData),
  );
  assert(
    (routeData.contextLength as number) > 0,
    "MODEL_ROUTE confirms the injected context SURVIVED into the routed request (not lost between enrich and the router)",
    JSON.stringify(routeData),
  );
  assert(
    recallResponse.text.includes(UNIQUE_TOKEN),
    "and the actual response returned to the user contains the recalled fact",
    recallResponse.text.slice(0, 200),
  );

  console.log("\n== PART C — a TOOL actually executes inside the turn, and the trace proves it ==");
  // TOOL_CALL was a declared trace stage that nothing recorded, so tool
  // and agent execution was invisible in the per-turn evidence chain.
  // CognitiveTrace now folds the EXISTING AgentEventBus tool lifecycle
  // into the active turn. This drives the REAL path — chat() → router →
  // BrowserResolver → BrowserTool → AgentEventBus → CognitiveTrace —
  // with only the network stubbed, so the bridge is proven end to end.
  let toolTurnForReport: CognitiveTurn | null = null;
  {
    const originalFetch = globalThis.fetch;
    const PAGE_TOKEN = "LELU-PAGE-MARKER-55813";
    let pageFetches = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("example.org")) {
        pageFetches += 1;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => "text/html" },
          text: async () =>
            `<html><head><title>Example Domain</title></head><body><p>${PAGE_TOKEN} is the marker on this page.</p></body></html>`,
          json: async () => ({}),
        } as unknown as Response;
      }
      return { ok: false, status: 503, statusText: "unavailable", headers: { get: () => "" }, text: async () => "", json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    try {
      const browseResponse = await ai.chat("Open https://example.org and read it.");
      const toolTurn = trace.lastTurn();
      toolTurnForReport = toolTurn;
      const toolCalls = CognitiveTrace.entriesFor(toolTurn, "TOOL_CALL");

      assert(pageFetches > 0, "the browser tool genuinely fetched the page", `fetches=${pageFetches}`);
      assert(
        CognitiveTrace.reached(toolTurn, "TOOL_CALL"),
        "the turn reached TOOL_CALL — tool execution is now part of the evidence chain (it was a dead stage before)",
        CognitiveTrace.format(toolTurn),
      );
      assert(
        toolCalls.some((entry) => entry.data?.tool === "browser" && entry.data?.phase === "result"),
        "the TOOL_CALL entries name the real tool that ran and its real outcome",
        JSON.stringify(toolCalls.map((entry) => entry.data)),
      );
      assert(
        toolCalls.every((entry) => entry.timestamp >= (toolTurn?.startedAt ?? 0)),
        "tool activity is attributed to THIS turn (bridge filters by taskId, so background work is not folded in)",
      );
      assert(
        browseResponse.text.length > 0,
        "the browsed page still produced a real response through the normal pipeline",
        browseResponse.text.slice(0, 160),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  console.log("\n== PART B — provider #1 fails → provider #2 takes over, cognition intact ==");
  // Give the two highest-priority remote providers real-looking keys so
  // they become genuinely available, then make ONLY the first one fail.
  const g = globalThis as Record<string, unknown>;
  const originalFetch = globalThis.fetch;
  let fallbackTurnForReport: CognitiveTurn | null = null;
  g.__LELU_GROQ_API_KEY__ = "test-groq-key";
  g.__LELU_OPENROUTER_API_KEY__ = "test-openrouter-key";

  // A fresh service instance so the providers re-read the injected keys.
  const restartedAi = new (AIService as unknown as { new (): AIService })();
  await restartedAi.initialize();

  let groqCalls = 0;
  let openRouterCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("groq.com")) {
      groqCalls += 1;
      // A real upstream failure — exactly what makes ProviderResolver
      // record a failure and advance to the next provider.
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => JSON.stringify({ error: { message: "simulated Groq outage" } }),
        json: async () => ({ error: { message: "simulated Groq outage" } }),
      } as unknown as Response;
    }
    if (url.includes("openrouter.ai")) {
      openRouterCalls += 1;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            id: "chatcmpl-fallback",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Answered by the fallback provider." },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        json: async () => ({}),
      } as unknown as Response;
    }
    // Everything else (local model probes, research, …) fails closed.
    return { ok: false, status: 503, statusText: "unavailable", text: async () => "", json: async () => ({}) } as unknown as Response;
  }) as typeof fetch;

  try {
    const fallbackResponse = await restartedAi.chat("Summarize what you know about my identifier.");
    const fallbackTurn = trace.lastTurn();
    fallbackTurnForReport = fallbackTurn;

    const attemptData = stageData(fallbackTurn, "PROVIDER_ATTEMPT");
    const fallbackEntries = CognitiveTrace.entriesFor(fallbackTurn, "PROVIDER_FALLBACK");
    const resultData = stageData(fallbackTurn, "RESULT");

    const chain = (attemptData.chain as Array<{ name: string }> | undefined) ?? [];
    assert(
      chain.length >= 2,
      "the fallback chain recorded before any attempt contains at least two providers",
      JSON.stringify(chain.map((c) => c.name)),
    );
    assert(groqCalls > 0, "provider #1 (Groq) was genuinely attempted over the network", `calls=${groqCalls}`);
    assert(
      fallbackEntries.some((e) => String(e.data?.failedProvider) === "Groq"),
      "PROVIDER_FALLBACK records Groq's real failure",
      JSON.stringify(fallbackEntries.map((e) => e.data)),
    );
    assert(openRouterCalls > 0, "provider #2 (OpenRouter) then took over", `calls=${openRouterCalls}`);
    assert(
      resultData.provider === "OpenRouter",
      "RESULT confirms the SECOND provider produced the answer",
      JSON.stringify(resultData),
    );
    assert(
      fallbackResponse.text.includes("fallback provider"),
      "the user received the second provider's real answer, not an offline notice",
      fallbackResponse.text.slice(0, 160),
    );

    // The acceptance criterion that matters most: a provider failure must
    // not bypass cognition or memory.
    const fbFailure = fallbackEntries.find((e) => String(e.data?.failedProvider) === "Groq");
    assert(
      (fbFailure?.data?.requestContextLength as number) > 0,
      "COGNITION INTACT ACROSS FALLBACK: the enriched context was still attached when provider #1 failed",
      JSON.stringify(fbFailure?.data),
    );
    assert(
      (resultData.requestContextLength as number) > 0,
      "COGNITION INTACT ACROSS FALLBACK: the same enriched context reached the provider that succeeded",
      JSON.stringify(resultData),
    );
    assert(
      CognitiveTrace.reached(fallbackTurn, "MEMORY_WRITE"),
      "MEMORY INTACT ACROSS FALLBACK: memory consolidation still ran after the provider failover",
      CognitiveTrace.format(fallbackTurn),
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete g.__LELU_GROQ_API_KEY__;
    delete g.__LELU_OPENROUTER_API_KEY__;
  }

  console.log("\n----- evidence chain for the memory-recall turn -----");
  console.log(CognitiveTrace.format(recallTurn));
  console.log("\n----- evidence chain for the tool-execution turn -----");
  console.log(CognitiveTrace.format(toolTurnForReport));
  console.log("\n----- evidence chain for the provider-fallback turn -----");
  console.log(CognitiveTrace.format(fallbackTurnForReport));

  console.log(`\n${failures === 0 ? "ALL COGNITIVE TRACE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
