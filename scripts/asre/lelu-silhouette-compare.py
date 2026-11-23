"""IoU and width deviations of two canonical hair masks (lelu-silhouette.py outputs).
    python lelu-silhouette-compare.py REF_DIR REF_STEM MODEL_DIR MODEL_STEM [--png out.png]"""
import json, sys
import numpy as np
from PIL import Image
rd, rs, md, ms = sys.argv[1:5]
R = np.load(f"{rd}/{rs}--hair-canonical.npy"); Rv = np.load(f"{rd}/{rs}--valid-canonical.npy")
M = np.load(f"{md}/{ms}--hair-canonical.npy"); Mv = np.load(f"{md}/{ms}--valid-canonical.npy")
v = Rv & Mv
# compare only the rows where hair segmentation is reliable on both images
# (default crown..chin: dark hair over dark clothing is lost lower down)
ys_ = np.arange(-4, 16, 0.05)
band = [float(x) for x in sys.argv[sys.argv.index("--rows") + 1].split(",")] if "--rows" in sys.argv else [-3.0, 3.0]
v = v & ((ys_ >= band[0]) & (ys_ <= band[1]))[:, None]
inter = (R & M & v).sum(); uni = ((R | M) & v).sum()
ys = np.arange(-4, 16, 0.05)
def bottom(m): r = np.where((m & v).any(axis=1))[0]; return float(ys[r.max()]) if r.size else None
out = {"iou": round(float(inter / max(1, uni)), 4), "ref_bottom": bottom(R), "model_bottom": bottom(M), "compared_rows": [float(ys[np.where(v.any(axis=1))[0].min()]), float(ys[np.where(v.any(axis=1))[0].max()])]}
print(json.dumps(out))
if "--png" in sys.argv:
    img = np.zeros(R.shape + (3,), np.uint8)
    img[R & v] = (220, 60, 120); img[M & v] = (60, 160, 255); img[R & M & v] = (255, 255, 255)
    Image.fromarray(img).save(sys.argv[sys.argv.index("--png") + 1])
