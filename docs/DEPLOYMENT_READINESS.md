# LÉLU V1.1 — Deployment Readiness

Checkpoint inherited: `e7b667b` on `claude/open-session-rbwmdw` (identical to this
branch's HEAD). Everything below was measured in this container against the real
production build; where a check could not run, it says so instead of passing.

---

## 1. Work inherited from Claude

| Item | State on arrival |
|---|---|
| Branch / commit | `claude/open-session-rbwmdw` @ `e7b667b` — present locally **and** on `origin`, byte-identical to this branch's HEAD |
| Working tree | Clean. Nothing uncommitted, nothing stashed, nothing lost. |
| Handoff document | `docs/LELU_V1_1_HANDOFF_PROGRESS.md`, 469 lines, Passes 1–4 |
| Security pass | Meshy/NewsAPI/YouTube moved server-side; `tests/credential-exposure.test.ts` (6) + `scripts/verify-bundle-secrets.ts` |
| SHAMAN / delegation | PRs #6 and #7 merged into the branch at `d3645c7`; `tests/shaman-routing.test.ts` (14), `tests/delegation-durability.test.ts` (7) |
| Companion + character | 2.5D shader rig (`src/core/avatar/LeluRig.ts`) over `public/avatar/lelu/{gothic,earthy}/body.webp` + `rig.json`; auto-rigged |
| Acceptance test | Self-improvement runs 1–30; run 29 completed the loop with a verified verdict, **not applied** |
| Forge pipeline | `plugins/forge/*`, server-side Meshy workflow; 2 jobs planned, **both `awaiting_approval`** |

No previous work was rebuilt, reverted or re-run. This pass starts at that commit.

---

## 2. Work completed by Freebuff

One change to production code, two verification harnesses, and this report.

### The runtime served every non-HTML file `immutable` for a year

Measured before the change, on `server.ts` serving the real `dist/`:

```
GET /sw.js                  Cache-Control: public, max-age=31536000, immutable
GET /manifest.webmanifest   Cache-Control: public, max-age=31536000, immutable
GET /avatar/lelu/earthy/body.webp   Cache-Control: public, max-age=31536000, immutable
```

`immutable` tells a browser never to revalidate. None of those paths contain a
content hash, so a deploy could never replace them on a phone that had already
loaded them. The worst case is `sw.js`: an installed PWA would never see a new
service worker again, so the app could never update itself on that device.

`server.ts` now picks the policy per asset class:

| Class | Policy | Why |
|---|---|---|
| `/assets/<name>-<hash>.js\|css` | `public, max-age=31536000, immutable` | the hash is in the name; the bytes cannot change |
| `*.html` (shell, SPA fallback) | `no-cache` | revalidate every navigation |
| `/sw.js` | `no-cache` | an installed phone must be able to update |
| everything else (avatar art, rigs, icons, manifest, models) | `public, max-age=0, must-revalidate` | stable path, changeable bytes: one 304 |

### No validator, so no conditional request could ever succeed

Before: no `ETag`, no `Last-Modified`; `If-None-Match` and `If-Modified-Since`
both returned `200` with the whole file. Every asset was all-or-nothing.

Now every response carries a strong `ETag` + `Last-Modified` and answers `304`
with an empty body. The shell's ETag hashes the **served** bytes, because
`server.ts` injects the runtime key bridge into the HTML at request time — a
stat-derived validator would answer 304 and leave a returning browser on the
previous key set.

### No range support: a 49 MB model could not resume

Before: `Range: bytes=0-1023` on a 51,400,000-byte model returned
`200` + all 51,400,000 bytes. Now: `Accept-Ranges: bytes`, `206` with the exact
slice, `416` with `Content-Range: bytes */<size>` for an impossible range, and
`If-Range` honoured (a stale validator gets the full current file, so two halves
of different models can never be stitched together).

### Every request buffered the whole file in memory

`res.end(readFileSync(filePath))` held the entire file per concurrent request.
Now `createReadStream` + `pipe`. Measured with 8 concurrent 51.4 MB downloads:

| | idle RSS | peak RSS (8 × 49 MB) |
|---|---|---|
| before | 86 MB | **335 MB** |
| after | 41 MB | **61 MB** |
| after, final re-check | 40 MB | 61 MB |

Served range bytes are md5-identical to the file on disk
(`curl -r 1000-1099` vs `dd skip=1000 count=100` → `130670a1…` both).

`HEAD` now returns the real `Content-Length` and no body.

### New verification harnesses

- `scripts/verify-asset-caching.mjs` — 33 checks over real HTTP responses.
  It creates its own model-sized fixture in `dist/` and removes it afterwards,
  so nothing large is left where a deploy would serve it.
- `scripts/verify-mobile-model-cache.mjs` — real mobile browser run
  (Pixel 5 emulation) for repeat-visit bytes, Cache Storage, IndexedDB
  round trip, cleared storage and blocked storage. **Written, not yet executed
  here** — see §5.

---

## 3. Outstanding blockers

1. **No mobile browser run.** This image cannot start Chromium: `libnspr4.so`,
   `libnss3.so`, `libatk-1.0.so.0`, `libatk-bridge-2.0.so.0`, `libXcomposite`,
   `libXdamage`, `libXfixes`, `libXrandr`, `libxkbcommon`, `libasound`,
   `libatspi` are all absent; there is no root and `sudo` is refused
   (`no new privileges` is set). Extracting Ubuntu 24.04 packages by hand
   failed on `GLIBC_2.43` — the archive is newer than this host. `CI` installs
   them with `bunx playwright install --with-deps chromium` on
   `ubuntu-latest`, so the script runs unmodified there.
2. **The 49 MB model does not exist yet.** See §5. The information-to-decision
   is in place; the object is not.
3. **No Contabo runbook existed.** `grep -ri contabo` across every `*.md` in
   the repo returns nothing; there is no `Dockerfile`, no systemd unit, no
   `Caddyfile`/`nginx.conf`. §6 is the first one, grounded in the code.
4. **No credential has been rotated.** Unchanged from the inherited handoff;
   it needs the provider dashboards.
5. **LÉLU's own run-29 change is still unapplied.** It needs the owner's
   `project.apply` authorization, plus a fix for the side effect Claude
   recorded (her margin also limits where the user can drag her).

---

## 4. Security and resource risks

### Reachable without authentication (measured)

`server.ts` mounts the engineering runtime on the public listener and
`LELU_ENGINEER_TOKEN` is unset by default:

```
GET  /api/engineer/status   → 200, tokenRequired:false,
                              workspaceRoot:"/workspace/chats/…", cwd, engine, version
POST /api/engineer/command  {"operation":"inspect"} → 200, real stdout
POST /api/engineer/write    → refused: "Writes require a workspace copy …
                              The source project is only changed by workspace:apply."
POST with Origin: https://evil.example → 403
```

So: the origin guard works, source writes are gated behind a copy plus
`workspace:apply`, but **an unauthenticated caller on a public VPS can leak the
absolute workspace path and make the box run `typecheck` / `test` / `build`**.
Those are the heavy ones — that is a denial-of-service lever, not a data breach.
Mitigation is configuration, not code: set `LELU_ENGINEER_TOKEN` (+
`VITE_LELU_ENGINEER_TOKEN` in the same build), or have the reverse proxy answer
`404` for `/api/engineer/*`. `ENV_VARS.md` already documents both.

### Keys still readable in the browser, by design

`VITE_FIRMS_API_KEY`, `VITE_GUARDIAN_API_KEY`, `VITE_GNEWS_API_KEY`,
`VITE_NEWSDATA_API_KEY` — free-tier, browser-only features. Meshy, NewsAPI and
YouTube are already server-side. Unchanged from the inherited handoff.

### Unbounded Cache Storage growth (not tested in a browser)

`public/sw.js` caches **every** same-origin `GET` into Cache Storage:

```js
event.respondWith(caches.match(request).then(cached => { const fresh = fetch(request)…
```

A 49 MB model fetched from this origin would be stored twice on the phone —
once by the HTTP cache, once in Cache Storage — and `cache.put` failures are
unhandled promises that fail silently. On a phone near quota this is a real
storage risk. It is unreachable today (the model comes from Meshy's CDN and is
persisted in IndexedDB), so this is a **latent** risk that becomes live the day
a GLB is served from LÉLU's own origin. Do not change it blind: it is the code
path that makes the PWA work offline, and it needs the browser harness of §5 to
verify a fix.

### No compression

`server.ts` serves everything uncompressed. Measured: the shell is 41,498 B on
the wire with `Accept-Encoding: gzip, br`; `chunk-FOHPRMQF` would be 143 KB
gzipped instead of 662 KB. On mobile data this is the largest remaining
bandwidth cost — larger than anything the model-caching work touches.

### Bundle facts

`dist/` is 16 MB / 1165 files. Largest single file 662 KB (JS). Largest served
non-code asset 174 KB. No `.map` files. `dist/` is git-ignored.

---

## 5. Model caching test results

### The premise, checked first

**There is no 49 MB model in this project.** Evidence:

| Question | Answer |
|---|---|
| Largest file served to a browser | `dist/avatar/lelu/earthy/body.webp` — **173,808 B** |
| Largest file in `dist/` | `assets/chunk-FOHPRMQF-l2z4K2jD.js` — **662,101 B** |
| Any `.glb`/`.gltf`/`.fbx`/`.bin` in `dist/` | **none** |
| Any model file in the repo | **none** — the 44 MB `leluverse/assets/characters/…/references/*.png` are Forge **input** reference images, not served (`dist/` contains no `leluverse/`) |
| Planned model | `leluverse/forge/ledger.json`: `forge-c4c1e9c2` (multi-image-to-3D, 30 credits) and `forge-ca8f7b98` (rigging, 5 credits) — both `state: "awaiting_approval"` |

### How a model would actually reach a phone

`src/core/avatar/Avatar3DReconstructor.ts`: the bytes are fetched from
**Meshy's CDN** (`glbUrl`), stored as an `ArrayBuffer` in IndexedDB
(`lelu-avatar-3d` / `models` / `reconstructed`, keyed by a fingerprint of the
reference image), and read back locally on later visits. LÉLU's own origin is
not in that path at all.

### What was tested, on the real runtime (33/33)

`node scripts/verify-asset-caching.mjs http://127.0.0.1:4173/` — evidence in
`docs/evidence/asset-caching/2026-11-01T02-23-40/http.json`:

| Requirement | Result |
|---|---|
| Repeat visit re-downloads the model | **no** — matching `If-None-Match` → `304`, **0 bytes** |
| Repeat visit re-downloads the shell | **no** — `304`, 0 bytes |
| Repeat visit re-downloads avatar art | **no** — `304`, 0 bytes |
| Correct `Cache-Control` | per class; `immutable` only where the name carries a hash |
| ETag | strong, on every response, including the rewritten shell |
| Conditional requests | `304` for `If-None-Match` and `If-Modified-Since` |
| Immutable where appropriate | 1 year on hashed bundles only |
| Cache persistence / invalidation | revalidation on every load for stable paths; a new `sw.js` is picked up |
| Interrupted download | `206` + `Content-Range`; suffix and open-ended ranges; resumable |
| Storage cleared\* | after a clear the object is fetched in full again — the documented cost |

\* For HTTP caching this is the standard browser behaviour and is asserted by
the header policy; the browser-level measurement is the part that is blocked.

### What was NOT tested

The mobile browser run. `scripts/verify-mobile-model-cache.mjs` is written and
will, on a host with Chromium's libraries, measure: bytes on a repeat visit from
CDP `loadingFinished.encodedDataLength`, Cache Storage contents, a 49 MB
IndexedDB write/read round trip with byte comparison, behaviour after
`Storage.clearDataOrOrigin`, and rendering with `indexedDB` throwing. **Until it
runs, "a phone re-downloads nothing on a repeat visit" is proven at the HTTP
protocol level, not in a real mobile browser.** The IndexedDB claim in
particular is code-level only: `readStored`/`writeStored`/`clearStored` all wrap
failures in `try/catch` and return `null`, so a blocked store degrades instead
of throwing — but no browser here exercised it.

### Known cost of the current design

`writeStored` rejects if the IndexedDB write fails. In
`Avatar3DReconstructor.reconstruct()` that rejection happens **after** the paid
Meshy job has already run, so a phone that cannot store 49 MB loses the model it
paid for. Worth deciding before the Forge jobs are approved.

---

## 6. Contabo deployment readiness

Verdict: **the app is deployable, the repository is not yet deployable by
itself.** The runtime is correct; the packaging around it does not exist.

### What is ready (verified here)

- `bun install --frozen-lockfile` → exit 0, 676 packages.
- `bun run build` → exit 0, 2.77 s, `dist/` 16 MB / 1165 files.
- `bun run typecheck` → exit 0 (this includes `server.ts`; it is in
  `tsconfig.node.json`).
- `bun run lint` → 0 errors, 76 pre-existing warnings.
- `PORT=4173 bun server.ts` → binds `0.0.0.0:4173`, serves `dist/` with SPA
  fallback, mounts `/api/*`, honest `503` if `dist/` is missing.
- Asset caching, validators, ranges and streaming: 33/33 checks.

### Blocking requirements for a public VPS

1. **TLS is mandatory.** The service worker is registered only when
   `import.meta.env.PROD` **and** `"serviceWorker" in navigator`, which needs a
   secure context. No HTTPS → no offline shell, no install prompt, and
   `getUserMedia`/clipboard degrade. Terminate TLS at a reverse proxy.
2. **Guard `/api/engineer/*`.** See §4 — set `LELU_ENGINEER_TOKEN` at build and
   run time, or block the path at the proxy. Do not widen
   `LELU_ENGINEER_ALLOWED_ORIGINS` to `*`.
3. **Server-only secrets.** `ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
   `MESHY_API_KEY`, `NEWS_API_KEY`, `YOUTUBE_API_KEY`, `AISSTREAM_API_KEY` in
   `.env` (or systemd `Environment=`), **never** `VITE_`. `.env`/`.env.local`
   are git-ignored and must stay that way.
4. **Correct URL base.** `vite.config.ts` sets `base: "/"`, and the manifest
   hardcodes `id`/`start_url`/`scope`/`icon` as absolute `/…`. Serve LÉLU at a
   domain **root**. The GitHub Pages workflow builds `--base=/<repo>/`, which
   the public manifest and the icons do not follow — a subpath deploy would
   install a PWA pointing at the domain root.
5. **Reverse proxy must pass through ranges and validators.** Do not let the
   proxy strip `ETag`, `If-None-Match`, `If-Range`, `Range` or
   `Accept-Ranges`, and do not add its own blanket "cache everything for a
   year" rule on top — that would reintroduce exactly the bug fixed here.

### Minimal runbook

```bash
# on the VPS (Bun 1.4+ ; Node 26 also runs server.ts)
git clone <repo> lelu && cd lelu
bun install --frozen-lockfile
bun run build
LELU_ENGINEER_TOKEN=$(openssl rand -hex 32) \
VITE_LELU_ENGINEER_TOKEN=<same value, put in .env before the build> \
PORT=4173 bun server.ts        # behind Caddy/nginx on 443
```

The client token has to be present at **build** time (`VITE_`), the server token
at run time (`LELU_ENGINEER_TOKEN`). They must match.

Health probes: `GET /api/env-check` (presence only), `GET /api/provider-health`
(live probes), `GET /api/model/status` (booleans only).

Missing and needed before this is a one-command deploy: a `Dockerfile` (or a
systemd unit), a Caddy/nginx snippet, and a CI job that runs
`scripts/verify-asset-caching.mjs` against the built runtime.

---

## 7. Exact next steps

1. **Run the mobile harness somewhere with Chromium:** `CI` on
   `ubuntu-latest` already does `bunx playwright install --with-deps chromium`;
   add `node scripts/verify-mobile-model-cache.mjs http://127.0.0.1:4173`
   beside the existing live-runtime step. That closes §5's only gap.
2. **Decide the model-storage policy before approving the Forge jobs**
   (`forge-c4c1e9c2`, 30 credits): 30k-poly / 2K textures is far below 49 MB;
   if the shipped GLB does land near 49 MB, decide whether IndexedDB is the
   store of record and what happens when the write fails after a paid job.
3. **Set `LELU_ENGINEER_TOKEN`** in whatever environment is about to be public,
   and confirm `GET /api/engineer/status` reports `tokenRequired:true`.
4. **Rotate nothing blindly:** `NEWS_API_KEY` and `YOUTUBE_API_KEY` were the
   only ones the old bridge published; the owner reports having rotated them.
   Still unverified from here.
5. **Add compression** (gzip/brotli for text) to `server.ts`, or put it in the
   reverse proxy with `Vary: Accept-Encoding`. Largest remaining mobile win.
6. **Add the deploy packaging** (§6): Dockerfile or systemd unit, proxy snippet
   with TLS and range pass-through, and the caching check in CI.
7. **Then, and only then, apply LÉLU's run-29 change** once the drag-margin
   side effect is settled.

---

## Verification actually run in this container

| Check | Result |
|---|---|
| `bun install --frozen-lockfile` | exit 0 (676 packages) |
| `bun run build` | exit 0 — 2.77 s, 16 MB, 1165 files |
| `bun run typecheck` (`tsc -b --force`) | exit 0 — covers `server.ts` |
| `bun run lint` | 0 errors, 76 pre-existing warnings |
| `node scripts/verify-asset-caching.mjs` | **33/33 pass**, twice (51,400,000 B and 12,582,912 B fixtures) |
| Peak RSS, 8 × 49 MB concurrent | 335 MB before → **61 MB** after |
| Range bytes vs file on disk | identical (md5 `130670a1…`) |
| `node scripts/verify-mobile-model-cache.mjs` | **not run** — Chromium cannot start here (no root; missing system libraries). Not claimed as passing. |
| Repo unit suite (`bun run test`) | not re-run — no test covers `server.ts`, and `tsc`/build/lint cover the change. Last recorded state: 1003/1003 (inherited handoff). |
