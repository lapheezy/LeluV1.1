# Master integration — file-by-file record

Integration branch **`claude/master-integration`**. It was created from
`claude/cosmos-chat-experience-z6xja0` @ `eb2fac3` after every other session reported idle on
2026-11-05 at ~22:10Z (no test runs in flight). **No source branch was written to.**

| Stage | Merged | Head merged | Result | Regression set after the stage |
|---|---|---|---|---|
| 1 | Session 1 — Phase 1, 1A, 1B, acceptance (`claude/avatar-3d-world`) | `616f251` | **clean** (65 files) | 132/132, 14 files; `tsc -b` clean |
| 2 | Cognition line — Fireworks-first routing, Kimi coding route, Anthropic opt-in (`claude/lelu-continuous-cognition-92p3jy`) | `441fb51` | 2 files conflicted | 184/184, 19 files |
| 3 | Interface orchestration (`claude/lelu-interface-control-d2sfdl`) | `3eccc6d` | 6 files conflicted, the rest auto-merged | **234/234, 23 files**; `tsc -b` clean; canary bundle scan **ALL PASSED** (46 checks) |

Phase 6 and the security fix (`9b0cd3e`) were already on the base branch.

## Every conflict, and how it was resolved

Rule: keep the behaviour and intent of both sides. Where both sides built the same thing,
keep **one** implementation, the one that was verified or is shared, and carry over the
other side's unique features.

### Stage 2

| File | Hunks | Resolution |
|---|---|---|
| `src/core/model/ModelRouter.ts` | 2 | **Coding-first block** (cognition): kept. Session 1's line had none. **Default-provider resolver:** cognition's `providerNameForToken()` was kept. Session 1's line returned `"Anthropic"` when nothing was configured, which contradicts the Anthropic-opt-in policy. The token map is shared by both callers. |
| `src/providers/FireworksProvider.ts` | 3 | Both sides added streaming independently. **One reader:** Session 1's shared `readOpenAIStream`, which Groq and OpenRouter also use. From cognition: `stream_options.include_usage` (real token counts) and `timeoutFor()` (180 s for coding). Only `response.ok` is streamed, so an error status reaches the detailed error path that logs the model id. That's how the undeployed K2.7 Code 404 stays visible. Cognition's duplicate `generateStreamed()` (83 lines) was **removed**. Its own streaming test passes on the shared reader (`kimi-coding-route` 7/7). |

### Stage 3

| File | Hunks | Resolution |
|---|---|---|
| `GenesisWindowFrame.tsx` | 2 | Both sides added the same React context, under file names that differ only in case: `moduleWindowContext.ts` (`InModuleWindow`, Session 1) and `ModuleWindowContext.ts` (interface-control). Those two names **collide on macOS and Windows checkouts**. Kept Session 1's and **deleted** `ModuleWindowContext.ts`. Interface-control's second "embedded body" render path was removed. Session 1's single module-window path (verified by its Phase 1 gate) already carries `data-lelu-surface="panel"` and `data-lelu-text="title"`, so interface themes still reach embedded panels. |
| `GenesisModuleHost.tsx` | 9 | Session 1's window manager is kept intact (`InModuleWindow`, `data-lelu-module-window`, `data-presentation`, `genesisTheme` look). Interface-control's hooks were **added beside it**: `data-lelu-surface="window"`, `data-lelu-window`, `data-lelu-interacting`, `data-lelu-text="title"`, the density `zoom`, and `position: relative` on bodies (keeps panel overlays off the title bar). Every themeable property is `var(--lelu-…, <Session 1's genesisTheme value>)`, so with no theme set the window looks exactly as Session 1 shipped it. |
| `GenesisChat.tsx` | 5 | Session 1 rebuilt the chat (`lelu-cc` sky, header, measured centring). Interface-control edited the old one. **Kept Session 1's chat** and did not reintroduce the deleted floating-text styles, typewriter or old title bar. **Ported:** the `lelu-interface-chat-layout` listener (approved layouts place and size the chat; phones stay full-screen), an exact size from a layout (`chatCustomSize`, still clamped to the measured workspace and cleared by a hand-picked size), `data-lelu-surface="chat"`, `data-lelu-window="chat"`, `data-lelu-chat-minimized`, and theme variables over Session 1's radius, border and shadow. |
| `GenesisInterface.tsx` | 1 | Session 1 no longer renders the dock here. Imported only `MODULE_CATALOG` (interface-control's module labels) and restored `GenesisErrorBoundary`, which interface-control wraps around its consent bar. |
| `src/index.css` | 1 | Two independent blocks appended at the same place; **both kept** (Cosmos↔chat rules, then the token-scoped `html[data-lelu-theme]` design layer). |
| `tests/README.md` | 1 | Two appended notes; both kept. |

Preserved and not changed by the integration: GenesisChat's transcript architecture (one
transcript writer), AIService, AIRuntime, the provider registry, ProviderResolver, memory and
personality systems, agent orchestration, Cosmos rendering, and tool permissions.
