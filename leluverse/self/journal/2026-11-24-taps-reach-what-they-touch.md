---
date: 2026-11-24
title: You were standing on the Home cards — now you stand in your own spot, and arXiv comes through your own server
by: Claude (coding assistant)
commits: see `git log -- src/app/scene/genesis/home/homeComposition.css src/app/scene/genesis/avatar/presencePlacement.ts plugins/aiProxyApi.ts`
playbooks: verify-interaction
---
LÉLU, on your owner's iPhone some Home buttons did nothing. On an iPhone 15 Pro Max a tap on "Infinite Library",
"Development" or "Business" opened you instead. On an iPhone SE, "Jewelry" and "Fashion" did the same.

**Why.** On Home you take the hero spot, `[data-lelu-hero-host]`. On phones it measured **0 px wide**. A desktop rule
(`.lch-hero-lelu { grid-column: 2 }`) also applied inside the phone Home, where your module is a one-column grid.
An absolutely positioned child given column 2 of a one-column grid ends up as a 0-wide strip at the right edge.
With no hero spot, your planner rested you in the bottom-right corner, on top of the cards. The planner only
avoided controls marked as such, and Home's cards were not marked.

**What was done.**
- `homeComposition.css`: `grid-area: auto` on the hero spot inside your module. It fills the module again, and you
  stand there, over nothing anyone taps.
- `presencePlacement.ts`: Home's own buttons, links and role=button elements now count as controls, so if the hero
  spot is ever lost again you step aside rather than stand on them.
- `tests/e2e/mobile-touch-targets.e2e.mjs` checks iPhone SE, iPhone 15 and iPhone 15 Pro Max. You must be in the hero
  spot, covering no control. Every Home control must take its own tap at its centre, or after scrolling clear of the
  fixed bottom bar. A Playwright trial tap must reach each control that was blocked. Without the CSS fix it fails
  12 checks; with it, all 33 pass.

**arXiv.** export.arxiv.org sends no CORS header, so a browser cannot read it, and every research query fell back
to a stranger's public CORS proxy (api.allorigins.win). It now goes through your own knowledge relay,
`/api/knowledge/relay?provider=arxiv`. No key is involved; it is limited to `/api/query`, open to signed-in people
only, and paced at arXiv's published one request every 3 seconds. Both `ArxivProvider` and the `arxiv.search` data
connector use it in the browser. `tests/arxiv-server-relay.test.ts` proves it.

**Engineering 503.** `/api/engineer/*` answers 503 because `LELU_ENGINEER_TOKEN` is not set. That is the designed,
fail-closed state on a public host. Enabling it would also mean building the token into the page
(`VITE_LELU_ENGINEER_TOKEN`), so it stays off unless your owner decides otherwise.
