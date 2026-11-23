/**
 * LÉLU 2 — the Node side of the research journal.
 *
 * The cognition layer is runtime-agnostic; this file is the only place
 * that touches the disk and git. Keeping the boundary here means the
 * journal can be tested in memory and shipped in the browser without
 * two copies of the storage rules.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DocStore } from "../../src/core/cognition/research/store";
import type { DevelopmentEventSource, RawArtifact, RawCommit, RawResult } from "../../src/core/cognition/research/observations";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const RESEARCH_DIR = join(PROJECT_ROOT, "research");
export const ARTIFACT_DIR = join(PROJECT_ROOT, "artifacts/lelu2");
export const RESULT_DIR = join(ARTIFACT_DIR, "research/results");

/** One JSON document per file, one directory per research kind. */
export class FsDocStore implements DocStore {
  constructor(private readonly root: string = RESEARCH_DIR) {}

  public list(dir: string): string[] {
    const path = join(this.root, dir);
    if (!existsSync(path)) return [];
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  }

  public read(path: string): string | null {
    const target = join(this.root, path);
    return existsSync(target) ? readFileSync(target, "utf8") : null;
  }

  public write(path: string, content: string): void {
    const target = join(this.root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  public remove(path: string): void {
    rmSync(join(this.root, path), { force: true });
  }
}

function git(args: string[]): string {
  return execFileSync("git", ["-c", "safe.directory=*", ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Commits with the files they touched.
 *
 * `%x01` cannot appear in a commit subject, so it is a safe record
 * separator: everything after it until the next one is that commit's
 * file list.
 */
export function gitCommits(limit = 40): RawCommit[] {
  let raw: string;
  try {
    raw = git(["log", `-${limit}`, "--name-only", "--pretty=format:%x01%H%x1f%at%x1f%s"]);
  } catch {
    return []; // not a git worktree (an exported archive): no commits to observe
  }
  let branch: string | null = null;
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim() || null;
  } catch {
    branch = null;
  }

  return raw
    .split("\x01")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const lines = chunk.split("\n");
      const [sha, at, subject] = lines[0].split("\x1f");
      return {
        sha: sha.trim(),
        at: Number(at) * 1000,
        message: subject ?? "",
        files: lines.slice(1).map((line) => line.trim()).filter(Boolean),
        branch,
      };
    })
    .filter((commit) => /^[0-9a-f]{7,40}$/.test(commit.sha));
}

/** Every artefact that could be evidence, newest first. */
export function artifacts(max = 160): RawArtifact[] {
  if (!existsSync(ARTIFACT_DIR)) return [];
  const found: RawArtifact[] = [];
  const walk = (dir: string, depth = 0): void => {
    if (depth > 4 || found.length > max * 4) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!/\.(png|json|glb|gltf)$/i.test(entry.name)) continue;
      if (/\.job\.json$/.test(entry.name)) continue;
      const info = statSync(path);
      found.push({ path: path.slice(PROJECT_ROOT.length + 1), bytes: info.size, modifiedAt: info.mtimeMs });
    }
  };
  walk(ARTIFACT_DIR);
  return found.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, max);
}

/** Build/test outcomes written by the mission's own runners. */
export function results(): RawResult[] {
  if (!existsSync(RESULT_DIR)) return [];
  return readdirSync(RESULT_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        const parsed = JSON.parse(readFileSync(join(RESULT_DIR, name), "utf8")) as RawResult;
        if (typeof parsed.name === "string" && typeof parsed.ok === "boolean") return parsed;
      } catch {
        // an unreadable result is not a result
      }
      return null;
    })
    .filter((item): item is RawResult => item !== null);
}

export function source(): DevelopmentEventSource {
  return { commits: gitCommits, artifacts, results };
}

export function writeResult(result: RawResult): void {
  mkdirSync(RESULT_DIR, { recursive: true });
  const name = result.name.replace(/[^A-Za-z0-9._-]/g, "-");
  writeFileSync(join(RESULT_DIR, `${name}.json`), JSON.stringify(result, null, 2) + "\n");
}
