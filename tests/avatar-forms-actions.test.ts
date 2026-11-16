/**
 * M15.3 — LÉLU's presence: one identity, several presentations, real actions.
 *
 * Unit level: the deterministic command parser (what is and is NOT a command),
 * the interface presentation profiles, the low-power rule, the form/framing
 * store, and the action bus's honest decline. Rendering is NOT mocked here and
 * not claimed here: scripts/avatar/verify-avatar-presence.mjs proves it in the
 * running app with her approved model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.window === "undefined") (globalThis as Record<string, unknown>).window = globalThis;
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => {},
    get length() { return Object.keys(store).length; },
    key: () => null,
  };
}
if (typeof sessionStorage === "undefined") (globalThis as Record<string, unknown>).sessionStorage = (globalThis as Record<string, unknown>).localStorage;

import { parseAvatarPresenceCommand } from "../src/core/router/avatarPresenceCommand";
import { choosePresentation, contextOf, restsOnStill, FULL_MIN_HEIGHT } from "../src/app/scene/genesis/avatar/presentationProfile";
import LeluCharacterStore from "../src/core/avatar/LeluCharacterStore";
import AvatarCommandBus, { AVATAR_PLACES } from "../src/core/avatar/AvatarCommandBus";

test("her form and framing commands, in plain words", () => {
  const cases: Array<[string, object]> = [
    ["become a hologram", { type: "form", form: "hologram" }],
    ["LÉLU, switch to hologram mode", { type: "form", form: "hologram" }],
    ["please turn into a hologram", { type: "form", form: "hologram" }],
    ["become embodied", { type: "form", form: "embodied" }],
    ["stop being a hologram", { type: "form", form: "embodied" }],
    ["show me all of you", { type: "framing", framing: "full" }],
    ["just your face", { type: "framing", framing: "face" }],
    ["choose your own form", { type: "presentation-auto" }],
  ];
  for (const [words, want] of cases) {
    const got = parseAvatarPresenceCommand(words);
    assert.ok(got, words);
    for (const [k, v] of Object.entries(want)) assert.equal((got as Record<string, unknown>)[k], v, `${words}: ${k}`);
  }
});

test("movement, turning and gestures map to the bus's real kinds and places", () => {
  const cases: Array<[string, string, string | undefined]> = [
    ["walk to the studio", "move", "studio"],
    ["LÉLU, go to the core", "move", "core"],
    ["head over to the lab", "move", "lab"],
    ["come closer", "move", "viewer"],
    ["step back", "move", "away"],
    ["go back to your spot", "move", "home"],
    ["move to the left", "move", "left"],
    ["face me", "look", "viewer"],
    ["face the vault", "look", "vault"],
    ["look around", "look", undefined],
    ["dance", "dance", undefined],
    ["wave", "wave", undefined],
    ["take a bow", "bow", undefined],
    ["sit down", "sit", undefined],
    ["walk off", "leave", undefined],
    ["come back", "return", undefined],
  ];
  for (const [words, kind, place] of cases) {
    const got = parseAvatarPresenceCommand(words);
    assert.ok(got && got.type === "motion", words);
    assert.equal(got.kind, kind, words);
    assert.equal(got.place, place, words);
    if (place) assert.ok(AVATAR_PLACES.includes(got.place!), words);
  }
});

test("talk ABOUT holograms, dancing or studios is never a command", () => {
  for (const words of [
    "what is a hologram",
    "I love how you dance",
    "can holograms be made at home?",
    "the studio is great",
    "show me Paris",
    "tell me about your face",
    "walking is good exercise",
    "my friend went to the studio yesterday and then we went home",
  ]) {
    assert.equal(parseAvatarPresenceCommand(words), null, words);
  }
});

test("each interface asks for the presentation that suits it; her choice wins", () => {
  const ask = (context: Parameters<typeof choosePresentation>[0]["context"], extra: Partial<Parameters<typeof choosePresentation>[0]> = {}) =>
    choosePresentation({ context, boxHeight: 300, hero: false, userForm: "auto", userFraming: "auto", ...extra });
  assert.deepEqual([ask("home", { hero: true }).framing, ask("home", { hero: true }).form], ["face", "embodied"]);
  assert.deepEqual([ask("creative").framing, ask("creative").form], ["full", "embodied"]);
  assert.deepEqual([ask("engineering").framing, ask("engineering").form], ["face", "hologram"]);
  assert.deepEqual([ask("browser").framing, ask("browser").form], ["face", "hologram"]);
  assert.equal(ask("chat").framing, "full");
  assert.equal(ask("chat", { boxHeight: FULL_MIN_HEIGHT - 1 }).framing, "face");
  assert.equal(ask("world").framing, "full");
  // Her (or the person's) explicit choice wins over the interface.
  const chosen = ask("engineering", { userForm: "embodied", userFraming: "full" });
  assert.deepEqual([chosen.framing, chosen.form], ["full", "embodied"]);
  assert.match(chosen.reason, /chosen/);
});

test("which interface she is in", () => {
  assert.equal(contextOf({ onHome: true, inWorld: false, chatOpen: false, focused: null }), "home");
  assert.equal(contextOf({ onHome: false, inWorld: true, chatOpen: true, focused: "engineering" }), "world");
  assert.equal(contextOf({ onHome: false, inWorld: false, chatOpen: false, focused: "visualstudio" }), "creative");
  assert.equal(contextOf({ onHome: false, inWorld: false, chatOpen: false, focused: "engineering" }), "engineering");
  assert.equal(contextOf({ onHome: false, inWorld: false, chatOpen: false, focused: "browser" }), "browser");
  assert.equal(contextOf({ onHome: false, inWorld: false, chatOpen: true, focused: null }), "chat");
});

test("she rests on a still ONLY on a measured light device beside a phone sheet", () => {
  assert.equal(restsOnStill({ besidePhoneSheet: true, renderProfile: "light" }), true);
  assert.equal(restsOnStill({ besidePhoneSheet: true, renderProfile: "balanced" }), false);
  assert.equal(restsOnStill({ besidePhoneSheet: true, renderProfile: "full" }), false);
  assert.equal(restsOnStill({ besidePhoneSheet: false, renderProfile: "light" }), false);
});

test("form and framing default to auto, are remembered, and reject anything else", () => {
  LeluCharacterStore.resetForTests();
  const store = LeluCharacterStore.getInstance();
  assert.deepEqual([store.get().form, store.get().framing], ["auto", "auto"]);
  store.setForm("hologram");
  store.setFraming("face");
  store.setForm("robot" as never);
  store.setFraming("feet" as never);
  LeluCharacterStore.resetForTests();
  assert.deepEqual([LeluCharacterStore.getInstance().get().form, LeluCharacterStore.getInstance().get().framing], ["hologram", "face"]);
  LeluCharacterStore.getInstance().setForm("auto");
  LeluCharacterStore.getInstance().setFraming("auto");
});

test("the bus carries a target, and a presence can decline honestly", async () => {
  const bus = AvatarCommandBus.getInstance();
  const seen: Array<{ kind: string; place?: string }> = [];
  const off = bus.subscribe((c) => {
    seen.push({ kind: c.kind, place: c.target?.place });
    if (c.target?.place === "left") bus.decline(c.id, "every spot on the left covers a control");
    else bus.confirm(c.id, "walked 2.10 m");
  });
  await assert.rejects(bus.issue("move", "move to the left", 1000, { place: "left" }), /every spot on the left/);
  assert.equal(await bus.issue("move", "walk to the studio", 1000, { place: "studio" }), "walked 2.10 m");
  off();
  assert.deepEqual(seen, [{ kind: "move", place: "left" }, { kind: "move", place: "studio" }]);
});
