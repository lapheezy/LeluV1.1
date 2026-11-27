# 50-reference visual atlas — verified (WP16)

`LELU_NEURAL_MAP_50_REFERENCE_ATLAS_VERIFIED.pdf` continues the brief's atlas
(`../brief/`). `register.json` holds the same record in machine-readable form.

**Checked on 2026-11-27.** For each reference the source page and the original
image URL were requested. The record keeps the HTTP status, content type and
size, the SHA-256 of the bytes, and whether the source page's HTML references
the image (a check that the image belongs to the named source). Any licence
wording found on the page is quoted.

**Licence rule.** An image counts as redistributable only when its publisher
states a licence for it. That means either the image page's credit plus the
publisher's licence policy, or the LICENSE of the repository that holds the
file. Copyright notices, "All rights reserved", and pages with no licence are
**view-only**. Font and icon licences embedded in page CSS (Font Awesome) were
discarded as false positives.

| Result | Count | References |
|---|---|---|
| Embedded, licence permits redistribution | 3 | #8 Mapping Controversies (CC BY-SA 4.0), #41 nsflow (Apache-2.0), #46 DESI / NOIRLab (CC BY 4.0) |
| View-only, open at the source | 47 | everything else; each entry says why (copyright notice, no licence, unreachable page or image, or a source that no longer shows the image) |

The three embedded images are resized to at most 1600 px and re-encoded as
JPEG (noted per entry), with credit and licence. CC BY-SA 4.0 (#8) requires
adaptations to carry the same licence. No image was generated, and no
placeholder stands in for a view-only reference.

**Reproduce.** These read untrusted downloads, so run them with `python3 -I`
in an empty work directory:

```
python3 -I scripts/neural/atlas/check_references.py <workdir>   # needs <workdir>/refs.json and desc.json
python3 -I scripts/neural/atlas/build_atlas.py <workdir> docs/missions/neural-multiverse/atlas
```

`refs.json` is extracted from `../brief/LELU_NEURAL_MAP_50_LIVE_SOURCE_IMAGES.html`
(image URL, title and links per card). `desc.json` comes from the brief PDF's
text.

**Not done.** The original brief asked for 50 further references and a code
repository assessment. The repository side is now live in the Neural Map's
Development panel (RepoExecutive research, with licence, stars and errors as
returned). A second set of 50 image references was not compiled.
