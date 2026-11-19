"""
LÉLU — strand-based hair reconstruction (PCI-FR 2.0, WP01-B/C)

Everything here is done in the pixels of the base render. Her reference gives
the roots, the spec sheets give the physics in millimetres, and the base
render's own face width converts millimetres to pixels (head width 150 mm).

  python scripts/perception/lelu_hair_build.py --out artifacts/pci-fr-2.0 \
      --base artifacts/pci-fr-1.0/renders/improved_face.png

Outputs: hair_render.png (portrait), hair_strands.png (strands only, no face),
hair_curvature.png (curl radius annotation), hair-render.json (parameters).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_hair as H  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF10 = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/ref10_face_primary.png")

PALETTE = np.array([[10, 7, 9], [19, 10, 12], [33, 13, 15], [62, 26, 22], [104, 52, 34], [148, 78, 48]], dtype=np.float64)


def scalp_roots(ref_pts: np.ndarray, spacing_px: float) -> np.ndarray:
    """Jittered grid of clump roots over the scalp region of her reference."""
    fw = float(np.linalg.norm(ref_pts[234] - ref_pts[454]))
    fh = float(np.linalg.norm(ref_pts[10] - ref_pts[152]))
    cx = float((ref_pts[234, 0] + ref_pts[454, 0]) / 2)
    brow = float(min(ref_pts[105, 1], ref_pts[334, 1]))
    hairline_y = brow - 0.10 * fh
    scalp_cy = max(0.0, brow - 0.45 * fh)
    rx, ry = 0.62 * fw, 0.52 * fh
    rng = np.random.default_rng(7)
    out = []
    for y in np.arange(max(0.0, scalp_cy - ry), hairline_y, spacing_px):
        for x in np.arange(cx - rx, cx + rx, spacing_px):
            jx = x + rng.normal(0, spacing_px * 0.35)
            jy = y + rng.normal(0, spacing_px * 0.35)
            nx, ny = (jx - cx) / rx, (jy - scalp_cy) / ry
            if nx * nx + ny * ny <= 1.0 and jy <= hairline_y:
                out.append([jx, jy])
    return np.array(out)


def grow(root, side, cx, chin_y, end_y, curl_r, curl_p, spread, rng):
    """
    One clump falling from its root to `end_y`. The centreline spreads outward
    from her centre part, is kept off the face, and carries a sine of the
    measured curl radius and pitch (a ringlet's projection onto the view).
    """
    x0, y0 = root
    length = max(24.0, end_y - y0)
    n = int(np.clip(length / curl_p * 18, 60, 420))
    t = np.linspace(0.0, 1.0, n)
    y = y0 + length * t
    # Rounded fall: the mass widens quickly then turns back in near the ends,
    # so the silhouette follows the shoulders instead of being a rectangle.
    falloff = np.sin(np.clip(t * 1.35, 0, 1) * (np.pi / 2)) * (1.0 - 0.30 * np.clip((t - 0.75) / 0.25, 0, 1))
    x = x0 + side * spread * falloff * 0 + (x0 - cx) * (0.35 + 0.55 * falloff) + side * spread * falloff + rng.normal(0, 0.6, n)
    # Never across the face: hair falls beside it.
    face_edge = cx + side * 0.30 * abs(cx - cx)  # placeholder replaced below
    pts = []
    for i in range(n):
        pts.append([x[i], y[i], -0.15 * t[i]])
    p = np.array(pts)
    d = np.gradient(p[:, :2], axis=0)
    d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    perp = np.c_[-d[:, 1], d[:, 0]]
    phase = 2 * np.pi * (length * t) / curl_p + rng.uniform(0, 6.28)
    env = np.clip(0.35 + (length * t) / (curl_p * 2.5), 0, 1)
    p[:, :2] += curl_r * env[:, None] * perp * np.cos(phase)[:, None]
    p[:, 2] = 0.10 + rng.uniform(0, 0.05) - 0.12 * t + 0.02 * np.sin(phase)
    # Shade the wave: the outside of a ringlet catches the light, the inside
    # falls into shadow. That banding is what makes a curl read as a curl.
    shade = 0.45 + 0.85 * (0.5 + 0.5 * np.cos(phase)) + 0.10 * np.sin(phase * 0.5)
    return np.c_[p, shade]


def render(strands, tones, W, H, radius_px, face_poly, blend=0.85):
    """
    Splat the strands with a depth buffer. Returns the strand layer, its alpha
    and the depth, in the base render's own pixel space.
    """
    zbuf = np.full((H, W), -1e9)
    key = np.full((H, W), -1e18)
    out = np.zeros((H, W, 3))
    pts_all, col_all, id_all = [], [], []
    for idx, (p, tone) in enumerate(zip(strands, tones)):
        tone = np.atleast_1d(np.asarray(tone, dtype=np.float64)).reshape(-1)
        seg = np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1]))
        for i in range(len(p) - 1):
            k = max(1, int(seg[i] / 0.6))
            f = np.arange(k) / k
            xs = p[i, 0] + (p[i + 1, 0] - p[i, 0]) * f
            ys = p[i, 1] + (p[i + 1, 1] - p[i, 1]) * f
            zs = p[i, 2] + (p[i + 1, 2] - p[i, 2]) * f
            # Shade along the curl: the outside of a ringlet catches the light.
            d = p[i + 1, :2] - p[i, :2]
            nd = d / (np.linalg.norm(d) + 1e-9)
            # Per-point shade comes from the curl phase; the segment direction
            # only nudges it.
            dir_lit = np.clip(nd[0] * -0.35 + nd[1] * 0.45 + 0.62, 0.55, 1.15)
            lit = p[i, 3] * dir_lit * np.ones(len(xs))
            pts_all.append(np.c_[xs, ys, zs])
            col_all.append(np.clip(tone[None, :] * lit[:, None], 0, 1))
            id_all.append(np.full(len(xs), idx))
    if not pts_all:
        return None, None, None
    P3 = np.vstack(pts_all)
    C3 = np.vstack(col_all)
    I3 = np.concatenate(id_all)
    xi = np.clip(P3[:, 0].astype(int), 0, W - 1)
    yi = np.clip(P3[:, 1].astype(int), 0, H - 1)
    ri = int(np.ceil(radius_px))
    offs = [(dx, dy) for dy in range(-ri, ri + 1) for dx in range(-ri, ri + 1) if dx * dx + dy * dy <= radius_px * radius_px]
    k = (P3[:, 2] + 10.0) * 1e9 + I3
    for dx, dy in offs:
        x = np.clip(xi + dx, 0, W - 1)
        y = np.clip(yi + dy, 0, H - 1)
        np.maximum.at(key.reshape(-1), y * W + x, k)
    mask = key > -1e17
    # Hair is not drawn over her face.
    face = np.zeros((H, W), np.uint8)
    if face_poly is not None:
        cv2.fillPoly(face, [face_poly.astype(np.int32)], 1)
    mask &= face == 0
    pid = np.where(mask, (key % 1e9).astype(np.int64), -1)
    yy, xx = np.nonzero(mask)
    cols = C3[np.clip(pid[yy, xx], 0, len(C3) - 1)]
    out[yy, xx] = cols
    alpha = cv2.GaussianBlur((mask * 255).astype(np.uint8), (0, 0), 1.2)
    return out, alpha, zbuf


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.0"))
    ap.add_argument("--base", default=os.path.join(ROOT, "artifacts/pci-fr-1.0/renders/improved_face.png"))
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--clumps", type=int, default=2600)
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "hair"), exist_ok=True)

    base = Image.open(a.base).convert("RGB")
    CW, CH = base.width * a.scale, base.height * a.scale
    base = base.resize((CW, CH), Image.LANCZOS)
    canvas = np.asarray(base).copy()

    base_pts = P.load_landmarks(a.base)
    ref_pts = P.load_landmarks(REF10)
    if base_pts is None or ref_pts is None:
        raise SystemExit("need a face in both the base render and ref10")

    bfw = float(np.linalg.norm(base_pts[234] - base_pts[454]))
    bcx = float((base_pts[234, 0] + base_pts[454, 0]) / 2)
    bcy = float((base_pts[10, 1] + base_pts[152, 1]) / 2)
    rfw = float(np.linalg.norm(ref_pts[234] - ref_pts[454]))
    rcx = float((ref_pts[234, 0] + ref_pts[454, 0]) / 2)
    rcy = float((ref_pts[10, 1] + ref_pts[152, 1]) / 2)

    # ref pixels → canvas pixels, through the two faces' widths.
    s = (bfw * a.scale) / rfw
    ox = bcx * a.scale
    oy = bcy * a.scale
    to_canvas = lambda xy: np.array([ox + (xy[0] - rcx) * s, oy + (xy[1] - rcy) * s])

    px_per_mm = (bfw * a.scale) / H.HEAD_WIDTH_MM
    ring = H.SPEC["ringlet"]
    curl_r = ring["curl_radius_mm"] * px_per_mm
    curl_p = ring["curl_pitch_mm"] * px_per_mm
    radius_px = 0.30 * px_per_mm  # rendered clump radius ≈ 0.3 mm

    roots_ref = scalp_roots(ref_pts, spacing_px=max(4.0, 0.022 * rfw))
    rng = np.random.default_rng(11)
    if len(roots_ref) > a.clumps:
        roots_ref = roots_ref[rng.choice(len(roots_ref), a.clumps, replace=False)]

    chin_y = to_canvas(ref_pts[152])[1]
    end_y = chin_y + 0.75 * bfw * a.scale
    strands, tones = [], []
    for root in roots_ref:
        r = to_canvas(root)
        side = 1.0 if r[0] >= ox else -1.0
        spread_px = (0.16 + rng.uniform(-0.03, 0.05)) * bfw * a.scale
        p = grow(r, side, ox, chin_y, end_y + rng.normal(0, 0.06 * bfw * a.scale), curl_r, curl_p, spread_px, rng)
        strands.append(p)
        tone = PALETTE[int(rng.choice([0, 1, 2, 3, 4, 5], p=[0.30, 0.26, 0.20, 0.12, 0.08, 0.04]))]
        tones.append(np.clip(tone * rng.uniform(0.75, 1.3), 0, 255) / 255.0)

    # Her face outline, so strands never cover it.
    oval = P.face_oval(ref_pts) if hasattr(P, "face_oval") else None
    if oval is None:
        ring_idx = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
        oval = ref_pts[ring_idx]
    face_poly = np.array([to_canvas(p) for p in oval])
    face_poly[:, 1] = face_poly[:, 1] + 0.02 * bfw * a.scale

    layer, alpha, _ = render(strands, tones, CW, CH, radius_px, face_poly)

    # Under-mass from the strands' own coverage: no hand-drawn silhouette.
    a_bin = (alpha > 8).astype(np.uint8)
    a_bin = cv2.morphologyEx(a_bin, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    a_bin = cv2.dilate(a_bin, np.ones((11, 11), np.uint8))
    a_bin = cv2.GaussianBlur(a_bin * 255, (0, 0), 5).astype(np.float64) / 255.0 * 0.55
    a_bin[face_poly.astype(int)[:, 1].clip(0, CH - 1)[:, None], face_poly.astype(int)[:, 0].clip(0, CW - 1)] = 0
    face_mask = np.zeros((CH, CW), np.uint8)
    cv2.fillPoly(face_mask, [face_poly.astype(np.int32)], 1)
    a_bin *= (1 - face_mask)

    under = np.array([15, 10, 12], dtype=np.float64)
    out = canvas.astype(np.float64) * (1 - a_bin[..., None]) + under * a_bin[..., None]
    if layer is not None:
        al = (alpha.astype(np.float64) / 255.0)[..., None] * 0.9
        out = layer * 255.0 * al + out * (1 - al)
    portrait = np.clip(out, 0, 255).astype(np.uint8)

    p1 = os.path.join(a.out, "hair", "hair_render.png")
    Image.fromarray(portrait).save(p1)

    # Strands alone, on black: the geometry has to stand on its own.
    alone = np.zeros((CH, CW, 3), np.uint8)
    if layer is not None:
        al = (alpha.astype(np.float64) / 255.0)[..., None]
        alone = np.clip(layer * 255 * al + alone * (1 - al), 0, 255).astype(np.uint8)
    p2 = os.path.join(a.out, "hair", "hair_strands.png")
    Image.fromarray(alone).save(p2)

    # Curl annotation: one strand, its measured radius and pitch, drawn on the
    # spec-sheet numbers so the geometry can be checked without the render.
    ann_w, ann_h = 900, 620
    ann = Image.new("RGB", (ann_w, ann_h), (16, 14, 16))
    d = ImageDraw.Draw(ann)
    n = 900
    tt = np.linspace(0, 1, n)
    L = 7.0 * curl_p
    ang = 2 * np.pi * (L * tt) / curl_p
    xs = 450 + curl_r * 1.6 * np.cos(ang) * 1.0 + 0 * tt
    ys = 120 + L * tt * 0.45
    xs = xs - curl_r * 1.6 + curl_r * 1.6 * np.cos(ang)
    ys = 90 + 420 * tt + curl_r * 1.6 * np.sin(ang)
    for i in range(n - 1):
        d.line([(xs[i], ys[i]), (xs[i + 1], ys[i + 1])], fill=tuple(int(v) for v in PALETTE[4]), width=3)
    d.text((560, 60), "ringlet geometry (spec sheet)", fill=(235, 230, 225))
    d.text((560, 86), f"curl radius {ring['curl_radius_mm']} mm", fill=(235, 230, 225))
    d.text((560, 106), f"curl pitch  {ring['curl_pitch_mm']} mm", fill=(235, 230, 225))
    d.text((560, 126), f"strand Ø    {ring['strand_diameter_mm']} mm", fill=(235, 230, 225))
    d.text((60, 560), f"rendered at {px_per_mm:.2f} px/mm  ·  {len(strands)} clumps  ·  radius {radius_px:.2f} px", fill=(200, 195, 190))
    p3 = os.path.join(a.out, "hair", "hair_curvature.png")
    ann.save(p3)

    meta = {
        "schema": "lelu.hair.reconstruction/1",
        "clumps": len(strands),
        "points_per_clump": int(len(strands[0])) if strands else 0,
        "canvas": [CW, CH],
        "px_per_mm": round(px_per_mm, 3),
        "curl_radius_px": round(curl_r, 2),
        "curl_pitch_px": round(curl_p, 2),
        "clump_radius_px": round(radius_px, 3),
        "head_width_mm_assumed": H.HEAD_WIDTH_MM,
        "spec_source": ring["source"],
        "outputs": [os.path.relpath(p, ROOT) for p in (p1, p2, p3)],
        "note": "Clump-level strands: each rendered strand stands for ~25 individual 0.07 mm hairs, which is the finest this render can resolve.",
    }
    json.dump(meta, open(os.path.join(a.out, "hair", "hair-render.json"), "w"), indent=1)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
