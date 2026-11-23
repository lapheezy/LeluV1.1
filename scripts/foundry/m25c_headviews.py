"""Render a look's head from front / three-quarter / left / back and stitch them into one sheet.

    python3 scripts/foundry/m25c_headviews.py <in.glb> <out.png> [--hide a,b] [--radius 0.15] [--z 1.6] [--views front,three-quarter,left,back] [--samples 16]
"""
import argparse, json, os, subprocess, tempfile
from PIL import Image

B = os.path.expanduser("~/lelu-tools/blender-4.5.9-linux-x64/blender")
ap = argparse.ArgumentParser()
ap.add_argument("inp"); ap.add_argument("out")
ap.add_argument("--hide", default=""); ap.add_argument("--radius", type=float, default=0.15)
ap.add_argument("--z", type=float, default=1.6); ap.add_argument("--y", type=float, default=-0.0)
ap.add_argument("--views", default="front,three-quarter,left,back"); ap.add_argument("--samples", type=int, default=16)
ap.add_argument("--size", type=int, default=480)
ap.add_argument("--extra", default="")
a = ap.parse_args()
tiles = []
with tempfile.TemporaryDirectory() as td:
    for v in a.views.split(","):
        out = os.path.join(td, f"{v}.png")
        job = {"input": os.path.abspath(a.inp), "output": out, "view": v, "lighting": "neutral-studio",
               "camera": {"center": [0.0, a.y, a.z], "radius": a.radius, "lens": 85},
               "resolution": [a.size, a.size], "samples": a.samples, "hide": [h for h in a.hide.split(",") if h], "extra": [os.path.abspath(e) for e in a.extra.split(",") if e]}
        jp = os.path.join(td, f"{v}.json"); json.dump(job, open(jp, "w"))
        r = subprocess.run([B, "-b", "--factory-startup", "--python", "scripts/blender/lelu_m25_render.py", "--", jp], capture_output=True, text=True)
        if not os.path.exists(out):
            print(r.stdout[-2000:], r.stderr[-2000:]); raise SystemExit("render failed: " + v)
        tiles.append(Image.open(out).convert("RGB"))
    sheet = Image.new("RGB", (a.size * len(tiles), a.size))
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * a.size, 0))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    sheet.save(a.out)
    print("SHEET", a.out)
