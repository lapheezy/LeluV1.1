# CC0 reference asset library

LÉLU's reference anatomy comes from these libraries. Every file used was
checked for a **CC0** licence *inside the file*, not from a folder name or a
project reputation.

## Acquired

| source | what | licence | how verified |
|---|---|---|---|
| `makehumancommunity/makehuman` (git, commit pinned below) | base mesh `3dobjs/base.obj` (19,158 verts, 18,486 faces, 172 named groups), 1,554 morph targets, `rigs/default.mhskel`, `rigs/default_weights.mhw` (139 bones, per-vertex weights), helper surfaces | **CC0** | every `.obj`, `.target` and `.mhw` carries a header: *"This asset was explicitly released as CC0 in september 2020"*, copyright Data Collection AB / Joel Palmius / Jonas Hauquier |
| `makehuman_system_assets_cc0.zip` (267 MB) | eyes, teeth, tongue, eyebrows, eyelashes, 10 hairstyles, 20 garments, shoes, body proxies | **CC0** | pack index lists every asset as CC0; every `.mhclo`/`.mhmat` carries the same CC0 header |
| `hair01_cc0.zip` (218 MB) | 20+ hair meshes with `.mhclo` mappings | **CC0** | pack index; `.mhclo` headers |
| `hands01_cc0.zip`, `nose01_cc0.zip`, `cheek01_cc0.zip`, `ears01_cc0.zip`, `arms01_cc0.zip` | anatomy-specific morph target packs | **CC0** | pack index; `.target` headers |
| `skins01_cc0.zip` (100 MB) | skin material sets | **CC0** | pack index |
| `blender.org` Human Base Meshes v1.4.1 (49 MB) | artist base meshes | **CC0** | labelled CC0 on the demo-files page — **not downloaded**: blender.org served a Cloudflare challenge and download.blender.org returned 503 from this network. Reported, not silently skipped. |

## Explicitly rejected

| asset | licence | why rejected |
|---|---|---|
| `hair02_cc0.zip` → `hair02_ccby.zip` | **CC-BY** | attribution-dependent |
| `hair03_cc0.zip` → `hair03_ccby.zip` | **CC-BY** | attribution-dependent |
| Ellie Pose Library | **CC-BY** | attribution-dependent |
| Blender Studio demo scenes / open-movie production files (Sprite Fright, Gold, Charge, Pet Projects, …) | **CC-BY / CC-BY-SA** | attribution-dependent |
| `Animal 02/03/04` target packs | **CC-BY** | attribution-dependent |

No noncommercial or restricted asset is used anywhere in this pipeline.

## Why the blobs are not in git

The library is ~785 MB of meshes and textures; committing it would bloat the
repository far past a sane size. The files live in `resources/cc0/` locally,
are fetched and hash-verified by `scripts/asre/fetch-cc0.mjs`, and everything
generated from them (GLBs, renders, metrics) is committed. `resources/cc0/`
is git-ignored except this file and the checksums.

## Reproduce

```bash
node scripts/asre/fetch-cc0.mjs          # download + verify + extract
npx tsx scripts/asre/cc0-proxy-diag.ts   # verify the placed proxies
```

`SHA256SUMS.txt` records the verified digests of every downloaded archive.
