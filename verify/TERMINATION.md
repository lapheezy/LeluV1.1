# The termination condition, and the code path that removes it

## Before: where cognition stopped

Commit `1946ac3`, `src/core/cognition/CognitiveLoop.ts`. There was no
self-study engine; "learning" was two blocks inside the observation loop.

**Block 1 — gap → queue item (`runOnce`, the LEARN section).**

```ts
const openTitles = new Set(openItems.map((item) => item.title.toLowerCase()));
let added = 0;
for (const gap of gaps) {
  if (added >= MAX_SUGGESTIONS_PER_CYCLE) break;
  const key = gap.title.toLowerCase().slice(0, 24);
  const alreadyQueued = [...openTitles].some((title) => title.includes(key));
  if (alreadyQueued) continue;              // <-- the terminating condition
  queue.add({ category: "LEARNING", title: `Study: ${gap.title}`, ... });
  added += 1;
}
```

**Block 2 — research the top gap (the ACTUAL RESEARCH FROM GAPS section).**

```ts
const topGap = gaps[0];                     // <-- always index 0
...
knowledge.add({ title: `Researched: ${topGap.title}`, status: "learned", ... });
break;                                      // stop after the first provider
```

### The exact mechanism

`KnowledgeLibrary.gaps()` is
`entries.filter((e) => GAP_STATUSES.includes(e.status))` where
`GAP_STATUSES = ["unverified", "hypothesized"]`.

Block 2 called `knowledge.add(...)` — it created a **new** entry with
status `"learned"` and never touched `topGap`. Searching the whole
pre-fix `CognitiveLoop.ts` for a call that could clear a gap
(`knowledge.setStatus` / `knowledge.update`) returns **zero matches**.

So:

1. `gaps` was a fixed set, seeded by `KnowledgeLibrary.seedEntries()`.
   Nothing in the loop could ever remove an entry from it.
2. Block 1 turned each gap into one `LEARNING` work-queue item. On every
   subsequent cycle the `alreadyQueued` guard matched, `continue` fired
   for every gap, and `added` stayed `0`. **No new objective was ever
   created again.**
3. Block 2 re-researched `gaps[0]` — the same entry — on every cycle
   forever, appending another `Researched: …` entry each time.

There was no code path anywhere that could produce an objective from a
discovery, from the mission, or from anything a previous cycle learned.
Once the seeded gaps were queued, the process was structurally finished:

```
seeded gaps → N LEARNING queue items → alreadyQueued → nothing further
```

The loop kept ticking on its 60s timer, so it *looked* alive. It was not
generating cognition. That is the termination the fix removes.

## After: what prevents queue exhaustion from ending cognition

`src/core/cognition/SelfStudyEngine.ts`.

**1. `nextObjective()` has no terminating branch.** An empty buffer is a
refill trigger, not an end state:

```ts
private async nextObjective(mission, state) {
  const buffered = this.objectives.open();
  if (buffered.length > 0) {
    if (buffered.length < 3) this.generate(mission, state);   // top up early
    return { objective: buffered[0], source: "buffer" };
  }
  this.generate(mission, state);                              // buffer empty → GENERATE
  const refilled = this.objectives.open();
  if (refilled.length > 0) return { objective: refilled[0], source: "generated" };
  return null;
}
```

**2. `generate()` always yields, because its last branch is renewable by
construction.** Branches (a)–(g) draw on real state — untrusted
knowledge, unreachable runtime, self-model `unfinished`/`hypotheses`,
incomplete subsystems, missing capabilities, the mission itself, unread
source. If every one of those is empty, the floor case runs:

```ts
if (created.length === 0) {
  const oldest = this.oldestCheckedEntry();     // longest-unchecked belief
  if (oldest) {
    add({ question: `Is what I believe about ${oldest.title} still true?`,
          origin: "revalidation", ... });
  } else {
    add({ question: "What is this system made of?", origin: "mission", ... });
  }
}
```

`oldestCheckedEntry()` returns the entry with the smallest `updatedAt`.
Re-verifying it rewrites `updatedAt`, so the *next* longest-unchecked
belief becomes the floor case. It cannot run dry while any knowledge
exists, and if none exists the mission branch fires instead.

**3. Investigated gaps actually leave gap status**, so the old
re-research-forever behaviour is gone. `incorporate()` updates the entry
that raised the question rather than adding a parallel one:

```ts
if (objective.knowledgeId && this.knowledge.get(objective.knowledgeId)) {
  this.knowledge.update(existing.id, { status, detail, source });   // gap settled
}
```
and `reconcile()` promotes any answered gap left behind.

**4. New questions come from results.** `derive()` creates objectives
from concrete leads the tool surfaced, observed failure signatures,
snapshot-only reads, and the evaluating model's follow-up — each tagged
with its cause in `report.derivedFrom`, so the causal chain is auditable
rather than assumed.

**5. Nothing can latch the loop.** Every external step is wrapped in
`withDeadline(...)`, so a call that never settles cannot leave `running`
`true` and silently stop scheduling.

## Guards against fabricated continuation

Continuity is only meaningful if the generated questions are real:

- `isSelfReferential()` rejects a question that quotes its parent, which
  is how a loop degenerates into an echo chamber.
- `isAdoptableQuestion()` rejects a model `NEXT:` line that is not a
  well-formed question — spliced sentences, recalled memories, leaked
  scaffolding (`ANSWER:` / `CONFIDENCE:` / `cycle N:`).
- The deterministic evaluation's `NEXT:` line is **never** adopted; only
  a provider-produced one is (`providerEvaluated` gate), because the
  deterministic one is phrased from the question itself.
- Failure-derived questions are keyed by a one-clause
  `failureSignature()`, so the same failure dedupes instead of nesting.
- Snapshot-revalidation questions require `isReferenceableTarget()` — a
  real path or identifier, not a prose signature.
