# MISSION 44.5 — CONVERSATIONAL RELIABILITY & EXECUTION RECOVERY

Date: 2026-11-27 · Branch `mission/44-5-conversational-reliability` · Evidence: `docs/missions/evidence/mission-44-5/`
Continues from Mission 44.4 (`mission/44-4-recovery-acceptance`, HEAD `77ead33`).

---

## 1. Starting state (verified, not assumed)

| Fact | Verified value |
|---|---|
| Branch at start | `mission/44-4-recovery-acceptance` |
| HEAD at start | `77ead33` — "Let the laboratory answer the page, and make provider and scheduler states true" |
| Previous canonical reference | `543da7c` |
| 44.4 report + evidence | `docs/missions/MISSION-44-4-RECOVERY-AND-NARRATION-ACCEPTANCE.md`, `docs/missions/evidence/mission-44-4/` — intact, untouched |
| Working tree | clean apart from the deliberate untracked `pw-probe.mjs` |
| Dev server | restarted this mission (`vite --host 0.0.0.0 --strictPort --port 3001`) |
| Scheduler | pid 17250, 9 cycles, `intervalMs 21600000` — left running, untouched |
| Credentials | `GROQ_API_KEY_1..3`, `OPENROUTER_API_KEY(,_2,_7)` present in `.env.local`; never read, printed or recorded |

Isolation: `git checkout -b mission/44-5-conversational-reliability` from `77ead33`. No reset,
clean, stash, rebase or branch deletion. No paid API, no new account, no Anthropic, no
LangChain/LangGraph, no second scheduler or parallel conversation architecture.

## 2. Findings and root causes

Everything below was reproduced live against the two configured free providers before a line
was changed. Full request traces: `docs/missions/evidence/mission-44-5/traces/*.json`
(produced by `scripts/provider-trace.ts`, which drives the **production** stream reader and a
raw chunk reader over the same bytes, so a difference between them is our bug, not the
provider's).

### R1 — The streamed reader discarded reasoning, so a working model was recorded as broken

Both providers stream **thinking before text**. Measured, live, 2026-11-27:

| Provider / mode | Round | `content` chars | `reasoning` chars | `finish_reason` | tool calls |
|---|---|---|---|---|---|
| Groq `openai/gpt-oss-120b`, stream | tool decision | **0** | 162 | `tool_calls` | `lab_history` |
| Groq, stream | tool decision 2 | **0** | 66 | `tool_calls` | `lab_repository` |
| Groq, stream, 300-token budget | answer | 606 | 228 | **`length`** | none |
| OpenRouter `nemotron-3-ultra…:free`, stream | tool decision | **0** | 254 | `tool_calls` | 2 calls |
| OpenRouter, stream, 300-token budget | answer | 740 | 118 | **`length`** | none |

`extractOpenAIText` (the NON-streamed reader) has always fallen back to `reasoning`;
`readOpenAIStream` did not read the field at all. The same provider therefore answered in one
mode and was reported as "returned no usable content" in the other — exactly the message
Mission 44.4 could not explain. Fix: the stream reader accumulates `reasoning` /
`reasoning_content`, never streams it as the reply, and `streamedCompletionAnswer()` decides
what a streamed round means, for every OpenAI-shaped provider.

### R2 — The rung deadline ignored streaming progress

`executeRung` re-armed its 12 s watchdog only when a whole round returned. A provider that was
visibly streaming — 7.4 s and 4.4 s rounds measured on OpenRouter — was cut off mid-turn at a
fixed budget, and the chain fell through carrying the original messages. Fix: a streamed delta
is progress and re-arms the watchdog (`withStreamingProgress`). The budgets themselves were
**not** changed.

### R3 — Completed tool results were preserved but never became an answer

`ProviderResolver` already refused to replay a rung that had run tools, and reported
`partialWorkReply` ("Partial result — the job is NOT complete … Still needs reasoning: deciding
any further steps and writing the final answer"). Correct, and useless to a person. Fix: one
bounded, **tool-free** narration attempt on the next provider, from the results that already
exist. Tool schemas are withheld, so no step can run twice; the reply carries a provenance
line and `metadata.narratedAfterFailure`.

### R4 — A round truncated by its output budget was terminal

`finish_reason=length` with nothing produced is not a provider failure, it is a budget too
small for the way the model answers. Fix: **one** re-ask per round with twice the reply budget
(≤ 4096) and no tool schemas (so the larger reply is not paid for out of the same per-minute
token ceiling). If the answer was cut off mid-sentence rather than empty, the same single
re-ask completes it; if the re-ask cannot improve, the real partial answer is kept, never an
error.

### R5 — The wedge: one unanswered probe held every turn (the "stuck in Processing")

Reproduced live, twice, from a clean page load, on **every** subsequent turn — including a
one-sentence question:

```
1:48:06 Command received → Parsing request → Approach planned — github
1:48:06 Connecting to AI provider
1:48:07 Recalling → Recalled 0 → Using device
   … no provider request, no reply, for minutes; the same on the next turn and after reloads
```

`ToolRegistry.ensureAvailability()` awaited `Promise.allSettled` over three probes
(development runtime, acquisition runtime, GitHub) and the router awaits that refresh before
its first stage. One probe that never answered therefore held the whole refresh open — and
every later turn re-awaited the same never-settling promise. The turn had stored the question
and set `processing: true`; the server never reached a model, and the client never stopped
saying it was working. Fixes:

- each probe and the refresh itself are bounded (`settleWithin`, 4 s, env-overridable); a
  probe that misses its deadline is "unreachable", which is already what a failed probe means;
- the usage-budget gate's account call (reserve/settle/release) is bounded the same way, so an
  unresponsive backend decides locally instead of hanging the turn;
- `MultiChatStore` clears a persisted `processing: true` on load (a freshly loaded page has no
  turn in flight), a turn now marks its conversation as processing while it runs, and
  `GenesisChat` reconciles a turn whose reply is already stored but whose composer still says
  it is sending — so the reply becomes visible and Send usable without a reload.

## 3. Files changed

| File | Change |
|---|---|
| `src/providers/openaiTools.ts` | stream reader keeps `reasoning`; `EmptyCompletionError` (typed, with `truncated`); `streamedCompletionAnswer()` |
| `src/providers/GroqProvider.ts` | streamed/plain empty answer classified, not collapsed; reasoning-only answer used |
| `src/providers/OpenRouterProvider.ts` | same |
| `src/core/router/ProviderResolver.ts` | one bounded re-ask per truncated round; deltas re-arm the rung deadline; `narrateFromResults()`; tool evidence kept per run |
| `src/core/router/partialWork.ts` | `ToolRunRecord.content` (capped evidence), `toolEvidence()`, `publicToolRun()` |
| `src/core/tools/ToolRegistry.ts` | `settleWithin()`, `availabilityProbeMs()`, per-probe + refresh deadlines |
| `src/core/observability/UsageBudgetGate.ts` | account check/sync/release bounded |
| `src/core/multichat/MultiChatStore.ts` | stale `processing` cleared on load |
| `src/app/scene/genesis/GenesisChat.tsx` | turns mark `processing`; watchdog reconciles a reply that landed without the composer noticing |
| `tests/conversational-recovery.test.ts` | new — 12 tests |
| `tests/conversation-state-recovery.test.ts` | new — 2 tests |
| `tests/provider-rung-budget.test.ts` | updated to the new recovery contract (see §6) |

## 4. Architecture decisions

1. **One retry shape, everywhere.** A round that produced nothing because its output budget
   ran out is re-asked once; a rung that produced nothing is the next rung's turn. No ladder,
   no global timeout increase.
2. **Recovery may not repeat work.** The narration request carries **no tool schemas** — the
   only mechanism that makes "another provider finishes the answer" safe after side effects
   have already happened. This is asserted in tests (`tools` length 0) and observed live
   (`requestHasToolCount: 0`).
3. **Thinking is not the answer, unless it is the only thing there is.** Reasoning is never
   streamed as the reply; it becomes the answer only when the round ended normally and nothing
   else arrived — the behaviour the non-streamed reader has always had.
4. **A stall watchdog is not a total.** Progress (a returned round, a finished tool, a streamed
   delta) re-arms it; silence does not.
5. **Probes are advisory.** Anything that decides what to OFFER (tool availability, account
   budget) may not outlive the turn it is preparing.
6. **The store is the truth for turn state.** The composer's "sending" flag is reconciled
   against the conversation, not trusted on its own.

## 5. Before / after measurements

| Measurement | Before | After |
|---|---|---|
| Streamed reasoning-only round | read as empty → "returned no usable content" (provider failure, cooldown) | parsed as reasoning; answer when it is the only content, typed truncation otherwise |
| Cut-off answer (`finish_reason=length`) | kept as a half-sentence, or thrown away | one re-ask with 2× reply room → complete answer |
| Provider dies after its tools ran | `Partial result — the job is NOT complete` | answer written from those results by the next provider, tools withheld, provenance line |
| Streaming provider inside the rung budget | 12 s fixed → cut mid-turn | re-arms per delta |
| Hung availability probe | every turn hung before any provider request (minutes, across reloads) | turn reaches the provider; probe gives up at 4 s |
| Hung account budget call | `reserve`/`settle` could hold a turn forever | bounded at 4 s; local ledger decides |
| Stale `processing: true` after reload | shown as "Processing" until a reload | cleared on load |
| Live single-tool turn (repo state) | — | 9.1 s, grounded answer, composer free |
| Live multi-tool turn (3 tools) | — | 7.8 s, grounded answer, composer free |
| Live fault-injection turn (provider 500 after tools) | — | 4.6 s, grounded answer + provenance, composer free |

## 6. Test results

`docs/missions/evidence/mission-44-5/verification.log`, run on this tree:

| Check | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npm run build` | **exit 0** (5.17 s) |
| Full suite | **2,357 tests / 2,349 pass / 0 fail / 8 skipped / 34 suites**, 239.4 s (44.4: 2,343 / 2,335 / 0) |
| `tests/conversational-recovery.test.ts` (new) | 12/12 |
| `tests/conversation-state-recovery.test.ts` (new) | 2/2 |
| `tests/provider-rung-budget.test.ts` | 8/8 |
| `tests/multi-step-orchestration.test.ts` | 5/5 |

The 14 new tests are regression guards for defects measured in this mission: reasoning-only
streams (3), truncation re-ask (3), streaming progress vs the rung deadline (1), narration from
completed results (2), a hung availability probe (1), a hung account budget check (1), stale
`processing` and turn visibility (2), and the updated replay contract (existing test).

The Mission 44.4 test `a rung that already ran tools is not replayed on the next provider` was
**updated, not weakened**: it used to assert that the second provider was never called. It now
asserts that the second provider IS called and is offered **zero** tools — the invariant it was
protecting (work must not be repeated) is what the new assertions check, and the old assertion
would have forbidden the recovery this mission was asked to build.

## 7. Real conversation traces

`docs/missions/evidence/mission-44-5/live-acceptance.md` — five scenarios typed into the real
Chat Universe composer, with every request, tool call, provider answer and final answer
captured from the conversation store and a page-level fetch recorder:

- repository state (single tool, 9.1 s, grounded, matches `git`);
- multi-tool/multi-step (three real tools incl. an artifact, 7.8 s);
- journal (grounded in `.lelu-lab/state/journal.jsonl`);
- a provider that dies after its tools ran (injected 500) → grounded answer from the results,
  second provider called with **0 tools**;
- the pre-fix wedge, verbatim, for the record.

## 8. Known limitations

1. **Provider capacity is still the ceiling.** The free tiers answer single- and multi-tool
   turns reliably in these runs (2.6–7.8 s), but a turn needing many rounds will still meet
   their rate limits. What changed is that a limit now produces an answer from what exists
   instead of a wedge or a step list.
2. **The narration adds one extra provider call** after a mid-turn failure. Bounded (2
   providers, rung budget), but it is a real cost.
3. **The recovery watchdog is time-based at its backstop** (11 min, past the 8-minute tool
   loop). A turn that is genuinely still working at 11 minutes is released without being
   killed; whatever it later stores is still stored.
4. **Reasoning-as-answer can read like thinking.** It only happens when a round ended normally
   with no content at all, which is the same rule the non-streamed path always used; it is
   marked in `metadata.answerFromReasoning`.
5. **`EmptyCompletionError` typed recovery is wired for Groq and OpenRouter** (the configured
   pair). GitHub Models, Cerebras, Mistral and Fireworks keep their existing message and their
   existing behaviour.
6. **Not verified:** physical devices, reboot recovery (no init system in this VM — see 44.4),
   and two-window landscape geometry (unchanged, still geometry-tested only).
7. **The availability-probe wedge's exact hanging probe was not identified.** The refresh
   completed its GitHub call and the development-runtime call answered 503; the acquisition
   probe is the remaining candidate. The fix bounds all three, which is why the turn proceeds
   either way, but the culprit request itself was not captured.

## 9. Branch, commit, working tree

- Branch: `mission/44-5-conversational-reliability`, created from `77ead33`
- Delivery commit: **`e68287f`** — "Keep a turn's work when its provider stops, and never leave a
  turn hanging" (17 files, +2716 / −71), on top of `77ead33`
- Mission 44.4 branch `mission/44-4-recovery-acceptance` untouched at `77ead33`; canonical
  `freebuff/08af6cc9ef212913e6b7209b` untouched at `543da7c`; the 8 `lelu-lab/exp-*`
  worktrees untouched
- Working tree clean apart from the deliberate untracked `pw-probe.mjs`
- Nothing merged into production, nothing deployed or published

### WP05 checklist

| Requirement | Result |
|---|---|
| Preserve all Mission 44.4 evidence | untouched — `docs/missions/evidence/mission-44-4/` and its report are unmodified (verified in the diff from `77ead33`) |
| Audit the complete diff from `77ead33` | 10 source/test files + 7 new evidence/test files, +2716 / −71 — every file listed in §3 |
| Check the remote branch and working tree | working tree clean but for `pw-probe.mjs`; feature branch pushed, canonical and 44.4 branches not force-updated |
| Dedicated Mission 44.5 branch | `mission/44-5-conversational-reliability` |
| Do not overwrite or reset the canonical branch | canonical stays at `543da7c` |
| Do not merge without authorization | not merged |
