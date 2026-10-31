/**
 * LÉLU — WHAT CODE IS THIS?
 *
 * Read from git (or the CI/host's own commit variables) when Vite
 * starts or builds, and compiled into the bundle as __LELU_BUILD__.
 * Nothing here is typed by hand: a badge that says "4315072" is only
 * true if the build was made from 4315072.
 *
 * In `vite dev` this is the state at SERVER START; HMR does not restamp
 * it, so a dev page edited since then says "dev" and when it started.
 */
import { execFileSync } from "node:child_process";

export interface BuildInfo {
  sha: string;
  shortSha: string;
  branch: string;
  /** Uncommitted changes in the working tree at build time. */
  dirty: boolean;
  builtAt: string;
  mode: string;
  /** Which variable supplied the commit when git was unavailable. */
  source: string;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function readBuildInfo(mode: string): BuildInfo {
  const env = process.env;
  const hosted =
    [["GITHUB_SHA", env.GITHUB_SHA], ["VERCEL_GIT_COMMIT_SHA", env.VERCEL_GIT_COMMIT_SHA], ["COMMIT_REF", env.COMMIT_REF], ["CF_PAGES_COMMIT_SHA", env.CF_PAGES_COMMIT_SHA]]
      .find(([, value]) => Boolean(value)) as [string, string] | undefined;
  const sha = git(["rev-parse", "HEAD"]) || hosted?.[1] || "unknown";
  const branch =
    git(["rev-parse", "--abbrev-ref", "HEAD"]) ||
    env.GITHUB_REF_NAME || env.VERCEL_GIT_COMMIT_REF || env.BRANCH || env.CF_PAGES_BRANCH || "unknown";
  return {
    sha,
    shortSha: sha === "unknown" ? sha : sha.slice(0, 7),
    branch,
    dirty: git(["status", "--porcelain", "--untracked-files=no"]).length > 0,
    builtAt: new Date().toISOString(),
    mode,
    source: git(["rev-parse", "HEAD"]) ? "git" : hosted?.[0] ?? "none",
  };
}
