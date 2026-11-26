# MISSION 44.3 — OPERATIONAL RECOVERY, RENDERER RELIABILITY & EVIDENCE-COMPLETE CHECKPOINT

Date: 2026-11-26 · Branch `mission/44-3-operational-reliability` · Evidence: `docs/missions/evidence/mission-44-3/`

---

## 1. Initial repository state (verified, not assumed)

| Fact | Verified value |
|---|---|
| HEAD | `543da7c8d7876258869d928648cffa913cd10649` — "Replace the 2.1 hair shell with scalp-rooted volumetric locks" (2026-11-19) |
| Canonical branch | `freebuff/08af6cc9ef212913e6b7209b` (clean of new commits) |
| Dirty paths | **54** — 24 modified, 30 untracked (Missions 41–44.2 work + their evidence) |
| Diffstat | 24 files, +1,189 / −453 |
| Worktrees | **9**: the canonical tree + 8 `lelu-lab/exp-*` experiment worktrees |
| Experiment branches | 8, all present (`exp-api-error-status` … `exp-work-queue-check-v2`) |
| Dev server | listening `0.0.0.0:3001`, pid 10864 |
| Mission 44.2 report | `docs/missions/MISSION-44-2-OPERATIONAL-AUTONOMY.md` — intact |
| Mission 44.2 evidence | `docs/missions/evidence/mission-44-2/` — 4 PNGs, manifest, broker trace, verification log |
| Git identity | **none configured** — the first commit attempt failed with "Author identity unknown" |

**Concurrent changes since 44.2:** none in tracked files. The only writes were runtime state the
app itself produced while it ran (`.lelu-state/resources/*`, ignored) and my own report/evidence
files. No user file was modified, moved or deleted at any point in this mission.

**One hazard found in inventory:** `.gitignore` (added in Mission 44) ignores `*.log`, so
`evidence/mission-44-2/verification.log` and `broker-trace.log` were **ignored, not tracked** —
the 44.2 evidence would not have survived a clone. Both are force-added in the checkpoint.

## 2. Recovery and checkpoint procedure

Before changing anything:

1. **Out-of-git backup** of the exact pre-44.3 state, inside the ignored laboratory directory:
   `.lelu-lab/backups/pre-44-3-tracked.patch` (104 KB, every tracked modification) and
   `.lelu-lab/backups/pre-44-3-untracked.tgz` (78 MB, every untracked non-ignored file).
2. **Isolation without risk**: `git checkout -b mission/44-3-operational-reliability` from the
   verified HEAD. Branch creation carries the working tree with it — no reset, no clean, no
   stash, nothing discarded. The canonical branch still points at `543da7c`.
3. **Repo-local identity** set to the identity the repository's own history already uses
   (`Codebuff <noreply@codebuff.com>`) — local config only; the working tree was not touched.
4. **Checkpoint commit `21421e9`** — "Checkpoint the self-development laboratory work before
   Mission 44.3": 95 files, 18,868 insertions, including the 44.2 evidence logs that
   `.gitignore` was hiding. The single scratch file `pw-probe.mjs` (a Playwright probe from an
   earlier mission) was deliberately left untracked and untouched.

Nothing was forced: no `reset --hard`, no `clean`, no `stash`, no branch deletion, no worktree
pruning, no push.

## 3. Renderer root cause and evidence (WP02)

Full measurements: [`evidence/mission-44-3/renderer-measurements.md`](evidence/mission-44-3/renderer-measurements.md).

**What was ruled out by measurement, not by reading code:** synchronous readbacks
(`readPixels` 0, `toDataURL` 0 over 15 s idle), `preserveDrawingBuffer` (only in unmounted studio
pipeline code), the v1 world canvas (never cleared — correctly `frameloop="never"`), the DOM
static-noise canvas (80 ms cadence, ~3.6 ms/call), and the React render ledger (55 consumer
renders/s at the designed 5 publishes/s).

**The actual cause, isolated:**

```
before: long tasks 1265, 1214, 1203, 1171 ms repeated; rAF every 1.2–2 s
        per-canvas clears over 5.6 s = { "325x474": 9 }   ← the avatar only
        drawElements time 0 ms — the cost is CPU-side three.js work
after:  per-canvas clears over 4 s = {} ; long tasks = [53] ms ; evaluate returns instantly
```

The avatar canvas was painting at ~1.6 fps because **each skinned frame cost ~1.1 s on the
software rasteriser**, and `FrameCap` asked for 24 fps: the main thread was never free. The
`SceneRenderManager` contract says `light` means "no continuous WebGL at all", but only the v1
world implemented it — the avatar consulted the *budget* and never the *profile*.

**Fix (existing architecture, no new system):** `paintsContinuousFrames(profile)` in
`SceneRenderManager` (pure, unit-tested). The avatar's `FrameCap` returns early on `light`, and
`GenesisV2Scene3D` (206,700 triangles, 146 draw calls) now derives its frameloop from the
profile exactly as `GenesisScene` does, keeping the dev-only `?perf-world` measurement escape.
No 3D was disabled: on `light` both surfaces keep their canvas, model and last frame and simply
stop asking for new ones, which is what the profile already promised.

**Same-workload proof:** under the fix, `preview_playwright` — which failed every attempt in
44.2 with `connectOverCDP: Timeout 10000ms` — connected immediately, and a real chat turn
completed question → model → laboratory tools → answer in **7.2 s**.

**Honest limits:** this is browser emulation with no GPU. rAF deltas after the fix are still
367–767 ms (software compositor); the main thread is free, the frame rate is not high.

## 4. Narration grounding (WP03)

Full evidence: [`evidence/mission-44-3/narration-check.md`](evidence/mission-44-3/narration-check.md).

Every successful laboratory result now carries its own provenance, appended by the tool on the
existing dispatch path (`PROVENANCE` + `withProvenance` in `LabTools.ts`): `SOURCE:` (which
store, which read, when) and `LIMITS:` (what the result cannot support). For `lab.history` that
limit is explicit: *"These are recorded kinds, ids, titles and timestamps. What an entry did, how
many objects it built … are NOT in the record; if a detail is not on these lines, say the record
does not contain it."*

- Failed results are returned **untouched** — a refusal must not be dressed up as evidence.
- No second journal, no memory rewrite, no post-hoc claim validator: the footer rides the
  existing `role: "tool"` content.

Live result: *"Using your laboratory tools, report the repository HEAD and the scheduler cycle
count"* → commit `21421e9`, branch `mission/44-3-operational-reliability`, scheduler running
(PID 29844), 3 cycles — every field present in the payload (44.2 guessed the branch; it is now
right). The adversarial turn (`exp-does-not-exist`) still refuses honestly (`lab.diff` 1 run /
0 success, no invented diff).

**A second defect was found by testing the fix adversarially, live.** Asking
*"From your laboratory journal, what exactly did the last experiment build?"* produced the canned
spatial reply ("Prepared: Build 4 objects — 3 zones, 1 hub, 3 links") with **no model call**:
"build" is a build verb and the sentence said "laboratory", so the intent router claimed it. That
canned sentence is exactly the text that contaminated the 44.2 journal summary — the drift was
downstream of a routing defect that 44.2's narrower guard did not close.

**Fix:** `LAB_RECORD` in `isCompositionRequest` — a sentence naming a journal, record,
experiment, discovery, finding, repository, commit, branch, scheduler, typecheck or diff is a
question about records, whatever verb it uses. "build a laboratory with three research zones"
is still geometry (control case pinned). `tests/spatial-chat.test.ts` 12/12.

Residual: "next scheduled run is imminent" is an interpretation of a timestamp, not a quoted
field — recorded as a known limit rather than hidden.

## 5. Scheduler lifecycle and supervision (WP04)

Measured live:

```
{"running": true, "pid": 29844, "cycles": 3, "intervalMs": 21600000, "failures": 0,
 "lastCycleAt": 1795675249409, "lastError": null, "stale": false, "mode": "daemon"}
lock: .lelu-lab/state/scheduler.lock {"pid":29844,"at":1795675248990}
proc: alive, /proc/29844 present, scheduler.log shows cycle 3 ending "discovery … 419ms"
```

**A real defect, found by measurement:** at 13:19 UTC the daemon was **2,318 s (39 min) past its
own recorded `nextAt`** with no cycle run and no error — while `stale` read `false`, because the
staleness rule only fires at `max(2×interval, interval+10 min)` = 12 h. Its recorded `startedAt`
was 6 h 40 m old while process uptime read 1 h 45 m: exactly what a suspended VM or a clock jump
produces against a single long `setTimeout`.

**Fix:** the daemon no longer sleeps one 6 h timer. `waitSliceMs` / `waitUntil` re-derive "is a
cycle due?" from the clock in ≤60 s slices (`SCHEDULER_WAIT_SLICE_MS`), so any pause, suspend or
clock jump is recovered within one slice. Pure helpers, unit-tested; the running process keeps
the old code until restarted (deliberately not restarted — that would be an unrequested change
to a live process).

Already proven in isolation (Mission 44.1, unchanged): duplicate instance refused (`exit 3`,
"already held by pid"), `kill -9` recovered with the lock released, SIGTERM releases cleanly, a
failed cycle writes `scheduler-failure` with its error and backs off.

**Supervision — reported truthfully:** this VM has none. `systemctl`, `supervisord`, `s6-svscan`,
`runsvdir`, `pm2`, `launchctl`, `docker` are all absent; PID 1 is `agent37-vm-guest`. The
systemd unit `deploy/lelu-lab-scheduler.service` exists for a host that has systemd and **cannot
be installed or restart-tested here** — reboot recovery is **not verified** and no
production-supervision claim is made.

## 6. Broker security and provider states (WP05)

Measured against the live server (`127.0.0.1:3001`), no key ever printed:

| Case | Result |
|---|---|
| `Origin: https://evil.example`, `Sec-Fetch-Site: cross-site` | **403** `Cross-origin broker requests are refused.` |
| `Sec-Fetch-Site: same-origin` through the proxy (`Host` ≠ `Origin`) | passes → **200**, real Groq completion in **0.240 s** |
| Origin in `LELU_BROKER_ALLOWED_ORIGINS` | passes (reaches payload validation) |
| `Origin` matching `X-Forwarded-Host` | passes |
| No `Origin` at all | passes — noted: a non-browser client is not a cross-site browser |

The origin check is not an authentication bypass: it decides only whether a *browser page* may
use the broker, and every accepted request still needs a configured key to reach a provider.

**States are already distinguished** — `/api/model/status`:
`UNCONFIGURED` (no key), `CONFIGURED`, `COMPLETION_VERIFIED` (with `httpStatus` and timestamp),
plus per-provider health and `failureKind` (`provider-timeout` / `network-failure` /
`provider-unavailable`) on a failed chain, and the explicit offline switch
(`ModelRouter.isOfflineMode()`). Current truth: Groq `COMPLETION_VERIFIED`; OpenRouter
`CONFIGURED` but its free model returned `404 — this model is unavailable for free` (and 44.2
measured a daily `429`); the rest `UNCONFIGURED`.

Gap recorded, not papered over: a model-level 404 did not change the provider's state from
`CONFIGURED`. That is a *provider is reachable, this model is not* distinction the state machine
does not yet carry.

## 7. Landscape at 844×390 (WP06)

Real browser, Playwright, viewport set to **844×390**, page reloaded at that size:
`evidence/mission-44-3/landscape-844x390-home.png` and `…-chat.png`, plus measurements.

- Composer: `textarea` at y=333, h=42, **usable = true** (hit-test lands on the composer).
- Chat window ends above the viewport bottom (see screenshot): the send button and the strip
  below it are visible, so the top surface does not own the whole height.
- Spatial objects (the Core and its seven orbit nodes) remain visible and reachable at this size.
- The full-screen **Chat Universe** overlay is a mode, not a window: with it open only 13 of 58
  in-viewport buttons are hit-testable, because it deliberately covers the chrome beneath. That
  is by design, and it is reported rather than counted as a pass.

The module-window invariant itself (`landscapeReflow`: only the topmost window, only on short
viewports, only when ≥2 windows are visible, bounded to 65 % and docked to the bottom edge) is
covered by `tests/module-layout.test.ts` (37/37 in the affected-suite run). **Not reproduced in
the browser:** a two-module-window arrangement at 844×390 (the compact layout opens the chat as a
sheet). Geometry is proven by test, pixels only for the one-window case.

## 8. Verification (WP07)

`evidence/mission-44-3/verification.log` — `tsc -b --force`, `npm run build`, `npm test`:

| Check | Mission 44.2 | Mission 44.3 |
|---|---|---|
| `tsc -b --force` | exit 0 | exit 0 |
| `npm run build` | exit 0 (5.20 s) | exit 0 |
| Full suite | 2,329 tests / 2,321 pass / 0 fail / 8 skip | **2,335 tests / 2,327 pass / 0 fail / 8 skip / 33 suites, exit 0** |

Affected suites re-run after the last edit: `lab-scheduler`, `render-manager`, `lab-chat-tools`,
`module-layout`, `spatial-chat` → **73/73 pass**, including the new grounding, renderer-profile
and scheduler-slice tests.

Every one of the six new tests is a regression guard for a defect this mission measured:
`paintsContinuousFrames` (renderer), the v2 profile gate, three laboratory provenance checks,
the scheduler wait-slice, and the four record-shaped prompts that used to reach the spatial
builder (+1 control case).

Two earlier full runs were stopped and are **not** used: `verification-interim.log` (started
before the scheduler fix) and `verification-run2.log` (2,334 / 2,326 / 0 — true for its code, but
it predates the final router and system-prompt changes). The numbers above are from the run on
the exact tree that is committed.

## 9. Remaining limitations

1. **No supervisor in this VM** — the systemd unit is ready but uninstallable here; reboot
   recovery is not verified.
2. **Physical devices untested** — all rendering evidence is browser emulation with a software
   rasteriser; a real GPU never takes the `light` path.
3. **Landscape two-window case** — proven by geometry tests, not by pixels.
4. **`CONFIGURED` vs "this model is unavailable"** — the provider state machine does not yet
   carry the model-level distinction.
5. **The running scheduler** still executes the pre-fix binary; the sliced-wait fix takes effect
   on its next start.
6. Narration grounding discourages invention and marks its sources; it is not a validator.

## 10. Branch, commit, working tree

- Branch: `mission/44-3-operational-reliability`
- Checkpoint commit: **`21421e9`** — "Checkpoint the self-development laboratory work before Mission 44.3" (95 files, preserves all of 44.2)
- Final commit: **`db9901b`** — "Stop the avatar from painting a CPU rasteriser to death, and keep her claims sourced" (17 files: the renderer fix, the lab provenance, the scheduler wake-up, the router record guard, the system-prompt evidence rule, 6 new tests, this report and the evidence)
- Working tree at the end: one untracked scratch file (`pw-probe.mjs`, a Playwright probe from an earlier mission), deliberately left untouched; the two discarded verification logs remain on disk and out of git
- Canonical branch `freebuff/08af6cc9ef212913e6b7209b` is **unchanged** at `543da7c`; the 8 `lelu-lab/exp-*` worktrees and branches are untouched
- Nothing pushed, merged, deployed or published; no production surface touched. No push was attempted, so the branch exists locally only.
