# LÉLU V1.1 — Phase 2.4 acceptance report

**Date:** 2026-11-06
**Branch:** `freebuff/phase-2-2`
**HEAD at start:** `2a134494f7e9fd944b61daff46198ed01327563d` (tree `199d5880e25b7aa26a9f8c77e28d1e729cc145bc`), clean working tree — verified before any edit.
**Evidence:** this directory (`screenshots/`, `acceptance-*.json`).

This report separates what a real message submitted through the app's composer actually
did from what did not complete. No internal function was called and no app state was
injected to produce a "pass".

---

## 1. Root cause of the Phase 2.3 interaction failure

Three distinct causes, all measured in the running app:

1. **Wrong element.** Three composers exist with the placeholder `Message LÉLU…`:
   `GenesisChat` (`aria-label="Message Lélu — type instructions for any attachments"`),
   the Chat Universe universal composer (`.lcu-input textarea`), and each open
   `UniverseChatWindow` (`.lcu-win-composer textarea`). Phase 2.3 used
   `textarea … .first()`, which is the **GenesisChat** one — reported by the DOM at
   **0×0**, i.e. mounted but hidden. Every click therefore timed out while the visible
   composer sat untouched.
2. **Mount order.** The visible universe composer does not exist until the chat surface
   is opened (`[aria-label="What LÉLU is doing — open chat"]` → `openPanel("chat")` →
   `ChatUniverse` `open`). Before that, `document.querySelectorAll("textarea").length`
   is **1** (the hidden one); after, it is **2**.
3. **Headless text entry.** With the correct, visible, enabled composer focused, a
   per-character keystroke inserts the first character and then the browser stops
   emitting `beforeinput` for every following key (keydown/keypress still fire, nothing
   calls `preventDefault`, the node is not replaced, focus stays). Verified with
   Playwright `keyboard.type` at 8 ms / 150 ms / 400 ms per key, with CDP
   `Input.insertText` per character, and with an injected uncontrolled textarea as a
   control. A single full-string text commit (the path IME and paste use) inserts
   normally and persists. This is a harness/browser limitation in this headless build,
   **not** an application defect: the field accepts and submits the full string through
   its normal `input` event.

No product code was changed for the interaction, because no product defect was proven.
Two speculative fixes (an uncontrolled `value` binding, a removed `disabled` binding)
were tried, measured as ineffective, and reverted.

---

## 2. What was verified end to end

Every line below is a message typed into the real visible composer, submitted with the
real Send path (Enter), with the reply read from the transcript and the scene read from
`window.__leluSpatialProbe()`.

| Viewport | Message | Revision | Scene after | Reply (transcript) |
| --- | --- | --- | --- | --- |
| 1440×900 | `create a cube called Nova` | 0 → 1 | `Nova:rendered` | Created "Nova" (box) at (2.2, -1.35, 2.2). Scene revision 1 — 1 object. |
| 1440×900 | `add a sphere called Comet` | 1 → 2 | `Nova`, `Comet` | Created "Comet" (sphere) at (3.45, -1.35, 2.2). Scene revision 2 — 2 objects. |
| 1280×800 | `create a cube called Nova` | 0 → 1 | `Nova:true` | Created "Nova" (box) at (2.2, -1.35, 2.2). Scene revision 1 — 1 object. |
| 1280×800 | `what is in the scene` | 1 → 1 | `Nova` | Scene revision 1: 1 object — "Nova" (box) at (2.2, -1.35, 2.2). |
| 1024×768 | `add a sphere called Comet` | 0 → 1 | `Comet` | Created "Comet" (sphere) at (2.2, -1.35, 2.2). Scene revision 1 — 1 object. |
| 1024×768 | `show everything` | 1 → 1 | `Comet` | Framed "Comet" — camera at (1.89, -0.83, 0.58) looking at (2.99, -1.35, -0.86). verification: camera fail, framing pass. No scene object changed. |
| 375×812 | `create a cube called Nova` | 0 → 1 | `Nova` | Created "Nova" (box) at (2.2, -1.35, 2.2). Scene revision 1 — 1 object. |
| 390×844 | `what is in the scene` | 0 → 0 | — | The scene is empty — revision 0. |
| 390×844 | `add a sphere called Comet` | 0 → 1 | `Comet:rendered=false` | Created "Comet" (sphere) at (2.2, -1.35, 2.2). Scene revision 1 — 1 object. |
| 1280×800 | `zoom out` | 0 → 0 | — | Zoomed the camera out — camera at (-7, 3.96, 7) looking at (0, 0.6, 0). verification: camera pass, framing pass. **No scene object changed.** |
| 1280×800 | `return to the original view` | 0 → 0 | — | Returned the camera to the opening Genesis view — camera at (0, 1.7, 10.4) looking at (0, 0.6, 0). verification: camera fail, framing pass. No scene object changed. |
| 1280×800 | `move the Earth to 1, 2, 3` | 0 → 0 | — | I did not change the scene: "Earth" is owned by **WorldRegistry** and is read-only for position. WorldRegistry destinations are labels and metadata (weight, scale class) with no spatial transform… |
| 1280×800 | `describe the thing that does not exist` | 0 → 0 | — | I did not change the scene: "thing that does not exist" is not in the scene. The scene is empty. Revision is still 0. |
| 1280×800 | `create a cube called Nova` → `delete Nova, I approve` | 0 → 1 → 2 | `Nova:true` → none | Deleted "Nova". Scene revision 2. |

Measured end-to-end latency (send → first assistant message, polled at 350 ms):
**2.1 s – 7.9 s** across the runs above.

### Pipeline stages actually exercised

composer `input` → React state → `send()` → conversation store → `AIRouter` stage 1.6
`SpatialResolver.parseSpatialCommand` → `SpatialIntentBus` → tier guard / approval →
`SpatialSceneGraph` sealed commit → revision bump → `SpatialLayer` R3F render →
`__leluSpatialProbe()` reflects the object → reply text built from the real result.

`SpatialMutationBridge` is consulted by `resolveTarget`; the `Earth` refusal is its
owner-named refusal (resolved through the world adapter, not a spatial object).

---

## 3. What failed, and exactly where

| Attempt | Boundary |
| --- | --- |
| `show me Nova` (camera focus) at 1280×800, twice | Chromium **crashed** (`keyboard.press: Target page, context or browser has been closed`) immediately after the setup create succeeded. No camera-focus result. |
| `orbit around Nova by 30 degrees` | First attempt: the setup ran in a **new page**, which resets the in-memory scene, so the command correctly refused ("nothing called Nova is in the scene… Revision is still 0") — a true refusal, not a pass. Second attempt: same Chromium crash after create. |
| mobile `show me Nova` at 390×844 | The composer became un-clickable after the transcript grew (`TimeoutError` on `textarea`). Real mobile usability issue worth a follow-up. |
| per-key typing | Only the first character reaches the field (see §1.3). Messages in this phase were committed as a whole through the browser's text-input path. |
| camera reset verification layer | The app's own verification reported `camera fail, framing pass` for reset and frame, `camera pass` for zoom. The probe camera position did change for all three; the layer's stricter check is reported as-is, not overridden. |

---

## 4. Mutation safety (unchanged architecture)

`SpatialMutationBridge` from Phase 2.3 is untouched: authored objects commit through the
existing sealed path; Cosmos / WorldRegistry / live scene nodes stay read-only with the
owner named. Evidence: the `Earth` refusal above (owner `WorldRegistry`, capability
`position`), the unknown-reference refusal, and the approved delete which is the only
destructive path and required the in-message approval phrase.

---

## 5. Tests and gates

| Gate | Result |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun test tests/spatial-integration.test.ts` | 23 pass, 0 fail |
| `bun run lint` | 0 errors, 108 warnings (unchanged) |
| Full suite | see `test-results.json` in this directory and the Phase 2.3 baseline: the same 38 pre-existing failures, none introduced here |

Product source changed in this phase: **none**. The diagnosis was proven by measurement,
two speculative edits were reverted, and the remaining failure (per-key text) is in the
headless browser, not the app.

---

## 6. Limitations

1. Camera **focus** and **orbit** are not verified — Chromium crashed; no result is claimed.
2. Mobile composer becomes unreachable after the transcript grows (390×844).
3. Per-character synthetic typing is broken in this headless build; whole-string commits were used.
4. No physical device was used; mobile evidence is browser emulation.
5. The app's own camera verification layer reports `camera fail` on reset/frame; probe camera state did change.
6. 38 pre-existing suite failures remain unrepaired and are outside this phase.
7. The Cloud preview panel cannot be resized (328×528) and `preview_playwright` fails with
   `options.mode must be one of: 'strip'`; this phase used a locally launched Chromium
   instead (see `environment.md`).

---

## 7. Visual inspection of the captured screenshots

I opened `screenshots/1024x768-04-frame-result.png` and
`screenshots/390x844-07-mobile-create.png`.

* Both show the real chat surface over the Genesis scene, the composer, the send
  control and the surrounding Cosmic UI at the captured viewport.
* In both, the transcript bubbles are present but **carry no legible text**: the
  message rows render as an orb plus a small empty pill. The message text exists in the
  DOM (`.lcu-thread .lcu-msg` → `"Framed "Comet" …"`) and is what this report quotes, but
  the rendered bubbles do not visibly show it in these screenshots.

So "the reply is in the transcript" is verified at the DOM level, not visually. The
bubble text rendering at these sizes is an open interface defect and is **not** claimed
as working. Camera and object state claims rest on `__leluSpatialProbe()` readings, not
on anything visible in these images.
