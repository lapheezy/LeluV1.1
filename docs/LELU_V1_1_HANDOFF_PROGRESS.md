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
| `verify-providers` | Since `d11dc20`, Anthropic is the default (priority 1), so Groq dropped to 2, **tying with OpenRouter**. Which one is tried first after Anthropic is now decided by registration order (OpenRouter first), not by the priority number. | **Owner chose OpenRouter first**, which is the order already in effect. Groq's priority is now 2.5 (`GroqProvider.ts`): explicit, no change in behaviour, no other provider renumbered. `verify-providers` and `verify-provider-health` now assert Anthropic → OpenRouter → Groq. | 66/66 |

The other files that merge took wholesale from one side are the documented "server-owned transport wins" choice, plus the timeline label it deliberately replaced. No other lost work was found.

## 6. For the owner

1. **Key rotation.** No Meshy key exists: none is set and none was ever configured, so there is nothing to rotate. `NEWS_API_KEY` and `YOUTUBE_API_KEY` were set unprefixed in this environment, which the old bridge published. The owner reports having rotated them; this session cannot verify that. Keep them server-only, without `VITE_`.
2. **Delete the GitHub secrets** the APK workflow no longer reads: `VITE_*_API_KEY`, `VITE_GITHUB_TOKEN` and `ANTHROPIC_API_KEY`.
3. **Delete stray branches:** `should-not-exist`, `lelu-verify/mvqyjv7l` and `lelu-verify/mvqyldvo`. This session is not permitted to delete them.
4. **Decide what happens to PRs #6 and #7** on GitHub. Their content is in this branch.

---

# Pass 2 — companion, voice, SHAMAN in chat, eyes for her own UI

## 7. Companion mode (the owner's request)

The owner asked for the avatar as a pop-up human figure, in the look they chose, that floats anywhere over the app without stopping anything from working, and that can be turned on and off. It is not a browser or a window.

- **Mounted once:** `src/app/scene/genesis/avatar/LeluCompanion.tsx`, at app level in `GenesisScene`. Moving between surfaces never recreates her.
- **State:** `src/core/avatar/CompanionStore.ts`, persisted. It holds on/off, size, pinned/unpinned and position. The pure placement rule is `chooseSpot`.
- **Look:** the image saved in the Avatar panel (`AvatarStore.referenceImage`), or the default portrait. A photo cannot lip-sync, so she speaks with her whole presence; true visemes need a rigged model.
- **Touch:**
  - only her figure takes touches; the overlay is `pointer-events: none`, and so is her caption;
  - drag pins her where she is put;
  - unpinned, she moves off any visible control, with the field being typed in weighted 12×. She only moves when she covers something.
- **Motion from real state:**
  - activity comes from `avatar/leluActivity.ts`, the one reading shared with the Gen V2 presence;
  - her speech beat comes from `VoiceEngine.onSpeechActivity` (real utterance start, word boundary and end).
- **Switches:**
  - the Avatar panel and phone menu (`CompanionToggle`);
  - LÉLU herself, through the `avatar.companion` tool;
  - Hide in her own controls.

  While she is on, avatar events no longer open the Avatar panel.
- **Verified in the live app** (`node scripts/verify-companion.mjs`, phone 390×844 and desktop 1280×800, 18 checks each), across runs:
  - she turns on from the real switch and stays fully on screen;
  - a point beside her reaches the app beneath;
  - with the composer focused she covers no control (phone and desktop) and typing works;
  - real bus events become her caption, and her activity follows them;
  - drag pins her, and the spot survives a reload;
  - double-tap opens chat;
  - her controls stay inside the screen, and Hide turns her off;
  - no page errors.
- **Honest caveat:** headless desktop renders the 3D scene at about 2 fps, and input is sometimes lost. The script re-delivers a gesture (up to 5 tries, reported) without changing any expectation. Across runs every check passed, but in individual runs a single gesture check sometimes failed after its retries. No real device was available.
- **Found by measuring, not fixed** (left for LÉLU's acceptance test): at phone width the Avatar panel keeps its two-column layout. Its right column (Appearance, Identity, Save, the text fields) is partly or fully off-screen.

## 8. Voice (`1f1eb47`)

`tests/voice-continuity.test.ts` drives the real VoiceEngine against fake browser speech engines. All 5 tests fail on the previous engine.

- **Streamed replies** (typed and spoken) set "speaking" and never cleared it. The phase now settles when the queue drains.
- **The echo check** compared the mic against "" for streamed speech; it now compares against what was said.
- **Barge-in:** two or more words from the user while she speaks, not her echo, cancel her speech.
- **Recognizer:** it now restarts in every phase while the session is active. It used to restart only if it ended while "listening".
- **Not verified on a real device:** live microphone and speakers. This container has none. Headless Chromium has `speechSynthesis` with 0 voices, so utterances end immediately and she is honestly not "speaking".

## 9. SHAMAN from chat (`6fe0a09`)

- `agent.delegate` was registered and marked available, but it had no executor, so a model could never call it.
- `agent.delegate`, `agent.status` and `agent.resume` now run through `Shaman.dispatch`/`resume` and the persisted ledger. The result text, the route and the routeReason come back into the conversation.
- **Tests:** `tests/shaman-routing.test.ts`, 14.

## 10. Eyes for her own UI (`6fe0a09`, `plugins/selfViewApi.ts`)

| Route / tool | What it does | Verified live here |
|---|---|---|
| `/api/browser/capture` · `browser.capture` | Headless Chromium screenshot plus a measured layout report (off-screen, partly off-screen and covered controls) of a public page, her own UI (phone/desktop, any panel) or a workspace preview. The screenshot goes to chat and the workspace as `creative_artifact`. | Own UI, phone, Avatar panel: 42 controls, 12 findings, 24 s |
| `/api/engineer/preview` · `project.preview` | Runs a workspace copy's own `vite` on 127.0.0.1:5310–5329; stopped after 20 min | Started in 2 s, captured, stopped |
| `/api/engineer/search` · `project.search` | Read-only bounded code search, no shell | Yes |

- **Safety:**
  - same-origin POST only, plus `LELU_ENGINEER_TOKEN` when it is set;
  - capture refuses private-network targets, except this app and its previews (tested: 6379, 169.254.169.254, 192.168.x, file: are all refused);
  - no headless browser installed means an honest 503.
- **Not mounted in the Deno runtime** (`main.ts`); it uses Node child processes. Vite dev and `server.ts` have it.
- **Tests:** `tests/self-view.test.ts` (5).

## 11. The acceptance test: LÉLU improving her own UI

### How it is run
- `node scripts/lelu-self-improve.mjs` opens the real app at phone size and types one request into her composer. The request names no bug, no file and no fix.
- It records her own event bus: every tool call, its result and every capture.
- It reads her replies from the conversation store.
- When her turn ends before the loop is complete, the recorder sends a neutral "Go ahead". It judges completion from what she *ran* (a validation, a capture of her preview and a diff), never from what she wrote.
- Evidence goes to `docs/evidence/self-improve/<stamp>/`.
- Claude Code does not pick the problem, write the fix or give the verdict. Every run is then checked independently, and the check is recorded beside her evidence.

### Runs, and what each one exposed
Most runs failed on infrastructure, not on her. Each defect was fixed in the tool or the router, never by doing her work for her.

| Run | Outcome | Defect found, and fix |
|---|---|---|
| 1 | Never reached her model | Keyword resolvers hijacked the turn: "capture" was read as the device camera, and "project" produced a toy scaffold. Vite reloaded the app when a sandbox copy was created. Engineering tools only became available 22 s after load. All fixed in `37586ba`: the router waits for tool availability, and the sandbox is ignored by the watcher. |
| 2–4 | Partial loops | Capture events opened the Browser module over the chat. The browser resolver read her request as an address. 60k-character file reads exhausted the providers. Fixed in `527f1f6`: a `namesTool` guard on the keyword resolvers, a windowed `project.read`, and a `project.edit` tool. |
| 5 | **She fabricated** validation, preview and diff results | The tools never ran. 23 of 24 edits were refused for whitespace. Fixed in `2ddf555`: `ClaimGrounding` appends "⚠️ Not verified" to any reply that claims a tool result no tool produced, and edits now tolerate indentation. |
| 6 | Full loop, wrong verdict ("achieved") | She compared a preview captured without the panel with an app captured with it. The capture tool now compares like with like (`compareCaptures`, `fab75c8`). An independent capture showed her z-index change did nothing. |
| 7 | Real iterative loop, honest "No" | 12 → 8 → 12 findings. She repaired her own typecheck failure. The request gained "keep going … until resolved or three approaches" (`a4cbcc4`). |
| 8 | Claimed 9 → 8, "Upload reference now visible" | **Not an improvement.** The same page measured 12 and then 9, because the panel was caught mid-transition, and below-the-fold controls counted as off-screen. The capture now waits for a settled layout, judges clipping against the panel's own edge and names sideways overflow (`d1dcdd9`). Settled re-measure: her fix moved the overflow to the left column, cutting off the Companion switch and Upload reference. See that run's `VERIFICATION.md`. |
| 9 | Full loop in one turn, no tool failures; claimed 13 → 0, "met" | **Not met.** She compared her app *with* the Avatar panel against her preview *without* it. Like for like, the preview measured 13 → 13: her panel-width change did nothing. A preview capture now names the conditions it says nothing about (`uncomparedConditions`). See that run's `VERIFICATION.md`. |
| 10 | Three approaches; honest "NOT met" | She misattributed the covered header buttons to the companion; the report named the Avatar panel's container. `project.write` let her save `project_read`'s display into a file, and replace a 1,089-line stylesheet with a placeholder comment (`allowShrink: true`). Such content is now refused (`unsavableContent`). |
| 11 | Three approaches, same-condition comparisons; honest "not met" | **My detector's false positive:** `sideways-overflow` flagged chat tabs with nothing hidden. It now requires a control that is actually cut off. The workspace diff reported her ~20-line change as +531/−523 (prefix/suffix trim, truncated). `plugins/lineDiff.ts` is a real line diff, now +16/−8. The write guard refused her display-text write. |
| 12 | No evidence: the dev server died mid-run | **Server defect:** the model broker's error path tried to send a JSON 502 after a stream's headers were out. `ERR_HTTP_HEADERS_SENT` was thrown inside the catch, the rejection was unhandled, and the dev server exited. Every later call failed, including her model calls and the recorder's diff read. The broker now ends such a response and never lets a request reject unhandled (test fails on the old code). The recorder writes its evidence even when the server is gone. |
| 13 | Same-condition comparisons, honest "not met"; the server survived | The covered header buttons were behind the expanded panel's **modal backdrop**: covered by design, and reported as a defect (as in run 10). The backdrop is now recognised and counted separately (`behindModal`). `ClaimGrounding` flagged her unrun `project_diff` live. Memory panel: 0 real findings. Avatar panel: 10, all genuine. |
| 14 | **First run with everything behaving:** a genuine problem, repeatable measurement, like-for-like comparisons, a real diff; honest "not met" | Her three CSS attempts never touched the cause, and the tool could not show it. Sideways overflow now reports where it begins (the first descendant that sticks out while its parent fits, the widest path down, sibling causes, and each element's sizing styles), like devtools, naming no fix. The recorder also matched an earlier go-ahead's end and fired the next too soon (run 13); fixed. |
| 15 | Real partial progress: 10 → 9, content 518 → 468 px | **She claimed "0 problems … met"**, numbers no capture measured, and said the live app was fixed when it was never touched. Replies are now checked against the latest measured counts for the conditions they name, and carry "⚠️ Contradicted by measurement" (`contradictedCaptureClaims`). |
| 16 | Honest "not met" (10 → 10) | The overflow chain followed the furthest-right path, which in a column layout can be a merely *stretched* element. It now shows each element's minimum width ("needs at least N px") and follows the child that forces the width. The live panel reads: a two-column row that needs 494 px in 356 px. |
| 17 | Honest "No" after two approaches; wrapping the row was the right kind of change | She stopped to ask permission for her third approach. The recorder now answers such a question with the same neutral go-ahead. Her `DEFAULT_WIDTH="100%"` change to the shared window frame would have harmed every desktop panel. |
| 18 | No result | The only working provider failed mid-turn, and the offline responder answered the go-aheads instantly. The recorder's "since" timestamp was taken after sending, so it missed a sub-second turn end and ran out the clock. Fixed. |
| 19 | **Reached a layout that measures 0**, but did not complete the loop | Her decisive edits came after her last capture. Her final typecheck failed on a duplicate key she introduced, and the recorder's four go-aheads (my limit) ran out before she could re-validate or re-capture. **Not counted.** The limits are raised to 8 go-aheads and 60 minutes. |
| 20 | Claimed "met": chat tabs, 2 → 0 | **Two app states, not her fix.** The 2 findings appear only when a background message's unread dot widens a tab. App and preview each read 0 or 2 depending on the load, and her preview with the dot still cuts the button off. Captures now load the page twice, and a finding seen in only some loads is marked and is never "resolved" evidence. |
| 21 | Claimed "resolved": the same chat-tab defect | Independently, her preview still cuts the button off whenever the unread dot is present. The findings were marked state-dependent, and she concluded "resolved" anyway. The capture's bus event now carries the comparison she was given. |
| 22 | Honest "not met": the Projects panel, 21 → 21 | One change (ellipsis), a right diagnosis she did not act on, then the only provider failed and the app went offline. |
| 23 | **She found a real defect and fixed it on phone**, whole loop in one turn | **The defect:** the companion, on by default since Pass 3, covers the chat header's three controls at phone size. **Her fix:** move its default spot. 3 → 0, confirmed independently. **But:** desktop measurement found her change covered the chat window's menu and close buttons for 4–6 s. Not counted. (An earlier attempt at run 23 was lost to a container restart; the recorder now mirrors her events outside the project.) |
| 24 | Not met: the defect moved on phone | **Request:** run 23's verification, worded as a review naming the regression, not a fix. **Her change:** another default spot, which fixed desktop but now covered the left of the phone header. **She claimed "no overlap"**, but her captures could not see it: the covering lasts only 1–3 s, until the companion moves herself, and capture measured only the settled layout. Capture now also watches the first 6 s after a panel opens and reports **covered-while-opening** controls. |
| 25 | Honest "not resolved", which described an earlier state | **She changed behaviour:** she now checks whether she is in the way every 0.5 s instead of 1.5 s, and `EDGE_MARGIN` went 12 → 48. Her last phone capture came before her last edit, and her desktop capture timed out. Independently, her final copy covered nothing on 8 viewports. |
| 26 | Nothing ran | **Her context said "No project copy exists"** while her copy was on disk. That state started empty on every page load. Now the runtime probe lists the sandbox's copies and her context names them. |
| 27 | Her own like-for-like capture: phone resolved; then the provider failed | **She raised `EDGE_MARGIN` to 100**, validated, and compared at phone: "5 → 2, resolved: the three covered-while-opening controls". The provider failed right after `project.diff`. My checking script now flags never-rendered loads, after one cold-compile load measured an empty page. |
| 28 | Her evidence was complete; the provider failed again after `project.diff` | **`project.diff` compared her copy with the real project as it is now.** Evidence files and fixes added later were listed as her deletions and modifications, and JPEG bytes were inlined as patch text. `project.apply` would have deleted or reverted them. **Copies now record a baseline**, so their diff is her changes only. Apply refuses a file the real project also changed since. Binary files are never inlined. |
| 29 | **The loop completed by her, with a confirmed verdict** | **Her steps:** validate, preview, app-first like-for-like captures at phone (5 → 2, the three header controls resolved) and desktop (1 → 0), then a diff of exactly her two files. **Her verdict:** "met for both phone and desktop". It matches the independent measurement on 8 viewports. **Acceptance test met.** Not applied (it needs the owner's authorization), and a review found her margin also limits where the user can drag her. Run 30 asks her to refine. |

### What the runs established
- **The self-development loop is executable end to end by LÉLU herself**, using real tools on a real sandbox copy of her own code:
  - capture her UI;
  - choose a problem;
  - copy the project, search, read and edit;
  - typecheck;
  - start a preview of the copy and capture it under the same conditions;
  - compare, diff and give a verdict.

  Runs 14–20 exercised every step, and the evidence of each run is in `docs/evidence/self-improve/<stamp>/`, with `VERIFICATION.md` beside it.
- **Her verdicts are checked mechanically, not trusted.** Replies that claim a tool result no tool produced carry "⚠️ Not verified" (`ClaimGrounding`). Replies whose numbers no capture measured carry "⚠️ Contradicted by measurement". Both fired correctly in live runs.
- **The measurement itself is now trustworthy.** Most early failures were mine:
  - the layout was measured mid-transition;
  - controls merely below the fold counted;
  - by-design modal backdrops counted as covering;
  - a false-positive overflow rule;
  - a prefix/suffix "diff";
  - one load per capture, so state-dependent findings looked like fixes;
  - a dev-server crash in the model broker;
  - several recorder races and limits.

  Each was found from a run's evidence, fixed, and covered by a test.
- **Destructive writes are refused.** Placeholders standing in for code, and `project_read`'s display pasted into source, are both blocked (`unsavableContent`).
- **The acceptance test is met (run 29).** LÉLU completed the whole loop on her own change:
  - found a real defect;
  - edited an isolated copy;
  - validated it;
  - compared it like for like with the app at phone and desktop;
  - diffed it and gave her verdict.

  An independent measurement confirms that verdict (`docs/evidence/self-improve/2026-10-30T10-33-46/VERIFICATION.md`). Runs 23–28 led up to it; each is verified beside its evidence.
- **Her change is not applied.** That needs the owner's authorization through `project.apply`, which Claude Code does not grant. A review found a side effect to address first: the margin also limits where the user can drag her.
  - The closest is run 19: her final copy measures 0 findings on the Avatar panel. But she never re-validated (her last edit broke typecheck) or captured it. Not counted.
  - In run 20 she claimed success, but two app states produced the result. Not counted.
- **Nothing LÉLU wrote has been applied to the real project.**

## 12. Environment limits that bound this work
- **Providers:**
  - only Fireworks (`gpt-oss-120b`) answers;
  - the Groq, OpenRouter and Cerebras keys in this container return 401 (rotated, per the owner);
  - Anthropic, Gemini and Mistral are not configured.

  The quality of her engineering is bounded by that one model. One run (18) was lost to a transient Fireworks failure.
- **Hardware:** the headless renderer manages about 2 fps. There is no microphone or speaker, so voice is verified by unit tests only.
- **Runtime:** `selfViewApi` (capture, preview, search) is mounted in Vite dev and `server.ts`, not in the Deno runtime (`main.ts`).

## 13. Not done from the V1.1 spec
- **Avatar:** a true 3D, viseme-synced avatar. The companion uses the chosen portrait with whole-figure motion driven by real speech and activity events. A companion GLB model is not wired.
- **Workspace:** done in `34048a7`:
  - the user's selected artifact is LÉLU's referent;
  - `artifact_read`, `artifact_edit` and `artifact_create` change the real view;
  - captures and read pages become artifacts with their content.

  The end-to-end browse → workspace script (`scripts/verify-workspace-artifacts.mjs`) runs in the app with her real model; see §15 for its result.
- **Not observed:** the Orchestrator auto-creates "General"/"Engineering" checkpoint projects on ordinary chat turns. This is pre-existing and documented in `CognitiveLoop`; it was left as is.

---

# Pass 3 — LÉLU's character (the owner's references, alive)

## 14. Her appearance is the owner's reference

**Requirement.** LÉLU must look like the woman in the owner's two reference images: deep skin, short defined black curls, gold hoops and jewellery, the gothic-lace and the earthy outfits. The generic 3D figure is not acceptable. She must be alive, with no box around her; she needs a face-only form, embodied and hologram forms, a mouth driven by her real speech, and the same character on every surface and on mobile.

### What was built
- **Assets.** `scripts/avatar/build_lelu_look.py` makes each look reproducibly:
  1. BiRefNet (MIT, ONNX) removes the reference's background, writing `body.webp` with alpha.
  2. MediaPipe face and pose landmarkers find her eyes, irises, brows, inner and outer lips, chin, head, neck, chest and feet. The face is detected on an upscaled head crop, because a full-length figure's face is small.
  3. `rig.json` is written.

  Hand-checked corrections are kept per look in `scripts/avatar/looks/<look>.json`:
  - where each hoop hangs;
  - the earthy look's hand resting on her cheek, which moves with her head;
  - in the earthy look, the left hoop hidden behind that hand.

  The outputs are `public/avatar/lelu/{gothic,earthy}/`.
- **Rig.** `src/core/avatar/LeluRig.ts` is one GLSL fragment shader that warps her image in real time:
  - upper eyelids close over her eyes (blinks);
  - irises move (gaze);
  - brows lift;
  - lips part, the jaw dropping with the lower lip and chin, and inside is a mouth cavity and tongue. Her own upper teeth from the reference stay with her upper lip; drawn teeth appear only for a closed-lipped look;
  - mouth corners smile, and the mouth widens or rounds per viseme;
  - her head tilts, nods and turns on her neck, with her hair and hoops;
  - the hoops swing like pendulums;
  - her chest breathes, and her body sways from the feet.

  The hologram form is the same rig with a projection material (cyan, scan lines, edge glow, flicker). Face framing dissolves at the bottom and sides, so there is no edge.
- **Shared animation state.** `src/core/avatar/LeluAnimation.ts` is one state for every surface:
  - the mouth comes from VoiceEngine's real utterance `start` (with its text), word `boundary` events (which re-sync to the word being spoken) and `end`. Letters become visemes. Without speech her mouth stays at rest;
  - blinks come every 2–6 s, sometimes doubled;
  - gaze wanders when she is idle and follows the pointer when you are near;
  - expression follows her real activity (listening, thinking, working, speaking, completed, error);
  - head and body drift is never-repeating.
- **Surfaces:**
  - **Companion overlay** (`LeluCompanion`): now **on by default**, full body, and can be turned off.
    - The card, ring, dark background and status dot are gone. The shadow follows her outline.
    - Her controls add Face/Full body and Embodied/Hologram, alongside the existing drag-to-place, keep-clear placement, captions and double-tap to chat.
    - She floats over Cosmos, chat, browser, memory and the panels.
  - **Avatar panel:** the generic "3D" tab is replaced by **Live LÉLU** (look, form, framing, and "Hear her", which speaks through VoiceEngine). The procedural snapshot and the image-to-3D (Meshy) section are removed: a reconstructed mesh would have no face rig.
  - **Genesis v2 Lab** (`LeluV2Presence`): she stands in the 3D scene through the same shader as a three.js material. She faces the camera and stays upright. The halo square and platform ring are removed, and executive avatar commands still work.
  - **Without WebGL:** her still cut-out is shown, never a substitute figure.

### Verified
- **Unit:** `tests/lelu-character.test.ts`, 8 tests:
  - assets match their rigs, and both have alpha;
  - the mouth curve passes through the corners, and her own teeth are used;
  - both framings;
  - every shader uniform is supplied;
  - the letter→viseme mapping;
  - speech start opens her mouth, a word re-syncs it, the end closes it, and silence never moves it;
  - blink rate and duty;
  - expressions;
  - the shared look and form store.

  `tests/companion-mode.test.ts` was updated for the new default and the framing.
- **Running app:** `node scripts/verify-lelu-character.mjs`, phone 390×844 and desktop 1280×800. Evidence is in `docs/evidence/lelu-character/<stamp>/`.
- **Companion live checks:** `node scripts/verify-companion.mjs` passes **41/41** on phone and desktop.
  - It now checks "on by default" and that the real switch turns her off, then on.
  - Caption and activity are polled, not slept.
  - It found a real bug: with Face and Hologram added, her control row ran 2 px past a 390 px screen. The row now wraps inside the screen.
- **Build:** `vite build` passes, and both looks are shipped in `avatar/lelu/`.
- **Voice in the running app:** headless Chromium has no voices, so the script installs a `speechSynthesis` stand-in that fires real start / word-boundary / end events. The path from VoiceEngine to her mouth is real; the audio is not.

### Not done, and why
- **A rigged photoreal 3D mesh.** It needs an image-to-3D reconstruction plus a facial rig (ARKit-style blendshapes) built from her reference. Neither service is configured here: there is no `MESHY_API_KEY`, and Meshy meshes carry no face rig.
  - The 2.5D rig is the faithful option available. Seen from a steep angle in the Lab, she is a figure on a plane.
  - A rigged GLB could replace the renderer later and read the same `AnimationParams`.
- **Arm gestures.** Her arms move only with her body sway and breath. Independent arm gestures would need the limbs separated into their own layers.
- **Real audio.** No real device, microphone or speaker exists in this container, so the voice path is verified with the stand-in above. The source images are about 1,000 px wide, so her face is about 130 px in the source; face-only mode is sharp at companion sizes and softens when enlarged.
- **New looks.** Adding one means running `build_lelu_look.py` on a new reference. An uploaded image is not rigged automatically in the browser.
