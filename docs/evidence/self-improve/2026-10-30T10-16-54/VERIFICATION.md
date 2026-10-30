# Run 28 — her evidence is complete, her verdict was lost, and a tooling defect was found

## The request

`request.txt` asked her to finish the loop on her copy: validate it, preview it, capture it at phone **and** desktop, show the diff, and give her verdict.

## What she did, in one turn

She did everything the request asked except the verdict.

| Time | What she did | Result |
|---|---|---|
| 3–32 s | Validated the copy as it stood | `typecheck` passed |
| 33 s | Started the preview | — |
| 35–85 s | Captured the preview at phone | 2 findings, **no control covered while opening** |
| 86–133 s | Captured the app at phone | 5 findings, including the 3 header controls covered-while-opening |
| 134–244 s | Captured the preview at desktop | 1 finding |
| 245–345 s | Captured the app at desktop | 1 finding, seen in only some loads, in both |
| 348 s | Called `project.diff` | — |

**Then the reply came back as "I'm in offline mode right now."** The same thing happened at the end of run 27, also straight after `project.diff`.

## The defect: `project.diff` compared her copy with the real project as it is now

`project.diff` listed things she never did:
- **Evidence files** added to the real project after her copy was made (JPEG captures) were listed as files she had **deleted**, with their binary bytes inlined as "patch" text.
- **Fixes** committed after her copy were listed as her **modifications**.

Two consequences:
- **Context blown:** her context filled with megabytes of noise right before her final answer. That is consistent with the provider failing both times straight after `project.diff`.
- **Unsafe apply:** `project.apply` acts on the same list, so it would have deleted those evidence files and reverted those fixes.

## Fix

`plugins/workspaceBaseline.ts`, used by both the Node and the Deno engineering adapters.

**A baseline per copy.** A copy now records a hash of every file it was made from (`.lelu-baseline.json`). Its changes are measured against that, not against the real project as it is now:

| Case | How it is treated |
|---|---|
| Only the real project changed a file since the copy | Not hers; not listed |
| Her copy changed a file the real project has **also** changed since | Marked `realChangedSince`; `apply` refuses it and writes nothing |
| A binary file | Counted, never inlined |

**Her existing copy.** `default` was made before baselines existed. Its baseline was reconstructed from `f500bdf`, which was HEAD when she last copied it (09:16:37 in run 25). Every tracked file is hashed from git at that commit, and the baseline records this.

**Her copy's diff now** is exactly her change:
- `src/app/scene/genesis/avatar/LeluCompanion.tsx`: +1/−1 (reconsider every 500 ms);
- `src/core/avatar/CompanionStore.ts`: +2/−2 (`EDGE_MARGIN` 100, default spot top-left).

`tests/workspace-baseline.test.ts` covers this, using the real Node adapter on a throwaway project.

## Status

Her own captures show the phone defect resolved and desktop unchanged. Her copy is validated and independently confirmed (run 27).

**Not counted yet:** her verdict was lost to the provider failure that followed the noisy diff. The next run asks her for the diff and verdict on the fixed tooling.
