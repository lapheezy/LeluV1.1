# LÉLU V1.1 — Handoff progress: security, PRs #6/#7, SHAMAN

Branch `claude/open-session-rbwmdw`. Every result below came from a run in this container. Nothing was merged into `main` and nothing was deployed.

The next session should read this first.

## 1. Starting point (verified)

| Item | Finding |
|---|---|
| `524b485`, `e68cce3` | Present: HEAD was `e68cce3`, after a fast-forward from origin. No local changes were lost. |
| PR #6 (`claude/evolution-no-tests-in-bundle` → this branch) | Open. Merged here locally in `d3645c7`. |
| PR #7 (`claude/evolution-delegation` → #6's branch) | Open. Merged here locally in `d3645c7`. |
| SHAMAN commit `3a2d210` | **Does not exist**, on GitHub ("No commit found") or locally. |
| Patches `0002`–`0004`, `/mnt/session/outputs` | **Not present** in this container. 0002 (lockfile) and 0003 (delegation tagging) were redone from the code. 0004 (untested SHAMAN WIP) was rebuilt from scratch, with tests. |

## 2. Credential exposure

### What was exposed, and how

| Path | Exposure | Fixed in |
|---|---|---|
| **Meshy** (paid image-to-3D) | Read in the browser as `VITE_MESHY_API_KEY` and sent from the browser. Any build made with it set shipped a spendable key; the canary scan reported it shipped. | `e61b6d9`: Meshy now goes through `/api/knowledge/relay`. The server adds `Authorization: Bearer`. POST is relayed only for Meshy, refused cross-origin, and capped at 20 MB. |
| **Runtime key bridge** (`plugins/runtimeKeyBridge.ts`) | Wrote `NEWS_API_KEY`/`NEWSAPI_KEY`, `YOUTUBE_API_KEY` and `MESHY_API_KEY` into the served HTML as `window.__LELU_*__`. That happens at `vite build` too, so into `dist/index.html`. These are the names the relay reads on the server to keep the keys off the page. The canary build could not see it, because the bridge skips a key whose `VITE_` name is set. | `e61b6d9`: entries removed. Both the scan and the unit test now check the bridge directly. |
| **`android-apk.yml`** | Passed Groq, OpenRouter, Cerebras, Mistral, Fireworks, GitHub token, Anthropic (×2), NewsAPI and YouTube keys into the APK build. | `e61b6d9`: the workflow now passes model names and `VITE_AI_PROXY_BASE_URL` only. |
| Source maps | None emitted (`build.sourcemap` unset; 0 `.map` files in `dist/`). `dist/` is git-ignored and untracked. | — |

### Past exposure and rotation

- **APKs.** All 22 historical APK artifacts from the Android workflow were scanned, by pattern only: no values were printed. No key-shaped values were found. The workflow has failed at the Android SDK step since Sep 16, and it only runs on `main`.
- **GitHub Pages.** Never enabled (the deploy fails with 404), so no web bundle was published from CI.
- **What I cannot see.** Builds made elsewhere: Freebuff, local machines, any manual deploy. If any of them was built with `VITE_MESHY_API_KEY`, or served `MESHY_API_KEY`, `NEWS_API_KEY` or `YOUTUBE_API_KEY` through the dev server or the old bridge, that key was readable on the page.
- **Rotation is recommended, as a precaution, for:**
  - **Meshy**: paid, and was browser-side by design;
  - **NewsAPI and YouTube**: published by the bridge whenever set under the unprefixed name.

  The model keys (Groq, OpenRouter and the others) were already brokered. The only evidence of their exposure was the workflow passing them, and no APK contained them.
- **No credential has been rotated.** That requires the provider dashboards, which this session cannot reach.

### Still browser-side, by design (reported on every scan run)

`VITE_FIRMS_API_KEY`, `VITE_GUARDIAN_API_KEY`, `VITE_GNEWS_API_KEY` and `VITE_NEWSDATA_API_KEY`. All are free-tier keys for browser-only features. Moving them is the same relay treatment Meshy got.

### Guards added

- `tests/credential-exposure.test.ts`, in `npm test`. Six tests, all of which fail on the code before `e61b6d9`. They check:
  - workflows hand no credential to a build;
  - the key bridge publishes no relayed or brokered key;
  - the browser allowlist holds none;
  - the relay sends Meshy's key as a server Bearer header, drops a caller-supplied `key`, and refuses a cross-origin POST, a foreign path and POST for GET-only providers;
  - the provider report is booleans only.
- `scripts/verify-bundle-secrets.ts`:
  - asserts Meshy, Anthropic, Gemini, NASA and Geoapify are absent from a real canary build;
  - checks the key bridge;
  - reports NewsData.

### Known limitation

`knowledgeFetch` uses a relative URL (`/api/knowledge/relay`). It has done so since before this pass, for News and YouTube. In the APK (Capacitor origin) there is no same-origin server, so relayed providers, now including Meshy, are unavailable there. They report "not configured"; nothing leaks. Pointing the relay at `VITE_AI_PROXY_BASE_URL` would need the cross-origin rule to allow that app origin.

## 3. PRs #6 and #7, finished

- **Merged into this branch** (`d3645c7`):
  - test files are out of the production bundle; `verify:bundle` reports 1133 files, no test chunks;
  - CI runs `bun run test`;
  - delegation is durable: `running` becomes `interrupted` on load, `resume()` keeps the links, and tasks carry `delegatedBy`;
  - `delegations()` gives one ledger across agents.
- **Lockfile** (`b58abec`): `bun.lock` had no `mermaid` entry, though `package.json` depends on it, so `bun install --frozen-lockfile` exited 1 in every workflow. It was regenerated with `bun install`; the frozen install now exits 0.
- **Delegation tagging** (`52e43b4`):
  - the Agents panel passes `delegatedBy: "user"`;
  - AIService delegation and SelfStudy go through `Shaman.dispatch` with `delegatedBy: "lelu"`.
- **Recovery, ownership and history across a restart:** `tests/delegation-durability.test.ts` (7) and `tests/shaman-routing.test.ts` (12) drive `AgentStore.resetForTests()` over the same storage.
- **The GitHub PRs themselves are still open.** Their content is in this branch. Closing or merging them on GitHub is the owner's call.

## 4. SHAMAN (`52e43b4`)

```
LÉLU CORE ──► SHAMAN.dispatch(objective, {agentId?, delegatedBy})
                 │ route():     explicit assignment → description match →
                 │              wording (security first) → LÉLU's galaxy
                 │ canAssign(): user/lelu/forge anywhere; an executive or an
                 │              agent only within its own galaxy
                 ▼
             AgentRunner.run (the one runner) ── AgentTask {executive, routeReason, delegatedBy}
                 │                                  persisted in AgentStore (KvStore)
                 ▼
             Cosmos: agent drawn in its owner's galaxy; only that galaxy lights
```

- **Ownership:** `src/core/agents/ExecutiveOwnership.ts`, pure. The order is:
  1. `agent.executive`, an explicit assignment (`AgentStore.assignExecutive`);
  2. `agent.templateId`, set at creation and backfilled by name on load;
  3. a template name match;
  4. Agent Forge.

  Every template has an owner, and every owner is on the Executive Board (tested).
- **UUID vs. template-name bug.** The Cosmos did `AGENT_TO_EXECUTIVE[agent.id] ?? "sage"`, with UUIDs looked up in a table keyed by template id. Every agent landed in the default galaxy; the test reproduces the Builder in `exec-sage`. Fixed, and the table removed.
- **Unavailable agents.** `Shaman.resume()` hands interrupted or failed work to another agent of the same executive. The original keeps its history and points at the continuation (`resumedBy`), even on another agent. With nobody available, it refuses with the reason.
- **Routing failures** run nothing, return the reason, and emit `task_failed` on the bus.
- **Not built yet:**
  - no UI to reassign an agent's executive (`assignExecutive` exists);
  - no Cosmos view of `routeReason`;
  - `ExecutiveBoard.consult()` is still deterministic guidance text; it is not wired to `dispatch`.

## 5. Verification (this container)

| Check | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `npm test` / `bun run test` | **1003/1003** pass (981 before the PR merge and SHAMAN) |
| `npx oxlint` | exit 0 (warnings only, none in changed files) |
| `npm run build` | exit 0 |
| `npm run verify:bundle` | PASS: no test files in `dist/` (1133 files) |
| `bun run scripts/verify-bundle-secrets.ts` | ALL BUNDLE SECRET CHECKS PASSED |
| `bun install --frozen-lockfile` | exit 0 (was 1) |
| SHAMAN, delegation and credential tests | 12/12, 7/7 and 6/6 |

### `scripts/verify-*.ts`, run exactly as CI runs them (`bun run <file>`)

**18 of 32 pass.** All 14 failures fail the same way on the starting commit `e68cce3`, run in a separate worktree. I compared the failing checks line by line:
- 11 are identical;
- in three the only difference is the live model's wording;
- `verify-cognitive-trace` fails fewer checks on this branch (10) than on the base (12).

**None is a regression from this pass.**

| Class | Scripts | Why |
|---|---|---|
| Environment: needs the dev server | `verify-provider-credentials`, `verify-self-study` | "server not reachable at :5173"; `/api/engineer/read` is the live path |
| Environment: opt-in write | `verify-github-bridge` | Refuses without `LELU_VERIFY_GITHUB_WRITE=1`, because it writes to GitHub. Exit 2 broke CI's run-every-script loop; CI now skips it with a visible notice. |
| Environment: keys | `verify-provider-health` | Anthropic, Mistral, Gemini and GitHub Models keys are absent here |
| Environment: assumes a keyless machine | `verify-cognition`, `verify-offline-brain`, `verify-startup-diagnostic` | Assert "no provider available", but this container has 4 provider keys (OpenRouter, Groq, Cerebras, Fireworks) |
| Live model wording | `verify-cognitive-trace`, `verify-e2e-cognition`, `verify-engineering-chat` | Assertions on the text a real model returns |
| Pre-existing: stale expectation or defect | `verify-providers`, `verify-tool-execute`, `verify-tool-registry`, `verify-selfdev` | Present at `e68cce3`. **Three are now fixed; `verify-providers` is down to one check that needs an owner decision.** See §5a. |

Passing at the time of this table: attention-bounds, bundle-secrets, curiosity, development, endpoints, engineering-agent, init-race, media-browser, memory-recall, offline-identity, runtime-continuity, secrets, transform-command, ui-action-bus, ui-cognition-e2e, visual, voice, workspace.

### 5a. Follow-up: the four pre-existing failures

| Script | Root cause | Fix | Now |
|---|---|---|---|
| `verify-tool-execute` | **My own earlier regression** (`4315072`). `ToolRegistry.execute` now runs the real dispatcher, which requires `query` for `memory.recall`; the script still called it the old way (`{count: 20}`, expecting an array). | The script uses the real contract: a query in, matching text out. It also checks that an empty query is refused. | ALL PASS |
| `verify-tool-registry` | Stale expectation. Since `b64dc0c`, a workspace command is offered only if the autonomy gate allows it AND an engineering runtime is reachable. The script expected the gate alone to flip availability. | The script checks the real conjunction, and that the gate allows the command at L5. It also checks that with no runtime, `workspace.test` is **not** offered to cognition. | ALL PASS |
| `verify-selfdev` | **Work lost in merge `9492b78`.** `SelfDevelopmentLoop.develop()`'s goal pipeline (`LeluRuntime` goal and verified/failed outcomes per step) and its timeline events were dropped; the merge message says only `integrate()`'s events were ported. Also, `integrate()` became async (it runs the real SelfTestRunner) but the script did not `await` it. | Three-way merge of the lost side onto the current file. One conflict, resolved to the current version, which is a superset. Duplicate import and variables removed. The script now awaits `integrate()`. | ALL PASS (was 20 failing) |
| `verify-providers` | Since `d11dc20`, Anthropic is the default (priority 1), so Groq dropped to 2, **tying with OpenRouter**. Which one is tried first after Anthropic is now decided by registration order (OpenRouter first), not by the priority number. | Script updated for Anthropic-first. **The tie is not resolved:** it is a routing decision for the owner, and `AIProviderRegistry.ts` is Freebuff's file. | 65/66: strict-priority check still fails |

The other files that merge took wholesale from one side are the documented "server-owned transport wins" choice, plus the timeline label it deliberately replaced. No other lost work was found.

## 6. For the owner

1. **Key rotation.** No Meshy key exists: none is set and none was ever configured, so there is nothing to rotate. `NEWS_API_KEY` and `YOUTUBE_API_KEY` were set unprefixed in this environment, which the old bridge published. The owner reports having rotated them; this session cannot verify that. Keep them server-only, without `VITE_`.
2. **Delete the GitHub secrets** the APK workflow no longer reads: `VITE_*_API_KEY`, `VITE_GITHUB_TOKEN` and `ANTHROPIC_API_KEY`.
3. **Delete stray branches:** `should-not-exist`, `lelu-verify/mvqyjv7l` and `lelu-verify/mvqyldvo`. This session is not permitted to delete them.
4. **Decide what happens to PRs #6 and #7** on GitHub. Their content is in this branch.
