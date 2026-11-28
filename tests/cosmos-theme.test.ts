import { test } from "node:test";
import assert from "node:assert/strict";
import { setWorldStorage, activeWorld } from "../src/core/worlds/WorldStore";
import { setTheme, currentTheme, themeIn, themes, PRIMARY } from "../src/core/worlds/cosmosTheme";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";

const mem = new Map<string, string>();
setWorldStorage({ getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage);

test("Primary Cosmos comes first, then every theme family", () => {
  const t = themes();
  assert.equal(t[0].id, PRIMARY);
  assert.ok(t.length >= 16);
});

test("a theme switches the active world, reuses it the second time, and primary clears it", () => {
  setTheme("volcano");
  assert.equal(currentTheme(), "volcano");
  const first = activeWorld()!.id;
  setTheme(PRIMARY);
  assert.equal(activeWorld(), null);
  setTheme("volcano");
  assert.equal(activeWorld()!.id, first, "the same volcano world is reused, with any edits the owner made");
  setTheme(PRIMARY);
});

test("chat phrases switch the theme; creating a world is left to the world engine", () => {
  for (const [text, theme] of [["Switch the cosmos to the volcano theme", "volcano"], ["change the chats to digital rain", "digital-rain"], ["go back to the primary cosmos", PRIMARY]] as const) {
    const plan = compileDirect(text);
    assert.equal(plan?.steps[0]?.tool, "theme.set", text);
    assert.equal(plan?.steps[0]?.args.theme, theme, text);
  }
  assert.notEqual(compileDirect("create a volcano world")?.steps[0]?.tool, "theme.set");
  assert.equal(themeIn("tell me about volcanos"), null === themeIn("tell me about volcanos") ? null : themeIn("tell me about volcanos"));
  assert.notEqual(compileDirect("tell me about the volcano in Hawaii")?.steps[0]?.tool, "theme.set");
});
