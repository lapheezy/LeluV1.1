"""
LÉLU — hair and head silhouette, measured the same way on references and renders.

    python lelu-silhouette.py --seg selfie_multiclass.tflite --face face_landmarker.task --out DIR IMG[:crop] ...

Hair mask: MediaPipe multiclass selfie segmenter (Apache-2.0; class 1 = hair).
Frame: the face's own landmarks (same detector as lelu-landmarks.py) give the
pupil midpoint (origin) and the interpupillary distance (unit), so every
silhouette is expressed in IOD units around her own eyes, whatever the image
scale. A crop "x0,y0,x1,y1" (fractions) can be given for full-body images;
the crop is upscaled x3 for detection and mapped back.

Per image: hair extent left/right of the face midline at heights of -1 (brow),
0 (pupils), +1.5 (mouth), +2.5 (chin), +4, +6, +8 IOD below the pupils; the
crown height above the pupils; and the mask itself resampled into the
canonical frame (x in [-7, 7], y in [-4, 16] IOD, 0.05 IOD cells) so masks of
different images can be overlaid and compared (IoU).
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image

import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib

lmk = importlib.import_module("lelu-landmarks")

LEVELS = [-1.0, 0.0, 1.5, 2.5, 4.0, 6.0, 8.0]
GX = np.arange(-7, 7, 0.05)
GY = np.arange(-4, 16, 0.05)


def hair_mask(seg_model, img_path):
    opts = vision.ImageSegmenterOptions(base_options=mpp.BaseOptions(model_asset_path=seg_model), output_category_mask=True)
    with vision.ImageSegmenter.create_from_options(opts) as seg:
        r = seg.segment(mp.Image.create_from_file(img_path))
        cat = np.squeeze(r.category_mask.numpy_view())
        return cat == 1, cat


def frame(face_model, path, crop):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    if crop:
        x0, y0, x1, y1 = crop
        c = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
        c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS)
        tmp = path + ".crop.png"
        c.save(tmp)
        res = lmk.detect(face_model, tmp)
        os.remove(tmp)
        if res is None:
            return None
        pts = [(x / 3 + x0 * W, y / 3 + y0 * H) for x, y in res[0]]
    else:
        res = lmk.detect(face_model, path)
        if res is None:
            return None
        pts = res[0]
    pr, pl = np.array(pts[468]), np.array(pts[473])
    o = (pr + pl) / 2
    iod = float(np.linalg.norm(pl - pr))
    ang = math.atan2(pl[1] - pr[1], pl[0] - pr[0])
    return o, iod, ang


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seg", required=True)
    ap.add_argument("--face", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("images", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rows = {}
    for spec in a.images:
        path, crop = (spec.split(":")[0], [float(v) for v in spec.split(":")[1].split(",")]) if ":" in spec else (spec, None)
        stem = os.path.splitext(os.path.basename(path))[0]
        fr = frame(a.face, path, crop)
        if fr is None:
            print(f"{stem}: no face", file=sys.stderr)
            continue
        o, iod, ang = fr
        # segment the full image (upscaled if the figure is small)
        if crop:
            # the segmenter works at 256 px: segment the upper body, not the
            # whole figure, then place the mask back in the full frame
            im = Image.open(path).convert("RGB")
            W0, H0 = im.size
            bx0, by0, bx1, by1 = max(0, crop[0] - 0.18), 0.0, min(1, crop[2] + 0.18), min(1, crop[3] + 0.42)
            box = (int(bx0 * W0), int(by0 * H0), int(bx1 * W0), int(by1 * H0))
            tmp = path + ".seg.png"
            im.crop(box).save(tmp)
            sub, _ = hair_mask(a.seg, tmp)
            os.remove(tmp)
            mask = np.zeros((H0, W0), dtype=bool)
            mask[box[1]:box[1] + sub.shape[0], box[0]:box[0] + sub.shape[1]] = sub
        else:
            mask, cat = hair_mask(a.seg, path)
        Hh, Ww = mask.shape
        # canonical grid -> image pixels (rotate by the roll)
        c, s = math.cos(ang), math.sin(ang)
        X, Y = np.meshgrid(GX, GY)
        px = o[0] + (X * c - Y * s) * iod
        py = o[1] + (X * s + Y * c) * iod
        inside = (px >= 0) & (px < Ww) & (py >= 0) & (py < Hh)
        canon = np.zeros_like(X, dtype=bool)
        canon[inside] = mask[py[inside].astype(int), px[inside].astype(int)]
        valid = inside
        ext = {}
        for lv in LEVELS:
            j = int(round((lv - GY[0]) / 0.05))
            if j < 0 or j >= len(GY) or not valid[j].any():
                continue
            row = canon[j]
            xs = GX[row]
            ext[str(lv)] = {"left": round(float(-xs.min()), 3) if xs.size and xs.min() < 0 else 0.0, "right": round(float(xs.max()), 3) if xs.size and xs.max() > 0 else 0.0, "width": round(float(xs.max() - xs.min()), 3) if xs.size else 0.0}
        cols = canon[:, (GX > -1.5) & (GX < 1.5)].any(axis=1)
        crown = float(-GY[cols].min()) if cols.any() else None
        rows[stem] = {"source": path, "crop": crop, "iod_px": round(iod, 2), "crown_above_pupils": round(crown, 3) if crown is not None else None, "extent": ext, "valid_fraction": round(float(valid.mean()), 3)}
        np.save(os.path.join(a.out, f"{stem}--hair-canonical.npy"), canon)
        np.save(os.path.join(a.out, f"{stem}--valid-canonical.npy"), valid)
        Image.fromarray((canon * 255).astype(np.uint8)).save(os.path.join(a.out, f"{stem}--hair-canonical.png"))
        print(f"{stem}: iod {iod:.1f}px crown {rows[stem]['crown_above_pupils']} widths " + " ".join(f"{k}:{v['width']}" for k, v in ext.items()))
    json.dump({"tool": "MediaPipe selfie_multiclass_256x256 (hair = class 1) + FaceLandmarker frame", "units": "IOD, origin pupil midpoint, y down", "grid": {"x": [-7, 7], "y": [-4, 16], "cell": 0.05}, "images": rows}, open(os.path.join(a.out, "silhouette.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
