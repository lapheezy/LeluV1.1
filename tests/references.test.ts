/**
 * The owner's reference library: discovery, retrieval, categorisation,
 * unresolved records, relationships to real visual objects, and that the
 * images stay local (Git-ignored, never in a production bundle).
 * Pure tests run on fixtures; checks on the real local library run only
 * where reference/ exists (it is personal and absent elsewhere).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { buildRegistry, referenceById, referencesFor, searchReferences, targetState, type AtlasIndexRecord, type UserIndexRecord } from "../src/core/references/ReferenceRegistry";
import { ATLAS_LABELS, CATEGORIES, USER_LABELS } from "../src/core/references/referenceLabels";
import { knownTargets } from "../src/core/references/knownTargets";
import { REFERENCE_EXECUTORS, REFERENCE_TOOLS, setReferenceSource } from "../src/core/references/ReferenceTools";

const known = knownTargets();
const atlas: AtlasIndexRecord[] = [
  { code: "I-35", source: "https://example.org/lava", file: "I-35.jpg" },
  { code: "II-13", source: "https://example.org/sw", file: "II-13.jpg" },
  { code: "I-49", source: "https://example.org/coral", file: "I-49.png" },
  { code: "II-01", source: "https://example.org/riley", note: "unavailable: HTTPError HTTP Error 403: Forbidden" },
  { code: "II-05", source: "https://example.org/disney.pdf", note: "content application/pdf" },
  { code: "I-64", source: "https://example.org/x", note: "page has no preview image" },
  { code: "III-12", source: "https://example.org/y", note: "unavailable: HTTPError HTTP Error 429: Too many" },
];
const user: UserIndexRecord[] = [
  { code: "U-04", file: "U-04.png", source: "owner upload", crop: [32, 253, 1159, 2507] },
  { code: "U-07", file: "U-07.png", source: "owner upload" },
];
const reg = buildRegistry({ atlas, user, known, now: "2026-11-28T00:00:00Z" });

test("discovery: every downloaded atlas file and every owner upload becomes an entry with a dev-server URL", () => {
  assert.equal(reg.entries.length, 5);
  assert.deepEqual(reg.entries.map((e) => e.id).sort(), ["atlas:I-35", "atlas:I-49", "atlas:II-13", "owner:U-04", "owner:U-07"]);
  for (const e of reg.entries) assert.match(e.url, /^\/reference\/(atlas|user)\//);
  assert.equal(reg.totals.atlasLinks, 7);
  assert.equal(reg.totals.atlasDownloaded, 3);
});

test("retrieval: by id or code, with the owner's crop kept", () => {
  assert.equal(referenceById(reg, "owner:U-04")?.code, "U-04");
  assert.equal(referenceById(reg, "I-35")?.id, "atlas:I-35");
  assert.deepEqual(referenceById(reg, "U-04")?.crop, [32, 253, 1159, 2507]);
  assert.equal(referenceById(reg, "nope"), undefined);
});

test("categorisation and search: category, franchise, text and target", () => {
  assert.deepEqual(searchReferences(reg, { franchise: "star wars" }).map((e) => e.code), ["U-04"]);
  assert.deepEqual(searchReferences(reg, { category: "environment" }).map((e) => e.code).sort(), ["I-35", "U-04"]);
  assert.deepEqual(searchReferences(reg, { text: "lava" }).map((e) => e.code).sort(), ["I-35", "U-04"]);
  assert.deepEqual(searchReferences(reg, { franchise: "boondocks" }).map((e) => e.code), ["U-07"]);
  // A logo is never returned as a visual reference unless asked for.
  assert.equal(searchReferences(reg, { text: "star wars" }).some((e) => e.code === "II-13"), false);
  assert.equal(searchReferences(reg, { text: "star wars", usableOnly: false }).some((e) => e.code === "II-13"), true);
});

test("missing assets: blocked, PDF, no-preview, rate-limited, logo-only and mismatched entries are recorded, never substituted", () => {
  const by = Object.fromEntries(reg.unresolved.map((u) => [u.code + ":" + u.reason, u]));
  for (const k of ["II-01:blocked", "II-05:pdf", "I-64:no-preview", "III-12:rate-limited", "II-13:logo-only", "I-49:mismatch"]) assert.ok(by[k], k);
  assert.equal(referenceById(reg, "II-13")!.informs.length, 0, "a logo informs nothing");
  assert.equal(referenceById(reg, "I-49")!.informs.length, 0, "a mismatched image informs nothing");
});

test("relationships: references point at real families, layers and places, or at recorded planned targets", () => {
  assert.ok(referencesFor(reg, "family:volcano").map((e) => e.code).includes("U-04"));
  assert.ok(referencesFor(reg, "layer:lava-field").map((e) => e.code).includes("I-35"));
  assert.deepEqual(reg.planned["character-style:cel-shaded-american-anime"], ["owner:U-07"]);
  assert.equal(targetState("family:volcano", known), "implemented");
  assert.equal(targetState("place:tampa:1958", known), "implemented");
  assert.equal(targetState("planned:space-opera", known), "planned");
  assert.equal(targetState("family:does-not-exist", known), "unknown");
});

test("every committed label uses known categories and only valid targets (no relation to something that does not exist)", () => {
  for (const [code, l] of Object.entries({ ...ATLAS_LABELS, ...USER_LABELS })) {
    for (const c of l.categories) assert.ok((CATEGORIES as readonly string[]).includes(c), `${code}: ${c}`);
    for (const t of l.informs) assert.notEqual(targetState(t, known), "unknown", `${code} → ${t}`);
    if (l.content === "logo" || l.content === "placeholder") assert.equal(l.informs.length, 0, `${code}: a logo must not inform anything`);
    if (l.franchise) assert.ok(l.categories.length > 0, code);
  }
});

test("every owner upload is labelled; atlas labels use atlas codes", () => {
  for (let i = 1; i <= 8; i++) assert.ok(USER_LABELS[`U-0${i}`], `U-0${i}`);
  for (const c of Object.keys(ATLAS_LABELS)) assert.match(c, /^(I|II|III)-\d{2}$/);
});

test("tools: search, for, unresolved report the registry; without a library they say so", async () => {
  setReferenceSource(async () => reg);
  const run = (id: string, a: Record<string, unknown>) => REFERENCE_EXECUTORS.find((e) => e.id === id)!.run(a);
  const s = await run("references.search", { franchise: "Star Wars" });
  assert.ok(s.ok && /U-04/.test(s.content));
  const f = await run("references.for", { target: "planned:space-opera" });
  assert.ok(f.ok && /planned, not built yet/.test(f.content) && /U-04/.test(f.content));
  const u = await run("references.unresolved", {});
  assert.ok(u.ok && /blocked/.test(u.content) && /logo-only/.test(u.content));
  const logo = await run("references.apply", { ref: "II-13", as: "workspace" });
  assert.equal(logo.ok, false);
  setReferenceSource(async () => null);
  const none = await run("references.search", { text: "lava" });
  assert.equal(none.ok, false);
  assert.match(none.content, /No local reference library/);
  assert.equal(REFERENCE_TOOLS.length, REFERENCE_EXECUTORS.length);
});

test("the images stay local: reference/ is Git-ignored and never under public/ or in a build", () => {
  const ignore = readFileSync(".gitignore", "utf8").split("\n").map((l) => l.trim());
  assert.ok(ignore.includes("reference/"));
  assert.ok(!existsSync("public/reference"), "reference images must not be copied into public/");
  if (existsSync("dist")) {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(`${d}/${x.name}`) : [`${d}/${x.name}`]));
    const files = walk("dist");
    assert.ok(!files.some((f) => /\/(atlas|user)\/(I|II|III|U)-\d+/.test(f) || /\/reference\//.test(f)), "no reference image in dist/");
  }
});

test("local library (only where it exists): every downloaded or uploaded file on disk is labelled", { skip: !existsSync("reference/atlas/index.json") }, () => {
  const a: AtlasIndexRecord[] = JSON.parse(readFileSync("reference/atlas/index.json", "utf8"));
  const u: UserIndexRecord[] = existsSync("reference/user/index.json") ? JSON.parse(readFileSync("reference/user/index.json", "utf8")) : [];
  const real = buildRegistry({ atlas: a, user: u, known });
  assert.equal(real.totals.atlasLinks, 167);
  assert.equal(real.unresolved.filter((x) => x.reason === "unlabelled").length, 0, "every recovered file has been looked at and labelled");
  assert.equal(real.totals.atlasDownloaded + real.unresolved.filter((x) => ["blocked", "rate-limited", "no-preview", "pdf", "network"].includes(x.reason)).length, 167, "downloads + failures = 167");
  for (const e of real.entries) assert.ok(existsSync(`reference/${e.file}`), e.file);
  assert.equal(real.relations.filter((r) => r.state === "unknown").length, 0);
});

import { imageWorkspace } from "../src/core/workspaces/imageWorkspace";
import { layersOf } from "../src/core/worlds/WorldSchema";

test("image workspaces: a reference, a photo or her visual becomes a full-screen 2D world (no 3D), framed in the image's palette", () => {
  const pal = { sky: ["#75796d", "#7b7664", "#171617"] as [string, string, string], accent: "#ebe3bc", glow: "#ffffff" };
  const ref = imageWorkspace({ origin: "reference", title: "U-05 twin suns", ref: "owner:U-05" }, pal, 1);
  assert.equal(ref.mode, "2d");
  assert.equal(layersOf(ref, "objects3d").length + layersOf(ref, "atmosphere").length + layersOf(ref, "foundation").length, 0);
  const img = layersOf(ref, "graphics2d")[0];
  assert.equal(img.kind, "reference-plate");
  assert.equal(img.params.fit, "fullscreen");
  assert.equal(img.params.ref, "owner:U-05");
  assert.equal(layersOf(ref, "spatialUI")[0].params.tint, "#75796d");
  assert.equal(ref.palette.sky[0], "#75796d");
  assert.match(ref.name, /^Reference · /);

  const photo = imageWorkspace({ origin: "photo", title: "Balcony at dusk", src: "img:abc123" });
  assert.equal(layersOf(photo, "graphics2d")[0].params.src, "img:abc123");
  assert.match(photo.name, /^Photo · /);
  const hers = imageWorkspace({ origin: "generated", title: "Neon garden", src: "https://example.org/v.png" });
  assert.match(hers.name, /^Her visual · /);

  // Pixels are never stored in the world: a data URL is refused as a source (it goes to the device's image store first).
  const raw = imageWorkspace({ origin: "generated", title: "x", src: "data:image/png;base64,AAAA" });
  assert.equal(layersOf(raw, "graphics2d")[0].params.src, undefined);
  assert.throws(() => imageWorkspace({ origin: "photo", title: "nothing" }), /needs a reference id or an image source/);
});
