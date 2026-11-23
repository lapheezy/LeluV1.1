"""
LÉLU — body proportions of a person in a photograph vs a render, measured the same way.

    python3 scripts/foundry/m25c_proportions.py <target.png> <render.png> [out.json]

Target: the A-pose front view generated from the user's photographs (plain
background). The photographs themselves cannot be masked reliably: DeepLab-v3 labels
the stylised copper figure as furniture, not a person (tried and recorded). Both
images are masked by their flat background colour. For each
mask the figure's top (crown) to bottom (sole) is its height H; silhouette width is
read at fixed fractions of H from the top (shoulders 0.19, bust 0.25, waist 0.37,
hips 0.47, upper thigh 0.53, knee 0.72) and divided by H. Arms are excluded by taking
the widest CONTINUOUS run that contains the body's centre column.
The ratio render/photo per band says how much wider or narrower the model is.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

BANDS = {"shoulders": 0.19, "bust": 0.25, "waist": 0.37, "hips": 0.47, "upperThigh": 0.53, "knee": 0.72}


def photo_mask(path):
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=mpt.BaseOptions(model_asset_path=os.path.expanduser("~/lelu-tools/models/deeplab_v3.tflite")), output_category_mask=True))
    im = np.asarray(Image.open(path).convert("RGB"))
    r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=im))
    return np.squeeze(r.category_mask.numpy_view()) == 15


def render_mask(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[:, :8].reshape(-1, 3)]), 0)
    return np.abs(a - bg).sum(2) > 30


def measure(mask):
    """Width of the body (torso + both legs) at each band, arms and carried bag excluded.

    Centre line = median column of the head (top 6 % of the figure). In each band row the
    mask's runs are kept only if they lie within ±0.12 H of that line, which in an A-pose
    holds the torso and both legs but not the hands or a bag at the side."""
    rows = np.nonzero(mask.any(1))[0]
    top, bot = rows[0], rows[-1]
    H = bot - top
    head = np.nonzero(mask[top:top + max(2, int(0.06 * H))].any(0))[0]
    centre = float(np.median(head))
    half = 0.12 * H
    out = {"heightPx": int(H), "centrePx": round(centre, 1)}
    for k, f in BANDS.items():
        row = mask[top + int(f * H)]
        xs = np.nonzero(row)[0]
        xs = xs[np.abs(xs - centre) <= half]
        if xs.size == 0:
            out[k] = None
            continue
        # split into runs; keep runs that START within the window (an arm reaching in is cut at the window edge)
        breaks = np.nonzero(np.diff(xs) > 2)[0]
        runs = np.split(xs, breaks + 1)
        runs = [r for r in runs if r.size > 0.01 * H]
        out[k] = round((max(r[-1] for r in runs) - min(r[0] for r in runs)) / H, 4) if runs else None
    return out


if __name__ == "__main__":
    photo, render = sys.argv[1], sys.argv[2]
    p, r = measure(render_mask(photo)), measure(render_mask(render))
    ratio = {k: round(r[k] / p[k], 3) if p.get(k) and r.get(k) else None for k in BANDS}
    res = {"photo": p, "render": r, "renderOverPhoto": ratio}
    if len(sys.argv) > 3:
        json.dump(res, open(sys.argv[3], "w"), indent=1)
    print(json.dumps(res))
