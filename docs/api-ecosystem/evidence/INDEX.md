# Evidence index

All screenshots were captured from the running app (`vite` dev, `http://127.0.0.1:5173`) with Playwright and Chromium (`/opt/pw-browsers/chromium`) on 2026-11-06 UTC. None are edited, and no secrets appear in any of them. The build stamp in the bottom-right corner of each screenshot shows the commit the server was built from. `+dirty` means uncommitted changes were present, which were later committed as `98943a8`/`7e7acf2`/`c274436`.

| File | Phase | Viewport / device | Data | What it proves |
|---|---|---|---|---|
| phase0/baseline-desktop-1440x900.png | 0 | Desktop 1440×900 | — | App state before any change (`62ddd61`) |
| phase0/baseline-iphone13.png | 0 | iPhone 13 emulation | — | Same, on mobile |
| phase3/live-verification.json | 3 | Node | live | 4 adapters and catalog discovery against real endpoints |
| phase4/chat-desktop.png | 4 | Desktop 1440×900 | **live turn** | LÉLU answers the currency question from Frankfurter (ECB 0.89566), with a "Web research · 1 source found" row |
| phase4/usage-desktop.png | 5–6 | Desktop 1440×900 | **live turn** | Ledger rows for Fireworks, frankfurter, wikipedia, gdelt (failed), rss (failed) |
| phase6/chat-iPhone13.png | 4/6 | iPhone 13 | **live turn** | Mobile chat; model answered "define serendipity" without research |
| phase6/usage-iPhone13.png | 6 | iPhone 13 | **live turn** | Usage tiles on mobile; companion overlay overlap |
| phase6/ledger-iPhone13.json | 6 | — | live | The ledger recorded by that turn (used as the replay seed) |
| phase6/usage-iPhoneSE-replayed.png | 6 | iPhone SE 320×568 | replayed | Smallest-phone layout |
| phase6/usage-iPhone15ProMax-replayed.png | 6 | iPhone 15 Pro Max | replayed | Large-phone layout |
| phase6/usage-Pixel7-replayed.png | 6 | Pixel 7 | replayed | Android layout |
| phase6/usage-desktop-replayed.png | 6 | Desktop 1440×900 | replayed | Desktop layout with the replayed ledger |

"Replayed" means a ledger recorded by a real run was loaded before page start; any calls the app made during that run are real.
