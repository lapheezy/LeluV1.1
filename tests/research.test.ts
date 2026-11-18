/**
 * LÉLU 2 — the research system's own tests.
 *
 * These are not smoke tests. Each one pins a rule that would otherwise
 * let the journal become confident prose:
 *
 *   - a partial entry is refused, and the missing fields are named
 *   - "verified" is impossible without a measured artefact
 *   - retrieval is weighted, so a question beats a passing mention
 *   - a question stays open until a VERIFIED entry answers it
 *   - a refuted assumption is still in the record afterwards
 *   - re-ingesting the same commit does not duplicate the session
 *   - the agenda's order is a formula, not a preference
 *   - the visual comparison reports the change it measured
 *   - a hypothesis cannot become a capability
 *   - the bridge refuses to publish anything unverified
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CapabilityError,
  CapabilityPipeline,
  CognitionBridge,
  MemoryDocStore,
  ObservationLog,
  ResearchAgenda,
  ResearchError,
  ResearchJournal,
  ResearchStore,
  compareRenders,
  decodePng,
  silhouette,
  workPackageOf,
  type EvidenceRef,
  type RasterImage,
  type ResearchEntryInput,
} from "../src/core/cognition/research/index";
import { FsDocStore } from "../scripts/lelu2/research-fs";

const EVIDENCE: EvidenceRef[] = [
  { kind: "measurement", ref: "artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json", note: "occupancy cells" },
  { kind: "test", ref: "tests/research.test.ts", note: "occupancy invariance test" },
  { kind: "commit", ref: "4512e946", commit: "4512e946" },
];

function entry(over: Partial<ResearchEntryInput> = {}): ResearchEntryInput {
  return {
    mission: "LÉLU 2.1 — geometry fidelity",
    workPackage: "WP03",
    observed: "1350 tube strands replaced 540k voxel hair triangles",
    studied: "parallel transport frames along a swept curve",
    question: "can tube hair keep voxel occupancy while looking like curls",
    hypothesis: "occupancy is independent of the surface representation",
    method: "build voxel and tube variants, compare SparseVoxelGrid cell sets",
    results: "375460 cells in every variant",
    evidence: EVIDENCE,
    learned: "occupancy is decided before the surface is chosen, so a mesh swap cannot move it",
    limitations: ["LOD idea not verified on a device"],
    applications: ["hair can change without invalidating ASRE/NRE authority"],
    nextQuestions: ["why are 54 of 1350 roots floating above the scalp"],
    ...over,
  };
}

function harness(): { store: ResearchStore; journal: ResearchJournal } {
  const store = new ResearchStore(new MemoryDocStore());
  return { store, journal: new ResearchJournal(store) };
}

test("an entry missing required fields is refused and the fields are named", () => {
  const { journal } = harness();
  assert.throws(
    () => journal.record({ ...entry(), learned: "", nextQuestions: [], limitations: [] } as ResearchEntryInput),
    (error: unknown) => {
      assert.ok(error instanceof ResearchError);
      assert.deepEqual(error.fields.sort(), ["learned", "limitations", "nextQuestions"]);
      return true;
    },
  );
});

test("a recorded entry is readable by a second store over the same files", () => {
  const disk = new MemoryDocStore();
  const first = new ResearchJournal(new ResearchStore(disk));
  const created = first.record(entry());
  // A "restart": a fresh store, the same directory.
  const second = new ResearchJournal(new ResearchStore(disk));
  const back = second.get(created.id);
  assert.ok(back);
  assert.equal(back?.question, created.question);
  assert.ok(disk.paths().includes(`discoveries/${created.id}.json`));
  assert.ok(disk.paths().includes(`discoveries/${created.id}.md`), "a human-readable twin is written beside the JSON");
  assert.match(disk.read(`discoveries/${created.id}.md`) ?? "", /14 Next questions/);
});

test("verified is impossible without measured evidence", () => {
  const { journal } = harness();
  assert.throws(
    () =>
      journal.record({
        ...entry(),
        evidence: [{ kind: "source", ref: "src/core/asre/hair/tubes.ts" }],
        status: "verified",
      }),
    ResearchError,
  );
  const ok = journal.record({ ...entry(), status: "verified" });
  assert.equal(ok.status, "verified");
  assert.ok(ok.verifiedAt !== null);
});

test("search weights the question over a passing mention", () => {
  const { journal } = harness();
  const about = journal.record(entry({ question: "why are hair roots floating above the scalp" }));
  const mentions = journal.record(
    entry({
      question: "how should the crown be shaded",
      method: "render a close-up, note the floating roots as a side observation",
    }),
  );
  const hits = journal.search("floating roots scalp");
  assert.equal(hits[0].entry.id, about.id);
  assert.ok(hits.some((hit) => hit.entry.id === mentions.id));
  assert.ok(hits[0].score > (hits[1]?.score ?? 0));
  assert.ok(hits[0].matched.includes("floating"));
});

test("a question stays open until a verified entry answers it", () => {
  const { journal } = harness();
  const asker = journal.record(entry({ nextQuestions: ["why are 54 of 1350 roots floating"] }));
  assert.equal(journal.gaps().length, 1);

  // An experiment about it does not close the gap...
  journal.record(entry({ status: "experiment", question: "why 54 roots floating above the scalp" }));
  assert.ok(journal.gaps().some((gap) => gap.from === asker.id), "an experiment alone does not settle a question");

  // ...a verified answer that SAYS it settles the question does.
  journal.record(
    entry({
      status: "verified",
      question: "54 roots float because the face-plane cut removes their length",
      answers: ["why are 54 of 1350 roots floating"],
    }),
  );
  assert.equal(journal.gaps().filter((gap) => gap.from === asker.id).length, 0);
});

test("a refutation is recorded and the earlier assumption is not rewritten", () => {
  const { journal } = harness();
  const earlier = journal.record(
    entry({ assumptions: [{ statement: "the crown is densely covered", verdict: "supported" }] }),
  );
  const later = journal.record(entry({ question: "is the crown dense after the face cut" }));
  journal.refute(later.id, {
    entryId: earlier.id,
    assumption: "the crown is densely covered",
    note: "silhouette coverage in the upper third fell 6.1 points",
    evidence: [{ kind: "render", ref: "artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png" }],
  });

  const contradictions = journal.contradictions();
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0].earlierId, earlier.id);
  assert.equal(contradictions[0].laterId, later.id);
  assert.equal(contradictions[0].earlierStillClaims, true, "the earlier entry keeps what it claimed");
  assert.equal(journal.get(earlier.id)?.assumptions[0].verdict, "supported");
});

test("the observation log associates a commit with a work package and deduplicates it", () => {
  const { store } = harness();
  const log = new ObservationLog(store, () => 1_700_000_000_000, "S-test");
  assert.equal(workPackageOf("feat(lelu2.1): draw her hair as swept tubes").workPackage, "WP03");
  assert.equal(workPackageOf("WP05: projection benchmark").workPackage, "WP05");

  const commit = {
    sha: "4512e9466d7157da81a190bb11b985c3c1e1b3ec",
    at: 1_700_000_000_000,
    message: "feat(lelu2.1): draw her hair as swept tubes",
    files: ["src/core/asre/hair/tubes.ts"],
    branch: "experiment/lelu-2-golden-geometry",
  };
  log.observeCommit(commit);
  log.observeCommit(commit); // the same fact, ingested again
  assert.equal(log.all().length, 1);

  const digest = log.digest("S-test");
  assert.equal(digest.events, 1);
  assert.equal(digest.byWorkPackage.WP03, 1);
  assert.deepEqual(digest.commits, [commit.sha]);
  assert.equal(log.recurrences(1).length, 0, "one failure is not yet a recurrence");
});

test("the agenda's order is the stated formula", () => {
  const agenda = new ResearchAgenda();
  const cheap = agenda.propose({ question: "cheap and useful", origin: "test", impact: 0.9, feasibility: 0.9, cost: 1, relevance: 0.9 });
  const dear = agenda.propose({ question: "expensive and vague", origin: "test", impact: 0.9, feasibility: 0.9, cost: 5, relevance: 0.9 });
  const ranked = agenda.rank([dear, cheap]);
  assert.equal(ranked[0].question, "cheap and useful");
  assert.ok(cheap.priority > dear.priority);
  assert.equal(ranked[0].priority, Number(ranked[0].priority.toFixed(4)));
  // Deterministic: the same inputs rank identically twice.
  assert.deepEqual(agenda.rank([cheap, dear]).map((item) => item.question), ranked.map((item) => item.question));
});

test("a hypothesis cannot become a capability; a verified entry can", () => {
  const { store, journal } = harness();
  const pipeline = new CapabilityPipeline(store, () => 1_700_000_000_000);
  const idea = journal.record({ ...entry(), status: "hypothesis" });
  assert.throws(
    () => pipeline.promote(idea, { name: "tube hair", acceptance: ["occupancy unchanged"], testCommand: "npx tsx x.ts" }),
    CapabilityError,
  );

  const proven = journal.record({ ...entry(), status: "verified" });
  const record = pipeline.promote(proven, {
    name: "Tube hair with invariant occupancy",
    acceptance: ["voxel and tube builds report identical cell sets"],
    testCommand: "npx tsx scripts/asre/lelu2/hair.ts --variant tubes-high",
  });
  assert.equal(record.status, "proposed");
  assert.equal(record.verifiedAt, null);

  const verified = pipeline.verify(record.id, {
    passed: true,
    command: record.testCommand,
    evidence: [{ kind: "test", ref: "tests/research.test.ts" }],
  });
  assert.equal(verified.status, "verified");
  assert.ok(verified.verifiedAt !== null);
});

test("the bridge publishes only verified entries and reports a refusal", async () => {
  const { journal } = harness();
  const added: string[] = [];
  const bridge = new CognitionBridge({
    add: (input) => {
      added.push(`${input.title} [${input.status}]`);
      return { id: "selfdev-1" };
    },
  });

  const idea = journal.record({ ...entry(), status: "hypothesis" });
  assert.equal((await bridge.publish(idea)).published, false);

  const proven = journal.record({ ...entry(), status: "verified" });
  const result = await bridge.publish(proven);
  assert.equal(result.published, true);
  assert.deepEqual(added, [`Research: ${proven.question.slice(0, 120)} [verified]`]);

  const refusing = new CognitionBridge({
    add: () => {
      throw new Error("storage unavailable");
    },
  });
  const failure = await refusing.publish(proven);
  assert.equal(failure.published, false);
  assert.match(failure.reason ?? "", /refused/);
});

/* ---------------------------- visual evidence ---------------------------- */

function raster(width: number, height: number, filled: (x: number, y: number) => boolean): RasterImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const inside = filled(x, y);
      data[at] = inside ? 240 : 20;
      data[at + 1] = inside ? 240 : 20;
      data[at + 2] = inside ? 240 : 20;
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

test("silhouette metrics describe the shape that is actually there", () => {
  const image = raster(10, 10, (x, y) => x < 5 && y < 5);
  const metrics = silhouette(image);
  assert.equal(metrics.coverage, 0.25);
  assert.deepEqual(metrics.bounds, { x0: 0, y0: 0, x1: 4, y1: 4 });
  assert.equal(metrics.boxWidth, 5);
  assert.ok(Math.abs((metrics.centroid?.x ?? 0) - 2) < 0.01);
});

test("a shrinking subject is reported as a coverage change, not as an improvement", () => {
  const before = raster(20, 20, (x, y) => x < 10 && y < 10);
  const after = raster(20, 20, (x, y) => x < 6 && y < 10);
  const comparison = compareRenders(before, after, { a: "before", b: "after" });
  assert.ok(comparison.coverageRelative < -0.3);
  assert.ok(comparison.iou < 1);
  const coverage = comparison.findings.find((finding) => finding.kind === "silhouette-change");
  assert.ok(coverage, "the silhouette change is named");
  assert.match(coverage.corroborateWith, /strand|occupancy/);
});

test("identical renders do not produce a fabricated finding", () => {
  const image = raster(12, 12, (x, y) => x > 2 && y > 2);
  const comparison = compareRenders(image, image, { a: "a", b: "a" });
  assert.equal(comparison.iou, 1);
  assert.equal(comparison.coverageRelative, 0);
  assert.equal(comparison.findings[0].severity, "info");
});

/* ------------------------------- png decode ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

function encodePng(width: number, height: number, alpha: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = y * (stride + 1) + 1 + x * 4;
      const source = (y * width + x) * 4;
      raw[at] = 255;
      raw[at + 1] = 255;
      raw[at + 2] = 255;
      raw[at + 3] = alpha[source + 3];
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

test("a real PNG decodes to the pixels it encodes", () => {
  const alpha = new Uint8Array(3 * 2 * 4);
  alpha[3] = 255; // one opaque pixel at (0,0)
  alpha[4 * 1 + 3] = 255; // (1,0)
  const image = decodePng(encodePng(3, 2, alpha), (bytes) => new Uint8Array(inflateSync(bytes)));
  assert.equal(image.width, 3);
  assert.equal(image.height, 2);
  assert.equal(image.data[3], 255);
  assert.equal(image.data[4 * 2 + 3], 0);
  const metrics = silhouette(image);
  assert.equal(metrics.coverage, Number((2 / 6).toFixed(4)));
});

test("the journal survives a real filesystem round trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "lelu-research-"));
  try {
    const journal = new ResearchJournal(new ResearchStore(new FsDocStore(dir)));
    const created = journal.record(entry());
    const reopened = new ResearchJournal(new ResearchStore(new FsDocStore(dir)));
    assert.equal(reopened.get(created.id)?.learned, created.learned);
    assert.match(readFileSync(join(dir, "discoveries", `${created.id}.json`), "utf8"), /"status": "experiment"/);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
