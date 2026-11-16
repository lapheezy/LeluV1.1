# LÉLU V1.1 — UNIFIED CANONICAL INTEGRATION

Spatial portal ownership · Mission 2.15.6 mobile placement · Session 02 environment orchestration

---

## 1. Latest canonical starting commit

`ce768e08` — remote HEAD of `claude/master-integration` (2026-11-07 20:52, 502 commits), verified with
`git ls-remote` after a fresh fetch. It is still the newest canonical work:

| Ref | Commit | Date | Relation to canonical |
| --- | --- | --- | --- |
| `claude/master-integration` | `ce768e08` | 2026-11-07 20:52 | canonical |
| `main` | `44bdd93` | 2026-10-08 | **ancestor** of canonical (older, not newer) |
| `claude/gallant-ritchie-v7i0fn` | `ce768e08` | — | same commit |
| `claude/cosmos-chat-experience-z6xja0` | `eb2fac3` | 2026-11-05 | already contained in canonical |

The Chat Universe work is already inside `ce768e08`, so the integration builds on it and does not
restore any deleted legacy chat panel or tab strip.

## 2. Source branches and exact commits integrated

| Stream | Branch | Commit | How it entered |
| --- | --- | --- | --- |
| Spatial 5.4B.9 | `claude/mission-5-4-spatial-interaction` | `fff0f86` | contained in `61b27c8` |
| Spatial 5.4B.10 | `claude/mission-5-4b-10-spatial-hardening` | `c7ef650` | contained in `61b27c8` |
| Spatial 5.4B.11 | `claude/mission-5-4b-11-canonical-integration` | `61b27c8` | **base of this integration** |
| Mobile 2.15.6 | `claude/mission-2-15-6-mobile-interaction-restoration-closure` | `14a6768` + `19ee1fc` | merged (no conflicts) |
| Session 01 interface layer | `claude/lelu-interface-control-d2sfdl` (`3eccc6d`) | in canonical | already present, kept canonical's newer copy |
| Session 02 orchestration | `codelazr/environment-orchestration-session-02-recovered-…` | `14903f0` | **two new modules lifted**, not merged |
| Session 02 (pre-recovery) | `codelazr/environment-orchestration-session-02-…` | `0a2050c` | examined; superseded by the recovered branch |
| Session 02.1 | — | **does not exist** | no branch, commit or file anywhere in the repo |

`61b27c8` is canonical `ce768e08` plus 12 spatial commits (portal field, press ownership, tween
driver, portal travel) — a real integration, not a divergent branch: `ce768e08` is its merge base and
its first-parent ancestor.

## 3. Final integration branch and commit

- Branch: **`claude/unified-canonical-integration`**
- Tip: three commits on top of `61b27c8` (see §4). Nothing was pushed to `claude/master-integration`.
- Nothing was reset, force-pushed or rebased. `claude/m52-acceptance-completion` @ `68fd4f9` and its
  four uncommitted paths are untouched.

## 4. Conflicts resolved and the reasoning

**Textual conflicts: none.** The mobile merge auto-merged; `git diff --diff-filter=U` was empty.

The real work was three **semantic** conflicts:

1. **Session 02's branch is 288 commits behind canonical and would have regressed it.**
   Merging `14903f0` wholesale deletes canonical capability: the 11 `studio.*` tools, `avatar.gesture`,
   `registerExecutor`/`unregisterExecutor`, `ApprovalGate` + `ToolStats` recording, four research
   focus entries and eight `describeToolCall` labels. Its `src/core/interface/` copies are *older*
   than canonical's (`InterfaceTools.ts` is 102 lines shorter).
   **Resolution:** canonical keeps its registry, dispatcher, approval gate, stats and interface layer.
   Only the genuinely new files were taken — `src/core/orchestrator/EnvironmentOrchestrationEngine.ts`
   and `src/core/orchestrator/EnvironmentTools.ts` — and their six tools were registered into the one
   existing registry and the one existing dispatch table. No second registry, dispatcher, engine,
   scene model or persistence system exists.
2. **Model-facing tool names cannot contain dots.** `environment.present_artifact` becomes
   `environment_present_artifact`, and canonical's `registryIdForToolName` (replace every `_` with `.`)
   turns that into `environment.present.artifact` — a tool that does not exist. The model would be
   offered five of the six tools and every call would fail.
   **Resolution:** resolution now checks the real executor table first, then the split after the
   namespace, then falls back to the old rule. Multi-segment ids resolve; every other tool is unchanged.
3. **Keyword resolvers would have claimed environment requests before the model saw them**
   (`context.intent === "project"` → `ProjectResolver`; the creative scaffold also fires on "design").
   **Resolution:** one narrow guard, `modelCanComposeEnvironment`, in the same style as the existing
   `modelCanBuildInStudio`/`modelCanDoEngineeringWork` stand-asides: it is true only when
   `environment_compose` is genuinely offered *and* the request is environment-shaped. Where the tools
   are not offered, routing is exactly as before.

Spatial vs mobile on the same files: `SpatialNavigator.tsx`, `PortalRegistry.ts` and
`GenesisModuleHost.tsx` auto-merged with both feature sets intact — portal registry seeding and press
ownership from the spatial line, `committedRect`/`isManual` geometry ownership from the mobile line
(verified by symbol count after the merge, plus the live runs below).

## 5. Existing architecture preserved

- One `ToolRegistry`, one `ToolDispatcher.BY_ID`, one `WorkspaceEngine`, one `InterfaceOrchestrator`,
  one `EnvironmentOrchestrationEngine` singleton, one spatial presenter, one `PortalRegistry`.
- The Chat Universe surface is untouched (no legacy chat component restored).
- The mobile geometry contract survives the merge: default → live gesture → committed manual rect →
  viewport clamp; the host's sync effect still refuses to overwrite a manual placement.
- The spatial press lifecycle survives: ownership claimed on pointer-down, resolved against the
  claimed portal on release, pointer-id validated, threshold and cancellation preserved.

## 6. Cognition → tool → renderer connections established

```
user message
  → AIRouter.route (src/core/AIRouter.ts)
      · modelCanComposeEnvironment stand-aside keeps environment requests with the model
  → ProviderResolver.execute (src/core/router/ProviderResolver.ts)
      · offer = ToolRegistry ∩ ToolDispatcher.executableToolIds ∩ AutonomyGate
        (src/core/tools/ToolSchemas.ts) — the six environment tools are in it
      · tool loop: response.toolCalls → dispatchToolCall
  → ToolDispatcher.dispatchToolCall (permission gate, AgentEventBus events)
  → ENVIRONMENT_EXECUTORS (src/core/orchestrator/EnvironmentTools.ts)
  → EnvironmentOrchestrationEngine / WorkspaceEngine
  → the workspace views the renderer draws; KvStore snapshot for restore
```

The same loop covers `environment.compose`, `present_artifact`, `mutate_surface`,
`manage_workspace`, `save_state`, `restore_state`. Geometry: mobile drags commit through
`ModuleLayoutStore.place()` and restore through the committed rect path.

## 7. End-to-end workflows

| Test | Path exercised | Result |
| --- | --- | --- |
| **A. Spatial interaction** | real app, Chromium: 3 press-origin rows (`files`, `studio`, `files`) | **PASS** — `claimed == resolved == landed` for all three, 1.4–3.0 s; one further load produced no press point (unmeasured, not a failure) |
| **B. Mobile placement** | real app, 360×640 / 375×812 / 390×844 / 430×932 | **PASS** — touch drag +80 px live, commit at release, next drag starts from the commit, pin→unpin keeps geometry, reload Δ 0 on all four axes, 1 canvas / 1 host |
| **C. Environment creation** | scripted provider → real tool loop → `environment.compose` → workspace | **PASS** — surfaces created, layout `split` |
| **D. In-place mutation** | same loop → `environment.mutate_surface` | **PASS** — same view id, revision advanced, view count unchanged |
| **E. Artifact presentation** | same loop → `environment.present_artifact` | **PASS** — diagram view in the existing workspace |
| **F. Workspace management** | same loop → `environment.manage_workspace` | **PASS** — layout became `grid` |
| **G. Save / restore** | same loop → `save_state`, `workspace.clear()`, `restore_state` | **PASS** — views, titles and layout restored; snapshot present in device storage |
| **H. Continued autonomy** | turns 2→5 run against the same workspace in sequence | **PASS** (scripted model) |

Mobile detail (integrated build): touch `pointerType: touch`, 1 down / 6 move / 1 up on the chrome;
pointer 13 moves on the chrome; release store `manual:true`; 360×640 second drag 217 → 117 committed,
reload 117 (Δ 0).

**Honest limits of this evidence:** C–H run the production tool loop with a *scripted* provider
returning real `AIResponse.toolCalls`. No provider key or network was available, so no live model
chose these tools; what is proven is the wiring from a model tool call to the rendered surface, not a
model's judgement. A and B are Chromium input on a software renderer, not physical devices.

## 8. Build, lint, typecheck, tests

| Gate | Result |
| --- | --- |
| `bunx tsc -b --force` | **PASS** (exit 0) |
| `bun run build` | **PASS** (exit 0) |
| `bun run lint` | **PASS** — 0 errors, 133 warnings (pre-existing) |
| `bun run test` | **PASS** — 1,824 pass, 0 fail, 6 skipped (182.1 s) |
| `tests/environment-integration.test.ts` | **PASS** — 7/7, the real `ProviderResolver` loop |

One pre-existing source-shape assertion (`engineering-chain.test.ts`) locked the literal text of the
creative stand-down guard; it was updated to the new guard and extended to assert the environment
stand-down exists — the behaviour it protects is unchanged and broader.

## 9. Remaining blockers and unverified capabilities

1. **No live model turn.** No provider credentials/network in this environment, so "LÉLU decides by
   herself" is proven at the tool-offer and dispatch level, not against a real model.
2. **Persistence is local-device only.** Environment snapshots go through `KvStore` → `localStorage`;
   live workspace views are in memory and restored from a snapshot. There is **no** server-backed or
   cross-device persistence, and none is claimed.
3. **Spatial rows:** one of four portal loads produced no press point, so its row is unmeasured.
4. **Rendering:** software renderer only; hardware GPU behaviour and physical touch unverified.
5. Session 02.1 does not exist in the repository; nothing was invented to represent it.
6. `environment.mutate_surface` cannot change a surface's `kind` (only text/spec/title/state); a
   different kind is a new surface by design.

## 10. Ready for canonical integration?

**Functionally yes, with the caveats above.** The three streams run in one application on one
canonical base: every gate is green, both spatial behaviour and mobile restoration hold on the
integrated build, the six environment tools travel the real cognition→dispatcher→renderer path, and
no capability from canonical was deleted to get there.

It is **not** a complete validation of autonomous behaviour: that needs a configured provider and a
real model turn, which this environment cannot supply.
