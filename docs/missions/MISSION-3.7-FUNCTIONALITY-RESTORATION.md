# Mission 3.7 — LÉLU functionality restoration

Branch `claude/lelu-voice-https-production-lvv519`. Nothing deployed; production untouched.

## Real state

| Item | Finding |
| --- | --- |
| Production commit | `a7503839`, not on GitHub. Its build cannot be read from here: every asset sits behind the sign-in gate. |
| Integration | `integration/lelu-four-workforce-consolidation` @ `cb9aecdb`. The working branch adds Mission 3, 3.6, 3.6.1 and 3.7 on top. |
| Mission 3.6 / 3.6.1 fixes in production | **None.** Nothing has been deployed since they were written, so the owner is still using the code that had every bug below. |
| How the app was tested | The real server (`bun run server.ts`, with APIs) serving the production build of this branch, driven by Chromium with **real touch events**. Each control was tapped on a fresh page, and the test recorded what changed afterwards (URL, dialogs, windows, panel, aria state, scroll, visible controls). That checks whether something actually happens, not only whether the control can be hit. |

## Root causes (each reproduced, fixed, and re-tested)

1. **The avatar stood on the Home cards** (3.6, `6d32c65c`; never deployed).
   - Symptom: Infinite Library, Development and Business on iPhone 15 Pro Max, and Jewelry and Fashion on iPhone SE,
     opened LÉLU instead of themselves.
   - Cause: `cosmosHome.css` `.lch-hero-lelu { grid-column: 2 }` applied inside the phone's one-column `.lch-lelu`
     grid, so the reserved hero spot measured 0 px wide and she fell back to resting bottom-right.
   - Fix: `homeComposition.css` gives the spot `grid-area: auto`. As a guard, `presencePlacement.ts` treats Home's
     controls as obstacles.
2. **Search did nothing** (3.7, `43aa47f4`). This affected all four viewports, and ⌘K on desktop Home too.
   - Cause: `SpatialNav.tsx` Search (and the chat menu's "Command palette") dispatches ⌘K, but the palette and its
     only listener were mounted inside the top chrome in `GenesisInterface.tsx`, which
     `surface.chatOwnsScreen || showHome` does not render.
   - Fix: a trigger-less `<GenesisCommandPalette trigger={false} />` is mounted exactly when the top chrome is not,
     so there is always one listener and never two.
3. **Weather looked dead** (3.7, `43aa47f4`).
   - Cause: a refused location kept "Use my location" on screen. Safari always refuses location over plain http,
     which is how production is served. Once a forecast showed, the tile was a button with no action.
   - Fix: `homeWeather.ts`, `useHomeLive.ts` and `HomeModules.tsx` now give the reason ("Location needs HTTPS on this
     address" / "not allowed"), and a tap on a shown forecast refreshes it.
4. **Cards visible through the bottom bar took the wrong tap** (3.7, `5f96ea74`).
   - Symptom: Research opened Search; Business opened Settings.
   - Cause: Home scrolled under the translucent bar and stayed visible through it.
   - Fix: on phones, `spatialNav.css` fades Home's content out just above the bar (a mask on the fixed scroller);
     the content scrolls into reach as before.

## Voice

- The microphone button works on a secure page: real tap, fake microphone, the button switches to listening.
- On an insecure page (`isSecureContext === false`, as on `http://157.173.116.95`) it shows "Microphone requires
  HTTPS. Open this page over HTTPS." **Voice on the owner's iPhone needs HTTPS** (the `https-ip.sh` route from
  Mission 1, not yet enabled); no code change can work around this.

## Chat (real server, real provider)

- Chat opens and a conversation's composer appears.
- A double tap on Send gives one user message.
- A real answer arrives in about 3 s and contains the requested word.
- The microphone responds.
- No page errors.

## Performance (WP06)

Idle Home in headless Chromium spends about 5 s of every 5 s busy. The profile shows app JavaScript at about 250 ms
and the rest native, which here is CPU-emulated WebGL (SwiftShader). This is not evidence about a real iPhone, which
renders on its GPU, and is **not claimed as a cause**. Measuring it needs a real device.

Other observations:
- The local-LLM probes only run on `localhost` (confirmed from a non-local address).
- `/api/engineer/status` answers 503 by design.

## Results

| Check | Before | After |
| --- | --- | --- |
| Tap crawl, Home (iPhone SE / 15 / 15 Pro Max / desktop) | iPhone 15: Search dead, Weather dead, 2 cards through the bar | SE 26/30, 15 30/32, Pro Max 32/33, desktop 33/33. Every remainder is a card that starts under the bar, which takes its tap once scrolled, plus one tile whose label changes between page loads. |
| `tests/e2e/home-controls.e2e.mjs` (4 viewports) | 1/18 | 18/18 |
| `tests/e2e/mobile-touch-targets.e2e.mjs` (3 iPhones) | 21/33 (3.6 baseline) | 36/36 |
| `tests/ui-fix-deploy.test.ts` (deploy rehearsal) | — | 4/4 |

**Not verified:** real iPhone Safari. Only Chromium is available here (WebKit cannot be installed), and Chromium
emulation is not Safari. The real-device step stays in playbook `verify-interaction`.

## Deployment (requires the owner's explicit approval)

`deploy/contabo/ui-fix.sh` with `deploy/contabo/patches/ui-touch-and-controls.patch` (8 front-end files,
`cb9aecdb`..fix):
1. the patch may touch only the allow-listed files, and must pass `git apply --check` against production;
2. backup;
3. typecheck;
4. build into `dist.next`;
5. refuse a build carrying a credential pattern;
6. swap `dist/` (no restart);
7. verify the served index;
8. roll back automatically on any failure;
9. `rollback` restores the old `dist/` and the files.

Run from the console as root at commit `e77184466079eea250336072091b834cb6cc89f3`:

```
C=e77184466079eea250336072091b834cb6cc89f3
curl -fsSLo ui https://raw.githubusercontent.com/lapheezy/LeluV1.1/$C/deploy/contabo/ui-fix.sh
curl -fsSLo ui.patch https://raw.githubusercontent.com/lapheezy/LeluV1.1/$C/deploy/contabo/patches/ui-touch-and-controls.patch
sha256sum ui ui.patch | cut -c1-16     # de377f6d13f76de1 and ce3b23ffae7c9580
bash ui recon ui.patch                 # read-only; send the output for review
```

Only after the recon has been reviewed: `bash ui apply ui.patch`. Undo: `bash ui rollback`.

If recon reports that the patch does not apply, production's copies of those files differ from integration. The
recovered production source (Mission 3.6.1) is then needed to rebase the patch. Nothing is changed in that case.
