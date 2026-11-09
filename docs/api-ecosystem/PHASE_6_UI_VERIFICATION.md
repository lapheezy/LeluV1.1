# Phase 6 — UI Integration and Mobile Verification

**Status:** PARTIAL. The usage view is integrated and verified in **Playwright device emulation** at five viewports. It was **not** tested on a physical iPhone or in Safari/WebKit (only Chromium is installed here). One pre-existing overlay issue was found.
**Code commit:** `c274436`

## What changed in the interface

A **Usage & budgets** section in the existing Settings panel (`src/app/scene/genesis/UsageSection.tsx`, mounted after the Voice section in `GenesisSettingsPanel.tsx`). It adds no new window, route or shell.

- Period tabs: Session / Today / 7 days / Month.
- Tiles: AI calls (failed, rate-limited); AI tokens (reported) with cached input, or "N call(s) reported no tokens"; AI cost ("Unknown" plus the count of calls without a reported cost); source calls.
- Rows per model and source: calls, failures, tokens or "tokens n/a", average latency, and the budget warning or refusal text.
- Daily call-cap editor per source. Inputs are 16 px so iOS Safari doesn't zoom on focus.

## Viewport results

`scripts/verify-api-ecosystem-ui.cjs`, Chromium (`/opt/pw-browsers/chromium`):

| Device profile | Viewport | Data | Usage section | Page errors |
|---|---|---|---|---|
| iPhone SE | 320×568 | replayed† | no horizontal overflow, 0 elements past the viewport | 0 |
| iPhone 13 | 390×664 | **live turn** | no overflow, 0 past the viewport | 0 |
| iPhone 15 Pro Max | 430×739 | replayed† | no overflow, 0 past the viewport | 0 |
| Pixel 7 | 412×839 | replayed† | no overflow, 0 past the viewport | 0 |
| Desktop | 1440×900 | **live turn** and replayed† | no overflow, 0 past the viewport | 0 |

† *Replayed* means the ledger recorded by the real iPhone 13 turn was loaded before the page started, to check layout without paying for more model calls. The app's own background cognition still made one real call during those runs, so they show 3 AI calls rather than the seeded 2.

## Finding (pre-existing, not fixed)

On phones, the floating **"Lélu" companion window** sits over the lower right of the Settings panel and covers part of the usage rows ([evidence/phase6/usage-iPhone13.png](evidence/phase6/usage-iPhone13.png), [usage-iPhoneSE-replayed.png](evidence/phase6/usage-iPhoneSE-replayed.png)). The section itself does not overflow. The companion overlay belongs to the avatar subsystem, which another workstream owns (`claude/avatar-3d-world`), so it was reported rather than changed here.

## Evidence

[evidence/INDEX.md](evidence/INDEX.md)
