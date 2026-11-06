# PHASE 2.1 — ACCEPTANCE RUN LOG

**Deliverable:** LÉLU V1.1 spatial capability core (Tier 1–3 enforced, Tier 4–5 enforced-but-not-implemented).
**Worktree:** `/workspace/chats/078e3ea38e31040bd9a2dce1`, branch `freebuff/078e3ea38e31040bd9a2dce1`.
**Date:** 2026-11-06.

## Environment (stated exactly, no aliasing)

| Thing | What it actually was |
|---|---|
| App | LÉLU V1.1 dev build served by Vite on `0.0.0.0:3014` inside this cloud VM |
| Browser | **Cloud browser (Chromium via the Freebuff browser panel)**. Not a physical device, not a phone, not a desktop OS. Everything below is a simulated/browser context. |
| Scene | The real Genesis R3F canvas (workspaces `genesis-v1` and `genesis-unified` both present), not a mock |
| AI providers | **None configured** (`ProviderResolver: No AI providers are available`). The spatial replies below come from the deterministic `SpatialResolver` stage, which runs before any provider is selected. No model output is represented as scene evidence. |
| Supabase | Not configured; the "Sign in to LÉLU / Continue" dialog was dismissed with **Continue** (guest) before each run |

## How it was driven

Real chat input in LÉLU's own composer (`Message LÉLU…`), typed and submitted through the browser panel,
with the replies read back from the `Conversation` log. Nothing was injected into the graph, the store, or
the probe to make a screenshot look right.

## Chat operations observed (verbatim replies)

Run A, revision 0 → 5 (screenshots `03-chat-create.png`, `03-chat-operations.png`, `03-chat-transcript.png`):

| # | Sent | Reply | Revision |
|---|---|---|---|
| 1 | `create a red cube at the left called Nova` | `Created "Nova" (box) at (-2.6, -1.2, 2.2). Scene revision 1 — 1 object.` | 1 |
| 2 | `add a blue sphere at the right called Comet` | `Created "Comet" (sphere) at (2.6, -1.2, 2.2). Scene revision 2 — 2 objects.` | 2 |
| 3 | `move Nova up by 2` | `Moved "Nova" to (-2.6, 0.8, 2.2). Scene revision 3.` | 3 |
| 4 | `make the cube metallic gold` | `Changed "Nova" — colour #eab308. Scene revision 4.` | 4 |
| 5 | `connect Nova to Comet` | `Linked "Nova" → "Comet" (connected). Scene revision 5.` | 5 |
| 6 | `delete Comet` (no approval) | `I did not change the scene. Object.delete needs your explicit approval. Say "…, I approve" and I'll run it exactly once. Revision is still 5.` | **5 (unchanged)** |

The refusal reply is the required "revision unchanged after refusal" evidence at the interface level; the
same invariant is asserted against the authoritative snapshot in `tests/spatial-core.test.ts`.

Run B (same session, after restarting the dev server), revision 5 → 11 — used to place the objects where the
cinematic camera could not hide them:

| # | Sent | Reply | Revision |
|---|---|---|---|
| 7 | `move Nova to -1.2, 0, 4` | `Moved "Nova" to (-1.2, 0, 4). Scene revision 6.` | 6 |
| 8 | `move Comet to 1.2, 0, 4` | `Moved "Comet" to (1.2, 0, 4). Scene revision 7.` | 7 |
| 9 | `make the cube glow gold` | `Changed "Nova" — colour #eab308. Scene revision 8.` | 8 |
| 10 | `make the sphere glow blue` | `Changed "Comet" — colour #3b82f6. Scene revision 9.` | 9 |
| 11 | `move Nova to -7, 3, 6` | `Moved "Nova" to (-7, 3, 6). Scene revision 10.` | 10 |
| 12 | `move Comet to 7, 3, 6` | `Moved "Comet" to (7, 3, 6). Scene revision 11.` | 11 |

Every accepted command advanced the revision by exactly 1; the batch-bearing create/link commands each
counted once.

## Rendered-scene evidence (live three.js, not the store)

The layer publishes a read-only probe, `window.__leluSpatialProbe()`, which resolves `spatial:<id>` in the
live three.js scene and reports `getWorldPosition()` plus the mesh material colour. Raw readings are in
[`probe-readings.json`](probe-readings.json).

| Stage | Nova (world) | Comet (world) | Colour read back |
|---|---|---|---|
| rev 5 | `(-1.871, 0.8, 2.846)` rendered | `(3.116, -1.2, 1.374)` rendered | `#eab308` / `#3b82f6` |
| rev 9 | `(2.239, 0, 3.525)` rendered | `(3.81, 0, 1.71)` rendered | `#eab308` / `#3b82f6` |
| rev 11 | `(2.535, 3, 8.864)` rendered | `(8.372, 3, -3.861)` rendered | `#eab308` / `#3b82f6` |

`rendered: true` means the mesh exists in the live scene under its authoritative id; the world position
comes from three.js itself. World values differ from the committed local values because the spatial meshes
are children of the existing Genesis group, which rotates continuously — the probe reports that inherited
rotation rather than lying about it.

## Screenshots in this folder (all Cloud browser, simulated)

| File | Shows |
|---|---|
| `02-app-loaded.png` | LÉLU booted, Genesis scene live, guest "Continue" dialog |
| `03-chat-create.png` | First create exchange in the real chat |
| `03-chat-transcript.png` | Chat at revision 11 with the approval panel for `delete Comet` |
| `04-chat-operations.png` | Move / material / link exchanges and the approval card |
| `04-scene-objects.png` | Live Genesis scene after the operations (camera had flown to the planet's night side) |
| `05-scene-objects-wide.png` | Live Genesis scene, wider framing |

**Honest limitation:** the Genesis camera is cinematic and moves on its own (wide Core view → planet
approach → surface). For the two desktop framing attempts the captured frame showed the Core/planet with
the spatial objects outside the visible frustum, so there is **no screenshot in which Nova and Comet are
individually identifiable by shape**. Their rendered existence, position and colour are instead proven by
the probe readings above, which read the live meshes. A cleaner visual would need a camera-applier
capability, which is Phase 2.2 work and was deliberately not built here.

## Automated checks (measured, exit codes as printed)

| Check | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | `TYPECHECK_EXIT=0` |
| Spatial acceptance tests | `npx tsx --test tests/spatial-core.test.ts tests/spatial-chat.test.ts` | `26 tests, 26 pass, 0 fail`, exit 0 |
| Full suite | `bun run test` | **1091 tests, 1089 pass, 2 fail**, exit 1 |
| Lint | `bun run lint` | exit 0, 0 errors, 76 warnings (pre-existing) |

The 2 failures are the layout self-view tests that need a real browser engine in-process
(`the layout report is the page as a user first sees it…` and `a control covered only while a panel opens…`).
They are the same two failures measured in the Phase 0 baseline, caused by the audit VM's missing
`libnspr4.so` (headless Chromium cannot launch, and the container runs unprivileged, so the library cannot
be installed). No spatial test depends on them, and the count is unchanged from baseline (1063/1065 → 1089/1091,
i.e. +26 passing tests, same 2 environment failures).

## What Phase 2.1 does and does not claim

- Tier 1–3 are implemented and reachable from chat; Tier 4–5 are refused with `tier-insufficient` even when
  an approval phrase is offered, and the manifest reports them `not_configured`.
- Destructive `object.delete` needs a single-use owner approval minted only by an explicit approval phrase in
  chat, with a 120 s TTL; a plain "delete Comet" changes nothing.
- Cosmos, Genesis, the 54-engine scene, `AvatarPresenceBridge`, `AIService`, `AIRuntime`, `VoiceEngine`,
  `AIRouter` provider selection and the R3F renderer were not replaced; the scene layer adds sibling meshes
  to the existing canvases.
