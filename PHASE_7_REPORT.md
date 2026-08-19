# LÉLU — Phase 7: performance pass + command palette polish

## Scope of this pass

Picked up items 3 and 4 from `PHASE_6_REPORT.md`'s own "Recommended next
phase" list: lazy-loading the heavy overlay panels, and recent-command
ranking in the command palette. Kept the scope small on purpose — Phase 6
closed with an unresolved item every prior phase has repeated ("get a real
build environment"), and this session still doesn't have one, so the
right move is small, individually-verifiable changes over another wide
sweep.

**Same constraint as every phase before this one: no network, no
`node_modules`, no `tsc`/`vite`/Playwright.** Verified with the same
method as Phases 3–6: bracket-balance + `node --check` on every touched
file, plus a full relative-import resolution walk (including the dynamic
`lazy(() => import(...))` targets this pass adds, checked by hand since
the automated import-graph script only pattern-matches static `from`
imports).

## What changed

**`app/scene/genesis/GenesisChat.tsx` is now lazy-loaded.**
It's the heaviest overlay panel — it imports `AIService` and
`EngineerService`, which pull in the AI runtime, provider router, and the
engineering sandbox. Converted to `React.lazy()` in
`GenesisInterface.tsx`, with a small themed `PanelFallback` shown while
the chunk loads. This is the concrete version of the brief's "lazy-load
heavy panels" ask.

**`GenesisReasoningPanel` and `GenesisDiagnosticsPanel` were deliberately
*not* lazy-loaded, despite being named in the same brief item.**
Found and avoided a real bug here rather than shipping it: both of these
components *are* the `motion.div` that `AnimatePresence` tracks for its
enter/exit animation — `AnimatePresence` needs its direct child to be the
animating element (or to visibly own the exit transition) to fire an exit
animation at all. Wrapping either in `<Suspense>` would make `Suspense`
the direct `AnimatePresence` child instead of the `motion.div`, which
means on close they'd very likely vanish instantly instead of springing
out — a visible regression with nothing to warn you except watching it
render, which isn't available here. `GenesisChat` doesn't have this
problem: it's nested *inside* an already-eager `motion.div` in
`GenesisInterface.tsx` that isn't itself changing, so `Suspense` only
ever swaps content that was already inside a stable, already-animating
box.
**Recommendation carried to the next pass with a build environment:**
lazy-loading these two safely means either (a) moving their
`initial`/`animate`/`exit` motion props one level up into a wrapper
`GenesisInterface.tsx` already owns and controls directly (duplicating
some positioning styles — moderate, verifiable-in-a-browser risk), or (b)
confirming empirically that Framer Motion's nested-motion-component exit
detection handles this specific shape fine (it may — this wasn't
disproven, just judged too risky to ship unverified). Either path needs
to be watched render, not reasoned about further from here.

**`app/scene/genesis/GenesisCommandPalette.tsx` — recent commands.**
Running a command now records its id in a capped, deduplicated
`recentIds` list (last 5). When the query box is empty, recently-run
commands sort to the top of the list with a "Recent" hint replacing their
normal category hint; typing a search query falls back to plain label
matching over the same reordered list. No persistence layer added — this
lives in component state for the session, which is appropriate since the
palette component itself persists for the life of the app (mounted once
inside `GenesisInterface`, never unmounted while the app is open).

**`app/scene/genesis/GenesisNotificationCenter.tsx` — clear all.**
Added a small "Clear all" affordance that appears once more than one
toast is stacked, dismissing everything currently visible in one action —
closes a small gap from Phase 6's own toast stack (individual dismiss
only, no bulk action) rather than leaving it for a future pass.

**Drive-by fix: two unused default `React` imports removed.**
`GenesisInterface.tsx` and `GenesisChat.tsx` both had `import React, {
...} from "react"` with `React` itself never referenced anywhere in
either file (this codebase uses the `react-jsx` transform, which doesn't
require it). With `verbatimModuleSyntax` and `noUnusedLocals` both `true`
in `tsconfig.app.json`, an unused import like this is a hard `tsc`
error, not a warning — so if either file had ever been compiled as-is,
the build would have failed on this alone. Pre-existing in both files
before this pass (not something Phase 6 introduced), fixed opportunistically
since both files were already open for edits this session. **Not**
hunted for elsewhere in the ~210-file tree — that's exactly the kind of
sweep that needs a compiler to do safely and completely, per the standing
caveat every phase report has repeated.

## What this does *not* claim to do

- **Still not verified by compilation** — same standing caveat, unchanged
  since Phase 3. The `React.KeyboardEvent`-without-`React`-import bug
  Phase 6 caught, and the unused-import fix this pass made, are both
  examples of exactly the class of error static bracket/import checking
  can miss if not re-read carefully — `tsc -b` the moment a build
  environment exists remains the single highest-leverage next step,
  repeated for the fourth phase report in a row now.
- **`GenesisReasoningPanel` / `GenesisDiagnosticsPanel` remain eager.**
  Explained above — this is a deliberate, reasoned "not yet" rather than
  an oversight, and the next pass should resolve it with a running dev
  server rather than more static reasoning.
- **Command palette recency has no visual "recently used" section
  divider** — recent commands are just reordered to the top with a hint
  label, not visually grouped under a heading. Simple to add, skipped to
  keep this pass's diff small and easy to re-check by hand.
- **No engine-specific browsers were added** (Memory, Knowledge,
  Provider), despite being next on Phase 6's list. Investigated this
  first: the in-scene `MemoryEngine.ts` (one of the ~36 simulation
  engines already visible via `GenesisDiagnosticsPanel`) only tracks four
  aggregate scalars (`shortTerm`/`longTerm`/`archived`/`importance`) as
  part of the cosmic-simulation visuals — it is **not** the same system
  as the real AI conversation memory (`core/memory/MemoryStore.ts` /
  `brain/MemoryEngine.ts`, flagged back in `PHASE_3_REPORT.md` as not
  cleanly split into working/long-term stages). Building a "Memory
  browser" against the simulation engine would look like it does
  something it doesn't; wiring the real memory store into Genesis state
  is real, unverified integration work — deferred rather than shipped
  either wrong or blind.

## Recommended next phase (in order)

1. **Still: get a real build environment.** Four phase reports in a row
   have opened with this. Everything downstream keeps being scoped
   defensively around not having it.
2. **Resolve the `GenesisReasoningPanel` / `GenesisDiagnosticsPanel` lazy-
   load question** with a running dev server — try wrapping as originally
   attempted this pass, watch whether the exit animation actually breaks,
   and either keep it or apply the wrapper-motion-div fix, confirmed
   visually either way.
3. **Real memory integration**, only after (1): decide what "working
   memory" vs "long-term memory" means for `core/memory/MemoryStore.ts` /
   `brain/MemoryEngine.ts` (the open question from Phase 3), wire that
   state into the Genesis context the same way Reasoning/Planning were
   wired in Phase 5, *then* build the Memory browser panel against the
   real thing.
4. **Provider monitor**, same pattern: `src/providers/*` health surfaced
   through `EngineRuntime`/context, then a dedicated panel — this one is
   lower-risk than Memory since Provider Router already exists as a
   single live path (per Phase 3's pipeline audit), just not exposed to
   the UI yet.
5. **Only after (1)**, the Three.js scene-graph "living interface" work —
   unchanged recommendation from every phase report so far.

## What's in this ZIP

- `src/` — Phase 6 pass 1's tree plus this pass's changes:
  `GenesisInterface.tsx`, `GenesisChat.tsx`, `GenesisCommandPalette.tsx`,
  `GenesisNotificationCenter.tsx` (all changed, not new — no new files
  this pass). Everything else untouched.
- `_archive_orphaned/` — unchanged from Phase 3.
- `PHASE_3_REPORT.md` through `PHASE_6_REPORT.md` — prior passes,
  unchanged.
- `PHASE_7_REPORT.md` — this file.
