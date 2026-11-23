"""
LÉLU — split a side-by-side turnaround image into one square image per view.

    python3 scripts/foundry/m25c_split_views.py <dir> <turnaround.png> <view,view,...>

Writes <dir>/split_<view>.png for each panel, left to right (e.g. left,back,right or
left,back,right,front), each centred on a black square. Used between the Meshy
image-to-image turnaround and the multi-image-to-3d build.
"""
import sys

from PIL import Image

out, src, names = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
im = Image.open(src).convert("RGB")
w = im.width // len(names)
for i, n in enumerate(names):
    c = im.crop((i * w, 0, (i + 1) * w, im.height))
    sq = Image.new("RGB", (im.height, im.height))
    sq.paste(c, ((im.height - w) // 2, 0))
    sq.save(f"{out}/split_{n}.png")
    print("wrote", f"{out}/split_{n}.png")
