# Mission 18 — Creative Atelier + Living Cosmos Object Ecosystem

Branch `freebuff/400773963b8c2504ea15ec77`, base `a4f5df3`
("Record what Mission 15 demonstrated, and what it did not").

Everything below was produced by running the code in this tree. The images in
`artifacts/creative/` were rendered from the composed object geometry by the
CPU preview renderer (`scripts/lib/render-png.ts`), not by Blender or a GPU.

## What was verified

| Check | Command | Result |
|---|---|---|
| Typecheck (whole project) | `npx tsc -b --force` | pass |
| Lint (touched files) | `npx oxlint <touched files>` | 0 errors, 0 warnings |
| Creative object tests | `npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs --test tests/couture-objects.test.ts` | 14/14 pass |
| End-to-end demonstration | `npx tsx scripts/mission18-demo.ts` | 34/34 demonstrations pass, integrity 5/5 |
| Exports | inside the demonstration | GLB / OBJ / SVG / JSON written and re-parsed; all valid |

## Measured timings (this machine, this run)

| Operation | Time |
|---|---|
| Draft the 5-piece pattern (33 checks) | 44.1 ms |
| Build + simulate the gown (22,976 triangles, 6 components) | 1,944.4 ms |
| Change the shell textile (no geometry rebuild) | 16.7 ms |
| Place in Cosmos (store + placement record) | 34.8 ms |
| Detach the right sleeve into its own object | 34.8 ms |
| Reload the whole store from its bytes | 4.7 ms |

These are wall-clock numbers from `performance.now()` around the real calls in
`scripts/mission18-demo.ts`. They are not benchmarks of the app bundle or of a
phone.

## The object model

`src/core/couture/objects.ts` holds 9 objects, 33 components and 46,079
triangles after the demonstration, with five invariants checked after the
reload: unique ids, every part owned by a component, every detached component
having its extracted object, every attachment pointing at a real component, no
cycles.

Lifecycle semantics, all exercised:

- **place in Cosmos** → `location = "cosmos"`, placement recorded in the
  existing `SpatialObjects` store as a pointer (`kind: "creative"`).
- **float** → isolated spin/orbit/bob motion with pause; motion never mutates
  the stored transform.
- **move / rotate / scale** → transform only; geometry fingerprint unchanged.
- **detach** → the component is marked detached, a NEW object owns a copy of
  its geometry, the parent keeps every part and its fingerprint.
- **reattach** → component status attached, extracted object kept (absorbed
  into the parent's workspace), never deleted.
- **reuse** → the geometry is cloned into a different compatible object at an
  accepting socket; an incompatible target is refused with its socket list.
- **remove from Cosmos** → `location = "workspace"`; record, geometry,
  materials and history stay. This is not a delete.
- **restore** → back into the Cosmos with the same id and revision history.
- **delete permanently** → the only destructive path, requires the exact name
  or `DELETE`, refuses an object still attached to a creation, and is undoable.

## The textile change

Changing the shell textile produced the **same geometry fingerprint**
(`468458602` before and after) in 16.7 ms: `materialId` moved, no vertex moved.
The rendered before/after images (`02-garment-velvet.png`,
`03-garment-mikado.png`) show the same drape in two materials.

## Garment construction

- 5-piece pattern (bodice front/back, skirt front/back, long sleeve), 8 seams,
  33/33 pattern checks.
- Assembly: cloth shell, rib cage (metallic boning), standing collar, modular
  panels, left and right sleeve — 6 components, each with its own parts.
- The sleeve is generated from the drafted sleeve piece: cap 139.7 mm solved
  against the armscye, 565 mm shaft, bicep and wrist half-widths taken from the
  piece, seated at the shoulder socket.

## Jewellery and product

- Copper pendant: disc body, bezel setting, brilliant-cut stone (faceted
  geometry), bail. Estimated metal weight 24.16 g from the generated volume and
  copper's handbook density (8.96 g/cm³) — an estimate, not a measurement.
- Stone extracted, floated, reattached; pendant duplicated and re-materialed in
  18k gold; ambiguous reference `"pendant"` refused with three candidates.
- Oak side chair: 7 components, seat height 452 mm derived from
  `legHeight + seatThickness`; leg detached, moved, reattached; a width change
  re-derived the geometry from the object's own variable data.

## Exports

| File | Bytes | Contents | Re-parsed |
|---|---|---|---|
| `garment.glb` | 571,648 | 6 meshes, 12,099 vertices, 22,976 triangles, 3 materials | glTF 2.0 header, chunk layout, accessor bounds and index range checked |
| `garment.obj` | 733,222 | 12,099 vertices, 22,976 faces, 6 groups | group/material/index bounds checked |
| `pendant.glb` / `.obj` | 65,196 / small | 4 meshes, 2,496 triangles, 2 materials | pass |
| `chair.glb` / `.obj` | 7,976 | 7 meshes, 84 triangles | pass |
| `chair-drawing.svg` | 37,920 | 252 projected polygons, three orthographic views | XML/graph checks pass |
| `pattern.svg` | — | net, allowance, grainline per piece | pass |
| `project.json` | 19,168 | identity, components, sockets, relationships, history | format, unique ids, part→component ownership checked |

A deliberately corrupted GLB (magic byte zeroed) is reported as invalid by the
same validator, so the check is not a rubber stamp.

## Dependencies and licences

No dependency was added for this mission. The engine uses TypeScript, the
Node/Bun standard library, and the repository's existing stack. Absolutely no
paid API, model inference, rendering service or credential is involved, and the
test suite asserts that object operations perform zero `fetch` calls.

## Offline

Pattern drafting, cloth simulation, garment assembly, component extraction,
product/jewellery geometry, material assignment, transforms and motion,
persistence, GLB/OBJ/SVG/JSON export and the renders all run with no network.
Verified by running the demonstration and by the no-network test. Anything that
would need connectivity (none of the above) is not part of this workflow.

## Tool integration

`couture.design` and `couture.objects` are registered through
`ToolRegistry` + `ToolDispatcher.registerExecutor`, so they run through the same
gate, events and result shape as every other tool. Argument validation happens
before execution; ambiguous object references are refused with candidates.
`CreativeObjectBridge` places and removes objects through the existing
`SpatialObjects` store and `CosmosInspector` reads the creative record, so a
placed garment has a real, inspectable record — not a card.

## Incomplete / not verified

1. **In-app Cosmos mesh rendering is not wired.** The object record, placement,
   inspector and "open" view are real; drawing the actual meshes inside the
   React Three Fiber Cosmos layer (with touch/mouse gizmos, selection outlines
   and contextual actions) is not built. The images here come from the engine's
   own renderer, and the app-side visual check has not been done.
2. **No browser run.** This environment has no browser, so Chat Universe
   presentation, mobile touch manipulation and reload behaviour in the app were
   not exercised. Reload was verified headlessly by re-reading the same bytes.
3. **Renders are CPU previews**, not production renders; they are labelled that
   way. No photorealism is claimed.
4. **Structural validation is absent.** Metal weights are volume × handbook
   density. No FEA, casting yield, prong tension, stone security or load test.
5. **Undo/redo is store-snapshot based**, bounded to 40 steps; it restores the
   whole object graph, which is correct but not a per-operation command log.
6. **No GPU or phone measurements.** The timings above are desktop wall-clock
   for the headless engine, not bundle size or device latency.
7. **Full repository test suite was not completed** within the run limits; only
   the new creative-object suite was executed, plus typecheck and lint.
