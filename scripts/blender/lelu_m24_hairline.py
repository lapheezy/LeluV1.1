"""Measure the hairline on the separated hair object, then report it.

    blender -b --factory-startup --python lelu_m24_hairline.py -- job.json
    job: {"input": "<split>.glb", "report": "<hair/hair-split.json>"}

The separate pass measures the hair object alone, so dark chest and neck
triangles can no longer be mistaken for forehead hair. The band is the midline
forehead strip between the brow line and the hair mass.
"""
import json
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
job = json.load(open(argv[0]))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])

hair = bpy.data.objects.get("lelu_hair")
if hair is None:
    raise SystemExit("no lelu_hair object in the split file")
mw = hair.matrix_world
verts = [mw @ v.co for v in hair.data.vertices]
eye_z = 1.59285

band = [v for v in verts if abs(v.x) < 0.06 and v.y < -0.05 and v.z > 1.45]
# The hairline is the LOWEST hair in that strip: above it is forehead, below it
# is hair. Guard against a stray lash-level triangle by using the 1st percentile.
zs = sorted(v.z for v in band)
hairline = zs[max(0, int(len(zs) * 0.01))] if zs else None

report = json.load(open(job["report"]))
report["hairline"] = {
    "method": "lowest 1st-percentile vertex of lelu_hair inside |x|<60 mm, y<-50 mm, z>1.45 m",
    "samples": len(band),
    "hairlineHeightMm": round(hairline * 1000, 2) if hairline is not None else None,
    "aboveEyeLineMm": round((hairline - eye_z) * 1000, 2) if hairline is not None else None,
    "photographTargetMm": 87.68,
    "verdict": None,
}
if hairline is not None:
    delta = (hairline - eye_z) * 1000 - 87.68
    report["hairline"]["deltaMm"] = round(delta, 2)
    report["hairline"]["verdict"] = "within" if abs(delta) <= 8 else "outside"
with open(job["report"], "w") as fh:
    json.dump(report, fh, indent=1)
print("M24_HAIRLINE " + json.dumps(report["hairline"]))
