# LÉLU V1.1 — Pre-voice coding and sandbox verification

Branch `claude/open-session-rbwmdw`. Every result below came from a run, not from reading code.
- **Dev server:** the Vite dev server on this container, serving LÉLU's real `/api/engineer` and `/api/github` runtime.
- **Browser:** Chromium driving the real app, through `ToolDispatcher.dispatchToolCall` (what a model tool call runs) and `ToolRegistry.execute`.
- **GitHub:** the real GitHub API.

Harnesses:
- `scripts/verify-github-bridge.ts` (new, `npm run verify:github-bridge`)
- `tests/engineering-chain.test.ts` (new)
- the end-to-end browser run (40 checks)
- real chat turns

## 1. Project identity

| | |
|---|---|
| Repository | `lapheezy/LeluV1.1` (public), default branch `main` @ `44bdd93` |
| My (Claude Code) GitHub identity | `pheruel` — permissions push/pull/triage, no admin |
| **LÉLU's own** GitHub identity (her bridge, as GitHub reports it) | `lapheezy` — admin/maintain/push/triage/pull |
| Working branch / HEAD before this pass | `claude/open-session-rbwmdw` @ `ebe9f7b` |
| Branches | `main`, `claude/open-session-rbwmdw`, `claude/lelu-continuous-cognition-92p3jy`, `claude/lelu-cognitive-audit-unify-ptqyoq`, `claude/env-probe-2`, `claude/env-probe-lelu2` — plus the verification branches listed in §6 |
| Confirmed LÉLU V1.1 | yes — `package.json` name `lelu`. LÉLU read `src/core/ui/Layers.ts` through both the workspace copy and GitHub. |

## 2. The real execution chains

```
CHAT → GitHub
GenesisChat.send → Orchestrator.process → AIService → AIRouter.route
  → (keyword resolvers: time, brain, surfaces, tools, engineering [read-only observe],
     creative [now stands aside for engineering/named-tool turns], projects …)
  → ProviderResolver tool loop (≤40 rounds) → toolSchemasForModel()  [registry ∩ executors ∩ AutonomyGate]
  → ToolDispatcher.dispatchToolCall → executor
      github.*  → GitHubIntegration.call/putFile → POST /api/github/proxy (plugins/githubApi.ts)
                  → [writes: verifyRequestIdentity (Supabase) + LELU_ALLOW_PUSH=1 + never the default branch]
                  → api.github.com (server-side token)
  → tool_result on AgentEventBus → back into the same chat turn

LÉLU → workspace / validation
  project.* → EngineeringWorkspace → POST /api/engineer/{workspace,read,write,list,delete,command,git}
            → plugins/engineerApi.ts → nodeAdapters (real copy in .lelu-sandbox/<id>, node_modules symlinked)
            → command whitelist: typecheck = bun tsc -b --noEmit · test = npm test · build = bun run build
            → apply/commit: server identity (Supabase) + single-use grant + confirm

LÉLU → sandbox
  sandbox.read/write → SandboxFS (browser, KvStore-persisted, 512 KB)
  sandbox.execute    → SandboxRuntime.execute → new Worker(sandbox.worker.ts) per job
                     → boot timer (30 s) → "started" → execution timer (default 8 s, ≤30 s) → terminate()
```

ToolRegistry.execute() now delegates to the same executors, so there is one dispatch authority.
- Its own small table remains only for `cosmos.openInterface` and `selfdev.analyze`, which have no executor.
- The sandbox and the project workspace are different systems for different jobs, not competitors:
  - in-browser JS scratch execution;
  - a server-side copy of the real repository.
- `AnthropicEngineeringAgent` is a third backend. It is unavailable here: no key.

## 3. Root causes found and fixed

| # | Defect (measured) | Fix (existing implementation) |
|---|---|---|
| 1 | `sandbox.execute` and all six `github.*` tools were **registered and marked available but had no executor**, so no model tool call could reach them. ToolRegistry.execute was a second, 5-entry table. | Executors in `ToolDispatcher` call the existing `SandboxRuntime` and `GitHubIntegration`. `ToolRegistry.execute` delegates to them. |
| 2 | A registered-but-unwired tool was reported as "There is no tool named …". | Now: "registered but has no executor — there is no real dispatch for it". |
| 3 | **The GitHub proxy forwarded any write with the server's token and no identity check.** Proven by accident: an identity-less request created branch `should-not-exist` (see §6). | Proxy writes now need a verified Supabase identity, `LELU_ALLOW_PUSH=1` (the same switch as `git push`), and a target that is not the default branch. Writes are checked on the server and before the request leaves the client. |
| 4 | The proxy's global rate limit returned 429 to LÉLU's own back-to-back calls (read the branch head, then create the branch). | Requests are queued 500 ms apart instead of refused. |
| 5 | `GitHubIntegration` returned a bare `null` on every failure. | It returns the real reason: the proxy's refusal, GitHub's status and message, or the network error. Added `putFile`, which makes one commit through the contents API. |
| 6 | `sandbox.write` **trimmed** its content (a read-back did not match). | The content is stored exactly as given; missing content is refused. |
| 7 | The sandbox timeout clock started at worker creation, so a slow worker start was reported as "Timed out — execution was terminated" for code that never ran. | The worker posts `started`; the execution timer starts then. A boot failure is reported as "did not start; nothing was executed". |
| 8 | Validation ran **`bun test`**. On the unmodified project that gives 913 pass / 20 fail; the project's own `npm test` gives 953/953. That is pre-existing infrastructure, not a regression. | `test` = `npm test`, with a 15-min allowance (it takes about 6.5 min here). The real exit code is kept, and a timeout kills the whole process group, not just the shell. |
| 9 | In chat, the keyword creative resolver **generated a 4-file app skeleton** on "…tell me the exit code" ("code"). The prompt rule "risk ≥2 → ask before using" made LÉLU ask "may I?" three times instead of running what she was asked to run. | The creative scaffold stands aside when the model can do real engineering work or the user names one of her tools. An explicit request for exactly that action counts as the confirmation. |

## 4. Capability matrix

🟢 verified end to end · 🟡 partial · 🔴 not working

| Capability | Implemented | Wired to LÉLU | Actually tested | Result |
|---|---|---|---|---|
| GitHub authentication | `GitHubIntegration.getStatus` | `github.auth` (+ chat) | dispatch + chat turn | 🟢 connected as `lapheezy` |
| Repository discovery | `github.repos` | yes | dispatch | 🟢 default branch, permissions, last push |
| Read repository / file | `github.files` | yes | dispatch, at `main` and at another branch; real chat turn | 🟢 chat answered `"lelu"` from the real `package.json` |
| Create branch / workspace | `github.branches create` / `project.copy` | yes | workspace: dispatch (881 files). Branch: real GitHub, stand-in identity | 🟢 workspace · 🟡 branch (authorized path needs a real sign-in) |
| Modify file | `project.write` / `sandbox.write` | yes | dispatch; read-back exact | 🟢 |
| Diff | `project.diff` | yes | dispatch | 🟢 exactly `+marker`, `+` (1 file) |
| Validate | `project.validate` | yes | typecheck 0 · `npm test` 0 (303 s) · build 0 in the copy; a type error → exit 2, ok:false | 🟢 |
| Apply to real project | `project.apply` | yes | refused without identity; real file untouched | 🟡 refusal verified; authorized apply not exercised (no Supabase sign-in on this runtime) |
| Commit | `github.commits commit` / `project.commit` | yes | GitHub: real commit `a2d1089`, read back byte-equal, confirmed by an independent GitHub API read. Local `project.commit`: refusal only | 🟡 works with authorization; unauthorized refused |
| Pull request | `github.prs` | yes | list + unauthorized create refused | 🟡 create not exercised (would open a real PR) |
| Sandbox execute | `sandbox.execute` | yes (+ chat) | hello → `LELU_SANDBOX_EXECUTION_OK` exit 0; SyntaxError exit 1; throw exit 1; infinite loop → exit 124 at 3.0 s; next run OK; 5/5 workers terminated | 🟢 |

## 5. Failure honesty and chat safety (all measured)

**Refused or failed correctly** (each returns ok:false with the real reason):
- unknown tool;
- registered-but-unwired tool;
- invalid code;
- runtime throw;
- timeout;
- GitHub unreachable ("Could not reach the GitHub proxy");
- missing file (GitHub's own 404);
- type error in a change (validation FAILED, exit 2);
- unauthorized apply, commit, branch and commit to GitHub (client refusal);
- unauthorized bridge write (server refusal);
- commit to the default branch (refused by both client and server);
- publishing disabled (`LELU_ALLOW_PUSH`).

**Real chat turns, phone viewport:** each result came back into the same conversation, with no new chat and no switch.
- **`hello.js`:** LÉLU called `sandbox.execute` and reported stdout and exit 0.
- **`bad.js`:** reported as FAILED with the SyntaxError.
- **`loop.js`:** reported as timed out at 2 s with exit 124.
- **`github.files`:** read the real file correctly.
- **Unauthorized `github.branches create`:** she reported "not created" and quoted the refusal.

During a sandbox infinite loop the chat kept 60 fps, timer lag stayed under 15 ms, and typing took 452 ms. Six sequential tool calls all completed. No page errors; tool loop bounded at 40 rounds.

## 6. Things to know

- **Extra branches on GitHub:**
  - `should-not-exist` (at `44bdd93`): created by my identity-less probe against the old proxy. That is the evidence for defect 3.
  - `lelu-verify/mvqyjv7l` (commit `ed6ecb8`): first bridge run; its diff check was mis-designed.
  - `lelu-verify/mvqyldvo` (commit `a2d1089`): the verified run.

  None touch `main`. My attempt to delete `should-not-exist` was blocked by this session's permissions, so delete them if you don't want them.
- **The identity stand-in.** The authorized GitHub write was verified with a local stand-in for "who is asking". Your Supabase sign-in cannot be produced from here: this runtime has no `VITE_SUPABASE_URL`, and `/api/engineer/status` reports `identityVerification: false`. Everything else in that run was real: the executors, the bridge, the proxy and its checks, and GitHub.
- **Other runtimes:**
  - The Deno adapter's command runner was not changed or exercised.
  - On a static deployment with no engineering runtime, the `project.*` tools are honestly unavailable.
- Headless desktop rendering is 2 fps (software WebGL), which starves the main thread. The sandbox and chat-safety numbers above are from the phone viewport, where chat owns the screen and Cosmos is not rendered.
- Not changed: `Orchestrator.persistCheckpointFromRequest` find-or-creates one "Engineering"/"General"/"Planning" project per category, the first time each category is used.

## 7. Validation

- `tsc -b --force`: clean.
- `npm test`: 963/963, including `tests/engineering-chain.test.ts`.
- `npm run build`: OK.
- `oxlint`: exit 0.
- End-to-end browser run: 40/40.
- `verify:github-bridge`: 20/20.
