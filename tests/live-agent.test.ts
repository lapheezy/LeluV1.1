/**
 * ==========================================================
 * LÉLU — LIVE CHAT + BROWSER EXECUTION
 *
 * Locks the pieces the live tool loop is built from:
 *   - a turn's activity is folded from real events only;
 *   - tasks are owned by the conversation that started them;
 *   - a message sent mid-turn reaches the running tool loop;
 *   - streamed replies keep their tool calls (OpenAI-shaped and
 *     Anthropic), and a stream error is an error, not "empty";
 *   - browser.read fails with a structure the model can act on;
 *   - an empty research prefetch hands the turn to the model;
 *   - side questions and other chats' replies go to the inbox.
 *
 * No network: every provider and page here is a local fake.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import AgentEventBus, { type AgentEvent } from "../src/core/agent/AgentEvents";
import {
  emptyActivity,
  finishActivity,
  hasVisibleActivity,
  reduceActivity,
  summarizeActivity,
} from "../src/core/multichat/TurnActivity";
import { bindTask, ownerForTask } from "../src/core/multichat/TurnOwnership";
import { readOpenAIStream } from "../src/providers/openaiTools";
import { describeToolCall, dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import ExecutionLogger from "../src/core/ExecutionLogger";

function sse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Split mid-line on purpose: the readers must buffer across chunks.
      const raw = lines.map((line) => `data: ${line}\n\n`).join("");
      const cut = Math.floor(raw.length / 2);
      controller.enqueue(encoder.encode(raw.slice(0, cut)));
      controller.enqueue(encoder.encode(raw.slice(cut)));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/* ------------------------------------------------------------------ *
 * ACTIVITY — real events only
 * ------------------------------------------------------------------ */

test("a turn's activity is folded from its real search and page events", () => {
  const events: AgentEvent[] = [
    { type: "tool_started", taskId: "t", tool: "research", label: "Searching the web for “nebula”" },
    {
      type: "tool_result", taskId: "t", tool: "research", query: "nebula", result: "2 results", status: "complete",
      results: [
        { title: "Nebula — Wikipedia", url: "https://en.wikipedia.org/wiki/Nebula", content: "A nebula is…" },
        { title: "NASA nebulae", url: "https://nasa.gov/nebulae" },
      ],
    },
    { type: "tool_started", taskId: "t", tool: "browser", label: "Opening en.wikipedia.org" },
    { type: "browser_opened", taskId: "t", url: "https://en.wikipedia.org/wiki/Nebula" },
    { type: "browser_result", taskId: "t", url: "https://en.wikipedia.org/wiki/Nebula", title: "Nebula", excerpt: "A nebula is a cloud…", status: "read" },
    { type: "tool_narration", taskId: "t", text: "Checking current sources." },
  ];
  let activity = emptyActivity(0);
  for (const event of events) activity = reduceActivity(activity, event);

  assert.equal(activity.steps.filter((step) => step.kind === "search").length, 1);
  assert.equal(activity.steps.find((step) => step.kind === "search")?.status, "done");
  assert.equal(activity.steps.find((step) => step.kind === "search")?.count, 2);
  assert.equal(activity.pages.length, 1);
  assert.equal(activity.pages[0].status, "read");
  assert.equal(activity.pages[0].title, "Nebula");
  assert.equal(activity.sources.length, 2, "the page read is the same source as the search hit — not counted twice");

  const summary = summarizeActivity(activity);
  assert.equal(summary.title, "Web research");
  assert.deepEqual(summary.facts, ["1 search", "2 sources found", "1 of 1 page read"]);
  assert.equal(summary.issues, 0);
  assert.ok(hasVisibleActivity(activity));
});

test("events that are not activity change nothing, and a browser sentence is not a page", () => {
  const start = emptyActivity(0);
  assert.equal(reduceActivity(start, { type: "visual_state_changed", taskId: "t" } as never), start);
  assert.equal(reduceActivity(start, { type: "browser_opened", taskId: "t", url: "Opening the browser" }), start);
  assert.equal(hasVisibleActivity(reduceActivity(start, { type: "memory_retrieval", taskId: "t", count: 0 } as never)), false,
    "a routine memory check alone does not earn a card");
});

test("finishing a turn settles what was still running, honestly", () => {
  let activity = reduceActivity(emptyActivity(0), { type: "tool_started", taskId: "t", tool: "research", label: "Searching x" });
  activity = reduceActivity(activity, { type: "browser_opened", taskId: "t", url: "https://example.com" });
  const failed = finishActivity(activity, true, 10);
  assert.equal(failed.status, "failed");
  assert.ok(failed.steps.every((step) => step.status !== "running"));
  assert.equal(failed.pages[0].status, "error", "a page that never loaded is not reported as read");

  const failure = reduceActivity(emptyActivity(0), { type: "tool_started", taskId: "t", tool: "research", label: "Searching x" });
  const after = reduceActivity(failure, { type: "tool_result", taskId: "t", tool: "research", result: "HTTP 503", results: [], status: "error" });
  assert.equal(after.steps[0].status, "failed");
  assert.equal(summarizeActivity(after).issues, 1);
});

/* ------------------------------------------------------------------ *
 * OWNERSHIP — a task belongs to the conversation that started it
 * ------------------------------------------------------------------ */

test("a task is owned by its conversation; an unknown task is owned by none", () => {
  bindTask("task-A", "conv-A");
  bindTask("task-B", "conv-B");
  assert.equal(ownerForTask("task-A"), "conv-A");
  assert.equal(ownerForTask("task-B"), "conv-B");
  assert.equal(ownerForTask("task-unknown"), null, "an unowned task must never be shown in a chat");
});

test("the activity recorder keeps only its own conversation's events", async () => {
  const { recordTurnActivity } = await import("../src/app/scene/genesis/chat/activityRecorder");
  bindTask("rec-A", "conv-rec-A");
  bindTask("rec-B", "conv-rec-B");
  const recording = recordTurnActivity("conv-rec-A", () => {});
  const bus = AgentEventBus.getInstance();
  bus.emit({ type: "tool_started", taskId: "rec-B", tool: "research", label: "Searching other chat" });
  bus.emit({ type: "tool_started", taskId: "rec-A", tool: "research", label: "Searching this chat" });
  bus.emit({ type: "tool_started", taskId: "nobody", tool: "research", label: "Searching background" });
  const activity = recording.stop();
  assert.deepEqual(activity.steps.map((step) => step.label), ["Searching this chat"]);
});

/* ------------------------------------------------------------------ *
 * STEERING — a message sent mid-turn reaches the running loop
 * ------------------------------------------------------------------ */

test("steering is accepted only while a turn is running, and leftovers are handed back", async () => {
  const { default: AIService } = await import("../src/core/AIService");
  const ai = AIService.getInstance();
  assert.equal(ai.steerTurn("conv-steer", "focus on video"), false, "no turn is running — the caller sends it as its own turn");

  const controllers = (ai as unknown as { convControllers: Map<string, AbortController> }).convControllers;
  controllers.set("conv-steer", new AbortController());
  try {
    assert.equal(ai.steerTurn("conv-steer", "  focus on video  "), true);
    assert.equal(ai.steerTurn("conv-steer", "   "), false, "an empty message is not an instruction");
    assert.deepEqual(ai.takeSteering("conv-steer"), ["focus on video"]);
    assert.deepEqual(ai.takeSteering("conv-steer"), [], "taken once");
  } finally {
    controllers.delete("conv-steer");
  }
});

test("the tool loop hands mid-turn messages to the model before its next round", async () => {
  const { default: ProviderResolver } = await import("../src/core/router/ProviderResolver");
  const calls: Array<{ messages?: Array<{ role: string; content: string }> }> = [];
  let round = 0;
  const provider = {
    name: "SpyNative", priority: 1, enabled: true, timeout: 10000,
    requiresApiKey: false, capabilities: ["chat"] as const, supportsTools: true,
    initialize: async () => {}, isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async (request: { messages?: Array<{ role: string; content: string }> }) => {
      calls.push({ messages: request.messages ? [...request.messages] : undefined });
      round += 1;
      return round === 1
        ? {
            text: "Looking into it.", provider: "spy", model: "spy-1", processingTime: 1,
            // Unknown tool: refused by the dispatcher, so nothing real runs.
            toolCalls: [{ id: "c1", name: "no_such_tool", arguments: {} }],
          }
        : { text: "Here is the video-focused answer.", provider: "spy", model: "spy-1", processingTime: 1 };
    },
  };
  const timestamp = Date.now() + 77;
  let drained = false;
  const seen: AgentEvent[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (event.taskId === String(timestamp)) seen.push(event);
  });
  try {
    const result = await new ProviderResolver().execute({
      request: {
        prompt: "research AI tools", messages: [], timestamp, allowTools: true,
        drainSteering: () => {
          if (drained) return [];
          drained = true;
          return ["Focus on video generation"];
        },
      },
      started: Date.now(),
      logger: new ExecutionLogger(),
      aiProviders: {
        available: async () => [provider], names: () => ["spy"], markFailure: () => {},
        markSuccess: () => {}, all: () => [provider], get: () => provider,
      },
    } as never);
    assert.equal(result.response?.text, "Here is the video-focused answer.");
  } finally {
    unsubscribe();
  }
  assert.equal(calls.length, 2);
  const second = calls[1].messages ?? [];
  const steer = second.find((message) => message.role === "user" && message.content.includes("Focus on video generation"));
  assert.ok(steer, "the steering message never reached the model");
  assert.ok(second.indexOf(steer!) > second.findIndex((message) => message.role === "tool"), "it follows the tool results it arrived during");
  assert.ok(seen.some((event) => event.type === "user_steering" && event.text === "Focus on video generation"));
  assert.ok(seen.some((event) => event.type === "tool_narration" && event.text === "Looking into it."),
    "what she said alongside a tool call is an activity line, not reply text");
});

/* ------------------------------------------------------------------ *
 * STREAMING WITH TOOLS
 * ------------------------------------------------------------------ */

test("an OpenAI-shaped stream keeps its tool calls, assembled from fragments", async () => {
  const deltas: string[] = [];
  const reply = await readOpenAIStream(
    sse([
      JSON.stringify({ choices: [{ delta: { content: "Let me " } }] }),
      JSON.stringify({ choices: [{ delta: { content: "check." } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "research_web", arguments: "{\"query\":" } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"nebula\"}" } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_2", function: { name: "browser_read", arguments: "{\"url\":\"https://a.org\"}" } }] } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "[DONE]",
    ]),
    "TestProvider",
    (text) => deltas.push(text),
  );
  assert.equal(reply.text, "Let me check.");
  assert.deepEqual(deltas, ["Let me ", "Let me check."]);
  assert.equal(reply.finishReason, "tool_calls");
  assert.deepEqual(reply.toolCalls.map((call) => [call.id, call.name, call.arguments]), [
    ["call_1", "research_web", { query: "nebula" }],
    ["call_2", "browser_read", { url: "https://a.org" }],
  ]);
});

test("an OpenAI-shaped HTTP error is thrown with the API's own message", async () => {
  await assert.rejects(
    readOpenAIStream(new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }), "TestProvider", () => {}),
    /TestProvider HTTP 429: rate limited/,
  );
});

async function anthropicWith(response: Response) {
  const { default: AnthropicProvider } = await import("../src/providers/AnthropicProvider");
  const provider = new AnthropicProvider();
  // A direct (non-brokered) send in Node: a fake key, a fake fetch.
  Object.assign(provider as unknown as Record<string, unknown>, { initialized: true, apiKey: "test-key" });
  const sent: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return response;
  }) as typeof fetch;
  return { provider, sent, restore: () => { globalThis.fetch = realFetch; } };
}

test("Anthropic streams with tools on, and returns the tool_use blocks whole", async () => {
  const { provider, sent, restore } = await anthropicWith(
    sse([
      JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 12 } } }),
      JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking sources." } }),
      JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "research_web", input: {} } }),
      JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"query\": \"neb" } }),
      JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "ula\", \"focus\": \"video\"}" } }),
      JSON.stringify({ type: "content_block_stop", index: 1 }),
      JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }),
      JSON.stringify({ type: "message_stop" }),
    ]),
  );
  const deltas: string[] = [];
  try {
    const response = await provider.generate({
      prompt: "research nebulae",
      messages: [{ role: "user", content: "research nebulae" }],
      tools: [{ name: "research_web", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } } } }],
      onDelta: (text: string) => deltas.push(text),
    } as never);
    assert.equal(sent[0].stream, true, "a tool-carrying request now streams");
    assert.ok(Array.isArray(sent[0].tools) && (sent[0].tools as unknown[]).length === 1);
    assert.equal(response.text, "Checking sources.");
    assert.deepEqual(deltas, ["Checking sources."]);
    assert.deepEqual(response.toolCalls, [{ id: "toolu_1", name: "research_web", arguments: { query: "nebula", focus: "video" } }]);
    assert.equal(response.stopReason, "tool_use", "stop_reason is read from message_delta.delta");
  } finally {
    restore();
  }
});

test("an Anthropic stream error event is an error, not an empty reply", async () => {
  const { provider, restore } = await anthropicWith(
    sse([
      JSON.stringify({ type: "message_start", message: {} }),
      JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
    ]),
  );
  try {
    await assert.rejects(
      provider.generate({ prompt: "hi", messages: [{ role: "user", content: "hi" }], onDelta: () => {} } as never),
      /Anthropic stream error: Overloaded/,
    );
  } finally {
    restore();
  }
});

/* ------------------------------------------------------------------ *
 * TOOLS — labels and structured failure
 * ------------------------------------------------------------------ */

test("tool calls are described in words for the activity line", () => {
  assert.equal(describeToolCall("research.web", { query: "AI video tools" }), "Searching the web for “AI video tools”");
  assert.equal(describeToolCall("browser.read", { url: "https://www.example.com/a" }), "Opening example.com");
  assert.equal(describeToolCall("memory.store", {}), "Saving to memory");
  assert.equal(describeToolCall("project.manage", { action: "list" }), "Running project.manage (list)");
});

test("browser.read reports a page it could not open as a structured failure, with its events", async () => {
  const { default: BrowserTool } = await import("../src/core/browser/BrowserTool");
  const realVisit = BrowserTool.visit;
  BrowserTool.visit = async (url: string) => ({
    url, title: "", text: "", excerpt: "", status: "blocked" as const, error: "The site refused the reader.",
  });
  const timestamp = Date.now() + 991;
  const seen: AgentEvent[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (event.taskId === String(timestamp)) seen.push(event);
  });
  try {
    const result = await dispatchToolCall(
      { id: "c", name: "browser_read", arguments: { url: "https://blocked.example/page" } },
      String(timestamp),
      { request: { prompt: "x", timestamp } } as never,
    );
    assert.equal(result.ok, false);
    assert.match(result.content, /Could not read https:\/\/blocked\.example\/page: The site refused the reader\./);
    assert.match(result.content, /Try another source/);
    assert.ok(!/undefined/.test(result.content));
    assert.deepEqual(
      seen.map((event) => event.type),
      ["tool_selected", "tool_started", "browser_opened", "browser_navigation", "browser_result", "tool_result"],
    );
    const final = seen.at(-1) as Extract<AgentEvent, { type: "tool_result" }>;
    assert.equal(final.status, "blocked");
  } finally {
    unsubscribe();
    BrowserTool.visit = realVisit;
  }
});

test("browser.read without a url opens nothing", async () => {
  const result = await dispatchToolCall({ id: "c", name: "browser_read", arguments: {} }, "t-empty");
  assert.equal(result.ok, false);
  assert.match(result.content, /needs a url/);
});

/* ------------------------------------------------------------------ *
 * RESEARCH — an empty prefetch is not the end of the turn
 * ------------------------------------------------------------------ */

function researchContext(prompt: string, modelsAvailable: number, extra: Record<string, unknown> = {}) {
  const knowledge = {
    name: "EmptySource", priority: 1, capabilities: ["encyclopedia", "news", "current-events", "video"], timeout: 1000,
    canSearch: () => true, search: async () => [],
  };
  return {
    intent: "search",
    request: { prompt, timestamp: Date.now(), context: "" },
    logger: new ExecutionLogger(),
    knowledgeProviders: { all: () => [knowledge], names: () => ["EmptySource"] },
    aiProviders: { available: async () => Array.from({ length: modelsAvailable }, () => ({})) },
    ...extra,
  } as never;
}

test("an empty prefetch hands the turn to the model, telling it what came back empty", async () => {
  const { default: ResearchResolver } = await import("../src/core/router/ResearchResolver");
  const context = researchContext("latest news about nebula research", 1) as { request: { context: string } };
  const result = await new ResearchResolver().execute(context as never);
  assert.equal(result.handled, false, "the model was never asked");
  assert.match(context.request.context, /LIVE RETRIEVAL — came back empty/);
});

test("with no model to answer, the empty retrieval is still reported honestly", async () => {
  const { default: ResearchResolver } = await import("../src/core/router/ResearchResolver");
  const result = await new ResearchResolver().execute(researchContext("latest news about nebula research", 0));
  assert.equal(result.handled, true);
});

test("the model's stated research focus picks the providers", async () => {
  const { default: ResearchResolver } = await import("../src/core/router/ResearchResolver");
  const resolver = new ResearchResolver() as unknown as {
    selectProviders(context: unknown, prompt: string): Array<{ name: string }>;
  };
  const providers = [
    { name: "Video", priority: 2, capabilities: ["video", "youtube"] },
    { name: "Encyclopedia", priority: 1, capabilities: ["encyclopedia"] },
  ];
  const context = { knowledgeProviders: { all: () => providers, names: () => providers.map((p) => p.name) }, researchFocus: ["video", "youtube"] };
  assert.deepEqual(resolver.selectProviders(context, "what is a nebula").map((p) => p.name), ["Video"]);
});

/* ------------------------------------------------------------------ *
 * NOTIFICATIONS — the Chats panel's inbox
 * ------------------------------------------------------------------ */

test("an inbox notification is silent, unread, and read once opened", async () => {
  const { default: NotificationProvider, isUnread } = await import("../src/core/notifications/NotificationProvider");
  const provider = NotificationProvider.getInstance();
  provider.clearHistory();
  const toasts: string[] = [];
  const offToast = provider.subscribe((record) => toasts.push(record.id));
  const snapshots: number[] = [];
  const offHistory = provider.subscribeHistory((history) => snapshots.push(history.length));
  const links: Array<string | undefined> = [];
  const offLink = provider.subscribeDeepLink((link) => links.push(link.conversationId));
  try {
    const record = provider.notify({ type: "question", title: "LÉLU has a question", body: "Which?", conversationId: "conv-q", questionId: "q-1", silent: true });
    assert.ok(record);
    assert.deepEqual(toasts, [], "a silent record is never a toast");
    assert.equal(record!.read, false);
    assert.equal(provider.unreadCount(), 1);
    assert.deepEqual(snapshots, [0, 1]);

    provider.open(record!.id);
    assert.deepEqual(links, ["conv-q"], "opening it goes to its conversation");
    assert.equal(provider.unreadCount(), 0);
    assert.equal(isUnread({ id: "legacy", title: "old", priority: 5, timestamp: 0 }), false,
      "history from before read state existed is not resurrected as unread");
  } finally {
    offToast();
    offHistory();
    offLink();
    provider.clearHistory();
  }
});

test("a reply in another chat goes to the inbox; in the open chat it does not", async () => {
  const { default: MultiChatStore } = await import("../src/core/multichat/MultiChatStore");
  const { default: NotificationProvider } = await import("../src/core/notifications/NotificationProvider");
  const { notifyTurnOutcome, notifyQuestion } = await import("../src/core/notifications/NotificationRouting");
  const store = MultiChatStore.getInstance();
  const provider = NotificationProvider.getInstance();
  provider.clearHistory();
  const open = store.getActiveId();
  const other = store.createBackground("Research chat").id;
  try {
    assert.equal(notifyTurnOutcome({ conversationId: open, turnId: "t1", ok: true, text: "done" }), null);
    const record = notifyTurnOutcome({ conversationId: other, turnId: "t2", ok: false, text: "The search timed out." });
    assert.ok(record);
    assert.equal(record!.type, "failure");
    assert.equal(record!.conversationId, other);
    assert.match(record!.title, /Research chat/);

    provider.markConversationRead(other);
    assert.equal(provider.unreadCount(), 0, "opening that chat reads its reply notifications");

    const question = { id: "q-side", status: "pending", question: "Should I keep researching video tools?" } as never;
    assert.ok(notifyQuestion(question));
    assert.equal(notifyQuestion(question), null, "a question re-surfacing is not a second entry");
    provider.markQuestionRead("q-side");
    assert.equal(provider.unreadCount(), 0);
  } finally {
    provider.clearHistory();
    if (store.getActiveId() !== open) store.switchActive(open);
  }
});

/* ------------------------------------------------------------------ *
 * PAGES THAT ARE NOT REALLY READ
 * ------------------------------------------------------------------ */

async function withVisit(fake: (url: string) => Promise<unknown>, run: () => Promise<void>) {
  const { default: BrowserTool } = await import("../src/core/browser/BrowserTool");
  const real = BrowserTool.visit;
  let calls = 0;
  BrowserTool.visit = (async (url: string) => {
    calls += 1;
    return fake(url);
  }) as typeof BrowserTool.visit;
  try {
    await run();
  } finally {
    BrowserTool.visit = real;
  }
  return calls;
}

test("a Google News redirect that 'reads' as two words is a failure, with what to do instead", async () => {
  const url = "https://news.google.com/rss/articles/CBMiabc?oc=5";
  const timestamp = Date.now() + 4242;
  const seen: AgentEvent[] = [];
  const off = AgentEventBus.getInstance().subscribe((event) => { if (event.taskId === String(timestamp)) seen.push(event); });
  try {
    await withVisit(async () => ({ url, title: "Google News", text: "Google News", excerpt: "Google News", status: "read" }), async () => {
      const result = await dispatchToolCall({ id: "c", name: "browser_read", arguments: { url } }, String(timestamp), { request: { prompt: "x", timestamp } } as never);
      assert.equal(result.ok, false, "an empty redirect page was reported as read");
      assert.match(result.content, /Google News redirect/);
      assert.match(result.content, /research_web/);
    });
  } finally {
    off();
  }
  const page = seen.find((event) => event.type === "browser_result") as Extract<AgentEvent, { type: "browser_result" }>;
  assert.equal(page.status, "error", "the activity must not count it as a page read");
});

test("the same page asked for twice in one turn is fetched once", async () => {
  const url = "https://example.org/article";
  const timestamp = Date.now() + 5151;
  const text = "Real article text. ".repeat(30);
  let second = "";
  const calls = await withVisit(async () => ({ url, title: "Article", text, excerpt: text.slice(0, 200), status: "read" }), async () => {
    const context = { request: { prompt: "x", timestamp } } as never;
    const first = await dispatchToolCall({ id: "a", name: "browser_read", arguments: { url } }, String(timestamp), context);
    assert.equal(first.ok, true);
    second = (await dispatchToolCall({ id: "b", name: "browser_read", arguments: { url } }, String(timestamp), context)).content;
  });
  assert.equal(calls, 1);
  assert.match(second, /already opened this page/);
  assert.match(second, /Real article text/);
});

test("a site that refuses the server-side reader is reported as that, not as the reader being down", async () => {
  const { default: BrowserTool } = await import("../src/core/browser/BrowserTool");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const target = String(input);
    if (target.startsWith("/api/browse")) {
      return new Response(JSON.stringify({ ok: false, url: "https://www.bbc.com/news", error: "HTTP 403" }), { status: 200 });
    }
    throw new TypeError("Failed to fetch"); // the direct read is blocked (CORS)
  }) as typeof fetch;
  try {
    const page = await BrowserTool.visit("https://www.bbc.com/news");
    assert.equal(page.status, "blocked");
    assert.match(page.error ?? "", /the site answered HTTP 403/);
    assert.doesNotMatch(page.error ?? "", /reader is unavailable/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a chat turn's tool work stays in the chat — it does not open a panel over it", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/app/scene/genesis/GenesisSurfaceController.tsx", "utf8");
  assert.match(source, /const ownedByChat = ownerForTask\(event\.taskId\) !== null;/);
  assert.match(source, /const userInChat = activePanelRef\.current === "chat";/);
  assert.match(source, /if \(surface && !ownedByChat && !userInChat &&/, "an agent event must not replace the chat the user is in");
});

test("a page read is one step, however many events report it", () => {
  const url = "https://news.google.com/rss/articles/x";
  let activity = emptyActivity(0);
  for (const event of [
    { type: "tool_started", taskId: "t", tool: "browser", label: "Opening news.google.com" },
    { type: "browser_opened", taskId: "t", url },
    { type: "browser_result", taskId: "t", url, status: "error", error: "redirect" },
    { type: "tool_result", taskId: "t", tool: "browser", query: url, result: "redirect", results: [], status: "error" },
  ] as AgentEvent[]) activity = reduceActivity(activity, event);
  assert.equal(activity.steps.length, 1);
  assert.equal(summarizeActivity(activity).issues, 1);
});

test("a research-only tool loop stops at the research limit and is told to answer", async () => {
  const { default: ProviderResolver } = await import("../src/core/router/ProviderResolver");
  const calls: Array<{ tools?: unknown[]; messages?: Array<{ role: string; content: string }> }> = [];
  const provider = {
    name: "SpyNative", priority: 1, enabled: true, timeout: 10000,
    requiresApiKey: false, capabilities: ["chat"] as const, supportsTools: true,
    initialize: async () => {}, isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async (request: { tools?: unknown[]; messages?: Array<{ role: string; content: string }> }) => {
      calls.push({ tools: request.tools, messages: request.messages ? [...request.messages] : undefined });
      if (!request.tools) return { text: "Here is what I found.", provider: "spy", model: "spy-1", processingTime: 1 };
      // A different search every round, so it is not caught as "no progress".
      return {
        text: "", provider: "spy", model: "spy-1", processingTime: 1,
        toolCalls: [{ id: `c${calls.length}`, name: "research_web", arguments: { query: `angle ${calls.length}` } }],
      };
    },
  };
  const result = await new ProviderResolver().execute({
    request: { prompt: "research it", messages: [], timestamp: Date.now() + 313, allowTools: true },
    started: Date.now(),
    logger: new ExecutionLogger(),
    aiProviders: {
      available: async () => [provider], names: () => ["spy"], markFailure: () => {},
      markSuccess: () => {}, all: () => [provider], get: () => provider,
    },
  } as never);
  assert.equal(result.response?.text, "Here is what I found.");
  assert.equal(calls.length, 17, "16 research rounds, then one answer without tools");
  assert.equal(calls.at(-1)?.tools, undefined);
  assert.ok(calls.at(-1)?.messages?.some((message) => /16-round research limit/.test(message.content)));
});

test("temperature is never sent to a Claude model that rejects sampling", async () => {
  const { acceptsSampling } = await import("../src/providers/AnthropicProvider");
  for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-8", "claude-opus-4-7"]) {
    assert.equal(acceptsSampling(model), false, model);
  }
  for (const model of ["claude-sonnet-4-5", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]) {
    assert.equal(acceptsSampling(model), true, model);
  }
});

test("the model is given only this conversation's history, up to the current message", async () => {
  const { default: MultiChatStore } = await import("../src/core/multichat/MultiChatStore");
  const { priorTurnsFor } = await import("../src/core/AIService");
  const store = MultiChatStore.getInstance();
  const research = store.createBackground("Research").id;
  const other = store.createBackground("Telescope").id;
  const msg = (role: "user" | "assistant", text: string) => ({ id: crypto.randomUUID(), role, text, timestamp: Date.now(), source: "local" as const });
  store.addMessage(research, msg("user", "Research the latest AI video generation developments."));
  store.addMessage(research, msg("user", "Focus specifically on new video generation models."));
  store.addMessage(other, msg("user", "What is a refracting telescope?"));
  store.addMessage(other, msg("assistant", "One that bends light with lenses."));
  store.addMessage(other, msg("user", "Write two short paragraphs about the history of the telescope."));
  store.addMessage(other, msg("user", "Then a third about mirrors.")); // queued behind it

  const turns = priorTurnsFor(other, "Write two short paragraphs about the history of the telescope.");
  assert.deepEqual(turns, [
    { role: "user", content: "What is a refracting telescope?" },
    { role: "assistant", content: "One that bends light with lenses." },
  ], "another chat's turns, the current message or a later queued one leaked into the history");
  assert.equal(priorTurnsFor(undefined, "x"), null, "no conversation: the caller keeps its own history");
});

/* ------------------------------------------------------------------ *
 * CROSS-CHAT — only what the user authorized, always labelled
 * ------------------------------------------------------------------ */

async function threeChats() {
  const { default: MultiChatStore } = await import("../src/core/multichat/MultiChatStore");
  const store = MultiChatStore.getInstance();
  const msg = (role: "user" | "assistant", text: string, timestamp: number) => ({ id: crypto.randomUUID(), role, text, timestamp, source: "local" as const });
  const t = Date.now();
  const research = store.createBackground("Video research").id;
  store.addMessage(research, msg("user", "Research AI video generation models", t + 1));
  store.addMessage(research, msg("assistant", "Runway Gen-4 and Google Veo 3 lead AI video generation; Veo 3 adds native audio.", t + 3));
  const notes = store.createBackground("Private video notes").id;
  store.addMessage(notes, msg("user", "My private notes about AI video generation budgets and video models", t + 2));
  const question = store.createBackground("Pitch deck").id;
  store.addMessage(question, msg("user", "Which AI video generation model should the pitch mention?", t + 4));
  return { store, research, notes, question };
}

test("another chat's research is used only when the user linked it, and is labelled by its chat", async () => {
  const { default: CrossChatResolver } = await import("../src/core/multichat/CrossChatResolver");
  const { store, research, notes, question } = await threeChats();
  const resolver = CrossChatResolver.getInstance();

  const before = resolver.reference(question, "Which AI video generation model should the pitch mention?");
  assert.deepEqual(before.used, [], "nothing is authorized yet, so nothing may be read");
  assert.doesNotMatch(before.context, /Veo 3/, "an unlinked chat's content leaked");
  assert.ok(before.suggested.some((item) => item.title === "Video research"), "a related chat is offered, not used");
  assert.match(before.context, /not authorized/);

  store.link(question, research);
  const after = resolver.reference(question, "Which AI video generation model should the pitch mention?");
  assert.deepEqual(after.used.map((source) => [source.title, source.authorization]), [["Video research", "linked"]]);
  assert.match(after.context, /From the chat “Video research” \(linked by the user\)/);
  assert.match(after.context, /Veo 3 adds native audio/);
  assert.match(after.context, /say which chat each point comes from/);
  assert.doesNotMatch(after.context, /budgets/, "the still-unlinked chat's content leaked");
  assert.ok(after.suggested.some((item) => item.title === "Private video notes"));
  assert.ok(!after.suggested.some((item) => item.conversationId === notes && after.used.some((u) => u.conversationId === notes)));
});

test("a merged chat holds both histories labelled by source, and leaves the originals unchanged", async () => {
  const { priorTurnsFor } = await import("../src/core/AIService");
  const { default: CrossChatResolver } = await import("../src/core/multichat/CrossChatResolver");
  const { store, research, question } = await threeChats();
  const researchBefore = structuredClone(store.get(research)!.messages);
  const questionBefore = structuredClone(store.get(question)!.messages);

  const merged = store.merge([question, research])!;
  assert.ok(merged);
  assert.equal(store.getActiveId(), merged.id);
  assert.equal(merged.title, "Merged: Pitch deck + Video research");
  assert.deepEqual(merged.messages.map((message) => message.origin?.title), ["Video research", "Video research", "Pitch deck"], "time order, each labelled");
  assert.deepEqual(store.get(research)!.messages, researchBefore, "the original was changed");
  assert.deepEqual(store.get(question)!.messages, questionBefore, "the original was changed");
  assert.ok(store.get(research)!.linkedIds.includes(merged.id) && merged.linkedIds.includes(research));

  // The model sees which chat each earlier message came from.
  store.addMessage(merged.id, { id: crypto.randomUUID(), role: "user", text: "Compare them for the pitch.", timestamp: Date.now() + 10, source: "local" });
  const turns = priorTurnsFor(merged.id, "Compare them for the pitch.")!;
  assert.match(turns[1].content, /^\[from the chat “Video research”\] Runway Gen-4/);
  assert.match(turns[2].content, /^\[from the chat “Pitch deck”\]/);

  // Its sources are already in its history: not read again, but named.
  const reference = CrossChatResolver.getInstance().reference(merged.id, "Compare them for the pitch.");
  assert.ok(!reference.used.some((source) => source.conversationId === research || source.conversationId === question));
  assert.match(reference.context, /THIS IS A MERGED CHAT/);
  assert.match(reference.context, /“Pitch deck” and “Video research”|“Video research” and “Pitch deck”/);
});

test("the activity shows which chats' research a reply used, and which it did not", () => {
  const activity = reduceActivity(emptyActivity(0), {
    type: "cross_chat_reference", taskId: "x",
    sources: [{ conversationId: "a", title: "Video research", authorization: "linked" }],
    suggested: ["Private video notes"],
  } as AgentEvent);
  assert.deepEqual(activity.steps.map((step) => step.label), [
    "Used research from the chat “Video research”",
    "Related, not used (not linked): “Private video notes”",
  ]);
  const summary = summarizeActivity(activity);
  assert.equal(summary.title, "Using other chats");
  assert.deepEqual(summary.facts, ["1 other chat used"]);
  assert.ok(hasVisibleActivity(activity));
});

test("three or more chats merge into one new chat, each message keeping the chat it came from", async () => {
  const { default: MultiChatStore } = await import("../src/core/multichat/MultiChatStore");
  const { default: CrossChatResolver } = await import("../src/core/multichat/CrossChatResolver");
  const store = MultiChatStore.getInstance();
  const t = Date.now();
  const make = (title: string, text: string, at: number) => {
    const id = store.createBackground(title).id;
    store.addMessage(id, { id: crypto.randomUUID(), role: "user", text, timestamp: at, source: "local" });
    return id;
  };
  const a = make("Budget", "Budget is 20k", t + 3);
  const b = make("Models", "Veo 3 vs Runway", t + 1);
  const c = make("Audience", "Investors in media", t + 2);
  const snapshot = [a, b, c].map((id) => structuredClone(store.get(id)!.messages));

  assert.equal(store.merge([a]), undefined, "one chat is not a merge");
  const merged = store.merge([a, b, c, a])!;
  assert.equal(merged.title, "Merged: Budget + Models + Audience");
  assert.deepEqual(merged.messages.map((m) => m.origin?.title), ["Models", "Audience", "Budget"], "time order across all three");
  assert.deepEqual([a, b, c].map((id) => store.get(id)!.messages), snapshot, "an original changed");
  assert.deepEqual([...merged.linkedIds].sort(), [a, b, c].sort());
  const note = CrossChatResolver.getInstance().reference(merged.id, "plan").context;
  for (const title of ["Budget", "Models", "Audience"]) assert.ok(note.includes(`“${title}”`), `the merged note does not name ${title}`);

  // Merging a merged chat keeps every message's FIRST source.
  const d = make("Timeline", "Launch in May", t + 4);
  const again = store.merge([merged.id, d])!;
  assert.deepEqual(again.messages.map((m) => m.origin?.title), ["Models", "Audience", "Budget", "Timeline"]);
  assert.equal(store.merge([a, b, c, d, merged.id, again.id])!.messages.length, 4 + 3 + 4, "every message from every chat");
});

test("a live turn is drawn only in the conversation it belongs to", async () => {
  const { readFileSync } = await import("node:fs");
  const chat = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");
  assert.match(chat, /conversationId: turnConversationId \};/, "the live turn records its conversation");
  assert.match(chat, /exchange\.conversationId !== state\.activeConversationId \? null : exchange/);
  assert.match(chat, /live=\{visibleExchange\}/, "the transcript must get the guarded exchange");
});

/* ------------------------------------------------------------------ *
 * OTHER CHATS FROM INSIDE THE CONVERSATION — the user's words decide
 * ------------------------------------------------------------------ */

async function chatsForTools() {
  const { default: MultiChatStore } = await import("../src/core/multichat/MultiChatStore");
  const store = MultiChatStore.getInstance();
  const t = Date.now();
  const add = (id: string, role: "user" | "assistant", text: string, at: number) =>
    store.addMessage(id, { id: crypto.randomUUID(), role, text, timestamp: at, source: "local" });
  const research = store.createBackground("Video model research").id;
  add(research, "user", "Compare AI video models", t + 1);
  add(research, "assistant", "Veo 3 has native audio; Runway Gen-4 has the best motion control.", t + 2);
  const here = store.createBackground("Pitch deck").id;
  add(here, "user", "Help me write the pitch deck intro", t + 3);
  return { store, research, here, add, t };
}

test("consent comes from what the user said: naming the chat, 'the other chat', or yes to her asking", async () => {
  const { consentFor } = await import("../src/core/multichat/ChatConsent");
  const { store, research, here, add, t } = await chatsForTools();
  const current = () => store.get(here)!;
  const target = store.get(research)!;
  const read = (prompt: string) => consentFor({ prompt, current: current(), target, action: "read" });

  assert.equal(read("Write the intro").ok, false, "nothing the user said allows reading it");
  assert.equal(read("Use what we found in the video model research for this").ok, true, "the user named it");
  assert.equal(read("Pull in the numbers from my other chat").ok, true, "the user referred to another chat");
  assert.equal(read("yes").ok, false, "a yes to nothing is not consent");
  add(here, "assistant", "Your “Video model research” chat compared Veo 3 and Runway — want me to use it, or merge the two?", t + 4);
  assert.equal(read("yes please").ok, true, "yes to her asking about this chat");
  assert.equal(consentFor({ prompt: "yes, merge them", current: current(), target, action: "merge" }).ok, true, "yes to her proposing a merge");
  assert.equal(consentFor({ prompt: "tell me about video model research", current: current(), target, action: "merge" }).ok, false, "naming a chat is not asking to merge it");
  assert.equal(consentFor({ prompt: "Merge this chat with Video model research", current: current(), target, action: "merge" }).ok, true);
  assert.equal(consentFor({ prompt: "Link the video model research chat here", current: current(), target, action: "link" }).ok, true);
});

test("chats_read refuses an unmentioned chat without reading it, and reads one the user brought up", async () => {
  const { store, research, here } = await chatsForTools();
  const timestamp = Date.now() + 777;
  const seen: AgentEvent[] = [];
  const off = AgentEventBus.getInstance().subscribe((event) => { if (event.taskId === String(timestamp)) seen.push(event); });
  try {
    const context = (prompt: string) => ({ request: { prompt, timestamp, conversationId: here } }) as never;
    const refused = await dispatchToolCall({ id: "1", name: "chats_read", arguments: { chat: "Video model research" } }, String(timestamp), context("Write the intro"));
    assert.equal(refused.ok, false);
    assert.doesNotMatch(refused.content, /Veo 3/, "the refusal leaked the chat's content");
    assert.match(refused.content, /Ask them first/);

    const read = await dispatchToolCall({ id: "2", name: "chats_read", arguments: { chat: "video model" } }, String(timestamp), context("Use the video model research chat for the intro"));
    assert.equal(read.ok, true);
    assert.match(read.content, /From the chat “Video model research”/);
    assert.match(read.content, /Veo 3 has native audio/);
    assert.match(read.content, /say it came from “Video model research”/);
    const reference = seen.find((event) => event.type === "cross_chat_reference") as Extract<AgentEvent, { type: "cross_chat_reference" }>;
    assert.deepEqual(reference.sources.map((source) => [source.title, source.authorization]), [["Video model research", "asked"]]);
    assert.equal(store.get(research)!.linkedIds.includes(here), false, "reading is not linking");
  } finally {
    off();
  }
});

test("chats_merge and chats_link act only on the user's request, and a merge does not pull the user away", async () => {
  const { default: NotificationProvider } = await import("../src/core/notifications/NotificationProvider");
  const { store, research, here } = await chatsForTools();
  store.switchActive(here);
  const before = structuredClone(store.get(research)!.messages);
  const context = (prompt: string) => ({ request: { prompt, timestamp: Date.now(), conversationId: here } }) as never;

  const refused = await dispatchToolCall({ id: "m0", name: "chats_merge", arguments: { chats: ["Video model research"] } }, "t-m0", context("What should the intro say?"));
  assert.equal(refused.ok, false, "merged without being asked");

  NotificationProvider.getInstance().clearHistory();
  const merged = await dispatchToolCall({ id: "m1", name: "chats_merge", arguments: { chats: ["Video model research"] } }, "t-m1", context("Merge this chat with the video model research chat"));
  assert.equal(merged.ok, true, merged.content);
  const mergedId = (merged.data as { mergedId: string }).mergedId;
  assert.equal(store.getActiveId(), here, "the user was pulled out of the chat they are in");
  assert.deepEqual(store.get(mergedId)!.messages.map((m) => m.origin?.title), ["Video model research", "Video model research", "Pitch deck"]);
  assert.deepEqual(store.get(research)!.messages, before, "an original was changed");
  assert.ok(NotificationProvider.getInstance().history().some((record) => record.conversationId === mergedId), "the merged chat is findable from Notifications");
  assert.match(merged.content, /original chats are unchanged/);

  assert.equal((await dispatchToolCall({ id: "l0", name: "chats_link", arguments: { chat: "Video model research" } }, "t-l0", context("ok"))).ok, false);
  const linked = await dispatchToolCall({ id: "l1", name: "chats_link", arguments: { chat: "Video model research" } }, "t-l1", context("Link the video model research chat to this one"));
  assert.equal(linked.ok, true);
  assert.ok(store.get(here)!.linkedIds.includes(research));
  NotificationProvider.getInstance().clearHistory();
});

test("finding a chat by name picks the closest title, not a merge that contains it", async () => {
  const { findChat } = await import("../src/core/multichat/ChatConsent");
  const make = (id: string, title: string) => ({ id, title, messages: [], createdAt: 0, updatedAt: 0, pinned: false, archived: false, linkedIds: [], projectId: null, tags: [], topic: "", unread: 0, processing: false });
  const chats = [make("m", "Merged: Pitch deck + Video model research"), make("v", "Video model research"), make("p", "Pitch deck")];
  assert.equal(findChat("Video model research", chats)?.id, "v");
  assert.equal(findChat("video model", chats)?.id, "v");
  assert.equal(findChat("the video research chat", chats)?.id, "v");
  assert.equal(findChat("merged", chats)?.id, "m");
  assert.equal(findChat("Pitch deck", chats, "p")?.id, "m", "the current chat is never a target");
});

test("what the user says while the turn is running counts as their words", async () => {
  const { store, here } = await chatsForTools();
  const context = { request: { prompt: "Draft the intro", timestamp: Date.now(), conversationId: here, steered: ["and merge it with the video model research chat"] } } as never;
  const merged = await dispatchToolCall({ id: "s1", name: "chats_merge", arguments: { chats: ["Video model research"] } }, "t-s1", context);
  assert.equal(merged.ok, true, merged.content);
  assert.equal(store.getActiveId() === (merged.data as { mergedId: string }).mergedId, false);
});

test("naming another chat in the message brings its research in, labelled; 'my other chat' brings only the best match", async () => {
  const { default: CrossChatResolver } = await import("../src/core/multichat/CrossChatResolver");
  const { store, research, here } = await chatsForTools();
  const resolver = CrossChatResolver.getInstance();
  const named = resolver.reference(here, "Use what we found in my Video model research chat to improve the pitch line");
  assert.deepEqual(named.used.map((source) => [source.title, source.authorization]).slice(0, 1), [["Video model research", "asked"]]);
  assert.match(named.context, /From the chat “Video model research” \(the user brought it up\)/);
  assert.match(named.context, /Veo 3 has native audio/);
  assert.equal(store.get(here)!.linkedIds.includes(research), false, "bringing a chat up is not linking it");

  const generic = resolver.reference(here, "Pull the native audio notes from my other chat");
  assert.equal(generic.used.length, 1, "a vague 'other chat' pulled in more than the best match");
  assert.match(generic.context, /Veo 3 has native audio/, "the best match is the chat holding that research");
});

test("merging and linking from the conversation are named in the activity", () => {
  let activity = emptyActivity(0);
  for (const event of [
    { type: "tool_started", taskId: "t", tool: "chats.merge", label: "Merging chats into a new chat" },
    { type: "tool_result", taskId: "t", tool: "chats.merge", result: "Created the merged chat", results: [], status: "complete" },
  ] as AgentEvent[]) activity = reduceActivity(activity, event);
  const summary = summarizeActivity(activity);
  assert.equal(summary.title, "Using other chats");
  assert.deepEqual(summary.facts, ["merged into a new chat"]);
});

/* ------------------------------------------------------------------ *
 * HER COGNITION, LABELLED BY CHAT
 * ------------------------------------------------------------------ */

test("context lines quoting another chat are labelled with that chat; this chat's are not", async () => {
  const { labelOtherChats } = await import("../src/core/multichat/ContextProvenance");
  const make = (id: string, title: string, texts: string[]) => ({
    id, title, createdAt: 0, updatedAt: 0, pinned: false, archived: false, linkedIds: [], projectId: null, tags: [], topic: "", unread: 0, processing: false,
    messages: texts.map((text, index) => ({ id: `${id}-${index}`, role: (index % 2 ? "assistant" : "user") as "user" | "assistant", text, timestamp: index, source: "local" as const })),
  });
  const chats = [
    make("a", "Launch plans", ["Remember for this chat: our product codename is ZORBLAX-PELICAN and the launch city is Reykjavik.", "Got it — codename ZORBLAX-PELICAN, launching in Reykjavik."]),
    make("c", "Codename question", ["What is our product codename? I forgot what we called it."]),
  ];
  const context = [
    "## About the user",
    "- Remember for this chat: our product codename is ZORBLAX-PELICAN and the launch city is Reykjavik. Just confi",
    "## Cognitive State",
    "Recent knowledge nodes: Remember for this chat: our product codename is ZORBLAX-PELICAN and the launch city",
    "Last action: Complete “Remember for this chat: our product codename is ZORBLAX-PELICAN and the launch city”",
    "Current: What is our product codename? I forgot what we called it.",
    "## Projects",
  ].join("\n");
  const result = labelOtherChats(context, "c", chats);
  const lines = result.context.split("\n");
  assert.deepEqual(result.labelled, ["Launch plans"]);
  assert.equal(lines.filter((line) => line.startsWith("[from the chat “Launch plans”]")).length, 3, "all three quotes of the other chat are labelled");
  assert.ok(lines.includes("Current: What is our product codename? I forgot what we called it."), "this chat's own line was changed");
  assert.match(result.context, /^## FROM OTHER CHATS[\s\S]*say where it came from/, "the note leads the context");
  assert.equal(result.context.split("## FROM OTHER CHATS").length - 1, 2, "and closes it");
  assert.match(result.context, /another of the user's chats \(“Launch plans”\)/);
  assert.equal(labelOtherChats(result.context, "c", chats).context, result.context, "labelling twice changes nothing");
  assert.equal(labelOtherChats("## Projects\n- General", "c", chats).context, "## Projects\n- General", "nothing to label: untouched");
});

test("'remember this for this chat' is kept to that chat, not long-term memory", async () => {
  const { CHAT_SCOPED } = await import("../src/core/multichat/ContextProvenance");
  for (const text of ["Remember for this chat: the codename is X", "Only in this chat, call me Captain", "Don't remember this, it's temporary", "Keep it in this conversation"]) {
    assert.ok(CHAT_SCOPED.test(text), text);
  }
  for (const text of ["Remember that my name is Heru", "What did we say in the other chat?"]) {
    assert.ok(!CHAT_SCOPED.test(text), text);
  }
});

test("the provider sees other chats' content labelled, at the last step before the call", async () => {
  const { default: ProviderResolver } = await import("../src/core/router/ProviderResolver");
  const { default: MultiChatStore } = await import("../src/core/multichat/MultiChatStore");
  const store = MultiChatStore.getInstance();
  const other = store.createBackground("Secret launch plans").id;
  store.addMessage(other, { id: crypto.randomUUID(), role: "user", text: "The secret launch venue is the Harpa concert hall in Reykjavik, keep it quiet.", timestamp: Date.now(), source: "local" });
  const here = store.createBackground("Announcement draft").id;
  let seen = "";
  const provider = {
    name: "Spy", priority: 1, enabled: true, timeout: 10000, requiresApiKey: false, capabilities: ["chat"] as const,
    initialize: async () => {}, isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }), canHandle: () => true,
    generate: async (request: { context?: string }) => { seen = request.context ?? ""; return { text: "ok", provider: "spy", model: "spy", processingTime: 1 }; },
  };
  await new ProviderResolver().execute({
    request: { prompt: "Draft the announcement", messages: [], timestamp: Date.now(), conversationId: here, context: "## About the user\n- The secret launch venue is the Harpa concert hall in Reykjavik, keep it quiet." },
    started: Date.now(), logger: new ExecutionLogger(),
    aiProviders: { available: async () => [provider], names: () => ["spy"], markFailure: () => {}, markSuccess: () => {}, all: () => [provider], get: () => provider },
  } as never);
  assert.match(seen, /\[from the chat “Secret launch plans”\] - The secret launch venue/);
  assert.match(seen, /## FROM OTHER CHATS/);
});

test("memory.store keeps 'for this chat' to the chat, and labels what it stores with its chat", async () => {
  const { default: AIService } = await import("../src/core/AIService");
  const { default: MultiChatStore } = await import("../src/core/multichat/MultiChatStore");
  const ai = AIService.getInstance();
  const stored: string[] = [];
  const realConsolidate = ai.consolidate.bind(ai);
  (ai as unknown as { consolidate: (kind: string, summary: string) => Promise<boolean> }).consolidate = async (_kind, summary) => { stored.push(summary); return true; };
  try {
    const chat = MultiChatStore.getInstance().createBackground("Launch plans").id;
    const scoped = await dispatchToolCall(
      { id: "m1", name: "memory_store", arguments: { summary: "Product codename ZORBLAX-PELICAN" } }, "t-m1",
      { request: { prompt: "Remember for this chat: our codename is ZORBLAX-PELICAN", timestamp: Date.now(), conversationId: chat } } as never,
    );
    assert.equal(scoped.ok, true);
    assert.match(scoped.content, /Not stored long-term/);
    assert.deepEqual(stored, [], "a chat-scoped fact reached long-term memory");

    await dispatchToolCall(
      { id: "m2", name: "memory_store", arguments: { summary: "The CFO is Marta Vilhjalmsdottir" } }, "t-m2",
      { request: { prompt: "Remember that our CFO is Marta Vilhjalmsdottir", timestamp: Date.now(), conversationId: chat } } as never,
    );
    assert.deepEqual(stored, ["The CFO is Marta Vilhjalmsdottir (learned in the chat “Launch plans”)"]);
  } finally {
    (ai as unknown as { consolidate: typeof realConsolidate }).consolidate = realConsolidate;
  }
});
