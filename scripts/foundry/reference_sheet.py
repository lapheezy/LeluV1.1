"""Reference sheet extraction for the LÉLU character.

Reads the ORIGINAL supplied photographs, samples real palettes from their
pixels, records landmark positions and derives proportion ratios in head
units. Writes:

  foundry/references/reference_sheet.json
  foundry/references/overlay_gothic.png
  foundry/references/overlay_earthy.png
  foundry/references/face_gothic.png   (2x crop, full detail)
  foundry/references/face_earthy.png

Landmarks are normalised (0..1) against image width/height. Every number in
the sheet is therefore traceable to a pixel coordinate in the photographs,
not to a written description.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REF_DIR = os.path.join(HERE, "..", "..", "leluverse", "assets", "characters",
                       "lelu_character", "references", "PRIMARY_SOURCE")
FILES = {"front": "01_front_full_body.png", "face": "02_face_closeup.png",
         "back": "03_back_upper_body.png", "apose": "04_front_apose.png"}
OUT = os.path.join(HERE, "..", "..", "leluverse", "assets", "characters",
                   "lelu_character", "foundry", "references")

# Normalised landmarks read off the full-resolution photographs. y from top.
LANDMARKS = {
    "front": {
        "hair_top": (0.500, 0.020),
        "hairline": (0.500, 0.062),
        "eye_line": (0.500, 0.092),
        "nose_base": (0.500, 0.120),
        "lip_line": (0.500, 0.140),
        "chin": (0.500, 0.158),
        "neck_base": (0.500, 0.205),
        "shoulder_l": (0.320, 0.212),
        "shoulder_r": (0.680, 0.212),
        "bust": (0.500, 0.290),
        "underbust": (0.500, 0.350),
        "waist": (0.500, 0.395),
        "hip": (0.500, 0.465),
        "crotch": (0.500, 0.505),
        "knee": (0.500, 0.720),
        "ankle": (0.500, 0.905),
        "sole": (0.500, 0.962),
    },
    "apose": {
        "hair_top": (0.500, 0.018),
        "chin": (0.500, 0.156),
        "neck_base": (0.500, 0.203),
        "shoulder_l": (0.315, 0.215),
        "shoulder_r": (0.685, 0.215),
        "waist": (0.500, 0.398),
        "hip": (0.500, 0.468),
        "crotch": (0.500, 0.508),
        "knee": (0.500, 0.722),
        "ankle": (0.500, 0.908),
        "sole": (0.500, 0.965),
    },
}

# Palette probes on 02_face_closeup.png, in normalised coordinates.
PROBES = {
    "face": {
        "skin_forehead": [(0.500, 0.135)],
        "skin_cheek": [(0.360, 0.400), (0.640, 0.400)],
        "skin_chest": [(0.500, 0.735)],
        "skin_arm": [(0.115, 0.700)],
        "hair": [(0.170, 0.230), (0.840, 0.240)],
        "hair_streak": [(0.300, 0.640)],
        "lips": [(0.500, 0.560)],
        "eyeliner": [(0.330, 0.330)],
        "iris": [(0.365, 0.325)],
        "brow": [(0.360, 0.278)],
        "blush": [(0.300, 0.420)],
        "copper_hoop": [(0.235, 0.395)],
        "camo_fabric": [(0.560, 0.880)],
        "rose_in_hair": [(0.148, 0.300)],
        "septum": [(0.500, 0.470)],
    },
    "front": {
        "skin_chest": [(0.500, 0.300)],
        "skin_arm": [(0.230, 0.330)],
        "hair": [(0.440, 0.070)],
        "camo_fabric": [(0.500, 0.390)],
        "camo_pants": [(0.480, 0.620)],
        "bone_panel": [(0.330, 0.640)],
        "copper": [(0.500, 0.352)],
        "boot": [(0.430, 0.930)],
        "background": [(0.060, 0.500)],
    },
    "back": {
        "hair": [(0.500, 0.120)],
        "hair_plum": [(0.520, 0.560)],
        "rose_in_hair": [(0.395, 0.135)],
        "copper_chain": [(0.640, 0.230)],
        "camo_fabric": [(0.240, 0.470)],
        "bone_panel": [(0.330, 0.720)],
        "skin_arm": [(0.130, 0.420)],
    },
}


def load(name: str) -> Image.Image:
    path = os.path.join(REF_DIR, FILES[name])
    im = Image.open(path).convert("RGB")
    return im


def sample(im: Image.Image, pt) -> tuple[int, int, int]:
    w, h = im.size
    x, y = int(pt[0] * w), int(pt[1] * h)
    a = np.asarray(im)[max(0, y - 4):y + 5, max(0, x - 4):x + 5].reshape(-1, 3)
    return tuple(int(v) for v in np.median(a, axis=0))


def build(name: str) -> dict:
    im = load(name)
    w, h = im.size
    sheet = {"file": FILES[name], "width": w, "height": h,
             "provenance": os.path.abspath(os.path.join(REF_DIR, FILES[name]))}

    lm = {k: [round(v[0] * w, 1), round(v[1] * h, 1)]
          for k, v in LANDMARKS.get(name, {}).items()} if name in LANDMARKS else {}
    sheet["landmarks_px"] = lm

    if not lm:
        pal = {}
        for k, pts in PROBES[name].items():
            cols = [sample(im, p) for p in pts]
            med = tuple(int(np.median([c[i] for c in cols])) for i in range(3))
            pal[k] = {"hex": "#%02x%02x%02x" % med, "rgb": list(med)}
        sheet["palette"] = pal
        return sheet, im, lm

    # proportions, all in head units (hair_top -> chin = 1 head)
    head_px = lm["chin"][1] - lm["hair_top"][1]
    body_px = lm["sole"][1] - lm["hair_top"][1]
    sheet["head_px"] = head_px
    sheet["figure_px"] = body_px
    sheet["heads_tall"] = round(body_px / head_px, 3)
    spine = ["neck_base", "shoulder_l", "bust", "underbust", "waist", "hip",
             "crotch", "knee", "ankle", "sole"]
    sheet["landmarks_head_units"] = {
        k: round((lm[k][1] - lm["hair_top"][1]) / head_px, 3)
        for k in spine if k in lm
    }
    sheet["shoulder_width_head_units"] = round(
        (lm["shoulder_r"][0] - lm["shoulder_l"][0]) / head_px, 3)

    pal = {}
    for k, pts in PROBES[name].items():
        cols = [sample(im, p) for p in pts]
        med = tuple(int(np.median([c[i] for c in cols])) for i in range(3))
        pal[k] = {"hex": "#%02x%02x%02x" % med, "rgb": list(med)}
    sheet["palette"] = pal
    return sheet, im, lm


def overlay(im: Image.Image, lm: dict, name: str) -> str:
    im = im.copy()
    d = ImageDraw.Draw(im)
    w, h = im.size
    for k, (x, y) in lm.items():
        colour = (0, 255, 120) if "shoulder" in k else (255, 60, 60)
        d.line([(x - 26, y), (x + 26, y)], fill=colour, width=3)
        d.text((x + 30, y - 6), k, fill=(255, 255, 0))
    lx, ly = lm["shoulder_l"]
    rx, _ = lm["shoulder_r"]
    y = lm["eye_line"][1]
    d.line([(lx - 6, lm["shoulder_l"][1]), (rx + 6, lm["shoulder_r"][1])],
           fill=(0, 255, 255), width=3)
    return im


def face_crop(im: Image.Image, lm: dict) -> Image.Image:
    w, h = im.size
    top = lm["hair_top"][1] - 0.02 * h
    bot = lm["chin"][1] + 0.06 * h
    left = lm["shoulder_l"][0] - 0.10 * w
    right = lm["shoulder_r"][0] + 0.10 * w
    box = (max(0, int(left)), max(0, int(top)), min(w, int(right)), min(h, int(bot)))
    crop = im.crop(box)
    scale = min(1600 / crop.width, 1600 / crop.height)
    return crop.resize((int(crop.width * scale), int(crop.height * scale)),
                       Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    sheets = {}
    for name in ("front", "face", "back"):
        if name == "face" and "landmarks" not in LANDMARKS:
            sheet_pal = build(name)
            sheets[name] = sheet_pal[0]
            im = load(name)
            face_crop(im, {"hair_top": (0.5, 0.02), "chin": (0.5, 0.66),
                           "shoulder_l": (0.18, 0.66), "shoulder_r": (0.82, 0.66)}).save(
                os.path.join(OUT, "face_primary_crop.png"))
            print(f"{name}: {sheet_pal[0]['width']}x{sheet_pal[0]['height']}")
            for k, v in sheet_pal[0]["palette"].items():
                print(f"   {k:16s} {v['hex']}")
            continue
        sheet, im, lm = build(name)
        sheets[name] = sheet
        if lm:
            overlay(im, lm, name).save(os.path.join(OUT, f"overlay_{name}.png"))
        if lm:
            face_crop(im, lm).save(os.path.join(OUT, f"face_{name}.png"))
        print(f"{name}: {sheet['width']}x{sheet['height']} "
              f"heads_tall={sheet.get('heads_tall', 'n/a')} "
              f"shoulders={sheet.get('shoulder_width_head_units', 'n/a')} head-widths")
        for k, v in sheet["palette"].items():
            print(f"   {k:16s} {v['hex']}")
    with open(os.path.join(OUT, "reference_sheet.json"), "w") as f:
        json.dump(sheets, f, indent=2)
    print("wrote", os.path.join(OUT, "reference_sheet.json"))


if __name__ == "__main__":
    main()
