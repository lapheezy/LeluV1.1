"""
LÉLU — individual technical renders for the hair (PCI-FR 2.1, WP09)

One image per claim, not a contact sheet:

  tech_ringlet.png   one ringlet to scale, with radius/pitch in mm
  tech_roots.png     clump roots on the scalp with the follicle density
  tech_babyhairs.png the three measured swirls, with roots and radii labelled
  tech_chain.png     the headpiece path against the head surface
  tech_views.png     front / three-quarter / profile / rear, one row, labelled

  python scripts/perception/lelu_hair_techdraw.py --out artifacts/pci-fr-2.1
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_hair as H  # noqa: E402
import lelu_hair3d as H3  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONT = None
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    FONT_S = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
except Exception:
    FONT = ImageFont.load_default()
    FONT_S = FONT


def label(d, xy, text, fill=(232, 228, 222), font=None):
    d.text(xy, text, fill=fill, font=font or FONT)


def draw_ringlet(path: str, spec: dict) -> None:
    W, Hh = 820, 620
    img = Image.new("RGB", (W, Hh), (18, 16, 18))
    d = ImageDraw.Draw(img)
    R_mm = spec["curl_radius_mm"]
    P_mm = spec["curl_pitch_mm"]
    px_per_mm = 6.0
    n = 1400
    s_mm = np.linspace(0, 5 * P_mm, n)
    ang = 2 * np.pi * s_mm / P_mm
    x = 300 + R_mm * px_per_mm * np.cos(ang)
    y = 70 + s_mm * 3.0 + R_mm * px_per_mm * np.sin(ang)
    pts = [(float(xi), float(yi)) for xi, yi in zip(x, y)]
    d.line(pts, fill=(150, 74, 46), width=4, joint="curve")
    # axis
    d.line([(300, 60), (300, 70 + 5 * P_mm * 3.0)], fill=(120, 116, 112), width=1)
    label(d, (40, 30), "single ringlet — spec sheet geometry", (240, 235, 228))
    label(d, (40, 62), f"curl radius   {R_mm} mm  (diameter {spec['curl_diameter_mm']} mm)", font=FONT_S)
    label(d, (40, 84), f"curl pitch    {P_mm} mm", font=FONT_S)
    label(d, (40, 106), f"strand Ø      {spec.get('strand_diameter_um', 70)} µm", font=FONT_S)
    label(d, (40, 128), f"source        {spec['source']}", font=FONT_S)
    # radius annotation
    cy = 150
    d.line([(300, cy), (300 + R_mm * px_per_mm, cy)], fill=(220, 180, 120), width=2)
    d.line([(300 + R_mm * px_per_mm, cy - 8), (300 + R_mm * px_per_mm, cy + 8)], fill=(220, 180, 120), width=2)
    label(d, (300 + R_mm * px_per_mm + 8, cy - 12), "R", (220, 180, 120), FONT_S)
    img.save(path)


def draw_roots(path: str, count: int, density: float) -> None:
    W, Hh = 820, 620
    img = Image.new("RGB", (W, Hh), (18, 16, 18))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(3)
    roots = H3.scalp_roots(count, rng)
    # front view of the head, roots projected
    cx, cy, sc = W * 0.5, 200, 260
    d.ellipse([cx - H3.HEAD["rx"] * sc, cy - H3.HEAD["ry"] * sc, cx + H3.HEAD["rx"] * sc, cy + H3.HEAD["ry"] * sc],
              outline=(110, 106, 102), width=2)
    for p in roots:
        if p[2] < -0.05:      # behind the head in a front view
            continue
        x = cx + p[0] * sc
        y = cy - p[1] * sc
        d.ellipse([x - 1.6, y - 1.6, x + 1.6, y + 1.6], fill=(196, 120, 78))
    label(d, (40, 30), "clump roots on the scalp (front projection)", (240, 235, 228))
    label(d, (40, 62), f"{len(roots)} roots · {density} clumps/cm² · documented follicles 62–100/cm²", font=FONT_S)
    label(d, (40, 84), "each clump stands for ~25 individual 0.07 mm hairs", font=FONT_S)
    label(d, (40, Hh - 120), "specimen dots = roots visible from the front; roots behind the", (170, 166, 162), FONT_S)
    label(d, (40, Hh - 100), "head are counted but not drawn, so the count exceeds the dots.", (170, 166, 162), FONT_S)
    img.save(path)


def draw_babyhairs(path: str) -> None:
    W, Hh = 900, 520
    img = Image.new("RGB", (W, Hh), (18, 16, 18))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(5)
    spirals = H3.baby_spirals(rng)
    sc = 520
    cx, cy = W * 0.5, 380
    for sw in spirals:
        pts = [(cx + p[0] * sc, cy - p[1] * sc) for p in sw["points"]]
        d.line(pts, fill=(190, 110, 70), width=3, joint="curve")
        root = pts[0]
        d.ellipse([root[0] - 4, root[1] - 4, root[0] + 4, root[1] + 4], outline=(90, 220, 240), width=2)
        label(d, (root[0] + 10, root[1] - 8), f"{sw['id']} r={sw['radius_mm']}mm L={sw['length_mm']}mm", (200, 196, 190), FONT_S)
    label(d, (40, 30), "forehead swirls — measured radii, real spiral geometry", (240, 235, 228))
    label(d, (40, 62), "A r 8 mm / 42 mm, B r 11 mm / 56 mm, C r 5 mm / 31 mm (spec sheet)", font=FONT_S)
    label(d, (40, 84), "cyan ring = root placed on the measured forehead coordinate", font=FONT_S)
    img.save(path)


def draw_chain(path: str) -> None:
    W, Hh = 820, 640
    img = Image.new("RGB", (W, Hh), (18, 16, 18))
    d = ImageDraw.Draw(img)
    chain = H3.gold_chain()
    sc = 300
    cx, cy = W * 0.5, 400
    d.ellipse([cx - H3.HEAD["rx"] * sc, cy - H3.HEAD["ry"] * sc, cx + H3.HEAD["rx"] * sc, cy + H3.HEAD["ry"] * sc],
              outline=(100, 96, 92), width=2)
    for key, colour in (("centre", (214, 158, 84)), ("temple_left", (214, 158, 84)), ("temple_right", (214, 158, 84))):
        pts = [(cx + p[0] * sc, cy - p[1] * sc) for p in chain[key]]
        d.line(pts, fill=colour, width=3, joint="curve")
    gx, gy = cx + chain["gem"][0] * sc, cy - chain["gem"][1] * sc
    d.ellipse([gx - 6, gy - 6, gx + 6, gy + 6], fill=(238, 176, 200))
    label(d, (40, 30), "gold chain headpiece — geometry on the head surface", (240, 235, 228))
    label(d, (40, 62), "centre chain from the part to the brow gem", font=FONT_S)
    label(d, (40, 84), "temple chains follow the hairline above the brows", font=FONT_S)
    label(d, (40, Hh - 60), "positions are on the modelled head surface; the reference's chain", (170, 166, 162), FONT_S)
    label(d, (40, Hh - 40), "sits on the hair, so its depth differs by the hair's own thickness.", (170, 166, 162), FONT_S)
    img.save(path)


def draw_views(paths: list[tuple[str, str]], path: str) -> None:
    imgs = [(t, Image.open(p).convert("RGB")) for t, p in paths if os.path.exists(p)]
    if not imgs:
        return
    h = 900
    scaled = [(t, im.resize((int(im.width * h / im.height), h), Image.LANCZOS)) for t, im in imgs]
    W = sum(im.width for _, im in scaled) + 16 * (len(scaled) - 1)
    out = Image.new("RGB", (W, h + 40), (16, 15, 17))
    d = ImageDraw.Draw(out)
    x = 0
    for t, im in scaled:
        out.paste(im, (x, 40))
        label(d, (x + 8, 10), t, (238, 232, 226), FONT)
        x += im.width + 16
    out.save(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.1"))
    a = ap.parse_args()
    hd = os.path.join(a.out, "hair")
    os.makedirs(hd, exist_ok=True)

    draw_ringlet(os.path.join(hd, "tech_ringlet.png"), H.SPEC["ringlet_loose"])
    metrics = {}
    mp = os.path.join(hd, "hair-metrics.json")
    if os.path.exists(mp):
        metrics = json.load(open(mp))
    draw_roots(os.path.join(hd, "tech_roots.png"), 2200, metrics.get("density_per_cm2", "n/a"))
    draw_babyhairs(os.path.join(hd, "tech_babyhairs.png"))
    draw_chain(os.path.join(hd, "tech_chain.png"))
    draw_views([
        ("front", os.path.join(hd, "shell_front.png")),
        ("three-quarter", os.path.join(hd, "shell_three_quarter.png")),
        ("profile", os.path.join(hd, "shell_profile.png")),
        ("rear", os.path.join(hd, "shell_rear.png")),
    ], os.path.join(hd, "tech_views.png"))
    print(json.dumps({"written": [f for f in sorted(os.listdir(hd)) if f.startswith("tech_")]}))


if __name__ == "__main__":
    main()
