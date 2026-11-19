"""
LÉLU M25 Complete — widen the mouth to the photographs' median, nothing else.

    blender -b --factory-startup --python lelu_m25c_lipwiden.py -- job.json
    job: {"input": glb, "output": glb, "report": json, "factor": 1.03,
          "centre": [0, -0.1, 1.546], "radii": [0.024, 0.016]}

Measured (scripts/foundry/m25c_lips.py): every lip ratio of the render sits
inside the photographs' spread except mouth width/IPD, 0.658 against a
photograph median of 0.678. This scales X about the mouth centre by `factor`
with a smooth elliptical falloff (1 inside the lips, 0 at the ellipse
radii, which reach past the corners), on every object that carries lip or
mouth geometry. Every shape key receives the same displacement as its basis,
so blink, smile and jaw-open deltas are unchanged.
"""
import hashlib
import json
import sys

import bpy
import numpy as np
from mathutils import Vector

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
f = float(job.get("factor", 1.03))
cx, cy, cz = job.get("centre", [0, -0.1, 1.546])
rx, rz = job.get("radii", [0.024, 0.016])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()


def weight(p):
    if p.y > cy + 0.03:  # front of the face only
        return 0.0
    r = ((p.x - cx) / rx) ** 2 + ((p.z - cz) / rz) ** 2
    if r >= 1:
        return 0.0
    t = 1 - r
    return t * t * (3 - 2 * t)


report = {"factor": f, "centre": [cx, cy, cz], "radii": [rx, rz], "objects": {}}
for nm in ("lelu_scalp", "lelu_hair", "lelu_mouth", "lelu_teeth"):
    o = bpy.data.objects[nm]
    W, Wi = o.matrix_world, o.matrix_world.inverted()
    me = o.data
    disp = []
    for v in me.vertices:
        p = W @ v.co
        w = weight(p)
        if w <= 0:
            disp.append(None)
            continue
        q = Vector((cx + (p.x - cx) * (1 + (f - 1) * w), p.y, p.z))
        disp.append(Wi @ q - v.co)
    moved = [d for d in disp if d is not None]
    for v, d in zip(me.vertices, disp):
        if d is not None:
            v.co += d
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            for i, d in enumerate(disp):
                if d is not None:
                    kb.data[i].co += d
    me.update()
    scale = o.matrix_world.to_scale().x
    report["objects"][nm] = {"verticesMoved": len(moved),
                             "maxMoveMm": round(max((d.length for d in moved), default=0) * scale * 1000, 3)}

bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
report["output"] = job["output"]
report["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
json.dump(report, open(job["report"], "w"), indent=1)
print("M25C_LIPS", json.dumps(report["objects"]))
