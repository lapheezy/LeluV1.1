# LÉLU — Phase 4: Wiring Reasoning + Planning into the live pipeline

## Scope of this pass

Phase 3 identified one concrete, honest gap in the pipeline:
`core/ReasoningEngine.ts`, `core/PlanningEngine.ts`, `core/PlanningEngine.ts`,
`Planner.ts`, and `TaskPlanner.ts` all existed but were never wired into
`Brain.ts` or `AIRuntime.ts` — no live Reasoning or Planning stage between
"provider selected" and "response returned." This pass closes that gap for
Reasoning and Planning specifically, without touching anything else.

Same environment constraints as Phase 3: **no network access, no
`node_modules`, so no `npm install` / `tsc -b` / `vite build` / Playwright**.
Verification is static: a from-scratch import-graph walk from `src/main.tsx`
(same method as Phase 3, re-implemented since the old script wasn't carried
forward) confirms **186 live files, 0 broken imports** after these changes
(up from 180/0 in the Phase 3 handoff — +4 new files, +2 reactivated files
minus their now-redundant archived copies).

## What changed

**Reactivated (moved, not rewritten) from `_archive_orphaned/` into the live
tree:**
- `core/ReasoningEngine.ts` → `src/core/reasoning/ReasoningEngine.ts`
- `core/PlanningEngine.ts` → `src/core/planning/PlanningEngine.ts`

Both were already self-contained (no external deps) and unmodified — they
just had nothing calling them. `ARCHIVE_MANIFEST.md` updated to mark them
reactivated rather than archived; their old archived copies deleted so
there's exactly one live copy of each, per the "no duplicate paths" rule.

**New (these didn't exist before — the archived engines only ever managed
hypothesis/plan *data structures* they were handed; nothing previously
generated hypotheses or steps from an actual request):**
- `src/core/router/PlanningResolver.ts` — runs right after the Memory stage.
  Splits the prompt on structural markers (newlines, semicolons, "then",
  "first,", "after that", etc.) into candidate steps. Two or more steps →
  builds a tracked `Plan` via `PlanningEngine`, attaches it to
  `RouterContext.plan`, and appends a short numbered outline into
  `request.context` (the field `AIProvider` already defines for "memory/context
  injected before generation" — no new provider contract needed). One step
  or fewer → does nothing, which is the same behavior as before this pass.
- `src/core/router/ReasoningResolver.ts` — runs right after Planning.
  Builds hypotheses about *how* to answer (recalled memory available?
  injected context present? an active plan? search intent?), scores them,
  picks the strongest, and records the selection + a plain-English
  explanation on `RouterContext.reasoning`. Also appends that explanation
  into `request.context`, same mechanism as Planning.

**Modified (small, additive edits to existing live files):**
- `core/router/RouterContext.ts` — added three optional fields:
  `recalledMemories`, `reasoning`, `plan`. Nothing existing changed shape.
- `core/router/BrainResolver.ts` — now also writes the memories it recalled
  onto `context.recalledMemories` even when it doesn't answer directly, so
  Reasoning doesn't have to re-query the brain a second time for the same
  prompt.
- `core/AIRouter.ts` — the routing pipeline is now:
  `Brain (memory, can short-circuit) → Planning → Reasoning → Research
  (knowledge/tools, can short-circuit) → Providers (can short-circuit) →
  offline fallback`. Planning and Reasoning never short-circuit — they only
  annotate the context and the outgoing request. A new private
  `attachThinking()` merges `context.reasoning`/`context.plan` into
  whichever response ends up going out, under `response.metadata`, so
  nothing about the `AIResponse` contract changed for any existing caller —
  they just see two new optional metadata keys if those stages produced
  something.

## What this does *not* claim to do

- **Not verified by compilation.** I re-read every new/changed file for
  type consistency against the interfaces they import, but I have no `tsc`
  here to prove it. Treat this the same way Phase 3 asked you to: "provably
  imported from the entry point," not "known to work."
- **Planning's step-splitting is a heuristic, not an LLM call.** It's
  deliberately conservative — a prompt that isn't structurally obvious as
  multi-step just doesn't get a plan, same as today. I chose that over
  calling a provider to *generate* a plan, since that would add a second
  provider round-trip per request and a new failure mode; that tradeoff is
  worth revisiting once there's a build to test latency against.
- **Reasoning's hypothesis set is hand-authored, not learned.** It reasons
  about *this* request's available signals (memory/context/plan/intent), it
  doesn't yet feed back into `LearningEngine` or `CognitiveCore` — so the
  "Cognition" and "Workspace Update" stages in the target pipeline still
  don't see it. That connection (Reasoning/Planning output → `CognitiveCore`
  → `WorkspaceManager` → Genesis workspace panels) is real design work,
  same caveat Phase 3 gave for the original gap, and is the natural next
  step now that both stages exist to connect *from*.
- **No UI surfaces this yet.** The data is on `AIResponse.metadata.reasoning`
  / `.plan` and ready to read, but no Genesis panel renders it. Given the
  Phase 3 caution about touching the ~90-file live Three.js scene graph
  without a dev server to verify against, I left that for a session where
  `vite dev` is reachable.

## Recommended next step

Same ordering Phase 3 recommended, updated:

1. Get a build environment (`npm install` + `tsc -b`) so the above can
   actually be compiled and caught before it reaches you.
2. Wire `context.reasoning` / `context.plan` into `CognitiveCore` /
   `WorkspaceManager` so Genesis's live workspace state reflects them —
   closing the "Cognition" and "Workspace Update" stages of the target
   pipeline.
3. Only then build the panel(s) that surface Reasoning/Planning in the
   Genesis UI, with the dev server running to verify each step visually.
