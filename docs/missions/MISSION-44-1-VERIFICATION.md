# Mission 44.1 — Laboratory: Operational Verification

Continuation of Mission 44. Nothing was re-architected: the same `labEngine.ts`,
`scripts/lab-scheduler.ts`, eight tools, one journal and one self-awareness authority.
This mission verifies them against a running system and fixes what verification broke.

---

## 1. Repository truth (WP01)

| Fact | Value |
|---|---|
| Branch / HEAD | `freebuff/08af6cc9ef212913e6b7209b` @ `543da7c` (unchanged) |
| Dirty paths | **44** — 19 modified, 25 untracked (inventory in §12) |
| Worktrees | **9** (`git worktree list`: bare repo, canonical, 7 experiment copies) |
| Experiments | **7** recorded; 3 `verified` from Mission 44, 3 `abandoned`, 1 open from Mission 43 |
| Verified experiments | `exp-work-queue-check-v2` `5e87d34` · `exp-api-error-status-v2` `810ac33` · `exp-verification-honesty-v2` `c7a1f2e` |
| Report + journal | `docs/missions/MISSION-44-…md` present; `.lelu-lab/state/journal.jsonl` holds every cycle/experiment entry |

Ownership of the dirty paths is unchanged from Mission 44 §1, plus this mission's
`deploy/`, `docs/missions/evidence/mission-44-1/`, `scripts/lab-scheduler.ts` edits and
`src/core/selfdev/lab/LabClient.ts`.

**Incomplete / abandoned work, identified not deleted:** the three `abandoned` experiments
are the Mission 44 overlay defect (§6 of that report); `exp-verification-honesty` has a
baseline commit (`f77c2df`) and no experiment commit. All worktrees, branches and commits
are preserved.

---

## 2. Scheduler reliability (WP02)

### What the environment offers

`systemctl` **absent**, `supervisord` **absent**, PID 1 is `agent37-vm-guest`. There is no
process supervisor in this VM, so a durable unit cannot be installed *here* — that is the
environmental blocker, and it is why the deliverable is a unit file plus a demonstrated
restart procedure rather than an enabled service.

### What was added to the existing scheduler (no second scheduler)

| Concern | Implementation |
|---|---|
| Single instance | `acquireLock()` — `.lelu-lab/state/scheduler.lock` created with `wx` (atomic); a live holder refuses the start with **exit 3** |
| Stale lock takeover | the file is a claim, `kill(pid,0)` is evidence: a dead pid's lock is taken over, so a crash never needs a human to delete a file |
| No overlapping cycles | `withCycleLock()` on `.lelu-lab/state/cycle.lock`; both the daemon loop and the interface's "Run one cycle now" take it, so they cannot interleave |
| Crash recovery | on start, a heartbeat whose pid is dead is recorded as `scheduler-recovered` in the journal and surfaced in `lastError` |
| Graceful shutdown | SIGTERM/SIGINT close the heartbeat, release both locks — `[lab-scheduler] SIGTERM — heartbeat closed, lock released` |
| Heartbeat expiry | `heartbeatStale()`: not running ≠ stale; running with a dead pid *or* no cycle for >2 intervals is stale, and `/api/lab/scheduler` reports `stale` + `staleReason` |
| Logs | `.lelu-lab/state/scheduler.log` (appended by the daemon and by the API when it spawns it) |
| Bounded demo runs | `--max-cycles N` (used for restart testing) |

### Demonstrated in an isolated repository (`/tmp/tmp.wd0uhVL4W2`, no remote)

```
TMP=/tmp/tmp.wd0uhVL4W2
--- daemon 1 ---            (interval 1000 ms)
[lab-scheduler] discovery disc-mwx6nydz-912f33 findings=1 priority=11 status=already-known
--- second instance ---
[lab-scheduler] refusing to start — already held by pid 29187      → SECOND_EXIT=3
lock: {"pid":29187,...}
--- kill -9 (crash) → restart ---
[lab-scheduler] recovered from pid 29187 that did not shut down cleanly
journal: scheduler-recovered 29187
--- graceful stop ---
[lab-scheduler] SIGTERM — heartbeat closed, lock released
ls .lelu-lab/state/ → discoveries.json journal.jsonl scheduler.json sync.json   (no lock file)
```

Real instance in the project: pid **29844**, `running: true`, `stale: false`, cycles 3,
next run +6 h, lock held by 29844.

Acceptance: one instance ✅ · real cycle ✅ · heartbeat ✅ · no overlap ✅ · failure and
recovery recorded ✅ · restart demonstrated ✅ (isolated repo).

### Service configuration (present, **not installed**)

`deploy/lelu-lab-scheduler.service` — `Type=simple`, `Restart=on-failure`,
`RestartSec=30`, `KillSignal=SIGTERM`, `StartLimitBurst=5`, logs appended to the
laboratory's log. Install procedure is in the file header. Enabling it changes the host and
needs the operator's explicit authorization; on this VM it could not be enabled anyway (no
systemd).

---

## 3. The eight tools through real execution (WP03)

### Real conversation: attempted, blocked at the model layer

The chat was opened in a real browser and asked, in the conversation:

> **What did you discover today?**

LÉLU answered:

> "I'm in offline mode right now — all AI providers are unreachable or unconfigured, so I
> can't generate new answers. My local memory, your profile and our shared history are still
> here…" — with **"🧠 Thinking it through · no tools used"** above it.

The render shows **`no tools used`**. So: the UI, the transport, the model and the response
path are live; **no provider is configured in this environment**, which means *model-side
tool selection* could not be exercised. Reporting this as a verified conversation would be a
lie, so it is reported as **blocked**, with the transcript above as the evidence.

### The rest of the path, executed for real — not stubbed

Nine dispatches through **`dispatchToolCall()`** (the real BY_ID table, registry, gate,
ledger and events) against the **real running server** on `:3001`. The only thing supplied
is the base URL: the tools run in a browser where `/api/lab/*` is same-origin.

```
tools offered to a model: 72
laboratory tools offered: ["lab_repository","lab_discoveries","lab_diff","lab_verification",
                           "lab_experiment","lab_preview","lab_file","lab_history"]

▸ What did you discover today?            lab.discoveries  ok=true  284ms   66 chars
▸ Repository branch and latest changes?   lab.repository   ok=true  237ms  757 chars
▸ Exact diff from the last experiment?    lab.diff         ok=true  100ms 3277 chars
▸ Where did this implementation originate? lab.file(genealogy) ok=true 47ms 469 chars
▸ What was the original implementation?   lab.file(read)    ok=true    2ms  467 chars
▸ Run verification on this experiment.    lab.verification  ok=true    1ms  147 chars
▸ Show me the experiment preview.         lab.preview       ok=true    2ms  112 chars
▸ Continue that experiment.               lab.experiment    ok=true    1ms  796 chars
▸ Show me your development history.       lab.history       ok=true   12ms  598 chars
```

Full log: `docs/missions/evidence/mission-44-1/tool-execution.log` — **9 ok, 0 failed**,
187 executables in the dispatch table.

### Two real defects this exposed (both fixed)

1. **`/api/lab/discoveries` answered 404 to a POST.** The route only accepted GET while the
   client posts to every route (uniform token handling). A real tool call failed with
   `refused (HTTP 404)`. Reads now accept both methods; nothing is written.
2. **The client never obtained its session token.** `post()` attached `x-lelu-lab` only if
   `status()` had already been called. Any caller that went straight to a tool — a
   conversation, a script, a fresh page — was refused with "reload the workspace". `post()`
   now fetches the token first when it has none.

Both were found by running the real path; neither was visible to the stubbed test.

---

## 4. Visual verification (WP04)

**21 screenshots** — 7 views × 3 viewports — in
`docs/missions/evidence/mission-44-1/`, captured from the running interface over the
preview proxy at 1440×900, 390×844 and 844×390, with the experiment selector set to
`exp-experiment-selector` (8 options listed).

| View | Desktop | Portrait 390×844 | Landscape 844×390 |
|---|---|---|---|
| Repository | ✅ real branch/HEAD/75 heads/tree/commits | ✅ no h-overflow (doc 1107 px) | ⚠️ covered by chat window |
| Editor | ✅ real source + save/commit | ✅ (1053 px) | ⚠️ |
| Diff | ✅ baseline→commit, +32/−2 patch | ✅ (1756 px) | ⚠️ |
| Timeline | ✅ journal entries | ✅ (1038 px) | ⚠️ |
| Research | ✅ priority/status/findings | ✅ (2867 px) | ⚠️ |
| Preview | ✅ experiment :3002 + 3 viewports | ✅ (3455 px) | ⚠️ |
| Verification | ✅ commands, exit codes, history | ✅ (1194 px) | ⚠️ |

Measured at 1440×900: horizontal overflow **0** in every view; occlusion of interactive
controls (hit-testing each control's centre with `elementFromPoint`) was **0–6 of 32**,
localised to the companion's right-hand rest area — the Repository header buttons, Editor
save, one Diff control and one Verification control sit under her. Header/table controls
were not reported, so the earlier "quietly broken" concern is not what remains.

### The landscape finding — reported, not hidden

At **844×390 with the chat window open, 100 % of the laboratory's visible controls
(20/20) are covered by that chat window**: the window manager puts the most recently used
window on top, and at 390 px height the chat fills the screen. Closing it is the user's
action; the laboratory cannot raise itself above another window without a change to the
window authority, which is outside this mission's scope. **The landscape captures therefore
show the laboratory behind the chat window, and landscape usability of the laboratory is
reported as UNVERIFIED.**

### Capture limitations, precisely

- `Target crashed` (Chromium renderer) three times on this scene — the 3D Cosmos view plus
  the panel; each successful batch was a fresh tab with short waits.
- `browserType.connectOverCDP: Timeout 10000ms` twice; recovered by closing and re-opening
  the tab.
- Consequence: no interaction-by-interaction walkthrough (scrolling each view to its end,
  pressing every control) was completed. What is verified is: each view mounts with real
  data, renders at three viewports without horizontal overflow, and its controls are
  hit-testable in desktop and portrait.

---

## 5. One complete engineering loop (WP05)

Finding (from the laboratory's own inspection, not invented for the test): **the workspace
always bound itself to `experiments[0]` and offered no way to choose another**, so with seven
experiments the Editor, Diff and Preview inspected a different experiment than the one just
verified.

| Step | Evidence |
|---|---|
| 1. Sync | `sync ok=true commit=543da7c remoteHeads=75` |
| 2–3. Finding + evidence | `disc-mwx6ohz4-c501c4`; code: `const first = next.experiments[0] ?? null` — no selector anywhere |
| 4. Research | repository-only: the refresh path (`refreshExperiment`) reloads one id; the header lists nothing |
| 5–6. Worktree + baseline | `exp-experiment-selector`, branch `lelu-lab/exp-experiment-selector`, base `543da7c`, **baseline `f4f042d`** |
| 7. Modification | 2 exact patches (newest-experiment default; an experiment `<select>` with status + commit) |
| 8. Diff | `GenesisSelfDevelopmentLab.tsx` **+32 / −2**, patch shown in the UI |
| 9–10. Verification | `tsc -b --force` **exit 0, 28.4 s** (recorded in the experiment) |
| 11. Commit | **`5ff4a33`** on the experiment branch |
| 12. Preview | **live on :3002**, pid 30298 — the experiment's own worktree, not the canonical app |
| 13–14. Journal + reconciliation | `experiment-created → patch → command → commit → preview-started → concluded verified` in `journal.jsonl` |
| 15. Canonical protected | canonical HEAD still `543da7c`; the change is applied to the working tree only, uncommitted, exactly as Mission 43/44 did |

---

## 6. Self-awareness and history (WP06)

- `CapabilityEvidence["self-development"]` names the laboratory's implementation and tests;
  `["work-queue"]` names its new suite. Both asserted to exist by
  `tests/self-awareness.test.ts`.
- `SelfAwareness.assess()` is exercised by that suite (passing), so implementation + named
  check ⇒ operational; everything else stays partial/unverified.
- Lifecycle states are distinguishable in the data: `open` → `verified` / `abandoned` on
  experiments, `open` / `already-known` / `resolved` on discoveries, `verified` only when a
  recorded check passed.
- **Honest gap:** `LabJournalBridge` (laboratory journal → `DevelopmentJournal`) exists and
  is unit-covered by types/composition, but it was **not executed in a live browser
  session** in this mission (the browser sessions that survived were spent on capture). The
  laboratory's own `.lelu-lab/state/journal.jsonl` does contain the full record above.

---

## 7. Verification totals (WP07)

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npm run build` | **exit 0** — `✓ built in 5.61s` (two pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warnings) |
| `npm test` (full) | **2 324 tests · 2 316 pass · 0 fail · 8 skipped · 31 suites · 231.5 s · exit 0** |
| `tests/lab-scheduler.test.ts` | **16/16** (adds lock, stale-lock takeover, cycle-overlap, heartbeat-expiry) |
| `tests/lab-chat-tools.test.ts` | 6/6 |
| Real tool dispatches | **9/9 ok** (log on disk) |

---

## 8. Exact state and remaining limitations

- Branch `freebuff/08af6cc9ef212913e6b7209b`, HEAD `543da7c`, **nothing committed on it**;
  8 experiment branches (`exp-experiment-selector` @ `5ff4a33` added), 9 worktrees.
- Daemon pid 29844 alive with the lock; preview on :3002 alive.
- **Nothing pushed, merged, deployed. No service installed.**

Remaining, stated plainly:

1. **No provider configured** ⇒ model-side tool selection unverified (§3). With a provider
   key set in settings, the eight tools are offered (`lab_*`, 72 tools total) and the
   executors are proven; what remains untested is the model choosing them.
2. **systemd/supervisor absent** ⇒ the unit is written and the restart procedure is
   demonstrated in an isolated repo, but no supervised service runs on this host.
3. **Landscape laboratory view is covered by the chat window** ⇒ unverified; the desktop
   and portrait layouts are verified.
4. **Renderer crashes** truncated the interaction walkthrough (§4).
5. **`LabJournalBridge` not run live** (§6).
6. Desktop occlusion: the companion still covers a few header controls (0–6 of 32 per view).
