"""
LÉLU M25 — facial landmark registration on photographs and renders.

    python3 scripts/foundry/m25_landmarks.py <model> <out.json> <image> [<image> ...]

Runs the MediaPipe Face Landmarker (Apache-2.0, local CPU model) on each image
and reports scale-free facial ratios, so a photograph and a render can be
compared without assuming any millimetre scale for the photograph:

    ipd / faceWidth, mouthWidth / faceWidth, mouthWidth / ipd,
    noseWidth / ipd, eyeWidth / ipd, eyeToMouth / ipd, eyeToChin / ipd

faceWidth is the cheek-to-cheek span (landmarks 234–454). Pupil centres are the
iris centres (468, 473) when the model returns irises, else the eye-corner
midpoints. Every image is measured the same way; nothing is hand-placed.
"""
import json
import sys

import numpy as np
from PIL import Image

import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

import os

_det = None


def detector(model=None):
    global _det
    if _det is None:
        model = model or os.environ.get("LELU_LANDMARKER", os.path.expanduser("~/lelu-tools/models/face_landmarker.task"))
        opts = vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model), num_faces=1,
                                            min_face_detection_confidence=0.2, min_face_presence_confidence=0.2)
        _det = vision.FaceLandmarker.create_from_options(opts)
    return _det

IDX = {
    "eyeOuterR": 33, "eyeInnerR": 133, "eyeInnerL": 362, "eyeOuterL": 263,
    "mouthR": 61, "mouthL": 291, "lipTop": 13, "lipBottom": 14, "upperLipTop": 0, "lowerLipBottom": 17,
    "noseR": 129, "noseL": 358, "noseTip": 1, "chin": 152, "cheekR": 234, "cheekL": 454,
    "browR": 105, "browL": 334, "foreheadTop": 10, "jawR": 172, "jawL": 397,
}


def measure(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    res = detector().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(im)))
    if not res.face_landmarks:
        return {"image": path, "detected": False}
    lm = res.face_landmarks[0]
    P = lambda i: np.array([lm[i].x * w, lm[i].y * h])
    pts = {k: P(i) for k, i in IDX.items()}
    if len(lm) > 473:
        pr, pl = P(468), P(473)
        pupil = "iris"
    else:
        pr, pl = (pts["eyeOuterR"] + pts["eyeInnerR"]) / 2, (pts["eyeOuterL"] + pts["eyeInnerL"]) / 2
        pupil = "eye-corner midpoint"
    d = lambda a, b: float(np.linalg.norm(a - b))
    ipd = d(pr, pl)
    face = d(pts["cheekR"], pts["cheekL"])
    mouth = d(pts["mouthR"], pts["mouthL"])
    nose = d(pts["noseR"], pts["noseL"])
    eye_w = (d(pts["eyeOuterR"], pts["eyeInnerR"]) + d(pts["eyeOuterL"], pts["eyeInnerL"])) / 2
    eye_mid = (pr + pl) / 2
    mouth_mid = (pts["mouthR"] + pts["mouthL"]) / 2
    jaw = d(pts["jawR"], pts["jawL"])
    roll = float(np.degrees(np.arctan2(pl[1] - pr[1], pl[0] - pr[0])))
    return {
        "image": path, "detected": True, "pixels": [w, h], "pupilMethod": pupil, "rollDeg": round(roll, 2),
        "px": {"ipd": round(ipd, 2), "faceWidth": round(face, 2), "mouthWidth": round(mouth, 2), "noseWidth": round(nose, 2),
               "eyeWidth": round(eye_w, 2), "eyeToMouth": round(d(eye_mid, mouth_mid), 2), "eyeToChin": round(d(eye_mid, pts["chin"]), 2),
               "jawWidth": round(jaw, 2), "lipHeight": round(d(pts["upperLipTop"], pts["lowerLipBottom"]), 2)},
        "ratios": {
            "ipd/faceWidth": round(ipd / face, 4),
            "mouthWidth/faceWidth": round(mouth / face, 4),
            "mouthWidth/ipd": round(mouth / ipd, 4),
            "noseWidth/ipd": round(nose / ipd, 4),
            "eyeWidth/ipd": round(eye_w / ipd, 4),
            "eyeToMouth/ipd": round(d(eye_mid, mouth_mid) / ipd, 4),
            "eyeToChin/ipd": round(d(eye_mid, pts["chin"]) / ipd, 4),
            "jawWidth/faceWidth": round(jaw / face, 4),
            "lipHeight/mouthWidth": round(d(pts["upperLipTop"], pts["lowerLipBottom"]) / mouth, 4),
        },
        "landmarksPx": {k: [round(float(v[0]), 1), round(float(v[1]), 1)] for k, v in pts.items()} | {"pupilR": [round(float(pr[0]), 1), round(float(pr[1]), 1)], "pupilL": [round(float(pl[0]), 1), round(float(pl[1]), 1)]},
    }


if __name__ == "__main__":
    model, out, images = sys.argv[1], sys.argv[2], sys.argv[3:]
    detector(model)
    results = [measure(p) for p in images]
    json.dump({"model": "MediaPipe Face Landmarker float16 v1", "results": results}, open(out, "w"), indent=1)
    for r in results:
        print(r["image"].split("/")[-1], r.get("detected"), json.dumps(r.get("ratios")))
