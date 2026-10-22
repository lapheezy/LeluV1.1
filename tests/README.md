# Test suite — what is actually measured

`npm test` runs the deterministic suite. It is the node:test runner, not
`bun test`; running it under bun reports the suite as broken when it is not.

As of this commit, one command, start to finish:

- **511 tests, 511 passing, 0 failing, 0 hanging, 0 skipped.**
- ~5 minutes wall clock. `NPM_TEST_EXIT=0`. No `--test-force-exit`.

## The run finishes on its own now

This used to need `--test-force-exit`, and before that twelve files simply
never finished. The diagnosis was right — booting LÉLU starts background
loops and a referenced timer keeps Node's event loop alive after the last
assertion — but the flag treated the symptom. It ends the process after the
tests, so a loop that should have been stopped is never noticed, and the
suite could not tell "finished" apart from "wedged".

Five owners were actually responsible, found by preloading
`scripts/find-leaked-handles.mjs` rather than by guessing:

| Owner | Handle |
| --- | --- |
| `ProjectScheduler` | 60s housekeeping interval, started by the first `AIService.getInstance()` |
| `ExecutiveRuntime` | 10s self-state interval, started by `AIRuntime.doInitialize()` |
| `StudyAgentRouter` / `ProjectRunner` / `ResearchResolver` | the losing half of a knowledge-provider `Promise.race` — a 6s rejection timer left pending after the provider had already answered |
| `CognitiveLoop` + `SelfStudyEngine` | the continuous cognition heartbeat |
| `LeluRuntime` | 30s health poll — this one hung `npm run test:live`, not `npm test` |

Each still has a real `stop()`, and `tests/live-state-integration.test.ts`
now calls teardown and asserts it took effect. What changed is that a
heartbeat is no longer a reason for a process to *stay* alive, and a deadline
is cleared once the work it was timing has answered.

`tests/background-lifecycles.test.ts` is the guard. It boots LÉLU in a child
process, runs a real research pass, starts the continuous loops, deliberately
does **not** stop them, and asserts the child exits by itself within 45s.
Revert any one of those fixes and it fails — that was checked, not assumed.

## What is NOT in `npm test`

`tests/autonomy-end-to-end.test.ts` — run it with `npm run test:live`.

It is documented in its own header as the live end-to-end proof: nothing is
mocked, not the model, and it needs both a real provider credential and a
browser `indexedDB`. Under plain Node it fails on `indexedDB is not defined`,
which says nothing about the code under test. It is kept out of the
deterministic suite rather than being skipped, weakened, or counted as green.

It is also NOT deterministic, and should not be read as if it were. A real
model decides how many actions to take, and the suite asserts at least
three: observed here failing once with `only 1 action(s) were taken:
workflow_list` and passing on the next run, same commit. A single red run of
this file is evidence about one model response, not about the code — re-run
it before concluding anything, and treat a repeatable failure very
differently from a single one.

## The previous known failure, and what it actually was

`tests/provider-fallback-cognition.test.ts` used to pass its assertions and
then fail the FILE on `Unable to deserialize cloned data due to invalid or
unsupported version`, thrown inside the node:test runner's own stream
parser. Its five assertions all passed; the result was simply unreadable, so
the suite reported a failure that pointed at nothing.

It was never the background loops, and it was never teardown. It was this
project's own log output. Under `node --test` the child reports results to
the runner as framed binary messages interleaved with console output, and
two things in `ExecutionLogger` mis-framed it: `console.table`'s box drawing
and the 🟢/🔴 markers. Measured one variable at a time — table silenced: 0
failures in 6 runs. Table fixed, markers left: 2 in 8. Both fixed: 0 in 10.

Both were browser devtools affordances. In devtools a collapsed group, a
table and a coloured dot are all real; in Node they are a flat list, ASCII
art and a hazard. `ExecutionLogger` now picks its shape by whether there is
a real `document`, and `tests/execution-logging.test.ts` pins that nothing
is withheld in either shape — only the presentation differs.

The honest note on how this was nearly missed: the file passes about half
the time, and an early clean run was briefly taken as proof it was fixed. It
needed ten runs, not one.

## Browser verification

Unit tests do not prove browser behaviour. These drive a real Chromium
against a real dev server:

```sh
npm run verify:hydration   # signed-in Supabase hydration, 1043 rows
npm run verify:layout      # geometry, overlap, overflow, clickability
npm run verify:workspace   # tab/workspace isolation, and the turn queue
npm run verify:auth        # the sign-in form against the real project
npm run measure:cost       # what one message costs in renders and writes
```

`measure:cost` is an instrument, not a gate: it prints numbers and exits 0.
It exists because the claim "a streamed token no longer re-renders the 3D
scene" could not be measured from long-task counts (see the SwiftShader note
below), so the context consumers count themselves instead — a dev-only
ledger in `useGenesisScene`, read either side of a real turn. It reports
scene-consumer renders, chat-consumer renders, and every `localStorage` save
with its key and byte count.

`verify:layout` provokes a real toast before measuring toast geometry, by
attaching an undecodable image through the real file input: `processImageFile`
rejects and GenesisChat raises `notify("Lélu Error", …)` from the same catch
a user hits. It used to cut the model broker instead, which stopped raising
anything once the provider chain gained a working offline fallback — leaving
three geometry checks measuring an empty toast stack and passing on nothing.
The check now waits for that toast *by its text*, so an unrelated
notification cannot satisfy it.

`verify:hydration` needs a dev server started with `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`, and an `e2e-session.json` for its dedicated test
account (never the owner's). See the script header.

`verify:auth` takes two dev servers: the first configured correctly, the
second configured with a key whose `ref` claim names a different project (the
script prints one to use). It submits one deliberately wrong password to
prove the real endpoint answers, and asserts the answer reads as a wrong
password rather than as a broken deployment — that confusion was the original
bug. It creates no account and sends no email. Without the second server the
mismatch half SKIPS and counts as a failure: a check that cannot run has not
passed.

### Why these scripts click with `page.mouse` rather than `page.click()`

`locator.click()` times out on this page in a headless container. Its own
log reads "element is visible, enabled and stable", then "performing click
action", then nothing — and the element is genuinely uncovered, which
`elementFromPoint` confirms.

Measured cause: the main thread is blocked most of the time. 31 long tasks
totalling 22.4s in a 30s window, worst single task 2.9s; a bare
`evaluate(() => 1 + 1)` round trip measured 401–2938ms. `locator.click`'s
internal re-checks round-trip through that thread, so the action retries
until it gives up.

A CPU profile attributes 20.6s of 26.6s to `(program)` — native, not
JavaScript — with `getProgramInfoLog` the top named frame. That is WebGL
shader compilation, and this container renders through SwiftShader
("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)"),
so shaders compile on the CPU. It is therefore evidence about a GPU-less
headless environment, not about the product on a real device — it has not
been reproduced on hardware either way.

This is also why long-task counts cannot measure React work here, and why
`measure:cost` exists: the render cascade was invisible underneath shader
compilation, so the phase-6 scene-isolation claim was true but unproven.
Counting consumer renders needs no GPU. It immediately showed the claim
was only half delivered — 62 scene renders per message — and the fix is
measured at 0. `measure:cost` still prints long tasks, with this caveat
attached, rather than quietly leaving them out.

The scripts use `page.mouse` at a point they have just hit-tested. That is a
real CDP input event, so a control covered by something else still fails —
unlike a synthetic `element.click()` from `evaluate`, which bypasses hit
testing and would prove nothing.

### A memo removed an accident the simulation was relying on

Memoising `EngineTick` and `GenesisV1Workspace` is what took the scene
from 48 re-renders per message to 0 — and it nearly stopped the
simulation. `GenesisCore` creates the `EngineRuntime` in its own effect,
and a child's effects run before its parent's, so at `EngineTick`'s first
render and first effect `engineRuntime` is still null. It had been
recovering by accident: its parent re-rendered at render rate, so a later
render eventually read a non-null value. Remove the churn and the latch
has nothing to open it.

Both `EngineTick` and `GenesisRenderer` now read `engineRuntime` from the
scene context's getter **per frame** rather than destructuring it at
render time. `measure:cost` would not have caught this — the proof is
`scripts` driving a real page and watching `lelu.lelu.world.lifecycle.v2`
advance a phase, which only `engineRuntime.update()` can do.

### Why `verify:workspace` stopped asserting on reply text

Two of its checks used to look for the other conversation's marker in an
assistant message, or in the rendered transcript. That proxy is unsound:
`GenesisChat` passes `crossChatContext()` into every turn, so LÉLU can
legitimately mention chat A while answering in chat B — and does. Observed
in a real run: BETA's own reply opened "BETA-marker-two is already
running", and a reply naming ALPHA was read as ALPHA's reply having leaked.

They now assert what the property actually is. A misrouted reply is the
*same message* in the wrong place, so replies are compared by **id**: no
assistant id may appear in two conversations, and each conversation must
have an assistant message after its own question. And the view check reads
`[data-lelu-exchange-user]` — the **question** on screen — rather than the
whole transcript, because the question is the part that must belong to the
conversation being looked at.

### One turn at a time, and why it is still one turn at a time

`GenesisChat` used to drop a message typed while a reply was streaming:
`send()` returned early on `isSending` and the Send button was disabled, so
the message was never answered and never entered the conversation.
`Orchestrator.process()` already refuses that trade one layer down — it
waits for the in-flight request rather than returning a canned "I'm busy" —
and the UI was undoing it above.

Turns now queue: the composer clears immediately, the message is stored, and
it is answered in order. `verify:workspace` asserts this against a composer
it has first confirmed is busy, so the check cannot pass by quietly sending
two messages into an idle one.

The queue is deliberately GLOBAL rather than per conversation. A reply
arrives through one subscription (`AIService.subscribeMessages` /
`subscribeStream`) that carries no conversation of its own, and
`TurnOwnership` attributes it to whichever conversation holds the claim. Two
turns in flight at once cannot be told apart, and the second one's claim
would collect the first one's reply — the exact "reply landed in the wrong
chat" bug `TurnOwnership` exists to fix. Genuine concurrency needs the reply
channel to name its conversation first; until then, serial turns are what
keeps attribution sound.

## When something hangs again

```sh
npx tsx --import ./scripts/find-leaked-handles.mjs --test tests/<file>.test.ts
```

It prints the creation stack of every timer still referenced when the work is
done. Fix the owner it names; do not reach for the flag.
