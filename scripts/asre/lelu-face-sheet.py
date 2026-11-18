"""
Annotated reference-versus-model face comparison.

    python lelu-face-sheet.py REF_LANDMARKS.json MODEL_LANDMARKS.json COMPARISON.json REF_IMG MODEL_IMG OUT.png

Both faces are aligned in her own frame (pupil midpoint origin, IOD unit,
roll removed) and drawn at the same scale. Middle panel: the mean reference
landmark shape (pink, with +-1 std ellipses where n > 1) over the model's
landmarks (blue). Right: the metric table with deviation in reference
standard deviations.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

refj, modj, cmpj, ref_img, mod_img, out = sys.argv[1:7]
ref = json.load(open(refj))
mod = json.load(open(modj))
cmp_ = json.load(open(cmpj))
S, IOD = 900, 150.0  # panel size, pixels per IOD
C = np.array([S / 2, S * 0.40])


def canon(row):
    w, h = row["size"]
    L = {k: np.array([v[0] * w, v[1] * h]) for k, v in row["landmarks_normalized"].items()}
    pr, pl = L["pupil_r"], L["pupil_l"]
    o = (pr + pl) / 2
    iod = np.linalg.norm(pl - pr)
    a = math.atan2(pl[1] - pr[1], pl[0] - pr[0])
    c, s = math.cos(-a), math.sin(-a)
    return {k: np.array([(v[0] - o[0]) * c - (v[1] - o[1]) * s, (v[0] - o[0]) * s + (v[1] - o[1]) * c]) / iod for k, v in L.items()}, (o, iod, a)


def aligned(img_path, row):
    _, (o, iod, a) = canon(row)
    im = Image.open(img_path).convert("RGB")
    k = IOD / iod
    im = im.rotate(math.degrees(a), center=tuple(o), resample=Image.BICUBIC)
    im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    off = (int(C[0] - o[0] * k), int(C[1] - o[1] * k))
    panel = Image.new("RGB", (S, S), (20, 20, 24))
    panel.paste(im, off)
    return panel


refs = [r for r in ref["images"].values() if r.get("detected")]
R = [canon(r)[0] for r in refs]
keys = list(R[0].keys())
mean = {k: np.mean([r[k] for r in R], axis=0) for k in keys}
std = {k: np.std([r[k] for r in R], axis=0) for k in keys}
mrow = [r for r in mod["images"].values() if r.get("detected")][0]
M = canon(mrow)[0]
ref_row = [r for r in refs if r["source"].endswith(ref_img.split("/")[-1])][0]

sheet = Image.new("RGB", (S * 3 + 40, S + 260), (12, 12, 14))
sheet.paste(aligned(ref_img, ref_row), (10, 80))
sheet.paste(aligned(mod_img, mrow), (S + 20, 80))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 17)
except OSError:
    font = small = ImageFont.load_default()
d.text((20, 20), f"REFERENCE {ref_row['source'].split('/')[-1]}", fill=(255, 140, 180), font=font)
d.text((S + 30, 20), "MODEL (ortho, neutral light, no hair)", fill=(120, 190, 255), font=font)
d.text((2 * S + 30, 20), f"landmarks: ref mean (n={len(R)}) vs model   |   passed {cmp_['passed']}/{cmp_['total']}, rms z {cmp_['rms_z']}", fill=(230, 230, 230), font=small)
# overlay landmarks on both photos and on the shape panel
for px0, pts, col in ((10, mean, (255, 90, 150)), (S + 20, M, (90, 170, 255))):
    for k, v in pts.items():
        x, y = px0 + C[0] + v[0] * IOD, 80 + C[1] + v[1] * IOD
        d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=col, width=2)
# metrics table on the third panel
y = 80
for r in cmp_["rows"]:
    col = (140, 230, 140) if r["pass"] else (255, 120, 110)
    d.text((2 * S + 30, y), f"{r['metric'][:19]:19s} ref {r['reference_mean']:7.3f}±{r['reference_std']:.3f}  model {r['model']:7.3f}  z {r['z']:+6.2f}", fill=col, font=small)
    y += 24
# shape overlay below the table
y0 = y + 20
scale = 110
cx, cy = 2 * S + 30 + 430, y0 + 160
for k in keys:
    m, sd, v = mean[k], std[k], M[k]
    X, Y = cx + m[0] * scale, cy + m[1] * scale
    d.ellipse([X - max(3, sd[0] * scale), Y - max(3, sd[1] * scale), X + max(3, sd[0] * scale), Y + max(3, sd[1] * scale)], outline=(255, 90, 150), width=1)
    Xm, Ym = cx + v[0] * scale, cy + v[1] * scale
    d.ellipse([Xm - 3, Ym - 3, Xm + 3, Ym + 3], fill=(90, 170, 255))
    d.line([X, Y, Xm, Ym], fill=(200, 200, 200), width=1)
sheet.save(out)
print("wrote", out)
