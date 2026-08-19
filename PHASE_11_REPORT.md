PHASE 11 — GENESIS UI EVOLUTION (slice 1: chrome-level signal consumption)

## Scope of this pass

Phase 10 wired `GenesisSignals` (thinking/speaking/reasoning/provider
switches/engine errors) into the 3D core, but flagged explicitly that
"nothing outside the 3D core consumes them yet." This session closes
that specific gap for the one piece of chrome that's always on
screen — `GenesisDock` — and resolves the open `state.life`
bootstrapping question from Phase 10 by tracing it rather than
guessing. Persona system, window/desktop chrome, and the rendering
perf pass are all still open — see below.

**Done without a build environment**, same as Phase 10: no
`node_modules`, no dev server, no visual verification. Verified by
isolated `tsc --noEmit` against the touched files (stubbed local
module shapes to remove noise from the missing `node_modules`, see
"Verification"), plus manual cross-checking of field names against
`GenesisUIState` in `GenesisCore.tsx`. Whether the pulse timing/colors
actually read well in the browser is unverified — recommend running
`npm install && npm run dev` before trusting the visual tuning.

## Resolved: the `state.life` question from Phase 10

Phase 10's report flagged that `ConsciousnessEngine` early-returns
while `state.life <= 0` and wasn't sure anything ever raises `life`
above zero. Traced it this session:

- `GenesisSimulation.ts` (registered in `EngineBootstrap.ts`, ticks
  every frame via the normal engine registry — confirmed, not gated
  behind any mode check beyond `state.paused`) raises `state.life`
  whenever `state.energy > 0.25 && state.matter > 0.15`, at
  `dt * 0.03`.
- `state.energy` climbs at `dt * 0.12` from app start, `state.matter`
  climbs proportional to `energy`. `state.paused` defaults to `false`.
- So `life` genuinely does leave zero within roughly the first 10–20
  seconds of the app running, unconditionally — this is the
  intentional "5–10 second awakening sequence" the file's own comment
  describes, not a broken gate.

**Conclusion: not a bug.** `ConsciousnessEngine` (and by extension the
`speaking`/`reasoningActive` reactivity Phase 10 added to it) is
inert only during that brief startup window, by design. No code
change needed here — closing this out as verified, not fixed.

## What changed (chrome-level mutation)

- **`src/index.css`** — added one shared `@keyframes
  genesis-signal-pulse` + `.genesis-signal-active` class. Global and
  reusable on purpose: Phase 10's report anticipated more than one
  chrome surface would eventually want to reflect live signals, so
  this is defined once rather than re-invented per component.
- **`GenesisDock.tsx`** — `GenesisDockProps` gained four *optional*
  fields (`thinking`, `speaking`, `reasoningActive`,
  `engineErrorCount`), all defaulting to inert so any other caller
  that doesn't pass them renders exactly as before:
  - The status dot (previously just online/booting) now also reflects
    "thinking or speaking" (accent color, pulsing) and "engines
    reporting errors" (error color, takes priority, no pulse — a
    problem shouldn't look like a heartbeat). Tooltip text updated to
    match (`Live` / `Booting` / `Thinking` / `Speaking` / `N engines
    reporting errors`).
  - The "Reasoning" dock item gets an accent ring + the shared pulse
    class while `cognition.reasoning` is truthy.
  - The "Engines" (diagnostics) dock item gets a static error-colored
    border when any engine in `engineStatuses` has `.error` set.
  - Applied to **both** the narrow (mobile, bottom bar) and wide
    (desktop, side rail) render branches identically — per the
    project's "one adaptive interface, not two builds" rule, not just
    the desktop one.
- **`GenesisInterface.tsx`** — one call site updated to pass
  `state.thinking`, `state.speaking`,
  `Boolean(state.cognition?.reasoning)`, and
  `state.engineStatuses.filter(e => e.error).length` into
  `GenesisDock`. No new state, no new hooks — every value already
  existed in `state` from `useGenesis()` at this call site (confirmed
  by the pre-existing `state.cognition?.workspaces` usage two lines
  above it).

## Verification

- `GenesisDock.tsx` checked in isolation (`tsc --noEmit`, stubbed
  `GenesisPanel` type to remove the one external import): zero errors
  beyond the expected `node_modules`-missing baseline (react/JSX
  runtime not found — the same class of noise every `.tsx` file in
  this tree produces without `node_modules`). No new error classes —
  no property mismatches, no signature errors, no typos.
- `GenesisInterface.tsx` — the four new prop values were checked by
  hand against `GenesisUIState`'s actual field declarations in
  `GenesisCore.tsx` (`thinking:boolean`, `speaking:boolean`,
  `cognition:GenesisCognitionState | null`,
  `engineStatuses:EngineStatus[]`, `EngineStatus.error?:string`) —
  all four line up. Not run through isolated `tsc` this pass (the
  file has many more internal imports than `GenesisDock.tsx` and
  isolating it meaningfully would mean stubbing most of the module);
  flagging this as a lower-confidence check than the dock file itself.

## Still open

1. **Persona system** (avatar vs. freespirit) — not started.
2. **Window/desktop chrome** — floating, dockable, translucent panels
   over Genesis — not started. `GenesisDock` is chrome, but it's a
   fixed rail/bar, not the floating-window layer the brief describes.
3. **Rendering perf pass** — lazy loading, render-count reduction —
   not started.
4. **Chrome-level mutation beyond the dock** — the nine panels
   (`GenesisReasoningPanel`, `GenesisMemoryPanel`,
   `GenesisProvidersPanel`, etc.) don't consume `GenesisSignals` yet
   either. The dock was the highest-leverage single surface (always
   visible, one call site) — the panels are naturally next but each
   is its own component with its own state needs, worth separate
   passes rather than one sweep.
5. Confirm in a real browser that the pulse timing (1.4s) and the
   accent/error color choices actually read as intended — everything
   in this report is statically verified, not visually verified.

Recommend the same approach as Phase 10: treat 1–3 as their own
sessions. Given the size of each (persona system and floating window
chrome are both substantial UI subsystems on their own), landing them
in one pass risks exactly the "half-finished system" outcome the
continuation protocol asks to avoid.
