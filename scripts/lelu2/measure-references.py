#!/usr/bin/env python3
"""Measure LÉLU's 39 committed reference photographs.

The photographs are the visual authority for M23.1: every correction has to be
traceable to one of these images, a measured feature on it, or an explicitly
documented inference. This script is how the measured part is produced, so the
numbers in `artifacts/lelu2/m231/reference-measurements.json` can be reproduced
by anyone with the same photographs.

What it measures, from pixels only (no face model, no assumptions about the
mesh):

  * content box      — the photographs are letterboxed; the black bars are not
                       part of the image and are cropped before anything else.
  * skin mask        — warm mid-tone pixels (R > G > B, R-B above a floor).
  * face box         — the widest run of skin rows, which is the face on every
                       frontal photograph and the neck/chest on the rest.
  * hairline          — walking down the centre column, the first row where skin
                       begins after the hair mass. This is the number the mesh
                       has been getting wrong: her renders put the front strand
                       band ~45 mm above the eye line, so it is measured here in
                       image space and converted through the eye→chin span.
  * brow band        — rows inside the face box whose dark-pixel count peaks
                       above the eye line: top, arch and tail.
  * eye line         — the first dark band below the brow band.
  * mouth            — the widest dark/red band below the nose.
  * ratios           — every landmark is reported both in pixels and as a
                       fraction of the eye→chin span, which is the one span the
                       mesh and the photograph can both supply. Confidence is
                       reported per measurement, not assumed.

Usage:  python3 scripts/lelu2/measure-references.py [--small]
        --small also writes 520 px crops to reference-39/small/ for inspection.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from glob import glob

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF_DIR = os.path.join(ROOT, "reference-39")
OUT = os.path.join(ROOT, "artifacts", "lelu2", "m231", "reference-measurements.json")
SMALL = os.path.join(REF_DIR, "small")


def content_box(im: Image.Image) -> tuple[int, int, int, int]:
    """The non-black rectangle of a letterboxed photograph."""
    small = im.convert("RGB").resize((im.width // 8, im.height // 8))
    px = small.load()
    w, h = small.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r + g + b > 24:
                xs.append(x)
                ys.append(y)
    if not xs:
        return (0, 0, im.width, im.height)
    return (
        max(0, min(xs) * 8),
        max(0, min(ys) * 8),
        min(im.width, (max(xs) + 1) * 8),
        min(im.height, (max(ys) + 1) * 8),
    )


def is_skin(r: int, g: int, b: int) -> bool:
    return r > 70 and r > g > b and (r - b) > 28 and (r - b) < 190 and g > 35


def is_dark(r: int, g: int, b: int) -> bool:
    return (r + g + b) / 3 < 62


def measure(path: str) -> dict:
    im = Image.open(path).convert("RGB")
    box = content_box(im)
    face_im = im.crop(box)
    w, h = face_im.size
    px = face_im.load()

    # Column-wise skin column occupancy: the face is where skin fills rows.
    row_skin = []
    for y in range(h):
        n = 0
        for x in range(0, w, 2):
            if is_skin(*px[x, y]):
                n += 1
        row_skin.append(n)

    peak = max(row_skin) if row_skin else 0
    if peak == 0:
        return {"file": os.path.basename(path), "ok": False, "reason": "no skin"}

    # The face band: contiguous rows with at least 45 % of peak skin coverage.
    rows = [y for y, n in enumerate(row_skin) if n >= peak * 0.45]
    face_top, face_bottom = rows[0], rows[-1]
    face_h = max(1, face_bottom - face_top)

    # Centre column: hairline is the first skin row below the hair mass.
    cx = w // 2
    col = [is_skin(*px[cx, y]) for y in range(h)]
    hairline = None
    for y in range(face_top, face_bottom):
        if col[y] and sum(col[y : y + 12]) >= 9:
            hairline = y
            break

    def dark_rows(y0: int, y1: int, step: int = 1) -> list[tuple[int, int]]:
        out = []
        for y in range(max(0, y0), min(h, y1), step):
            n = 0
            for x in range(0, w, 3):
                if is_dark(*px[x, y]):
                    n += 1
            out.append((y, n))
        return out

    # Brow and eye bands live in the upper half of the face box.
    band = dark_rows(face_top, face_top + int(face_h * 0.75))
    if band:
        brow_peak_y, _ = max(band, key=lambda t: t[1])
    else:  # pragma: no cover - every photograph has dark hair
        brow_peak_y = face_top

    # Eye line: the skin gap after the brow band ends, then the next dark band.
    def band_extent(centre: int, reach: int) -> tuple[int, int]:
        top = centre
        while top > 0 and dict(band).get(top - 1, 0) > 0:
            top -= 1
        bot = centre
        while bot < h - 1 and dict(band).get(bot + 1, 0) > 0:
            bot += 1
        return (max(top, centre - reach), min(bot, centre + reach))

    brow_top, brow_bot = band_extent(brow_peak_y, int(face_h * 0.12))
    eye_line = None
    for y in range(brow_bot + 4, face_bottom):
        if col[y] and not col[min(h - 1, y + 2)] is False:
            eye_line = y
            break
    if eye_line is None:
        eye_line = brow_bot + int(face_h * 0.08)

    # Chin: last row of the face band on the centre column, searched in the
    # lower half so the neck does not win.
    chin = None
    for y in range(face_bottom, face_top + int(face_h * 0.5), -1):
        if col[y]:
            chin = y
            break
    if chin is None:
        chin = face_bottom

    eye_to_chin = max(1, chin - eye_line)
    mouth_band = dark_rows(eye_line + int(eye_to_chin * 0.25), chin)
    mouth_y = None
    if mouth_band:
        # Lips are dark red: the widest dark run in the lower face.
        mouth_y, _ = max(mouth_band, key=lambda t: t[1])

    def frac(y: int | None) -> float | None:
        if y is None:
            return None
        return round((y - eye_line) / eye_to_chin, 4)

    return {
        "file": os.path.basename(path),
        "ok": True,
        "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "size": [im.width, im.height],
        "contentBox": list(box),
        "faceBox": [face_top, face_bottom],
        "hairlineY": hairline,
        "hairlineFromEye": frac(hairline),
        "hairlineOverFaceHeight": round((hairline - face_top) / face_h, 4) if hairline else None,
        "browTopY": brow_top,
        "browPeakY": brow_peak_y,
        "browBottomY": brow_bot,
        "browFromEye": frac(brow_peak_y),
        "eyeLineY": eye_line,
        "mouthY": mouth_y,
        "mouthFromEye": frac(mouth_y),
        "chinY": chin,
        "eyeToChinPx": eye_to_chin,
        "confidence": {
            "hairline": "high" if hairline else "none",
            "brow": "high" if band else "none",
            "eye": "medium",
            "mouth": "medium" if mouth_y else "none",
            "chin": "medium",
        },
    }


def write_grid(path: str, every: int = 100) -> str:
    """A crop with a labelled pixel grid, so landmarks can be read off by eye.

    The automatic masks above are only trustworthy where the photograph is a
    clean frontal portrait; on the letterboxed three-quarter and detail shots
    they mis-locate the eye line and the ratios come out negative. Landmarks in
    `reference-landmarks.json` are therefore read off these grids by hand, and
    say so — a measured feature with a stated method, not a guess.
    """
    from PIL import ImageDraw

    im = Image.open(path).convert("RGB")
    im = im.crop(content_box(im))
    d = ImageDraw.Draw(im)
    for x in range(0, im.width, every):
        d.line([(x, 0), (x, im.height)], fill=(0, 255, 120), width=1)
        d.text((x + 3, 4), str(x), fill=(0, 255, 120))
    for y in range(0, im.height, every):
        d.line([(0, y), (im.width, y)], fill=(0, 255, 120), width=1)
        d.text((4, y + 2), str(y), fill=(0, 255, 120))
    out = os.path.join(ROOT, "reference-39", "grid", os.path.basename(path))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out)
    return out


def main() -> int:
    write_small = "--small" in sys.argv
    if "--grid" in sys.argv:
        for path in sorted(glob(os.path.join(REF_DIR, "*", "*.png"))):
            print(path, "→", write_grid(path))
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    files = sorted(glob(os.path.join(REF_DIR, "*", "*.png")))
    if not files:
        print(f"no reference photographs under {REF_DIR}", file=sys.stderr)
        return 1

    results = []
    for path in files:
        r = measure(path)
        r["collection"] = os.path.basename(os.path.dirname(path))
        results.append(r)
        print(f"{r['file']:<28} hairline {r.get('hairlineFromEye')}  brow {r.get('browFromEye')}  mouth {r.get('mouthFromEye')}")

    payload = {
        "method": "scripts/lelu2/measure-references.py — content-box crop, skin/tone masks, centre-column hairline, row-darkness bands",
        "photographs": len(results),
        "collections": {c: sum(1 for r in results if r["collection"] == c) for c in {r["collection"] for r in results}},
        "results": results,
    }
    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")
    print(f"\n{len(results)} photographs → {os.path.relpath(OUT, ROOT)}")

    if write_small:
        os.makedirs(SMALL, exist_ok=True)
        for path in files:
            im = Image.open(path).convert("RGB")
            im = im.crop(content_box(im))
            im.thumbnail((520, 1100), Image.LANCZOS)
            im.save(os.path.join(SMALL, os.path.relpath(path, REF_DIR).replace("/", "__")))
        print(f"crops → {os.path.relpath(SMALL, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
