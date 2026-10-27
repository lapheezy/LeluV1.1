/**
 * ==========================================================
 * LÉLU — GITHUB BRIDGE, END TO END, AGAINST REAL GITHUB
 *
 * What runs for real:
 *   - LÉLU's tool executors (ToolDispatcher.dispatchToolCall)
 *   - her GitHub bridge (GitHubIntegration → POST /api/github/proxy)
 *   - the server proxy (plugins/githubApi.ts) with its identity,
 *     LELU_ALLOW_PUSH and default-branch checks
 *   - the engineering runtime (workspace copy, write, diff, typecheck)
 *     on the dev server at LELU_BASE
 *   - GitHub itself
 *
 * What is stood in for — and only this: WHO is asking. In the app a
 * signed-in Supabase user authorizes a write; this script cannot sign
 * in as the owner, so a local identity endpoint answers the server's
 * "who is this?" for one test token, and the client session carries
 * that token. Every refusal path is exercised BEFORE the stand-in is
 * switched on.
 *
 * It writes to GitHub: one new branch `lelu-verify/<id>` with one
 * commit. It never touches the default branch. It runs only with
 * LELU_VERIFY_GITHUB_WRITE=1.
 *
 * Usage (dev server running):
 *   LELU_VERIFY_GITHUB_WRITE=1 npx tsx scripts/verify-github-bridge.ts [owner/repo]
 * ==========================================================
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

if (process.env.LELU_VERIFY_GITHUB_WRITE !== "1") {
  console.error("Refusing to run: this writes a branch and a commit to GitHub. Set LELU_VERIFY_GITHUB_WRITE=1.");
  process.exit(2);
}

const [OWNER, REPO] = (process.argv[2] ?? "lapheezy/LeluV1.1").split("/");
const DEV = (process.env.LELU_BASE ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const TEST_TOKEN = `verify-${Math.random().toString(36).slice(2)}`;

let failures = 0;
const check = (name: string, ok: boolean, evidence: unknown) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}`.slice(0, 900));
};

/* ---------- the identity stand-in (answers GET /auth/v1/user) ---------- */
const idp = createServer((req, res) => {
  const ok = req.url === "/auth/v1/user" && req.headers.authorization === `Bearer ${TEST_TOKEN}`;
  res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
  res.end(JSON.stringify(ok ? { id: "lelu-verification", email: "verification@lelu.invalid" } : { msg: "invalid" }));
});
await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
const idpUrl = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;

/* ---------- the REAL proxy middleware, in a server of its own ---------- */
// Identity is unconfigured until the stand-in is switched on below.
delete process.env.VITE_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_URL;
const { createGithubApi } = await import("../plugins/githubApi.ts");
type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
const routes = new Map<string, Handler>();
createGithubApi().attach({ use: (path: string, handler: unknown) => routes.set(path, handler as Handler) });
const proxy = createServer((req, res) => {
  const handler = routes.get((req.url ?? "").split("?")[0]);
  if (!handler) {
    res.writeHead(404);
    res.end();
    return;
  }
  handler(req, res, () => {
    res.writeHead(404);
    res.end();
  });
});
await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

/* ---------- the browser's relative URLs, resolved ---------- */
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("/api/github")) return realFetch(`${proxyUrl}${url}`, init);
  if (url.startsWith("/api/")) return realFetch(`${DEV}${url}`, init);
  return realFetch(input, init);
}) as typeof fetch;

const { dispatchToolCall } = await import("../src/core/tools/ToolDispatcher.ts");
const { default: ToolRegistry } = await import("../src/core/tools/ToolRegistry.ts");
const { default: SupabasePersistence } = await import("../src/core/persistence/SupabasePersistence.ts");
const { default: EngineeringAuthorization } = await import("../src/core/engineering/EngineeringAuthorization.ts");
await ToolRegistry.getInstance().refreshAvailability();

const call = async (name: string, args: Record<string, unknown> = {}) =>
  dispatchToolCall({ id: `verify-${name}`, name, arguments: args }, `verify-${name}`);
const engineer = async (route: string, body: Record<string, unknown>) => {
  const response = await realFetch(`${DEV}/api/engineer/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
};

const id = Date.now().toString(36);
const branch = `lelu-verify/${id}`;
const path = "tests/README.md";

console.log(`\n=== identity, repository ===`);
let result = await call("github_auth");
check("github.auth — LÉLU's bridge identity", result.ok, result.content);
result = await call("github_repos", { owner: OWNER, repo: REPO });
check("github.repos — repository and default branch", result.ok, result.content);

console.log(`\n=== workspace: read, change, diff, validate ===`);
// The workspace copies the runtime's working tree, so the GitHub base is
// the branch that tree is on — the same source the change is made against.
const git = await engineer("git", { action: "status" });
const base = String(git.branch ?? "");
check("the runtime's project and its branch", Boolean(base) && base !== "HEAD", { branch: base, clean: !String(git.status ?? "").split("\n").slice(1).some(Boolean) });
const original = await call("github_files", { owner: OWNER, repo: REPO, path, ref: base });
check(`read ${path} from GitHub @${base}`, original.ok, { chars: original.content.length, sha: (original.data as { sha?: string })?.sha });
const intended = `${original.content}\n<!-- LELU_VERIFICATION_MARKER ${id} -->\n`;
const ws = `verify-gh-${id}`;
const created = await engineer("workspace", { action: "create", workspace: ws });
check("isolated workspace copy", created.ok === true, { workspace: ws, files: (created.workspace as { fileCount?: number })?.fileCount });
const local = await engineer("read", { workspace: ws, path });
check("the copy's file is the same as GitHub's at that branch", local.content === original.content, { equal: local.content === original.content });
const wrote = await engineer("write", { workspace: ws, path, content: intended });
check("change written in the copy", wrote.ok === true, wrote);
const diff = await engineer("workspace", { action: "diff", workspace: ws, includePatch: true });
const changes = (diff.changes ?? []) as Array<{ path: string; addedLines: number; removedLines: number; patch?: string }>;
// The copy is of the working tree, which may differ from main elsewhere;
// the change under test is this file's.
const fileChange = changes.find((change) => change.path === path);
const changed = (fileChange?.patch ?? "").split("\n").filter((line) => /^[+-](?![+-])/.test(line));
check(
  "diff of the copy is exactly the intended change",
  changes.length === 1 && changed.length === 2 && changed.includes(`+<!-- LELU_VERIFICATION_MARKER ${id} -->`),
  { files: changes.map((change) => change.path), changed },
);
const typecheck = await engineer("command", { workspace: ws, operation: "typecheck" });
check("typecheck of the changed copy", typecheck.ok === true, { exit: typecheck.status, ms: typecheck.durationMs });
await engineer("workspace", { action: "remove", workspace: ws });

console.log(`\n=== without authorization: nothing reaches GitHub ===`);
result = await call("github_branches", { owner: OWNER, repo: REPO, action: "create", name: branch });
check("branch create refused (no signed-in identity)", !result.ok && /Nothing was written/.test(result.content), result.content);
// Past the client check, straight at the bridge: the server refuses too.
const { default: GitHubIntegration } = await import("../src/core/engineering/GitHubIntegration.ts");
const direct = await GitHubIntegration.getInstance().putFile(OWNER, REPO, path, intended, "verification", branch);
check("bridge write refused by the server (no identity configured)", !direct.ok && /GitHub write refused/.test(direct.error ?? ""), direct.error);

console.log(`\n=== authorization granted (identity stand-in) ===`);
process.env.VITE_SUPABASE_URL = idpUrl;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "verification-anon-key";
const persistence = SupabasePersistence.getInstance() as unknown as { getAuthState: () => unknown };
const realAuthState = persistence.getAuthState.bind(persistence);
persistence.getAuthState = () => ({ ...(realAuthState() as object), session: { access_token: TEST_TOKEN, user: { id: "lelu-verification" } } });
const authorization = EngineeringAuthorization.getInstance() as unknown as { preflight: () => { ready: boolean; reason: string } };
authorization.preflight = () => ({ ready: true, reason: "Authorized identity: verification@lelu.invalid (stand-in)." });

delete process.env.LELU_ALLOW_PUSH;
const noPush = await GitHubIntegration.getInstance().putFile(OWNER, REPO, path, intended, "verification", branch);
check("refused while LELU_ALLOW_PUSH is not set", !noPush.ok && /LELU_ALLOW_PUSH/.test(noPush.error ?? ""), noPush.error);
process.env.LELU_ALLOW_PUSH = "1";

result = await call("github_commits", { owner: OWNER, repo: REPO, action: "commit", branch: "main", path, content: intended, message: "must not land" });
check("commit to the default branch refused (client)", !result.ok && /default branch/.test(result.content), result.content);
const toMain = await GitHubIntegration.getInstance().putFile(OWNER, REPO, path, intended, "must not land", "main");
check("commit to the default branch refused (server)", !toMain.ok && /default branch/.test(toMain.error ?? ""), toMain.error);

result = await call("github_branches", { owner: OWNER, repo: REPO, action: "create", name: branch, from: base });
check(`branch ${branch} created from ${base}`, result.ok, result.content);
result = await call("github_commits", {
  owner: OWNER,
  repo: REPO,
  action: "commit",
  branch,
  path,
  content: intended,
  message: `LÉLU verification: harmless marker in ${path}\n\nIsolated verification branch; not for merging.`,
});
check("commit created and confirmed by reading it back", result.ok, result.content);
const sha = (result.data as { sha?: string } | undefined)?.sha ?? "";

console.log(`\n=== verification from GitHub itself ===`);
const shown = await call("github_commits", { owner: OWNER, repo: REPO, action: "show", sha });
check("GitHub reports the commit and its one changed file", shown.ok && shown.content.includes(`modified ${path} (+2/-0)`), shown.content.split("\n").slice(0, 4).join(" | "));
const readBack = await call("github_files", { owner: OWNER, repo: REPO, path, ref: branch });
check("file read back from the branch equals the intended content", readBack.ok && readBack.content === intended, { equal: readBack.content === intended, chars: readBack.content.length });
const baseAfter = await call("github_files", { owner: OWNER, repo: REPO, path, ref: base });
check(`${base} is unchanged`, baseAfter.ok && baseAfter.content === original.content, { equal: baseAfter.content === original.content });
const mainHead = await call("github_commits", { owner: OWNER, repo: REPO, branch: "main" });
check("main's head is untouched", mainHead.ok && !mainHead.content.includes("LÉLU verification"), mainHead.content.split("\n")[0]);

console.log(`\nBRANCH ${branch}\nCOMMIT ${sha}`);
console.log(failures === 0 ? "\nALL GITHUB BRIDGE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
idp.close();
proxy.close();
process.exit(failures === 0 ? 0 : 1);
