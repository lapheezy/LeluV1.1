# Regression results

Run on `integration/m10-2-request-integrity` at `5af7bd9`, after the request fix.

```
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test --test-concurrency=1 \
  tests/request-integrity.test.ts \
  tests/request-budget-enforcement.test.ts \
  tests/duplicate-acquisition.test.ts \
  tests/repo-workforce-chat.test.ts \
  tests/repository-acquisition.test.ts
```

ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0

exit code 0.

| Suite | What it holds |
|---|---|
| `request-integrity` | 11 cases — prompt survives fitting, protected spans survive shortening, omissions are reported |
| `request-budget-enforcement` | the ceiling order: schemas first, then old history, then old text; the prompt and the recent tail never |
| `duplicate-acquisition` | identity normalization, reuse, ref distinction, single-flight |
| `repo-workforce-chat` | the conversation → workforce path |
| `repository-acquisition` | acquire, inspect, licence, commit verification |

## TypeScript

`npx tsc -b --force` on this branch checked out **alone**: exit 0.

In the shared working tree the same command exits 2, on five errors in
`src/core/model/RespanGateway.ts` and `src/providers/RespanGatewayProvider.ts`.
Those files are **untracked** in this worktree, belong to other in-progress work,
are not on this branch, and were neither created nor modified here. The isolated
run is the measurement of this mission's code.

## Architectural preservation

Re-checked after the fix, unchanged by it:

- one `ToolRegistry`, one `ToolDispatcher`, one `BY_ID`;
- one interface registration pathway (`registerInterfaceTools()` from Bootstrap);
- `interface.inspect/propose/recommend/revert/themes` present;
- `environment.compose/present_artifact/mutate_surface/manage_workspace/save_state/restore_state` present, restore by `snapshotId` **or** name alias;
- `repo.*` acquisition tools present, identity reuse and concurrency verified live (`live-acquisition-evidence.json`).
