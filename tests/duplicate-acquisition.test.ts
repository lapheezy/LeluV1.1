import test from "node:test";
import assert from "node:assert/strict";

import {
  AcquisitionSingleFlight,
  findReusableAcquisition,
  normalizeRepositoryUrl,
  sameRepository,
} from "../src/core/acquisition/AcquisitionIdentity";
import type { AcquisitionRecord } from "../src/core/acquisition/AcquisitionTypes";

function record(overrides: Partial<AcquisitionRecord> & { identifier: string }): AcquisitionRecord {
  const { identifier, ...rest } = overrides;
  return {
    id: `acq-${identifier.replace(/[^a-z0-9]+/gi, "-")}`,
    name: identifier,
    source: { kind: "github", identifier, url: `https://github.com/${identifier}.git`, host: "github.com" },
    ref: "main",
    commit: "0".repeat(40),
    license: { spdx: "MIT", name: "MIT", path: "LICENSE", excerpt: "" },
    sizeBytes: 0,
    fileCount: 0,
    createdAt: 0,
    updatedAt: 0,
    status: "acquired",
    versions: [],
    capability: null,
    notes: [],
    fingerprint: "",
    ...rest,
  } as AcquisitionRecord;
}

const spellings = [
  "https://github.com/typesense/typesense.git",
  "https://github.com/typesense/typesense",
  "http://github.com/typesense/typesense/",
  "https://www.github.com/Typesense/Typesense.git",
  "git@github.com:typesense/typesense.git",
  "ssh://git@github.com/typesense/typesense.git",
  "github.com/typesense/typesense",
  "typesense/typesense",
];

test("every accepted spelling resolves to one identity", () => {
  const canonical = normalizeRepositoryUrl(spellings[0]);
  assert.equal(canonical.host, "github.com");
  assert.equal(canonical.identifier, "typesense/typesense");
  assert.equal(canonical.url, "https://github.com/typesense/typesense.git");
  for (const spelling of spellings) {
    assert.deepEqual(normalizeRepositoryUrl(spelling), canonical, spelling);
    assert.ok(sameRepository(spellings[0], spelling), spelling);
  }
});

test("different repositories stay different", () => {
  assert.equal(sameRepository("typesense/typesense", "typesense/typesense-go"), false);
  assert.equal(sameRepository("owner/one", "other/one"), false);
  assert.notDeepEqual(normalizeRepositoryUrl("a/b"), normalizeRepositoryUrl("c/b"));
});

test("an unreadable identity is refused rather than guessed", () => {
  assert.throws(() => normalizeRepositoryUrl(""), /required/i);
  assert.throws(() => normalizeRepositoryUrl("   "), /required/i);
  assert.throws(() => normalizeRepositoryUrl("not a repository"), /cannot read/i);
  assert.equal(sameRepository("nonsense", "also nonsense"), false);
});

test("the same repository at the same ref reuses the existing acquisition", () => {
  const records = [record({ identifier: "typesense/typesense", ref: "v31" })];
  const identity = normalizeRepositoryUrl("https://github.com/Typesense/Typesense.git");
  const found = findReusableAcquisition(records, identity, "v31");
  assert.equal(found?.id, "acq-typesense-typesense");
});

test("a different ref is a deliberate reinspection, not a duplicate", () => {
  const records = [record({ identifier: "typesense/typesense", ref: "v31" })];
  const identity = normalizeRepositoryUrl("typesense/typesense");
  assert.equal(findReusableAcquisition(records, identity, "v30"), null);
  assert.equal(findReusableAcquisition(records, identity, ""), records[0]);
});

test("a different repository never reuses an existing acquisition", () => {
  const records = [record({ identifier: "typesense/typesense" })];
  const identity = normalizeRepositoryUrl("typesense/typesense-go");
  assert.equal(findReusableAcquisition(records, identity, ""), null);
});

test("concurrent requests for one repository run the work once", async () => {
  const flights = new AcquisitionSingleFlight();
  let work = 0;
  const slow = async () => {
    work += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { id: "acq-once" };
  };

  const first = flights.run("github.com/typesense/typesense#", slow);
  const second = flights.run("github.com/typesense/typesense#", slow);
  assert.equal(flights.size(), 1);

  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, { id: "acq-once" });
  assert.deepEqual(b, { id: "acq-once" });
  assert.equal(work, 1, "the clone work must happen once");
  assert.equal(flights.size(), 0, "the flight is released afterwards");

  // A later request is a new flight, not a permanently cached answer.
  await flights.run("github.com/typesense/typesense#", async () => ({ id: "acq-once" }));
  assert.equal(work, 1);
});

test("different repositories clone independently and concurrently", async () => {
  const flights = new AcquisitionSingleFlight();
  let work = 0;
  const slow = async () => {
    work += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return work;
  };
  const [first, second] = await Promise.all([
    flights.run("github.com/a/one#", async () => {
      work += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "a";
    }),
    flights.run("github.com/b/two#", async () => {
      work += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "b";
    }),
  ]);
  assert.equal(work, 2, "distinct repositories must not share a flight");
  assert.equal(first, "a");
  assert.equal(second, "b");
});
