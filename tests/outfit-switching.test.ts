/**
 * LÉLU — she switches outfits from a chat sentence AND on her own.
 *
 * Runs the real server wardrobe (MeshyForge.wardrobeView / dressOutfit) on a
 * temporary copy of her manifest and job ledger, so nothing in the repository
 * changes, and drives it through the same OutfitDirector the chat resolver and
 * the autopilot use.
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ForgeStore } from "../plugins/forgeStore.ts";
import { MeshyForge } from "../plugins/meshyForge.ts";
import OutfitDirector, { chooseLook } from "../src/core/avatar/OutfitDirector.ts";
import { parseOutfitCommand } from "../src/core/avatar/outfitCommand.ts";

const C = "lelu_character";

function realWardrobe() {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-wardrobe-"));
  for (const dir of ["manifests", "generation_logs"]) {
    cpSync(path.join(process.cwd(), "leluverse/assets/characters", C, dir), path.join(root, "characters", C, dir), { recursive: true });
  }
  const forge = new MeshyForge({ store: new ForgeStore(root), readEnv: () => undefined } as never);
  const client = {
    wardrobe: async (c: string) => forge.wardrobeView(c),
    dress: async (c: string, input: { look?: string | null }) => forge.dressOutfit(c, input) as never,
  };
  return { root, forge, client };
}

test("chat sentences become outfit commands; talk about clothes does not", () => {
  const cases: Array<[string, string | null]> = [
    ["LÉLU, wear the copper-rose coat", "rose_gold_sovereign"],
    ["please change into your catsuit", "bronze_velocity"],
    ["can you put on something comfy?", "home_laidback3"],
    ["switch back to your camo", "camo_repaired"],
    ["go with the rose gold sovereign look", "rose_gold_sovereign"],
    ["I love your coat", null],
    ["what is a catsuit made of", null],
  ];
  for (const [text, look] of cases) {
    const c = parseOutfitCommand(text);
    assert.equal(c?.type === "dress" ? c.look : null, look, text);
  }
  assert.equal(parseOutfitCommand("what can you wear?")?.type, "wardrobe");
});

test("a chat request switches her look through the real wardrobe, coat ↔ catsuit", async () => {
  const { root, client } = realWardrobe();
  try {
    const director = new OutfitDirector(client, C);
    for (const [text, look] of [["wear the copper-rose coat", "rose_gold_sovereign"], ["change into your catsuit", "bronze_velocity"], ["wear the coat", "rose_gold_sovereign"]] as const) {
      const cmd = parseOutfitCommand(text);
      assert.ok(cmd && cmd.type === "dress");
      const change = await director.dress(cmd.look, "chat", text);
      assert.equal(change.to, look);
      assert.equal((await client.wardrobe(C)).currentLook, look, `manifest shows ${look}`);
    }
    await assert.rejects(director.dress("ball_gown", "chat", "wear a ball gown"), /not in my wardrobe/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("she changes on her own by occasion, and keeps a look a person chose", async () => {
  const { root, client } = realWardrobe();
  try {
    let t = Date.UTC(2026, 10, 19, 12);
    const director = new OutfitDirector(client, C, () => t);
    const looks = (await director.available()).looks;
    assert.deepEqual(chooseLook({ hour: 23 }, looks)?.look, "home_laidback3");
    assert.deepEqual(chooseLook({ hour: 14, activity: "presenting" }, looks)?.look, "rose_gold_sovereign");
    assert.deepEqual(chooseLook({ hour: 10, activity: "building", place: "lab" }, looks)?.look, "bronze_velocity");

    const night = await director.tick({ hour: 23 });
    assert.equal(night.changed?.to, "home_laidback3");
    assert.equal(night.changed?.source, "self");
    assert.equal((await client.wardrobe(C)).currentLook, "home_laidback3");

    t += 10 * 60 * 1000;
    assert.equal((await director.tick({ hour: 10, activity: "presenting" })).changed, null, "not twice within 30 minutes");

    t += 31 * 60 * 1000;
    const formal = await director.tick({ hour: 10, activity: "presenting" });
    assert.equal(formal.changed?.to, "rose_gold_sovereign");

    t += 60 * 60 * 1000;
    await director.dress("bronze_velocity", "chat", "change into your catsuit");
    t += 60 * 60 * 1000;
    const kept = await director.tick({ hour: 23 });
    assert.equal(kept.changed, null);
    assert.match(kept.why, /someone chose/);
    assert.match(director.describe(), /catsuit.*asked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
