# FREEBUFF — LÉLU capability expansion from `7e78a3f`

Date 2026-11-14 · Branch `freebuff/capability-expansion` · Base commit `7e78a3f`

## 1. Starting state

| item | fact |
|---|---|
| Starting commit | `7e78a3f` "Mission 4: persist .lelu-state in deployments; acceptance report" |
| Branch containing it | `claude/lelu-integration-performance-eai80a` — and it is also the tip of `integration/lelu-four-workforce-consolidation` |
| Commits after `7e78a3f` | **none** (`git rev-list --count 7e78a3f..FETCH_HEAD` = 0 on both) |
| Newer work | none to reconcile: `1db42ab`, `e6a533e`, `548209e` are all ancestors of `7e78a3f` |
| Difference from `7e78a3f` | none — this branch starts exactly there |

Mission 4's own commits, all already in: `8d8435e` (open-source creative kit, public data connectors, no-model execution), `24c33dd` (resource intelligence + STL/OBJ export), `caf0fb3` (Job 3 report), `c58f339` (capability ledger), `624982c` (integration fixes from the live demos), `7e78a3f` (state persistence + acceptance).

## 2. What was already integrated (verified, not assumed)

`tests/creative-kit.test.ts` — **17/17 pass**, including:

- *"with EVERY model provider unavailable, a creative request still executes through real tools"*
- *"an editable drawing exports as a .excalidraw file that re-opens with every element"*

| Capability | How it exists |
|---|---|
| Editable drawing | `@excalidraw/excalidraw` in Studio, exported as `.excalidraw` |
| Procedural artwork | `GenerativeArt.ts` + `VisualArtifacts.ts` (SVG → PNG), no model |
| 3D scenes / export | `Scene3D.ts` on **three.js** (GLB/glTF via `GLTFExporter`, STL/OBJ) |
| Diagrams | `Diagram.ts` + **mermaid** 11 |
| Charts | `InteractiveViz.ts`, fed by public data (`rowsToViz`) |
| Video | `VideoComposer.ts` — Canvas + Web Audio + **WebCodecs**, containerised by **mediabunny** |
| Graphs / flow | `@xyflow/react` |
| Graphs/3D editors | lazy chunks (not in the startup bundle) |

Cross-cutting: `BrowserCapabilities.ts` (what this device can actually execute), `CapabilityProfiles.ts`, `DirectResolver.ts` + `DirectCompiler.ts` (deterministic request → tool plan, no model), all registered through `ToolRegistry` → `ToolDispatcher` → evidence, and surfaced as Studio artifacts + chat cards. No disconnected workspace was created.

## 3. What this pass added

**Three missing keyless connectors** in `src/core/data/PublicDataConnectors.ts` (12 → 15):

| id | Service | Verified live here |
|---|---|---|
| `sec.filings` | SEC EDGAR submissions | **200** — Apple Inc., 3 filings, `4 2026-11-12` |
| `rss.latest` | RSS 2.0 / Atom, any public feed | **200** — 3 real Hacker News items with dates |
| `gdelt.articles` | GDELT DOC 2.0 | **429** — "one request every 5 seconds"; refused precisely, paced at 6 s |

Each keeps the layer's contract: `auth: "none"`, documented limits/terms/attribution, client-side pacing, TTL cache, timeout + retry on 429/5xx, and a citation on every result. `rss.latest` carries an SSRF guard: a feed address from the caller must be http(s) and a **public** host (`localhost`, `127.`, `10.`, `192.168.`, `169.254.`, `172.16–31.`, `::1` refused) because the fetch also happens server-side.

**`/api/execution/events` was 404 in the served app.** Mission 6.1.7 mounted that middleware in `server.ts` only, so a browser build POSTed its execution stages to a route that did not exist — evidence was silently lost. Now mounted in `vite.config.ts` for both `configureServer` and `configurePreviewServer`: verified **404 → 200**.

**Tests**: one new connector test (GDELT/SEC/RSS shapes, entity decoding, CDATA, SSRF refusal, host list).

## 4. What was deliberately not added

| Candidate | Decision |
|---|---|
| Babylon.js | Not added — three.js already covers the 3D scenes, GLB/glTF/STL export. A second 3D engine is weight without a capability. |
| p5.js | Not added — `GenerativeArt.ts` already does deterministic procedural art with no dependency. |
| Fabric.js / Konva | Not added — Excalidraw covers editable 2D; Konva would duplicate the canvas layer. |
| visx | Not added — `InteractiveViz.ts` produces the charts the chat and Studio already render. |
| ffmpeg / ffmpeg.wasm | Not added — `mediabunny` + WebCodecs encodes the WebM on-device with no 30 MB wasm payload. |
| ONNX Runtime Web / Transformers.js | Not added — no local model weights in the repo; adding a runtime with nothing to run is dead weight. |
| ComfyUI | Not added — no local inference environment exists here (the condition the mission set). |
| Blender | Not available in this VM. |

If any of these is wanted for its own sake, say which and why — each is a deliberate omission, not an oversight.

## 5. Verification run

| Check | Result |
|---|---|
| `bun install --frozen-lockfile` | exit 0 — 957 packages, 3.9 s (**the repo's lockfile is `bun.lock`**; `package-lock.json` is stale, so `npm ci` fails and npm is not the supported path) |
| `tsc -b --force` | exit 0 |
| `npm run build` (tsc + vite) | exit 0, 5.0 s |
| `tests/creative-kit.test.ts` | **17/17** |
| Full suite | **2170 tests · 2161 pass · 1 fail · 8 skipped** (237.8 s) |
| Live app | renders `7e78a3f`; chat answered via `POST /api/model/openrouter/chat/completions` → **200** |

The single failure is `tests/sandbox-security.test.ts` "network: TCP, UDP, DNS and fetch all fail". It is **pre-existing and environmental**: I stashed every change and it fails identically on untouched `7e78a3f` (`6 pass, 1 fail`). The sandbox probe returns empty stdout where it expects `denied:` — the host's `unshare -rn` behaviour, not this work.

## 6. Limitations

- **GDELT is unusable from this build's shared IP right now** (429 at 1 request / 5 s). It is implemented and paced; it needs a quieter egress.
- **Only one OpenRouter key has headroom**; two of three answer `403 Key limit exceeded`. Groq serves both stored keys. No new credentials were created and nothing was purchased.
- `npm ci` cannot be used on this repo until `package-lock.json` is regenerated (or removed); `bun install` is the supported path.
- A browser-served build serves `/api/*` from Vite middleware, so this evidence route exists in dev/preview and in `server.ts` — not in a static-only host.

## 7. Commit

See the commit created with this report on `freebuff/capability-expansion`.
