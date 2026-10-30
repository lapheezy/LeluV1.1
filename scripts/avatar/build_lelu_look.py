"""
LÉLU — build one look of her character from a reference image.

    python scripts/avatar/build_lelu_look.py --image scripts/avatar/references/gothic.jpg --name gothic \
        --birefnet birefnet.onnx --face face_landmarker.task --pose pose_landmarker_full.task

The owner's references are in scripts/avatar/references/ (gothic.jpg,
earthy.jpg). Writes public/avatar/lelu/<name>/body.webp (the reference with its background
removed: alpha channel) and rig.json (where her eyes, brows, mouth, chin,
head, neck, chest, earrings and feet are, in image pixels). The runtime rig
(src/core/avatar/LeluRig.ts) animates THIS image: her appearance is the
reference itself, never a substitute.

Models (download once):
  BiRefNet (MIT)   https://huggingface.co/onnx-community/BiRefNet-ONNX  onnx/model.onnx
  MediaPipe tasks  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
                   https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
Python: pillow numpy onnxruntime mediapipe. BiRefNet needs ~12 GB RAM per image.
"""

import argparse
import json
import os

import numpy as np
from PIL import Image


def cutout(image: Image.Image, model: str) -> Image.Image:
    import onnxruntime as ort

    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    x = np.asarray(image.resize((1024, 1024), Image.BILINEAR), dtype=np.float32) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    m = sess.run(None, {sess.get_inputs()[0].name: x})[-1][0, 0]
    if m.min() < 0 or m.max() > 1:
        m = 1 / (1 + np.exp(-m))
    return Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).resize(image.size, Image.BILINEAR)


def landmarks(image: Image.Image, face_model: str, pose_model: str):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    w, h = image.size
    pose = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=pose_model))
    ).detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(image)))
    b = np.array([[p.x * w, p.y * h] for p in pose.pose_landmarks[0]]) if pose.pose_landmarks else None

    # A full-length figure has a small face, and the face model is made for
    # close-ups: find it on an upscaled crop around the head the pose found.
    face_detector = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=face_model), num_faces=1)
    )
    crops = [(0, 0, w, h)]
    if b is not None:
        nose = b[0]
        half = max(np.linalg.norm(b[11] - b[12]) * 0.9, 40)
        crops.insert(0, (int(max(0, nose[0] - half)), int(max(0, nose[1] - half * 1.1)), int(min(w, nose[0] + half)), int(min(h, nose[1] + half * 0.9))))
    for x0, y0, x1, y1 in crops:
        crop = image.crop((x0, y0, x1, y1))
        scale = 768 / max(crop.size)
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
        face = face_detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(crop)))
        if face.face_landmarks:
            f = np.array([[x0 + p.x * crop.width / scale, y0 + p.y * crop.height / scale] for p in face.face_landmarks[0]])
            return f, b
    raise SystemExit("No face found in the reference: her rig cannot be built from it.")


def ellipse_of(points):
    pts = np.asarray(points)
    c = pts.mean(axis=0)
    return [float(c[0]), float(c[1]), float((pts[:, 0].max() - pts[:, 0].min()) / 2), float((pts[:, 1].max() - pts[:, 1].min()) / 2)]


def build(image: Image.Image, mask: Image.Image, f: np.ndarray, b, overrides: dict) -> dict:
    alpha = np.asarray(mask, dtype=np.float32) / 255.0
    w, h = image.size
    r = lambda v: [round(float(x), 1) for x in v]  # noqa: E731

    # Eyes (MediaPipe canonical mesh). "left"/"right" are the IMAGE's.
    eye_img_left = [33, 133, 159, 145, 160, 161, 158, 157, 144, 153]
    eye_img_right = [263, 362, 386, 374, 387, 388, 385, 384, 373, 380]
    eyes = {}
    for side, idx, iris in (("left", eye_img_left, 468), ("right", eye_img_right, 473)):
        cx, cy, rx, ry = ellipse_of(f[idx])
        iris_r = float(np.linalg.norm(f[iris + 1] - f[iris + 3]) / 2) if len(f) > iris + 3 else rx * 0.45
        eyes[side] = {"ellipse": r([cx, cy, rx * 1.08, max(ry, rx * 0.28)]), "iris": r([*f[iris], iris_r])}

    brows = {
        "left": r(ellipse_of(f[[70, 63, 105, 66, 107]])),
        "right": r(ellipse_of(f[[300, 293, 334, 296, 336]])),
    }
    # Mouth: corners, the parting line at the centre, lip thickness.
    cl, cr = f[61], f[291]
    parting = (f[13] + f[14]) / 2
    lip_h = float(np.linalg.norm(f[0] - f[17]) / 2)
    # Inner lip edges at the centre: where the lips meet, or — parted —
    # the lower edge of the visible upper teeth and the top of the lower lip.
    mouth = {
        "left": r(cl),
        "right": r(cr),
        "center": r(parting),
        "upperInner": r(f[13]),
        "lowerInner": r(f[14]),
        "lipHeight": round(lip_h, 1),
    }
    chin = f[152]
    forehead = f[10]
    face_half_w = float(np.linalg.norm(f[234] - f[454]) / 2)
    face_c = (f[234] + f[454]) / 2

    # Head (with hair): top = highest opaque pixel above her face; width =
    # the opaque extent at brow height.
    cols = slice(int(max(0, face_c[0] - face_half_w * 2)), int(min(w, face_c[0] + face_half_w * 2)))
    rows = np.where(alpha[:, cols].max(axis=1) > 0.5)[0]
    hair_top = float(rows[rows < forehead[1]].min()) if (rows < forehead[1]).any() else float(forehead[1] - face_half_w)
    brow_row = alpha[int(forehead[1] + (chin[1] - forehead[1]) * 0.2)]
    xs = np.where(brow_row > 0.5)[0]
    xs = xs[np.abs(xs - face_c[0]) < face_half_w * 2.2]
    head_rx = float(max(face_c[0] - xs.min(), xs.max() - face_c[0])) * 1.08 if len(xs) else face_half_w * 1.4
    head_cy = (hair_top + chin[1]) / 2
    head = r([face_c[0], head_cy, head_rx, (chin[1] - hair_top) / 2 * 1.06])

    rig = {
        "size": [w, h],
        "eyes": eyes,
        "brows": brows,
        "mouth": mouth,
        "chin": r(chin),
        "face": r([face_c[0], (forehead[1] + chin[1]) / 2, face_half_w, (chin[1] - forehead[1]) / 2]),
        "head": head,
    }
    if b is not None:
        sh_l, sh_r = b[11], b[12]
        shoulders_y = float((sh_l[1] + sh_r[1]) / 2)
        hips = (b[23] + b[24]) / 2
        feet = (b[29] + b[30] + b[31] + b[32]) / 4
        rig["neck"] = r([face_c[0], chin[1] + (shoulders_y - chin[1]) * 0.75])
        rig["chest"] = r([(sh_l[0] + sh_r[0]) / 2, shoulders_y + (hips[1] - shoulders_y) * 0.3, abs(sh_l[0] - sh_r[0]) * 0.55, (hips[1] - shoulders_y) * 0.32])
        rig["shoulders"] = r([sh_r[0], sh_r[1], sh_l[0], sh_l[1]])
        rig["feet"] = r(feet)
        rig["wrists"] = r([*b[16], *b[15]])
    rows_any = np.where(alpha.max(axis=1) > 0.5)[0]
    rig["top"] = round(float(rows_any.min()), 1)
    rig["bottom"] = round(float(rows_any.max()), 1)
    # Earring hoops: hook under each earlobe; radius from the face width.
    lobes = {"left": f[177], "right": f[401]}
    hoop = face_half_w * 0.42
    rig["earrings"] = {side: r([p[0], p[1], hoop]) for side, p in lobes.items()}

    for key, value in overrides.items():  # hand-checked corrections, recorded in the look's JSON
        if key.startswith("_"):
            continue
        node = rig
        parts = key.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return rig


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default="public/avatar/lelu")
    ap.add_argument("--birefnet")
    ap.add_argument("--mask", help="reuse an existing alpha mask instead of running BiRefNet")
    ap.add_argument("--face", required=True)
    ap.add_argument("--pose", required=True)
    ap.add_argument("--overrides", help="JSON file of dotted-key corrections (default: scripts/avatar/looks/<name>.json if present)")
    ap.add_argument("--preview", help="write an annotated preview JPEG here")
    a = ap.parse_args()

    image = Image.open(a.image).convert("RGB")
    mask = Image.open(a.mask).convert("L") if a.mask else cutout(image, a.birefnet)
    f, b = landmarks(image, a.face, a.pose)
    default_overrides = os.path.join(os.path.dirname(__file__), "looks", f"{a.name}.json")
    path = a.overrides or (default_overrides if os.path.exists(default_overrides) else None)
    overrides = json.load(open(path)) if path else {}
    rig = build(image, mask, f, b, overrides)
    rig["name"] = a.name

    out = os.path.join(a.out, a.name)
    os.makedirs(out, exist_ok=True)
    body = image.copy()
    body.putalpha(mask)
    body.save(os.path.join(out, "body.webp"), "WEBP", quality=90, method=6)
    with open(os.path.join(out, "rig.json"), "w") as fh:
        json.dump(rig, fh, indent=1)
    print(json.dumps(rig, indent=1))

    if a.preview:
        from PIL import ImageDraw

        pv = Image.new("RGB", image.size, (40, 120, 200))
        pv.paste(image, mask=mask)
        d = ImageDraw.Draw(pv)
        def ell(e, col):
            d.ellipse([e[0] - e[2], e[1] - e[3], e[0] + e[2], e[1] + e[3]], outline=col, width=2)
        for side in ("left", "right"):
            ell(rig["eyes"][side]["ellipse"], (0, 255, 0))
            i = rig["eyes"][side]["iris"]
            ell([i[0], i[1], i[2], i[2]], (255, 0, 255))
            ell(rig["brows"][side], (255, 255, 0))
            e = rig["earrings"][side]
            if e[2] > 0:
                ell([e[0], e[1] + e[2], e[2], e[2]], (255, 128, 0))
        if "hand" in rig:
            hd = rig["hand"]
            ell([hd[0], hd[1], hd[2], hd[2]], (255, 0, 128))
        m = rig["mouth"]
        d.line([*m["left"], *m["center"], *m["right"]], fill=(255, 0, 0), width=2)
        ell(rig["head"], (0, 255, 255))
        if "chest" in rig:
            ell(rig["chest"], (255, 255, 255))
            d.ellipse([rig["neck"][0] - 5, rig["neck"][1] - 5, rig["neck"][0] + 5, rig["neck"][1] + 5], fill=(255, 0, 0))
            d.ellipse([rig["feet"][0] - 6, rig["feet"][1] - 6, rig["feet"][0] + 6, rig["feet"][1] + 6], fill=(255, 0, 0))
        pv.save(a.preview, quality=88)


if __name__ == "__main__":
    main()
