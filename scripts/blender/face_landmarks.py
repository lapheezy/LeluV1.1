"""
LÉLU 3D FORGE — FACE LANDMARKS (MediaPipe Face Landmarker)

Prints the 478 face-mesh landmarks of the most prominent face in an image
as JSON pixel coordinates, so a reference portrait and a render of the 3D
face can be put in exact correspondence.

  python face_landmarks.py <model.task> <image> [<image>…]
  → {"<image>": {"width": W, "height": H, "points": [[x, y], …]} | null}
"""

import json
import sys

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

model, images = sys.argv[1], sys.argv[2:]
options = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=model), num_faces=1, min_face_detection_confidence=0.2, min_face_presence_confidence=0.2)
out = {}
with vision.FaceLandmarker.create_from_options(options) as landmarker:
    for path in images:
        image = mp.Image.create_from_file(path)
        result = landmarker.detect(image)
        if not result.face_landmarks:
            out[path] = None
            continue
        w, h = image.width, image.height
        out[path] = {"width": w, "height": h, "points": [[p.x * w, p.y * h] for p in result.face_landmarks[0]]}
print(json.dumps(out))
