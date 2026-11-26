# Mission 44 — Autonomous Self-Development Laboratory

**Operational completion and advancement.** Mission 43 built a laboratory that could
perform one verified experiment. Mission 44 makes it run without a window open, reachable
from the conversation, and repeatable — and fixes the defects that only appeared once it
was actually used.

Scope: the Self-Development Laboratory only. No Cosmos, layout, navigation or
Consciousness-Thread work was touched.

---

## 1. Repository truth at the start (WP01)

| Fact | Value |
|---|---|
| Branch | `freebuff/08af6cc9ef212913e6b7209b` |
| Canonical HEAD | `543da7c` — *Replace the 2.1 hair shell with scalp-rooted volumetric locks* |
| Dirty paths | 31 at start (17 modified, 14 untracked) |
| Experiment branch | `lelu-lab/exp-engineer-ops` @ `374284a` (ancestry: `b56f21e` baseline → `543da7c`) |
| Other branches | `freebuff-base` @ `44ce6fd` |
| Worktrees | canonical + `.lelu-lab/experiments/exp-engineer-ops` |
| Listeners | `:3001` canonical dev server, `:3002` experimental preview |

Which dirty paths belong to which workstream:

- **Mission 41** (self-awareness, orbit): `src/core/selfdev/{CapabilityEvidence,DevelopmentJournal,ImprovementCycle,ImprovementLifecycle,SelfAwareness}.ts`, `src/core/cognition/{SelfModel,CognitiveContext}.ts`, `src/core/perception/FeatureUnderstanding.ts`, `src/app/scene/spatial/*`, `tests/self-awareness.test.ts`, `tests/spatial-orbit.test.ts`, `docs/missions/MISSION-41-*`.
- **Mission 43** (laboratory): `plugins/labApi.ts`, `src/app/scene/genesis/GenesisSelfDevelopmentLab.tsx`, `src/core/selfdev/lab/*`, `vite.config.ts`, `server.ts`, `.gitignore`, `tests/self-development-lab.test.ts`, `docs/missions/MISSION-43-*`.
- **Other workstreams**: `GenesisNotificationsPanel.tsx`, `spatialNav.css`, `SpatialNavigator.tsx`, `ImprovementQueue.ts`, `SelfDevelopmentEngine.ts`, `StartupDiagnostic.ts`, `docs/LELU_ENGINEERING_CHAIN_REPORT.md`, `ENV_VARS.md`.

**Nothing was reset, cleaned, stashed or discarded.** All work above is intact.

GitHub access: `git ls-remote` reaches `lapheezy/LeluV1.1` — **75 remote heads, read access
only**. There is no `GITHUB_TOKEN`/`LELU_ENGINEER_TOKEN` in this environment, so this
laboratory has never claimed authenticated access; it has git over the existing remote.

---

## 2. Persistent daily discovery (WP02)

### What already existed

`grep` for schedulers across `src/`, `plugins/`, `scripts/` found **no durable scheduler**
(no `BackgroundLifecycles`, no daemon, no cron). Timers exist only inside the browser
(`SceneFrameGovernor`, panel intervals). So the capability genuinely did not exist and a
smallest viable solution was required, not a fix.

### What was built

| Piece | File | Role |
|---|---|---|
| Engine | `plugins/labEngine.ts` | **The one implementation**: authority, discovery, experiments, diffs, verification, previews, genealogy |
| HTTP | `plugins/labApi.ts` | Thin routes over the engine; token, origin allowlist, status codes |
| Daemon | `scripts/lab-scheduler.ts` | Real process: `npx tsx scripts/lab-scheduler.ts [--once] [--interval-ms N]` |
| Control | `POST /api/lab/scheduler` (`start` / `stop` / `run-once`), `GET` for state | Start/stop/report from the interface |

The engine was **extracted from `labApi.ts`**, not copied: the API and the daemon import the
same `createLabEngine()`. A scheduler with its own discovery would be a second laboratory
that could disagree with the first — the exact duplication the mission forbids. A test
asserts the scheduler contains no `function inspect(` and no `child_process` import.

### A cycle, in order

1. `git fetch --prune origin` + `git ls-remote` connectivity probe
2. inspect the tree (findings below)
3. reconcile earlier discoveries against **this** inspection
4. append to `.lelu-lab/state/journal.jsonl`
5. write heartbeat: cycles, last id, next run, failures

### Verified running, headless

```
[lab-scheduler] sync ok=true commit=543da7c remoteHeads=75
[lab-scheduler] discovery disc-mwx5r2tj-c501c4 findings=4 priority=60 status=open reconciled=0 427ms
```

Process `20475` (`node … scripts/lab-scheduler.ts --interval-ms 21600000`), heartbeat
`running:true, cycles:2, nextAt: +6h`. Started through the API, not from a terminal I was
watching — it survives the window closing because it is detached from the browser entirely.

### Failure behaviour

A failed cycle is recorded (`kind: "scheduler-failure"`) with its error, `failures`
increments, and the next attempt backs off 1× → 2× → 4× → 6× (capped). A scheduler that
silently stops is worse than one that is visibly broken. Covered by
`tests/lab-scheduler.test.ts` (`backoffMs` growth + cap; heartbeat round-trip; a failed
cycle keeps the error).

### Honesty about "nothing changed"

An unchanged tree produces a **new record** with the same fingerprint and
`status: "already-known"`, naming `previous`. It is not reported as a discovery, and the
recommendation literally says: *"No high-severity opportunity. Record the finding and keep
the tree as it is; a day without a change is a valid outcome."*

---

## 3. The seven views (WP03)

All seven read the engine; none holds mock data.

| View | Real data it shows | Verified |
|---|---|---|
| Repository | remote, branch, HEAD+subject, 75 remote heads, 3 branches, 3 worktrees, dirty paths, commit log, tree, search | screenshot |
| Editor | actual source of the selected experiment, editable, saved through `write`/`patch`, genealogy panel | structural + API |
| Diff | baseline→current, per-file `+n/−n`, exact patch, survives commit | API (see §5) |
| Timeline | journal entries: discovery, experiment-created, patch, command, commit, conclusion | screenshot |
| Research | priority, status, recommendation, findings with evidence, rationale | screenshot |
| Preview | experiment server on its own port, three viewports, process status | API |
| Verification | declared commands, exit codes, durations, log tail, recorded history | screenshot |

Failure isolation: every read is issued independently, so one refused route cannot blank
the others (a Mission 43 defect, kept fixed).

New in Mission 44: a **daily-cycle strip** in the header (state, last run, next run, last
error, Start/Stop/Run-now) and a line naming the chat tools.

---

## 4. The laboratory in the conversation (WP04)

Eight tools joined the existing registry and the **one** dispatch table
(`ToolDispatcher.BY_ID`) — no second chat, no second store:

`lab.repository` · `lab.discoveries` · `lab.diff` · `lab.verification` · `lab.experiment` ·
`lab.preview` · `lab.file` · `lab.history`

What they answer, in the conversation:

| You say | Tool |
|---|---|
| "Inspect the latest repository changes." | `lab.repository` |
| "What did you discover today?" / "What remains unresolved?" | `lab.discoveries` (`latest` / `unresolved`) |
| "Show me the exact diff." / "Explain why you changed that." | `lab.diff` (patch + reason + commit) |
| "Compare the original and modified code." / "Where did this file come from?" | `lab.file` (`read` / `genealogy`) |
| "Run verification on this experiment." | `lab.verification` (runs it, or reports history) |
| "Open the preview." | `lab.preview` |
| "Continue that experiment." | `lab.experiment` (`create`/`list`/`conclude`) |
| "Show me your development history." | `lab.history` (journal + git merged by time) |

All are risk ≤ 1 (read-only or local-state). None can push, merge, deploy or delete.
`tests/lab-chat-tools.test.ts` asserts: declared ↔ executor ↔ dispatch table ↔ registry
agree, risk ≤ 1, no destructive permission, and — against a stubbed transport — that a real
answer is returned, that an empty diff is a refusal rather than a blank, and that the patch
text is the exact `+15/−4` change.

---

## 5. Repeated autonomous engineering (WP10)

Four cycles. The first three each used an isolated worktree, a real edit, its own diff, a
real check, a commit and a conclusion.

| # | Finding | Change | Diff | Check | Commit | Status |
|---|---|---|---|---|---|---|
| 1 | `capability-no-tests` — the `work-queue` capability declared **no** verifying test | new `tests/work-queue.test.ts` + evidence entry | `tests/work-queue.test.ts` +40 / `CapabilityEvidence.ts` +1−1 | `tsc -b --force` exit **0** (31.5 s) | `5e87d34` | verified |
| 2 | labs refusals all answered **HTTP 400** | map 404 / 400 / 500 meaningfully | `plugins/labApi.ts` +10 −1 | exit **0** (30.2 s) | `810ac33` | verified |
| 3 | `lab.verification` returned `ok:true` for a **failed** check | non-zero exit ⇒ `ok:false` | `LabTools.ts` +11 −8 | exit **0** (28.3 s) | `c7a1f2e` | verified |
| 4 | every `DrawingEditor` consumer loaded Excalidraw statically | genuine lazy load | `DrawingEditor.tsx` (rewritten) | full suite, `genesis-interface` 2/2 | — | canonical |

**Measured before → after, same instrument.** After cycle 1 the daemon's own inspection
dropped from **5 findings / priority 82/100** to **4 findings / priority 60/100**, and
`capability-no-tests` is no longer raised. Cycle 4 took the suite from 1 failing file to 0.

The three failed attempts are **still recorded** (`exp-work-queue-check` @ `a6d1e45`,
`exp-api-error-status` @ `5e88ccd`, `exp-verification-honesty` with no commit) with
`status: "abandoned"` — see §6 for why they failed.

---

## 6. A defect this mission found in the laboratory itself (WP06)

The first three cycles all failed with:

```
src/core/tools/ToolDispatcher.ts(72,31): error TS2307:
  Cannot find module '../selfdev/lab/LabTools' or its corresponding type declarations.
```

Cause: the experiment overlay copied **files** from `git status --porcelain`, which reports
an untracked **directory** as a single entry (`?? src/core/selfdev/lab/`). Copying that path
failed, and the failure was silently skipped — so every experiment inherited a tree where
half the laboratory's own modules were missing.

Fix, in `plugins/labEngine.ts`:

- overlay built from `git ls-files --others --exclude-standard` (files, not directories) +
  `git diff --name-only HEAD`, with `statSync().isDirectory()` guard;
- anything that still cannot be carried is recorded (`notCarried`, journal
  `experiment-overlay-incomplete`) instead of vanishing;
- the laboratory's own `.lelu-lab/` is excluded from "dirty work" — otherwise `sync` writing
  its heartbeat would be reported as the user's uncommitted changes, and an inspection
  would scan nothing but `.lelu-lab/`.

After that fix all three cycles passed on the first attempt with identical edits, which is
the proof that the fix — not luck — was the difference.

Other isolation properties, kept and asserted: unique id, branch, base branch, base commit,
**baseline commit**, worktree path, overlaid files, preview, discovery link, reason,
verification history, commit, final status. A committed experiment keeps its branch when the
worktree is removed; an abandoned one keeps its record.

---

## 7. Research intelligence (WP07)

Every discovery now carries a `rationale` answering the seven questions **from its own
evidence**: what, evidence, why it matters, alternatives (including "do nothing"), research
(repository-only, and it says so), smallest correction, and how success will be measured
("re-run the inspection; `<finding>` must no longer be reported").

Reconciliation is recorded only when the *inspection* stops finding what it previously
found — never because a build passed. A discovery keeps what it found even after it is
resolved: history is not rewritten.

---

## 8. Permissions (WP08)

Autonomous: inspect, read, research, create worktrees, modify sandbox files, run declared
checks, build previews, record genealogy, update records.

Requires explicit authorization: merging, pushing, deploying, production infrastructure,
destructive repository operations, production data/secrets. None of those commands exists
anywhere in `labEngine.ts`, `labApi.ts` or `lab-scheduler.ts` — a test parses every `git([...])`
call and fails if `push`, `merge`, `reset`, `rebase`, `cherry-pick` or `update-ref` appears.
The only destructive git call is `branch -D`, guarded by the `lelu-lab/` prefix.

Cross-origin requests are refused unless the origin is the same host or in
`LELU_LAB_ALLOWED_ORIGINS`; mutating requests need the session token from `/status`.

---

## 9. Self-awareness integration (WP09)

- `CapabilityEvidence["self-development"]` now names the laboratory's implementation
  (`plugins/labEngine.ts`, `plugins/labApi.ts`, `scripts/lab-scheduler.ts`,
  `src/core/selfdev/lab/LabTools.ts`) and its tests (`tests/self-development-lab.test.ts`,
  `tests/lab-scheduler.test.ts`). The evidence test asserts those paths exist.
- `CapabilityEvidence["work-queue"]` gained its real test file (cycle 1).
- `src/core/selfdev/lab/LabJournalBridge.ts` carries laboratory activity into the **one**
  `DevelopmentJournal`, deduped by title, with `verified: true` only for a check that ran
  and passed. It reports an unreadable journal as an error rather than "nothing happened".

A proposed capability is still not operational: Mission 43's WP09 chat-native tools are now
implemented (§4) **and** tested, so the claim in `CapabilityEvidence` is backed by a test
that exists in `npm test`.

---

## 10. Visual evidence (WP11)

Captured from the running interface at `…freebuff.site` (`docs/missions/evidence/mission-44/`):

- `01-laboratory-repository.png` — repository view + the daily-cycle strip
- `03-research-findings.png` — priority 60/100, `already-known`, real remote, findings
- `04-timeline.png` — journal: `experiment-concluded … status=verified … commit=c7a1f2e`
- `07-verification.png` — the experiment, its baseline, the declared checks

**Not captured:** Editor, Diff, Preview and the chat exchange. The cloud browser's renderer
crashed twice on this scene (`Target crashed`, then a dead tab); each capture above is a
separate short session for that reason. Those four are verified **structurally and over the
API** (the diff in §5 is the server's own output), not visually. This is a capture
limitation of this host, not a claim that the views are broken — and not a claim that they
were seen working.

Verification classes: **structural** (types, tests, API responses) and **browser-emulated**
(the four screenshots). There is no physical-device verification.

---

## 11. Verification totals (WP12)

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| Full suite `npm test` | **2 319 tests · 2 311 pass · 0 fail · 8 skipped · 30 suites · 213.8 s · exit 0** |
| Before Mission 44 (Mission 43 close) | 2 300 tests · 2 291 pass · **1 fail** · 24 suites · 239 s |
| `tests/genesis-interface.test.tsx` | **fixed** (was the 1 failure) |

New suites: `tests/lab-scheduler.test.ts` (10), `tests/lab-chat-tools.test.ts` (6),
`tests/work-queue.test.ts` (1); `tests/self-development-lab.test.ts` updated for the engine
split and the scheduler route.

### The Excalidraw failure, resolved

It was not one problem but two:

1. `@excalidraw/excalidraw@0.18.1` defines `./index.css` **only** under `development` /
   `production` conditions, which a plain Node resolver has neither of →
   `ERR_PACKAGE_PATH_NOT_EXPORTED`.
2. With `--conditions=development` the dev build then fails on
   `import { LaserPointer } from "@excalidraw/laser-pointer"` — a named import from a CJS
   dependency that Vite's interop handles and Node's ESM loader does not.

Both are only reachable because `DrawingEditor.tsx` imported Excalidraw **statically** while
its header claimed it was lazy-loaded. Making the import genuinely dynamic (module + CSS
loaded on first open, with a visible "could not load" state) fixes the suite *and* stops
every consumer of the studio from paying for a 3 MB editor it may never open.

---

## 12. Exact state at the end

| Fact | Value |
|---|---|
| Branch | `freebuff/08af6cc9ef212913e6b7209b` (unchanged; **nothing committed on it**) |
| HEAD | `543da7c` |
| Experiment branches | `lelu-lab/exp-engineer-ops` `374284a`; `lelu-lab/exp-work-queue-check` `a6d1e45`; `lelu-lab/exp-api-error-status` `5e88ccd`; `lelu-lab/exp-verification-honesty` (no commit); `lelu-lab/exp-work-queue-check-v2` `5e87d34`; `lelu-lab/exp-api-error-status-v2` `810ac33`; `lelu-lab/exp-verification-honesty-v2` `c7a1f2e` |
| Dirty paths at the end | 44 (31 at the start + this mission's files/tests/evidence; nothing reverted) |
| Experiments recorded | 7 (3 verified, 3 abandoned, 1 from Mission 43) |
| Worktrees | 9 entries in `git worktree list` (canonical, bare repo, 7 experiments) |
| Branches | `freebuff-base` `44ce6fd` · `freebuff/…` `543da7c` · `lelu-lab/exp-engineer-ops` `374284a` · `lelu-lab/exp-work-queue-check` `a6d1e45` · `lelu-lab/exp-api-error-status` `5e88ccd` · `lelu-lab/exp-verification-honesty` `f77c2df` (baseline only — the experiment made no commit) · `lelu-lab/exp-work-queue-check-v2` `5e87d34` · `lelu-lab/exp-api-error-status-v2` `810ac33` · `lelu-lab/exp-verification-honesty-v2` `c7a1f2e` |
| Daemon | `pid 20475`, `--interval-ms 21600000`, heartbeat `running:true` |
| Pushed / deployed | **nothing** |

---

## 13. Remaining limitations and required approvals

1. **The scheduler is not installed as a service.** It is a detached process with a
   heartbeat; a machine reboot ends it, and nothing restarts it. A supervised unit
   (systemd/launchd) or a cron entry would close that gap — it needs a deployment decision,
   not more code.
2. **Experiments are never auto-created by the daemon.** Discovery is autonomous; opening an
   experiment stays an authorized act (chat tool or the interface). That is deliberate, but
   it means "autonomous development" is autonomous *inspection* until someone authorizes the
   change.
3. **Preview and screenshot remain manual in this host.** Headless Chromium cannot launch
   (missing system libraries), so `experiments.screenshot` returns that fact plus the live
   URL instead of an image.
4. **Four of seven views lack a screenshot** in this environment (§10).
5. **The chat tools were tested against a stubbed transport, not by typing in the chat UI**
   — the wiring, permissions and content are asserted; a live conversational exchange is not.
6. **Nothing is pushed, merged or deployed.** Every experiment branch is local. Approving a
   merge is a separate, explicit act.
7. `exp-verification-honesty` (v1) left no commit because its patch could not apply to a tree
   that was missing the file — kept as evidence of the overlay defect rather than deleted.
