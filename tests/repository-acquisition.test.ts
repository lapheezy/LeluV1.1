/**
 * ==========================================================
 * LÉLU — REPOSITORY ACQUISITION ENGINE
 *
 * The connector, store and approval boundaries, and the acquired
 * fuzzy-search capability, exercised for real. Network-facing
 * behaviour is tested against a stub transport; the live clone
 * was exercised through /api/acquisition (see
 * scripts/verify-repo-workforce.ts).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

import GitHubSource from "../src/core/acquisition/GitHubSource";
import RepositorySourceRegistry, {
  RepositorySourceError,
  type RepositorySource,
} from "../src/core/acquisition/RepositorySource";
import AcquisitionStore from "../src/core/acquisition/AcquisitionStore";
import ApprovalGate from "../src/core/acquisition/ApprovalGate";
import TechnologyKnowledgeBase from "../src/core/acquisition/TechnologyKnowledgeBase";
import { BitapMatcher, fuzzyScore, fuzzySearch, highlightMatch } from "../src/core/acquisition/capabilities/FuzzyTextSearch";
import { licenseObligations, licenseRisk, type ResearchFindings } from "../src/core/acquisition/AcquisitionTypes";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import { extractZip } from "../plugins/acquisitionApi";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* connectors                                                          */
/* ------------------------------------------------------------------ */

function stubFetch(responses: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const pathname = new URL(url).pathname;
    const body = responses[pathname] ?? responses["*"] ?? { message: "not stubbed" };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return { impl, calls };
}

const repoPayload = {
  id: 1,
  full_name: "krisk/Fuse",
  html_url: "https://github.com/krisk/Fuse",
  description: "Lightweight fuzzy-search",
  stargazers_count: 19000,
  forks_count: 800,
  language: "TypeScript",
  topics: ["fuzzy", "search"],
  license: { spdx_id: "Apache-2.0", name: "Apache License 2.0" },
  default_branch: "main",
  pushed_at: "2026-10-01T00:00:00Z",
  archived: false,
  open_issues_count: 12,
};

test("GitHub search maps real repository fields and never invents results", async () => {
  const { impl, calls } = stubFetch({ "/search/repositories": { items: [repoPayload] } });
  const source = new GitHubSource({ fetchImpl: impl });
  const results = await source.search({ keywords: "fuzzy search", language: "TypeScript", limit: 5 });

  assert.equal(results.length, 1);
  assert.equal(results[0].identifier, "krisk/Fuse");
  assert.equal(results[0].license, "Apache-2.0");
  assert.equal(results[0].stars, 19000);
  assert.equal(results[0].defaultBranch, "main");
  const query = new URL(calls[0]).searchParams.get("q") ?? "";
  assert.match(query, /fuzzy search/);
  assert.match(query, /language:TypeScript/);
  assert.match(query, /archived:false/);
});

test("GitHub errors are raised with the HTTP status, and exhaustion of the anonymous quota is explained", async () => {
  const source = new GitHubSource({
    fetchImpl: (async () =>
      new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: { "content-type": "application/json", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" },
      })) as typeof fetch,
  });
  await assert.rejects(
    () => source.search({ keywords: "x" }),
    (error: unknown) =>
      error instanceof RepositorySourceError &&
      error.status === 403 &&
      /quota is exhausted/.test(error.message),
  );
});

test("metadata, commits, tree, file and license all come from the transport", async () => {
  const { impl } = stubFetch({
    "/repos/krisk/Fuse": repoPayload,
    "/repos/krisk/Fuse/commits": [
      { sha: "edf2fb608eca0461508d1d71317e6e58309ffada", commit: { message: "perf: bitap\n\nbody", author: { name: "Kiro", date: "2026-11-01T00:00:00Z" } } },
    ],
    "/repos/krisk/Fuse/git/trees/main": {
      tree: [
        { path: "src/search/bitap/search.ts", type: "blob", size: 5931 },
        { path: "src", type: "tree" },
      ],
    },
    "/repos/krisk/Fuse/contents/LICENSE": { type: "file", encoding: "base64", content: Buffer.from("Apache License").toString("base64") },
    "/repos/krisk/Fuse/license": { license: { spdx_id: "Apache-2.0", name: "Apache License 2.0" }, content: Buffer.from("Apache License Version 2.0").toString("base64") },
  });
  const source = new GitHubSource({ fetchImpl: impl });

  const metadata = await source.metadata("krisk/Fuse");
  assert.equal(metadata.identifier, "krisk/Fuse");

  const commits = await source.commits("krisk/Fuse", "main", 5);
  assert.equal(commits[0].sha.slice(0, 7), "edf2fb6");
  assert.equal(commits[0].message, "perf: bitap");

  const tree = await source.tree("krisk/Fuse");
  assert.deepEqual(tree[1], { path: "src", type: "dir", size: undefined });

  assert.equal(await source.file("krisk/Fuse", "LICENSE", "main"), "Apache License");
  const license = await source.license("krisk/Fuse");
  assert.equal(license.spdx, "Apache-2.0");
  assert.match(license.excerpt, /Apache License Version 2.0/);
});

test("the connector registry resolves a clone URL and reports a failing source instead of dropping it", async () => {
  const registry = RepositorySourceRegistry.getInstance();
  const github = new GitHubSource({
    fetchImpl: stubFetch({ "/search/repositories": { items: [repoPayload] } }).impl,
  });
  registry.register(github);

  const failing: RepositorySource = {
    id: "broken",
    label: "Broken",
    supports: () => false,
    search: async () => {
      throw new Error("source offline");
    },
    metadata: async () => {
      throw new Error("unused");
    },
    branches: async () => [],
    commits: async () => [],
    tree: async () => [],
    file: async () => "",
    license: async () => ({ spdx: "UNKNOWN", name: "", url: "", excerpt: "" }),
  };
  registry.register(failing);

  assert.equal(registry.forUrl("https://github.com/krisk/Fuse")?.id, "github");
  const result = await registry.searchAll({ keywords: "search", limit: 1 });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.errors.find((entry) => entry.sourceId === "broken")?.error, "source offline");
});

/* ------------------------------------------------------------------ */
/* archive import                                                     */
/* ------------------------------------------------------------------ */

/** Build a minimal stored (uncompressed) ZIP for extraction tests. */
function makeStoredZip(entries: Array<{ name: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

test("ZIP import writes real files and refuses path traversal", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lelu-acq-"));
  try {
    const archive = makeStoredZip([
      { name: "pkg/index.js", content: "export const x = 1;\n" },
      { name: "pkg/README.md", content: "# imported\n" },
    ]);
    const result = extractZip(archive, dir);
    assert.equal(result.files, 2);
    assert.equal(readFileSync(path.join(dir, "pkg/index.js"), "utf8"), "export const x = 1;\n");

    const hostile = makeStoredZip([{ name: "../../escaped.txt", content: "nope" }]);
    assert.throws(() => extractZip(hostile, dir), /Unsafe archive entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* approvals                                                          */
/* ------------------------------------------------------------------ */

test("no autonomy means no approval, whatever is asked for", () => {
  ApprovalGate.resetForTests();
  const gate = ApprovalGate.getInstance();
  AutonomyGate.getInstance().setLevel(1);
  try {
    const preflight = gate.preflight("destructive");
    assert.equal(preflight.ready, false);
    assert.match(preflight.reason, /autonomy level 4/);
    const decision = gate.authorize("destructive", "acq-1", "operator", "delete a test acquisition");
    assert.equal(decision.allowed, false);
    assert.equal(gate.grantFor("destructive", "acq-1"), null);
  } finally {
    AutonomyGate.getInstance().setLevel(2);
  }
});

test("an explicit operator authorization is scoped, consumable and revoked by lowering autonomy", () => {
  ApprovalGate.resetForTests();
  const gate = ApprovalGate.getInstance();
  AutonomyGate.getInstance().setLevel(5);
  try {
    const decision = gate.authorize("canonical-write", "acq-1", "operator@test", "commit an adaptation");
    assert.equal(decision.allowed, true);
    assert.equal(decision.grant?.scope, "canonical-write");
    assert.equal(decision.grant?.targetId, "acq-1");
    assert.equal(gate.grantFor("canonical-write", "acq-2"), null);

    const required = gate.require("canonical-write", "acq-1");
    assert.equal(required.allowed, true);

    AutonomyGate.getInstance().setLevel(2);
    assert.equal(gate.grantFor("canonical-write", "acq-1"), null);
    AutonomyGate.getInstance().setLevel(5);

    const fresh = gate.authorize("canonical-write", "acq-1", "operator@test", "again");
    assert.equal(fresh.allowed, true);
    gate.consume("canonical-write", "acq-1");
    assert.equal(gate.grantFor("canonical-write", "acq-1"), null);
    assert.equal(gate.require("canonical-write", "acq-1").allowed, false);
  } finally {
    AutonomyGate.getInstance().setLevel(2);
  }
});

/* ------------------------------------------------------------------ */
/* acquisition store                                                  */
/* ------------------------------------------------------------------ */

test("pipeline runs record real stage events and stay bounded", () => {
  AcquisitionStore.resetForTests();
  const store = AcquisitionStore.getInstance();
  const run = store.createRun({ objective: "add typo-tolerant search" });
  for (let index = 0; index < 300; index += 1) {
    store.recordStage(run.id, "inspect", true, `event ${index}`);
  }
  const stored = store.getRun(run.id);
  assert.ok(stored);
  assert.equal(stored.events.length, 240);
  assert.equal(stored.events.at(-1)?.detail, "event 299");

  store.recordStage(run.id, "connect", false, "adapter could not be written");
  assert.equal(store.getRun(run.id)?.failure, "adapter could not be written");
  assert.equal(store.getRun(run.id)?.stage, "connect");
});

/* ------------------------------------------------------------------ */
/* the acquired capability                                            */
/* ------------------------------------------------------------------ */

test("Bitap finds typo-tolerant matches and reports a real score", () => {
  assert.equal(fuzzyScore("fuzzy", "fuzzy"), 0);
  const typo = new BitapMatcher("fzzy").searchIn("Lightweight fuzzy-search library");
  assert.equal(typo.isMatch, true);
  assert.ok(typo.score > 0 && typo.score <= 0.6, `score ${typo.score}`);

  const distant = new BitapMatcher("kubernetes").searchIn("Lightweight fuzzy-search library");
  assert.equal(distant.isMatch, false);
  assert.equal(distant.score, 1);

  const highlighted = new BitapMatcher("fuzzy", { includeMatches: true }).searchIn("Lightweight fuzzy-search");
  assert.ok(highlighted.indices && highlighted.indices.length > 0);
  assert.match(highlightMatch("Lightweight fuzzy-search", highlighted.indices), /«fuzzy»/);
});

test("tokenised multi-field search requires every term and ranks the best field first", () => {
  const items = [
    { name: "Lightweight fuzzy-search library", tags: "search typo" },
    { name: "Vector database", tags: "embeddings search" },
    { name: "Image codec", tags: "image" },
  ];
  const hits = fuzzySearch(items, "fuzzy search", { keys: (item) => [item.name, item.tags], limit: 3 });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].item.name, /fuzzy-search/);
  assert.ok(hits[0].score <= 0.6);

  const none = fuzzySearch(items, "fuzzy kubernetes", { keys: (item) => [item.name, item.tags] });
  assert.equal(none.length, 0);
});

test("knowledge base records research and answers a fuzzy query", () => {
  TechnologyKnowledgeBase.resetForTests();
  const kb = TechnologyKnowledgeBase.getInstance();
  const findings: ResearchFindings = {
    candidateId: "github:krisk/Fuse",
    identifier: "krisk/Fuse",
    summary: "Lightweight fuzzy-search",
    capabilities: ["fuzzy search", "search"],
    dependencies: [],
    buildSystem: "npm",
    entryPoints: ["src/index.ts"],
    license: { spdx: "Apache-2.0", name: "Apache License 2.0", risk: "permissive", obligations: licenseObligations("Apache-2.0") },
    maintenance: { lastCommit: "edf2fb6", lastCommitAt: "2026-11-01T00:00:00Z", commitsLast90Days: 3, archived: false, stars: 19000, openIssues: 12 },
    security: { observations: [], riskLevel: "low" },
    compatibility: { runtime: "browser", languages: ["TypeScript"], score: 0.9, reasons: [] },
    researchedAt: Date.now(),
  };
  kb.addFromResearch(
    { id: "github:krisk/Fuse", identifier: "krisk/Fuse", url: "https://github.com/krisk/Fuse", description: "Lightweight fuzzy-search", topics: ["search"], stars: 19000, license: "Apache-2.0" },
    findings,
    "edf2fb608eca0461508d1d71317e6e58309ffada",
  );

  const hits = kb.search("fuzzy serach"); // deliberate typo
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].entry.sourceIdentifier, "krisk/Fuse");
  assert.equal(kb.obligations("krisk/Fuse").length, 2);
  assert.match(kb.describe(), /krisk\/Fuse/);
});

test("license classification states real obligations", () => {
  assert.equal(licenseRisk("Apache-2.0"), "permissive");
  assert.equal(licenseRisk("AGPL-3.0"), "copyleft");
  assert.equal(licenseRisk("MPL-2.0"), "weak-copyleft");
  assert.equal(licenseRisk("WTFPL"), "unknown");
  assert.match(licenseObligations("AGPL-3.0").join(" "), /source disclosure/);
});
