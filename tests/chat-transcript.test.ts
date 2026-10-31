/**
 * ==========================================================
 * LÉLU — CLOUD CONVERSATION: what the chat shows
 *
 * CATEGORY: unit. The transcript the redesigned chat renders is
 * decided by pure functions over the existing conversation store,
 * so the rules that matter — history scrolls, a streamed reply is
 * never shown twice, "thinking" is never claimed when nothing is
 * in flight, failures are said in words and not "undefined" — are
 * tested here directly.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildTranscript,
  describeFailure,
  isDisplayableText,
  isNearBottom,
  TRANSCRIPT_PAGE,
  type TranscriptMessage,
} from "../src/app/scene/genesis/chat/chatTranscript";
import { chatFillsScreen } from "../src/app/scene/genesis/chat/chatLayout";

const msg = (id: string, role: "user" | "assistant", text: string, at = 0): TranscriptMessage => ({ id, role, text, timestamp: at });

test("the whole conversation is the transcript — not just the last exchange", () => {
  const all = [msg("1", "user", "hi"), msg("2", "assistant", "hello"), msg("3", "user", "and?"), msg("4", "assistant", "more")];
  const view = buildTranscript(all, null, false, TRANSCRIPT_PAGE);
  assert.deepEqual(view.messages.map((m) => m.id), ["1", "2", "3", "4"]);
  assert.equal(view.hiddenBefore, 0);
  assert.equal(view.latestUserId, "3", "the latest question is marked, for 'the question on screen'");
  assert.deepEqual(view.tail, []);
});

test("long conversations are windowed, with the count of what is hidden", () => {
  const all = Array.from({ length: 130 }, (_, i) => msg(String(i), i % 2 ? "assistant" : "user", `m${i}`));
  const view = buildTranscript(all, null, false, 40);
  assert.equal(view.messages.length, 40);
  assert.equal(view.messages[0].id, "90", "the newest messages are the ones shown");
  assert.equal(view.hiddenBefore, 90);
  assert.equal(buildTranscript(all, null, false, 80).messages.length, 80, "showing earlier widens the window");
});

test("a streamed reply shows once: live until stored, then only from the store", () => {
  const before = [msg("u1", "user", "question")];
  const live = { id: "x", user: "question", assistant: "partial ans", userMessageId: "u1" };
  assert.deepEqual(buildTranscript(before, live, true, 40).tail, [{ kind: "streaming", text: "partial ans" }]);
  const stored = [...before, msg("a1", "assistant", "partial answer")];
  const view = buildTranscript(stored, { ...live, assistant: "partial answer" }, true, 40);
  assert.deepEqual(view.tail, [], "once the store has it, it is not painted a second time");
  assert.equal(view.messages.length, 2);
  assert.equal(view.streamingId, "a1", "the stored partial is the bubble still being written");
  assert.equal(buildTranscript(stored, { ...live, assistant: "partial answer" }, false, 40).streamingId, null, "finished → no caret");
});

test("'thinking' only while a turn is really in flight and nothing has arrived", () => {
  const all = [msg("u1", "user", "question")];
  const live = { id: "x", user: "question", assistant: "", userMessageId: "u1" };
  assert.deepEqual(buildTranscript(all, live, true, 40).tail, [{ kind: "thinking" }]);
  assert.deepEqual(buildTranscript(all, live, false, 40).tail, [], "nothing in flight → no false thinking dots");
  assert.deepEqual(buildTranscript(all, { ...live, settled: true }, true, 40).tail, [], "a replayed exchange is history, not a live turn");
});

test("a failure is shown in the conversation, and replaces 'thinking'", () => {
  const all = [msg("u1", "user", "question")];
  const failure = describeFailure(new Error("Request timed out after 30000ms"), "question");
  const view = buildTranscript(all, { id: "x", user: "question", assistant: "", userMessageId: "u1", error: failure }, true, 40);
  assert.deepEqual(view.tail.map((t) => t.kind), ["failure"]);
  assert.equal(failure.title, "LÉLU couldn't complete that");
  assert.match(failure.detail, /stopped responding/);
  assert.equal(failure.retryText, "question", "the failed words can be sent again");
});

test("voice turns (no stored id) anchor on the latest matching question", () => {
  const all = [msg("u0", "user", "hello"), msg("a0", "assistant", "hi"), msg("u1", "user", "hello")];
  const view = buildTranscript(all, { id: "voice-1", user: "hello", assistant: "" }, true, 40);
  assert.deepEqual(view.tail, [{ kind: "thinking" }], "the earlier reply to an earlier 'hello' does not count as this one's");
});

test("'undefined' and friends are never painted as speech", () => {
  for (const bad of ["undefined", " null ", "NaN", "[object Object]", "", "   "]) assert.equal(isDisplayableText(bad), false, JSON.stringify(bad));
  assert.equal(isDisplayableText(undefined), false);
  assert.equal(isDisplayableText("undefined behaviour is a C topic"), true, "only the bare token is rejected");
  const all = [msg("u1", "user", "q"), msg("a1", "assistant", "undefined"), msg("a2", "assistant", "real")];
  assert.deepEqual(buildTranscript(all, null, false, 40).messages.map((m) => m.id), ["u1", "a2"]);
});

test("raw errors become plain words — never 'undefined error'", () => {
  assert.match(describeFailure(undefined).detail, /didn't say what/);
  assert.match(describeFailure(new Error("undefined")).detail, /didn't say what/);
  assert.match(describeFailure("TypeError: Failed to fetch").detail, /network/);
  assert.match(describeFailure(new Error("Groq failed 401: Invalid API Key")).detail, /credentials/);
  assert.match(describeFailure(new Error("429 Too Many Requests")).detail, /rate-limiting/);
  assert.match(describeFailure(new Error("503 Service Unavailable")).detail, /server problem/);
  assert.match(describeFailure("The assistant returned an empty response.").detail, /nothing/);
  const long = describeFailure(new Error("x".repeat(400))).detail;
  assert.ok(long.length <= 220, "an unrecognised message is kept, but bounded");
  assert.equal(describeFailure(new Error("boom"), "undefined").retryText, undefined);
});

test("following the latest line: near the bottom keeps following, scrolled up does not", () => {
  assert.equal(isNearBottom(2000, 1300, 650), true);
  assert.equal(isNearBottom(2000, 900, 650), false);
});

test("phones in portrait AND landscape get the full-screen sky", () => {
  assert.equal(chatFillsScreen({ width: 390, height: 844 }), true, "iPhone portrait");
  assert.equal(chatFillsScreen({ width: 844, height: 390 }), true, "iPhone landscape — wide but short");
  assert.equal(chatFillsScreen({ width: 360, height: 740 }), true, "narrow Android");
  assert.equal(chatFillsScreen({ width: 820, height: 1180 }), false, "tablet floats a window");
  assert.equal(chatFillsScreen({ width: 1440, height: 900 }), false, "desktop floats a window");
});

/* ---------- the redesign is presentation over the existing systems ---------- */

const chat = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");

test("the transcript renders the existing conversation store, through the one chat", () => {
  assert.match(chat, /<ChatTranscript[\s\S]{0,80}messages=\{state\.messages\}/, "history comes from state.messages (GenesisBridge already upserts streamed replies there)");
  assert.match(chat, /Orchestrator\.getInstance\(\)\.process\(/, "sending still goes through the existing Orchestrator");
  assert.match(chat, /ai\.chat\(prompt, media, context/, "media still goes through AIService.chat");
  assert.ok(!/new AbortController/.test(chat), "cancellation is still ai.cancelTurn only");
});

test("activity is part of the conversation, not a band pasted under it", () => {
  assert.match(chat, /const activity = useMemo\(\(\) => <GenesisExecutionTimeline conversationId=\{state\.activeConversationId\} approvalsOnly \/>/, "approvals for the open conversation only");
  assert.match(chat, /activity=\{activity\}/);
  const timeline = readFileSync("src/app/scene/genesis/GenesisExecutionTimeline.tsx", "utf8");
  assert.ok(!/maxHeight: "32vh"|overflowY: "auto"/.test(timeline), "the expanded steps flow inline — no second scroll area");
  assert.match(timeline, /aria-expanded=\{Boolean\(expanded\[tasks\[0\]\.id\]\)\}/, "it is a real disclosure control");
});

test("every header control is its own button in one group, with a label", () => {
  const header = chat.slice(chat.indexOf('className="lelu-cc-controls"'), chat.indexOf("{optionsOpen ? ("));
  for (const label of ["Chat options", "Open LÉLU menu", "Close chat"]) assert.ok(header.includes(`aria-label="${label}"`), label);
  const css = readFileSync("src/app/scene/genesis/chat/cloudChat.css", "utf8");
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.lelu-cc \{ --cc-hit: 44px; \}/, "touch targets are 44px on touch screens");
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.lelu-cc-clouds \{ animation: none; \}/, "the sky holds still for reduced motion");
});

test("only the user can stop the view following the reply", () => {
  assert.match(chat, /const userDriven = performance\.now\(\) - userScrollAtRef\.current < 1200;/);
  for (const handler of ["onWheel", "onTouchStart", "onTouchMove", "onPointerDown", "onKeyDown"]) {
    assert.match(chat, new RegExp(`${handler}=\\{markUserScroll\\}`), handler);
  }
});

test("Stop pressed before the turn reaches chat() is honoured, and never leaks into the next turn", async () => {
  const { default: AIService } = await import("../src/core/AIService");
  const ai = AIService.getInstance() as unknown as {
    cancelTurn(id: string): void;
    beginTurn(id: string): void;
    pendingCancels: Set<string>;
  };
  ai.cancelTurn("conv-stop");
  assert.ok(ai.pendingCancels.has("conv-stop"), "no controller yet → the Stop is held, not dropped");
  ai.beginTurn("conv-stop");
  assert.ok(!ai.pendingCancels.has("conv-stop"), "a new turn starts with no Stop pending");
  const source = readFileSync("src/core/AIService.ts", "utf8");
  assert.match(source, /if \(this\.pendingCancels\.delete\(options\.conversationId\)\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*controller\.abort\(\);\s*throw new DOMException\("Turn stopped before it started\.", "AbortError"\);/, "the held Stop settles the turn as cancelled when its chat() starts");
  assert.match(chat, /claimTurn\(turnConversationId\);\s*\/\/[^\n]*\n\s*ai\.beginTurn\(turnConversationId\);/, "each chat turn clears a stale Stop first");
});
