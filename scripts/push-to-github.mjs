// Push main to origin using GITHUB_TOKEN from the environment.
// Never prints the token. Safe to run read-only diagnostics before pushing.
import { execFileSync } from "node:child_process";

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
if (!token) {
  console.log("NO_GITHUB_TOKEN: add GITHUB_TOKEN via the API Keys UI first.");
  process.exit(2);
}

function run(args) {
  try {
    const out = execFileSync("/usr/bin/git", args, {
      encoding: "utf8",
      cwd: "/home/daytona/codebase",
      timeout: 60000,
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: String(e.message).slice(0, 800) };
  }
}

// Pre-push diagnostics
console.log("BRANCH:", JSON.stringify(run(["branch", "--show-current"])));
console.log("STATUS:", JSON.stringify(run(["status", "--short"])));
console.log(
  "UNPUSHED:",
  JSON.stringify(run(["log", "--oneline", "@{u}..HEAD", "-5"])),
);
console.log(
  "REMOTE:",
  JSON.stringify(run(["remote", "get-url", "origin"])).replace(
    /https:\/\/[^@\s]+@/g,
    "https://<redacted>@",
  ),
);

// Use token in the push URL without persisting it in config
const pushUrl = `https://x-access-token:${token}@github.com/lapheru/leluv2.git`;
try {
  const r = run(["push", pushUrl, "HEAD:main"]);
  console.log("PUSH:", JSON.stringify(r));
  if (!r.ok) process.exit(1);
} finally {
  // scrub the token from any chance of lingering (it was only in-memory)
  void pushUrl;
}
console.log("DONE");
