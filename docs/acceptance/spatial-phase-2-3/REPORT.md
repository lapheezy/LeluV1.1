# LÉLU V1.1 — Phase 2.3 acceptance report

**Date:** 2026-11-06
**Branch:** `freebuff/phase-2-2` (worktree `freebuff/078e3ea38e31040bd9a2dce1`)
**Baseline HEAD at start:** `fbdf0cb` (Phase 2.2 addendum), tree `7e1f123`
**Starting state:** clean working tree, `3d6148f` an ancestor of HEAD.

This report separates what was **executed and observed** from what **could not be
proven**. Nothing below is inferred from a unit-test fixture.

---

## 1. Gate A — browser acceptance environment

### The blocker, measured

| Attempt | Result |
| --- | --- |
| Cloud browser panel (`preview_*`) | Real viewport **328×528**, one 120×174 avatar canvas, `__leluSpatialProbe().nodes === 0`. Cannot mount Genesis: the Genesis surface is not reachable at that panel size. |
| `preview_playwright` | Fails on every call, including a one-line script: `The property 'options.mode' must be one of: 'strip'. Received 'transform'`. Browser automation through the panel is unusable here. |
| Bundled Playwright Chromium 1234 | `browserType.launch: Target page, context or browser has been closed`. Root cause: 15+ shared libraries missing (`libnspr4`, `libnss3`, `libnssutil3`, `libsmime3`, `libasound`, `libatk-1.0`, `libatk-bridge-2.0`, `libatspi`, `libcairo`, `libcups`, `libpango`, `libXcomposite`, `libXdamage`, `libXfixes`, `libXrandr`, `libxkbcommon`). |
| `sudo apt-get install` | `sudo: The "no new privileges" flag is set, which prevents sudo from running as root.` |
| `apt-get download` | `E: Unable to locate package` — no package indices in the image. |
| `micromamba`/conda-forge | Binary fetch returned HTTP 307 and the extraction produced no usable binary. |

### The repair that worked

Ubuntu 24.04 package indices were fetched into a **sandboxed apt root** under
`/tmp/aptroot` (custom `Dir::Etc::sourcelist`, `Dir::State`, `Dir::Cache`,
`Debug::NoLocking=1`), the dependency closure was downloaded with
`apt-get -d install` (191 `.deb`s, 62.2 MB), and each was unpacked with
`dpkg-deb -x` into `/tmp/sysroot`. With
`LD_LIBRARY_PATH=/tmp/sysroot/usr/lib/x86_64-linux-gnu`, the Chromium binary
reports **0 missing libraries** and launches headless.

Two secondary faults were found and fixed while doing this:

1. The extracted tree contains recursive `X11 → ../..` symlinks. Left inside the
   project it crashed Vite's watcher (`ELOOP … /X11/X11/…/pdb3`) and killed the
   dev server mid-capture. It now lives outside the project (`/tmp/sysroot`).
2. A dev server started in one shell command is reaped when that command ends.
   All captures now run inside a single Node process that spawns and owns Vite.

### Viewports actually achieved

| Requested | Reported by `innerWidth × innerHeight` | Reached |
| --- | --- | --- |
| 1440×900 | 1440×900 | yes |
| 1280×800 | 1280×800 | yes |
| 1024×768 | 1024×768 | yes |
| 390×844 | 390×844 | yes |
| 375×812 | 375×812 | yes |

Every value is read back from the page, not from the requested argument.

---

## 2. Gate B — the real Genesis canvas

At **1440×900**, after entering the Cosmos surface:

```
canvases: [
  { w: 480,  h: 270,  cssW: 1440, cssH: 900 },  // Genesis scene
  { w: 1440, h: 900,  cssW: 1440, cssH: 900 },  // Genesis scene (post-resize backing store)
  { w: 395,  h: 330,  cssW: 395,  cssH: 330  }  // avatar
]
__leluSpatialProbe().nodes = 29
camera = { position: [6, 2.5, 4], fov: 49, aspect: 1.6 }
```

At **390×844** the same surface mounts with a 390×844 scene canvas, a 120×174
avatar canvas and `nodes = 29`.

Confirmed by observation:

* a real Genesis canvas exists at full viewport width;
* exactly **one** Genesis scene canvas is present (no duplicate renderer);
* the live camera publishes position, direction, fov, aspect, near/far;
* `SpatialLayer` is mounted — `window.__leluSpatialProbe()` is only published by it;
* the avatar canvas continues to render independently.

Screenshots: `screenshots/viewport-<w>x<h>-01-home.png` and
`viewport-<w>x<h>-02-genesis.png`. Inspected visually: `1440x900-02-genesis.png`
(planet, orbital network, nav bar, avatar panel) and `390x844-02-genesis.png`.

### The controlled test scene — NOT achieved

`chat-nova`, `chat-comet`, `chat-show-nova`, `chat-closeup-comet`,
`chat-system`, `chat-reset` were captured, but the composer could not be driven
to submission: the chat window's textarea resolves in the DOM yet is occluded and
does not accept input from the automation path (native value injection + forced
send both left the transcript empty). Result recorded:

```
revision: 0 → 0   (every step)
objects:  []      (every step)
transcript: ""    (every step)
```

Camera positions changed between steps (`[6,2.5,4] → [-3,1.5,7] → [4,4,-3] →
[0,3.5,8]`), **but they cannot be attributed to the commands**, because no
command was submitted and no reply exists. Mission A's scene and camera
acceptance therefore **FAILED**; the environment proof succeeded, the interaction
proof did not. See `camera-tests/chat-session.json` for the raw record.

---

## 3. Gate C — camera verification — FAILED (not attempted successfully)

Because no spatial command reached the resolver in the live app, none of the six
camera commands ("Show me Nova", "close-up of Comet", "zoom out", "orbit the
research station", "frame all three", "return to the original view") can be
claimed. The deterministic camera path is covered by unit tests
(`tests/spatial-integration.test.ts`) but unit coverage is **not** visual
acceptance, and this report does not present it as such.

---

## 4. Gate D — ownership audit

See `architecture-map.md` and `mutation-compatibility.md`. Summary:

| Category | Authoritative owner | Mutable |
| --- | --- | --- |
| Authored spatial objects | `SpatialSceneGraph` (this core) | **yes** |
| Cosmos entities | `CosmosEntityRegistry` (register/visit/deactivate only) | no |
| WorldRegistry destinations | `WorldRegistry` (labels, weight, scale class) | no |
| Live three.js nodes (Core, planets, avatar) | the rendering component's own state | no |

The audit found **no** transform/material setter and **no** change notification on
`CosmosEntityRegistry`, so writing `entity.position` would be neither
authoritative nor rendered. That is why the Cosmos row is read-only.

---

## 5. Gate E/F/G — mutation adapters, transactions, verification

Implemented: `src/core/spatial/SpatialMutationBridge.ts`.

* `matrix()` — the compatibility matrix, exported to callers.
* `authorize(ref, capability, revision)` — resolves the reference, then either
  allows (authored) or refuses with `validation-failed` naming the real owner and
  the reason.
* `audit()` — bounded (128) trail of allowed/blocked/unknown decisions.
* wired into `SpatialIntentBus.resolveTarget()`, so a chat move against
  `cosmos:<id>` now answers "owned by CosmosEntityRegistry and is read-only for
  position" instead of "not in the scene".

Transaction semantics are unchanged: no second transaction system, no second
registry, no bypass of `SpatialSeal`, and the bridge performs no writes.

---

## 6. Gate H — natural-language mutation

Not verified in the live app (same composer blocker). Deterministic parsing and
refusal wording are covered by tests only.

## 7. Gate I — mobile

Genesis mounts at 390×844 and 375×812 with the scene canvas at full viewport and
the composer present. This is **browser emulation**, not physical hardware; no
iPhone or Android device was used.

## 8. Gate J — GenesisChat hooks repair

`src/app/scene/genesis/GenesisChat.tsx` called `useChatExpanded()` after two early
returns. The call is now hoisted above them (single call site, no behaviour
change, no `eslint-disable`). `bun run lint` → **0 errors**, 108 warnings
(unchanged from baseline).

## 9. Gate K — performance

**Not measured.** No frame-rate, geometry, material or memory instrumentation was
run in the live app, so none is reported. The 29-node count and canvas sizes above
are the only quantitative live readings.

## 10. Tests

| Run | Result |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun test tests/spatial-integration.test.ts` | **23 pass, 0 fail** (20 Phase 2.2 + 3 Phase 2.3) |
| `bun test` (with changes) | 1329 pass, 38 fail, 6 skip — 1373 tests |
| `bun test` (**branch baseline, changes stashed**) | 1326 pass, 38 fail, 6 skip — 1370 tests |
| `bun run lint` | 0 errors, 108 warnings |

The 38 failures are **pre-existing on this branch** and identical with and
without this work; the change adds exactly three passing tests and no new
failure. Raw logs: `.lelu-sandbox/audit/test-phase23.log`,
`.lelu-sandbox/audit/test-baseline-branch.log`.

---

## Limitations, stated plainly

1. Mission A's interaction proof (chat commands creating Nova/Comet/station,
   camera acceptance screenshots) **failed**: the composer could not be driven.
2. No camera-command screenshots exist; none are claimed.
3. Cosmos/world/scene entities remain read-only — by design, with the owner named.
4. No performance numbers.
5. Physical mobile hardware untested.
6. The 38 pre-existing failures are unrepaired; they are outside this phase's scope
   and are reported, not hidden.
