# MISSION 44.7 — CONVERSATIONAL RELIABILITY CLOSURE & CROSS-SYSTEM CLAIM INTEGRITY

Date: 2026-11-27 · Branch `mission/44-7-claim-integrity` (from `9251a80`)
Evidence: `docs/missions/evidence/mission-44-7/` · Previous: `MISSION-44-6-CONVERSATIONAL-RESILIENCE.md`

Mission 44.6 fixed three defects and proved one conversational path on a phone-sized page. This
mission set out to close the gaps it left open — claim grounding outside the laboratory, the
interrupted-turn notice actually rendering, provider failure under real conditions, persistence
across a killed process, layout acceptance — and to fix what the browser showed that unit tests
could not.

---

## 1. Starting state (verified before any change)

| Fact | Value |
|---|---|
| Starting branch | `mission/44-6-conversational-resilience` |
| HEAD at start | `9251a80` ("Name the Mission 44.6 delivery commit in its report") |
| Remote agreement | `git ls-remote origin` reported `9251a80` for that branch — **identical** |
| 44.6 delivery | `313168b` present in history (21 files, +862/−7), report + `evidence/mission-44-6/` on the remote |
| Working tree | clean except the deliberate untracked `pw-probe.mjs` (a 10-line Playwright probe, never committed) |
| Untracked / unprotected work | none besides that probe |
| 44.5 / 44.4 / canonical | `fd9169d` / `77ead33` / `543da7c` — untouched |
| Dev server | restarted this mission on `0.0.0.0:3001`; preview host allowlisted explicitly |
| Credentials | present in `.env.local`; never read, printed or recorded |

`mission/44-4-recovery-acceptance` (`77ead33`) has **no remote branch of its own**; its commits are
ancestors of `9251a80`, so the work is on GitHub through the 44.5/44.6 lineage. Nothing was merged,
deployed or published. No paid provider, no Anthropic, no LangChain/LangGraph.

WP00 was completed first: 44.6 verified on the remote, the new branch created from `9251a80` and
pushed before any implementation began.

## 2. Baseline (recorded, not assumed)

`docs/missions/evidence/mission-44-7/baseline-test.log` — the manifest exactly as it was at the
start of this mission:

| Tests | Pass | Fail | Skipped | Suites | Duration |
|---|---|---|---|---|---|
| **2,372** | **2,364** | **0** | **8** | **34** | 239.4 s |

This matches the historical figure in 44.6 to the test. The numbers below are compared against
this run, not against the report.

## 3. What was found

### D1 — Five of the laboratory rule's eight tools do not exist (44.6 residue, fixed)

Mission 44.6 added the laboratory family to `ClaimGrounding` with the names `lab_repository`,
`lab_status`, `lab_tree`, `lab_journal`, `lab_history`, `lab_experiment`, `lab_cycle`,
`lab_execute`. The registry declares `lab.repository`, `lab.discoveries`, `lab.diff`,
`lab.verification`, `lab.experiment`, `lab.preview`, `lab.file`, `lab.history` — so **three** of
the eight names were real, and five were invented.

Consequences: a real `lab.repository` run did back its own claim (the one name that matched), but
`lab.verification`, `lab.diff`, `lab.file` and `lab.discoveries` could never back a claim, and the
user-visible correction could print tool names no part of the system has. This is the exact class
of defect the mission exists to remove, in the fix for it.

### D2 — "Try again" typed the question a second time (live, fixed)

In the Chat Universe window, on the 390x844-class page: seed a conversation whose last message is
an unanswered user question, reload, open the conversation (the notice renders correctly), press
**Try again**. The stored history afterwards was:

```
user:  Using your laboratory tools: which branch is checked out right now?
user:  Using your laboratory tools: which branch is checked out right now?
assistant: mission/44-7-claim-integrity
```

One send event, two model round-trips (tool decision + answer) — so the *turn* was not duplicated,
but the *question* was. Cause: the notice dispatches the normal send path, and the send path always
appends a new user message unless it is answering a queued follow-up.

### D3 — A rate-limited provider chain was reported as an outage (live, fixed)

Injecting `429` on every `/api/model/*` call in the browser produced, for the user:

> I'm in offline mode right now — all AI providers are unreachable or unconfigured, so I can't
> generate new answers…

Two providers were reached and both answered — with a rate limit. `classifyProviderError` had no
capacity class, so `429` fell through to `provider-unavailable`, and the offline notice treated it
as an outage. A wait was described as a failure of configuration.

### D4 — The cleared `processing` flag was never written back (live, fixed)

A real reload during generation (every model call held open, reload 1.8 s later) left the page
correctly showing the interrupted-turn notice — while the workspace in storage still said
`processing: true` ten seconds later. `MultiChatStore.readAll()` corrected the flag in its own
cache and never marked the store dirty, so the correction lived only in memory until some
unrelated write happened to replace it. Any other reader of the workspace (a second tab, a
restored session) would see a turn in flight that does not exist, which is the same class of
mislabelled state as D1 and D3.

### D5 — The classic transcript is not a user-visible surface any more (observed, documented)

`GenesisInterface` renders `<GenesisChat hidden />` with the comment "Send engine only — draws
nothing. The Chat Universe is the chat.", and `GenesisChat` starts with `if (hidden) return null;`.
The interrupted-turn notice added to `GenesisChat` in 44.6 is therefore **unreachable in this
build**. It is correct code and is kept (it would work if the surface were re-enabled), but WP03's
"classic chat" half cannot be visually accepted, and this report does not claim it was.

## 4. What changed

| File | Change |
|---|---|
| `src/core/tools/ClaimGrounding.ts` | rule table extended to 20 families; every rule carries a `family`; real laboratory tool ids; `CLAIM_FAMILIES` read-only view; each claim classified `current-turn` / `earlier-turn` / `memory` / `inference` / `unverified`; `earlierRuns` input; `History, not a fresh check` note; freshness correction can state the age of the last real result; `uniqueTools` so a correction names one name per tool |
| `src/core/router/TurnMetrics.ts` | **new** — content-free turn counts (attempts, failures, fallbacks, first-text, total) with a one-line log format |
| `src/core/router/ProviderResolver.ts` | this-turn grounding uses tools from every attempt (a failed rung's tools still back a fallback answer), earlier conversation results are passed as history, evidence counts in metadata; turn metrics noted at the events that produce them; rate-limit failure gets its own message |
| `src/core/voice/turnFailure.ts` | `provider-rate-limited` kind (429 / TPM / 503 / overloaded), chain precedence, and the voice-side message |
| `src/core/multichat/interruptedTurn.ts` | `reusableRetryId()` — the stored message a retry should reuse |
| `src/core/multichat/MultiChatStore.ts` | a cleared `processing` flag marks the store dirty and schedules the write, so the correction reaches storage |
| `src/app/scene/genesis/GenesisChat.tsx` | retry reads the store (not the component mirror) and reuses the unanswered message id instead of appending a copy |
| `tests/claim-grounding-families.test.ts` | **new** — 20 family cases + evidence classes + "no rule names a tool the source does not declare" |
| `tests/turn-metrics.test.ts` | **new** — first-text measured once, no delta → no measurement, counts, log line |
| `tests/interrupted-turn.test.ts` | +2 — retry reuses the question; after a visible failure it does not |
| `tests/conversation-state-recovery.test.ts` | +1 — the cleared processing flag is written back, not only held in memory |
| `tests/provider-fallback-cognition.test.ts` | the exhausted-chain notice may now say "rate-limited / out of capacity" (its stub fails with 529) and must still offer a remedy |
| `tests/mission-10-3.test.ts` | the `429 → provider-unavailable` expectation corrected to `provider-rate-limited`, with mixed-chain cases |

## 5. Decisions

1. **Grounding stays one framework.** The families are more `RULES` entries and one evidence
   classifier in `ClaimGrounding`; nothing new competes with it, and `ProviderResolver` remains the
   only caller.
2. **A tool name in a rule is a claim too.** The phantom-name test reads `src/` for declared tool
   ids and fails if a rule mentions one that is not there. That is what makes D1 unrepeatable.
3. **History is labelled, not accused.** A claim backed by an earlier tool result gets
   "History, not a fresh check" (and the age when known); only a claim with nothing behind it gets
   "Not verified". `memory` and `inference` sentences say what they are, so they carry no note —
   they are recorded in the reply metadata instead.
4. **A retry of an unanswered question is that question.** The stored message is reused when it is
   the last thing in the conversation and its text matches. After a visible failure the last
   message is the failure, so the retry stays a new turn and the failure remains readable.
5. **Capacity is not an outage.** `429`/TPM/`503`/overloaded is `provider-rate-limited`, with the
   remedy a person can act on ("give it a minute"), and never the offline notice.
6. **Instrumentation counts what the code observed.** First text is noted in the delta callback,
   attempts where a rung starts, failures where the registry is told, fallbacks where the loop
   moves on. No content, no keys, one log line per turn.

## 6. Verification

`docs/missions/evidence/mission-44-7/final-test.log`:

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npx oxlint` | **0 errors**, 483 warnings repo-wide (pre-existing; the four new/changed core files report **0 warnings**) |
| `npm run build` | **exit 0** (vite 5.68 s, 38 s including `tsc -b`) |
| Full suite | **2,408 tests / 2,400 pass / 0 fail / 8 skipped / 34 suites**, 226.0 s (see §6.1) |
| New this mission | `claim-grounding-families` 28/28, `turn-metrics` 4/4, `interrupted-turn` 6/6, `conversation-state-recovery` 3/3 |
| 44.3/44.4 regressions | `self-development-lab`, `broker-contract` — unchanged and passing |
| 44.5 acceptance | `conversational-recovery`, `conversation-state-recovery`, `provider-rung-budget` — passing |
| 44.6 acceptance | `provider-stream-faults` 8/8, `claim-grounding` 10/10 |

### 6.1 Full suite

Baseline **2,372 / 2,364 / 0 / 8 / 34** → final **2,408 / 2,400 / 0 / 8 / 34** (**+36** tests,
0 failures). Every historical test still runs. Two expectations were edited, both because they
encoded a defect rather than a requirement:

* `mission-10-3`: `classifyProviderError("Groq failed 429…")` asserted `provider-unavailable`;
  a 429 is capacity, and D3 is the cost of that classification. Replacement assertions cover 429,
  503, 500 and mixed chains.
* `provider-fallback-cognition`: the exhausted-chain notice had to match
  /offline|unreachable|unconfigured/; its stub fails with `529 overloaded`, which is now correctly
  reported as capacity. The assertion was widened to accept that wording **and tightened** with a
  new requirement that the notice offers a remedy (`ask again`).

Nothing was weakened, skipped or suppressed to reach green.

## 7. Browser acceptance (Chat Universe, real providers)

Evidence: `docs/missions/evidence/mission-44-7/` (screenshots + the notes below).

| Scenario | Result |
|---|---|
| Seeded unanswered turn, reload, open window | notice **renders**: "That turn stopped before it answered", **Try again** visible — `w03`, `w05` |
| Press Try again (before fix) | **D2** reproduced: question stored twice, one answer |
| Press Try again (after fix) | **1** send event, **2** model round-trips (tool + answer), history = `user, assistant`, answer `mission/44-7-claim-integrity`, `processing: false`, notice cleared |
| Reload during a turn | held model call, reload 1.8 s later: question survives, store `processing` false, notice rendered — `w07` / `w08` |
| Persisted `processing` after that reload | `false` in storage within the coalesced write (D4 fixed); before the fix it stayed `true` for >10 s |
| Live `429` on every model call (before fix) | **D3** reproduced: "unreachable or unconfigured" |
| Live `429` on every model call (after fix) | "Every provider that could answer is rate-limited or out of capacity… Nothing was lost — nothing ran and nothing was sent twice." 2 attempts, 1 user message added, `processing: false` |
| Healthy live turn | answer from OpenRouter, 1 user message, no duplicate |
| Dev-server SIGKILL + restart | `/api/lab/status` **200**, byte size identical, state files **sha256-identical**; only per-process `token` / `startedAt` and live `github` reachability differ |

## 8. Layout acceptance

Real Chromium viewports with iPhone UA, `isMobile`, `hasTouch`, DPR 2 for the phone sizes
(**not** iOS Safari — see §9):

| Viewport | Horizontal overflow | Notice | Try again in viewport | Composer | Target height |
|---|---|---|---|---|---|
| 390 × 844 | none | 356 × 162 at y=262 | yes | y=779, 360 × 50 | 34 px |
| 375 × 812 | none | 341 × 162 at y=262 | yes | y=747, 345 × 50 | 34 px |
| 430 × 932 | none | 396 × 142 at y=262 | yes | y=867, 400 × 50 | 34 px |
| 844 × 390 (landscape) | none | 810 × 117 | yes | y=325, 814 × 50 | 30 px |
| 1440 × 900 (desktop) | none | 928 × 120 | yes | y=829, 932 × 50 | 30 px |

The recovery control measures **30–34 px** high. It is reachable and legible at every size, but it
is below the 44 px touch-target guideline; that is a design-system decision (`lelu-cc-chip`, shared
with every failure chip), not changed here.

## 9. Performance (measured, not estimated)

| Measurement | Value | How |
|---|---|---|
| First visible text, healthy turn | **4.33 s** from Send | polled storage (≈250 ms write granularity) in the live page |
| Turn total, same turn | **4.09 s** | the message's own `activity.startedAt → finishedAt` |
| Provider | OpenRouter, 3 activity steps | persisted activity |
| Rate-limited turn total | **0.96 s** | activity timing of the 429 run |
| Provider attempts | 2 in each injected-429 run | injected-fetch counter |
| Instrumentation overhead | one counter per event, one log line per turn | `TurnMetrics` |

The instrumentation is unit-tested for the one property that matters: time to first text is
measured at the first delta and only once, and no delta yields `null` rather than an estimate.

## 10. Persistence

| What | Survives |
|---|---|
| Browser reload | conversations, ids, messages, partial text already stored; `processing` cleared **and written back**; interrupted turn detected |
| Dev-server restart (twice this mission) | all conversation data (browser-owned), lab state, scheduler record |
| `SIGKILL` of the dev server | `.lelu-lab/state/*.json` sha256-identical; `/api/lab/status` 200, same size |
| Host reboot | **not tested** — this VM has no init system (see §11) |
| Provider interruption | partial answer preserved, no repeated tool execution (44.6 code + unit matrix) |

## 11. Not verified / limitations

1. **No physical iPhone.** "Mobile" is Chromium with an iPhone UA, touch and DPR 2. iOS Safari, the
   on-screen keyboard, `visualViewport` resizes and safe-area insets were not exercised on a device.
2. **No host reboot test.** There is no init system in this VM; the SIGKILL/restart of the dev
   server is the closest available, and it is a process test, not a machine one. Reproduce a real
   reboot with: start the server, write a conversation, `sudo reboot`, then open the page and check
   the conversation and `/api/lab/status`.
3. **Classic chat surface not visually accepted.** It renders nothing in this build (§3 D5); the
   notice there is predicate-tested only.
4. **`npm run verify:persistence` cannot run here** — its Playwright launcher expects
   `/opt/pw-browsers/chromium`, which this cloud VM does not have. The persistence evidence above
   was produced directly instead (HTTP + sha256 + SIGKILL).
5. **Keyboard/`visualViewport` behaviour** was not tested; it needs a real device or a browser that
   raises a software keyboard.
6. **A live stale-claim turn** was not produced on demand (it needs a model to volunteer the wrong
   sentence); the correction is covered by the family/evidence tests and by 44.6's measured reply.
7. **The 30–34 px recovery control** is below the 44 px guideline (§8) and left to the design system.

## 12. Branch and commits

- Branch: `mission/44-7-claim-integrity`, created from `9251a80` and pushed before any change
- `ef06352` — claim grounding for every operational family; turn metrics; baseline evidence
- `aea64c9` — retry reuses the unanswered question; `provider-rate-limited` failure kind
- `184e844` — the cleared `processing` flag is written back; this report, the browser evidence and
  the full-suite log (2,408 / 2,400 / 0 / 8)
- Remote verified: `git ls-remote origin mission/44-7-claim-integrity` returns the same commit as
  local `HEAD` at each push
- Working tree clean apart from the deliberate untracked `pw-probe.mjs`
- Nothing merged into canonical (`freebuff/08af6cc9ef212913e6b7209b` = `543da7c`), production or
  another integration branch; nothing deployed
