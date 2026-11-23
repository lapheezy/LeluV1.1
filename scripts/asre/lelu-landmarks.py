"""
LÉLU — facial landmark measurement of reference images AND model renders.

Dev-time measurement tool (not an application dependency). Uses MediaPipe
FaceLandmarker (Apache-2.0, 478 landmarks incl. irises), run offline on local
files. The SAME detector and the SAME metric definitions are applied to her
canonical reference images and to orthographic renders of the model, so the
comparison is like-for-like.

    python lelu-landmarks.py --model face_landmarker.task --out DIR IMG [IMG ...]

Coordinate system: image pixels, x right, y down. Each face is roll-corrected
(rotated so the pupil line is horizontal) before measuring. Lengths are given
in units of the interpupillary distance (IOD); vertical positions as fractions
of face height (landmark 10 "upper forehead" to 152 "menton").
Angles in degrees, positive = outer corner higher than inner (upturned).
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

# MediaPipe face-mesh indices (subject's right = image left for a frontal face)
LM = {
    "pupil_r": 468, "pupil_l": 473,
    "eye_r_outer": 33, "eye_r_inner": 133, "eye_l_inner": 362, "eye_l_outer": 263,
    "lid_r_up": 159, "lid_r_lo": 145, "lid_l_up": 386, "lid_l_lo": 374,
    "brow_r_inner": 107, "brow_r_peak": 105, "brow_r_outer": 46,
    "brow_l_inner": 336, "brow_l_peak": 334, "brow_l_outer": 276,
    "nasion": 168, "nose_tip": 1, "subnasale": 2, "ala_r": 64, "ala_l": 294,
    "mouth_r": 61, "mouth_l": 291, "lip_up_top": 0, "stomion_up": 13, "stomion_lo": 14, "lip_lo_bot": 17,
    "forehead": 10, "menton": 152,
    "temple_r": 127, "temple_l": 356, "zygion_r": 234, "zygion_l": 454,
    "jaw_r": 132, "jaw_l": 361, "gonion_r": 58, "gonion_l": 288, "chin_r": 150, "chin_l": 379,
}

METRIC_DOC = {
    "face_width_temple": "temple width (127-356) / IOD",
    "face_width_cheek": "bizygomatic width (234-454) / IOD",
    "face_width_jaw": "mid-jaw width (132-361) / IOD",
    "face_width_gonion": "gonial width (58-288) / IOD",
    "face_width_chin": "chin width (150-379) / IOD",
    "face_height": "upper forehead to menton (10-152) / IOD",
    "jaw_to_cheek": "gonial width / bizygomatic width (taper of the jaw)",
    "face_aspect": "face height / bizygomatic width (oval vs round)",
    "eye_width": "palpebral fissure length (33-133, 362-263), mean / IOD",
    "eye_height": "lid aperture (159-145, 386-374), mean / IOD",
    "eye_aspect": "eye height / eye width (almond)",
    "canthal_tilt_deg": "angle inner->outer canthus above horizontal, mean",
    "intercanthal": "inner canthi distance (133-362) / IOD",
    "nose_width": "alar width (64-294) / IOD",
    "nose_length": "nasion to subnasale (168-2) / IOD",
    "mouth_width": "commissure width (61-291) / IOD",
    "upper_lip": "upper lip height (0-13) / IOD",
    "lower_lip": "lower lip height (14-17) / IOD",
    "lip_ratio": "lower lip / upper lip",
    "brow_height": "brow peak above upper lid (105-159, 334-386), mean / IOD",
    "y_brow": "brow peak height, fraction of face height from 10",
    "y_eye": "pupil line, fraction of face height",
    "y_subnasale": "nose base, fraction of face height",
    "y_stomion": "mouth line, fraction of face height",
    "y_lip_lo": "lower lip bottom, fraction of face height",
}


def measure(pts):
    """pts: dict name -> (x, y) in pixels. Returns roll-corrected metrics."""
    pr, pl = np.array(pts["pupil_r"]), np.array(pts["pupil_l"])
    ang = math.atan2(pl[1] - pr[1], pl[0] - pr[0])
    c, s = math.cos(-ang), math.sin(-ang)
    o = (pr + pl) / 2
    P = {k: np.array([(v[0] - o[0]) * c - (v[1] - o[1]) * s, (v[0] - o[0]) * s + (v[1] - o[1]) * c]) for k, v in pts.items()}
    iod = float(np.linalg.norm(P["pupil_l"] - P["pupil_r"]))
    d = lambda a, b: float(np.linalg.norm(P[a] - P[b])) / iod
    dx = lambda a, b: abs(float(P[a][0] - P[b][0])) / iod
    dy = lambda a, b: abs(float(P[a][1] - P[b][1])) / iod
    top, bot = P["forehead"][1], P["menton"][1]
    fh = bot - top
    yf = lambda k: float((P[k][1] - top) / fh)

    def tilt(inner, outer, side):
        v = P[outer] - P[inner]
        # image y is down: outer higher = negative y
        return math.degrees(math.atan2(-v[1], abs(v[0])))

    m = {
        "face_width_temple": dx("temple_r", "temple_l"),
        "face_width_cheek": dx("zygion_r", "zygion_l"),
        "face_width_jaw": dx("jaw_r", "jaw_l"),
        "face_width_gonion": dx("gonion_r", "gonion_l"),
        "face_width_chin": dx("chin_r", "chin_l"),
        "face_height": dy("forehead", "menton"),
        "eye_width": (d("eye_r_outer", "eye_r_inner") + d("eye_l_inner", "eye_l_outer")) / 2,
        "eye_height": (dy("lid_r_up", "lid_r_lo") + dy("lid_l_up", "lid_l_lo")) / 2,
        "canthal_tilt_deg": (tilt("eye_r_inner", "eye_r_outer", -1) + tilt("eye_l_inner", "eye_l_outer", 1)) / 2,
        "intercanthal": dx("eye_r_inner", "eye_l_inner"),
        "nose_width": dx("ala_r", "ala_l"),
        "nose_length": dy("nasion", "subnasale"),
        "mouth_width": dx("mouth_r", "mouth_l"),
        "upper_lip": dy("lip_up_top", "stomion_up"),
        "lower_lip": dy("stomion_lo", "lip_lo_bot"),
        "brow_height": (dy("brow_r_peak", "lid_r_up") + dy("brow_l_peak", "lid_l_up")) / 2,
        "y_brow": (yf("brow_r_peak") + yf("brow_l_peak")) / 2,
        "y_eye": yf("pupil_r") * 0.5 + yf("pupil_l") * 0.5,
        "y_subnasale": yf("subnasale"),
        "y_stomion": (yf("stomion_up") + yf("stomion_lo")) / 2,
        "y_lip_lo": yf("lip_lo_bot"),
    }
    m["jaw_to_cheek"] = m["face_width_gonion"] / m["face_width_cheek"]
    m["face_aspect"] = m["face_height"] / m["face_width_cheek"]
    m["eye_aspect"] = m["eye_height"] / m["eye_width"]
    m["lip_ratio"] = m["lower_lip"] / max(1e-6, m["upper_lip"])
    return {k: round(v, 4) for k, v in m.items()}, {"iod_px": round(iod, 2), "roll_deg": round(math.degrees(ang), 2)}


def detect(model, path):
    opts = vision.FaceLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path=model), num_faces=1, output_facial_transformation_matrixes=True)
    with vision.FaceLandmarker.create_from_options(opts) as det:
        img = mp.Image.create_from_file(path)
        r = det.detect(img)
        if not r.face_landmarks:
            return None
        lms = r.face_landmarks[0]
        w, h = img.width, img.height
        yaw = None
        if r.facial_transformation_matrixes:
            M = np.array(r.facial_transformation_matrixes[0])
            yaw = round(math.degrees(math.atan2(M[0, 2], M[2, 2])), 2)
        return [(l.x * w, l.y * h) for l in lms], (w, h), yaw


def annotate(path, all_pts, named, out):
    im = Image.open(path).convert("RGB")
    dr = ImageDraw.Draw(im)
    r = max(1, im.width // 400)
    for x, y in all_pts:
        dr.ellipse([x - r, y - r, x + r, y + r], fill=(80, 220, 255))
    for k, (x, y) in named.items():
        dr.ellipse([x - 3 * r, y - 3 * r, x + 3 * r, y + 3 * r], outline=(255, 60, 120), width=r)
    for a, b in [("zygion_r", "zygion_l"), ("gonion_r", "gonion_l"), ("temple_r", "temple_l"), ("forehead", "menton"), ("mouth_r", "mouth_l"), ("ala_r", "ala_l"), ("eye_r_outer", "eye_r_inner"), ("eye_l_inner", "eye_l_outer")]:
        dr.line([named[a], named[b]], fill=(255, 200, 40), width=r)
    im.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("images", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rows = {}
    for p in a.images:
        res = detect(a.model, p)
        stem = os.path.splitext(os.path.basename(p))[0]
        if res is None:
            rows[stem] = {"source": p, "detected": False}
            print(f"{stem}: no face detected", file=sys.stderr)
            continue
        pts, (w, h), yaw = res
        named = {k: pts[i] for k, i in LM.items()}
        metrics, info = measure(named)
        annotate(p, pts, named, os.path.join(a.out, f"{stem}--landmarks.png"))
        rows[stem] = {
            "source": p,
            "detected": True,
            "size": [w, h],
            "yaw_deg": yaw,
            **info,
            "landmarks_normalized": {k: [round(x / w, 5), round(y / h, 5)] for k, (x, y) in named.items()},
            "metrics": metrics,
        }
        print(f"{stem}: iod {info['iod_px']} px, roll {info['roll_deg']} deg, yaw {yaw} deg")
    ok = [r for r in rows.values() if r.get("detected")]
    agg = {}
    if ok:
        for k in ok[0]["metrics"]:
            v = np.array([r["metrics"][k] for r in ok])
            agg[k] = {"mean": round(float(v.mean()), 4), "std": round(float(v.std(ddof=1)) if len(v) > 1 else 0.0, 4), "n": len(v), "definition": METRIC_DOC.get(k, "")}
    json.dump({"tool": "MediaPipe FaceLandmarker 478 (float16 v1)", "units": "IOD-normalized lengths; y_* as fraction of face height (lm10..lm152); roll-corrected", "images": rows, "aggregate": agg}, open(os.path.join(a.out, "landmarks.json"), "w"), indent=1)
    for k, v in agg.items():
        print(f"  {k:20s} {v['mean']:8.4f} ± {v['std']:.4f}  (n={v['n']})")


if __name__ == "__main__":
    main()
