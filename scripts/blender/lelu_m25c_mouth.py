"""
LÉLU M25 Complete — seat the mouth cavity and teeth behind the lips.

    blender -b --factory-startup --python lelu_m25c_mouth.py -- job.json
    job: {"input": glb, "output": glb, "report": json, "clearance": 0.0025}

Root cause of the dark patches at the mouth corners and the rectangular "lip
patch": the `lelu_mouth` cavity bag (added by the face-shapes job) sits up to
3.8 mm IN FRONT of the lip skin, worst at the corners where the lips curve
back, and the flat `lelu_teeth` card sits flush with the lip front. The renderer
draws exactly what is there.

Repair: for every cavity/teeth vertex, cast a ray from the camera side (−Y) at
the vertex's X/Z onto the face skin (lelu_scalp ∪ lelu_hair, which holds the lip
triangles); if the vertex is not at least `clearance` behind that skin, move it
back along +Y to that depth. Nothing else moves: lips, face, shape keys,
weights and UVs are untouched. The cavity becomes a matte dark interior
(it was a glossy flat red that read purple-grey under light).
"""
import hashlib
import json
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
clear = float(job.get("clearance", 0.0025))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["input"])
for o in list(bpy.data.objects):
    if o.name == "Icosphere" and o.parent is None:
        bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == "ARMATURE":
        o.data.pose_position = "REST"
        if o.animation_data:
            o.animation_data_clear()

verts, polys = [], []
for nm in ("lelu_scalp", "lelu_hair"):
    sc = bpy.data.objects[nm]
    M = sc.matrix_world
    b = len(verts)
    verts += [tuple(M @ v.co) for v in sc.data.vertices]
    polys += [tuple(i + b for i in p.vertices) for p in sc.data.polygons]
skin = BVHTree.FromPolygons(verts, polys)

report = {"input": job["input"], "clearanceMm": clear * 1000, "objects": {}}
for nm in ("lelu_mouth", "lelu_teeth"):
    o = bpy.data.objects[nm]
    W = o.matrix_world
    Wi = W.inverted()
    if nm == "lelu_teeth":
        # the teeth are a single rigid card: move it back as one piece by the
        # largest clearance any of its vertices needs (per-vertex moves bend it)
        need = 0.0
        front = 0
        for v in o.data.vertices:
            p = W @ v.co
            hit = skin.ray_cast(Vector((p.x, -0.4, p.z)), Vector((0, 1, 0)), 1.0)
            if hit[0] is None or hit[0].y > p.y + 0.004:
                continue
            behind = p.y - hit[0].y
            front += int(behind < 0)
            need = max(need, clear - behind)
        shift = Wi.to_3x3() @ Vector((0, need, 0))
        for v in o.data.vertices:
            v.co += shift
        o.data.update()
        report["objects"][nm] = {"vertices": len(o.data.vertices), "inFrontOfSkinBefore": front, "rigidShiftMm": round(need * 1000, 3)}
        continue
    moved, before_front, after = [], 0, []
    for v in o.data.vertices:
        p = W @ v.co
        hit = skin.ray_cast(Vector((p.x, -0.4, p.z)), Vector((0, 1, 0)), 1.0)
        if hit[0] is None:
            continue
        skin_y = hit[0].y
        if skin_y > p.y + 0.004:
            # the ray went through the lip opening and met skin far behind (the
            # back of the head): there is no lip in front of this vertex
            continue
        behind = p.y - skin_y  # positive = behind the skin
        if behind < 0:
            before_front += 1
        if behind < clear:
            q = Vector((p.x, skin_y + clear, p.z))
            moved.append((q - p).length * 1000)
            v.co = Wi @ q
    o.data.update()
    report["objects"][nm] = {"vertices": len(o.data.vertices), "inFrontOfSkinBefore": before_front, "moved": len(moved),
                             "moveMm": {"p50": round(float(np.median(moved)), 3), "max": round(float(max(moved)), 3)} if moved else None}

# matte, dark mouth interior
m = bpy.data.objects["lelu_mouth"].material_slots[0].material
p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
p.inputs["Base Color"].default_value = (0.030, 0.007, 0.009, 1)
p.inputs["Roughness"].default_value = 0.9
p.inputs["Specular IOR Level"].default_value = 0.15
report["mouthMaterial"] = {"baseColorLinear": [0.030, 0.007, 0.009], "roughness": 0.9, "specular": 0.15}

bpy.ops.export_scene.gltf(filepath=job["output"], export_format="GLB", export_apply=False, export_morph=True,
                          export_morph_normal=False, export_animations=False, export_skins=True,
                          export_image_format="JPEG", export_jpeg_quality=90)
report["output"] = job["output"]
report["outputSha256"] = hashlib.sha256(open(job["output"], "rb").read()).hexdigest()
json.dump(report, open(job["report"], "w"), indent=1)
print("M25C_MOUTH", json.dumps(report["objects"]))
