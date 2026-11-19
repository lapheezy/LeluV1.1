"""
LÉLU — hair perception and specification (PCI-FR 2.0, WP01-A)

Reads the 25 committed hair references. They are not plain photographs: each is
a letterboxed design sheet with an annotation panel that states the hair's
physical specification (ringlet radius and pitch, strand diameter, follicle
spacing, baby-hair swirl radii, hairline arc). Those numbers are the design
targets; this module records where each came from and checks them against what
the pixels actually show, using ratios (which do not need a px-per-mm scale).

What is measured here, per image:

  * the hair mask and its silhouette
  * the hairline where a face is present
  * a strand-orientation field and its coherence (structure tensor)
  * the dominant curl spacing and the curl axis, by autocorrelation
  * the hair colour palette (base / mid / highlight)
  * thin filaments on the forehead and their spiral fits (baby hairs)

  python scripts/perception/lelu_hair.py --out artifacts/pci-fr-2.0
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lelu_perception as P  # noqa: E402
import lelu_replicate as Rp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HAIR_DIR = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/lelu-hair")
EXPR_DIR = os.path.join(ROOT, "leluverse/assets/characters/lelu_character/references/lelu-facial-expressions")

#: Physical specification transcribed from the annotation panels. `source` is
#: the committed file the number is printed on; `note` says what it measures.
SPEC = {
    "ringlet": {
        "curl_diameter_mm": 8.4,
        "curl_radius_mm": 4.2,
        "curl_pitch_mm": 11.8,
        "turns_per_cm": 0.85,
        "strand_diameter_mm": 0.07,
        "strand_diameter_range_mm": [0.06, 0.09],
        "source": "lelu-hair-17.png",
    },
    "ringlet_loose": {
        "curl_diameter_mm": 13.0,
        "curl_radius_mm": 6.5,
        "curl_pitch_mm": 15.0,
        "strand_diameter_um": 75,
        "source": "lelu-hair-24.png",
    },
    "hairline": {
        "arc_length_cm": 13.8,
        "arc_height_cm": 3.6,
        "source": "lelu-hair-18.png",
    },
    "baby_swirls": [
        {"id": "A", "radius_cm": 0.8, "length_cm": 4.2},
        {"id": "B", "radius_cm": 1.1, "length_cm": 5.6},
        {"id": "C", "radius_cm": 0.5, "length_cm": 3.1},
    ],
    "follicle": {"spacing_mm_range": [1.0, 1.6], "density_per_cm2_range": [62, 100], "source": "lelu-hair-18.png"},
    "method_notes": {
        "curl": "Fit circles to the strand centreline of a relaxed, unweighted curl; report mean/min/max radius. Curvature kappa = 1/R.",
        "source": "lelu-hair-22.png",
    },
}

#: Scale is not printed anywhere in the references, so mm→world needs a body
#: dimension. Her head width is taken as 150 mm (adult female 5th–95th percentile
#: band); stated here so every downstream millimetre is traceable to it.
HEAD_WIDTH_MM = 150.0


def content_band(rgb: np.ndarray) -> tuple[int, int, int, int]:
    """Crop box of the design sheet's actual artwork (drops the letterbox bars)."""
    g = rgb.mean(axis=2)
    rows = (g > 18).mean(axis=1)
    cols = (g > 18).mean(axis=0)
    ys = np.where(rows > 0.15)[0]
    xs = np.where(cols > 0.15)[0]
    if not len(ys) or not len(xs):
        h, w = g.shape
        return 0, 0, w, h
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def hair_material_mask(rgb: np.ndarray) -> np.ndarray:
    """
    Hair without a face to anchor on: dark or burgundy pixels that carry fine
    texture. Texture is what separates hair from the flat dark backdrop and
    from flat fabric.
    """
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.int16)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    tex = cv2.blur((gray.astype(np.float32)) ** 2, (9, 9)) - cv2.blur(gray.astype(np.float32), (9, 9)) ** 2
    tex = np.sqrt(np.maximum(tex, 0))
    dark = (v < 120) & (s < 170)
    burgundy = (h <= 12) | (h >= 145)
    coloured = burgundy & (s >= 60) & (v >= 25) & (v < 200)
    mask = (dark | coloured) & (tex > 5)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    # Keep the largest component plus anything touching it: the hair mass.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return mask
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = (labels == biggest).astype(np.uint8)
    keep = cv2.dilate(keep, np.ones((15, 15), np.uint8))
    return (mask & keep)


def orientation_field(rgb: np.ndarray, mask: np.ndarray, sigma: float = 2.0) -> dict:
    """
    Structure-tensor orientation of the strands. Returns the doubled-angle
    vector field (so opposite directions agree), the per-pixel coherence and a
    mask-weighted summary. Angle is in image coordinates, degrees, 0 = +x.
    """
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), sigma)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), sigma)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), sigma)
    # Strand direction is perpendicular to the image gradient.
    theta = 0.5 * np.arctan2(2 * jxy, jxx - jyy) + np.pi / 2
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-6)
    m = mask > 0
    if m.sum() < 100:
        return {"theta": theta, "coherence": coh, "mean_coherence": 0.0, "dominant_angle_deg": None, "anisotropy": 0.0}
    z = np.exp(2j * theta[m])
    mean_z = z.mean()
    return {
        "theta": theta,
        "coherence": coh,
        "mean_coherence": round(float(coh[m].mean()), 4),
        "dominant_angle_deg": round(float(np.degrees(np.angle(mean_z) / 2)) % 180, 2),
        "anisotropy": round(float(np.abs(mean_z)), 4),
    }


def curl_scale(rgb: np.ndarray, mask: np.ndarray, min_px: int = 8, max_px: int = 140) -> dict:
    """
    Dominant curl spacing by autocorrelation of the hair luminance.

    The first autocorrelation peak away from the origin is the repeat distance
    of the curl pattern; its direction is the curl axis. Reported in pixels and
    as a fraction of the hair region's width, which is the scale-free form.
    """
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    m = cv2.erode(mask, np.ones((5, 5), np.uint8))
    if m.sum() < 2000:
        return {"spacing_px": None, "axis_deg": None, "confidence": 0.0}
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    patch = gray[y0:y1, x0:x1]
    pm = (m[y0:y1, x0:x1] > 0).astype(np.float32)
    patch = (patch - cv2.GaussianBlur(patch, (0, 0), 25)) * pm
    h, w = patch.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    F = np.fft.rfft2(patch * win)
    ac = np.fft.irfft2(F * np.conj(F), s=(h, w))
    ac = np.fft.fftshift(ac)
    ac /= ac.max() + 1e-9
    cy, cx = h // 2, w // 2
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - cy, xx - cx)
    # Search range scales with the patch: a curl is a visible fraction of the
    # hair region, and a fixed 8 px floor locked onto pixel-level texture.
    lo_px = float(min_px) if min_px > 12 else max(12.0, 0.02 * min(h, w))
    hi_px = float(min(max_px, 0.40 * min(h, w)))
    band = (r >= lo_px) & (r <= hi_px)
    if not band.any():
        return {"spacing_px": None, "axis_deg": None, "confidence": 0.0}
    ac_s = cv2.GaussianBlur(ac.astype(np.float32), (0, 0), 2.0)
    scores = np.where(band, ac_s, -1)
    iy, ix = np.unravel_index(int(np.argmax(scores)), scores.shape)
    peak = float(scores[iy, ix])
    # Prominence against the ring's typical value, so a noisy peak is not reported.
    ring = ac_s[band]
    prominence = float((peak - np.median(ring)) / (np.std(ring) + 1e-9))
    if peak < 0.12 or prominence < 2.0:
        return {"spacing_px": None, "axis_deg": None, "confidence": 0.0, "prominence": round(prominence, 2)}
    spacing = float(np.hypot(iy - cy, ix - cx))
    axis = float(np.degrees(np.arctan2(ix - cx, iy - cy)) % 180)
    return {
        "spacing_px": round(spacing, 2),
        "axis_deg": round(axis, 1),
        "confidence": round(float(np.clip(peak, 0, 1)), 3),
        "region_width_px": int(w),
        "spacing_over_region_width": round(spacing / max(w, 1), 4),
    }


def hair_palette(rgb: np.ndarray, mask: np.ndarray, k: int = 4) -> list[dict]:
    """Base, mid and highlight colours of the hair mass, by k-means."""
    pix = rgb[mask > 0].astype(np.float32)
    if len(pix) < 50:
        return []
    pix = pix[np.random.default_rng(0).choice(len(pix), size=min(20000, len(pix)), replace=False)]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(pix, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.ravel(), minlength=k)
    order = np.argsort(centers.mean(axis=1))
    out = []
    for i in order:
        c = centers[i]
        out.append({
            "rgb": [int(round(v)) for v in c],
            "hex": "#%02x%02x%02x" % tuple(int(round(v)) for v in c),
            "share": round(float(counts[i] / counts.sum()), 3),
            "luma": round(float(c.mean()), 1),
        })
    return out


def spiral_fit(points: np.ndarray) -> dict:
    """
    Fit an Archimedean spiral r = a + b*theta to a filament's pixels.

    Baby hairs in this design are flat spirals lying on the forehead, so a line
    fit (what PCI-FR 1.0 used) under-reports them: it measures the chord, not
    the curl. The fit returns the spiral's outer radius and its arc length.
    """
    mean = points.mean(axis=0)
    p = points - mean
    theta = np.arctan2(p[:, 1], p[:, 0])
    r = np.hypot(p[:, 0], p[:, 1])
    order = np.argsort(theta)
    theta, r = theta[order], r[order]
    A = np.c_[np.ones_like(theta), theta]
    (a, b), *_ = np.linalg.lstsq(A, r, rcond=None)
    pred = a + b * theta
    resid = float(np.sqrt(np.mean((r - pred) ** 2)))
    outer = float(r.max())
    # Arc length of r = a + b*theta over the fitted sweep.
    lo, hi = float(theta.min()), float(theta.max())
    ts = np.linspace(lo, hi, 64)
    rs = np.abs(a + b * ts)
    arc = float(np.sum(np.hypot(np.diff(rs), rs[:-1] * np.diff(ts))))
    return {
        "radius_px": round(outer, 2),
        "a_px": round(float(a), 2),
        "b_px_per_rad": round(float(b), 3),
        "arc_length_px": round(arc, 2),
        "fit_residual_px": round(resid, 2),
        "turns": round(float(abs(b) and (hi - lo) / (2 * np.pi)), 3),
        "is_spiral": bool(abs(b) * (hi - lo) > 3 and arc > 1.6 * outer and resid < 0.45 * outer),
    }


def forehead_filaments(rgb: np.ndarray, face_pts: np.ndarray, hairline: list) -> list[dict]:
    """
    Thin dark filaments on the forehead, fitted as spirals rather than lines.
    Same black-hat detector as PCI-FR 1.0 so reference and render are measured
    identically; only the fitting changed.
    """
    if not hairline:
        return []
    fh = float(np.linalg.norm(face_pts[10] - face_pts[152]))
    fw = float(np.linalg.norm(face_pts[234] - face_pts[454]))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    skin = P.skin_mask(rgb)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(max(11, fw * 0.05)) | 1,) * 2)
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    brow_y = float(min(face_pts[105, 1], face_pts[334, 1]))
    y0, y1 = int(max(0, brow_y - 0.62 * fh)), int(min(gray.shape[0], brow_y))
    x0 = int(max(0, min(face_pts[234, 0], face_pts[454, 0])))
    x1 = int(min(gray.shape[1], max(face_pts[234, 0], face_pts[454, 0])))
    band = np.zeros_like(gray)
    band[y0:y1, x0:x1] = 1
    cand = ((blackhat > 10) & (band > 0) & (skin > 0)).astype(np.uint8)
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cand, 8)
    out = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < 40 or area > int(fh * fh * 0.004):
            continue
        ys, xs = np.nonzero(labels == i)
        pts = np.c_[xs, ys].astype(np.float32)
        u, sv, _ = np.linalg.svd(pts - pts.mean(0), full_matrices=False)
        elong = float(sv[0] / max(sv[1], 1e-3))
        if elong < 1.4:
            continue
        fit = spiral_fit(pts)
        root_idx = int(np.argmin([np.hypot(*(p - np.array(hairline)).T).min() for p in pts[:: max(1, len(pts) // 40)]]))
        cand_pts = pts[:: max(1, len(pts) // 40)]
        root = cand_pts[root_idx]
        out.append({
            "root": [round(float(root[0]), 1), round(float(root[1]), 1)],
            "root_to_hairline_px": round(float(np.hypot(*(cand_pts[root_idx] - np.array(hairline)).T).min()), 1),
            "area_px": int(area),
            "elongation": round(elong, 2),
            "thickness_px": round(float(area / max(fit["arc_length_px"], 1.0)), 2),
            **fit,
            "evidence": {"blackhat_mean": round(float(blackhat[ys, xs].mean()), 1)},
        })
    out.sort(key=lambda s: -s["arc_length_px"])
    return out


def analyse(path: str, landmarker, mp) -> dict:
    rgb = np.asarray(Image.open(path).convert("RGB"))
    # Measure on the sheet as a whole: cropping to the artwork band cut chins
    # and made the face detector miss faces it finds on the full sheet. The
    # letterbox is black and the annotation panel is filtered out by the
    # largest-component step in `hair_material_mask`.
    x0, y0, x1, y1 = content_band(rgb)
    pts = Rp.extract_face_landmarks(rgb, landmarker)
    has_face = pts is not None
    if has_face:
        fw = float(np.linalg.norm(pts[234] - pts[454]))
        fh = float(np.linalg.norm(pts[10] - pts[152]))
        cx = float((pts[234, 0] + pts[454, 0]) / 2)
        cy = float((pts[10, 1] + pts[152, 1]) / 2)
        eye_mid = (pts[33] + pts[263]) / 2
        yaw = float((pts[1, 0] - eye_mid[0]) / max(fw, 1e-6))
        hair = P.hair_mask(rgb, pts)
        skin = P.skin_mask(rgb)
        line = P.hairline_path(skin, hair, pts)
        filaments = forehead_filaments(rgb, pts, line)
        # Hair mass including what hangs outside the face window.
        loose = hair_material_mask(rgb)
        hair = ((hair > 0) | (loose > 0)).astype(np.uint8)
    else:
        fw = fh = None
        yaw = None
        line = []
        filaments = []
        skin = P.skin_mask(rgb)
        hair = hair_material_mask(rgb)
    field = orientation_field(rgb, hair)
    curl = curl_scale(rgb, hair)
    palette = hair_palette(rgb, hair)

    # Everything below is expressed relative to the face when there is one, so
    # it survives the unknown px→mm scale of a design sheet.
    mm_per_px = (fw / HEAD_WIDTH_MM) and 1.0 / (fw / HEAD_WIDTH_MM) if has_face else None
    entry = {
        "path": os.path.relpath(path, ROOT),
        "band_box": [x0, y0, x1, y1],
        "band_size": [int(x1 - x0), int(y1 - y0)],
        "face": {
            "detected": has_face,
            "face_width_px": round(fw, 1) if has_face else None,
            "face_height_px": round(fh, 1) if has_face else None,
            "yaw_proxy": round(yaw, 3) if has_face else None,
            "framing": None if not has_face else ("frontal" if abs(yaw) <= 0.06 else ("three-quarter" if abs(yaw) <= 0.20 else "profile")),
        },
        "hair": {
            "area_px": int((hair > 0).sum()),
            "area_fraction": round(float((hair > 0).mean()), 4),
            "silhouette_bbox": [int(v) for v in cv2.boundingRect(hair)],
            "width_px": int(cv2.boundingRect(hair)[2]),
            "height_px": int(cv2.boundingRect(hair)[3]),
        },
        "hairline": {
            "points": line,
            "arc_length_px": round(float(np.sum(np.linalg.norm(np.diff(np.array(line), axis=0), axis=1))), 1) if len(line) > 2 else None,
            "arc_height_px": round(float(max(p[1] for p in line) - min(p[1] for p in line)), 1) if len(line) > 2 else None,
            "arc_height_over_length": round(float((max(p[1] for p in line) - min(p[1] for p in line)) / max(np.sum(np.linalg.norm(np.diff(np.array(line), axis=0), axis=1)), 1e-6)), 4) if len(line) > 2 else None,
        },
        "orientation": {k: v for k, v in field.items() if k not in ("theta", "coherence")},
        "curl": curl,
        "palette": palette,
        "filaments": filaments,
        "filament_metrics": {
            "count": len(filaments),
            "spiral_count": sum(1 for f in filaments if f["is_spiral"]),
            "mean_arc_px": round(float(np.mean([f["arc_length_px"] for f in filaments])), 1) if filaments else None,
            "mean_radius_px": round(float(np.mean([f["radius_px"] for f in filaments])), 1) if filaments else None,
            "radius_over_face_width": round(float(np.mean([f["radius_px"] for f in filaments]) / fw), 4) if filaments and has_face else None,
        },
        "px_per_mm_assumed": round(1.0 / mm_per_px, 3) if mm_per_px else None,
    }
    return entry


def spec_checks(entries: list[dict]) -> dict:
    """
    Check the printed specification against the pixels using scale-free ratios.

    Curl diameter / curl pitch is 8.4/11.8 = 0.712 on the sheet. If the pixels
    are the same hair, the autocorrelation spacing (one pitch) and the visible
    curl width should keep that relationship, and the arc-height ratio of the
    hairline should sit near 3.6/13.8 = 0.261.
    """
    pitches = [e["curl"]["spacing_px"] for e in entries if e["curl"]["spacing_px"]]
    heights = [e["hairline"]["arc_height_over_length"] for e in entries if e["hairline"]["arc_height_over_length"]]
    radii = [e["filament_metrics"]["radius_over_face_width"] for e in entries if e["filament_metrics"]["radius_over_face_width"]]
    return {
        "expected": {
            "curl_diameter_over_pitch": round(SPEC["ringlet"]["curl_diameter_mm"] / SPEC["ringlet"]["curl_pitch_mm"], 4),
            "hairline_height_over_arc": round(SPEC["hairline"]["arc_height_cm"] / SPEC["hairline"]["arc_length_cm"], 4),
            "swirl_radius_over_face_width": round(SPEC["baby_swirls"][0]["radius_cm"] * 10 / HEAD_WIDTH_MM, 4),
        },
        "measured": {
            "curl_spacing_px_median": round(float(np.median(pitches)), 2) if pitches else None,
            "curl_spacing_px_spread": [round(float(np.min(pitches)), 2), round(float(np.max(pitches)), 2)] if pitches else None,
            "hairline_height_over_arc_median": round(float(np.median(heights)), 4) if heights else None,
            "swirl_radius_over_face_width_median": round(float(np.median(radii)), 4) if radii else None,
            "images_with_curl_measurement": len(pitches),
            "images_with_hairline": len(heights),
            "images_with_spiral_filament": len(radii),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "artifacts/pci-fr-2.0"))
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "hair"), exist_ok=True)

    paths = sorted(os.path.join(HAIR_DIR, f) for f in os.listdir(HAIR_DIR) if f.endswith(".png"))
    if a.limit:
        paths = paths[: a.limit]
    mp, lm = P._landmarker()
    entries = []
    for p in paths:
        e = analyse(p, lm, mp)
        entries.append(e)
        print(f"{os.path.basename(p):22s} face={'y' if e['face']['detected'] else 'n'} curl={e['curl']['spacing_px']} "
              f"coh={e['orientation']['mean_coherence']} spirals={e['filament_metrics']['spiral_count']} "
              f"hair={e['hair']['area_fraction']:.2f}")
    lm.close()

    report = {
        "schema": "lelu.hair.references/1",
        "spec": SPEC,
        "head_width_mm_assumed": HEAD_WIDTH_MM,
        "images": entries,
        "checks": spec_checks(entries),
        "summary": {
            "count": len(entries),
            "with_face": sum(1 for e in entries if e["face"]["detected"]),
            "frontal": sum(1 for e in entries if e["face"]["framing"] == "frontal"),
            "with_spiral_filaments": sum(1 for e in entries if e["filament_metrics"]["spiral_count"]),
            "total_spiral_filaments": sum(e["filament_metrics"]["spiral_count"] for e in entries),
        },
    }
    path = os.path.join(a.out, "hair", "hair-references.json")
    json.dump(report, open(path, "w"), indent=1)
    print(json.dumps(report["summary"]))
    print(json.dumps(report["checks"], indent=1))


if __name__ == "__main__":
    main()
