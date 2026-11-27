# Landscape navigation — Mission 44.4 (WP04)

## Method

Real browser (Playwright) against the running app. Viewport set with `setViewportSize` **and the
page reloaded at that size** in the same call, then the Chat Universe opened through the app's own
controls (`Open the interface controls` → `Summon the chat`). Geometry read with
`getBoundingClientRect` + `document.elementFromPoint` (a control counts as reachable only when it is
in the viewport **and** the hit test lands on it or inside it).

Screenshots were taken with Playwright's own `page.screenshot` so they really are the emulated
viewport size (the panel screenshot tool captures the tab's native 2048×1536 instead):
`landscape-844x390-universe.png` (844×390) and `portrait-390x844-universe.png` (390×844).

## Result at 844×390 — before the fix

Chat Universe open, one chat window open:

```
viewport            844 × 390
.lcu-main           clientHeight 583   ← 193px TALLER than the screen
whole page          109 controls in view,  13 reachable
universe            51 controls in view,    5 reachable
Close Chat Universe top 28, bottom 70 — reachable
```

The dialog's grid was taller than the viewport it owns, so the **footer** (`universal composer`,
`Send`, quick dock, `N windows — minimize`) sat below the screen. That part is **not** intentional
hiding — those controls are simply off-screen.

## Result at 844×390 — after the fix

```
viewport            844 × 390
.lcu                390  (exactly the viewport)
.lcu-main           clientHeight 390, scrollHeight 599   ← scrolls instead of overflowing
Close Chat Universe top 24, bottom 66 — reachable
Send                 top 337, bottom 375 — inside the viewport
universe            37 controls in view, 6 reachable
```

## Result at 390×844 (portrait)

```
viewport            390 × 844
.lcu                844
.lcu-main           clientHeight 844, scrollHeight 844
Close Chat Universe top 24 — reachable
chat composer       top 787, bottom 829 — inside the viewport
universe            41 controls in view, 4 reachable
```

## Which unreachable controls are intentional and which were not

The 44.3 report counted "13 of 58". Split by cause:

| Group | Example controls | Verdict |
|---|---|---|
| Covered by the open chat window on a phone surface | rail nav (`Home`, `Chat ∞`, …), timeline ranges (`24H`…`All`), filters (`All (3)`…), chat cards, dock items | **Intentional.** The window is a sheet that owns the screen; the Universe's regions beneath it are not usable while it is open, exactly as the design intends. |
| The window's own chrome | its close, expand, controls toggle, composer, Send | **Reachable** (verified: window Send at 337–375). |
| Universe period controls that must always be reachable | `Close Chat Universe`, `New chat`, layout tools | **Reachable after the fix.** Before it, the grid could push the footer — including `minimize the open windows` — off the screen at short heights. |

## The fix (CSS only, no redesign)

`src/app/scene/genesis/chat/universe/chatUniverse.css`:

```css
.lcu { max-height: 100dvh; overflow: hidden; }   /* never taller than the screen it owns */
.lcu-head { position: sticky; top: 0; z-index: 3; }  /* the way out does not scroll away */
```

No layout, colour, artwork or immersion change: `.lcu-main` already scrolls (`overflow-y: auto`,
`minmax(0, 1fr)`), so bounding the dialog lets it do its job. The Chat Universe still owns the
screen; the conversation state and the open-window set were not touched (they are the existing
`homeStore.universe` / module state).

## Honest limits

- Emulation, not physical devices. No real phone was used; touch target sizes were not measured.
- The two-module-window landscape case from 44.3 was again not reproduced in pixels; the
  `landscapeReflow` geometry stays covered by `tests/module-layout.test.ts`.
- `main.scrollHeight 599 > clientHeight 390` at 844×390 means the card grid scrolls behind the
  open window; that is the sheet design, and the grid remains reachable once the window is closed.
