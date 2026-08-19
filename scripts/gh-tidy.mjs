// Remove leftover scratch script from the repo, push, verify, then delete itself.
import { execFileSync } from "node:child_process";
import { cwd } from "node:process";
import { rmSync } from "node:fs";

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
if (!token) process.exit(2);
const REPO = "lapheru/lelu-v2";
const AUTH_URL = `https://x-access-token:${token}@github.com/${REPO}.git`;
const ROOT = cwd();

function run(args) {
  try {
    const out = execFileSync("/usr/bin/git", args, {
      encoding: "utf8",
      cwd: ROOT,
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e.message || e).slice(0, 600) };
  }
}

const status = run(["status", "--porcelain"]);
console.log("STATUS_BEFORE:\n" + (status.out || "(clean)"));
if (status.out) {
  run(["add", "-A"]);
  const commit = run(["commit", "-m", "Remove scratch push helper script"]);
  console.log("COMMIT:", commit.ok ? "ok" : commit.out);
}
const push = run(["push", AUTH_URL, "HEAD:main"]);
console.log("PUSH:", push.ok ? "ok" : push.out);
const local = run(["rev-parse", "HEAD"]).out;
const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
  headers: { Authorization: `Bearer ${token}`, "User-Agent": "lelu-tidy", Accept: "application/vnd.github+json" },
});
const data = await res.json();
console.log("LOCAL_HEAD:", local);
console.log("REMOTE_HEAD:", data.sha);
console.log("MATCH:", local === data.sha ? "YES" : "NO");
console.log("LOCAL_STATUS_AFTER:\n" + (run(["status", "--porcelain"]).out || "(clean)"));

// Remove this scratch script (not committed)
rmSync(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), { force: true });
console.log("DONE");
