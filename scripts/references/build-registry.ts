/**
 * Builds reference/registry.json (local, Git-ignored) from the recovered atlas
 * index, the owner's uploads and the committed labels, with every relation
 * checked against what LÉLU actually has (families, renderer kinds, places).
 *
 *   npx tsx scripts/references/build-registry.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildRegistry, type AtlasIndexRecord, type UserIndexRecord } from "../../src/core/references/ReferenceRegistry";
import { knownTargets } from "../../src/core/references/knownTargets";

const read = <T>(p: string): T[] => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : []);
const atlas = read<AtlasIndexRecord>("reference/atlas/index.json");
const user = read<UserIndexRecord>("reference/user/index.json");
if (!atlas.length && !user.length) {
  console.log("No local references (reference/ is empty on this machine). Nothing to build.");
  process.exit(0);
}
const missing = [...atlas.filter((a) => a.file), ...user].filter((r) => !existsSync(`reference/${"originalName" in r ? "user" : "atlas"}/${r.file}`)).map((r) => r.code);
const reg = buildRegistry({ atlas, user, known: knownTargets() });
writeFileSync("reference/registry.json", `${JSON.stringify({ ...reg, missingFiles: missing }, null, 1)}\n`);
const t = reg.totals;
console.log(`registry: ${t.entries} entries (${t.atlasUsable} usable from ${t.atlasDownloaded} atlas downloads of ${t.atlasLinks} links, ${t.ownerUploads} owner uploads), ${t.unresolved} unresolved, ${reg.relations.length} relations (${reg.relations.filter((r) => r.state === "implemented").length} to built targets, ${Object.keys(reg.planned).length} planned targets), missing files: ${missing.length}`);
