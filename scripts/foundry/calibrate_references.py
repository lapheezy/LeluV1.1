"""Calibrate the reference system against the original photographs.

No hand-guessed coordinates drive geometry any more. This tool:

  1. segments the figure from the studio background,
  2. derives body landmarks from the silhouette width profile,
  3. samples skin / hair / fabric / copper colours from masked pixel regions
     (not from single points, which is what produced the wrong skin hex),
  4. draws labelled overlays and a 10% coordinate grid on the original
     photographs so the numbers can be checked visually,
  5. writes foundry/references/calibration.json.

Usage:  python calibrate_references.py
"""
from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, "..", "..", "leluverse", "assets",
                                    "characters", "lelu_character"))
REF = os.path.join(BASE, "references", "PRIMARY_SOURCE")
OUT = os.path.join(BASE, "foundry", "references")
FILES = {"front": "01_front_full_body.png",
         "face": "02_face_closeup.png",
         "back": "03_back_upper_body.png",
         "apose": "04_front_apose.png"}


def load(name):
    return np.asarray(Image.open(os.path.join(REF, FILES[name])).convert("RGB"),
                      dtype=np.float32)


def background(rgb):
    h, w, _ = rgb.shape
    corner = np.concatenate([rgb[:24, :24].reshape(-1, 3), rgb[:24, -24:].reshape(-1, 3),
                             rgb[-24:, :24].reshape(-1, 3), rgb[-24:, -24:].reshape(-1, 3)])
    return np.median(corner, axis=0)


def figure_mask(rgb, tol=26.0):
    bg = background(rgb)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    mask = dist > tol
    # clear isolated noise: keep pixels with >= 6 neighbours in a 3x3 window
    k = np.ones((3, 3), dtype=np.float32)
    from numpy.lib.stride_tricks import sliding_window_view
    pad = np.pad(mask.astype(np.float32), 1)
    nbr = sliding_window_view(pad, (3, 3)).sum(axis=(2, 3))
    return mask & (nbr >= 6), bg


def row_extents(mask, centre_frac=0.5):
    """Left/right extent of the run nearest the image centre on every row."""
    h, w = mask.shape
    cx = int(w * centre_frac)
    out = np.full((h, 3), np.nan)          # left, right, width
    for y in range(h):
        row = mask[y]
        if not row.any():
            continue
        idx = np.flatnonzero(row)
        breaks = np.flatnonzero(np.diff(idx) > 1)
        starts = np.r_[idx[0], idx[breaks + 1]]
        ends = np.r_[idx[breaks], idx[-1]]
        runs = [(s, e) for s, e in zip(starts, ends) if e - s >= 4]
        if not runs:
            continue
        pick = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - cx))
        out[y] = (pick[0], pick[1], pick[1] - pick[0] + 1)
    return out


def smooth(v, k=9):
    v = np.asarray(v, dtype=np.float32)
    pad = np.pad(v, k // 2, mode="edge")
    ker = np.ones(k, dtype=np.float32) / k
    return np.convolve(pad, ker, mode="valid")


def landmarks_from_silhouette(ext):
    h = ext.shape[0]
    width = ext[:, 2]
    ys = np.arange(h)
    valid = ~np.isnan(width)
    if valid.sum() < 50:
        return {}
    top = int(np.argmax(valid))
    bottom = int(len(valid) - 1 - np.argmax(valid[::-1]))
    W = smooth(np.where(valid, width, 0))
    span = bottom - top

    def band(a, b):
        return top + int(a * span), top + int(b * span)

    lo, hi = band(0.10, 0.34)
    shoulders = lo + int(np.argmax(W[lo:hi]))
    lo, hi = band(0.35, 0.50)
    waist = lo + int(np.argmin(W[lo:hi]))
    lo, hi = band(0.47, 0.63)
    hip = lo + int(np.argmax(W[lo:hi]))
    # crotch: centre column becomes background while the sides stay filled
    crotch = None
    cx = int(np.nanmean(ext[hip, :2]))
    for y in range(hip, band(0.62, 0.72)[1]):
        if np.isnan(ext[y, 2]):
            continue
        if not np.isnan(ext[y, 0]) and (ext[y, 0] > cx - 6 or ext[y, 1] < cx + 6):
            if crotch is None:
                crotch = y
    crotch = crotch if crotch else band(0.52, 0.55)[0]
    lo, hi = crotch + int(0.08 * span), bottom - int(0.06 * span)
    knee = lo + int(np.argmin(W[lo:hi]))
    return {"hair_top_y": top, "sole_y": bottom, "shoulder_y": shoulders,
            "waist_y": waist, "hip_y": hip, "crotch_y": crotch, "knee_y": knee,
            "shoulder_width_px": float(W[shoulders]),
            "waist_width_px": float(W[waist]),
            "hip_width_px": float(W[hip]),
            "figure_px": float(bottom - top)}


def hsv_masks(rgb):
    h, w, _ = rgb.shape
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    delta = np.maximum(mx - mn, 1e-3)
    hue = np.zeros_like(mx)
    m = (mx == r)
    hue[m] = ((g - b)[m] / delta[m]) % 6
    m = (mx == g) & (mx != r)
    hue[m] = ((b - r)[m] / delta[m]) + 2
    m = (mx == b) & (mx != r) & (mx != g)
    hue[m] = ((r - g)[m] / delta[m]) + 4
    hue = hue / 6.0
    sat = delta / np.maximum(mx, 1e-3)
    val = mx / 255.0
    return hue, sat, val


def region_median(rgb, mask, label, results):
    px = rgb[mask]
    if len(px) < 200:
        results[label] = {"n": int(len(px)), "note": "too few pixels"}
        return
    lum = px.sum(axis=1) / 3.0
    keep = px[(lum > np.percentile(lum, 35)) & (lum < np.percentile(lum, 92))]
    med = np.median(keep if len(keep) > 100 else px, axis=0)
    results[label] = {"n": int(len(px)), "hex": "#%02x%02x%02x" % tuple(int(v) for v in med),
                      "rgb": [int(v) for v in med]}


def sample_colours(name, rgb, fig, results):
    hue, sat, val = hsv_masks(rgb)
    h, w, _ = rgb.shape
    yy = np.arange(h)[:, None].repeat(w, axis=1)
    if name in ("front", "apose"):
        skin = fig & (hue > 0.015) & (hue < 0.105) & (sat > 0.28) & (val > 0.16) & (val < 0.80)
        hair = fig & (val < 0.14)
        camo = fig & (sat < 0.30) & (val > 0.08) & (val < 0.34)
        bone = fig & (hue > 0.06) & (hue < 0.14) & (sat > 0.18) & (sat < 0.45) & (val > 0.45)
        copper = fig & (hue > 0.02) & (hue < 0.075) & (sat > 0.55) & (val > 0.55)
        region_median(rgb, skin, "skin", results)
        region_median(rgb, hair, "hair", results)
        region_median(rgb, camo, "camo_cloth", results)
        region_median(rgb, bone, "bone_panel", results)
        region_median(rgb, copper, "copper", results)
        results["_masks"] = {"skin": skin, "hair": hair}
    else:
        face_box = fig & (yy > h * 0.06) & (yy < h * 0.72)
        skin = face_box & (hue > 0.015) & (hue < 0.10) & (sat > 0.30) & (val > 0.22) & (val < 0.82)
        hair = fig & (val < 0.13)
        lips = face_box & (((hue < 0.02) | (hue > 0.96)) & (sat > 0.45) & (val > 0.12) & (val < 0.45))
        region_median(rgb, skin, "skin", results)
        region_median(rgb, hair, "hair", results)
        region_median(rgb, lips, "lips", results)
        results["_masks"] = {"skin": skin, "hair": hair, "lips": lips}


def grid_overlay(rgb, lm, name, results):
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    w, h = im.size
    for i in range(1, 10):
        x, y = int(w * i / 10), int(h * i / 10)
        d.line([(x, 0), (x, h)], fill=(0, 255, 255), width=2)
        d.line([(0, y), (w, y)], fill=(0, 255, 255), width=2)
        d.text((x + 4, 6), f"{i/10:.1f}", fill=(0, 255, 255))
        d.text((6, y + 2), f"{i/10:.1f}", fill=(0, 255, 255))
    for k, y in lm.items():
        if k.endswith("_y"):
            d.line([(0, y), (w, y)], fill=(255, 60, 60), width=3)
            d.text((10, y - 14), f"{k} {y}", fill=(255, 255, 0))
    for lab, m in results.get("_masks", {}).items():
        ys, xs = np.nonzero(m)
        if len(xs):
            d.ellipse([xs.min(), ys.min(), xs.max(), ys.max()], outline=(0, 255, 120), width=3)
            d.text((xs.min() + 4, ys.min() + 4), lab, fill=(0, 255, 120))
    return im


# Landmarks read from the 10% grid overlays on the original photographs and
# verified by drawing them back (calib_verified_*.png). Values are fractions
# of image width (x) and height (y) of the 1024x1536 PNGs.
VERIFIED = {
    "front": {
        "hair_top":     (0.500, 0.006),
        "skull_crown":  (0.500, 0.033),
        "hairline":     (0.500, 0.062),
        "brow":         (0.500, 0.088),
        "eye":          (0.500, 0.096),
        "nose_tip":     (0.500, 0.135),
        "lip":          (0.500, 0.155),
        "chin":         (0.500, 0.175),
        "neck_base":    (0.500, 0.190),
        "shoulder":     (0.500, 0.200),
        "bust":         (0.500, 0.244),
        "underbust":    (0.500, 0.285),
        "waist":        (0.500, 0.300),
        "belt":         (0.500, 0.345),
        "crotch":       (0.500, 0.469),
        "knee":         (0.500, 0.668),
        "ankle":        (0.500, 0.913),
        "sole":         (0.500, 0.985),
    },
    "face": {
        "hair_top":     (0.500, 0.010),
        "hairline":     (0.500, 0.115),
        "brow_peak":    (0.500, 0.212),
        "eye":          (0.500, 0.255),
        "nose_tip":     (0.500, 0.352),
        "lip":          (0.500, 0.392),
        "chin":         (0.500, 0.442),
        "jaw_left":     (0.402, 0.360),
        "jaw_right":    (0.598, 0.360),
        "cheek_left":   (0.345, 0.300),
        "cheek_right":  (0.655, 0.300),
        "face_left":    (0.330, 0.300),
        "face_right":   (0.670, 0.300),
    },
}

# widths measured across the front photograph (fractions of image width)
VERIFIED_WIDTHS = {
    "front": {
        "shoulder_y": 0.200, "shoulder_x0": 0.196, "shoulder_x1": 0.804,
        "waist_y": 0.300, "waist_x0": 0.362, "waist_x1": 0.638,
        "hip_y": 0.345, "hip_x0": 0.338, "hip_x1": 0.662,
        "head_y": 0.096, "head_x0": 0.418, "head_x1": 0.582,
    },
}


def verified_overlay(rgb, name):
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    w, h = im.size
    for k, (x, y) in VERIFIED.get(name, {}).items():
        X, Y = x * w, y * h
        d.line([(X - 30, Y), (X + 30, Y)], fill=(0, 255, 90), width=3)
        d.text((X + 36, Y - 7), f"{k} {y:.3f}", fill=(255, 255, 0))
    for k, v in VERIFIED_WIDTHS.get(name, {}).items():
        pass
    if name == "front":
        vw = VERIFIED_WIDTHS["front"]
        for tag, ykey in (("shoulder", "shoulder_y"), ("waist", "waist_y"),
                          ("hip", "hip_y"), ("head", "head_y")):
            y = vw[ykey] * h
            d.line([(vw[tag + "_x0"] * w, y), (vw[tag + "_x1"] * w, y)],
                   fill=(0, 220, 255), width=4)
            d.text((vw[tag + "_x0"] * w, y - 16), f"{tag} w={vw[tag+'_x1']-vw[tag+'_x0']:.3f}W",
                   fill=(0, 220, 255))
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    sheet = {"source": "references/PRIMARY_SOURCE", "images": {}}
    for name in ("front", "face", "back"):
        rgb = load(name)
        fig, bg = figure_mask(rgb)
        ext = row_extents(fig)
        lm = landmarks_from_silhouette(ext) if name in ("front", "apose") else {}
        colours = {}
        sample_colours(name, rgb, fig, colours)
        masks = colours.pop("_masks", {})
        entry = {"file": FILES[name], "size": [rgb.shape[1], rgb.shape[0]],
                 "background_rgb": [int(v) for v in bg],
                 "figure_pixels": int(fig.sum()),
                 "landmarks_px": lm, "colours": colours}
        if lm:
            head = lm["hair_top_y"]
            entry["proportions"] = {
                "figure_px": lm["figure_px"],
                "shoulder_width_over_figure": round(lm["shoulder_width_px"] / lm["figure_px"], 4),
                "waist_width_over_figure": round(lm["waist_width_px"] / lm["figure_px"], 4),
                "hip_width_over_figure": round(lm["hip_width_px"] / lm["figure_px"], 4),
                "shoulder_to_waist_y": round((lm["waist_y"] - lm["shoulder_y"]) / lm["figure_px"], 4),
                "waist_to_hip_y": round((lm["hip_y"] - lm["waist_y"]) / lm["figure_px"], 4),
                "hip_to_knee_y": round((lm["knee_y"] - lm["hip_y"]) / lm["figure_px"], 4),
                "leg_fraction": round((lm["sole_y"] - lm["crotch_y"]) / lm["figure_px"], 4),
            }
        elif name == "face":
            skin = masks.get("skin")
            if skin is not None and skin.any():
                ys, xs = np.nonzero(skin)
                entry["face_box_px"] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
                entry["face_width_px"] = int(xs.max() - xs.min())
        if name in VERIFIED and "sole" in VERIFIED[name]:
            v = VERIFIED[name]
            fig = v["sole"][1] - v["skull_crown"][1]
            entry["verified_landmarks"] = {k: [round(x, 4), round(y, 4)] for k, (x, y) in v.items()}
            entry["verified_fractions_of_figure"] = {
                k: round((v[k][1] - v["skull_crown"][1]) / fig, 4)
                for k in ("hairline", "brow", "eye", "nose_tip", "lip", "chin",
                          "neck_base", "shoulder", "bust", "underbust", "waist",
                          "belt", "crotch", "knee", "ankle", "sole")
            }
            entry["heads_tall_skull"] = round(fig / (v["chin"][1] - v["skull_crown"][1]), 3)
            entry["heads_tall_with_hair"] = round(
                (v["sole"][1] - v["hair_top"][1]) / (v["chin"][1] - v["hair_top"][1]), 3)
        sheet["images"][name] = entry
        overlay = grid_overlay(rgb, lm, name, {**colours, "_masks": masks})
        overlay.save(os.path.join(OUT, f"calib_{name}.png"))
        if name in VERIFIED:
            verified_overlay(rgb, name).save(os.path.join(OUT, f"calib_verified_{name}.png"))
        print(f"[calib] {name}: {rgb.shape[1]}x{rgb.shape[0]} figure_px={entry['figure_pixels']}")
        for k, v in entry.get("proportions", {}).items():
            print(f"    {k:26s} {v}")
        for k, v in colours.items():
            print(f"    colour {k:14s} {v.get('hex', '-')}  n={v.get('n', 0)}")
    with open(os.path.join(OUT, "calibration.json"), "w") as f:
        json.dump(sheet, f, indent=2)
    print("[calib] wrote", os.path.join(OUT, "calibration.json"))


if __name__ == "__main__":
    main()
