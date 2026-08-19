PHASE 10 — GENESIS MUTATION WIRING (slice 1 of the Phase 10 brief)

## Scope of this pass

The Phase 10 brief covers persona systems, window chrome, rendering perf,
and mutation wiring — too much for one honest pass. This session did
**one slice only**: wiring the live signals Phase 8's report already
identified as under-read (`thinking` / `speaking` / `listening` /
`cognition.reasoning` / `cognition.plan` / provider identity /
`engineStatuses`) into the engine tick that actually drives the visible
Genesis mesh. Persona system, window chrome, and rendering perf are
still open — see "Still open" below.

**This was done without a build environment.** No `node_modules`, no
`npm install`, no dev server, no visual verification. Every change here
is a static read-and-edit against the existing architecture, plus a
type-check of the touched files in isolation (see "Verification"). What
"does the pulse actually look faster while thinking" looks like in the
browser is unverified — strongly recommend running `npm install && npm
run dev` and eyeballing it before trusting the tuning constants below.

## The gap that was there

Two separate `GenesisState` names exist in this codebase (Phase 8's
report already flagged this): `GenesisUIState` (in `GenesisCore.tsx`,
holds `thinking`/`speaking`/`listening`/`cognition`/`engineStatuses` —
updated live on every chat turn) and `GenesisState`/`UniverseState`
(in `state/GenesisState.ts`, holds `energy`/`awareness`/`consciousness`/
`evolutionSystem`/`ocean` — the values the 3D mesh in
`materials/GenesisCore.tsx` actually reads into its shader uniforms).

`GenesisRenderer.tsx` calls `engineRuntime.update(state, delta)` every
frame, which runs all ~40 registered engines (`AwarenessEngine`,
`PulseEngine`, `ConsciousnessEngine`, etc.) against the **universe**
state only. None of those engines ever saw the **UI** state. So the
mesh was already alive — pulsing, rotating, breathing — but entirely
disconnected from whether LÉLU was actually thinking, speaking,
reasoning, or switching providers. Phase 8's report predicted exactly
this: "`ecosystem`... already sounds like it was built toward exactly
this kind of mutation and is currently under-read by the UI."

## What changed

- **New: `engines/GenesisSignals.ts`** — a small, ephemeral
  `GenesisSignals` interface (`thinking`, `speaking`, `listening`,
  `reasoningActive`, `planningActive`, `providerSwitched`,
  `engineErrorCount`) plus an `idleGenesisSignals` default. Never
  persisted — recomputed from `GenesisUIState` every time it changes.
- **`engines/EngineRegistry.ts`** — `GenesisEngine.update()` now takes
  an optional third `signals` param; `EngineRegistry.update()` accepts
  and forwards it (defaults to `idleGenesisSignals`, so every engine
  that doesn't care about signals is unaffected).
- **`engines/EngineRuntime.ts`** — threads the same optional `signals`
  param through to the registry.
- **`render/GenesisRenderer.tsx`** — now also reads `state` (the UI
  state) from `useGenesis()`, derives a `GenesisSignals` snapshot in a
  `useEffect` keyed on `thinking`/`speaking`/`listening`/`cognition`/
  `engineStatuses`/`messages` (not recomputed every frame — written
  into a ref, read once per frame inside `useFrame`), tracks the
  previous message's `provider` to detect `providerSwitched`, and
  passes the signals into `engineRuntime.update(universeState, delta,
  signals)`.
- **Three existing engines made signal-reactive** (additive — no new
  engines, no fork of the render tree, per the brief's explicit
  instruction):
  - `AwarenessEngine` — `awareness` still drifts ambiently, but now
    rises noticeably faster while `thinking || listening`, and relaxes
    back down once that stops.
  - `PulseEngine` — heartbeat tempo and energy gain both step up while
    `thinking || reasoningActive || planningActive`; a `providerSwitched`
    signal gives `evolutionSystem.mutation` a one-time jolt (handing off
    to a different model is a real discontinuity, not ambient noise);
    `engineErrorCount > 0` now feeds a new `evolutionSystem.instability`
    reading (this field already existed on `EvolutionState`, just
    unused) as a quiet, non-alarming drag rather than a warning.
  - `ConsciousnessEngine` — `intelligence` growth doubles while
    `reasoningActive`; `consciousness` rises visibly while `speaking`
    instead of blending into the same slow ambient average.

## Known pre-existing gap, not fixed here

`ConsciousnessEngine.update()` early-returns whenever `state.life <= 0`,
and `life` defaults to `0` and nothing in the reviewed code path raises
it. So today this engine — and by extension the `speaking`/
`reasoningActive` reactivity just added to it — stays completely inert
until something elsewhere sets `life` above zero (likely tied to
`GenesisMode` transitioning out of `DORMANT`). Didn't chase this down
this pass since it's a separate, pre-existing bootstrapping question,
not part of the signal-wiring gap. Worth checking first thing next
session — if `life` never gets set anywhere, `ConsciousnessEngine` has
never actually run in this build.

## Verification

No dev server available. Ran `tsc --noEmit` (via cached global
TypeScript, no project `node_modules`) against the touched files in
isolation:
- `GenesisSignals.ts`, `EngineRegistry.ts`, `EngineRuntime.ts`,
  `AwarenessEngine.ts`, `PulseEngine.ts`, `ConsciousnessEngine.ts` —
  **clean, zero errors** (these have no external deps beyond each
  other and the state types, so this check is meaningful).
- `GenesisRenderer.tsx` — checked against the same baseline of
  implicit-`any` / missing-module errors that every other `.tsx` file
  in this tree produces without `node_modules` present (react,
  react-three/fiber, JSX runtime). No new error classes beyond that
  baseline; the one new line (`universeState` implicit `any`) is the
  same missing-types noise every other frame-loop callback in the repo
  already has.

This rules out typos and signature mismatches. It does **not** verify
runtime behavior, tuning (are these constants visually convincing?),
or that `EngineBus`'s weight system doesn't fight with the new
`instability` value in a way that reads badly. Watch it run before
trusting the numbers.

## Still open (from the full Phase 10 brief)

1. **Persona system** (avatar vs. freespirit) — not started this pass.
2. **Window/desktop chrome** — floating, dockable, translucent panels
   over Genesis — not started.
3. **Rendering perf pass** — lazy loading, render-count reduction —
   not started.
4. **Chrome-level mutation** (dock/cards/panels shifting tone with
   mode, not just the core mesh) — not started; the signals now exist
   for it (`GenesisSignals` is exported, any component can read the
   same `state` this renderer reads) but nothing outside the 3D core
   consumes them yet.
5. **The `state.life` bootstrapping question** above.

Recommend treating each of 1–3 as its own session rather than trying to
land all four in one pass — same reasoning as this session split away
from the full brief.
