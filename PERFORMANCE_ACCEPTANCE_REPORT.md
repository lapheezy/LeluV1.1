# PERFORMANCE ACCEPTANCE REPORT (WP04)

All numbers are measured, in this cloud container (no GPU; Chromium uses the
SwiftShader software renderer), comparing the **baseline** `096b46b8` with the
**final** workforce tree, same machine, same method. They are container
numbers: they compare builds with each other; they are not iPhone or desktop
GPU figures, and no FPS figure here is a device frame rate.

Raw data: `docs/acceptance/workforce-consolidation/perf-probe.json`,
`browser-*.json`, `cosmos-probe.json`, `logs/`.

## 1. Build and static gates

| Metric | Baseline `096b46b8` | Final | Note |
|---|---|---|---|
| `tsc -b --force` | 26 s, pass | 30 s, pass | +211 source files (ASRE, NRE, couture, continuity, foundry) |
| `vite build` | 8–10 s | **379 s → 6 s** after fix | Regression found and fixed (`3d6051b0`): Tailwind v4 auto-scanned the repo, which now tracks 5.1 GB (was 1.2 GB). |
| `dist/` size | 34.9 MB | 56.8 MB | +17.9 MB is `public/lelu-room/*.glb` (M25 rotating room, served on demand); JS 30.3 → 34.3 MB across 1,830 → 1,866 files |
| Entry chunk `index-*.js` | 478 kB | **2,836 kB → 515 kB** after fix | Regression found and fixed (`3cbedff4`): a static `AIService` import in `GenesisCore` (from the memory-sovereignty line) pulled ~400 modules onto first paint. |
| Unit tests wall time | 266 s (2,434 tests) | 422 s (3,208 tests) | +774 tests |
| oxlint | 0 errors, 184 warnings | 0 errors, 244 warnings | warnings only |

## 2. Server runtime (`bun server.ts`, production mode)

| Metric | Baseline | Final |
|---|---|---|
| Start → first healthy `/healthz` | 121 ms | 116–119 ms warm, 454 ms first cold start |
| RSS at start | 49 MB | 49–50 MB |
| RSS after ~11 min of browser sessions and 8 chat workflows | — | 62–64 MB |
| `/healthz`, `/api/model/status`, `/api/env-check`, `/api/voice/status`, `/api/asre/status` | — | 1–6 ms each |

## 3. Chat and provider latency

| Path | Result |
|---|---|
| Broker → Groq `openai/gpt-oss-120b`, 5 sequential requests | 200 ×5; 0.24 / 0.30 / 0.32 / 0.38 / 0.27 s total |
| Browser: typed message → assistant reply visible (full runtime) | desktop 4.7 s and 7.9 s; iPhone profile 5.7 s (two runs each session) |
| Deterministic local workflows (build, place, rotate, tile) | 5.3–5.8 s end to end, 0 model calls |
| Memory recall turn | 6.8–8.5 s |
| Delegation turn / research turn | 39.6 s / 34.5 s (research stopped: OpenRouter 12 s budget timeout) |
| Speech-to-text, Groq Whisper relay, 3 real recordings | 0.31 / 0.48 / 0.79 s |

## 4. Page load (median of 3 cold loads, buffer raised to 10 000 resource entries)

| Target / profile | Load event | FCP | DCL | Requests in 8 s | Transferred in 8 s | JS heap at 8 s |
|---|---|---|---|---|---|---|
| Baseline / desktop 1440×900 | 489 ms | 124 ms | 84 ms | 687 | 41.2 MB | 369 MB |
| **Final / desktop** | 500 ms | 108 ms | 76 ms | 766 | **24.3 MB** | **168 MB** |
| Baseline / iPhone 13 profile | 431 ms | 120 ms | 84 ms | 687 | 41.2 MB | 383 MB |
| **Final / iPhone 13 profile** | 461 ms | 120 ms | 88 ms | 766 | **24.3 MB** | **184 MB** |

Load and paint timings are unchanged within noise. The transfer and heap drop
is **content, not code**: the baseline loads LÉLU's 31.9 MB face-shapes rig
(`rig/v005_faceshapes…/lelu.glb`) at start; the final tree's M25 wardrobe makes
the 14.3 MB `meshes/v030_look_home_laidback3/lelu.glb` her current look.
(Measured from the top resources of each load.)

## 5. Cosmos / 3D

Software GL only. With `?perf-world` (lifts the governor's software-GL refusal)
the real scene draws (screenshot `cosmos-desktop-perf-world.png`); page-level
`requestAnimationFrame` measured 12/s desktop and 26/s iPhone profile on
SwiftShader. This is **not** a device FPS and is not offered as one. Without the
flag the governor correctly keeps software GL at "never/demand" cadence.

## 6. Browser console findings (final build)

No uncaught page errors in any run. Console errors per load (desktop 13,
iPhone 18), all environmental or by design:

* `/api/engineer/status` 503 — engineering API disabled without `LELU_ENGINEER_TOKEN` (by design).
* `/api/knowledge/relay` 503 — optional news/YouTube/Guardian keys absent.
* `export.arxiv.org` CORS failure from the browser.
* **8 refused requests to `localhost:11434/8080/1234/8000/v1/models`** — local model-server discovery runs on every load. Harmless, but unnecessary background work on a phone; candidate for a "probe only when enabled" setting (not changed in this mission).

## 7. Bottlenecks and regressions — summary

| Finding | Status |
|---|---|
| Production build 379 s (Tailwind repo scan) | **Fixed**, 6 s |
| Entry chunk 2.8 MB (static AIService import) | **Fixed**, 515 kB |
| Repository size 1.2 → 5.1 GB tracked (evidence, ASRE/character assets) | Open — affects clone time, disk and backups (see deployment report) |
| Local model-server probes on every page load | Open, documented |
| `ChatUniverse` (724 kB), `boot-vendor` (1.3 MB), exceljs (930 kB) chunks | Pre-existing, unchanged |
| Mobile 3D frame rate on real devices | **Not measured** — needs a physical device |
