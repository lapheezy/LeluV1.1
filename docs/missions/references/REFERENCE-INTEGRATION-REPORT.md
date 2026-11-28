# Reference-to-render integration: report

**Branch:** `claude/wp21-multi-theme-graphics-engine`. Not merged, not deployed.

**Evidence types used here:**
- *browser-rendered*: Chromium with SwiftShader (software GPU), in the running app;
- *build-output*: a scan of `dist/`;
- *unit*: Node tests on fixtures and, where it exists, the local library.

Not performed in this phase:
- physical-device testing;
- video playback;
- any judgement of visual fidelity against the references.

## 1. Where the references live (local only)

| What | Where | In Git? |
|---|---|---|
| 78 images recovered from the atlas links | `reference/atlas/` + `index.json` (unchanged since recovery) | **No**: `reference/` is Git-ignored, and the repository is public |
| The owner's 8 uploads, stored as received, plus a crop box for the art inside each phone screenshot | `reference/user/` + `index.json` | **No** |
| The built registry | `reference/registry.json` (from `npx tsx scripts/references/build-registry.ts`) | **No** |
| Acceptance screenshots (they show the owner's images) | `reference/_acceptance/` | **No** |
| Labels: what each file shows, its categories, what it informs | `src/core/references/referenceLabels.ts` | Yes (text only) |
| Registry logic, tools, tests, scripts, this report | `src/core/references/`, `scripts/references/`, `tests/references.test.ts` | Yes |

**How the app reaches them:**
- The dev server serves `reference/` at `/reference/…`.
- A production build contains none of it, verified by scanning `dist/` (R9).
- Where the folder is absent, every consumer says *"not available on this machine"* and substitutes nothing.

## 2. Audit: 167 atlas links, reconciled

| Outcome | Count |
|---|---:|
| Downloaded | **78** |
| Blocked by the site (HTTP 403) | 34 |
| Rate-limited (HTTP 429) | 11 |
| Other network errors (SSL, 404, 400, 410, unusable bytes) | 9 |
| Page has no preview image | 25 |
| PDF | 10 |
| **Total** | **167** |

**The earlier discrepancy.** My first report said "55 refused automated downloads". That was the count
before the slow retry, which recovered 2 Wikimedia images (III-01 and III-02), giving 78 downloads in
total. After the retry, 53 downloads failed: 34 blocked, 11 rate-limited and 8 other errors. The 9 in the
table is those 8 plus the 1 file whose bytes were unusable.

**What the 78 downloads actually are** (every file was looked at and labelled):

| Kind | Count | Codes |
|---|---:|---|
| Usable visual reference | 59 | everything not listed below (I-49 is among them but flagged) |
| Site logo only (the link's preview was the site's logo, not the art) | 17 | I-33, I-63, II-07, **II-13, II-14** (Star Wars galleries), II-18, II-44, III-07, III-13, **III-21, III-22, III-23** (Rockstar and the car museums), III-32, III-37, III-38, III-39, III-40 |
| Blank placeholder | 2 | I-55, III-44 |
| Wrong image | 1 | I-49: the atlas entry is a bioluminescent coral forest, the image is a cartoon fox |

**Owner uploads:** 8, coded U-01 to U-08:
- U-01 to U-03: Blockbuster (storefront in the rain, new-release wall, VHS wall with a CRT);
- U-04 to U-06: Star Wars (lava duel, twin suns, two-tone silhouette);
- U-07 and U-08: The Boondocks (silhouette title card, the two brothers).

**Registry:** 86 entries in all (78 + 8), 67 of them usable visual references (59 + 8).
**Unresolved: 109**, each kept on record with its reason:

| Reason | Count |
|---|---:|
| Blocked | 34 |
| No preview | 25 |
| Logo only | 17 |
| Rate-limited | 11 |
| PDF | 10 |
| Network | 9 |
| Placeholder | 2 |
| Mismatch | 1 |

## 3. Categories (usable references)

| Category | Count |
|---|---:|
| environment | 26 |
| franchise | 19 |
| visual-style | 18 |
| character | 14 |
| architecture | 13 |
| interface | 7 |
| aerial | 7 |
| device | 6 |
| animation | 6 |
| clothing | 6 |
| vehicle | 3 |
| wildlife | 1 |

Franchises represented:

| Franchise | References |
|---|---:|
| Blockbuster | 5 |
| Star Wars | 3 (all owner uploads) |
| PlayStation | 3 |
| The Boondocks | 2 (owner uploads) |
| Disney | 1 |
| Treasure Planet | 1 |
| Static Shock | 1 |
| GTA V | 1 |
| Black Panther | 1 |
| Inception | 1 |
| The Matrix | 1 |
| Kash n' Karry | 1 |
| Cartoon-channel collage | 1 |

**Vehicles are thin.** The only usable references are I-61 (a motorbike), II-15 (solar-sail ships) and
U-01 (a parked car). The old-car links (III-21 to III-23) gave logos only.

## 4. Relationships: what each reference informs

There are **112 relations**:

- **79 point at things LÉLU has now:**
  - 36 at theme families;
  - 35 at renderer layers;
  - 6 at Time & Place eras;
  - 2 at existing features.

  A test fails if any relation points at a target that doesn't exist.
- **33 point at 19 planned targets** that are recorded but **not built**:

| Planned target | References waiting |
|---|---:|
| `planned:retro-video-store` (III-01, III-02, U-01, U-02, U-03) | 5 |
| `planned:retro-bedroom` (III-14, III-15, III-16, III-24, U-03) | 5 |
| `character-style:cel-shaded-american-anime` (I-62, U-07, U-08) | 3 |
| `planned:space-opera` (II-15, U-04) | 2 |
| `planned:toon-suburb` (I-62, U-08) | 2 |
| `planned:mixed-reality-workspace` | 2 |
| `planned:early-web` | 2 |
| `planned:binary-desert` (U-05) | 1 |
| `planned:two-tone-silhouette-style` (U-06) | 1 |
| ten others (`painted-animation`, `afrofuturist`, `folding-city`, `copper-atelier`, …) | 1 each |

Logos, placeholders and the mismatched image inform nothing.

## 5. Images as full-screen 2D workspaces

Owner direction: references are **full-screen 2D workspaces, not panels on the 3D variants**. Her photos
and her own visuals become workspaces the same way.

**Any image can become a workspace:**
- one of the owner's references;
- a photo taken or uploaded (📷 in the editor; on a phone it can open the camera);
- an image in the conversation: hers (labelled "Hers") or the owner's.

**What a workspace is.** A saved world in `2d` mode with no 3D canvas, built by
`src/core/workspaces/imageWorkspace.ts`:
- The image fills the stage: the **whole** image is shown, with a blurred copy of the same image filling
  the rest of the screen, so nothing is cropped away.
- Every thread variant (Freestyle included) floats over it.
- Panel frames take the image's own palette.

**Where the image lives.**
- The world stores only *where* the image is: a reference id, a device key (`img:…`, IndexedDB on this
  device), or a URL.
- It never stores pixels; a `data:` URL is refused as a source and goes to the device store first.

**How it's created:**
- in the editor: **Workspace** on a reference, 📷 for a photo, **Workspace** on a conversation image;
- by LÉLU: `references.apply {as: "workspace"}` or `workspace.from_image {reference | url, title, origin}`.

**Fix made along the way.** Images inside a conversation were always recorded as the owner's. Her own
visuals are now recorded as hers (`by: lelu`, "Her visual").

## 6. Who can use it

**World builder (the 🌐 editor):**
- **References:** shows the references behind the active world's families and searches the whole
  library. **Workspace** makes a reference the full-screen 2D workspace. **Palette** takes the active
  world's sky, accent and glow from the image's own pixels.
- **Make a workspace from an image:** 📷 photo, plus every image in the conversation.

**LÉLU's tools**, registered in ToolRegistry and dispatched through ToolDispatcher:

| Tool | What it does |
|---|---|
| `references.search` | Search by text, category, franchise or target |
| `references.for` | References behind a family, layer, place or planned target, and whether that target is built |
| `references.unresolved` | What is missing and why |
| `references.apply` | Make a reference the full-screen workspace, or take the active world's palette from it |
| `workspace.from_image` | Make any image (a reference, her visual, a photo, by URL or data URL) a full-screen workspace |

These tools are the access point for the **character builder** and **visual generation**:
- Characters: `category: character / clothing`, `informs: character-style:…`.
- **Not done:** no character-builder screen and no generation pipeline calls these tools yet.

**Scene renderer:** the `reference-plate` 2D layer kind, full screen by default. It is saved by reference
id or device key, never by copying the image.

## 7. Acceptance results (three separate suites)

### Reference integration and image workspaces: `scripts/references/verify-references.mjs`: **12/12 verified, 0 failed**

| ID | Check | Evidence |
|---|---|---|
| R1 | The dev server serves the registry (86 entries, 109 unresolved) and the original image (U-04: image/png, 3.2 MB) | browser-rendered |
| R2 | The editor discovers the references behind the volcano world: I-35, I-37, I-39, U-04 | browser-rendered |
| R3 | Searching "boondocks" returns exactly U-07 and U-08 | browser-rendered |
| R4 | U-04 becomes a full-screen 2D workspace: `2d` mode, no canvas, the whole 1170×2532 image visible, the blurred fill covering the stage; 66% of pixels changed | browser-rendered |
| R5 | A palette from U-05 recolours the volcano world: sky `#070304/#2a0805/#6b1a07` → `#75796d/#7b7664/#171617` | browser-rendered |
| R6 | II-01 (blocked) shows "not available on this machine", with no stand-in | browser-rendered |
| R7 | LÉLU's tools search, report a planned target, and make U-01 the workspace | browser-rendered |
| R8 | Workspaces persist across a reload, by reference id or device key, never pixels | browser-rendered |
| R9 | The production build (2,323 files) holds no reference image and no registry | build-output |
| R10 | No page errors from the integration | browser-rendered |
| R11 | A visual she made (a conversation image) becomes a workspace labelled "Her visual", stored on the device as `img:…` | browser-rendered |
| R12 | An uploaded photo (a synthetic test image) becomes a workspace framed in its own colours | browser-rendered |

**Not physically tested:** taking a photo with a real phone camera. The camera hint only works on a
device, and this run used a file upload.

**Flakiness, stated plainly:** 2 of the last 4 runs failed before any check ran, because the Thread view
didn't appear within 30 seconds. Both identical re-runs passed. The script now saves a screenshot and the
page state when this happens.

Unit tests in `tests/references.test.ts`: **11/11**, including the image-workspace builder. They cover:

- discovery and retrieval;
- categories and search;
- missing assets;
- relations;
- that every label is valid;
- that the tools report correctly with and without a library;
- that the images are Git-ignored and absent from `dist/`;
- the local library check: 167 links, every recovered file labelled, downloads plus failures equal 167.

### World engine: `scripts/worlds/verify-worlds.mjs`

Reported separately below this section, from the re-run after this phase.

### Thread: `scripts/thread/verify-thread-visual.mjs`

Last run on this branch (after the full-height fix): **17/19 verified, 0 failed**.

- **Blocked by the environment:** YouTube playback. The player in this container says "Video
  unavailable".
- **Not run:** physical device.

## 8. Still outstanding

1. **89 atlas links have no image**, plus 19 logo-only or placeholder previews and 1 mismatch. They are
   recorded, not substituted. The owner can supply these the way U-01 to U-08 were supplied.
   Higher-value gaps:
   - II-01 and II-02 (the Riley and Huey Freeman studies);
   - II-03 (Boondocks concept art);
   - II-13 and II-14 (Star Wars concept art, logo only);
   - III-21 to III-23 (cars, logo only).
2. **19 planned targets are not built**, including the retro video store, retro bedroom, cel-shaded
   character style, space opera and binary desert. Per the owner's instruction, no new environments were
   built in this phase.
3. **The character builder and generation pipeline** have access through the tools, but no screen or
   pipeline calls them yet.
4. **Real camera** capture on a phone is untested; uploads are tested.
5. **Palette scope:** a palette from a reference recolours the sky, lighting and panel frames. Layer
   colours keep their own settings (for example, lava stays orange).
6. **Visual fidelity against the references has not been assessed.** The checks prove the images are
   found, loaded, drawn and change the render, not that any world looks like them.
