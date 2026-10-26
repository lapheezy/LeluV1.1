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
  assert.match(source, /if \(surface && !ownedByChat &&/);
});
