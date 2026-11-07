# Session 3D — engineering and integration audit

**Branch:** `freebuff/167b4bf50af49d39b2714564`
**Commits:** `84d5fe0` (Session 3C), `4e85af0` (merge of `52bdcc9`), plus the Session 3D
commit on top. Nothing was pushed or deployed.

## Phase 1 — repository reconciliation

`origin/main` is an **ancestor**, not a newer line: this branch is 119 commits ahead of it. The
Session 2 line (`session2-chat-workspace`, `52bdcc9`) was **not** included: it descends from the
Session 3B base (`e7b667b`) and was 21 commits ahead with the Cosmos navigation, voice, Supabase
recovery and deployment work.

That work has now been merged into this branch (`4e85af0`). Only `ToolDispatcher.ts` conflicted;
the resolution kept the 3C studio executors and the 3B/agentic executor tables in the one dispatch
map. Session 3B's ledger and character references remain in place, and the 3C Studio remains
registered after the merge.

## Phase 2 — live model integration

Measured, not assumed:

- `GET /api/model/status` → `anthropic: true` (also groq, openrouter, githubModels).
- `toolSchemasForModel()` → **41 executable tools**, including all **13** `studio_*` tools.
- A live Anthropic call through the server broker returned `STUDIO-LIVE` from **`claude-opus-5-5`**.
  (The broker's upstream path is `/api/model/anthropic/messages`; a doubled `/v1` is a 404.)
- The live model was given the real `studio_create` schema and the request
  "Build me a small application called Focus Ledger…". It returned a real `tool_use`:
  `studio_create { kind: "application", name: "Focus Ledger" }` (`toolu_01CEiDYzK9oCeHWsTUXU33ak`).
- The runtime then scaffolded it, built it (exit 0, 15,682 B), ran its tests (**9/9**), and served it
  (HTTP 200, 3,012 B, `<title>` present). Evidence: `docs/evidence/session-3d/2026-11-01T07-23-30-977Z/results.json`.
  Verifier: `scripts/verify-session3d.mjs` — **9/9 checks**.

Honest boundary: the verifier dispatched the model's tool call to the same runtime endpoint the
Studio executor uses. The in-app chat tool loop itself was not driven in a browser in this runner,
because Playwright's Chromium is not installed.

## Phase 3 — cognition and memory

`src/core/studio/StudioMemory.ts` is a **read model**, not a second memory store. It derives, from
records that already exist:

- project objectives (`StudioLibrary.documentation`);
- technical decisions and stage progress (`StudioPipeline` evidence and completed stages);
- previous build failures, with the real exit code and first error line;
- successful builds and the last test counts;
- the live preview URL;
- work waiting on a person (`StudioApprovals.pending`, with expiry);
- deployments and blockers.

`CognitiveContext` now injects `## STUDIO PROJECTS` and `## STUDIO APPROVALS WAITING ON A PERSON`
into every model request. A chat answer about a project therefore reads the same records the Studio
window shows. Two tests cover the empty state and a real project with progress and a pending
approval.

## Phase 4 — Studio and Cosmos

The Studio is a normal `GenesisModuleHost` window (`studio` module, dock entry, renderer map) merged
with Session 2's Cosmos. Typecheck and production build pass. **Not verified here:** window drag and
resize, multiple Studio windows, mobile layouts and WebGL rendering — these need a real browser and
Chromium is absent in this runner. They must not be reported as tested.

## Phase 5 — security audit

| Probe | Result |
|---|---|
| Write `../../escaped.txt` | HTTP 400, "outside the project"; no file written |
| Serve `../../package.json` unnormalized | HTTP 400, invalid slug |
| Serve `focus-ledger/..%2f..%2fpackage.json` | HTTP 404, not served |
| Approval decision without `x-lelu-user-confirmed` | HTTP 400, "LÉLU's tools cannot grant one" |
| Production deploy with no live approval | blocked (26/26 Studio verification) |
| Credential-shaped write | refused, variable named, value never echoed |
| Production publish | refused; only `prepared`, since no `STUDIO_PUBLISH_TARGET` |

Auth: the Studio runtime is local/same-origin; there is no Studio account system. Production
deployment remains a human-only action. No secret is read by the verifier or printed.

## Phase 6 — final demonstration

Live model → `studio_create` → real `Focus Ledger` application (task board with a Node backend):

- source: `.lelu-studio/focus-ledger/`
- build: exit 0, 15,682 B
- tests: 9/9 against the real backend
- preview: `http://127.0.0.1:3004/api/studio/serve/focus-ledger/`
- evidence: `docs/evidence/session-3d/2026-11-01T07-23-30-977Z/results.json`

Screenshots were not captured (no browser binary). Logs are the evidence JSON and the dev-server
log; the model response ids and tool-use id are recorded in that JSON.

## Verification

| Check | Result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `tests/studio.test.ts` | 21/21 |
| `node scripts/verify-studio.mjs` | 26/26 |
| `node scripts/verify-session3d.mjs` | 9/9 (live Anthropic) |
| `npx vite build` | exit 0 |

## Limitations

- Browser interaction (drag, resize, multiple windows, mobile, WebGL) and screenshots remain
  unverified in this headless runner.
- The verifier exercises the live model and the real runtime, but not the in-app conversational
  tool loop end to end.
- Godot/Unity/Unreal remain not installed; no native build was produced.
- No push and no deployment were performed.
