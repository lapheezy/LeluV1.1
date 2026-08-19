// One-shot sync: fast-forward remote main to a new commit built from the
// CURRENT working tree, parented on the CURRENT remote head (FETCH_HEAD).
// Non-destructive: no force, no history removal — the remote gains one
// commit whose tree is the full current workspace. Token is read from env,
// used in-memory only, never printed and never stored.
import { execFileSync } from "node:child_process";
import { cwd } from "node:process";

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
if (!token) {
  console.log("NO_GITHUB_TOKEN");
  process.exit(2);
}

const REPO = "lapheru/lelu-v2";
const REPO_URL = `https://github.com/${REPO}.git`;
const AUTH_URL = `https://x-access-token:${token}@github.com/${REPO}.git`;
const ROOT = cwd();

function run(args, env = {}) {
  try {
    const out = execFileSync("/usr/bin/git", args, {
      encoding: "utf8",
      cwd: ROOT,
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e.message || e).slice(0, 1200) };
  }
}

// 1. Fetch the current remote head into local objects (public repo)
const fetch = run(["fetch", REPO_URL, "main"]);
console.log("FETCH:", fetch.ok ? "ok" : fetch.out);
if (!fetch.ok) process.exit(1);
const remoteHead = run(["rev-parse", "FETCH_HEAD"]).out;
console.log("REMOTE_MAIN_BEFORE:", remoteHead);

// 2. Stage the full current working tree
const add = run(["add", "-A"]);
console.log("STAGE:", add.ok ? "ok" : add.out);
if (!add.ok) process.exit(1);

// 3. Build a commit with the current tree, parented on the remote head
const writeTree = run(["write-tree"]);
if (!writeTree.ok) {
  console.log("WRITE_TREE_FAILED:", writeTree.out);
  process.exit(1);
}
console.log("TREE:", writeTree.out);

const commit = run([
  "commit-tree",
  writeTree.out,
  "-p",
  remoteHead,
  "-m",
  "Sync current LELUV2 workspace: full current version — Cerebras/Mistral/Fireworks providers, API Status tab, LÉLU memory + identity, unified Genesis core",
]);
if (!commit.ok) {
  console.log("COMMIT_TREE_FAILED:", commit.out);
  process.exit(1);
}
console.log("NEW_COMMIT:", commit.out);

// 4. Fast-forward push (rejected safely if the remote moved meanwhile)
const push = run(["push", AUTH_URL, `${commit.out}:main`]);
console.log("PUSH:", push.ok ? "ok" : push.out);
if (!push.ok) {
  console.log("PUSH_FAILED — remote may have moved; no changes were lost.");
  process.exit(1);
}
console.log("DONE");
