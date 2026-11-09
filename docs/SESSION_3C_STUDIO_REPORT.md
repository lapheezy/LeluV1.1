# Session 3C — the software studio

**Branch:** `freebuff/167b4bf50af49d39b2714564` (started from `claude/open-session-rbwmdw`, HEAD `e7b667b`).
Nothing was deployed to production and nothing was committed or pushed.

## What was added, and what it reuses

| Concern | Reused | Added |
|---|---|---|
| Projects on disk | engineering runtime patterns (`/api/engineer/*`, same-origin + token guard) | `plugins/studioApi.ts` — scaffold, tree/read/write, build, test, preview, approvals, deployment preparation |
| Cosmos windows | `GenesisModuleHost` floating windows, `GenesisPanel`, `MODULE_CATALOG` | `GenesisStudioPanel` registered as module `studio` |
| Tools | `ToolRegistry` + `ToolDispatcher` (one dispatch table) | 13 `studio.*` entries and executors, appended to the same table |
| Persistence | `KvStore` | `StudioLibrary` (versions, builds, tests, assets, deployments) and `StudioPipeline` |
| Agents / orchestration | untouched: SHAMAN, `TaskEngine`, `BackgroundEngine` | no second agent system |
| Assets | Session 3B's `leluverse/forge/ledger.json` and character references | `StudioAssets` reads the ledger; unrun Meshy jobs stay `awaiting_approval` |
| Human authority | `EngineeringAuthorization` pattern (non-persisted, expiring, scoped) | `StudioApprovals` client queue + server approval file with an explicit `x-lelu-user-confirmed` header |

### Engine decision, not engine preference

`StudioEngines.recommendEngine` decides from requirements and a measured probe:

- website / application → **web technologies** (static + Node backend), because that is what the
  runtime can actually build, test and preview.
- games → **web (three.js)** for browser delivery; **Godot** for native desktop/mobile with a small
  team and multiplayer; **Unreal** for photoreal, large-team desktop.
- Godot/Unity/Unreal are reported `not-installed` unless a real binary is found. Their recommendations
  carry `supported: false` and the reason, so a plan never claims a build this runtime cannot make.

### Safety boundaries

- Writes are confined to `.lelu-studio/<slug>/`; `..` and absolute escapes are refused.
- A write whose content would expose `VITE_*`/`NEXT_PUBLIC_*` values or a known key shape is refused,
  naming the line and variable, never the value.
- Build and test run fixed commands (`node scripts/build.mjs`, `node --test --test-reporter=tap tests/`),
  never caller-supplied shell.
- Approvals: LÉLU's tools can only *request*. Granting requires the Studio panel's click, which sends
  `x-lelu-user-confirmed: 1`. Approvals are scoped to one project/action and expire after 15 minutes.
- Production deploy additionally requires a live approval whose id matches exactly.
- Publishing only copies to `STUDIO_PUBLISH_TARGET` when that is configured; otherwise the result is
  honestly `prepared`, not `published`.

### Previews

`/api/studio/serve/<slug>/` serves the real `dist/` output same-origin, so an iframe inside a
movable Cosmos window works in dev and through the cloud preview. Application projects declare a
backend in `studio.json`; the runtime starts that real Node server and proxies the preview to it, so
relative `/api` calls in the app hit the project's own backend.

## The three demonstrations

They are real projects at `studio/templates/*`, copied by the runtime to `.lelu-studio/*`:

| Project | Source | Build | Tests | Preview |
|---|---|---|---|---|
| **Aurora Site** (website) | 7 files, responsive nav, theme, filter, validated form | `dist/` 30,011 B | 9/9 | page + stylesheet served |
| **Pulse Board** (application) | 8 files, Node HTTP API + JSON store | `dist/` 15,682 B | 9/9 against the live server | UI + real `POST /api/tasks` → 201 |
| **Rift Runner 3D** (game) | 9 files, three.js vendored, pure world logic | `dist/` 3,407,016 B | 11/11 | game + 650,153-char three.js module served |

`node scripts/verify-studio.mjs` drives all of this against a real dev server: **26/26 checks pass**.
Evidence: `docs/evidence/studio/<stamp>/results.json` (latest run
`2026-11-01T06-45-29-441Z`).

Verified in that run: builds exit 0; test counts are the runner's; previews answer; the app's backend
is reached through the preview (HTTP 201) and stats reflect the task; three.js and the Session 3B
character card are served; Meshy jobs show `awaiting_approval`; production deploy is refused with no
approval; a decision without the user-confirmed header is refused; a person's approval enables a
prepared deployment with a manifest naming them; a credential-shaped write is refused.

## Verification

| Check | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `tests/studio.test.ts` | 20/20 |
| `node scripts/verify-studio.mjs` | 26/26 |
| `npx vite build` | exit 0 |
| `npx oxlint` | 0 errors (warnings pre-existing) |
| Change-relevant suites (19 files: studio, tools, registry, dispatcher, genesis/interface, architecture, duplicate systems, bundle, workspace, engineering, development loop, cosmos, claims, execution) | **219/219 pass**, exit 0 |
| `tests/self-view.test.ts` | environment-limited: Playwright's Chromium is not installed in this runner |
| Full suite in one command | not completed: the suite outlives the 5-minute command limit here; it was run change-relevantly above instead |

## Limitations

- **Not buildable here:** Godot, Unity and Unreal. Their recommendations are honest and their editors
  would be required; no native game binary was produced.
- **3D character:** Session 3B's rigged GLB is still awaiting approval, so the game figure is
  procedural geometry plus 3B's real reference card. The loader is not a rig.
- **No publishing target:** `STUDIO_PUBLISH_TARGET` is not configured, so deployments are prepared
  (with a manifest) and not copied to a live host.
- **Application auth:** Pulse Board has no accounts; adding authentication is an `auth-security`
  protected action and was intentionally not implemented.
- **Multiplayer:** the workflow supports the requirement in engine selection; no multiplayer game was
  built, and the browser game is single-player.
- **Browser interaction:** the Studio panel and preview were verified through HTTP and the runtime;
  interactive rendering (WebGL game, panel drag/resize) was not driven in a real browser here. The
  panel is open in the Browser panel of the running app for the owner to try.
- **Task tracking:** background execution reuses `TaskEngine`/`BackgroundEngine`; no new scheduler was
  introduced. Long studio builds run as child processes with a hard timeout.
