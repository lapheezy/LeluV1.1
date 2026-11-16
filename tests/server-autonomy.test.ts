/**
 * ==========================================================
 * LÉLU — THE SERVER OWNS AUTONOMY AND THE RIGHT TO CHANGE THE PROJECT
 *
 * CATEGORY: integration. The REAL engineering API handlers
 * (createEngineerApi), the REAL Node adapter on a throwaway project and
 * the REAL autonomy store on a temp file. Only Supabase is replaced:
 * identity and password checks are injected fakes, because this
 * environment has no test Supabase project (see the master-integration
 * report). Everything the server decides is the production code path.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEngineerApi } from "../plugins/engineerApi";
import { createNodeEngineerAdapter } from "../plugins/nodeAdapters";
import { createServerAutonomyStore, DEFAULT_SERVER_LEVEL } from "../plugins/serverAutonomy";

type Handler = (req: unknown, res: unknown, next: () => void) => void;
const USERS: Record<string, { userId: string; email: string }> = {
  "token-owner": { userId: "u-owner", email: "owner@example.test" },
  "token-other": { userId: "u-other", email: "other@example.test" },
};
const PASSWORD = "correct horse";

function harness(root: string) {
  const store = createServerAutonomyStore(path.join(root, ".lelu-runtime", "autonomy.json"));
  const handlers: Record<string, Handler> = {};
  createEngineerApi(createNodeEngineerAdapter("test"), {
    autonomy: store,
    verifyIdentity: async (req: { headers?: Record<string, string | string[] | undefined> }) => {
      const token = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "");
      const user = USERS[token];
      return user
        ? { ok: true, status: 200, identity: { userId: user.userId, email: user.email }, reason: "verified" }
        : { ok: false, status: 401, reason: "No Supabase access token was presented." };
    },
    reverifyPassword: async (email: string | null, password: unknown) => email === USERS["token-owner"].email && password === PASSWORD,
  }).attach({ use: (route, handler) => { handlers[route] = handler as Handler; } });

  const call = (route: string, body: Record<string, unknown>, token?: string) =>
    new Promise<{ status: number; data: Record<string, unknown> }>((resolve) => {
      const res = {
        statusCode: 200,
        setHeader: () => undefined,
        end: (raw?: string) => resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : {} }),
      };
      const json = JSON.stringify(body);
      handlers[route]({
        method: "POST",
        url: "/",
        headers: { host: "localhost", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        on: (event: string, fn: (chunk?: unknown) => void) => {
          if (event === "data") fn(json);
          if (event === "end") fn();
        },
      }, res, () => resolve({ status: 404, data: {} }));
    });
  const autonomy = (body: Record<string, unknown>, token?: string) => call("/api/engineer/autonomy", body, token);
  const workspace = (body: Record<string, unknown>, token?: string) => call("/api/engineer/workspace", body, token);
  return { store, autonomy, workspace };
}

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-autonomy-"));
  const cwd = process.cwd();
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "edge.ts"), "export const EDGE = 48;\n");
    process.chdir(root);
    await run(root);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}

test("no identity, no level: unauthorized callers are refused for read, change and apply", async () => {
  await withProject(async (root) => {
    const h = harness(root);
    assert.equal((await h.autonomy({ action: "get" })).status, 401);
    assert.equal((await h.autonomy({ action: "set", level: 5, confirm: true, password: PASSWORD })).status, 401);
    assert.equal((await h.workspace({ action: "request-apply", workspace: "ws" })).status, 401);
  });
});

test("changing autonomy: confirm is required, raising needs the re-verified password, lowering does not", async () => {
  await withProject(async (root) => {
    const h = harness(root);
    const start = await h.autonomy({ action: "get" }, "token-owner");
    assert.equal(start.data.level, DEFAULT_SERVER_LEVEL);
    assert.equal(start.data.source, "server");

    assert.equal((await h.autonomy({ action: "set", level: 5 }, "token-owner")).status, 400, "missing confirm");
    const noPassword = await h.autonomy({ action: "set", level: 5, confirm: true }, "token-owner");
    assert.equal(noPassword.status, 403);
    assert.match(String(noPassword.data.error), /requires re-entering your password/);
    assert.equal((await h.autonomy({ action: "set", level: 5, confirm: true, password: "guess" }, "token-owner")).status, 403, "wrong password");
    // Another account cannot vouch with the owner's password.
    assert.equal((await h.autonomy({ action: "set", level: 5, confirm: true, password: PASSWORD }, "token-other")).status, 403);

    const raised = await h.autonomy({ action: "set", level: 5, confirm: true, password: PASSWORD }, "token-owner");
    assert.equal(raised.status, 200);
    assert.equal(raised.data.level, 5);
    const lowered = await h.autonomy({ action: "set", level: 2, confirm: true }, "token-owner");
    assert.equal(lowered.status, 200, "lowering needs no password");
    assert.equal((await h.autonomy({ action: "set", level: 9, confirm: true, password: PASSWORD }, "token-owner")).status, 400, "out of range");

    const audit = h.store.audit("u-owner").map((entry) => `${entry.from}->${entry.to}`);
    assert.deepEqual(audit, ["3->5", "5->2"], "every change is audited; refused attempts change nothing");
  });
});

test("the level survives a reload and is the same on another device (one server store)", async () => {
  await withProject(async (root) => {
    const first = harness(root);
    await first.autonomy({ action: "set", level: 4, confirm: true, password: PASSWORD }, "token-owner");
    // A fresh process / another device: a new API over the same server store.
    const second = harness(root);
    assert.equal((await second.autonomy({ action: "get" }, "token-owner")).data.level, 4);
    assert.equal((await second.autonomy({ action: "get" }, "token-other")).data.level, DEFAULT_SERVER_LEVEL, "levels are per user");
    assert.ok(!readFileSync(path.join(root, ".lelu-runtime", "autonomy.json"), "utf8").includes(PASSWORD), "the password is never stored");
  });
});

test("concurrent changes are serialised: the final level and the audit are consistent", async () => {
  await withProject(async (root) => {
    const h = harness(root);
    await h.autonomy({ action: "set", level: 5, confirm: true, password: PASSWORD }, "token-owner");
    // Four concurrent changes without a password: 4, 3, 1 are lowerings and
    // succeed; 2 arrives after 1 is stored, so it is a RAISE by then and is
    // refused. The raise/lower decision is made inside the serialised write,
    // so a stale "this is a lowering" view cannot slip a raise past it.
    const results = await Promise.all([4, 3, 1, 2].map((level) => h.autonomy({ action: "set", level, confirm: true }, "token-owner")));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 403]);
    const audit = h.store.audit("u-owner");
    for (let i = 1; i < audit.length; i += 1) assert.equal(audit[i].from, audit[i - 1].to, "each change starts from the previous one");
    assert.equal((await h.autonomy({ action: "get" }, "token-owner")).data.level, audit.at(-1)!.to);
  });
});

test("changing the real project: the SERVER level gates request-apply and apply, re-checked at execution", async () => {
  await withProject(async (root) => {
    const h = harness(root);
    await h.workspace({ action: "create", workspace: "ws" }, "token-owner");
    writeFileSync(path.join(root, ".lelu-sandbox", "ws", "src", "edge.ts"), "export const EDGE = 40;\n");

    // Default L3: refused, whatever the page believes its level is.
    const low = await h.workspace({ action: "request-apply", workspace: "ws" }, "token-owner");
    assert.equal(low.status, 403);
    assert.equal(low.data.blocked, "autonomy");

    // L4 ("Project autonomy") is not enough: changing the real project is L5 ("Production"),
    // the one threshold the page and the server share (src/core/cognition/AutonomyPolicy.ts).
    await h.autonomy({ action: "set", level: 4, confirm: true, password: PASSWORD }, "token-owner");
    const atFour = await h.workspace({ action: "request-apply", workspace: "ws" }, "token-owner");
    assert.equal(atFour.status, 403, "L4 cannot change the real project");
    assert.equal(atFour.data.blocked, "autonomy");

    await h.autonomy({ action: "set", level: 5, confirm: true, password: PASSWORD }, "token-owner");
    const granted = await h.workspace({ action: "request-apply", workspace: "ws" }, "token-owner");
    assert.equal(granted.status, 200);
    const grant = String(granted.data.grant);
    assert.match(grant, /^grant_[A-Za-z0-9_-]{32}$/, "the grant is a CSPRNG token");

    // Missing confirmation.
    assert.equal((await h.workspace({ action: "apply", workspace: "ws", grant }, "token-owner")).status, 403);
    // A grant cannot be redeemed by another identity.
    const regrant = String((await h.workspace({ action: "request-apply", workspace: "ws" }, "token-owner")).data.grant);
    assert.equal((await h.workspace({ action: "apply", workspace: "ws", grant: regrant, confirm: true }, "token-other")).status, 403);

    // Lowering the level between request-apply and apply revokes it.
    const pending = String((await h.workspace({ action: "request-apply", workspace: "ws" }, "token-owner")).data.grant);
    await h.autonomy({ action: "set", level: 3, confirm: true }, "token-owner");
    const revoked = await h.workspace({ action: "apply", workspace: "ws", grant: pending, confirm: true }, "token-owner");
    assert.equal(revoked.status, 403);
    assert.equal(revoked.data.blocked, "autonomy");
    assert.equal(readFileSync(path.join(root, "src", "edge.ts"), "utf8"), "export const EDGE = 48;\n", "nothing was written");

    // Authorized: applied once; the same grant cannot be replayed.
    await h.autonomy({ action: "set", level: 5, confirm: true, password: PASSWORD }, "token-owner");
    const fresh = String((await h.workspace({ action: "request-apply", workspace: "ws" }, "token-owner")).data.grant);
    const applied = await h.workspace({ action: "apply", workspace: "ws", grant: fresh, confirm: true }, "token-owner");
    assert.equal(applied.status, 200);
    assert.equal(readFileSync(path.join(root, "src", "edge.ts"), "utf8"), "export const EDGE = 40;\n");
    assert.equal((await h.workspace({ action: "apply", workspace: "ws", grant: fresh, confirm: true }, "token-owner")).status, 403, "a consumed grant cannot be reused");

    // Destructive restore also needs identity, and restores the original.
    assert.equal((await h.workspace({ action: "rollback-apply", workspace: "ws" })).status, 401);
    assert.equal((await h.workspace({ action: "rollback-apply", workspace: "ws" }, "token-owner")).status, 200);
    assert.equal(readFileSync(path.join(root, "src", "edge.ts"), "utf8"), "export const EDGE = 48;\n");
  });
});

test("an expired grant is refused", async () => {
  await withProject(async (root) => {
    const h = harness(root);
    await h.workspace({ action: "create", workspace: "ws" }, "token-owner");
    writeFileSync(path.join(root, ".lelu-sandbox", "ws", "src", "edge.ts"), "export const EDGE = 40;\n");
    await h.autonomy({ action: "set", level: 5, confirm: true, password: PASSWORD }, "token-owner");
    const grant = String((await h.workspace({ action: "request-apply", workspace: "ws" }, "token-owner")).data.grant);
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000; // past the 10-minute grant lifetime
    try {
      assert.equal((await h.workspace({ action: "apply", workspace: "ws", grant, confirm: true }, "token-owner")).status, 403);
    } finally {
      Date.now = realNow;
    }
    assert.equal(readFileSync(path.join(root, "src", "edge.ts"), "utf8"), "export const EDGE = 48;\n");
  });
});

test("one apply threshold: the server reports the level the page enforces", async () => {
  const { SERVER_APPLY_LEVEL } = await import("../plugins/serverAutonomy");
  const { REAL_PROJECT_APPLY_LEVEL } = await import("../src/core/cognition/AutonomyPolicy");
  const { AUTONOMY_LEVELS } = await import("../src/core/cognition/AutonomyGate");
  assert.equal(SERVER_APPLY_LEVEL, REAL_PROJECT_APPLY_LEVEL);
  assert.equal(AUTONOMY_LEVELS.find((l) => l.level === SERVER_APPLY_LEVEL)?.label, "Production");
  await withProject(async (root) => {
    const h = harness(root);
    assert.equal((await h.autonomy({ action: "get" }, "token-owner")).data.applyLevel, REAL_PROJECT_APPLY_LEVEL, "the page reads the threshold from the server");
  });
  const loop = readFileSync("src/core/selfdev/SelfDevelopmentLoop.ts", "utf8");
  assert.doesNotMatch(loop, /gate\.can\(5\)/, "no hard-coded threshold of its own in the page");
  assert.match(loop, /serverState\(\)\?\.applyLevel \?\? REAL_PROJECT_APPLY_LEVEL/);
});
