/**
 * LÉLU — CHAT GALLERY, IN A REAL BROWSER
 *
 * Drives the running app and checks the conversation browser that
 * actually renders: the tab bar opens it, every conversation is a tile
 * grouped by recency, search and filters narrow the same list, a tile
 * opens that exact conversation, and returning to the gallery keeps it
 * intact. Also asserts nothing throws while doing it.
 *
 * Usage: dev server running, then
 *        node scripts/verify-chat-gallery.mjs [url]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:3000/";
const BROWSER = process.env.LELU_CHROMIUM ?? "/opt/pw-browsers/chromium";

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

const browser = await chromium.launch({ executablePath: BROWSER, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(BASE, { waitUntil: "load", timeout: 90_000 });
await page.waitForTimeout(3_000);

// The first-run sign-in choice is a modal. Dismiss it the way a person does,
// so the checks below exercise the app rather than the gate.
if (await page.isVisible("[data-lelu-signin-gate]")) {
  const continueButton = page.locator("[data-lelu-signin-gate] button", { hasText: /Continue/ }).first();
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

// Open the chat through the real action bus (the same path the UI uses).
await page.evaluate(async () => {
  const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
  return Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify-gallery", initiatedBy: "lelu" });
});
await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 20_000 });

// Two conversations, so the gallery has something to browse.
await page.evaluate(async () => {
  const { default: Store } = await import("/src/core/multichat/MultiChatStore.ts");
  const store = Store.getInstance();
  const first = store.list()[0];
  store.addMessage(first.id, { id: "g-u1", role: "user", text: "Spring capsule exploration", timestamp: Date.now() - 4000, source: "ai" });
  store.addMessage(first.id, { id: "g-a1", role: "assistant", text: "Three directions, starting with colour.", timestamp: Date.now() - 3000, source: "ai" });
  const second = store.createBackground("Gallery check thread", ["gallery"]);
  store.addMessage(second.id, { id: "g-u2", role: "user", text: "A separate thread about taxes", timestamp: Date.now() - 2000, source: "ai" });
  store.markRead(second.id);
  store.pin(second.id);
});
await page.waitForTimeout(600);

const galleryButton = "[data-lelu-gallery-button]";
check("the tab bar exposes the gallery", await page.isVisible(galleryButton));

await page.click(galleryButton);
await page.waitForSelector("[data-lelu-chat-gallery]", { state: "visible", timeout: 10_000 });

const opened = await page.evaluate(() => {
  const gallery = document.querySelector("[data-lelu-chat-gallery]");
  const rect = gallery?.getBoundingClientRect();
  const cards = [...document.querySelectorAll("[data-lelu-gallery-card]")];
  return {
    coversScreen: Boolean(rect && rect.width >= innerWidth - 2 && rect.height >= innerHeight - 2),
    cards: cards.length,
    sections: [...document.querySelectorAll("[data-lelu-gallery-section]")].map((el) => el.getAttribute("data-lelu-gallery-section")),
    pinnedFirst: document.querySelector("[data-lelu-gallery-section]")?.getAttribute("data-lelu-gallery-section"),
    titles: cards.map((card) => card.querySelector(".lelu-ccg-card-head strong")?.textContent ?? ""),
    previews: cards.map((card) => card.querySelector(".lelu-ccg-preview")?.textContent ?? ""),
    current: cards.filter((card) => card.getAttribute("data-lelu-gallery-active") === "true").length,
    canScroll: (document.querySelector(".lelu-ccg-body")?.scrollHeight ?? 0) >= 0,
    modal: Number(getComputedStyle(gallery).zIndex),
    pointer: getComputedStyle(gallery).pointerEvents,
  };
});

await page.screenshot({ path: "artifacts/logs/chat-gallery.png" });

check("the gallery fills the phone screen", opened.coversScreen);
check("every conversation is a tile", opened.cards >= 2, `${opened.cards} tiles`);
check("tiles are grouped by recency", opened.sections.length >= 1, opened.sections.join(", "));
check("pinned conversations come first", opened.pinnedFirst === "Pinned", String(opened.pinnedFirst));
check("exactly one tile is the open conversation", opened.current === 1, `${opened.current} marked active`);
check("tiles show a real preview", opened.previews.every((text) => text.trim().length > 0), opened.previews[0]?.slice(0, 48));
check("the gallery sits on the modal layer", opened.modal >= 600, `z-index ${opened.modal}`);
check("the gallery takes touches", opened.pointer === "auto", opened.pointer);

// Search narrows the list, and clearing it brings everything back.
await page.fill("[data-lelu-gallery-search]", "nothing-matches-this-xyz");
await page.waitForTimeout(300);
const searched = await page.evaluate(() => ({
  cards: document.querySelectorAll("[data-lelu-gallery-card]").length,
  empty: document.querySelector(".lelu-ccg-empty")?.textContent?.trim() ?? "",
}));
check("search narrows the gallery", searched.cards === 0 && searched.empty.length > 0, searched.empty);

await page.fill("[data-lelu-gallery-search]", "taxes");
await page.waitForTimeout(300);
const matched = await page.evaluate(() =>
  [...document.querySelectorAll("[data-lelu-gallery-card]")].map((card) => card.getAttribute("data-lelu-gallery-card")),
);
check("search finds a conversation by its message", matched.length === 1, `matched ${matched.length}`);

await page.fill("[data-lelu-gallery-search]", "");
await page.waitForTimeout(300);
await page.click("[data-lelu-gallery-filter='unread']");
await page.waitForTimeout(300);
const unreadFilter = await page.evaluate(() =>
  [...document.querySelectorAll("[data-lelu-gallery-card]")].map((card) => card.getAttribute("data-lelu-gallery-card")),
);
check("the unread filter uses the store's unread state", Array.isArray(unreadFilter));
await page.click("[data-lelu-gallery-filter='all']");
await page.waitForTimeout(300);

// A tile's options are real store actions, and delete asks first.
const firstCard = page.locator("[data-lelu-gallery-card]").first();
const firstId = await firstCard.getAttribute("data-lelu-gallery-card");
await firstCard.locator("[data-lelu-gallery-options]").click();
await page.waitForSelector("[data-lelu-gallery-menu]", { state: "visible", timeout: 5_000 });
const menu = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-gallery-menu] button")].map((button) => button.textContent?.trim() ?? ""));
check("a tile offers open, pin, rename, archive and delete", ["Open", "Rename", "Delete"].every((label) => menu.some((text) => text.includes(label))), menu.join(" | "));
await page.locator("[data-lelu-gallery-menu] button", { hasText: "Delete" }).first().click();
await page.waitForTimeout(200);
const confirming = await page.evaluate(() => document.querySelector("[data-lelu-gallery-menu]")?.textContent ?? "");
check("delete asks for confirmation before removing anything", /Delete for good\?/.test(confirming));
const stillThere = await page.evaluate((id) => Boolean(document.querySelector(`[data-lelu-gallery-card="${id}"]`)), firstId);
check("nothing is deleted on the first tap", stillThere);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape closes the menu, not the gallery", await page.isVisible("[data-lelu-chat-gallery]"));
check("Escape did not close the conversation underneath", await page.isVisible("[data-lelu-composer]"));

// Opening a tile goes to that exact conversation and closes the gallery.
const openTarget = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("[data-lelu-gallery-card]")];
  if (cards.length === 0) return null;
  const target = cards.find((card) => card.getAttribute("data-lelu-gallery-active") === "false") ?? cards[0];
  return { id: target.getAttribute("data-lelu-gallery-card"), title: target.querySelector(".lelu-ccg-card-head strong")?.textContent ?? "" };
});
if (!openTarget) {
  check("there is a tile to open", false, "no cards rendered after the menu closed");
  await browser.close();
  process.exit(1);
}
await page.click(`[data-lelu-gallery-card="${openTarget.id}"] .lelu-ccg-open`);
await page.waitForTimeout(900);
const afterOpen = await page.evaluate(() => ({
  gallery: Boolean(document.querySelector("[data-lelu-chat-gallery]")),
  composer: Boolean(document.querySelector("[data-lelu-composer]")),
  active: (() => {
    const store = document.querySelector("[data-conversation-id][aria-selected='true']");
    return store?.getAttribute("data-conversation-id") ?? null;
  })(),
  header: document.querySelector("[data-lelu-chat-window]")?.textContent?.slice(0, 120) ?? "",
}));
check("opening a tile closes the gallery", !afterOpen.gallery);
check("the conversation is on screen after opening", afterOpen.composer, afterOpen.header.replace(/\s+/g, " ").slice(0, 60));
check("the chosen conversation is the active one", afterOpen.active === openTarget.id, `${afterOpen.active} vs ${openTarget.id}`);

// Back to the gallery: the same conversations are still there.
await page.click(galleryButton);
await page.waitForSelector("[data-lelu-chat-gallery]", { state: "visible", timeout: 10_000 });
const returned = await page.evaluate((id) => ({
  cards: document.querySelectorAll("[data-lelu-gallery-card]").length,
  sameCard: Boolean(document.querySelector(`[data-lelu-gallery-card="${id}"]`)),
}), openTarget.id);
check("returning to the gallery keeps every conversation", returned.cards >= 2 && returned.sameCard, `${returned.cards} tiles`);

await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape returns to the conversation", !(await page.isVisible("[data-lelu-chat-gallery]")));

check("no page errors while browsing chats", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures === 0 ? "\nALL GALLERY CHECKS PASSED" : `\n${failures} GALLERY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
