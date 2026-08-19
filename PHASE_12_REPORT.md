PHASE 12 — GENESIS DESKTOP EVOLUTION (slice 1: the floating-glass-window foundation)

## Scope of this pass

The Phase 12 brief asks for "floating glass windows, layered depth,
better translucency, softer shadows, spatial positioning, consistent
elevation, better workspace hierarchy" and explicitly says: lay a
clean foundation, don't build every desktop feature this phase.

Phase 10 and 11 both independently flagged the same gap under "Still
open": *"Window/desktop chrome — floating, dockable, translucent
panels over Genesis — not started. GenesisDock is chrome, but it's a
fixed rail/bar, not the floating-window layer the brief describes."*
This session closes the specific, highest-leverage piece of that gap:
the nine floating surfaces that already exist (chat + 8 panels) were
each independently re-implementing the identical window chrome —
same spring animation, same glass background, same header/close-button
markup, differing only in width and title text. That's the foundation
this phase builds: one shared component, migrated everywhere, with
real elevation/depth added on top.

**Done without a build environment**, same constraint as Phases 10–11:
no `node_modules`, no dev server, no visual verification in a browser.
Verified via isolated `tsc --noEmit` (see "Verification" below) — this
rules out typos and prop mismatches, not whether the new shadows and
blur actually look convincing on screen.

## What changed

- **`GenesisTheme.ts`** — added an `elevation` token group: three named
  depth levels (`chrome`, `float`, `focus`), each a layered
  `boxShadow` (tight dark contact shadow + wide tinted glow + a subtle
  inset top highlight so glass reads as glass, not a flat tinted
  rectangle) paired with its own blur strength. Replaces the old
  single flat `glass.shadow` for every floating surface — that field
  is kept on the theme object so nothing that still reads it directly
  breaks, but no window chrome uses it anymore. Also softened
  `glass.panel` / `glass.panelAlt` opacity slightly (0.95 → 0.92,
  0.75/0.7 → 0.68/0.65) per the brief's "better translucency" note —
  panels now let a little more of Genesis show through.
- **New: `GenesisWindowFrame.tsx`** — the shared floating-glass-window
  component. Owns: the entry/exit spring animation, the glass
  background/border/radius/elevation, the header row (eyebrow label +
  title + optional extra actions + close button), and a signal-reactive
  `active` state that applies the same `.genesis-signal-active` pulse
  class Phase 11 added to the dock — so a panel showing something
  genuinely live (an error count, a running plan) can visually say so
  using the exact same language the dock already uses, instead of each
  panel inventing its own "this matters" affordance.
  - `elevation` prop selects `chrome` / `float` / `focus` — chat (the
    surface actively receiving input) now sits at `focus`, the
    strongest depth; every inspector panel sits at the standard
    `float` level.
  - `background`, `overflow`, and `beforeHeader` are escape hatches
    for chat's bespoke look (cyan-tinted `panelAlt` background, a
    decorative top-glow line, `overflow: hidden` instead of a
    scrolling body) — added so chat didn't need its own one-off
    component just to be 90% identical to every other window.
- **Migrated onto `GenesisWindowFrame`** (chrome fully replaced, panel
  body/logic untouched): `GenesisReasoningPanel`, `GenesisDiagnosticsPanel`,
  `GenesisMemoryPanel`, `GenesisProvidersPanel`, `GenesisKnowledgePanel`,
  `GenesisHistoryPanel` (its extra "Clear" button now uses the new
  `extraActions` slot), `GenesisWorkspacesPanel`, `GenesisLogsPanel`,
  and the chat window in `GenesisInterface.tsx`. All nine call sites
  now differ only in the three or four props that were ever actually
  different (title, width, an `active` flag on Diagnostics/Logs/
  Reasoning tied to a real condition — error count > 0, a running
  plan/hypothesis). Each file lost its ~25-line duplicate chrome block;
  `GenesisDiagnosticsPanel`, `GenesisMemoryPanel`, `GenesisProvidersPanel`,
  `GenesisKnowledgePanel`, `GenesisHistoryPanel`, `GenesisWorkspacesPanel`,
  and `GenesisLogsPanel` no longer need their own `motion` import at
  all, and `GenesisInterface.tsx` no longer imports `motion` either
  (only `AnimatePresence` remains, since `GenesisWindowFrame` owns the
  actual `motion.div`).
- Wired three panels' `active` state to something real rather than
  cosmetic: `GenesisDiagnosticsPanel` and `GenesisLogsPanel` pulse when
  their error/failure count is above zero; `GenesisReasoningPanel`
  pulses while a hypothesis is selected or a plan is running. Every
  other panel passes no `active` prop and renders exactly as before.

## What this is not

Per the brief's own "do not attempt every feature" instruction, this
pass is chrome unification + depth, not a rewrite of the panel-mounting
model. `state.activePanel` in `GenesisCore.tsx` is still a single
value — Genesis still mounts exactly one floating window at a time.
True simultaneous floating windows (drag to reposition, several open
together, z-order between them) are a separate, larger change to that
state shape and are explicitly left for a future phase, same reasoning
Phases 10–11 gave for splitting persona/perf/chrome into their own
sessions rather than landing all of Phase 10's brief in one pass.

## Verification

No dev server available (same constraint as Phases 10–11). Checked
every touched file with `tsc --noEmit` against a stubbed local `react`
+ `framer-motion` module shape (removes the missing-`node_modules`
noise that every `.tsx` file in this tree produces, so the check is
meaningful rather than drowned out):

- `GenesisWindowFrame.tsx` in isolation against the stubs plus the real
  `GenesisTheme.ts` — **zero errors**. Confirms the `elevation` lookup,
  every prop's type, and the JSX structure are all internally
  consistent.
- All nine migrated files (`GenesisReasoningPanel.tsx`,
  `GenesisDiagnosticsPanel.tsx`, `GenesisMemoryPanel.tsx`,
  `GenesisProvidersPanel.tsx`, `GenesisKnowledgePanel.tsx`,
  `GenesisHistoryPanel.tsx`, `GenesisWorkspacesPanel.tsx`,
  `GenesisLogsPanel.tsx`, `GenesisInterface.tsx`) — checked for syntax
  errors (unclosed JSX, unbalanced braces, malformed edits) specifically,
  since a full type-check of each would mean stubbing out every one of
  their other imports (`AIService`, `useGenesis`, etc.). **Zero syntax
  errors across all nine.**
- Manually cross-checked every `<GenesisWindowFrame ...>` call site
  against `GenesisWindowFrameProps` — all nine pass only props that
  exist on the interface, and every dynamic value referenced in a
  `title`/`active` expression (`summary.errors`, `failures`,
  `reasoning?.selected`, `plan?.status`, `state.messages.length`, etc.)
  already existed in that panel's own scope before this pass.
- No formatter was available to run (no `prettier` in this environment,
  same as prior phases) — touched code was hand-formatted to match the
  existing two-space, trailing-comma-light style already used
  throughout `src/app/scene/genesis/`.

This rules out typos, prop-shape mismatches, and structural breakage.
It does **not** verify that the new elevation shadows, the softened
translucency, or the `active` pulse actually read well in a browser —
recommend `npm install && npm run dev` and opening Reasoning (send a
message first) and Diagnostics (with at least one engine erroring, if
that's reproducible) to eyeball the pulse before trusting the tuning.

## Still open

1. **Persona system** (avatar vs. freespirit) — not started, carried
   over from Phases 10–11.
2. **True simultaneous floating windows** — multiple panels open at
   once, draggable/repositionable, real z-order between them. This
   phase gave every window the *same visual language*; it did not
   change the one-panel-at-a-time mounting model. That's the natural
   next step once this foundation is confirmed to look right in a
   browser.
3. **Rendering perf pass** — lazy loading, render-count reduction —
   not started, carried over from Phases 10–11.
4. **Genesis visibility modes** (Full Workspace / Balanced / Focus
   Workspace / Focus Genesis / Full Genesis) from the brief — not
   started this pass. Today's model is closer to "one window or none";
   the brief's modes imply continuous translucency/scale states between
   fully-open and fully-hidden, which is a real interaction design
   question worth its own session rather than bolting onto window
   chrome unification.
5. Confirm in a real browser that the softened panel opacity doesn't
   hurt text legibility over a busy Genesis background — everything
   here is statically verified, not visually verified.

Recommend treating 2 and 4 as their own sessions, same reasoning as
Phases 10–11 gave for not landing persona/chrome/perf all at once —
each is a real interaction-design subsystem, not a mechanical follow-on
to this pass.
