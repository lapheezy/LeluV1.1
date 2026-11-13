# Mission Chat Universe Reinforcement 1 — evidence

Phone defect: opening a conversation from the Chat Universe painted the
conversation sheet over the Universe header, so the header, its cards and its
close control disappeared and the app read as if the Universe had closed.

Fix (two files, +76 lines): `GenesisModuleHost.tsx` reads the existing
`useUniverseOpen()` store and, only when the Universe is open and the window is
a phone sheet, starts the sheet below the Universe header
(`UNIVERSE_COMPACT_HEAD = 88` plus `env(safe-area-inset-top)`), with
`paddingTop: 0` so the safe area is not applied twice. `tests/chat-surface.test.ts`
carries the regression test.

Branch `mission/chat-universe-reinforcement-1` from
`098dd3e14b11f570b958380628997e3cc41375f0`.

## Results in this directory

| File | What it records |
| --- | --- |
| `prefix-universe-phone-check.json` | pre-fix run: 27/42, 80px header overlap at 3 phone viewports |
| `postfix-universe-phone-check.json` | post-fix run at implementation time: 42/42 |
| `review-universe-phone-check.json` | re-run on the final branch: 42/42 |
| `review-edge-cases.json` | safe area (CDP `setSafeAreaInsetsOverride`, top 47): header 57–127, sheet 135; keyboard proxy 390×480 and 390×380; close/reopen; composer typing — 14/14 |
| `review-desktop-probe.log` | 1440×900 desktop window unchanged: 1338×818 at (88,64), draggable, no errors |
| `review-chat-tests.log` | 84/84 chat tests, exit 0 |
| `review-typecheck.log` | `tsc -b --force`, exit 0 |
| `review-build.log` | `vite build`, exit 0 |
| `chat-tests.log`, `typecheck.log`, `build-final.log` | the same checks from the implementation run |
| `verify-mobile-chat.log`, `verify-mobile-chat.local.mjs` | why the repo harness could not run unmodified (pinned `/opt/pw-browsers/chromium`; entry step drives the retired classic chat panel) |
| `shots/` | pre/post screenshots at every viewport, plus safe-area, keyboard and typing states |

## Reproducing

```
npx vite --port 3001 --strictPort
node artifacts/mission-chat-universe-1/universe-phone-check.mjs http://127.0.0.1:3001/
node artifacts/mission-chat-universe-1/edge-cases-check.mjs   http://127.0.0.1:3001/
node artifacts/mission-chat-universe-1/desktop-probe.mjs      http://127.0.0.1:3001/
```

The browser checks need Playwright's Chromium (`npx playwright install chromium`);
in this sandbox they also need
`LD_LIBRARY_PATH=$HOME/sysroot/root/usr/lib/x86_64-linux-gnu` because the host
image lacks the Chromium system libraries and there is no root.

## Limits

- No physical iOS device. The notched-device path is exercised through CDP safe
  area emulation, not hardware.
- The keyboard is approximated by shrinking the viewport (same
  `visualViewport.height` the sheet sizes from); no real system keyboard exists
  headless.
- No AI turn is sent, so no provider or streaming claim is made.
- Remaining defects documented, not fixed: identity sheet rendering over an open
  chat, 3D scene rendering behind chat, hidden desktop chat re-rendering,
  unconsumed chat-open telemetry, missing inline chart/math, persistent browser
  sessions, physical iOS validation.
