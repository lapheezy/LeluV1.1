# MISSION 15 — Generalized Creative Engine & Cognitive-to-Creation Pipeline

Status: **VERIFIED for the three domains and the pipeline; PARTIAL for research-to-creation breadth; NOT TESTED on a physical device.**
Base commit: `1632fe2` (preserved, untouched). Branch: `freebuff/capability-expansion`, pushed to
`integration/lelu-four-workforce-consolidation`.

## 1. What existed before this mission

The engine from Mission 14 was one artifact: a four-stroke engine assembly
(`src/core/creative/kit/EngineAssembly.ts`), its in-thread viewer
(`EngineView.tsx`), the `creative.engine` tool, Scene3D + GLB export, in-thread
Studio cards, revisions, and the multi-page research reader (`browser.read`,
`/api/browse`). Everything was specific to that one assembly; nothing else could
be constructed, modified or explained.

## 2. What was added

One shared construction framework, `src/core/creative/kit/build/`:

| File | Role |
| --- | --- |
| `BuildTypes.ts` | `BuildProgram` (kind `"build"`), `BuildPart`, `BuildLayer`, `BuildStep`, `ParamSpec`, `validateParams`, geometry helpers (`ringPoint`, `alignY`, `strut`, `layersOf`, `sceneOf`), `diffPrograms` |
| `Mechanical.ts` | `gearbox` — real tooth counts, pitch radius `m·z/2`, centre distances at summed pitch radii, optional idler, ratio `z_out/z_in`, output speed |
| `Architecture.ts` | `cabin` — bays on a grid, storeys, pitched roof from rise/length, windows = bays × storeys, floor area |
| `Science.ts` | `molecule` — water 104.5°, methane 109.5° tetrahedral, ammonia pyramidal, benzene with alternating double bonds; ball-and-stick or space-filling |
| `Registry.ts` | `BUILDERS`, `findBuilder`, `describeRequest` (words → parameters), `modifyProgram` + `parseModification` (sentence → parameter changes + `why`), `catalog` |
| `index.ts` | barrel |

Design decision: a build is stored **beside** the Scene3D object list as
`program.build`, exactly as the engine is stored as `program.engine`
(`Scene3D.normalizeScene` passes both through). Nothing in the renderer, the
cards, the revision store or the GLB exporter had to change, and the shipped
engine keeps working untouched.

Tools added in `CreativeKitTools.ts`:

* `creative.build` — subject/builder/domain + `params`, optional `sources`
* `creative.modify` — natural-language change applied to the latest construction
  as a **new revision of the same artifact**
* `creative.inspect` — explains one layer or step from the artifact's own notes
* `creative.domains` — what can be constructed, honestly limited to what exists

Routing:

* `DirectCompiler` gained `/build`, `/modify`, `/explain`, `/domains`, plus
  natural-language construction ("build a gear train with 16 driver teeth and 30
  output teeth"), modification ("make the output gear bigger", "add another
  floor") and sourced construction (`source=<url>`).
* `AIRouter` runs a **construction plan deterministically even when a model is
  available**: the same parameters must always give the same artifact, so it
  cannot depend on the model choosing the right tool. Non-construction creative
  requests keep the previous behaviour (direct only when no provider).

Rendering: `BuildView.tsx` (three.js) — layer toggles + isolate, explode,
step highlighting, collision-avoided labels, parameter sliders that rebuild
locally, "Save as a revision" through `StudioStore.revise`, derived-fact chips,
source lines, and a note when the drawing is a schematic. `VisualViewer` routes
`program.build` to it lazily.

## 3. Evidence

Machine-readable: `artifacts/perf/m15-evidence.json`.

### Three domains, from words, in the app (384×661 viewport)

| Domain | Request | Result | Artifact |
| --- | --- | --- | --- |
| Mechanical | “build a gear train with 16 driver teeth and 30 output teeth” | 85 parts, 5 layers, 5 steps; driver 48.0 mm, output 90.0 mm, centre distance 258.0 mm, ratio 1.88:1, 800 rpm | `art_31bb6bec577a` |
| Architecture | “design a cabin with 2 storeys and 4 bays” | 34 parts, 6 layers; footprint 6 × 4.5 m, 54.0 m², bays at 2.00 m, ridge 6.40 m, 6 windows | `art_98903e492873` |
| Science | “build a methane molecule with ball and stick bonds” | 9 parts, CH₄, 109.5°, 1.60 Å, 5 atoms, 4 bonds | `art_8424ab9d8f16` |

### Conversational modification (same artifact, new revision)

| Request | Reply | What changed |
| --- | --- | --- |
| “make the output gear bigger” | “Revised ‘Gear train — 16:30 with idler’ [`art_31bb6bec577a`] to revision 2” | teeth 30→34, output radius 90→102 mm, centre distance 258→270 mm, ratio 1.88→2.13, 800→706 rpm, parts 85→89 — the shaft, housing and derived facts all moved |
| “add another floor to the cabin” | “Revised ‘3-bay cabin — 6 × 4.5 m’ [`art_98903e492873`] to revision 2” | storeys 2→3, floor area 54→81 m², ridge 6.40→9.00 m, windows 6→9, parts 34→37 |
| “make it space-filling” | “Revised ‘Methane (CH₄)’ [`art_8424ab9d8f16`] to revision 2” | style ball-and-stick → space-filling, bonds layer removed, 3 layers |

### Persistence and identity

After a full page reload the conversation restored four construction cards
(two gearbox revisions, the cabin, the molecule) and their canvases; revisions
kept their artifact ids. Working state lives in the Studio store, so a reload is
a real test of persistence, not of local component state.

### Export

`/export cabin glb` →
`3-bay-cabin-6-45-m.glb`, 76 216 bytes (74.4 KB),
sha256 `cb11300ca580…`, glTF 2 header, 79 nodes / 37 meshes / 0 animations,
exported in 117 ms. The exporter is the Mission-14 one; the build path adds
nothing to it.

### Explanation

`/explain lubrication` on the engine answers from the artifact's own layer text
(Oil sump, Oil pump, Oil filter, Oil galleries) — the same notes the viewer
shows, so the answer cannot drift from the model on screen.

### Research → construction

`/build gearbox teethIn=12 teethOut=36 source=https://en.wikipedia.org/wiki/Gear_train`
reads the page through the existing server reader and only claims a figure when
the page states it next to its name. On that page the honest result is:

```
From sources: idler teeth 20 (the page states “20” next to “teeth”) — Gear train - Wikipedia
Assumed (no page states them): driver teeth 12; output teeth 36; module 0.006; face width 0.016; input 1500
```

The card shows the same line under “From the source” / “Assumed, not sourced”.
Two earlier versions of this check were **rejected during the mission** because
they were too loose (any digits anywhere in the article counted; then “12”
matched inside “12.2 km/h”). The shipped rule requires a standalone number
within 60 characters of a part word and records which word matched.

### The engine still works

`/engine` in the same build: card height 782 px, canvas present, stroke chip,
labels (spark plug, valve springs, coolant hoses, radiator, flywheel) — screenshot
`artifacts/perf/m15-engine-still-works.png`.

## 4. Checks

| Check | Result |
| --- | --- |
| `npx tsc -b --force` | exit 0 |
| `npm run build` | exit 0, `dist/assets/index-CZFMGD6c.js` 376.55 kB (gzip 116.84 kB), 5.8 s |
| `tests/creative-build.test.ts` | 18 pass / 0 fail |
| `tests/creative-kit.test.ts` | 17 pass / 0 fail |
| `tests/creation-studio-tools.test.ts` | 9 pass / 0 fail |
| `tests/chat-surface.test.ts` | 31 pass / 0 fail |
| `tests/module-layout.test.ts` | 11 pass / 0 fail |

The new suite covers: determinism (byte-identical JSON, parameter order
irrelevant), unique/stable ids, rejection of out-of-range and unknown parameters,
step snapping, pitch-radius and centre-distance relationships, dependent
recomputation on a tooth change, idler direction vs. ratio invariance, refusal of
a no-op modification, sentence→parameter mapping for all three builders,
`alignY` against an independently written XYZ rotation matrix,
water's 104.5° bond angle, scene/parts correspondence, payload survival through
normalisation, registry resolution (and refusal for “spaceship”), source
attribution survival, and word→tool routing.

## 5. Honest limits

* **Physical accuracy: none.** These are geometrically consistent schematics.
  Teeth are a simplified form, molecules are ball-and-stick at textbook angles,
  the cabin has no structure or services. Nothing is validated by a physics
  engine; nothing here is a manufacturing drawing.
* **Three domains, not six.** Product design, environments and abstract art are
  not implemented; `creative.domains` lists only what exists.
* **Mobile is simulated only.** All browser evidence is at 384×661 (portrait,
  narrow). No physical device, no landscape test, no touch-gesture test. Desktop
  layout was not viewed at a wide viewport in this mission (Playwright was
  unavailable); layout there is the shipped Mission-14 CSS plus
  `minmax(min(100%, 200px), 1fr)` parameters.
* **Research → construction is shallow.** One page, parameter-number matching,
  and the caller still chooses the parameters. LÉLU does not yet research
  autonomously and then derive a spec.
* **Modification vocabulary is a fixed set** of change phrases per builder;
  anything outside it is reported as unsupported rather than guessed.
* **Each revision appears as an extra card in the thread** (the Studio card is
  per tool call). Identity is preserved in the store and shown as “revision 2”,
  but the thread keeps the earlier revision visible above it.
* **A construction plan bypasses the model**, so replies are LÉLU's deterministic
  summary, not model prose.
* A colour/label collision was found and fixed live: the build card's root
  originally used `data-lelu-build`, which `index.css` hides in fullscreen
  (that attribute belongs to the build stamp) — the card collapsed to zero
  height. Renamed to `data-lelu-construction`.

## 6. Remaining work

1. Product-design, environment and sculptural builders behind the same interface.
2. Autonomous research → spec derivation (`research.board` → parameters → build).
3. A geometry/clearance validator to distinguish “consistent” from “validated”.
4. In-place updating of a revision card instead of appending a new one.
5. Wide-viewport and touch testing on real hardware.
