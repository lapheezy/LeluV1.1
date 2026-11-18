"""
LÉLU — PERCEPTION (PCI-FR 1.0, WP02)

Turns a real reference photograph into structured, evidence-backed visual
features — not prose. Every feature carries where it is, how big it is, how
confident the measurement is, which image it came from and the pixel evidence
that produced it.

  landmarks       478 MediaPipe face landmarks (px), with a stability confidence
  proportions     dimensionless facial ratios (pose-invariant, identity-bearing)
  face oval       the landmark face outline as a polygon
  skin / hair     masks + hairline polyline (topmost skin per forehead column)
  baby hairs      thin strands crossing the hairline: root, tip, length, angle,
                  curvature, thickness
  silhouette      subject outline (GrabCut) with area and contour
  jewelry         metallic bead blobs: centre, radius, nearest-neighbour spacing,
                  chain direction and the symmetry axis of the arrangement
  garment         torso colour panels (corset/armour) with contours and coverage
  relationships   graph edges between components (symmetric pairs, chains, owner)

Model: MediaPipe Face Landmarker (Apache-2.0), run offline from the committed
task file scripts/blender/models/face_landmarker.task. No network at runtime,
no account, no paid API.

  python scripts/perception/lelu_perception.py --out artifacts/pci-fr-1.0/features \
      leluverse/assets/characters/lelu_character/references/ref10_face_primary.png

MediaPipe's Python bindings dlopen libEGL; on a machine without it, point
LD_LIBRARY_PATH at a directory holding libEGL.so.1 (see docs/missions/PCI-FR-1.0.md).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

SCHEMA = "lelu.perception.features/1"

# ---------------------------------------------------------------- landmarks --

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

REGIONS = {
    "eyes": [33, 133, 159, 145, 160, 161, 158, 157, 144, 153, 362, 263, 386, 374, 387, 388, 385, 384, 373, 380, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477],
    "brows": [70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 46, 53, 276, 283],
    "nose": [1, 2, 98, 327, 168, 6, 197, 195, 5, 4, 129, 358, 48, 278, 115, 344],
    "mouth": [61, 291, 13, 14, 0, 17, 78, 308, 82, 312, 87, 317, 84, 314, 402, 323, 185, 409],
    "jaw": [234, 454, 132, 361, 58, 288, 172, 397, 136, 365, 150, 379, 149, 378, 176, 400, 152],
    "cheek": [116, 345, 117, 346, 118, 347, 123, 352, 187, 411, 50, 280],
}

#: Landmarks used to align two faces to each other: nasion, forehead, eyes,
#: nose base, mouth corners, chin, cheekbones. Deliberately excludes the parts
#: under evaluation (brows, lips, jaw corners) so a comparison cannot cheat.
ALIGN = [10, 151, 9, 8, 6, 168, 33, 133, 362, 263, 199, 234, 454]

MODEL = os.path.join(os.path.dirname(__file__), "..", "blender", "models", "face_landmarker.task")


def _landmarker(model: str = MODEL):
    os.environ.setdefault("GLOG_minloglevel", "2")
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.15,
        min_face_presence_confidence=0.15,
        output_face_blendshapes=True,
    )
    return mp, vision.FaceLandmarker.create_from_options(options)


def load_landmarks(path: str, landmarker=None):
    """478 landmarks in pixels for the largest face, or None."""
    import mediapipe as mp

    rgb = np.asarray(Image.open(path).convert("RGB"))
    own = landmarker is None
    lm = landmarker or _landmarker()[1]
    try:
        result = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    finally:
        if own:
            lm.close()
    if not result.face_landmarks:
        return None
    h, w = rgb.shape[:2]
    return np.array([[p.x * w, p.y * h] for p in result.face_landmarks[0]])


def landmark_confidence(path: str, points: np.ndarray, landmarker) -> np.ndarray:
    """
    Empirical per-landmark confidence: detect again on a rescaled copy and
    measure how far each point moves when the image changes size. A point that
    survives rescaling is a feature the detector actually sees; one that slides
    is an interpolation. Confidence 1.0 = < 0.2 % IOD of movement.
    """
    import mediapipe as mp

    rgb = Image.open(path).convert("RGB")
    w, h = rgb.size
    scale = 0.78
    small = rgb.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(np.asarray(small))))
    if not result.face_landmarks:
        return np.full(len(points), 0.5)
    moved = np.array([[p.x * w, p.y * h] for p in result.face_landmarks[0]])
    iod = float(np.linalg.norm(points[33] - points[263])) or 1.0
    drift = np.linalg.norm(moved - points, axis=1) / iod
    return np.clip(1.0 - drift / 0.02, 0.0, 1.0)


def proportions(p: np.ndarray) -> dict:
    """Dimensionless facial ratios. Pose-invariant under a front-facing camera."""
    n = lambda a, b: float(np.linalg.norm(p[a] - p[b]))  # noqa: E731
    fw, fh = n(234, 454), n(10, 152)

    def arch(outer: int, mid: int, inner: int, eye_w: float) -> float:
        """Brow rise: how far the brow's midpoint stands above the chord of its ends."""
        a, m, b = p[outer], p[mid], p[inner]
        chord = b - a
        rel = m - a
        # 2-D cross product (numpy 2 removed np.cross for 2-D vectors).
        cross = chord[0] * rel[1] - chord[1] * rel[0]
        offset = cross / max(float(np.linalg.norm(chord)), 1e-9)
        # Image y points down, so a brow that arches upward has a negative offset.
        return float(-offset / eye_w)

    return {
        "eye_aspect_R": ((n(159, 145) + n(158, 153)) / 2) / n(33, 133),
        "eye_aspect_L": ((n(386, 374) + n(385, 380)) / 2) / n(362, 263),
        "brow_arch_R": arch(70, 105, 107, n(33, 133)),
        "brow_arch_L": arch(336, 334, 300, n(362, 263)),
        "nose_width_over_face": n(129, 358) / fw,
        "nose_len_over_faceH": n(168, 4) / fh,
        "lip_height_over_mouth_w": n(0, 17) / n(61, 291),
        "mouth_width_over_face": n(61, 291) / fw,
        "interocular_over_face": n(33, 263) / fw,
        "jaw_width_over_face": n(132, 361) / fw,
        "forehead_over_faceH": n(10, 105) / fh,
        "chin_over_faceH": n(17, 152) / fh,
        "eye_spacing_ratio": n(133, 362) / n(33, 263),
        "face_aspect": fw / fh,
    }


# ------------------------------------------------------------------- masks --

def skin_mask(rgb: np.ndarray) -> np.ndarray:
    """Warm-skin mask (deep complexions included) in RGB uint8."""
    ycc = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    y, cr, cb = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    mask = (cr >= 128) & (cr <= 185) & (cb >= 70) & (cb <= 140) & (y > 30) & (hsv[..., 1] > 20)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))


def hair_mask(rgb: np.ndarray, face_pts: np.ndarray) -> np.ndarray:
    """
    Hair where it meets the face: dark low-saturation mass plus the magenta
    highlights, within a head-sized window around the face (so dark clothing
    and tattoos in the same photograph do not count).
    """
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.int16)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    dark = (v < 105) & (s < 150)
    magenta = (h >= 140) & (h <= 179) & (s >= 70) & (v >= 40)
    mask = ((dark | magenta) & (s > 25)).astype(np.uint8)
    fw = float(np.linalg.norm(face_pts[234] - face_pts[454]))
    cx = float((face_pts[234, 0] + face_pts[454, 0]) / 2)
    cy = float((face_pts[10, 1] + face_pts[152, 1]) / 2)
    win = np.zeros_like(mask)
    x0, x1 = int(max(0, cx - 1.5 * fw)), int(min(mask.shape[1], cx + 1.5 * fw))
    y0, y1 = int(max(0, cy - 1.35 * fw)), int(min(mask.shape[0], cy + 0.9 * fw))
    win[y0:y1, x0:x1] = 1
    mask = mask * win
    # Hanging hair frames the neck; it does not lie across the throat. Without
    # this, a dark choker or a shadowed collarbone is read as hair.
    chin = float(face_pts[152, 1])
    neck = np.ones_like(mask)
    nx0, nx1 = int(max(0, cx - 0.34 * fw)), int(min(mask.shape[1], cx + 0.34 * fw))
    ny0, ny1 = int(min(mask.shape[0] - 1, chin - 0.02 * fw)), int(min(mask.shape[0], chin + 1.0 * fw))
    neck[ny0:ny1, nx0:nx1] = 0
    mask = mask * neck
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))


def hairline_path(skin: np.ndarray, hair: np.ndarray, face_pts: np.ndarray) -> list[list[float]]:
    """
    The hairline: for every forehead column, the first skin pixel walking down
    from above. Curls hanging over the forehead push it down, which is the
    honest measurement — that is what the reference shows.
    """
    fw = float(np.linalg.norm(face_pts[234] - face_pts[454]))
    left, right = sorted((float(face_pts[234, 0]), float(face_pts[454, 0])))
    left, right = int(left + 0.06 * fw), int(right - 0.06 * fw)
    brow_y = float(min(face_pts[105, 1], face_pts[334, 1]))
    top = int(max(0, brow_y - 0.55 * fw))
    floor = int(min(skin.shape[0] - 1, brow_y + 0.04 * fw))
    pts = []
    for x in range(left, right, max(1, int(fw / 120))):
        col_skin = skin[top:floor, x] > 0
        col_hair = hair[top:floor, x] > 0
        found = None
        for i in range(col_skin.size - 1):
            if col_hair[i] and col_skin[i + 1]:
                found = top + i + 1
                break
        if found is None and col_skin.any():
            found = top + int(np.argmax(col_skin))
        if found is not None:
            pts.append([float(x), float(found)])
    if len(pts) < 5:
        return []
    pts = np.array(pts)
    k = max(3, (len(pts) // 9) * 2 + 1)
    ys = cv2.medianBlur(pts[:, 1].astype(np.float32).reshape(-1, 1), 5).ravel()
    ys = np.convolve(ys, np.ones(k) / k, mode="same")
    return [[round(float(x), 1), round(float(y), 1)] for x, y in zip(pts[:, 0], ys)]


def baby_hairs(rgb: np.ndarray, skin: np.ndarray, hairline: list, face_pts: np.ndarray) -> list[dict]:
    """
    Baby hairs: thin dark filaments lying on skin along and above the hairline.
    Found with a black-hat (features narrower than the kernel), then each blob
    is fitted with a line through its pixels: root = the end at the hairline,
    tip = the free end. Length, angle and curvature come from that fit.
    """
    if not hairline:
        return []
    fh = float(np.linalg.norm(face_pts[10] - face_pts[152]))
    fw = float(np.linalg.norm(face_pts[234] - face_pts[454]))
    line = np.array(hairline, dtype=np.float32)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(max(9, fw * 0.055)) | 1, int(max(9, fw * 0.055)) | 1))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    band = np.zeros_like(gray)
    for x, y in line:
        y0, y1 = int(max(0, y - 0.10 * fh)), int(min(gray.shape[0], y + 0.075 * fh))
        x0, x1 = int(max(0, x - fw * 0.012)), int(min(gray.shape[1], x + fw * 0.012))
        band[y0:y1, x0:x1] = 1
    skin_soft = cv2.erode(skin, np.ones((5, 5), np.uint8))
    cand = ((blackhat > 11) & (band > 0) & (skin_soft > 0)).astype(np.uint8)
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(cand, 8)
    strands = []
    min_area, max_area = max(8, int(fh * fh * 0.00002)), int(fh * fh * 0.0025)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < min_area or area > max_area:
            continue
        ys, xs = np.nonzero(labels == i)
        if len(xs) < 6:
            continue
        pts = np.c_[xs, ys].astype(np.float32)
        mean = pts.mean(0)
        u, sv, vt = np.linalg.svd(pts - mean, full_matrices=False)
        elong = float(sv[0] / max(sv[1], 1e-3))
        if elong < 1.5:
            continue
        axis = vt[0]
        t = (pts - mean) @ axis
        lo, hi = pts[t.argmin()], pts[t.argmax()]
        # Root = the end nearest the hairline.
        d = np.linalg.norm(line - lo, axis=1).min(), np.linalg.norm(line - hi, axis=1).min()
        root, tip = (lo, hi) if d[0] <= d[1] else (hi, lo)
        length = float(np.linalg.norm(tip - root))
        if length < 5:
            continue
        ang = float(np.degrees(np.arctan2(tip[1] - root[1], tip[0] - root[0])))
        resid = float(sv[1] / max(len(pts), 1) ** 0.5)
        strands.append({
            "root": [round(float(root[0]), 1), round(float(root[1]), 1)],
            "tip": [round(float(tip[0]), 1), round(float(tip[1]), 1)],
            "length_px": round(length, 1),
            "angle_deg": round(ang, 1),
            "curvature_px": round(resid, 2),
            "thickness_px": round(float(area / max(length, 1.0)), 2),
            "elongation": round(elong, 2),
            "confidence": round(float(np.clip(area / (min_area * 4) * np.clip(elong / 4, 0, 1), 0.1, 0.98)), 3),
            "evidence": {"area_px": int(area), "blackhat_mean": round(float(blackhat[ys, xs].mean()), 1)},
        })
    strands.sort(key=lambda s: -s["length_px"])
    return strands


# --------------------------------------------------------------- silhouette --

def silhouette(rgb: np.ndarray) -> dict:
    """
    Subject outline via GrabCut from a border-seeded rectangle. Run on a
    downscaled copy (max side 640) and scaled back: the outline of a 1024×1536
    portrait is the same at that size, and 47 s per image becomes ~2 s.
    """
    h, w = rgb.shape[:2]
    scale = min(1.0, 640 / max(h, w))
    small = cv2.resize(rgb, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1.0 else rgb
    sh, sw = small.shape[:2]
    mask = np.zeros((sh, sw), np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    rect = (int(sw * 0.04), int(sh * 0.01), int(sw * 0.92), int(sh * 0.97))
    cv2.grabCut(small, mask, rect, bgd, fgd, 4, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
    if scale < 1.0:
        fg = cv2.resize(fg, (w, h), interpolation=cv2.INTER_NEAREST)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"area_px": 0, "bbox": [0, 0, 0, 0], "contour": [], "confidence": 0.0}
    c = max(contours, key=cv2.contourArea)
    eps = 0.002 * cv2.arcLength(c, True)
    poly = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
    x, y, bw, bh = cv2.boundingRect(c)
    area = float(cv2.contourArea(c))
    return {
        "area_px": int(area),
        "area_fraction": round(area / (h * w), 4),
        "bbox": [int(x), int(y), int(bw), int(bh)],
        "contour": [[int(px), int(py)] for px, py in poly],
        "confidence": round(float(min(0.97, area / (h * w) * 1.6)), 3),
        "evidence": {"method": "grabcut", "iterations": 4, "working_scale": round(scale, 3), "contour_points": int(len(poly))},
    }


# ------------------------------------------------------------------ jewelry --

def bead_features(rgb: np.ndarray, region: tuple[int, int, int, int] | None = None, mode: str = "metal") -> dict:
    """
    Rose-gold / brass beads and links: warm metal is bright, red-biased and
    specular. Blobs that are round become beads with a radius; their
    nearest-neighbour spacing and the axis they lie along describe the chain.
    `mode="warm"` also accepts the rose-quartz gems (red-biased but not hue-1
    metal), which is how the reconstructed pendant is scored.
    """
    h, w = rgb.shape[:2]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.int16)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    metal = (H <= 28) & (S >= 55) & (S <= 235) & (V >= 70) & (rgb[..., 0] > rgb[..., 2] * 1.05)
    if mode == "warm":
        metal = (S >= 35) & (V >= 80) & (rgb[..., 0] > rgb[..., 2] + 8) & (rgb[..., 0] >= rgb[..., 1] - 6)
    if region:
        x, y, rw, rh = region
        win = np.zeros_like(metal)
        win[y : y + rh, x : x + rw] = 1
        metal &= win.astype(bool)
    metal = cv2.morphologyEx(metal.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    metal = cv2.morphologyEx(metal, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    beads = []
    if mode == "metal":
        # Beads are round: fit circles, then keep the ones that land on metal.
        # A contour area over a merged chain would report one enormous "bead"
        # (this is what the first version of this detector did), so circles are
        # fitted to the edge map instead.
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 1.2)
        min_r = max(8, int(min(h, w) * 0.011))
        max_r = max(min_r + 4, int(min(h, w) * 0.032))
        circles = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1.2, minDist=max(14, int(min_r * 1.8)), param1=90, param2=34, minRadius=min_r, maxRadius=max_r)
        if circles is not None:
            for cx, cy, r in np.round(circles[0]).astype(int):
                if not (0 <= cy < h and 0 <= cx < w):
                    continue
                yy, xx = np.ogrid[max(0, cy - r):min(h, cy + r + 1), max(0, cx - r):min(w, cx + r + 1)]
                disc = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
                if not disc.any():
                    continue
                cover = float((metal[max(0, cy - r):min(h, cy + r + 1), max(0, cx - r):min(w, cx + r + 1)][disc] > 0).mean())
                if cover < 0.45:
                    continue
                beads.append({
                    "center": [float(cx), float(cy)],
                    "radius_px": float(r),
                    "bbox": [int(cx - r), int(cy - r), int(2 * r), int(2 * r)],
                    "circularity": 1.0,
                    "confidence": round(float(np.clip(cover, 0.1, 0.95)), 3),
                    "evidence": {"method": "hough", "metal_coverage": round(cover, 3)},
                })
    else:
        n, labels, stats, cents = cv2.connectedComponentsWithStats(metal, 8)
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            if area < max(40, h * h * 0.000012):
                continue
            fill = area / max(1, bw * bh)
            aspect = max(bw, bh) / max(1, min(bw, bh))
            if fill < 0.5 or aspect > 1.9:
                continue
            radius = float(np.sqrt(area / np.pi))
            if radius < 0.004 * min(h, w) or radius > 0.045 * min(h, w):
                continue
            beads.append({
                "center": [round(float(cents[i][0]), 1), round(float(cents[i][1]), 1)],
                "radius_px": round(radius, 1),
                "bbox": [int(x), int(y), int(bw), int(bh)],
                "circularity": round(float(fill * min(1.0, 2.0 / max(aspect, 1.0))), 3),
                "confidence": round(float(np.clip(fill * 0.7 + (1 - 1 / aspect) * 0.3, 0.05, 0.95)), 3),
            })
    # Deduplicate circles that sit on the same bead (Hough returns a few).
    kept = []
    for b in sorted(beads, key=lambda b: -b["confidence"]):
        if all(np.linalg.norm(np.array(b["center"]) - np.array(o["center"])) > 0.6 * min(b["radius_px"], o["radius_px"]) for o in kept):
            kept.append(b)
    beads = kept
    for b in beads:
        b["center"] = [round(float(b["center"][0]), 1), round(float(b["center"][1]), 1)]
        b["radius_px"] = round(float(b["radius_px"]), 1)
    beads.sort(key=lambda b: -b["radius_px"])
    # Nearest-neighbour spacing between comparable beads (chain rhythm).
    spaced = []
    for b in beads:
        c = np.array(b["center"])
        others = [np.linalg.norm(c - np.array(o["center"])) for o in beads if o is not b and abs(o["radius_px"] - b["radius_px"]) < 0.6 * b["radius_px"]]
        if others:
            b["spacing_px"] = round(float(min(others)), 1)
            b["spacing_over_radius"] = round(float(min(others) / b["radius_px"]), 2)
            spaced.append(b)
    # A pendant is an assemblage: beads only count where at least three of them
    # sit within one head-width of each other (a chain), which drops isolated
    # highlights on roses, skin and gems.
    if len(beads) >= 3:
        pts_all = np.array([b["center"] for b in beads])
        keep = []
        for b in beads:
            near = int((np.linalg.norm(pts_all - np.array(b["center"]), axis=1) < 0.45 * w).sum())
            if near >= 3:
                b["assembly_size"] = near
                keep.append(b)
        beads = keep
    else:
        beads = []
    centers = np.array([b["center"] for b in beads]) if beads else np.zeros((0, 2))
    symmetry = None
    if len(centers) >= 6:
        # The vertical axis the arrangement is most mirrored about.
        best = (0.0, None)
        for cand in np.linspace(centers[:, 0].min(), centers[:, 0].max(), 41):
            mirrored = np.c_[2 * cand - centers[:, 0], centers[:, 1]]
            d = np.linalg.norm(centers[:, None, :] - mirrored[None, :, :], axis=2).min(axis=1)
            score = float(np.mean(d < 0.02 * w))
            if score > best[0]:
                best = (score, float(cand))
        symmetry = {"axis_x": round(float(best[1]), 1), "mirror_fraction": round(best[0], 3)}
    return {
        "count": len(beads),
        "beads": beads[:120],
        "median_radius_px": round(float(np.median([b["radius_px"] for b in beads])), 1) if beads else 0.0,
        "median_spacing_over_radius": round(float(np.median([b["spacing_over_radius"] for b in spaced])), 2) if spaced else None,
        "symmetry": symmetry,
        "confidence": round(float(np.clip(len(beads) / 30, 0.05, 0.95)), 3),
        "evidence": {"mask_px": int(metal.sum()), "candidates": int(len(beads)), "detector": "hough" if mode == "metal" else "contour"},
    }


# ----------------------------------------------------------------- garment --

def garment_panels(rgb: np.ndarray, face_pts: np.ndarray | None, k: int = 5) -> dict:
    """
    Torso garment panels: colour-clustered regions over the chest/waist, with
    contours. On LÉLU's references the corset reads as camo panels bounded by
    dark seams; the clusters are the panels. A garment-only photograph has no
    face, so the region falls back to the central torso band.
    """
    h, w = rgb.shape[:2]
    if face_pts is None:
        x0, x1 = int(w * 0.18), int(w * 0.82)
        y0, y1 = int(h * 0.05), int(h * 0.95)
    else:
        fw = float(np.linalg.norm(face_pts[234] - face_pts[454]))
        cx = float((face_pts[234, 0] + face_pts[454, 0]) / 2)
        chin = float(face_pts[152, 1])
        x0, x1 = int(max(0, cx - 2.2 * fw)), int(min(w, cx + 2.2 * fw))
        y0, y1 = int(min(h - 1, chin + 0.25 * fw)), int(min(h, chin + 2.6 * fw))
    crop = rgb[y0:y1, x0:x1]
    if crop.size == 0:
        return {"panels": [], "confidence": 0.0}
    small = cv2.resize(crop, (max(1, crop.shape[1] // 3), max(1, crop.shape[0] // 3)), interpolation=cv2.INTER_AREA)
    data = small.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(data, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    labels = labels.reshape(small.shape[:2])
    panels = []
    for i in range(k):
        m = (labels == i).astype(np.uint8)
        share = float(m.mean())
        if share < 0.04:
            continue
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        c = max(contours, key=cv2.contourArea)
        poly = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True).reshape(-1, 2) * 3
        poly = poly + np.array([x0, y0])
        x, y, bw, bh = cv2.boundingRect(c)
        panels.append({
            "id": f"panel_{i}",
            "color_rgb": [int(v) for v in centers[i]],
            "coverage": round(share, 3),
            "bbox": [int(x0 + x * 3), int(y0 + y * 3), int(bw * 3), int(bh * 3)],
            "contour": [[int(px), int(py)] for px, py in poly],
            "confidence": round(float(np.clip(share * 3.2, 0.1, 0.95)), 3),
        })
    panels.sort(key=lambda p: -p["coverage"])
    return {"panels": panels, "region": [x0, y0, x1, y1], "k": k, "confidence": round(float(min(0.9, sum(p["coverage"] for p in panels))), 3), "evidence": {"pixels": int(crop.shape[0] * crop.shape[1]), "kmeans": k}}


# ------------------------------------------------------------- relationships --

def relationships(face_conf: np.ndarray, hairline: list, strands: list, beads: dict, has_face: bool) -> list[dict]:
    rels = []
    if has_face:
        rels.append({"type": "measures", "from": "landmarks", "to": "proportions", "note": "14 dimensionless ratios derived from 478 landmarks"})
        rels.append({"type": "symmetric_pair", "from": "eye_left", "to": "eye_right", "note": "MediaPipe indices 33/133 vs 362/263"})
        rels.append({"type": "bounds", "from": "face_oval", "to": "hairline", "note": "hairline sits above the face oval; baby hairs cross it"})
    for i, s in enumerate(strands):
        rels.append({"type": "emerges_from", "from": f"baby_hair_{i}", "to": "hairline", "confidence": s["confidence"]})
    if beads.get("symmetry"):
        rels.append({"type": "mirrored_about", "from": "bead_chain", "to": "axis_x", "value": beads["symmetry"]["axis_x"], "confidence": 0.6})
    rels.append({"type": "occludes", "from": "hair", "to": "forehead", "note": "curls over the forehead push the measured hairline down"})
    return rels


# ------------------------------------------------------------------- driver --

def extract(path: str, out_dir: str | None = None) -> dict:
    from PIL import Image as PILImage

    rgb = np.asarray(PILImage.open(path).convert("RGB"))
    h, w = rgb.shape[:2]
    mp, lm = _landmarker()
    try:
        pts = load_landmarks(path, lm)
        conf = landmark_confidence(path, pts, lm) if pts is not None else None
    finally:
        lm.close()

    feats: dict = {
        "schema": SCHEMA,
        "source": {"path": path.replace(os.sep, "/"), "size": [int(w), int(h)], "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()},
        "features": {},
        "relationships": [],
        "warnings": [],
    }
    if pts is None:
        feats["warnings"].append("no face detected: facial features are absent, not zero")
    else:
        fw = float(np.linalg.norm(pts[234] - pts[454]))
        feats["features"]["landmarks"] = {
            "kind": "landmark_set",
            "count": int(len(pts)),
            "points": [[round(float(x), 1), round(float(y), 1)] for x, y in pts],
            "bbox": [round(float(pts[:, 0].min()), 1), round(float(pts[:, 1].min()), 1), round(float(pts[:, 0].max() - pts[:, 0].min()), 1), round(float(pts[:, 1].max() - pts[:, 1].min()), 1)],
            "confidence": round(float(conf.mean()), 3),
            "per_point_confidence": [round(float(c), 3) for c in conf],
            "evidence": {"model": "mediapipe face_landmarker.task", "license": "Apache-2.0", "min_face_detection_confidence": 0.15, "stability_scale": 0.78},
        }
        feats["features"]["proportions"] = {
            "kind": "ratio_set", "values": {k: round(float(v), 5) for k, v in proportions(pts).items()},
            "confidence": round(float(np.clip(conf.mean(), 0, 1)), 3),
            "evidence": {"units": "dimensionless", "normalised_by": "inter-ocular distance / face width / face height"},
        }
        feats["features"]["face_oval"] = {
            "kind": "polygon",
            "points": [[round(float(pts[i, 0]), 1), round(float(pts[i, 1]), 1)] for i in FACE_OVAL],
            "confidence": round(float(conf[FACE_OVAL].mean()), 3),
            "evidence": {"landmark_indices": FACE_OVAL},
        }
        feats["features"]["regions"] = {
            k: {"kind": "landmark_region", "indices": idx,
                "bbox": [round(float(pts[idx, 0].min()), 1), round(float(pts[idx, 1].min()), 1), round(float(pts[idx, 0].max() - pts[idx, 0].min()), 1), round(float(pts[idx, 1].max() - pts[idx, 1].min()), 1)],
                "confidence": round(float(conf[idx].mean()), 3)}
            for k, idx in REGIONS.items()
        }

    skin = skin_mask(rgb)
    hair = hair_mask(rgb, pts) if pts is not None else np.zeros_like(skin)
    feats["features"]["skin_mask"] = {"kind": "mask_summary", "area_fraction": round(float(skin.mean()), 4), "confidence": 0.75, "evidence": {"space": "YCrCb+HSV", "note": "warm-skin range, deep complexions included"}}
    feats["features"]["hair_region"] = {"kind": "mask_summary", "area_fraction": round(float(hair.mean()), 4), "confidence": round(float(np.clip(hair.mean() * 8, 0.1, 0.9)), 3), "evidence": {"space": "HSV dark+magenta within head window"}}

    if pts is not None:
        line = hairline_path(skin, hair, pts)
        feats["features"]["hairline"] = {"kind": "polyline", "points": line, "confidence": round(float(min(0.95, len(line) / 60)), 3), "evidence": {"method": "topmost skin pixel per forehead column", "columns": len(line)}}
        strands = baby_hairs(rgb, skin, line, pts)
        feats["features"]["baby_hairs"] = {"kind": "strand_set", "count": len(strands), "strands": strands[:80], "confidence": round(float(np.clip(len(strands) / 18, 0.1, 0.9)), 3), "evidence": {"method": "black-hat + elongation filter", "kernel_fraction_of_face_width": 0.07}}

    feats["features"]["silhouette"] = {"kind": "contour", **silhouette(rgb)}
    feats["features"]["jewelry"] = {"kind": "bead_set", **bead_features(rgb)}
    feats["features"]["garment"] = {"kind": "panel_set", **garment_panels(rgb, pts)}

    feats["relationships"] = relationships(conf if pts is not None else np.array([0.0]), feats["features"].get("hairline", {}).get("points", []), feats["features"].get("baby_hairs", {}).get("strands", []), feats["features"]["jewelry"], pts is not None)

    name = os.path.splitext(os.path.basename(path))[0]
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, f"{name}.features.json"), "w") as fh:
            json.dump(feats, fh, indent=1)
    feats["_rgb"] = rgb
    feats["_landmarks"] = pts
    return feats


def main() -> None:
    ap = argparse.ArgumentParser(description="LÉLU perception — reference image → structured features")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="artifacts/pci-fr-1.0/features")
    a = ap.parse_args()
    for path in a.images:
        feats = extract(path, a.out)
        summary = {k: (v.get("count", v.get("area_fraction", v.get("confidence")))) for k, v in feats["features"].items()}
        print(json.dumps({"image": os.path.basename(path), "features": summary, "warnings": feats["warnings"]}))


if __name__ == "__main__":
    sys.exit(main())
