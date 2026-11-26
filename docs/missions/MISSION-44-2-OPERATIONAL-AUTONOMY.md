# MISSION 44.2 — LÉLU OPERATIONAL AUTONOMY

**End-to-end cognition, tool orchestration, laboratory reliability & recovery**

Date: 2026-11-26 · Canonical `freebuff/08af6cc9ef212913e6b7209b` @ `543da7c` (+53 uncommitted paths)
Evidence: `docs/missions/evidence/mission-44-2/`

---

## 0. Status against the definition of done

| Claim | Status | Evidence |
|---|---|---|
| LÉLU answers a real conversational turn with a real model | **VERIFIED** | screenshot 01, broker log, routing trace (`owner=Groq`) |
| LÉLU independently selects an authorized laboratory tool | **VERIFIED** | `lab.repository` ran 2×, `lab.history` 1×, `lab.diff` 1× — chosen by the model, not by a script |
| Tool executes against the real laboratory | **VERIFIED** | lab API calls under session token; real HEAD/pid/cycle returned |
| Result interpreted and answered to the user | **VERIFIED for factual rows, PARTIAL for narration** | accurate HEAD/branch/pid; one invented narration (§2.5) |
| Finding enters the existing journal | **VERIFIED (bridge), WIRED (executor path)** | 33 entries imported, 6 deduped, live |
| Retrieval in a later turn | **VERIFIED** | `lab.history` turn reported the recorded cycle |
| Failed operation handled honestly | **VERIFIED** | `lab.diff` 1 run / 0 success, "1 issue" in UI, no invented diff |
| Landscape laboratory accessible | **UNVERIFIED VISUALLY — invariant added and tested** | §5 |
| Renderer crash documented with recovery behaviour | **INVESTIGATED, NOT FIXED** | §6 |
| Scheduler production supervision | **BLOCKED on this host** (no supervisor exists) | §4 |

Nothing in this report is inferred where a measurement was possible; the rows marked
unverified are the ones that could not be measured.

---

## 1. WP01 — Repository truth and recovery

Full manifest: [`evidence/mission-44-2/recovery-manifest.md`](evidence/mission-44-2/recovery-manifest.md).

- Canonical HEAD **`543da7c`** ("Replace the 2.1 hair shell with scalp-rooted volumetric locks", 2026-11-19).
- Baseline **`f4f042d`** ("LÉLU lab baseline: 543da7c + 60 uncommitted path(s)").
- Experiment commit **`5ff4a33`** ("Let the laboratory inspect any experiment, not just the first").
- **9 worktrees**, **8 experiment branches**, all preserved:

| Branch | Commit | Subject |
|---|---|---|
| `lelu-lab/exp-api-error-status` | `5e88ccd` | Give laboratory refusals a status that means something |
| `lelu-lab/exp-api-error-status-v2` | `810ac33` | Give laboratory refusals a status that means something |
| `lelu-lab/exp-engineer-ops` | `374284a` | Make the whitelisted validation commands executable on a Node runtime |
| `lelu-lab/exp-experiment-selector` | `5ff4a33` | Let the laboratory inspect any experiment, not just the first |
| `lelu-lab/exp-verification-honesty` | `f77c2df` | lab baseline (superseded by v2) |
| `lelu-lab/exp-verification-honesty-v2` | `c7a1f2e` | Make a failed verification a failed tool call |
| `lelu-lab/exp-work-queue-check` | `a6d1e45` | Verify the work-queue capability instead of only naming it |
| `lelu-lab/exp-work-queue-check-v2` | `5e87d34` | Verify the work-queue capability instead of only naming it |

- Working tree: **53 uncommitted paths** at the end of this mission (was 47 at start; the
  difference is the four files changed here plus evidence). Nothing reset, cleaned,
  merged or consolidated. No branch was deleted. Mission 44.1's scheduler files and
  evidence are all still present.
- Mission 44.1 scheduler changes verified in place: `scripts/lab-scheduler.ts` (locks,
  heartbeat, `--max-cycles`), `plugins/labApi.ts` (`stale`/`staleReason`, `run-once` through
  the same cycle lock), `deploy/lelu-lab-scheduler.service`, `tests/lab-scheduler.test.ts`.

---

## 2. WP02 — Real conversational cognition (the highest-priority package)

### 2.1 The opening claim vs the observed behaviour

The opening report said provider keys exist; the chat said *"I'm in offline mode right now —
all AI providers are unreachable or unconfigured"*. Both were true. The keys were present and
working; the runtime could not use them. Two independent defects produced the offline answer.

### 2.2 Defect A — the broker refused every browser request (403)

`plugins/modelApi.ts` decided whether a request came from another site by comparing the
`Origin` header's host to the `Host` header:

```ts
if (new URL(candidate).host !== host) return true;   // → 403
```

Behind the hosted preview proxy, the page's origin is the public preview host while the
server receives `Host: 127.0.0.1:3001`. The comparison therefore failed for **every** chat
request. Measured from inside the page:

```
POST /api/model/groq/chat/completions        → 403 {"error":"Cross-origin broker requests are refused."}
POST /api/model/openrouter/chat/completions  → 403 {"error":"Cross-origin broker requests are refused."}
```

Each provider rung failed instantly, the chain ended with `providers.length === 0`, and LÉLU
answered the offline notice. `curl` from the same machine returned **200** for the identical
credential — which is why "the keys work" and "she is offline" were both correct.

**Fix (extend the existing rule, no new mechanism).** `crossOrigin()` now accepts, in order:
1. `Sec-Fetch-Site: same-origin` — set by the browser itself and unreachable from page script,
   the same signal `plugins/browseApi.ts` (`fromOwnPage`) already trusts;
2. an explicit `LELU_BROKER_ALLOWED_ORIGINS` allowlist, mirroring `LELU_LAB_ALLOWED_ORIGINS`;
3. host equality, now including `X-Forwarded-Host`.

A genuinely cross-site page still fails all three. Verified: simulated proxy request
(`Host` ≠ `Origin`) before → **403**, after → **200**.

### 2.3 Defect B — the spatial resolver swallowed laboratory requests

With the broker fixed, two laboratory prompts still produced no provider request at all.
They returned the same canned sentence: *"Prepared: Build 4 objects — 3 zones, 1 hub,
3 links…"*. The routing trace showed `owner=spatial` with an empty stage list.

Two rules were responsible:

- `SpatialComposition` / `isCompositionRequest()` treated any mention of **"laborator"** as a
  request to build Cosmos geometry (`/laborator|lab\b|research zones?/`).
- `parseSpatialCommand()`'s `inspect <anything>` rule captured a whole sentence as an object
  reference, so *"Inspect the experiment exp-experiment-selector with your laboratory
  tooling…"* became a scene read.

**Fix (same authority, conservative reading the resolver already documents).**
`inspect` now requires a short object reference (≤ 5 words, no clause connectors, no
punctuation); "laboratory" is only geometry when the sentence also carries a build verb
(build/create/make/design/compose/arrange/set up/lay out/render/generate/add/place).
Genuine scene commands are unchanged — pinned by tests (`tests/spatial-chat.test.ts`, 11/11).

### 2.4 Evidence of model-side selection (not manual dispatch)

Turn 1 — *"What did you discover today?"*

```
provider=groq model=openai/gpt-oss-120b status=200 | provider stage 4083 ms | owner=Groq
answer: a real account of the day's inspection, open questions included
```

Turn 2 — *"Use your laboratory to report the repository HEAD, the current branch and the
scheduler state."* (three provider rounds, tool results fed back):

```
200 messages=14 toolResults=0   ← model asked for tools
200 messages=16 toolResults=1   ← first result returned
200 messages=18 toolResults=2   ← second result returned
toolstats: lab.repository 2/2, repo.status 1/1, resources.gaps 1/1
```

Her answer: HEAD `543da7c` with its subject and date, the uncommitted-path count, and
*"Scheduler: running (process PID 29844), currently on cycle 3 … next scheduled run in 41
minutes"* — all matching `/api/lab/status`. She also hedged honestly on the branch name and
warned that `project_commit`/`github_commits` had not run.

**This is model-side selection**: no script chose `lab.repository`; the model did, from the
offered schemas, and the existing authorization path (session token from `/api/lab/status`)
approved every call.

### 2.5 What is still wrong (reported, not hidden)

- **Narration drift.** On the `lab.history` turn the *rows* were real (`experiment-commit`,
  `preview-started`, `experiment-concluded`) but her summaries invented content — "building
  four objects (three zones, one hub, three links)" — carried over from the earlier canned
  spatial reply in conversation memory. Factual tool output is repeated accurately; free-text
  interpretation of those rows is not yet trustworthy.
- **Branch name.** She reported the branch as "typically main/master" instead of the real
  `freebuff/08af6cc9ef212913e6b7209b`, although the tool payload contains it. Payload →
  answer fidelity is partial for this field.
- **OpenRouter is genuinely unavailable**: `429 free-models-per-day`, reset 2026-11-27T00:00Z
  (`X-RateLimit-Remaining: 0`). Groq carries every turn, rotating keys 1→2→3 on 429.

---

## 3. WP03 — Complete tool execution lifecycle

| Stage | Where | Verified how |
|---|---|---|
| Discovery | `ToolSchemas.toolSchemasForModel()` | 72 model-visible schemas, 8 `lab_*` present |
| Intent → tool mapping | `selectToolSchemas()` | measured per prompt; lab prompts offered `lab_diff`, `lab_experiment`, `lab_verification`, `lab_repository` |
| Schema the model receives | `generateWithTools()` | broker trace `tools≈1138–1586tok` on every turn |
| Authorization | lab session token; broker same-origin rule | 9 dispatches, 0 unauthorized; 403 path proven pre-fix |
| Execution | `dispatchToolCall` → `BY_ID` | real HTTP to `/api/lab/*` |
| Result normalization | `LabTools` content strings | exact HEAD/pid/dirty count reproduced in answers |
| Error handling | failed tool → failed call | `lab.diff` 1/0 with the real message; UI shows "⚠ 1 issue" |
| Retry / rotation | registry cooldowns, key ring, half-open probe | live `slot 1 429 → slot 2 → slot 3` then 200 |
| Audit ledger | `lelu.lelu.toolstats.v1` | per-tool runs/success/fail/lastError/meanMs |
| Conversation response | provider round with `role: tool` | `toolResults=1`, then `2`, then final 200 |

**Success ≠ completion, kept distinct**: `verified` is only set by the journal bridge when a
declared check ran and passed; a tool call that merely returned data never sets it.

Unsuccessful operations exercised this mission: unknown experiment (`lab.diff` → honest
refusal), empty memory query (`memory.recall` → "No stored memory matches"), exhausted
credential (`429` → next key).

---

## 4. WP04 — Scheduler production reliability

Measured on the real daemon:

```json
{"running": true, "pid": 29844, "cycles": 3, "intervalMs": 21600000,
 "nextAt": 1795696849410, "lastCycleAt": 1795675249409,
 "lastDiscoveryId": "disc-mwx6ohz4-c501c4", "lastFindings": 4,
 "mode": "daemon", "stale": false, "failures": 0, "ok": true}
```

Already proven in Mission 44.1 inside an isolated repository: duplicate instance → exit 3
("already held by pid"), `kill -9` → "recovered from pid …, heartbeat closed, lock released",
SIGTERM → clean release with no lock file left behind, stale-heartbeat expiry via
`heartbeatStale`.

**Supervision on the actual host — blocked, honestly.** This VM has **no supervisor at all**:

```
PID 1: agent37-vm-guest
systemctl absent · supervisord absent · s6-svscan absent · runsvdir absent
runit absent · pm2 absent · launchctl absent · docker absent
```

So `deploy/lelu-lab-scheduler.service` is a correct artefact for a host that runs systemd and
**cannot be installed here**. No claim of production supervision is made. What *is* in place
and verified is process-level recovery (lock + heartbeat), which is what a supervisor would
rely on. Automatic start after a machine restart remains untested — nothing here can restart
it.

---

## 5. WP05 — Laboratory interface and window authority

**Root cause of the landscape obstruction** is in the existing layout authority, not in a
new z-index scheme: `reflowForViewport()` clamped a window to the viewport but never limited
how much of a *short* viewport one window could own, so a full-height chat left the
laboratory beneath it with no reachable surface (44.1: 20/20 controls covered at 844×390).

**Fix** — `landscapeReflow()` in `src/app/scene/genesis/layout/moduleLayout.ts`, applied at
the end of `reflowForViewport` (the same authority, no competing stack):
- only when `viewport.height ≤ 520` **and** more than one window is visible;
- only the **topmost** window is bounded, to 65 % of the viewport, docked to the bottom edge;
- nothing is minimized automatically; desktop and portrait geometry are untouched.

Tested (`tests/module-layout.test.ts`): the laboratory's header row stays uncovered in
landscape; desktop hand-placed geometry is preserved; a single window may still fill the
screen. 37/37 layout tests pass.

**Not verified visually.** The renderer hung before a landscape capture could be taken
(§6). The geometry is proven by test, the pixels are not — that distinction is deliberate.

The six desktop occlusion findings from 44.1 are attributable to the companion window
overlapping panel content at 1440×900; they are not z-index conflicts, and the layout tests
already assert non-overlap for tiled windows.

---

## 6. WP06 — Browser renderer stability

Observed again this mission, twice, reproducibly:

| Symptom | Meaning |
|---|---|
| `browserType.connectOverCDP: Timeout 10000ms` | renderer unresponsive |
| `Page.captureScreenshot: Internal error` | renderer cannot composite |
| `Runtime.evaluate timed out after 10s` on a trivial expression | main thread blocked > 10 s |

Pattern: the tab is healthy for roughly one or two chat turns after load, then stops
answering. Console before the hang:

```
[.WebGL-…] GL Driver Message … GPU stall due to ReadPixels (repeats)
```

Contributing facts found in code: the cloud browser has **no GPU**, so three.js runs on a
software rasteriser (`swiftshader`); the scene reads pixels back for compositing, which is
the stall above. The project already has the right machinery — `SceneRenderManager`
(`light` profile for a software renderer, `webglcontextlost/restored` handling, adaptive DPR,
`SceneRenderBudget` occluders) and `RenderContextGuard`. What is missing is a *hang*: none of
that reacts when the main thread stops running entirely (the fps sampler cannot fire either).

**Not fixed.** 3D rendering was not disabled and no crash was papered over. A real fix needs
either a GPU-capable browser or moving the world off the main thread; neither is available in
this environment. Recovery used: close the tab, reopen (which restored a working app each
time).

---

## 7. WP07 — Journal integration and self-awareness

`LabJournalBridge` was complete and honest — dedupe by title, `verified` only from a real
passing check — but **nothing called it**, so a conversation could inspect the repository
while the DevelopmentJournal stayed empty (2 unrelated entries).

- **Wiring**: `LAB_EXECUTORS` now wraps each executor; after a successful laboratory call it
  fires `syncLaboratoryIntoJournal()` (fire-and-forget, non-fatal, idempotent). No second
  journal, no second registry.
- **Live proof**: invoking the existing bridge against the running lab imported **33 entries,
  skipped 6** already present, e.g. `Laboratory discovery disc-mwx2o1ty-533ca5`,
  `Laboratory check typecheck on exp-engineer-ops`,
  `Laboratory experiment exp-engineer-ops committed`.
- **Retrieval**: the `lab.history` turn read the recorded cycle and answered from it.
- **Limitation**: the executor-level wiring takes effect on a fresh page load (the dispatch
  table is built at import), and the unit test pins the request
  (`/api/lab/journal` requested after a successful `lab.repository`).

---

## 8. WP08 — End-to-end acceptance transcript (real application)

**Success path** (screenshot 03):

```
user      Use your laboratory to report the repository HEAD, the current branch and the scheduler state.
LÉLU      [3 tool rounds: lab_repository ×2, repo_status]
          Repository: lapheezy/LeluV1.1 (hosted on GitHub, reachable)
          HEAD commit: 543da7c – "Replace the 2.1 hair shell with scalp-rooted volumetric locks"
                        (committed 2026-11-19 14:05 UTC)
          Uncommitted changes: 51 paths …
          Scheduler: running (process PID 29844), currently on cycle 3, last run 5 hours ago,
                     next scheduled run in 41 minutes.
          ⚠ Not verified: this reply describes the commit, but project_commit / github_commits
            did not run successfully in this turn. Treat those statements as unconfirmed.
```

**Failure path** (screenshot 04):

```
user      Inspect the experiment exp-does-not-exist with your laboratory tools and show me its diff.
ledger    lab.diff: 1 run / 0 succeeded — "No experiment exists. Create one in the laboratory before …"
UI        Working with tools · 3 tools used · ⚠ 1 issue
LÉLU      I tried to inspect exp-does-not-exist with the laboratory tools, but that experiment
          isn't present in the repository. Consequently there's no diff to show.
```

Screenshots: `01-real-groq-answer.png`, `03-lab-tool-selection.png` (before/after the router
fix in one view), `04-failed-operation.png`.

---

## 9. WP09 — Regression and performance

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npm run build` | **exit 0**, `✓ built in 5.20s` |
| Full suite (`npm test`) | **2329 tests, 2321 pass, 0 fail, 8 skipped, 32 suites, exit 0** |
| Targeted (spatial chat, lab tools, scheduler, layout) | 34/34 and 37/37 |
| Log | `evidence/mission-44-2/verification.log` |

Measured (this VM, while the suite was running — a deliberate worst case):

| Metric | Value |
|---|---|
| Model round-trip (Groq, small completion) | 0.156 s |
| Laboratory API call (`/api/lab/status`) | 0.207 / 0.233 / 0.224 s |
| Tool-selection + execution stage (first lab turn) | 4 083 ms (provider stage, incl. 3 rounds) |
| Total request→result (simple question) | ~4.5 s |
| Total request→result (lab tool turn) | ~14 s, three provider rounds |
| Scheduler cycle interval | 6 h (21 600 000 ms), 3 cycles completed, 0 failures |
| Dev server RSS | 773 MB (Vite dev, full scene graph) |
| Renderer stability | healthy for 1–2 turns, then hang; 2 hangs this mission |

All figures are measured; none is an estimate. Values under test-suite load are labelled as
such.

---

## 10. WP10 — Deliverables

1. Recovery manifest — `evidence/mission-44-2/recovery-manifest.md`
2. Provider diagnosis — §2
3. Tool-selection evidence — §2.4
4. Tool lifecycle — §3
5. Scheduler supervision — §4
6. Landscape correction — §5
7. Renderer investigation — §6
8. Journal evidence — §7
9. E2E transcript — §8
10. Screenshots/logs — `evidence/mission-44-2/`
11. Test results — §9
12. Commit/branch manifest — §1 (no commits made; everything recoverable in the working tree)
13. Remaining blockers — §11

---

## 11. Remaining blockers

1. **No supervisor on this host** — production-grade auto-start/restart cannot be installed
   or verified here (`deploy/lelu-lab-scheduler.service` is ready for a systemd host).
2. **Renderer hang** in the GPU-less cloud browser — documented, not fixed; 3D retained.
3. **Landscape not visually verified** — invariant proven by test only.
4. **Narration drift** — real tool rows, invented summaries on the journal-history turn.
5. **OpenRouter unavailable** until 2026-11-27T00:00Z (daily free quota); Groq rotates three
   keys and occasionally 429s mid-turn.
6. **No commits made** — all changes are uncommitted in the canonical worktree, by design and
   pending authorization.
