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
npm run verify:workspace   # tab/workspace state isolation
```

`verify:hydration` needs a dev server started with `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`, and an `e2e-session.json` for its dedicated test
account (never the owner's). See the script header.

## When something hangs again

```sh
npx tsx --import ./scripts/find-leaked-handles.mjs --test tests/<file>.test.ts
```

It prints the creation stack of every timer still referenced when the work is
done. Fix the owner it names; do not reach for the flag.
