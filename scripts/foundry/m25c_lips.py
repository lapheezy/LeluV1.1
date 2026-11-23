"""
LÉLU M25 Complete — lip shape and colour from landmarks, photographs vs renders.

    python3 scripts/foundry/m25c_lips.py <out.json> <image> [<image> ...]

Per image (MediaPipe Face Landmarker, same model as m25_landmarks.py):
  mouthWidth/ipd, upperLip/lowerLip (vermilion heights on the midline:
  0→13 and 14→17), lipHeight/mouthWidth, cupidBowDepth/upperLip (how far the
  midline dip 0 sits below the two bow peaks 37/267), cornerDrop/mouthWidth
  (mouth corners 61/291 relative to the lip junction 13/14), and the median
  CIELAB colour of the vermilion (outer lip contour minus inner contour, the
  brightest 20 % dropped so gloss is not counted as colour).
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import m25_color  # noqa: E402
import m25_landmarks as L  # noqa: E402

OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]


def measure(path):
    import mediapipe as mp
    im = np.asarray(Image.open(path).convert("RGB"))
    h, w = im.shape[:2]
    res = L.detector().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=im))
    if not res.face_landmarks:
        return {"image": path, "detected": False}
    lm = res.face_landmarks[0]
    P = lambda i: np.array([lm[i].x * w, lm[i].y * h])
    d = lambda a, b: float(np.linalg.norm(P(a) - P(b)))
    ipd = float(np.linalg.norm(P(468) - P(473)))
    mw = d(61, 291)
    up, lo = d(0, 13), d(14, 17)
    peaks = (P(37)[1] + P(267)[1]) / 2
    bow = P(0)[1] - peaks
    junction = (P(13)[1] + P(14)[1]) / 2
    corner = (P(61)[1] + P(291)[1]) / 2 - junction
    mask = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(mask)
    dr.polygon([tuple(P(i)) for i in OUTER], fill=255)
    dr.polygon([tuple(P(i)) for i in INNER], fill=0)
    m = np.asarray(mask) > 0
    px = im[m].astype(float)
    lum = px @ [0.2126, 0.7152, 0.0722]
    px = px[lum <= np.percentile(lum, 80)]
    med = np.median(px, 0)
    return {"image": path, "detected": True,
            "ratios": {"mouthWidth/ipd": round(mw / ipd, 4), "upperLip/lowerLip": round(up / lo, 4),
                       "lipHeight/mouthWidth": round((up + lo) / mw, 4), "upperLip/mouthWidth": round(up / mw, 4),
                       "lowerLip/mouthWidth": round(lo / mw, 4), "cupidBowDepth/upperLip": round(bow / up, 4),
                       "cornerDrop/mouthWidth": round(corner / mw, 4)},
            "lipSrgb": [round(float(x), 1) for x in med], "lipLab": [round(float(x), 2) for x in m25_color.srgb_to_lab(med)],
            "px": {"ipd": round(ipd, 1), "mouthWidth": round(mw, 1), "upper": round(up, 1), "lower": round(lo, 1)}}


if __name__ == "__main__":
    out, images = sys.argv[1], sys.argv[2:]
    rs = [measure(p) for p in images]
    json.dump({"results": rs}, open(out, "w"), indent=1)
    for r in rs:
        print(r["image"].split("/")[-1][:28].ljust(28), json.dumps(r.get("ratios")), r.get("lipLab"))
