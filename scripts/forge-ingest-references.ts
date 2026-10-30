/**
 * LÉLU 3D FORGE — ingest a classified reference batch and lock identity.
 *
 *   tsx scripts/forge-ingest-references.ts <classification.json> <source-dir> [--relock-identity]
 *
 * Copies each classified image into the character's references/ folder
 * (originals are never overwritten), measures and de-duplicates them,
 * writes manifests/references.json, and locks the identity named in the
 * classification. Re-running with the same inputs is a no-op; pointing
 * the identity at different images needs --relock-identity.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildRecords, type ReferenceClassification } from "../plugins/forgeReferences.ts";
import { ForgeStore } from "../plugins/forgeStore.ts";

interface ClassificationFile {
  character: string;
  images: ReferenceClassification[];
  identity: { primary: string; secondary: string[]; preserve: Record<string, string>; mayChange: string[]; rule: string };
}

const [classificationPath, sourceDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!classificationPath || !sourceDir) {
  console.error("usage: tsx scripts/forge-ingest-references.ts <classification.json> <source-dir> [--relock-identity]");
  process.exit(2);
}
const relock = process.argv.includes("--relock-identity");

const spec = JSON.parse(readFileSync(classificationPath, "utf8")) as ClassificationFile;
const store = new ForgeStore(process.env.FORGE_ASSET_ROOT ?? path.join(process.cwd(), "leluverse", "assets"));
const existing = store.references(spec.character);

const batch = spec.images
  .filter((c) => !existing.some((r) => r.id === c.id))
  .map((classification) => {
    const source = path.join(sourceDir, classification.sourceName);
    if (!existsSync(source)) throw new Error(`Missing source image ${source}`);
    return { classification, file: "", bytes: new Uint8Array(readFileSync(source)) };
  });

const records = buildRecords(batch, existing);
for (const record of records) {
  if (record.duplicateOf) {
    console.log(`skip  ${record.id}: exact duplicate of ${record.duplicateOf}`);
    continue;
  }
  const item = batch.find((b) => b.classification.id === record.id)!;
  const ext = path.extname(record.sourceName) || ".png";
  record.file = store.relative(store.storeReferenceFile(spec.character, record.id, ext, item.bytes));
  existing.push(record);
  store.logEvent(spec.character, { type: "reference_ingested", id: record.id, sha256: record.metrics.sha256, nearDuplicateOf: record.nearDuplicateOf });
  const m = record.metrics;
  console.log(
    `ingest ${record.id.padEnd(30)} ${m.width}x${m.height} ${(m.bytes / 1e6).toFixed(1)}MB ` +
      `sharp=${m.sharpness} contrast=${m.contrast} quality=${record.quality} ` +
      `suitability=${record.reconstructionSuitability}${record.nearDuplicateOf ? ` NEAR-DUP of ${record.nearDuplicateOf}` : ""}`,
  );
}
store.saveReferences(spec.character, existing);

const lock = store.lockIdentity(spec.character, spec.identity, relock);
const check = store.verifyIdentity(spec.character);
console.log(`identity: primary=${lock.primary} lock=${lock.lockHash.slice(0, 16)} verified=${check.ok}`);
console.log(`references: ${existing.length} total`);
