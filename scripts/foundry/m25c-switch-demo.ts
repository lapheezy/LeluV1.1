/**
 * LÉLU — visual proof that she switches looks from chat and on her own.
 * Runs the real wardrobe (MeshyForge) on a temp copy of her manifest, drives it
 * with the same parser + OutfitDirector as the chat resolver and autopilot, and
 * writes each step's resulting look file to artifacts/foundry/m25c/switching/sequence.json.
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ForgeStore } from "../../plugins/forgeStore.ts";
import { MeshyForge } from "../../plugins/meshyForge.ts";
import OutfitDirector from "../../src/core/avatar/OutfitDirector.ts";
import { parseOutfitCommand } from "../../src/core/avatar/outfitCommand.ts";

const C = "lelu_character";
const root = mkdtempSync(path.join(tmpdir(), "lelu-switch-"));
for (const d of ["manifests", "generation_logs"]) cpSync(path.join("leluverse/assets/characters", C, d), path.join(root, "characters", C, d), { recursive: true });
const forge = new MeshyForge({ store: new ForgeStore(root), readEnv: () => undefined } as never);
const client = { wardrobe: async (c: string) => forge.wardrobeView(c), dress: async (c: string, i: { look?: string | null }) => forge.dressOutfit(c, i) as never };
let t = Date.UTC(2026, 10, 19, 9);
const director = new OutfitDirector(client, C, () => t);
const steps: Array<Record<string, unknown>> = [];
const record = async (who: string, said: string, why: string) => {
  const w = forge.wardrobeView(C);
  const look = w.looks.find((l) => l.id === w.currentLook);
  steps.push({ step: steps.length + 1, who, said, why, currentLook: w.currentLook, file: look?.file ? `leluverse/assets/${look.file}` : null });
};
for (const said of ["LÉLU, wear the copper-rose coat", "change into your catsuit"]) {
  const cmd = parseOutfitCommand(said);
  if (!cmd || cmd.type !== "dress") throw new Error(`not understood: ${said}`);
  await director.dress(cmd.look, "chat", said);
  await record("person (chat)", said, "asked");
  t += 5 * 60 * 1000;
}
t += 3 * 60 * 60 * 1000; // the request is no longer recent
const self1 = await director.tick({ hour: 23 });
await record("LÉLU (on her own)", "— 23:00, nothing asked —", self1.why);
t += 40 * 60 * 1000;
const self2 = await director.tick({ hour: 10, activity: "presenting" });
await record("LÉLU (on her own)", "— presenting —", self2.why);
writeFileSync("artifacts/foundry/m25c/switching/sequence.json", JSON.stringify(steps, null, 1));
console.log(JSON.stringify(steps, null, 1));
