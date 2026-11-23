"""
LÉLU — crop a region of a photograph by fractions (for a handbag, a boot, a piece of jewellery).

    python3 scripts/foundry/m25c_crop.py <in.png> <out.png> <x0> <y0> <x1> <y1>

Fractions of width/height, 0–1. Black phone bars above and below are removed first.
"""
import sys

import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(float, sys.argv[3:7])
im = Image.open(src).convert("RGB")
rows = [i for i, v in enumerate(np.asarray(im).mean(2).mean(1)) if v > 12]
im = im.crop((0, rows[0], im.width, rows[-1] + 1))
W, H = im.size
im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))).save(dst)
print("wrote", dst, im.size)
