# Mission 44.7 — live browser acceptance and measurements

Environment: `vite --host 0.0.0.0 --port 3001` behind the owner-authenticated preview origin
`pv-08af6cc9ef21-…freebuff.site`, real free providers (OpenRouter, Groq) and the real laboratory
API on this machine. No credential, key or full conversation text appears below — only counts,
statuses, timings and the exact sentences the product showed.

"Mobile" means a Chromium context with `viewport 390x844 / 375x812 / 430x932`, `isMobile`,
`hasTouch`, devicePixelRatio 2 and an iPhone 17.5 Safari user agent. **No physical iPhone was
available.** "Landscape" is the same emulation at 844×390; desktop is 1440×900 with no emulation.

## How the interrupted state was produced

A conversation was seeded into the app's own workspace key (`lelu.multichat.workspace.v1`) with one
user message and `processing: false`, then the page reloaded, so the message predates the page's
boot — the exact shape a reload during generation leaves. Later runs produced the state honestly:
send a question with every model call held open, reload 1.8 s later.

---

## B1 — the interrupted-turn notice renders (Chat Universe)

Desktop-class tab (654×1024 CSS px). Conversation opened from the Universe grid.

* `[data-lelu-interrupted]` present: **1**
* text: `That turn stopped before it answered · The page was closed or reloaded while LÉLU was
  working, so no reply was saved. Nothing is still running. · Try again`
* screenshot: `w03-interrupted-notice-universe.png`, `w05-notice-before-retry.png`

## B2 — "Try again" before the fix (defect D2, reproduced)

One send event; two model round-trips; stored history afterwards:

```
user:      Using your laboratory tools: which branch is checked out right now?
user:      Using your laboratory tools: which branch is checked out right now?
assistant: mission/44-7-claim-integrity
```

`processing: false`, notice cleared. The turn was not duplicated; the **question** was.

## B3 — "Try again" after the fix

Same scenario, fresh conversation (`44-7-retry-reuse`):

* send events: **1**
* model round-trips: **2** (tool decision + answer)
* history: **2** messages — `user` (id `44-7-r1`, the original), `assistant`
* answer: `mission/44-7-claim-integrity` (correct branch at that moment)
* `processing: false`; notice gone
* screenshots: `w05-notice-before-retry.png` (before), `w07-…` (after)

## B4 — reload DURING generation (honest reproduction)

Every `/api/model/*` call held open (a promise that never settles), question sent, reload 1.8 s
later:

| Moment | `processing` | messages | last role | notice |
|---|---|---|---|---|
| before send | false | 8 | assistant | 0 |
| 1.8 s after send | **true** | 9 | user | 0 |
| after reload | false (store) | 9 | user | **1**, `Try again` visible |

Before the fix in this mission, storage still said `processing: true` **ten seconds after the
reload** while the notice was correctly shown — the in-memory correction was never written back
(defect D5). After the fix, storage reads `processing: false` and the notice renders
(`w08-notice-after-persisted-flag-fix.png`).

## B5 — live HTTP 429 (defect D3, reproduced and fixed)

`window.fetch` wrapped so every `/api/model/*` call answers `429 {"error":{"message":"Rate limit
reached…"}}`. Question: *"In one short sentence: what is a git branch?"*

**Before the fix**

* model attempts: 2 · user messages added: 1 · `processing` cleared
* reply: `I'm in offline mode right now — all AI providers are unreachable or unconfigured, so I
  can't generate new answers…` — an outage described for a rate limit.

**After the fix** (`w06-live-429.png`)

* model attempts: 2 · user messages added: 1 · `processing` cleared
* activity timing: **959 ms** start→finish
* reply: `Every provider that could answer is rate-limited or out of capacity for this model right
  now, so the request never reached one. Nothing was lost — nothing ran and nothing was sent twice.
  Give it a minute and ask again.`

## B6 — a healthy turn, measured

Question: *"In one short sentence, what is a git branch?"*

| Measurement | Value |
|---|---|
| Send → first visible text | **4 332 ms** (polled the app's own storage, ≈250 ms write granularity) |
| Turn activity start→finish | **4 094 ms** |
| Provider | OpenRouter |
| Activity steps | 3 |
| User messages added | 1 |
| `processing` afterwards | false |

## B7 — layout matrix (real viewports, notice open)

| Viewport | Overflow | Notice box | Try again in viewport | Composer | Target height | Screenshot |
|---|---|---|---|---|---|---|
| 390×844 | none | 356×162 @ y262 | yes | 360×50 @ y779 | 34 px | `mobile-390x844.png` |
| 375×812 | none | 341×162 @ y262 | yes | 345×50 @ y747 | 34 px | `mobile-375x812.png` |
| 430×932 | none | 396×142 @ y262 | yes | 400×50 @ y867 | 34 px | `mobile-430x932.png` |
| 844×390 | none | 810×117 | yes | 814×50 @ y325 | 30 px | `landscape-844x390.png` |
| 1440×900 | none | 928×120 | yes | 932×50 @ y829 | 30 px | `desktop-1440x900.png` |

No horizontal or vertical overflow at any size; the composer and the recovery control are inside
the viewport at every size. The recovery control is 30–34 px tall — below the 44 px touch-target
guideline, and shared with every failure chip in the app (`lelu-cc-chip`), so it was not changed
here.

## B8 — process termination (persistence)

`SIGKILL` of the dev server, then restart (`persistence.log`):

* `.lelu-lab/state/{discoveries,experiments,scheduler,sync}.json` — sha256 **identical** before and after
* `GET /api/lab/status` — **200** before and after, same byte size (131 107)
* differing top-level keys: `token`, `startedAt` (per-process) and `github` (live remote reachability)
* `scheduler` and `repository` sections **identical**

## What this evidence does NOT cover

* iOS Safari, the software keyboard, `visualViewport` resizes and safe-area insets.
* A host reboot (this VM has no init system).
* The classic chat transcript, which renders nothing in this build (`<GenesisChat hidden />`).
* A genuine stale-claim model turn (the correction is covered by the family tests).
