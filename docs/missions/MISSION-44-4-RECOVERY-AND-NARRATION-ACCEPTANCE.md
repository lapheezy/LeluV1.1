# MISSION 44.4 — OPERATIONAL RECOVERY AND NARRATION ACCEPTANCE

Date: 2026-11-27 · Branch `mission/44-4-recovery-acceptance` · Evidence: `docs/missions/evidence/mission-44-4/`
Continues from Mission 44.3 (`mission/44-3-operational-reliability`, HEAD `adaa97a`).

---

## 1. Starting state (verified, not assumed)

| Fact | Verified value |
|---|---|
| Branch at start | `mission/44-3-operational-reliability` |
| HEAD at start | `adaa97a` — "Record the Mission 44.3 checkpoint and final commit in its report" |
| 44.3 report | `docs/missions/MISSION-44-3-OPERATIONAL-RELIABILITY.md` — intact |
| 44.3 evidence | `docs/missions/evidence/mission-44-3/` — 7 files intact (incl. 2 PNGs, verification log) |
| Working tree | clean apart from the deliberate untracked `pw-probe.mjs` |
| Worktrees | 9 (canonical + 8 `lelu-lab/exp-*`) |
| Dev server | `0.0.0.0:3001` (restarted twice this mission to load plugin changes) |
| Scheduler | pid 29844, **pre-fix code**, 3 cycles, **60,555 s (16.8 h) past its own `nextAt`** |
| Git identity | repo-local `Codebuff <noreply@codebuff.com>` (unchanged from 44.3) |

Isolation: `git checkout -b mission/44-4-recovery-acceptance` from `adaa97a`. No reset, clean,
stash, rebase or branch deletion at any point. Nothing was pushed, merged or deployed.

## 2. WP01 — Clean-conversation narration acceptance

Full evidence: [`evidence/mission-44-4/narration-acceptance.md`](evidence/mission-44-4/narration-acceptance.md).

A genuinely new conversation (Universe → **New chat**, composer target `New chat`, empty thread)
was asked five kinds of laboratory question. **This found a live defect before it tested narration:**

**`lab.history`, `lab.experiment` and every other POST were refused 403 "Cross-origin laboratory
requests are not permitted"** while GETs succeeded. Cause: `plugins/labApi.ts` compared
`Origin`'s host with `Host` only, and the preview proxy forwards with `Host: 127.0.0.1:3001`.
A GET omits `Origin` and passed; every action carried it and failed. **Fix:** the broker's three
already-proven rules — `Sec-Fetch-Site: same-origin`, the `LELU_LAB_ALLOWED_ORIGINS` allowlist,
then host equality **including `X-Forwarded-Host`**. Live after the fix: the page's own origin
reaches validation (400 on a deliberately malformed action), `https://evil.example` still 403.
New regression tests cover all three outcomes.

Narration results after the fix:

- **Experiment history — accepted, complete and grounded.** Eight experiments with ids, statuses,
  base commit `543da7c` and commit hashes, field-for-field equal to `git worktree list`, followed by
  an explicit "What the record does NOT contain" section that quotes the tool's own `LIMITS` note.
  No "3 zones / 1 hub / 3 links" anywhere.
- **Journal — honest partial.** The turn reported exactly which tools ran and which failed
  (`2 succeeded / 3 failed`) and that it could not finish, rather than inventing a summary.
- **Repository/commit/scheduler — tool card only.** `lab.repository` returned the true branch
  (`mission/44-4-recovery-acceptance`), HEAD (`adaa97a`) and subject; the prose reply did not arrive.
- **Scheduler question — honest partial.** Groq "returned no usable content"; the app listed the
  steps that ran and refused to claim more.
- `SOURCE:`/`LIMITS:` were confirmed **inside the model request body** (captured trace), so the
  provenance rides the existing tool role, not a second store.
- Laboratory questions reached the **real model**: no canned spatial composition appeared in any
  fresh turn (44.3's `LAB_RECORD` guard holds).

**Not claimed:** that every laboratory question now produces a complete answer. It does not, and the
reason is provider behaviour, not invention (see WP05 limitations).

## 3. WP02 — Scheduler recovery

Full evidence: [`evidence/mission-44-4/scheduler-recovery.md`](evidence/mission-44-4/scheduler-recovery.md).

The systemd unit from 44.3 was inspected and **two real configuration defects were fixed**:
`StartLimitIntervalSec`/`StartLimitBurst` sat in `[Service]` where systemd ≥229 ignores them (moved
to `[Unit]`); the unit had no `PATH`, although `ExecStart` is `/usr/bin/env npx tsx` (added
`Environment=PATH=/usr/local/bin:/usr/bin:/bin`). `Restart=on-failure` became `Restart=always`
with `RestartPreventExitStatus=3`, so the daemon is restarted after any exit except its deliberate
"lock already held" refusal. Environment loading was verified by reading the code: the scheduler
needs **no credential** and loads no `.env.local`.

Tested on the real process:

| Test | Result |
|---|---|
| SIGTERM the pre-fix daemon (29844) | heartbeat closed (`running:false`, `pid:null`), lock released, process gone |
| second instance while one runs | refused, **exit 3**, "already held by pid 16822" |
| 3 cycles at a 10 s interval | 3 real cycles, one per slice, ~410–470 ms each, clean exit, lock released |
| `kill -9` then restart | heartbeat still claimed `running:true` with a dead pid; restart logged `recovered from pid 17085 … did not shut down cleanly` and journaled `scheduler-recovered` |
| real daemon left running | pid 17250, `intervalMs 21600000`, cycles 9, `nextAt` 6 h away |

**Reboot recovery is NOT verified** — this VM has no init system (`systemctl`, `supervisord`, `s6`,
`pm2`, `launchctl`, `docker` all absent; PID 1 `agent37-vm-guest`). No production-supervision claim
is made.

## 4. WP03 — Provider-state accuracy

Full evidence: [`evidence/mission-44-4/provider-states.md`](evidence/mission-44-4/provider-states.md).

The 44.3 gap is closed. Provider state now separates three facts:

- **configured** — we hold a credential (`state !== UNCONFIGURED`), never a capability claim;
- **reachable** — the new `reachable` field: `true` when the provider answered (any HTTP status,
  including 404), `false` only when no HTTP response arrived. Previously a transport failure wrote
  **no evidence at all**, leaving an unreachable provider labelled `CONFIGURED`;
- **completed** — `COMPLETION_VERIFIED` with `httpStatus` and timestamp.

New state **`MODEL_UNAVAILABLE`** for a model-level 404, transient like a quota refusal. Live:
Groq with a bogus model → 404 → `{"state":"MODEL_UNAVAILABLE","httpStatus":404,"reachable":true,
"note":"type=invalid_request_error | code=model_not_found | …"}`. Groq and OpenRouter both completed
200 → `COMPLETION_VERIFIED`, `reachable:true`. Unknown models on OpenRouter are stopped by the
spending policy (402) **before** any provider call, and no state is invented from that.

`tests/broker-contract.test.ts` 11/11: unavailable model, exhausted quota, authentication failure,
transport failure, successful completion, never-contacted, and no credential in any response.

## 5. WP04 — Landscape navigation

Full evidence: [`evidence/mission-44-4/landscape-measurements.md`](evidence/mission-44-4/landscape-measurements.md).
Screenshots: `landscape-844x390-universe.png` (844×390), `portrait-390x844-universe.png` (390×844).

The 44.3 count ("13 of 58 reachable") is now explained, and one part of it was a **real defect**:

- At **844×390** the Universe's `.lcu-main` rendered **583 px tall inside a 390 px viewport** — the
  dialog was taller than the screen it owns, so its own footer (universal composer, `Send`, quick
  dock, `N windows — minimize`) was **off-screen**, not merely covered.
- The rest of the unreachable controls are the Universe regions under an **open chat-window sheet**
  (rail, timeline, filters, cards, dock). That is the phone design: the window owns the screen and
  brings its own composer and close. Intentional, and reported as such.

Fix (CSS only, no redesign): `.lcu { max-height: 100dvh; overflow: hidden }` and a sticky
`.lcu-head`, so the dialog can never exceed the viewport and the only way out cannot scroll away.
After: `.lcu` 390, `main` 390 with scrollHeight 599 (it scrolls), `Close` reachable, window `Send`
at y 337–375 inside the viewport. At **390×844**: `.lcu` 844, composer at 787–829 in the viewport,
`Close` reachable. Conversation state and open-window state were untouched.

## 6. WP05 — Verification

`evidence/mission-44-4/verification.log` — run on the committed tree:

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npm run build` | **exit 0** (6.82 s) |
| Full suite | **2,343 tests / 2,335 pass / 0 fail / 8 skipped / 34 suites**, 236.4 s |
| Focused: `broker-contract` | 11/11 |
| Focused: `self-development-lab` | 16/16 |

The 8 new tests are regression guards for defects this mission measured: five provider-state cases
(model 404, transport failure, completion, quota, never-contacted) and three origin cases
(proxy-rewritten host, same-origin account, cross-site refusal).

## 7. Limitations — what is not verified

1. **Reboot recovery is not verified.** No init system exists in this VM; the unit cannot be
   installed or restart-tested here.
2. **Free-tier multi-tool turns are unreliable.** OpenRouter's free reasoning model is killed by the
   page's 12 s per-rung budget; Groq returned "no usable content" on the tool-catalogue turn. The app
   degrades to an honest, itemised partial — it does not invent — but not every laboratory question
   gets a complete answer. The budgets were **not** changed on this evidence.
3. **Emulation, not physical devices.** All browser evidence is Playwright with a software
   rasteriser; no real phone or GPU was used, and touch target sizes were not measured.
4. **Two-module-window landscape case** is still proven by geometry tests, not pixels.
5. **`MODEL_UNAVAILABLE` is coarse:** a 404 caused by a bad route would be labelled the same as a
   model refusal (bounded by the broker's fixed upstream paths).
6. **Narration grounding is a discouragement, not a validator** (unchanged from 44.3).

## 8. Branch, commit, working tree

- Branch: `mission/44-4-recovery-acceptance` (created from `adaa97a`; 44.3 branch untouched)
- Files changed: `plugins/modelApi.ts`, `plugins/labApi.ts`, `deploy/lelu-lab-scheduler.service`,
  `src/app/scene/genesis/chat/universe/chatUniverse.css`, `tests/broker-contract.test.ts`,
  `tests/self-development-lab.test.ts`, this report and `docs/missions/evidence/mission-44-4/`
- Canonical branch `freebuff/08af6cc9ef212913e6b7209b` unchanged at `543da7c`; the 8 `lelu-lab/exp-*`
  worktrees untouched
- The live dev server now runs the fixed broker and laboratory code; the live scheduler (pid 17250)
  runs the fixed scheduling code
- **Nothing pushed, merged, deployed or published.**
