/**
 * ==========================================================
 * LÉLU — ONE AUTHORITY FOR THE ACTIVE WORKSPACE
 *
 * CATEGORY: integration. The real MultiChatStore and the real
 * Workstream helper, against a shimmed localStorage.
 *
 * Why this exists, measured in a real browser: a message was
 * stored in a DIFFERENT conversation from the one the store
 * reported active. GenesisCore kept `state.activeConversationId`
 * in React state and wrote every message to it, while
 * MultiChatStore kept its own `activeId`, and nothing
 * synchronised them. Anything that switched conversation from
 * outside React — Workstream.openWorkstream(), which cognition
 * calls when a suggestion is explored — moved the store's
 * pointer and left the view's behind.
 *
 * Two sources of truth for one fact is the bug. These pin the
 * store as the single authority, and pin the property that
 * matters to the user: what you type goes where you are.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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

import MultiChatStore from "../src/core/multichat/MultiChatStore";
import ProjectStore from "../src/core/projects/ProjectStore";
import { openWorkstream } from "../src/core/proactive/Workstream";
import {
  claimTurn,
  releaseTurn,
  currentTurnOwner,
  ownerForMessage,
  resetTurnOwnership,
} from "../src/core/multichat/TurnOwnership";

const chats = MultiChatStore.getInstance();

function message(id: string, text: string) {
  return { id, role: "user" as const, text, timestamp: Date.now(), source: "local" as const };
}

test("switching active conversation moves the store's own pointer", () => {
  const a = chats.create("Workspace A");
  const b = chats.create("Workspace B");
  chats.switchActive(a.id);
  assert.equal(chats.getActiveId(), a.id);
  chats.switchActive(b.id);
  assert.equal(chats.getActiveId(), b.id, "the store must actually switch");
});

test("A -> B -> A returns to the original workspace", () => {
  const a = chats.create("Round trip A");
  const b = chats.create("Round trip B");
  chats.switchActive(a.id);
  chats.switchActive(b.id);
  chats.switchActive(a.id);
  assert.equal(chats.getActiveId(), a.id);
});

test("a message is written to the conversation that is active NOW", () => {
  const a = chats.create("Writes A");
  const b = chats.create("Writes B");

  chats.switchActive(a.id);
  chats.addMessage(chats.getActiveId(), message("m-a", "ALPHA"));

  chats.switchActive(b.id);
  chats.addMessage(chats.getActiveId(), message("m-b", "BETA"));

  const textsIn = (id: string) => (chats.get(id)?.messages ?? []).map((m) => m.text);
  assert.ok(textsIn(a.id).includes("ALPHA"));
  assert.ok(textsIn(b.id).includes("BETA"));
  assert.ok(!textsIn(a.id).includes("BETA"), "B's message must not appear in A");
  assert.ok(!textsIn(b.id).includes("ALPHA"), "A's message must not appear in B");
});

test("every marker lives in exactly one conversation", () => {
  const a = chats.create("Exactly A");
  const b = chats.create("Exactly B");
  chats.switchActive(a.id);
  chats.addMessage(chats.getActiveId(), message("x-a", "MARKER-ONLY-ONCE"));
  chats.switchActive(b.id);

  const holders = chats
    .listAll()
    .filter((c) => c.messages.some((m) => m.text === "MARKER-ONLY-ONCE"));
  assert.equal(holders.length, 1, "state leaked between workspaces");
  assert.equal(holders[0].id, a.id);
});

/* ------------- cognition switching must move the same pointer ------------- */

test("openWorkstream changes the ACTUAL active conversation", () => {
  // This is the path cognition takes when a suggestion is explored. It used
  // to move the store's pointer while the UI kept writing to its own stale
  // mirror, which is how a message ended up in the previous conversation.
  const project = ProjectStore.getInstance().create({ name: "Fashion authority" });
  const before = chats.create("Something else");
  chats.switchActive(before.id);
  assert.equal(chats.getActiveId(), before.id);

  const context = openWorkstream(project.id, { seed: false });
  assert.ok(context, "the workstream must open");
  assert.equal(
    chats.getActiveId(),
    context.conversation.id,
    "cognition's switch must move the one authoritative pointer",
  );
  assert.notEqual(chats.getActiveId(), before.id);
});

test("a message sent after a cognition switch lands in the workstream", () => {
  const project = ProjectStore.getInstance().create({ name: "Jewelry authority" });
  const other = chats.create("Unrelated");
  chats.switchActive(other.id);
  chats.addMessage(chats.getActiveId(), message("pre", "BEFORE-SWITCH"));

  const context = openWorkstream(project.id, { seed: false });
  assert.ok(context);
  chats.addMessage(chats.getActiveId(), message("post", "AFTER-SWITCH"));

  const workstream = chats.get(context.conversation.id);
  const unrelated = chats.get(other.id);
  assert.ok(workstream?.messages.some((m) => m.text === "AFTER-SWITCH"));
  assert.ok(!workstream?.messages.some((m) => m.text === "BEFORE-SWITCH"));
  assert.ok(unrelated?.messages.some((m) => m.text === "BEFORE-SWITCH"));
  assert.ok(
    !unrelated?.messages.some((m) => m.text === "AFTER-SWITCH"),
    "the previous workspace must not receive messages typed after the switch",
  );
});

test("subscribers are told when the active conversation changes", () => {
  // GenesisCore follows the store through this notification. Without it the
  // view cannot know that cognition moved the pointer.
  const a = chats.create("Notify A");
  const b = chats.create("Notify B");
  chats.switchActive(a.id);

  let notifications = 0;
  const unsubscribe = chats.subscribe(() => { notifications += 1; });
  const baseline = notifications;
  chats.switchActive(b.id);
  unsubscribe();

  assert.ok(notifications > baseline, "a switch must notify subscribers");
  assert.equal(chats.getActiveId(), b.id);
});

test("the UI reads the active id from the store, never from its own mirror", () => {
  // The write paths in GenesisCore must not reach for React state: it is a
  // render-time copy, and after an external switch it names the old one.
  const source = readFileSync("src/app/scene/genesis/GenesisCore.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const call of ["addMessage", "upsertMessage", "clear", "buildContext"]) {
    const line = source.split("\n").find((l) => l.includes(`multiChat.${call}(`) || l.includes(`crossChat.${call}(`));
    if (!line) continue;
    assert.ok(
      !line.includes("state.activeConversationId"),
      `${call} must target multiChat.getActiveId(), not the React mirror`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * A REPLY BELONGS TO THE CONVERSATION IT WAS ASKED IN
 *
 * Measured in a real browser (scripts/verify-workspace-isolation.mjs):
 * send in chat A, open chat B before the reply lands, and A's reply was
 * written into B. A then held a question with no answer and B held an
 * answer to a question it never asked.
 *
 * The user's own message was never the problem — it is written while the
 * right conversation is still active. The reply arrives seconds later
 * through one global subscription (GenesisBridge → AIService) that carries
 * no conversation of its own, so it went wherever the selected tab pointed.
 * ------------------------------------------------------------------ */

test("a reply is routed to the conversation that claimed the turn, not the selected tab", () => {
  resetTurnOwnership();
  const asked = chats.create("Asked here").id;
  const switchedTo = chats.create("Switched here").id;
  chats.switchActive(asked);

  claimTurn(asked);
  // The first chunk of the reply binds this message id to the claimant.
  assert.equal(ownerForMessage("reply-1"), asked);

  // The user switches away while the reply is still arriving.
  chats.switchActive(switchedTo);
  assert.equal(chats.getActiveId(), switchedTo);

  // Later chunks of the SAME reply still belong where the question was.
  assert.equal(ownerForMessage("reply-1"), asked);
  releaseTurn(asked);
  assert.equal(ownerForMessage("reply-1"), asked, "a settled binding must survive the release");
});

test("a second turn elsewhere does not capture the first turn's reply", () => {
  resetTurnOwnership();
  const first = chats.create("First").id;
  const second = chats.create("Second").id;

  claimTurn(first);
  assert.equal(ownerForMessage("slow-reply"), first);

  // The user starts a new turn in another conversation before the first
  // reply finishes — the case a single "current conversation" cannot get
  // right, and the reason bindings are per message rather than global.
  claimTurn(second);
  assert.equal(ownerForMessage("fast-reply"), second);
  assert.equal(ownerForMessage("slow-reply"), first, "the slow reply changed conversation mid-stream");
});

test("the first turn finishing late does not release the second turn's claim", () => {
  resetTurnOwnership();
  const first = chats.create("First late").id;
  const second = chats.create("Second live").id;
  claimTurn(first);
  claimTurn(second);

  releaseTurn(first);
  assert.equal(currentTurnOwner(), second, "an overlapping turn's claim was cleared by the wrong finally");

  releaseTurn(second);
  assert.equal(currentTurnOwner(), null);
});

test("with no turn in flight there is no owner, so cognition speaks into the open chat", () => {
  // A proactive suggestion is not a reply to anything. It belongs in the
  // conversation the user is actually looking at, which is what a null
  // owner tells the caller to fall back to.
  resetTurnOwnership();
  assert.equal(currentTurnOwner(), null);
  assert.equal(ownerForMessage("proactive-1"), null);
});

test("every message write consults the turn owner before the active id", () => {
  const source = readFileSync("src/app/scene/genesis/GenesisCore.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const writes = source.match(/const targetId = [^;]+;/g) ?? [];
  assert.ok(writes.length >= 2, "expected addMessage and upsertMessage to each resolve a target");
  for (const write of writes) {
    assert.match(
      write,
      /ownerForMessage\(message\.id\) \?\? multiChat\.getActiveId\(\)/,
      `a message write resolves its target without the turn owner: ${write}`,
    );
  }
});

test("a message routed elsewhere does not overwrite the visible transcript", () => {
  // The mirror into React state is guarded on the target BEING the active
  // conversation. Without that, storing a reply in a background
  // conversation repainted the foreground one with its messages.
  const source = readFileSync("src/app/scene/genesis/GenesisCore.tsx", "utf8");
  const guards = source.match(/messages: targetId === activeId && active \? active\.messages : current\.messages,/g) ?? [];
  assert.equal(guards.length, 2, "both message writes must guard the visible mirror on the active id");
});

/* ------------------------------------------------------------------ *
 * THE VIEW FOLLOWS THE ACTIVE WORKSPACE
 * ------------------------------------------------------------------ */

test("the chat rebuilds its visible exchange when the active conversation changes", () => {
  // Measured: switching back to a conversation showed neither its own
  // message nor the other's — the replay ran on mount only, and the fade
  // timer had already cleared what was on screen.
  const source = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");
  assert.match(source, /function replayExchange\(/, "the replay must be reusable, not inline in a mount effect");
  assert.match(
    source,
    /setExchange\(replayExchange\(state\.messages\)\);/,
    "nothing rebuilds the visible exchange from the active conversation's history",
  );
  assert.match(
    source,
    /\}, \[state\.activeConversationId, state\.messages, clearTimers, setDialogue\]\);/,
    "the rebuild is not keyed on the active conversation, so switching tabs cannot trigger it",
  );
});

test("a reply is only painted into the scene while its own conversation is on screen", () => {
  const source = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /const stillViewingTurn = \(\) =>/);
  // Every post-await paint must be behind that guard.
  assert.ok(
    (source.match(/stillViewingTurn\(\)/g) ?? []).length >= 3,
    "a settled reply still paints into the scene without checking which conversation is open",
  );
});

/* ------------------------------------------------------------------ *
 * BACKGROUND WORK DOES NOT MOVE THE USER
 *
 * Measured before this guard: cognition's 10-second tick reaches
 * SelfDevelopmentEngine.announce() → EngineeringChat.getOrCreateThread()
 * → MultiChatStore.create(), and create() sets activeId unconditionally.
 * So the first self-development observation of a session moved the user
 * into the engineering thread. A person who had just asked a question
 * watched an unrelated observation appear in its place, while their own
 * answer landed — correctly, by turn ownership — in a conversation they
 * were no longer looking at. The reply was never lost; the user was.
 * ------------------------------------------------------------------ */

test("a background conversation is created without selecting it", () => {
  const a = chats.create("User's own chat").id;
  assert.equal(chats.getActiveId(), a);

  // Not the "engineering" tag: EngineeringChat finds its one thread BY
  // that tag, and a test fixture wearing it would be adopted as the real
  // engineering thread by the test below.
  const b = chats.createBackground("Background thread", ["background-fixture"]).id;

  assert.notEqual(b, a);
  assert.equal(chats.getActiveId(), a, "background creation moved the user");
  assert.ok(chats.get(b), "the background conversation was not stored");
  assert.deepEqual(chats.get(b)?.tags, ["background-fixture"], "tags must be applied at creation");
});

test("a background conversation still receives its own messages", () => {
  const a = chats.create("Still here").id;
  const b = chats.createBackground("Autonomous work").id;

  chats.addMessage(b, message("bg-1", "BACKGROUND-marker"));

  assert.equal(chats.getActiveId(), a, "writing to a background conversation moved the user");
  assert.equal(chats.get(b)?.messages.length, 1);
  assert.equal(chats.get(b)?.messages[0].text, "BACKGROUND-marker");
  assert.equal(chats.get(a)?.messages.some((m) => m.text === "BACKGROUND-marker"), false);
});

test("a streamed reply stays attached to the background conversation that asked", () => {
  // The same property turn ownership gives a foreground turn, for a turn
  // the runtime started on its own: a reply arriving in pieces belongs to
  // the conversation it was asked in, whatever the user selects meanwhile.
  resetTurnOwnership();
  const a = chats.create("User reading this").id;
  const b = chats.createBackground("Autonomous work").id;

  claimTurn(b);
  const replyId = "stream-1";
  assert.equal(ownerForMessage(replyId), b);

  // Partial, then final — with the user elsewhere the whole time.
  chats.upsertMessage(ownerForMessage(replyId) ?? a, {
    id: replyId, role: "assistant", text: "partial", timestamp: Date.now(), source: "ai",
  });
  assert.equal(chats.getActiveId(), a);
  chats.upsertMessage(ownerForMessage(replyId) ?? a, {
    id: replyId, role: "assistant", text: "partial and then complete", timestamp: Date.now(), source: "ai",
  });
  releaseTurn(b);

  assert.equal(chats.getActiveId(), a, "a background stream moved the user");
  assert.equal(chats.get(b)?.messages.length, 1, "the stream duplicated instead of upserting");
  assert.equal(chats.get(b)?.messages[0].text, "partial and then complete");
  assert.equal(chats.get(a)?.messages.length, 0, "the background stream leaked into the user's chat");
});

test("a background conversation is discoverable by its tag", () => {
  const b = chats.createBackground("Findable", ["background-fixture", "autonomous"]).id;
  const found = chats.list().find((conversation) => conversation.tags.includes("autonomous"));
  assert.equal(found?.id, b);
});

test("the engineering thread is created in the background and reused, never duplicated", async () => {
  const { default: EngineeringChat } = await import("../src/core/selfdev/EngineeringChat");
  const userChat = chats.create("User is here").id;

  const first = EngineeringChat.getInstance().getOrCreateThread();
  assert.equal(chats.getActiveId(), userChat, "the engineering thread stole the user's view");

  EngineeringChat.getInstance().recordObservation("An observation from cognition.");
  assert.equal(chats.getActiveId(), userChat, "recording an observation stole the user's view");

  const second = EngineeringChat.getInstance().getOrCreateThread();
  assert.equal(second.id, first.id, "a second engineering thread was created");
  assert.equal(
    chats.listAll().filter((conversation) => conversation.tags.includes("engineering")).length,
    1,
    "the engineering thread was duplicated",
  );
  assert.equal(chats.get(first.id)?.messages.at(-1)?.text, "An observation from cognition.");
});

test("cognition can open a project workstream without moving the user", () => {
  const projects = ProjectStore.getInstance();
  const project = projects.create({ name: "Background Project", description: "for cognition" });
  const userChat = chats.create("User is reading this").id;

  const opened = openWorkstream(project.id, { seed: false, activate: false });

  assert.ok(opened?.created, "no workstream was created");
  assert.equal(chats.getActiveId(), userChat, "cognition's workstream stole the user's view");
  assert.equal(chats.get(opened!.conversation.id)?.projectId, project.id);
  assert.ok(chats.get(opened!.conversation.id)?.tags.includes("workstream"));

  // Reopening in the background must not move the user either, and must
  // not make a second conversation about the same project.
  const again = openWorkstream(project.id, { seed: false, activate: false });
  assert.equal(again?.created, false);
  assert.equal(again?.conversation.id, opened!.conversation.id);
  assert.equal(chats.getActiveId(), userChat);
});

test("the user opening a workstream still selects it", () => {
  // The default is unchanged: Explore on a question is a person's action.
  const projects = ProjectStore.getInstance();
  const project = projects.create({ name: "Foreground Project", description: "user explores" });
  chats.create("Somewhere else");

  const opened = openWorkstream(project.id, { seed: false });

  assert.ok(opened);
  assert.equal(chats.getActiveId(), opened!.conversation.id, "Explore no longer opens the workstream");
});
