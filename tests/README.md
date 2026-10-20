# Test suite — what is actually measured

`npm test` runs the deterministic suite. It is the node:test runner, not
`bun test`; running it under bun reports the suite as broken when it is not.

As of this commit, one command, start to finish:

- **459 tests, 458 passing, 1 failing, 0 hanging.**

## Why `--test-force-exit`

Twelve suites used to "hang" and the full run never finished. They were not
hanging on the network and they were not slow: their assertions complete in
milliseconds. Booting LÉLU starts background loops — the project scheduler
(every 60s), the persistent runtime, continuous self-study — and those timers
keep the Node event loop alive after the last assertion, so the process never
exits.

`--test-force-exit` ends the process once the tests are done. Nothing is
skipped, no assertion is weakened, and no cognition behaviour is changed:
those twelve files now report their results, which is where ~145 of the
passing assertions above come from.

## What is NOT in `npm test`

`tests/autonomy-end-to-end.test.ts` — run it with `npm run test:live`.

It is documented in its own header as the live end-to-end proof: nothing is
mocked, not the model, and it needs both a real provider credential and a
browser `indexedDB`. Under plain Node it fails on `indexedDB is not defined`,
which says nothing about the code under test. It is kept out of the
deterministic suite rather than being skipped, weakened, or counted as green.

## Known failure

`tests/provider-fallback-cognition.test.ts` — its 4 assertions all pass. The
file then reports `Unable to deserialize cloned data due to invalid or
unsupported version` as the test runner tears the file down.

Pre-existing, with evidence: the identical result (4 passing assertions, same
file-level error) reproduces at commit `44bdd93`, before the hydration,
pagination and workspace work. It is not caused by this work, and it is not
hidden — the suite reports 1 failure because there is 1 failure.

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
