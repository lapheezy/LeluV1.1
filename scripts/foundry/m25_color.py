"""
LÉLU M25 — landmark-located skin colour measurement and CIEDE2000.

    python3 scripts/foundry/m25_color.py <landmarker.task> <out.json> <image> [<image> ...]

For each image the MediaPipe face landmarker finds the face; skin is sampled at
four fixed landmarks (left/right cheek centres 205/425, forehead 151, chin 199)
in a square patch of side 0.12 × IPD, and the per-patch median is converted
sRGB → CIELAB (D65). Highlights are excluded by dropping the brightest 20 % of
each patch, so the number describes complexion, not specular. The same rule is
applied to photographs and renders; nothing is picked by hand.
"""
import json
import sys

import numpy as np
from PIL import Image

import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

SITES = {"cheekR": 205, "cheekL": 425, "forehead": 151, "chin": 199}


def srgb_to_lab(rgb):
    c = np.asarray(rgb, np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def de2000(l1, l2):
    L1, a1, b1 = l1
    L2, a2, b2 = l2
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0:
        dh = 0
    elif dh > 180:
        dh -= 360
    elif dh < -180:
        dh += 360
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    if C1p * C2p == 0:
        hbp = hs
    elif abs(h1p - h2p) <= 180:
        hbp = hs / 2
    else:
        hbp = (hs + 360) / 2 if hs < 360 else (hs - 360) / 2
    T = 1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63))
    dth = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dth)) * Rc
    return float(np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)))


def detector(model):
    opts = vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model), num_faces=1,
                                        min_face_detection_confidence=0.2, min_face_presence_confidence=0.2)
    return vision.FaceLandmarker.create_from_options(opts)


def measure(det, path):
    im = np.asarray(Image.open(path).convert("RGB"))
    h, w = im.shape[:2]
    res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=im))
    if not res.face_landmarks:
        return {"image": path, "detected": False}
    lm = res.face_landmarks[0]
    P = lambda i: np.array([lm[i].x * w, lm[i].y * h])
    ipd = float(np.linalg.norm(P(468) - P(473))) if len(lm) > 473 else float(np.linalg.norm(P(33) - P(263))) * 0.75
    half = max(2, int(0.06 * ipd))
    sites = {}
    allpx = []
    for k, i in SITES.items():
        x, y = P(i).astype(int)
        patch = im[max(0, y - half):y + half, max(0, x - half):x + half].reshape(-1, 3).astype(np.float64)
        lum = patch @ [0.2126, 0.7152, 0.0722]
        keep = patch[lum <= np.percentile(lum, 80)]
        med = np.median(keep, 0)
        allpx.append(keep)
        sites[k] = {"px": [int(x), int(y)], "srgb": [round(float(c), 1) for c in med], "lab": [round(float(c), 2) for c in srgb_to_lab(med)]}
    med = np.median(np.concatenate(allpx), 0)
    return {"image": path, "detected": True, "patchPx": 2 * half, "sites": sites,
            "srgb": [round(float(c), 1) for c in med], "lab": [round(float(c), 2) for c in srgb_to_lab(med)]}


if __name__ == "__main__":
    model, out, images = sys.argv[1], sys.argv[2], sys.argv[3:]
    det = detector(model)
    rs = [measure(det, p) for p in images]
    json.dump({"method": __doc__.strip().splitlines()[0], "results": rs}, open(out, "w"), indent=1)
    for r in rs:
        print(r["image"].split("/")[-1], r.get("srgb"), r.get("lab"))
