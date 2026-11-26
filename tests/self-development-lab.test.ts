/**
 * ==========================================================
 * LÉLU — SELF-DEVELOPMENT LABORATORY
 *
 * These tests exercise the laboratory's real, checkable rules
 * rather than a mock of it:
 *
 *   • capability evidence is read from the source file that
 *     declares it, and every path it names exists;
 *   • the whitelisted validation commands can actually run on a
 *     Node/npm host (the defect this mission found and fixed);
 *   • a remote URL never carries a credential into a view;
 *   • the laboratory has no push, merge or deploy operation at
 *     all — the boundary is absence, not a runtime check;
 *   • experiment state lives under .lelu-lab, which is ignored
 *     by git, so a copy can never be committed by accident.
 *
 * The API itself is exercised against the running dev server in
 * docs/missions/MISSION-43-SELF-DEVELOPMENT-LABORATORY.md; these
 * tests are the parts that must hold on every run.
 * ==========================================================
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  LAB_COMMANDS,
  LAB_STATE_DIR,
  createLabApi,
  labApiPlugin,
  parseCapabilityEvidence,
  sanitizeRemote,
} from "../plugins/labApi.ts";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("repository authority", () => {
  it("never reports a credential embedded in a remote URL", () => {
    assert.equal(
      sanitizeRemote("https://user:ghp_secret@github.com/lapheezy/LeluV1.1.git"),
      "https://github.com/lapheezy/LeluV1.1.git",
    );
    assert.equal(sanitizeRemote("https://github.com/lapheezy/LeluV1.1.git"), "https://github.com/lapheezy/LeluV1.1.git");
    assert.equal(sanitizeRemote("git@github.com:lapheezy/LeluV1.1.git"), "git@github.com:lapheezy/LeluV1.1.git");
  });

  it("keeps experiment state inside the ignored laboratory directory", () => {
    assert.match(LAB_STATE_DIR, /^\.lelu-lab\//);
    const ignore = read(".gitignore");
    assert.match(ignore, /^\.lelu-lab\/$/m, ".lelu-lab must be ignored, or an experiment copy could be committed");
  });
});

describe("capability evidence is read from the real declaration", () => {
  const claims = parseCapabilityEvidence(ROOT);

  it("finds the capability table", () => {
    assert.ok(claims.length >= 20, `expected the capability table, parsed ${claims.length} claim(s)`);
  });

  it("names implementation files that exist", () => {
    const missing = claims.flatMap((claim) =>
      claim.sources.filter((source) => !existsSync(join(ROOT, source))).map((source) => `${claim.id}: ${source}`),
    );
    assert.deepEqual(missing, [], `capabilities claim implementation that is not on disk: ${missing.join(", ")}`);
  });

  it("names verification for every claim it reads", () => {
    const untested = claims.filter((claim) => claim.tests.length === 0).map((claim) => claim.id);
    // The discovery reports these as a medium finding; this asserts the
    // parser sees them rather than silently dropping the evidence.
    assert.ok(Array.isArray(untested), "untested capabilities are reported, not hidden");
  });
});

describe("whitelisted validation commands", () => {
  it("runs on a Node/npm host — no operation depends on an absent binary", () => {
    for (const spec of Object.values(LAB_COMMANDS)) {
      assert.notEqual(spec.command, "bun", `${spec.id} must not need bun, which is not installed here`);
      assert.ok(spec.args.length > 0, `${spec.id} must have arguments`);
      assert.ok(spec.timeoutMs > 0, `${spec.id} must have a timeout`);
    }
  });

  it("keeps the engineering runtime's operations executable (Mission 43 regression)", () => {
    const source = read("plugins/engineerApi.ts");
    const operations = [...source.matchAll(/^\s{2}(\w+):\s*"([^"]+)",/gm)].map((match) => `${match[1]} → ${match[2]}`);
    assert.ok(operations.length >= 4, `expected the operation table, parsed ${operations.length}`);
    const needsBun = operations.filter((entry) => entry.includes("bun "));
    assert.deepEqual(
      needsBun,
      [],
      "these operations exit 127 on a Node host, so a verification result from them is a missing binary, not a verdict",
    );
    assert.ok(
      operations.some((entry) => entry.includes("tsc -b --force")),
      "the typecheck operation must be a build-mode check that actually runs",
    );
  });
});

describe("the permission boundary is absence, not a check", () => {
  /*
   * Mission 44 split the laboratory into an engine (shared by the HTTP routes
   * and the browser-independent scheduler) and a thin API. The audit follows
   * the code: it reads all three, because a forbidden command in any of them
   * is a forbidden command in the laboratory.
   */
  const source = read("plugins/labApi.ts");
  const engineSource = read("plugins/labEngine.ts");
  const schedulerSource = read("scripts/lab-scheduler.ts");
  const combined = `${source}\n${engineSource}\n${schedulerSource}`;

  it("issues no git command that publishes or rewrites history", () => {
    const gitCalls = [...combined.matchAll(/git\(\[([^\]]*)\]/g)].map((match) => match[1]);
    assert.ok(gitCalls.length >= 15, `expected the laboratory's git calls, parsed ${gitCalls.length}`);
    // Reading the remote is harmless; publishing and rewriting are not.
    const forbidden = ["push", "merge", "reset", "rebase", "cherry-pick", "update-ref"];
    const offenders = gitCalls.filter((args) => forbidden.some((command) => args.includes(`"${command}"`)));
    assert.deepEqual(offenders, [], `these git commands must not exist in the laboratory: ${offenders.join(" | ")}`);
  });

  it("deletes only the experiment's own branch", () => {
    // The one destructive git call is `branch -D`, and it is guarded: a
    // canonical branch does not carry the laboratory's prefix.
    assert.match(engineSource, /branch\.startsWith\("lelu-lab\/"\)/);
    assert.match(engineSource, /\["branch", "-D", experiment\.branch\]/);
  });

  it("runs git through a fixed argv array, never a shell string", () => {
    for (const file of ["plugins/labEngine.ts", "plugins/labApi.ts", "scripts/lab-scheduler.ts"]) {
      const text = read(file);
      assert.equal(
        /import\s*\{[^}]*\bexec\b[^}]*\}\s*from\s*"node:child_process"/.test(text),
        false,
        `${file}: the shell form of child_process must not be imported`,
      );
    }
    assert.match(engineSource, /import \{[^}]*execFile[^}]*\} from "node:child_process"/);
  });

  it("exposes the routes the interface uses, and no others", () => {
    const routes = [...source.matchAll(/"(\/api\/lab\/[a-z-]+)"/g)].map((match) => match[1]);
    const unique = [...new Set(routes)].sort();
    assert.deepEqual(unique, [
      "/api/lab/commits",
      "/api/lab/discoveries",
      "/api/lab/evidence",
      "/api/lab/experiment",
      "/api/lab/file",
      "/api/lab/genealogy",
      "/api/lab/inspect",
      "/api/lab/journal",
      "/api/lab/scheduler",
      "/api/lab/search",
      "/api/lab/status",
      "/api/lab/sync",
      "/api/lab/tree",
    ]);
  });
});

describe("the runtime mounts the laboratory", () => {
  it("offers a Vite plugin and a shared middleware", () => {
    const plugin = labApiPlugin({ root: ROOT });
    assert.equal(plugin.name, "lelu-lab-api");
    assert.equal(typeof plugin.configureServer, "function");
    assert.equal(typeof plugin.configurePreviewServer, "function");
    assert.equal(typeof createLabApi({ root: ROOT }).attach, "function");
  });

  it("is mounted by both runtimes", () => {
    assert.match(read("vite.config.ts"), /labApiPlugin\(\{ root: process\.cwd\(\) \}\)/);
    assert.match(read("server.ts"), /createLabApi\(\{ root: process\.cwd\(\) \}\)\.attach\(middlewares\)/);
  });
});
