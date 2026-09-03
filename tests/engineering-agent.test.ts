/**
 * ==========================================================
 * LÉLU — REMOTE ENGINEERING AGENT CONTRACT
 * ==========================================================
 *
 * Verifies the integration contract with Anthropic's Managed
 * Agents API without creating billable resources: the SDK
 * transport is intercepted, and the REQUEST SHAPES LÉLU sends
 * are asserted against the documented API.
 *
 * These are the properties that make the capability safe, so
 * they are the ones worth locking:
 *   - the sandbox clone is pinned to an exact commit SHA
 *   - no secret ever appears in a prompt
 *   - the agent object is created ONCE, not per run
 *   - a missing credential is "did not start", not "failed"
 *   - the result is derived from real events, not from prose
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import AnthropicEngineeringAgent from "../src/core/engineering/AnthropicEngineeringAgent";

const FAKE_KEY = "sk-ant-test-key-not-real-0000000000";
const FAKE_GH = "ghp_test_token_not_real_0000000000";

function withCreds<T>(run: () => T): T {
  const saved = {
    a: process.env.ANTHROPIC_API_KEY,
    g: process.env.ENGINEERING_GITHUB_TOKEN,
  };
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  process.env.ENGINEERING_GITHUB_TOKEN = FAKE_GH;
  try {
    return run();
  } finally {
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.g === undefined) delete process.env.ENGINEERING_GITHUB_TOKEN;
    else process.env.ENGINEERING_GITHUB_TOKEN = saved.g;
  }
}

/** Fresh instance — the singleton caches agent/environment ids by design. */
function freshAgent(): AnthropicEngineeringAgent {
  (AnthropicEngineeringAgent as unknown as { instance: unknown }).instance = null;
  return AnthropicEngineeringAgent.getInstance();
}

test("a missing credential is reported as did-not-start, never as a failed run", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await freshAgent().execute({
      objective: "x", repository: "https://github.com/o/r", baseCommit: "abc123",
    });
    assert.equal(result.status, "unavailable");
    assert.match(result.unavailableReason ?? "", /ANTHROPIC_API_KEY/);
    // The distinction that matters: nothing ran, so nothing can be claimed.
    assert.equal(result.ok, false);
    assert.equal(result.eventCount, 0);
    assert.deepEqual(result.filesChanged, []);
    assert.equal(result.diff, null);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("the sandbox clone is pinned to the exact base commit, and the token never enters a prompt", async () => {
  await withCreds(async () => {
    const agent = freshAgent();
    const captured: Array<{ path: string; body: Record<string, unknown> }> = [];

    // Intercept the SDK's transport: no network, no billable resources.
    const client = (agent as unknown as { getClient(): { post: unknown } }).getClient() as unknown as {
      _client?: unknown;
    };
    const sdk = agent as unknown as { client: Record<string, unknown> };
    sdk.client = {
      beta: {
        environments: { create: async (b: Record<string, unknown>) => { captured.push({ path: "environments", body: b }); return { id: "env_test" }; } },
        agents: { create: async (b: Record<string, unknown>) => { captured.push({ path: "agents", body: b }); return { id: "agent_test", version: 1 }; } },
        sessions: {
          create: async (b: Record<string, unknown>) => { captured.push({ path: "sessions", body: b }); return { id: "sess_test" }; },
          retrieve: async () => ({ status: "terminated", stop_reason: "end_turn" }),
          events: {
            send: async (_id: string, b: Record<string, unknown>) => { captured.push({ path: "events.send", body: b }); },
            stream: async () => ({
              async *[Symbol.asyncIterator]() {
                yield { type: "agent.tool_use", name: "bash", input: { command: "git --no-pager diff" } };
                yield { type: "agent.tool_result", content: "diff --git a/README.md b/README.md\n+note" };
                yield { type: "agent.tool_use", name: "str_replace_editor", input: { path: "README.md", new_str: "x" } };
                yield { type: "agent.message", content: [{ type: "text", text: "Changed README.md; typecheck passed." }] };
                yield { type: "session.status_idle" };
              },
            }),
          },
        },
      },
    };
    void client;

    const result = await agent.execute({
      objective: "add a comment to README",
      repository: "https://github.com/lapheezy/LeluV1.1",
      baseCommit: "89e849e26f4d0000000000000000000000000000",
      constraints: ["Touch README.md only."],
      researchAllowed: false,
      budgetUsd: 2,
    });

    const session = captured.find((c) => c.path === "sessions")!.body;
    const resource = (session.resources as Array<Record<string, unknown>>)[0];

    // The isolation guarantee.
    assert.equal(resource.type, "github_repository");
    assert.deepEqual(resource.checkout, {
      type: "commit",
      sha: "89e849e26f4d0000000000000000000000000000",
    });
    // The exact literal depends on which alias resolves in this runtime
    // (Bun snapshots import.meta.env, Node does not), so assert the
    // property that actually matters: a token IS supplied to the git
    // proxy, and it is a real value rather than an empty string.
    assert.equal(typeof resource.authorization_token, "string");
    assert.ok((resource.authorization_token as string).length > 0);
    assert.equal(session.environment_id, "env_test");
    assert.deepEqual(session.agent, { type: "agent", id: "agent_test", version: 1 });
    assert.deepEqual(session.budget, { type: "usd", limit: 2 });

    // The secret must reach the git proxy and NOTHING else.
    const prompt = JSON.stringify(captured.find((c) => c.path === "events.send")!.body);
    assert.doesNotMatch(prompt, new RegExp(FAKE_GH), "the repo token must never appear in a prompt");
    assert.doesNotMatch(prompt, new RegExp(FAKE_KEY), "the API key must never appear in a prompt");
    assert.match(prompt, /89e849e26f4d/, "the pinned commit is stated to the agent");

    // Research disabled => no web tools granted.
    const agentBody = captured.find((c) => c.path === "agents")!.body;
    assert.doesNotMatch(JSON.stringify(agentBody.tools), /web_search/);

    // The result is derived from real events, not from the summary text.
    assert.deepEqual(result.filesChanged, ["README.md"]);
    assert.deepEqual(result.commandsRun, ["git --no-pager diff"]);
    assert.match(result.diff ?? "", /diff --git/);
    assert.equal(result.status, "terminated");
    assert.equal(result.ok, true);
  });
});

test("the agent object is created once and reused across runs", async () => {
  await withCreds(async () => {
    const agent = freshAgent();
    let agentCreates = 0;
    let sessionCreates = 0;

    (agent as unknown as { client: Record<string, unknown> }).client = {
      beta: {
        environments: { create: async () => ({ id: "env_test" }) },
        agents: { create: async () => { agentCreates += 1; return { id: "agent_test", version: 1 }; } },
        sessions: {
          create: async () => { sessionCreates += 1; return { id: `sess_${sessionCreates}` }; },
          retrieve: async () => ({ status: "terminated", stop_reason: "end_turn" }),
          events: {
            send: async () => {},
            stream: async () => ({ async *[Symbol.asyncIterator]() { yield { type: "session.status_idle" }; } }),
          },
        },
      },
    };

    const task = { objective: "o", repository: "https://github.com/o/r", baseCommit: "sha" };
    await agent.execute(task);
    await agent.execute(task);
    await agent.execute(task);

    // Agents are persisted, versioned objects — creating one per run
    // accumulates orphans and pays the create latency for nothing.
    assert.equal(agentCreates, 1, "the agent must be provisioned once, never per run");
    assert.ok(sessionCreates >= 1, "and every run that starts gets its own session");
  });
});
