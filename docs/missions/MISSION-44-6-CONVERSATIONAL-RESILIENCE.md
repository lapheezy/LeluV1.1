# MISSION 44.6 — CONVERSATIONAL RESILIENCE & DEVICE ACCEPTANCE

Date: 2026-11-27 · Branch `mission/44-6-conversational-resilience` (from `fd9169d`)
Evidence: `docs/missions/evidence/mission-44-6/` · Previous: `MISSION-44-5-CONVERSATIONAL-RELIABILITY.md`

Mission 44.5 built the recovery logic and proved it on a desktop page. This mission set out to
find out whether it survives real use — a phone-sized viewport, a reload in the middle of an
answer, a restarted server, a provider that refuses — and to fix what did not.

---

## 1. Starting state (verified)

| Fact | Value |
|---|---|
| Starting branch | `mission/44-5-conversational-reliability` |
| HEAD at start | `fd9169d` (report checkpoint) / `e68287f` (delivery) |
| Working tree | clean except the deliberate untracked `pw-probe.mjs` |
| 44.5 deliverables | report + `docs/missions/evidence/mission-44-5/` (traces, live acceptance, verification) — **preserved, unmodified** |
| 44.4 evidence | `docs/missions/evidence/mission-44-4/` — **preserved, unmodified** |
| Dev server | restarted this mission; `vite --host 0.0.0.0 --port 3001` behind the authenticated preview |
| Scheduler | left running, untouched |
| Credentials | present in `.env.local`; never read, printed or recorded |

Isolation: a new branch was created from `fd9169d`. No reset, clean, stash, rebase or branch
deletion. Nothing merged, deployed or published. No paid provider, no Anthropic, no
LangChain/LangGraph, no second scheduler or parallel conversation architecture.

**WP01 audit, in brief.** The recovery pathways from 44.5 were read end to end before anything
was changed: the per-conversation turn queue and `sendingIn` indicator; the watchdog that
reconciles `pendingTurnsRef` against the store (8 s stability, 11 min backstop, interval +
visibility/focus); the resolver's rung loop (stop, budget, tools-ran, narration, fallback);
`withStreamingProgress`; the bounded availability probes; the bounded account gate;
`ClaimGrounding` and the capture-contradiction check. That read is what made the three defects
below findable, because each of them sits in a gap *between* those pieces.

## 2. What was found

### D1 — A two-turn-stale laboratory result was presented as a fresh check (live, fixed)

Measured on the 390x844 page, in a real conversation
(`evidence/mission-44-6/live-acceptance.md` §M3). Asked *"Which branch were we just talking
about, and what is the HEAD commit on it?"*, LÉLU made **one** provider request, called **no**
laboratory tool, and answered:

> From the laboratory repository tool result just returned: the current branch is
> **mission/44-4-recovery-acceptance** and the HEAD commit is **adaa97a** …

The real values at that moment were `mission/44-6-conversational-resilience` / `fd9169d`. The
quoted state was from two turns earlier and true of no branch in the workspace.

Cause: `ClaimGrounding` compares a reply's claims against the tools that actually ran, but its
rules covered only the engineering/studio tools — **there was no rule for the laboratory
family**, so "the tool result just returned" was never compared with anything. The single note
that did fire was the old commit rule, which hedged in the *wrong direction* ("…but
project_commit / github_commits did not run successfully in this turn").

This is the exact failure the mission warns about: successful tool execution elsewhere in the
history is not a grounded answer.

### D2 — A reload during generation left a dead turn with nothing said (live, fixed)

A multi-tool turn was running (`processing: true`) and the page was reloaded 2.2 s later. After
the reload the conversation still held the question and nothing else: no reply (the turn ran in
the page and died with it), no error, no notice, and `processing` correctly false. The user's
only move was to retype the question, with no way to know whether it had run.

### D3 — A stream that breaks mid-answer discarded the text already on screen (fixed)

The stream reader throws on a broken connection, and when the whole provider chain failed the
turn was replaced by the offline notice — "all providers are unreachable" — even though the user
had been reading a half-answer that was already upserted into the conversation. That is a lost
response created by the recovery path itself.

## 3. What changed

| File | Change |
|---|---|
| `src/core/tools/ClaimGrounding.ts` | `ClaimRule.fresh`; a **laboratory** rule (lab_repository/status/tree/journal/history/experiment/cycle/execute) for "tool result just returned"; `freshnessCorrection()`; the commit rule narrowed to first-person/object claims so a quoted commit subject or date is not treated as a new commit |
| `src/core/router/ProviderResolver.ts` | a freshness claim with no tool behind it is corrected **before** the reply, not footnoted after it; the longest partial streamed answer is kept and used as the last resort instead of the offline notice |
| `src/providers/openaiTools.ts` | a broken stream carries the text already streamed (`partialText`); a half-assembled tool call is never carried |
| `src/core/multichat/interruptedTurn.ts` | **new** — the exact predicate for "a question no turn is answering" (last message is the user's, not processing, stored before this page started) |
| `src/app/scene/genesis/GenesisChat.tsx` | interrupted-turn notice + Try again in the classic transcript |
| `src/app/scene/genesis/chat/universe/UniverseChatWindow.tsx` | the same notice + Try again in the Chat Universe window (the surface a phone actually uses) |
| `src/providers/LeluSystemPrompt.ts` | "just returned" means *this turn*; an earlier result is history and must be re-checked before being reported as current |
| `tests/claim-grounding.test.ts` | +3 cases built from the exact reply measured in D1 |
| `tests/interrupted-turn.test.ts` | **new** — 4 cases |
| `tests/provider-stream-faults.test.ts` | **new** — 8 cases over the real stream reader |

## 4. Decisions

1. **A freshness claim is corrected in front of the reply, not behind it.** A footnote cannot
   undo a first sentence that says a stale value is current. The correction is deterministic,
   names the tools that did not run, and says what the text below actually is.
2. **The grounding rules stay conservative.** The new rule matches phrases that assert a
   returned result ("tool result just returned", "from the laboratory … tool result", "just
   read the journal"), not every mention of a lab tool, and the existing negation filter still
   excludes "I haven't checked", "I'll call …" and "earlier in this conversation".
3. **A broken stream keeps its text; a broken stream never keeps a tool call.** Text already on
   screen is output. A half-assembled call is an instruction, and executing one would be the
   duplicate-operation failure this mission exists to prevent.
4. **The interrupted-turn signal needs no new persisted flag.** "Last message is the user's, no
   turn in flight, stored before this page started" is exact, survives every reload, and cannot
   misfire on a turn this page is setting up.
5. **A reload cannot resume a turn in this architecture** (the orchestrator is in the page), so
   the fix is to say so and make it one tap to retry — not to pretend the work continued.
6. **No retry policy was added beyond what 44.5 bounded.** Everything here is deterministic
   post-processing, one extra string on an error, or UI.

## 5. Verification

`docs/missions/evidence/mission-44-6/verification.log` (this tree):

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npm run build` | **exit 0** (5.60 s) |
| Full suite | **2,372 tests / 2,364 pass / 0 fail / 8 skipped / 34 suites**, 236.9 s (44.5: 2,357 / 2,349) |
| 44.4 regressions | `self-development-lab` + `broker-contract` 27/27 (unchanged) |
| 44.5 acceptance | `conversational-recovery` 12/12, `conversation-state-recovery` 2/2, `provider-rung-budget` passing |
| New this mission | `provider-stream-faults` 8/8, `interrupted-turn` 4/4, `claim-grounding` 10/10 (3 new) |

## 6. Real conversational acceptance

Full transcripts and request logs: `docs/missions/evidence/mission-44-6/live-acceptance.md`.

| Scenario | Result |
|---|---|
| Mobile (390x844, touch, iPhone UA) tool turn | answer in **1.2 s to first text**, correct branch, composer free, no reload |
| Duplicate submission (two rapid taps) | **1 message**, 1 answer |
| Context follow-up | found D1 — stale result shipped as fresh; fixed |
| Reload mid-generation | found D2 — dead turn, silent; fixed (notice + Try again) |
| Dev-server restart | conversation restored in full; new turn answered `the laboratory is ready.` in 15.2 s |
| Provider dies after tools ran (44.5, unchanged code) | answered from the results, second provider with **0 tools**, 4.6 s |
| Provider fault matrix (429, 500, drop mid-answer, drop before text, stop, truncation, reasoning-only, bad tool JSON) | 8/8, each with an intelligible typed failure and no partial tool call |

**Conversational quality judgement** (WP05), from the transcripts rather than from tool success:
the runtime follows instructions ("exactly four words" → four words), keeps context across turns,
and — after D1 — no longer presents history as a fresh check. It still answers state questions
from memory when it chooses not to call a tool; the correction now makes that visible and
recoverable instead of silent.

## 7. Performance

| Measurement | Value |
|---|---|
| First visible text (mobile, tool turn) | 1.2 s |
| Provider rounds | 781 ms (tool decision), 492 ms (narration) |
| Tool round (3 lab reads) | < 0.6 s |
| Turn total, tool turn | ≈10 s |
| Turn total, four-word answer | 15.2 s (provider latency) |
| Recovery after a provider dies (44.5) | 4.6 s |

No new bottleneck: the 44.6 changes add a constant-time predicate per render, one string prefix on
replies that already existed, and at most one string carried on a stream error.

## 8. Not independently verified

1. **No physical iPhone** was available. "Mobile" is Chromium device emulation at 390x844 with
   touch and an iPhone UA. iOS Safari, the on-screen keyboard, `visualViewport` resizes and
   safe-area insets were **not** exercised on a device.
2. **The interrupted-turn notice was not seen rendering in a browser** — its predicate is
   unit-tested (4 cases) and both surfaces typecheck and build, but automation could not open the
   seeded conversation window in the time available. The UI half is unproven.
3. **Landscape (844x390)** was not re-tested; 44.4's fix and measurements stand.
4. **A live 429 through the browser** was not completed (unit matrix only; provider key-ring
   rotation on 401/403/429 is unchanged).
5. **No reboot/init-system test** — this VM has no init system. The restart test is the dev-server
   process, not the machine.
6. **No desktop visual review** of the changed surfaces this mission.

## 9. Branch and commits

- Branch: `mission/44-6-conversational-resilience`, created from `fd9169d`
- Delivery commit: recorded in the commit on this branch (`Mission 44.6: …`), pushed to
  `origin/mission/44-6-conversational-resilience`
- `mission/44-5-conversational-reliability` (`fd9169d`), `mission/44-4-recovery-acceptance`
  (`77ead33`) and canonical `freebuff/08af6cc9ef212913e6b7209b` (`543da7c`) untouched
- Nothing merged into production, deployed or published
