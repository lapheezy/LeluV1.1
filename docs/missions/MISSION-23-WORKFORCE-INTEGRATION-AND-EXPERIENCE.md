# Mission 23: workforce integration and experience reconstruction

**Canonical workforce branch:** `integration/lelu-four-workforce-consolidation`

**Status: PARTIALLY COMPLETE.** Gates 1–4, 6 and 7 are met with browser evidence. Gate 3 is met in a browser;
Gate 5 is met only in emulation. Gate 8's physical-device checks were **not** performed: no iPhone or other physical
device is reachable from this environment. Infinite two-dimensional navigation (WP03) was **not implemented**; §6
explains why and what it needs.

Evidence images are in `docs/missions/evidence/m23/`. Every browser check below is Chromium. Where it says
"iPhone", it means Chromium emulating an iPhone 13 (390×664 visible area, touch, mobile UA). That is **not** Safari
on a phone.

---

## 1. Branch SHAs

| | SHA |
|---|---|
| Source branch `claude/supabase-security-closure-sly009` (provider runtime) | `985df6a4` (implementation `78ab6d48`, record `985df6a4`) |
| Destination before integration | `0cdedced` |
| **Integration merge commit** | **`d33d8b14`** |
| M23 commits on the workforce branch | `c5fc0db0` (WP02), `80822a6c` and `4e5d96a7` (WP03), `0272d002` (WP03/WP04), plus this record |
| Final head | see the commit that adds this file |

The workforce branch had **no commits newer** than the source's merge base. Nothing was overwritten, and the merge
is a plain `--no-ff` merge.

## 2. WP01: provider runtime integration (Gate 1: met)

Verified **on the workforce branch at `d33d8b14`**, not on the source branch.

**Static and automated checks:**
- `npm run typecheck`: exit 0.
- 281 provider, broker, voice, spend and self-awareness tests: 281/281 pass.

**Live, zero-spend request path** (`scripts/verify-provider-runtime-live.ts`, through the real server broker):

| Provider | Result |
|---|---|
| Groq | 200, "OK" |
| OpenRouter | 200, "OK" |
| Groq Whisper (voice) | 200 |
| Anthropic | 403 from the broker; **0 requests reached Anthropic** |
| Cerebras | 401: the stored key is rejected upstream (unchanged blocker) |
| Fireworks, Mistral, Gemini | no key in this environment (unchanged blocker) |

The production server started from this branch reports Groq, OpenRouter and Cerebras configured and Anthropic
`POLICY_DISABLED` at `/api/model/status`. No environment variable or credential was changed. No secret reaches the
browser; the bundle canary scan from the previous mission is unchanged.

## 3. WP02: microphone (Gates 2 and 3: met in a browser; physical device not tested)

### Trace

* **Original fix:** `4e61922b` ("Give every open chat window the same microphone as the Universe composer") and
  `65313141` (test follow-up), M22.10, 2026-11-22.
* **Workforce integration history:** both are already ancestors of the workforce branch. Nothing had removed them.
* **Component:** `src/app/scene/genesis/chat/universe/VoiceToggle.tsx`. It is rendered by `ChatUniverse.tsx`
  (Universe composer) and by `UniverseChatWindow.tsx` (every chat window).
* **Rendering path:** Home → Chat → `ChatUniverse` → `.lcu-composer` → `VoiceToggle`.
* **Capture path:** `VoiceEngine.toggle()` → `getUserMedia`. Then either the Web Speech recogniser or the Whisper
  recorder → `postTranscription` → `/api/model/groq/audio/transcriptions` (the server broker attaches the key) →
  transcript → `handleUserSpeech`.

The original implementation was intact, so there was nothing to *restore*. Real browser runs found two defects that
appear only on a phone. Both are fixed in `c5fc0db0`:

1. **Errors were invisible on a phone.** Voice errors went only to `notify()`. While the chat fills a phone screen,
   `GenesisNotificationCenter` deliberately files notifications into history instead of showing them. So a denied
   or missing microphone produced **no visible message** on the iPhone viewport, while desktop showed it (measured
   with the same script). The button now renders its own `role="alert"` beside itself, on every device, until
   dismissed or the next attempt.
2. **LÉLU stood on the send button.** The companion planner avoids `[data-lelu-composer]`, which only the old
   `GenesisChat` carried. Both Chat Universe composers now carry it. Overlap with the composer went from covering the
   send button (`companion-iphone-before.jpg`) to **0 px** (`companion-iphone-after.jpg`).

### Browser verification (`scripts/e2e/mic-e2e.cjs`, production server)

The fake microphone plays a recorded spoken sentence. The browser recogniser is removed so that the path which sends
audio to the server runs (the path Safari uses when Web Speech is unavailable).

| Check | Desktop | iPhone viewport |
|---|---|---|
| Button visible, on top, hit-testable | ✓ 36×36 px | ✓ 44×44 px |
| Tap → `aria-pressed=true`, phase `listening`, capture `live` | ✓ | ✓ |
| Recording state visible (pink ring, listening pulse) | ✓ `mic-desktop-granted-1-recording.jpg` | ✓ `mic-iphone-granted-1-recording.jpg` |
| Audio reaches the server | ✓ 175,744 B webm/opus POSTed | ✓ 175,744 B |
| No credential sent by the page | ✓ 0 auth headers | ✓ 0 |
| Transcription | ✓ HTTP 200, "Got it! 15 minutes until the design team meeting…" | ✓ same |
| Transcript appears in the chat | ✓ | ✓ |
| Tap again → idle | ✓ | ✓ |
| Permission denied → visible message | ✓ "Microphone permission denied. Please allow mic access." | ✓ (was **missing** before the fix) `mic-iphone-denied-2-error.jpg` |
| No microphone → visible message | ✓ "No microphone was found on this device." | ✓ (was missing before the fix) |

**Not tested:**
* The browser's real permission prompt UI. Headless Chromium grants or denies programmatically; denial is simulated
  with the exact `NotAllowedError` a user's "Don't Allow" produces.
* iOS Safari's own recogniser path (Safari exposes `webkitSpeechRecognition`, so on a real iPhone the engine prefers
  it).
* A physical microphone.

## 4. WP03: interaction

### Windows (Gate 4: met on tablet and desktop)

The module window host (`GenesisModuleHost`) already had pointer-based drag, resize, viewport clamping, a 28 px grip
and `pointercancel` handling. It was verified with **real input**: CDP touch events on iPad, mouse on desktop.

| | iPad (touch) | Desktop (mouse) |
|---|---|---|
| Drag the title bar | ✓ moved (−157, +90), clamped at the left edge | ✓ moved (−180, +88) |
| Resize from the grip | ✓ +120 px wide (height limited by the room below) | ✓ +120 px wide |
| Throw off-screen | ✓ header stays reachable at the top-left | ✓ |

On a **phone**, a module window is a full-screen sheet by an earlier design decision ("a phone sheet is the screen:
nothing to drag"). It is not freely movable there. This was not changed; it is listed in §8 for your decision.

### The radial menu (Gate 6: met)

There is one implementation, `src/app/ui/radial/` (`RadialMenu.tsx`, the pure `radialGeometry.ts`, `radial.css`).
**Four environments** use it:

| Host | Tap (unchanged) | Hold → slide → release |
|---|---|---|
| Spatial hub (Cosmos, **circular Spatial Bar**) | opens the grouped list | travel: core + the next 7 destinations |
| Chat Universe composer "+" | file chooser | attach, share screen, talk, new chat |
| Every module window's glyph handle | (opens the ring) | snap left or right, expand/restore, minimise, pin, close |
| Phone workspace bar "Layout" | the layout list | Auto, Tile, Split, Focus, Stack, Full |

**Interaction details:**
* Releasing where you pressed, or sliding far away, cancels.
* Keyboard: ↑, the Menu key or Shift+F10 open the ring; arrows move, Enter selects, Escape closes and returns focus.
* Touch: pointer capture, `touch-action: none`, and no iOS callout or Android context menu.
* Layout: the ring fans into the open part of the screen, items never overlap, and everything stays on screen
  (unit-tested).
* The Spatial bar's circular controls are 40 px on phones (were 30).

**Browser verification** (`scripts/e2e/radial-e2e.cjs`; CDP touch on iPhone and iPad, mouse and keyboard on
desktop):

* Final run: **iPhone 9/9, desktop 11/11, iPad 9/9**.
* The earlier configuration passed twice in a row on all three before the Layout host was added.
* Evidence: `radial-*.jpg`.

**Defects these runs found and fixed:**
* **A ghost click.** The tap first ran on `pointerup`; that opened the Spatial list and pushed the hub up, and the
  browser's compatibility click then opened the Jewelry card behind it.
* **A swallowed tap.** A hold that ends away from the control produces no click, so the "ignore this click" flag
  stayed set and ate the next real tap.
* **Corner layout.** Clamping pushed items onto each other in a corner.

### Safari bottom-of-workspace (Gate 5: emulation only)

* **Fix:** 69 height rules in 34 files changed from `vh` to `svh` (`4e5d96a7`). On iPhone Safari `vh` is the screen
  *without* toolbars, so panels sized in `vh` ran under the toolbar.
* **Measured** at the iPhone 13 visible area (390×664), every scroll container scrolled to its end:
  * Home: last card ends at 565 px.
  * Chat Universe: 520 px.
  * Agents sheet: "Run agent" at 648 px.

  All are on-screen. No control is covered, except Home's status band, which LÉLU's figure overlaps visually only
  (its canvas takes no taps).
* **Not verified:** real Safari's collapsing toolbar cannot be emulated in Chromium. This gate needs the physical
  check in §8.

### Button-list audit

`scripts/e2e/button-list-audit.cjs` inventories every container of 4+ visible sibling buttons in nine environments,
on phone and desktop. Results in priority order:

| # | Where | Finding | Action |
|---|---|---|---|
| 1 | Chat Universe header tools / time-range chips (phone) | 24 px / 25 px targets | **Fixed:** 40 px / 36 px on coarse pointers |
| 2 | Workspace layout bar (6 modes) | button row | **Done** on phones (radial). Desktop keeps the visible row, which shows the current mode |
| 3 | Window chrome (pin / minimise / expand / close, 26 px) | button row | Radial added. The visible buttons were kept for discoverability |
| 4 | Agent row actions: Edit, Duplicate, Pause, Archive, **Delete** (28 px) | per-item list, destructive action beside benign ones | Backlog: a radial on the agent card, with Delete behind a confirm |
| 5 | Agents: "＋ Template" list (11) and Files: agent chips (11) | long chip lists, 26–28 px | Backlog: a searchable picker |
| 6 | Browser `lbr-actions` (phone) | **overflows** horizontally | Backlog: a radial on one "Page" control |
| 7 | Home app tiles (6) and header tools (5) | fine on desktop, cramped on phone (labels truncate: "Worksp…") | Backlog: a 3×2 grid on phones |
| 8 | Home dock orb | hold = talk (existing) | Left as is, to avoid changing an existing gesture |
| 9 | Settings categories (5–11) | list of cards | Appropriate as a list; no change |

## 5. WP04: design quality (partial)

**Done** (functional, each measured):
* microphone error presence on phones;
* companion off the composer;
* `svh` sizing;
* finger-sized chat targets;
* 40 px circular spatial controls;
* the radial's backdrop, so the ring reads above busy content;
* a recording pulse that respects reduced motion.

**Observed, not changed:**
* On phones LÉLU's figure still overlaps content cards: Chat Universe cards, and Home's Library and status band.
  The planner sees only marked windows, composers and controls; cards are not marked. A fix means marking cards as
  soft obstacles, a planner change best made with the avatar work.
* Home on a phone has large type and truncated tile labels (item 7 above).

These were not addressed: no decorative restyling was done.

## 6. Not implemented: infinite two-dimensional navigation

No infinite 2-D workspace exists in the code to continue, and the repository contains no "Infinite UI 2.0" brief.
Adding one means a pannable plane under the module windows:
* window positions in plane coordinates;
* a camera offset;
* two-finger pan and pinch on empty space.

That empty-space gesture is already owned by the Cosmos camera. Doing it properly needs a decision on how pan is
shared between the 3D Cosmos and the window plane. It was deliberately not attempted half-way in this mission.

## 7. Tests and build

| Check | Result |
|---|---|
| `npm run typecheck` | **exit 0**, 41 s |
| Full `npm test` (3,267 tests) | exit 1 in 551 s: **3,254 pass, 3 fail, 10 skipped**. The 3 failures are the pre-existing M25 wardrobe/asset tests (`foundry-m25c`, `foundry`, `outfit-switching`), already shown to fail on the untouched code. No new failure |
| `npm run build` (`tsc -b && vite build`) | **exit 0**, 51 s |
| New unit tests: `radial-menu` (6), `voice-toggle-presence` (3) | pass |
| Touched-area suites (159 tests in 12 files) | 159/159 pass |
| Browser: mic (6 scenarios), radial (3 viewports), windows (2), bottom reachability (3 screens), audit (2) | as above |
| **Physical devices** | **not tested**: none reachable from this environment |

## 8. Outstanding blockers

1. **Physical iPhone Safari check (Gates 5 and 8).** Open the deployed build on an iPhone in Safari and check:
   * (a) scroll Home, Chat and an open window to the very bottom with the toolbar shown and with it collapsed;
   * (b) tap the mic → allow → speak → transcript appears; deny → the red message appears beside the mic;
   * (c) hold the "+" in chat → slide → release.

   Without this, Gate 8 cannot be marked met.
2. **Cerebras key rejected; no Fireworks, Mistral or Gemini keys** (from the provider mission). Replace or add them
   on the server.
3. **Phone windows are full-screen sheets.** If you want freely movable windows on phones too, that reverses an
   earlier design decision and needs your call.
4. **Infinite 2-D navigation** (§6) needs a design decision on sharing pan with the Cosmos.
5. **WP04 backlog** (§4, items 4–7, and the companion-over-cards overlap).
