# FULL SYSTEM TEST REPORT (WP05)

Tested tree: workforce commit `3cbedff4` (code). The evidence/report commit that
follows changes only documentation and evidence files. Environment: cloud
container, Node 22.23.5, Bun 1.4.4, Chromium 1243 headless (SwiftShader, no
GPU), no physical microphone or speaker, no Supabase session, free provider
keys present for Groq and OpenRouter (Cerebras key rejected upstream).

## Gate 1 — Static integrity

| Check | Result | Evidence |
|---|---|---|
| TypeScript (`tsc -b --force`) | **Pass** (0 errors, 30 s) | `logs/tsc-final.log` |
| Lint (`oxlint`) | **Pass** — 0 errors, 244 warnings | `logs/lint-final-summary.txt` |
| Dependency integrity | **Pass** — `bun install --frozen-lockfile` clean; lockfiles unchanged from baseline | install log |
| Import resolution / production compilation | **Pass** — `vite build` 6 s, 1,866 JS assets | `logs/vite-build-final.txt` |
| No test files in the bundle | **Pass** (1,959 files scanned) | `scripts/verify-no-tests-in-bundle.mjs` |

## Gate 2 — Automated tests (`npm test`, the project's full suite)

**3,208 tests · 3,195 pass · 3 fail · 10 skipped · 0 cancelled** (422 s).
Baseline `096b46b8`: 2,434 tests · 2,426 pass · 2 fail* · 6 skipped
(*both baseline failures were an artefact of my worktree's symlinked
`node_modules`; they pass in the real tree).

The 3 failures — inherited, not caused by integration (they fail identically on
the source branch head `claude/jolly-davinci-9w3rle` @ `7f265c2b`):

| Test | File | Cause |
|---|---|---|
| the coat and catsuit handbags are their own nodes | `tests/foundry-m25c.test.ts` | M25 round 3 rebuilt the wardrobe/looks after this test |
| the three sources are ordered per component, not per source | `tests/foundry.test.ts` | asset revision referenced by the test changed in round 3 |
| she changes on her own by occasion, and keeps a look a person chose | `tests/outfit-switching.test.ts` | round 3 changed the look catalogue; `home_laidback3` no longer chosen at 23:00 |

The 10 skips — all need something absent from this container: Blender (2),
the 785 MB CC0 reference library (2), OPA binary (2), gitleaks binary (2),
`LIVEKIT_LIVE_ENV` (1), `VOXCPM_LIVE_URL` (1). List: `logs/skips.txt`.

Area coverage within the suite (files run as part of the full suite): cognition,
memory (integrity, hardening, residue, sovereignty, cloud erasure, provenance),
agents and delegation, task persistence/recovery, tool registry/dispatch and the
new workforce probes, chat surfaces, voice (engine, echo guard, speech outcome,
ASR provenance, continuity), Cosmos objects/navigation/live map/spatial
intelligence/projection/render governance, mobile layout tests, security
(prompt injection, access, spend policy, sandbox), ASRE/NRE/temporal/foundry,
couture, continuity sync.

New tests added by this mission:
* `tests/workforce-registration-integrity.test.ts` — no registrar replaces another's tool or lowers a risk level; no executor without a definition; probe stays in sync with Bootstrap.
* `tests/workforce-object-authority-routing.test.ts` — a sentence goes to the object store its names resolve in.

Per-merge results are recorded in each merge commit message.

## Gate 3 — Integrated workflows (live, production server, real UI)

Driven by `docs/acceptance/workforce-consolidation/workflows.mjs` on
`bun server.ts`; reply text read from the persisted conversation, Cosmos state
from the object store. Raw: `workflows.json`, screenshots `workflow-*.png`.

| Workflow | Steps observed | Verdict |
|---|---|---|
| **A** User → Chat → Cognition → Memory → Response | "My favourite material is anodised titanium…" → "Got it… Stored."; next turn "What is my favourite material?" → "Anodised titanium." | **Pass** |
| **B** User → Executive Board → delegation → execution → result → memory | "Ask your research agent…" → reply "The research agent ran and completed" with three Moon facts citing Wikipedia (39.6 s) | **Pass with reservation** — the reply also says "the source it would have used"; the transcript alone does not prove the agent's own fetch. Delegation is additionally covered by the suite. |
| **C** Chat → Research → Sources → Artifact | Research board artifact `art_26c6b1f4…` and a mind map from 2 public sources were created and saved; the final synthesis stopped ("OpenRouter timed out after its 12 s budget"), reported as **partial**, no paid fallback | **Partial** — artifact creation pass; synthesis blocked by free-provider timeout |
| **D** Creative request → Cosmos → spatial objects → rendered output | "Build a gear train…" → `creative.build`, 81-part scene3d artifact (parameters clamped to 14:28 + idler); "Put it in the Cosmos" → `cosmos.object.spawn` at [3.2, 0.9, −7.2]; "Rotate it 90 degrees" → rotation [0, 90, 0] in the store; scene rendered in 3D view | **Pass** (reply wording glitch "turn the it 90°") |
| **E** Microphone → voice runtime → cognition → spoken response | Mic: permission granted, live track from Chromium's **fake** device, voice toggle rendered (desktop + iPhone profile). STT: Groq Whisper relay on 3 real speech recordings, correct text, 0.31–0.79 s. Cognition: Workflow A. Server TTS: none configured (ElevenLabs refused `402 spend_not_authorized`, by policy); speech output is the browser's speech synthesis, not observable headless. | **Components pass; full spoken loop not verified** — physical mic/speaker and iPhone acceptance outstanding |
| **F** Workspace → tools → approval → execution → persistent result | "Tile my windows" → `workspace.arrange` executed locally, state persisted (`lelu.lelu.workspace.steward.v1`). Approval-gated tools are covered by the suite (capability ledger, spend policy, AutonomyGate tests); no approval prompt was exercised live. | **Pass (no-approval path)**; approval path suite-only |

## Gate 4 — Browser acceptance (production build, `browser-acceptance.mjs`)

| Check | Desktop 1440×900 | iPhone 13 profile (390×844, touch, Blink) |
|---|---|---|
| Load (load event / FCP) | 507 ms / 116 ms | 464 ms / 136 ms |
| Uncaught page errors | 0 | 0 |
| Login / session | Guest mode (no account in this env). Owner gate tested separately with curl: unauthenticated `/` → 303 login, APIs 401, wrong password 401, right password → cookie → 200 | same server |
| Chat interaction | reply "Got it — WFMWSPLV8A confirmed." 7.9 s | reply 5.7 s |
| Navigation | chat open, view switching (3D, back to chat) exercised in workflows | chat open |
| Cosmos rendering | scene drawn with `?perf-world` (software GL); Home Cosmos button present | scene drawn with `?perf-world`; button not reachable from the chat-first layout in the script |
| Voice permissions | granted, live fake track, secure context | same |
| Page refresh | conversation present after reload (4–6 s) | same |
| Application recovery after server restart | conversation present after full `server.ts` stop/start (`restart-persistence.json`) | — |
| Network interruption | app stays mounted offline; `/healthz` 200 after reconnect | same |

Console errors (13 desktop / 18 phone) are all environmental or by design; see
`PERFORMANCE_ACCEPTANCE_REPORT.md` §6.

## Not tested here (needs hardware or access this container does not have)

* A real iPhone (Safari/WebKit), real microphone, speaker, headset, echo cancellation.
* GPU rendering / device frame rate of the Cosmos.
* Supabase-authenticated sessions and cross-device sync (no Supabase session configured).
* The live Contabo host (see `CONTABO_DEPLOYMENT_READINESS.md`).
