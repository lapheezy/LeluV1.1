# LÉLU — Phase 5: Reasoning/Planning become part of live cognitive state, and visible

## Scope of this pass

`PHASE_4_REPORT.md` closed the routing gap (Reasoning and Planning now run on
every request) but named three things it deliberately left undone:

1. Reasoning/Planning output only ever reached `AIResponse.metadata` — it
   never touched `CognitiveCore` / `WorkspaceManager`, so Genesis's live
   state didn't reflect it.
2. No UI surfaced the data at all.
3. None of it had been checked against a compiler (no `npm install` /
   `tsc` available in that environment either).

This pass closes (1) and (2) for Reasoning and Planning specifically, and is
honest below about what's still unverified on (3).

**Same environment constraints as Phases 3–4: no network access, no
`node_modules`.** I could not run `npm install`, `tsc -b`, `vite build`, or
Playwright. Verification here is two things: a re-run of the same
import-graph walk Phase 3/4 used (rewritten from scratch again — the script
still isn't carried in the repo, see "left undone" below), and a manual
brace/paren/bracket balance + Node syntax check on every changed file (`node
--check` for `.ts`, since Node can parse plain TS syntax; a Python
bracket-counter for the `.tsx` files, since Node's ESM loader rejects `.tsx`
outright). Result: **187 reachable files, 0 broken imports, 0 orphans**,
every changed file syntactically balanced. That is still "provably wired
and syntactically sound," not "known to compile" — see caveats.

## What changed

**Data layer — Reasoning/Planning now flow into live cognitive state:**

- `core/cognition/CognitiveCore.ts` — added `recordReasoning()` and
  `recordPlan()`. Each stores the latest result and appends a one-line
  summary into the existing `"core"` workspace via `WorkspaceManager` (no
  new workspace type invented — reused what was already there, per "evolve,
  don't replace"). `state()` now returns `reasoning` and `plan` alongside
  the existing `nodes` / `connections` / `agents` / `workspaces`.
- `brain/CognitionRuntime.ts` — added `think(reasoning, plan)`, which calls
  the two new `CognitiveCore` methods and broadcasts the same `"update"`
  cognition event `observe()` already uses, so existing subscribers don't
  need to know a new event type exists.
- `brain/Brain.ts` — added `recordThinking(reasoning, plan)`, a thin public
  forward to `cognitionRuntime.think()`. Extended `cognitiveState()`'s
  return type to include `reasoning` / `plan` (it already just returns
  `cognition.state()`, so this was a type-only change).
- `core/AIService.ts` — `chat()` now reads `response.metadata.reasoning` /
  `.plan` (already populated by `AIRouter.attachThinking`, per Phase 4),
  calls `runtime.brain.recordThinking()` with them, includes them on the
  emitted `AIMessageEvent`, and includes them on the emitted
  `CognitionEvent` (pulled from `cognitiveState()` right after). Both event
  interfaces gained optional `reasoning?` / `plan?` fields — additive, no
  existing consumer's shape changed.
- `app/scene/genesis/GenesisBridge.ts` — the `subscribeCognition` and
  `subscribeMessages` callbacks now forward the new fields into
  `updateCognition()` / `addMessage()`, which is the "single source of
  truth" bridge this file already describes itself as.

**Interface layer — Reasoning/Planning are now inspectable:**

- `app/scene/genesis/GenesisCore.tsx` — `GenesisCognitionState` gained
  optional `reasoning?: unknown` / `plan?: unknown` (kept untyped against
  the AI-core interfaces on purpose, matching how `agents` / `workspaces` /
  `nodes` are already loosely typed here — this file is deep in the
  Three.js scene subtree and shouldn't need to import AI-core reasoning
  types to compile). `GenesisMessage` gained the same two optional fields.
  `GenesisPanel` gained a `"reasoning"` variant alongside the existing
  `"chat" | "history" | "logs" | "workspaces" | "agents"`.
- `app/scene/genesis/GenesisChat.tsx` — when a response comes back from
  `ai.chat()`, it now also pulls `reasoning` / `plan` off
  `response.metadata` and attaches them to the assistant's `addMessage()`
  call, so each message can carry its own reasoning/plan snapshot.
- **New: `app/scene/genesis/GenesisReasoningPanel.tsx`** — a DOM overlay
  panel, styled consistently with the existing `GenesisChat` panel (same
  glass/blur/cyan-border language already established in
  `GenesisInterface.tsx` — no new visual language introduced). Shows:
  - **Reasoning**: the winning hypothesis's explanation, plus every
    candidate hypothesis ranked by confidence with a bar underneath —
    matching what `ReasoningResolver` actually evaluates (recalled-memory /
    injected-context / plan-driven / knowledge-lookup / general-knowledge).
  - **Planning**: the active plan's goal and its steps, each with a
    status dot (pending/running/completed/failed) reusing `PlanStep`'s own
    status enum.
  - Empty states for both when nothing has run yet, so it's never a blank
    or broken-looking panel on first load.
- `app/scene/genesis/GenesisInterface.tsx` — added a "Reasoning" button
  next to the existing "Open chat" / "Core" / "Research" / "Create"
  quick-action row, and mounted `GenesisReasoningPanel` in the same
  `AnimatePresence` region the chat panel already uses, toggled by
  `state.activePanel === "reasoning"` — mutually exclusive with chat, same
  pattern the codebase already uses for panel switching.

## What this does *not* claim to do

- **Still not verified by compilation.** Every changed file passed a
  syntax check (`node --check` for `.ts`, bracket-balance for `.tsx`) and I
  re-read each one against the interfaces it imports, but that is not the
  same guarantee `tsc -b` gives you. The most likely failure class if
  something's wrong: a type mismatch `tsc` would catch and a syntax-level
  check can't (e.g. an incompatible prop type). I did fix one real bug this
  way before it left the sandbox: an initial draft of
  `CognitionRuntime.think()` used `Parameters<typeof this.core.recordX>[0]`
  as a parameter type, which reads fine but is not valid in that position —
  replaced with direct `ReasoningResult` / `Plan` type imports.
- **The Reasoning panel only shows the *latest* result, not history.**
  `CognitiveCore` stores `latestReasoning` / `latestPlan` as single fields,
  not a log. A history view (e.g. "show me the reasoning behind message
  #12") would need per-message storage on the `GenesisMessage` itself —
  the field (`message.reasoning` / `message.plan`) is already there from
  this pass, just not rendered per-bubble yet. Natural next step.
- **Planning's step statuses don't update live from the panel yet.**
  `PlanStep.status` is set once when `PlanningResolver` builds the plan and
  calls `engine.start()`; nothing currently advances a step from `pending`
  to `completed` as work happens, so today every panel view shows the plan
  at its initial state. Real step progression would need `PlanningEngine`
  wired to whatever "Task Execution" ends up meaning for this app — same
  open question Phase 3 flagged and didn't resolve.
- **`scripts/verify-provider-pipeline.ts` is still broken**, same as
  reported in Phase 3 — not touched this pass, still stale tooling
  referencing files that never existed under those names.
- **The import-graph verification script still isn't checked into the
  repo.** I rewrote it a third time this session (`verify-imports.mjs`, not
  copied into `scripts/` since it lives outside the project in this
  environment). Worth actually committing it once there's a real
  filesystem to commit from, so the next pass doesn't rewrite it a fourth
  time.
- **No other engine from the brief was touched.** This pass is scoped to
  Reasoning + Planning becoming visible, which was the specific, concrete
  gap already identified and queued. Memory, Research, Knowledge, Tool,
  Provider engines, and the ~90-file Three.js scene graph itself are
  unchanged.

## Recommended next step

1. Get a real build environment (`npm install` + `tsc -b` + `vite dev`) so
   this pass — and the backlog below — can be compiled and visually
   verified instead of statically reasoned about.
2. Render `message.reasoning` / `message.plan` per-bubble in `GenesisChat`
   (data's already flowing per this pass; just needs the small collapsible
   UI under each assistant message).
3. Decide what "Task Execution" means for a chat-driven app, then wire
   `PlanningEngine`'s step statuses to actually advance — this is the piece
   that would make the Planning panel show real progress instead of a
   static snapshot.
4. Only after (1) is available, start the broader per-engine integration
   pass (Memory, Research, Knowledge, Tools) the brief asks for, each
   verified against a running dev server rather than static analysis.
