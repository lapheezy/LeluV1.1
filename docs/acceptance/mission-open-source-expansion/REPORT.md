# LÉLU Job 2 — Open-source expansion: browser demonstrations and acceptance

Status words: **Demonstrated** (run in Chromium inside the real app, evidence in this folder) ·
**Tested** (automated suite) · **Measured** · **Limitation** (works, with a recorded limit) ·
**Not done**.

## 1. Branch, commits, environment

| | |
|---|---|
| Branch | `claude/lelu-open-source-expansion-qz626l` |
| Job 2 implementation | `8d8435e` (from `184b9cd`) |
| Fixes found by these demonstrations | `d80a69c`, `9de2389`, `5019667`, `89fda78`, `18222d8` (§8) |
| Acceptance commit | the commit that adds this report (see `git log`) |
| Machine | cloud container, 4 vCPU (Intel Xeon 2.1 GHz), 15.7 GiB RAM, **no GPU** |
| Browser | Chromium 1243 (Playwright build), headless; WebGL2/WebGPU via SwiftShader (software) |
| App | `vite` dev server on the branch; production build measured separately (§6) |
| Model providers during the demos | **all removed**: the server started without any model key (`/api/ai/providers` → every provider `UNCONFIGURED`), and the browser aborted and counted every generation request (`POST /api/model|ai|chat`) |

Scripts (re-runnable): `scripts/verify-creative-kit.cjs` (main demo), `scripts/verify-film.cjs`,
`scripts/verify-creative-kit-mobile.cjs`, `scripts/verify-connectors-browser.cjs`.

## 2. Results at a glance

| Area | Result |
|---|---|
| Final demonstration run (run 3) | **77/78** — the one failure is an environment time-out, passing separately 6/6 (§7) |
| Chat: 12 creative/data requests typed into Chat Universe with **no model** | **Demonstrated** — 12/12 executed, **0 model calls** (runs 2 and 3) |
| Generative art: 8 styles → SVG + PNG | **Demonstrated** — 16/16 files verified |
| Diagrams: Mermaid from arrows and from text → .mmd, SVG, PNG | **Demonstrated** (PNG after fix `9de2389`) |
| Interactive chart from live USGS data: tooltip, sort, citation; HTML/SVG/PNG/CSV/JSON | **Demonstrated** |
| 3D: 7 presets + custom objects → GLB + glTF; live WebGL2 view; animation | **Demonstrated** — 15 files verified, live view non-blank |
| 3D: optional WebGPU live view | **Limitation** — only a SwiftShader (software) adapter exists here; see §3.4 |
| Film: WebCodecs + Mediabunny → WebM, playback, soundtrack, ffprobe | **Demonstrated** — 525/525 frames, VP9 + Opus, 17.52 s, plays |
| Film: MediaRecorder fallback | **Limitation** — valid WebM + audio, but real-time capture keeps only what the page paints (12 frames / 6 s here) |
| Drawing: editable .excalidraw, SVG, PNG | **Demonstrated** |
| Cards, windows, navigation, reload | **Demonstrated** |
| Phone viewport (iPhone 13 emulation in Chromium) | **Demonstrated** 5/5 — **not** Safari |
| Public data connectors | 10/12 live in the browser; 2 rate-limited on this shared IP (§4) |
| Local AI (Transformers.js / ONNX Runtime Web) | **Measured**, not integrated — recommendation in §5 |
| Boot impact (production build) | +138 KB JS (+2.4 %) at boot; all heavy pieces lazy (§6) |
| Typecheck · lint · tests · build | tsc 0 · lint 0 errors · **2,133 pass / 0 fail / 6 skipped** · build OK |

## 3. Browser demonstrations

### 3.1 Chat, no model (Priority 1.7–1.8)
Each request was typed into the Chat Universe composer with the mouse/keyboard and sent with the
send button. Router stage `direct` ran the tools through the real `ToolDispatcher`.

| Request typed | Path | Result (run 2) |
|---|---|---|
| `/art flowfield ocean` | command | ✓ artwork + SVG, 3.7 s |
| "Make me a generative artwork of a coral tree in forest colours" | no provider → direct | ✓ tree/forest, 6.6 s |
| `/diagram chat -> router -> tools, router -> public data, tools -> files` | command | ✓ flowchart from arrows, 3.7 s |
| "Make an architecture diagram of LÉLU" | no provider → direct | ✓ architecture diagram, 3.7 s |
| `/chart earthquakes` | command | ✓ two interactive charts from live USGS data, 5.1 s |
| `/scene forest` · "Build a 3D desert environment" | command · direct | ✓ scenes + GLB, 4.9 s · 3.9 s |
| "Make a short film about ocean tides" | direct | ✓ film program (encoded on demand, §3.5) |
| `/sketch evening gown` | command | ✓ editable Excalidraw sketch |
| "Make me a concept fashion collection called Nocturne" | direct | ✓ moodboard, line-up sketches, concept mind map, 3D runway + GLB — 14 checks, 35.9 s |
| "Research coral reef bleaching and show me what you find" | direct | ✓ cited research board + mind map from live Wikipedia/Crossref/arXiv, 25.3 s |
| `/capabilities` | command | ✓ device report (2 ✗ are real absences: WebGPU adapter, Web Share) |

**Model calls during the whole run: 0** (`run-2.json` → `modelAttempts: []`).
Replies say plainly that no model was used. Screenshots `screenshots/01…12-*.png`.

### 3.2 Generative art and drawings
All 8 styles exported as SVG (2–48 ms) and PNG via Canvas (1.3–3.3 s at 1200×800) — `files/Style-*.{svg,png}`.
The editable sketch exported as `.excalidraw` (25 editable elements, re-opened), SVG and PNG —
`files/Nocturne-line-up-sketches.*`.

### 3.3 Diagrams and interactive charts
* Mermaid `.mmd`, SVG and PNG for both diagrams (`files/Diagram-*`, `files/LELU-architecture.*`).
  Run 1 found PNG export **failing** ("Tainted canvases may not be exported": HTML labels in
  `<foreignObject>`); fixed by SVG-text labels (`9de2389`), passing in run 2.
* Chart (`files/Earthquakes-*.html`): hover shows a tooltip with the value (`2026-11-07: 5`), clicking a
  header sorts the table (5 → 5, 8, 12, 14, 19), the USGS feed is cited with a link; every value is an
  interactive mark (8/8 and 40/40); SVG, PNG (1520×840), CSV (8 rows), JSON. Screenshot
  `screenshots/20-chart-interactive.png`.

### 3.4 3D scenes
| Preset | meshes | triangles | animated | GLB export |
|---|---|---|---|---|
| forest | 228 | 25,972 | – | 260 ms, 1.3 MB |
| city | 409 | 4,894 | ✓ | 70 ms |
| desert | 11 | 30,264 | – | 214 ms |
| ocean | 47 | 18,268 | ✓ (10) | 73 ms |
| space | 128 | 32,928 | ✓ (6) | 114 ms, 2.4 MB |
| crystal-cave | 42 | 8,532 | ✓ | 56 ms |
| runway | 34 | 26,028 | – | 31 ms |
| custom pavilion (terrain, torus knot, building, 16 crystals, bobbing sphere) | 24 | 15,740 | ✓ (2) | 123 ms |

Every GLB passed the header/version/length/mesh read-back and a glTF (embedded) was written for each
preset (`files/Preset-*.{glb,gltf}`). Live view: the forest rendered with **WebGL2** in the app window
(81 colour bins sampled from the canvas, ready in 6.9 s under software GL) — `screenshots/21-scene-webgl2.png`.

**WebGPU — Limitation.** This machine has no GPU; Chromium exposes only a SwiftShader (software)
WebGPU adapter, and inside the full app no adapter was granted at the time of the `/capabilities`
request. The WebGPU toggle is offered only when an adapter exists; it could not be demonstrated
on real GPU hardware here. WebGL2 is the default path and is what was demonstrated.

### 3.5 Films (WebM) — Priority 1.5
* **Window button** (`scripts/verify-film.cjs`, default flags): "/film ocean tides" in chat → the film
  window's *Render* button → `<video>` ready in **115 s wall**; `ffprobe`: **VP9 960×540, 525 frames,
  Opus audio (876 packets), 17.52 s**; plays (`currentTime` 2.35 s after play). Files:
  `files/film-window-render.webm`, screenshots `30-…`, `31-…`.
* **Main run** (software-GL flags): 640×360, 525 frames + Opus, plays, soundtrack decodes (stereo, peak 0.12).
* **Full 720p** (run 1, before the size step-down): `files/film-720p-fullsize-webcodecs.webm` —
  `ffprobe` VP9 1280×720, 525 frames, Opus, 17.52 s — correct, but took **18.5 min**.
* **Why the size steps down:** measured software VP9 cost here is 274 ms/frame at 720p, 28 at 540p,
  16 at 360p (VP8: 148 / 44 / 7). `renderFilm` now probes the encoder and picks the largest of
  100/75/50 % that fits the budget, and reports the choice (e.g. "960×540 …").
* **MediaRecorder fallback — Limitation.** With `VideoEncoder` hidden the app records a valid WebM
  (VP9 + Opus, correct duration) but, being real time, keeps only frames the page actually paints:
  **5–12 frames in 6 s** while the full app painted ~4 frames/s on this VM (standalone page: ~16/s).
  First version kept 4 of 180 (detached canvas); now draws on an attached canvas and pushes each frame
  (`captureStream(0)` + `requestFrame`). On real devices (60 Hz) this path is much better, but WebCodecs is
  the path to rely on. File: `files/film-mediarecorder-fallback.webm`.

### 3.6 Studio cards, windows, navigation, persistence
Chat cards rendered for every artifact; a card's *Open* opens the window (`screenshots/24-…`); after a
full reload all visuals and drawings were still listed (31 after reload) and a diagram re-opened and
rendered (`screenshots/25-…`).

### 3.7 Phone viewport — `mobile-run.json`
iPhone 13 descriptor in Chromium (WebKit is not installed here: **not a Safari test**): `/art`, `/scene`,
`/diagram` all executed without a model, windows fit 360 px, 0 px horizontal overflow, no page errors.
Found and fixed: the generative preview left a white band in a tall window; the window close button
had no accessible name (now `aria-label="Close window"`). Note: on a phone the artifact window covers
the composer — the window's *Chat* button returns to the conversation.

### 3.8 External hosts during the demo
Only free, no-key hosts: `earthquake.usgs.gov`, `en.wikipedia.org`, `api.crossref.org`, `export.arxiv.org`,
`api.allorigins.win` (existing CORS relay, arXiv only), plus pre-existing app dependencies:
`esm.sh` (Excalidraw fonts — so drawing SVG/PNG export is **not fully offline on first use**) and
`cdn.jsdelivr.net` (drei Draco/KTX2 decoders). Supabase was blocked by the test. **No model or paid host.**

## 4. Public data connectors — validation matrix

Same 12 queries from Node (`connectors-node.json`) and from inside the app in Chromium (`connectors-browser.json`), 2026-11-14.

| Connector | Node | Browser (app) | Notes |
|---|---|---|---|
| wikipedia.summary | 429 | ✓ 5.0 s | Wikimedia rate-limits this shared cloud IP intermittently (curl: 200 then 429) |
| wikipedia.search | ✓ | ✓ 1.3 s | |
| wikidata.sparql | ✓ | ✓ 1.0 s | |
| crossref.works | ✓ | ✓ 3.6 s | |
| arxiv.search | ✓ | ✓ 8.8 s **via relay** | no CORS header → browser uses the existing `corsFetch` relay (api.allorigins.win) |
| openalex.works | ✓ | **429** | keyless requests share a daily budget per IP; LÉLU does not create the (free) key |
| usgs.earthquakes | ✓ (122) | ✓ (120) | |
| nws.forecast | ✓ | ✓ 5.4 s | US only (two requests: points → forecast) |
| openmeteo.forecast | ✓ | **429** | shared-IP daily allowance; non-commercial terms |
| hackernews.top | ✓ | ✓ 4.8 s | |
| github.releases | 403 (rate limit) | ✓ 0.9 s | 60 unauthenticated requests/hour/IP; earlier this session's proxy also blocked it |
| nominatim.search | ✓ | ✓ 2.5 s | 1 request/s policy respected by pacing |

Rate-limited answers fail fast with the reason (a daily 429 is not retried); nothing was bypassed and
no key was introduced. Availability on a shared cloud IP varies by the minute; on the VPS or a user's
own connection the IP's budgets are its own.

## 5. Local AI evaluation (Transformers.js 4.3.2 / ONNX Runtime Web 1.31) — Priority 2

Installed in an **isolated scratch folder, not in the project**. Models served from local files with
remote downloads disabled; **0 external requests** during browser inference (`local-ai/`).

| Model (licence) | Download | Node, native CPU | Chromium, WASM (4 vCPU) | Chromium "WebGPU" (SwiftShader) |
|---|---|---|---|---|
| all-MiniLM-L6-v2 q8 — embeddings (Apache-2.0) | 23 MB | load 0.2 s · 8 sentences 27–62 ms | load 1.8 s · 8 sentences 97 ms warm | 892 ms (software) |
| whisper-tiny.en q8 — speech→text (Apache-2.0) | 41 MB | 11 s audio → 2.2 s, exact transcript | 11 s audio → **3.4 s**, exact transcript | 102 s |
| SmolLM2-135M-Instruct q4 — text (Apache-2.0) | **182 MB** | 48 tokens 2.2 s | 48 tokens **17.2 s**, weak output | 379 s |

Runtime cost: `transformers.min.js` 588 KB + one ORT WASM binary 14–28 MB (lazy); `npm` install pulls
~745 MB (native onnxruntime-node, sharp) — browser-only use needs only the web bundle and WASM.
Semantic quality check: cos(reef, restoration) 0.62 vs cos(reef, bread) 0.06.

**Recommendation**
1. **Worth adding, opt-in:** *speech-to-text* (whisper-tiny.en, 41 MB) as an offline fallback for voice
   when the server STT worker is unreachable, and *embeddings* (MiniLM, 23 MB) for offline memory /
   tool search. Both are fast on WASM, Apache-2.0, cacheable in the browser (Cache API) and give LÉLU
   capabilities she lacks offline today. Download only on first use, with the size shown.
2. **Not worth it:** small text models in the browser. SmolLM2-135M is 182 MB, 17 s for 48 tokens on
   WASM, and its writing is not good enough to replace the direct tools or a real model; larger models
   (0.5–3 B) need 0.4–2 GB downloads and a real GPU.
3. **Not tested here:** real GPU WebGPU speed (no GPU); **mobile Safari** (no Safari/WebKit or iOS
   device in this environment). iOS limits tab memory (~1–1.5 GB) — keep to the two small models above.
4. Not added in this job: no dependency was installed in the project; this is a measured proposal.

## 6. Performance and bundle impact — Priority 4

**Production build vs `184b9cd`** (`bundle.json`, `boot-production.json`, served locally, 3 runs each):

| | before | after | Δ |
|---|---|---|---|
| `index.html` entry JS | 374,542 B (114,893 gz) | 374,584 B (114,929 gz) | +42 B |
| JS downloaded up to the entry screen | 5,736,644 B / 260 files | 5,874,509 B / 261 files | **+137,865 B (+2.4 %)** |
| Time to entry screen | 1.25–2.04 s | 1.43–1.90 s | within noise |
| JS heap at entry | 77–104 MB | 91–101 MB | within noise |
| All JS in the build | 26.5 MB | 28.4 MB | +1.9 MB, all lazy |

Kit renderer chunks loaded at boot: **none** (Mediabunny 760 KB chunk, `three.webgpu` 665 KB,
GLTFExporter, VisualViewer load only when used). Excalidraw moved from the drawing-editor chunk into a
shared chunk (1.06 MB → shared 1.10 MB), not duplicated. The +138 KB at boot is the kit's own logic
(tool definitions, connectors, compilers) reached through the tool registry — candidate for a further
split (§9).

**Measured runtimes (Chromium, this VM):** first artifact from chat 3.7–6.6 s end to end; GLB export
31–260 ms; PNG rasterisation 1.3–3.3 s; live 3D ready 6.9 s (software GL); film encode 59–101 s for 17.5 s
of video at 540p/360p (software VP9); dev-server heap 283 MB at boot, ~700 MB peak during film
encoding, 571 MB at the end of the run.

**Two performance defects found and fixed:** films re-rasterised a 340 KB SVG every frame (now once);
open 3D windows rendered continuously off screen (~310 % CPU here; now only while visible).

## 7. Regression and gate

Final demonstration run (**run 3**, on the final code; `run-3.json`, `run-3.log`): **77/78 checks passed.**
* 12/12 chat requests executed with **0 model calls**; 0 failed exports (16 generative, 6 diagram,
  6 chart, 15 3D, 3 drawing); WebM 525/525 frames VP9 + Opus (ffprobe); no page errors.
* The one failed check is *"film rendered from the window's button"* **in this run's software-GL
  browser launch**: it was still encoding when the script's 5-minute wait ended (the encoder probe
  measured 2.5 s/frame at 720p with SwiftShader competing for the CPU). The same button path passes
  **6/6** in `scripts/verify-film.cjs` with default browser flags (`film-run.json`: 115 s, 525 frames,
  plays). Recorded as an environment limit, not hidden.
* Earlier runs kept for comparison: run 1 (`run-1-before-fixes.*`, 74/77, before the fixes in §8) and
  run 2 (`run-2.*`, 75/78).

Gate on the final code:

| Check | Result |
|---|---|
| `tsc -b --force` | exit 0 |
| `oxlint` | exit 0, **0 errors** (warnings only, all in files this job did not touch) |
| `npm test` | **2,139 tests: 2,133 pass, 0 fail, 6 skipped** (2,114 → 2,139 with `tests/creative-kit.test.ts`) |
| `npm run build` (production) | exit 0 |
| Film window (default flags) | 6/6 (`film-run.json`) |
| Phone viewport | 5/5 (`mobile-run.json`) |

Regression scope: the existing chat routing, voice, Cosmos, Studio (documents/decks/sheets/graphs/
drawings), Forge/world tools and spend-policy suites are all in the 2,133 passing tests; the demo runs
exercised the existing chat UI, Studio cards/windows, Cosmos home and reload persistence with no page
errors. Voice was not re-run live in this job (no audio device; its suites pass).

## 8. Defects found by the demonstrations (all fixed, re-verified)

| Found | Fix |
|---|---|
| Film encode >14 min: vector SVG re-rasterised every frame | rasterise once (`d80a69c`) |
| 3D windows render off screen (CPU starvation) | render only when visible (`d80a69c`) |
| Diagram PNG "Tainted canvases" | Mermaid SVG-text labels (`9de2389`) |
| 720p software encode 18 min; MediaRecorder kept 4/180 frames | measured size step-down; attached canvas + explicit frames (`5019667`, `89fda78`) |
| Phone: white band under artwork; close button unlabeled | `18222d8` |
| Film title "film ocean tides" | subject extraction (`d80a69c`) |

## 9. Known limitations and next steps

1. **WebGPU and real GPU performance not demonstrated** (no GPU). Next: run the scripts on a GPU
   machine; keep WebGL2 default.
2. **MediaRecorder fallback is frame-rate-limited** by the page's paint rate; WebCodecs is the
   supported path (Chrome/Edge, Firefox ≥ 130, Safari 16.4+ — Safari not tested here).
3. **Safari / iOS not tested** — WebKit not installed. Next: run `verify-creative-kit-mobile.cjs` with
   Playwright WebKit or on a device.
4. **Excalidraw fonts from esm.sh**: self-host them (`EXCALIDRAW_ASSET_PATH`) to make drawing export
   fully offline.
5. **Boot +138 KB**: lazy-load `CreativeKitTools`/connectors behind the dispatcher.
6. **Connectors on shared IPs** are rate-limited at times (Wikimedia, OpenAlex, Open-Meteo, GitHub);
   behaviour is correct (fails fast with the reason). Wikimedia asks for a contact in the User-Agent —
   add one only with the owner's approval.
7. **Local AI**: implement opt-in Whisper-tiny STT fallback and MiniLM embeddings (§5).
8. **Not deployed**; demonstrated on the dev server and a local production build only.
