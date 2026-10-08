# Test suite — what is actually measured

`npm test` runs `tsx --test --test-concurrency=1 tests/*.test.ts`. It is
the node:test runner, not `bun test`; running it under bun reports the
suite as broken when it is not.

Measured per file with a 90s ceiling each, on the commit that added this
file:

- **203 assertions passing, 0 failing** across 23 files.
- **13 of 36 files do not finish inside 90s** and are therefore unmeasured, not passing.

The unmeasured files are long-standing — they did not finish at `11a3527`
either, so this is not a regression introduced by any recent change. They
exercise live cognition and reach for real providers, so with provider
credentials absent or revoked they sit waiting on the network rather than
failing. That is why a plain `npm test` appears to hang partway through.

Do not read "the suite passes" as covering these. They are:

- `agent-cognition.test.ts`
- `autonomy-end-to-end.test.ts`
- `cognition-chat-integration.test.ts`
- `cognitive-behavior.test.ts`
- `continuous-cognition.test.ts`
- `live-state-integration.test.ts`
- `provider-fallback-cognition.test.ts`
- `runtime-lifecycle.test.ts`
- `self-study-loop.test.ts`
- `test-isolation.test.ts`
- `tool-calling.test.ts`
- `workflow-control-flow.test.ts`
- `workflow-learning.test.ts`

To get a measurement without the hang:

```sh
for f in tests/*.test.ts; do timeout 90 npx tsx --test "$f"; done
```

The per-file counts above come from exactly that loop.
